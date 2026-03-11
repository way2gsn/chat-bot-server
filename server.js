// server.js — Express server for Railway

const express = require("express");
const app = express();
app.use(express.json());

const { detectLanguage, t } = require("./lib/lang");
const { catalog, getProductById, getProductsByCategory } = require("./lib/catalog");
const { getSession, saveSession } = require("./lib/session");
const { getAIReply } = require("./lib/claude");
const { buildPaymentMessage, generateOrderId } = require("./lib/payment");
const {
  markRead, sendText, sendProductCard,
  sendMainMenu, sendCategoriesMenu, sendProductsMenu, sendButtons,
} = require("./lib/whatsapp");

const PORT = process.env.PORT || 3000;

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Agri Fresh Bot is running 🌾" });
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  res.status(403).end();
});

// Incoming WhatsApp messages
app.post("/webhook", async (req, res) => {
  res.status(200).end(); // Ack immediately

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages) return;

    const msg     = value.messages[0];
    const from    = msg.from;
    const msgType = msg.type;

    await markRead(msg.id);
    const session = getSession(from);

    if (msgType === "interactive") {
      const reply      = msg.interactive;
      const replyId    = reply?.list_reply?.id || reply?.button_reply?.id || "";
      const replyTitle = reply?.list_reply?.title || reply?.button_reply?.title || "";
      await handleInteractiveReply(from, session, replyId, replyTitle);
      return;
    }

    if (msgType === "text") {
      await handleTextMessage(from, session, msg.text.body.trim());
      return;
    }

    if (msgType === "image") {
      const lang = session.lang;
      if (session.state === "awaiting_payment") {
        const msg2 = {
          en: "✅ Payment screenshot received! We'll confirm your order shortly. Thank you 🙏",
          hi: "✅ Payment screenshot mil gaya! Hum jald confirm karenge. Dhanyavaad 🙏",
          ta: "✅ Panam screenshot kidaittadu! Nangal virainthu urudi seyvom. Nandri 🙏",
          te: "✅ Payment screenshot vachindi! Memu tvarlone nirdharistamu. Dhanyavaadalu 🙏",
        };
        await sendText(from, msg2[lang] || msg2.en);
        saveSession(from, { state: "idle", cart: [] });
      }
      return;
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleTextMessage(from, session, text) {
  const lang = detectLanguage(text);
  if (lang !== session.lang) { saveSession(from, { lang }); session.lang = lang; }

  const lower = text.toLowerCase();
  const greetings = ["hi", "hello", "hey", "start", "menu"];

  if (greetings.some(g => lower.includes(g)) || /^[\u0900-\u097F]/.test(text) || /^[\u0B80-\u0BFF]/.test(text) || /^[\u0C00-\u0C7F]/.test(text)) {
    await sendMainMenu(from, lang, (key) => t(lang, key));
    saveSession(from, { lang, state: "browsing", messages: [] });
    return;
  }

  const orderMatch = text.match(/order\s+([A-Za-z]\d{3})(?:\s+(\d+))?/i);
  if (orderMatch) {
    await handleOrder(from, session, orderMatch[1].toUpperCase(), parseInt(orderMatch[2] || "1", 10));
    return;
  }

  const { reply, updatedMessages } = await getAIReply(session, text);
  await sendText(from, reply);
  saveSession(from, { messages: updatedMessages });
}

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
    await sendText(from, cart.length === 0
      ? (lang === "hi" ? "Aapka koi order nahi hai." : "You have no recent orders.")
      : "Your cart:\n" + cart.map(i => `${i.emoji} ${i.name} x${i.qty}`).join("\n")
    );
    return;
  }
  if (replyId.startsWith("cat_")) {
    const categoryId = replyId.replace("cat_", "");
    const products   = getProductsByCategory(categoryId);
    const category   = catalog.categories.find(c => c.id === categoryId);
    const catName    = category?.name[lang] || category?.name.en || categoryId;
    if (!products.length) { await sendText(from, "No products yet."); return; }
    await sendProductsMenu(from, products, lang, catName, ui);
    return;
  }
  if (replyId.startsWith("product_")) {
    const product = getProductById(replyId.replace("product_", ""));
    if (!product) { await sendText(from, "Product not found."); return; }
    await sendProductCard(from, product, lang);
    await sendButtons(from, {
      bodyText: lang === "hi" ? "Order karna chahte hain?" : "Would you like to order this?",
      buttons: [
        { id: `order_${product.id}_1`, title: "Order 1" },
        { id: `order_${product.id}_2`, title: "Order 2" },
        { id: "action_shop",            title: "Back" },
      ],
    });
    return;
  }
  if (replyId.startsWith("order_")) {
    const parts = replyId.split("_");
    await handleOrder(from, session, parts[1], parseInt(parts[2] || "1", 10));
    return;
  }
  await sendText(from, replyTitle || "Got it!");
}

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
  await sendText(from, buildPaymentMessage({ lang, items: [cartItem], total: subtotal, orderId }));

  const screenshotMsg = {
    en: "📸 Send payment screenshot here to confirm your order.",
    hi: "📸 Order confirm karne ke liye payment screenshot yahan bhejein.",
    ta: "📸 Order urudi seiya payment screenshot inge anupungal.",
    te: "📸 Order nirdharinchukovalante payment screenshot ikkade pamandi.",
  };
  await sendText(from, screenshotMsg[lang] || screenshotMsg.en);
}

app.listen(PORT, () => console.log(`🌾 Agri Fresh Bot running on port ${PORT}`));