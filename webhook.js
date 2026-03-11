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

// ── Vercel Serverless Handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {

  // GET — webhook verification
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // POST — incoming messages
  if (req.method === "POST") {
    res.sendStatus(200); // Always ack immediately

    try {
      const body    = req.body;
      if (body.object !== "whatsapp_business_account") return;

      const value   = body.entry?.[0]?.changes?.[0]?.value;
      if (!value?.messages) return;

      const msg     = value.messages[0];
      const from    = msg.from;
      const msgType = msg.type;

      // Mark as read
      await markRead(msg.id);

      // Get or create session
      const session = getSession(from);

      // ── Handle interactive replies (list/button selections) ───────────────
      if (msgType === "interactive") {
        const reply   = msg.interactive;
        const replyId = reply?.list_reply?.id || reply?.button_reply?.id || "";
        const replyTitle = reply?.list_reply?.title || reply?.button_reply?.title || "";

        await handleInteractiveReply(from, session, replyId, replyTitle);
        return;
      }

      // ── Handle text messages ──────────────────────────────────────────────
      if (msgType === "text") {
        const text = msg.text.body.trim();
        await handleTextMessage(from, session, text);
        return;
      }

      // ── Handle image (payment screenshot) ────────────────────────────────
      if (msgType === "image") {
        const lang = session.lang;
        if (session.state === "awaiting_payment") {
          await sendText(from,
            lang === "hi" ? "✅ पेमेंट स्क्रीनशॉट मिल गया! हम जल्द ही कन्फर्म करेंगे। धन्यवाद 🙏" :
            lang === "ta" ? "✅ பணம் செலுத்திய ஸ்கிரீன்ஷாட் கிடைத்தது! நாங்கள் விரைவில் உறுதிப்படுத்துவோம். நன்றி 🙏" :
            lang === "te" ? "✅ చెల్లింపు స్క్రీన్‌షాట్ అందింది! మేము త్వరలో నిర్ధారిస్తాము. ధన్యవాదాలు 🙏" :
            "✅ Payment screenshot received! We'll confirm your order shortly. Thank you 🙏"
          );
          saveSession(from, { state: "idle", cart: [] });
        } else {
          await sendText(from, t(lang, "thank_you"));
        }
        return;
      }

      // Unsupported message type
      await sendText(from, "Sorry, I can only handle text messages right now 🙏");

    } catch (err) {
      console.error("Webhook error:", err);
    }
    return;
  }

  res.sendStatus(405);
};

// ── Handle text messages ──────────────────────────────────────────────────────
async function handleTextMessage(from, session, text) {
  const lang = detectLanguage(text);

  // Update lang if changed
  if (lang !== session.lang) {
    saveSession(from, { lang });
    session.lang = lang;
  }

  const lower = text.toLowerCase();

  // Greeting trigger → show main menu
  const greetings = ["hi", "hello", "hey", "start", "menu", "नमस्ते", "हैलो", "வணக்கம்", "నమస్కారం", "హలో"];
  if (greetings.some(g => lower.includes(g))) {
    await sendMainMenu(from, lang, (key) => t(lang, key));
    saveSession(from, { lang, state: "browsing", messages: [] });
    return;
  }

  // ORDER command: "ORDER P001 2" or "order p001"
  const orderMatch = text.match(/order\s+([A-Za-z]\d{3})(?:\s+(\d+))?/i);
  if (orderMatch) {
    const productId = orderMatch[1].toUpperCase();
    const qty       = parseInt(orderMatch[2] || "1", 10);
    await handleOrder(from, session, productId, qty);
    return;
  }

  // Otherwise → AI handles it naturally
  const { reply, updatedMessages } = await getAIReply(session, text);
  await sendText(from, reply);
  saveSession(from, { messages: updatedMessages });
}

