// api/webhook.js — Main WhatsApp Webhook (Vercel Serverless Function)

const { detectLanguage, t } = require("../lib/lang");
const { catalog, getProductById, getProductsByCategory } = require("../lib/catalog");
const { getSession, saveSession } = require("../lib/session");
const { getAIReply } = require("../lib/claude");
const { buildPaymentMessage, generateOrderId } = require("../lib/payment");
const {
  markRead, sendText, sendProductCard,
  sendMainMenu, sendCategoriesMenu, sendProductsMenu, sendButtons,
} = require("../lib/whatsapp");

// Body parser helper for Vercel
async function parseBody(req) {
  if (req.body) return; // already parsed
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { req.body = JSON.parse(data); } catch { req.body = {}; }
      resolve();
    });
    req.on("error", reject);
  });
}

// Vercel Serverless Handler
module.exports = async function handler(req, res) {

  // GET — health check or webhook verification
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Plain browser visit — health check
    if (!mode) {
      return res.status(200).json({ status: "Agri Fresh Bot is running" });
    }

    // WhatsApp webhook verification
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  // POST — incoming messages
  if (req.method === "POST") {
    await parseBody(req); // parse body first
    res.status(200).end();  // always ack immediately

    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      const value = body.entry?.[0]?.changes?.[0]?.value;
      if (!value?.messages) return;

      const msg     = value.messages[0];
      const from    = msg.from;
      const msgType = msg.type;

      // Mark as read
      await markRead(msg.id);

      // Get or create session
      const session = getSession(from);

      // Handle interactive replies (list/button selections)
      if (msgType === "interactive") {
        const reply      = msg.interactive;
        const replyId    = reply?.list_reply?.id || reply?.button_reply?.id || "";
        const replyTitle = reply?.list_reply?.title || reply?.button_reply?.title || "";
        await handleInteractiveReply(from, session, replyId, replyTitle);
        return;
      }

      // Handle text messages
      if (msgType === "text") {
        const text = msg.text.body.trim();
        await handleTextMessage(from, session, text);
        return;
      }

      // Handle image (payment screenshot)
      if (msgType === "image") {
        const lang = session.lang;
        if (session.state === "awaiting_payment") {
          const confirmMsg = {
            en: "Payment screenshot received! We'll confirm your order shortly. Thank you",
            hi: "payment screenshot mil gaya! Hum jald confirm karenge. Dhanyavaad",
            ta: "Panam screenshot kidaittadu! Nangal virainthu urudi seyvom. Nandri",
            te: "Payment screenshot vachindi! Memu tvarlone nirdharistamu. Dhanyavaadalu",
          };
          await sendText(from, confirmMsg[lang] || confirmMsg.en);
          saveSession(from, { state: "idle", cart: [] });
        } else {
          await sendText(from, t(lang, "thank_you"));
        }
        return;
      }

      // Unsupported type
      await sendText(from, "Sorry, I can only handle text messages right now");

    } catch (err) {
      console.error("Webhook error:", err);
    }
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    return res.status(200).json({ status: "Bot running" });
  }

  res.status(405).end();
};

// Handle text messages
async function handleTextMessage(from, session, text) {
  const lang = detectLanguage(text);

  if (lang !== session.lang) {
    saveSession(from, { lang });
    session.lang = lang;
  }

  const lower = text.toLowerCase();

  // Greeting trigger
  const greetings = ["hi", "hello", "hey", "start", "menu"];
  if (greetings.some(g => lower.includes(g)) || /[\u0900-\u097F]/.test(text.slice(0,3))) {
    await sendMainMenu(from, lang, (key) => t(lang, key));
    saveSession(from, { lang, state: "browsing", messages: [] });
    return;
  }

  // ORDER command: "ORDER P001 2"
  const orderMatch = text.match(/order\s+([A-Za-z]\d{3})(?:\s+(\d+))?/i);
  if (orderMatch) {
    const productId = orderMatch[1].toUpperCase();
    const qty       = parseInt(orderMatch[2] || "1", 10);
    await handleOrder(from, session, productId, qty);
    return;
  }

  // AI handles everything else
  const { reply, updatedMessages } = await getAIReply(session, text);
  await sendText(from, reply);
  saveSession(from, { messages: updatedMessages });
}

// Handle interactive list/button replies
async function handleInteractiveReply(from, session, replyId, replyTitle) {
  const { lang } = session;
  const ui = (key) => t(lang, key);

  if (replyId === "action_shop" || replyId === "action_categories") {
    await sendCategoriesMenu(from, catalog.categories, lang, ui);
    return;
  }

  if (replyId === "action_support") {
    await sendText(from, ui("support_msg"));
    return;
  }

  if (replyId === "action_orders") {
    const cart = session.cart || [];
    if (cart.length === 0) {
      await sendText(from, lang === "hi" ? "Aapka koi order nahi hai." : "You have no recent orders.");
    } else {
      await sendText(from, "Your cart:\n" + cart.map(i => `${i.emoji} ${i.name} x${i.qty}`).join("\n"));
    }
    return;
  }

  if (replyId.startsWith("cat_")) {
    const categoryId = replyId.replace("cat_", "");
    const products   = getProductsByCategory(categoryId);
    const category   = catalog.categories.find(c => c.id === categoryId);
    const catName    = category?.name[lang] || category?.name.en || categoryId;
    if (products.length === 0) { await sendText(from, "No products yet."); return; }
    await sendProductsMenu(from, products, lang, catName, ui);
    return;
  }

  if (replyId.startsWith("product_")) {
    const productId = replyId.replace("product_", "");
    const product   = getProductById(productId);
    if (!product) { await sendText(from, "Product not found."); return; }

    await sendProductCard(from, product, lang);
    await sendButtons(from, {
      bodyText: lang === "hi" ? "Order karna chahte hain?" : "Would you like to order this?",
      buttons: [
        { id: `order_${productId}_1`, title: "Order 1" },
        { id: `order_${productId}_2`, title: "Order 2" },
        { id: "action_shop",           title: "Back" },
      ],
    });
    return;
  }

  if (replyId.startsWith("order_")) {
    const parts     = replyId.split("_");
    const productId = parts[1];
    const qty       = parseInt(parts[2] || "1", 10);
    await handleOrder(from, session, productId, qty);
    return;
  }

  await sendText(from, replyTitle || "Got it!");
}

// Handle order + send UPI payment
async function handleOrder(from, session, productId, qty) {
  const { lang } = session;
  const product = getProductById(productId);

  if (!product) { await sendText(from, "Product not found."); return; }
  if (product.stock < qty) { await sendText(from, t(lang, "out_of_stock")); return; }

  const subtotal = product.price * qty;
  const orderId  = generateOrderId();
  const name     = product.name[lang] || product.name.en;
  const cartItem = { id: productId, emoji: product.emoji, name, qty, subtotal };

  saveSession(from, { state: "awaiting_payment", cart: [cartItem] });

  const paymentMsg = buildPaymentMessage({ lang, items: [cartItem], total: subtotal, orderId });
  await sendText(from, paymentMsg);

  const screenshotMsg = {
    en: "Send payment screenshot here to confirm your order.",
    hi: "Order confirm karne ke liye payment screenshot yahan bhejein.",
    ta: "Order urudi seiya payment screenshot inge anupungal.",
    te: "Order nirdharinchukovalante payment screenshot ikkade pamandi.",
  };
  await sendText(from, screenshotMsg[lang] || screenshotMsg.en);
}