// ── Handle interactive list/button replies ────────────────────────────────────
async function handleInteractiveReply(from, session, replyId, replyTitle) {
  const { lang } = session;
  const ui = (key) => t(lang, key);

  // Main menu actions
  if (replyId === "action_shop") {
    await sendCategoriesMenu(from, catalog.categories, lang, ui);
    return;
  }

  if (replyId === "action_categories") {
    await sendCategoriesMenu(from, catalog.categories, lang, ui);
    return;
  }

  if (replyId === "action_support") {
    await sendText(from, `🙋 *${ui("support")}*\n\n${ui("support_msg")}\n\n📞 We'll reach out to you shortly!`);
    return;
  }

  if (replyId === "action_orders") {
    const cart = session.cart || [];
    if (cart.length === 0) {
      await sendText(from, lang === "hi" ? "आपका कोई ऑर्डर नहीं है।" :
                           lang === "ta" ? "உங்களுக்கு ஆர்டர் எதுவும் இல்லை." :
                           lang === "te" ? "మీకు ఏ ఆర్డర్లు లేవు." :
                           "You have no recent orders.");
    } else {
      await sendText(from, `📋 Your cart:\n${cart.map(i=>`${i.emoji} ${i.name} × ${i.qty}`).join("\n")}`);
    }
    return;
  }

  // Category selected → show products
  if (replyId.startsWith("cat_")) {
    const categoryId = replyId.replace("cat_", "");
    const products   = getProductsByCategory(categoryId);
    const category   = catalog.categories.find(c => c.id === categoryId);
    const catName    = category?.name[lang] || category?.name.en || categoryId;

    if (products.length === 0) {
      await sendText(from, "No products in this category yet.");
      return;
    }
    await sendProductsMenu(from, products, lang, catName, ui);
    return;
  }

  // Product selected → show product card + order button
  if (replyId.startsWith("product_")) {
    const productId = replyId.replace("product_", "");
    const product   = getProductById(productId);
    if (!product) { await sendText(from, "Product not found."); return; }

    await sendProductCard(from, product, lang);

    // Show order button
    await sendButtons(from, {
      bodyText: lang === "hi" ? "इसे ऑर्डर करना चाहते हैं?" :
                lang === "ta" ? "இதை ஆர்டர் செய்ய விரும்புகிறீர்களா?" :
                lang === "te" ? "దీన్ని ఆర్డర్ చేయాలనుకుంటున్నారా?" :
                "Would you like to order this?",
      buttons: [
        { id: `order_${productId}_1`, title: "🛒 Order 1" },
        { id: `order_${productId}_2`, title: "🛒 Order 2" },
        { id: "action_shop",           title: "↩ Back" },
      ],
    });
    return;
  }

  // Order button clicked: order_P001_1
  if (replyId.startsWith("order_")) {
    const parts     = replyId.split("_");
    const productId = parts[1];
    const qty       = parseInt(parts[2] || "1", 10);
    await handleOrder(from, session, productId, qty);
    return;
  }

  // Fallback
  await sendText(from, replyTitle || "Got it!");
}

// ── Handle order flow ─────────────────────────────────────────────────────────
async function handleOrder(from, session, productId, qty) {
  const { lang } = session;
  const product = getProductById(productId);

  if (!product) {
    await sendText(from, `Product ${productId} not found.`);
    return;
  }

  if (product.stock < qty) {
    await sendText(from, t(lang, "out_of_stock"));
    return;
  }

  const subtotal = product.price * qty;
  const orderId  = generateOrderId();
  const name     = product.name[lang] || product.name.en;

  const cartItem = { id: productId, emoji: product.emoji, name, qty, subtotal };

  // Save to cart
  saveSession(from, {
    state: "awaiting_payment",
    cart:  [cartItem],
  });

  // Send payment message
  const paymentMsg = buildPaymentMessage({
    lang,
    items:   [cartItem],
    total:   subtotal,
    orderId,
  });

  await sendText(from, paymentMsg);
  await sendText(from,
    lang === "hi" ? "📸 भुगतान के बाद यहाँ स्क्रीनशॉट भेजें और हम आपका ऑर्डर कन्फर्म करेंगे।" :
    lang === "ta" ? "📸 பணம் செலுத்திய பிறகு ஸ்கிரீன்ஷாட் அனுப்புங்கள், உங்கள் ஆர்டரை உறுதிப்படுத்துவோம்." :
    lang === "te" ? "📸 చెల్లింపు తర్వాత స్క్రీన్‌షాట్ పంపండి, మేము మీ ఆర్డర్‌ను నిర్ధారిస్తాము." :
    "📸 Send payment screenshot here and we'll confirm your order right away."
  );
}
