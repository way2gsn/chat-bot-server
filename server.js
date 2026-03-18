const express = require("express");
const path    = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// CORS for React dashboard
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.DASHBOARD_URL || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const { detectLanguage, t }                         = require("./lib/lang");
const { catalog, getProductById, getProductsByCategory, getCatalogText, getPrice } = require("./lib/catalog");
const { getSession, saveSession }                   = require("./lib/session");
const { getAIReply }                                = require("./lib/claude");
const { buildPaymentMessage, generateOrderId } = require("./lib/payment");

// ── WhatsApp Flow IDs ─────────────────────────────────────────────────────────
const FLOW_SHOPPING = process.env.FLOW_SHOPPING_ID || "1926551408029255";
const FLOW_SUPPORT  = process.env.FLOW_SUPPORT_ID  || "1933182807315833";
const { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats } = require("./lib/orders");
const { getUser, saveUser, getUserAddress, getAllUsers } = require("./lib/users");
const { markRead, sendText, sendProductCard, sendMainMenu, sendCategoriesMenu, sendProductsMenu, sendButtons, sendListMenu, sendFlow, sendFlowTemplate } = require("./lib/whatsapp");

const PORT         = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "phasalbazar2024";

// ── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (token !== ADMIN_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Phasal Bazar Bot running 🌾" }));

// ── Admin API routes ──────────────────────────────────────────────────────────
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/orders", adminAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    const result = await getAllOrders({ status, search });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/users", adminAuth, (req, res) => {
  res.json(getAllUsers());
});

// ── Broadcast API ─────────────────────────────────────────────────────────────
app.post("/admin/broadcast", adminAuth, async (req, res) => {
  const { message, phones } = req.body;
  if (!message || !phones || !phones.length) {
    return res.status(400).json({ error: "message and phones required" });
  }

  const results = { sent: 0, failed: 0, errors: [] };

  for (const phone of phones) {
    try {
      await sendText(phone, message);
      results.sent++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      results.failed++;
      results.errors.push({ phone, error: err.message });
    }
  }

  res.json(results);
});

app.patch("/admin/orders/:orderId", adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { orderStatus, paymentStatus } = req.body;
    const updates = {};
    if (orderStatus)   updates.orderStatus   = orderStatus;
    if (paymentStatus) updates.paymentStatus = paymentStatus;
    await updateOrder(orderId, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp Webhook ──────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  res.status(403).end();
});

app.post("/webhook", async (req, res) => {
  res.status(200).end();
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages) return;

    const msg     = value.messages[0];
    const from    = msg.from;
    const msgType = msg.type;

    await markRead(msg.id);
    const session = getSession(from);

    if (msgType === "interactive") {
      const r    = msg.interactive;
      const id   = r?.list_reply?.id   || r?.button_reply?.id   || "";
      const title= r?.list_reply?.title|| r?.button_reply?.title|| "";
      await handleInteractiveReply(from, session, id, title);
      return;
    }
    if (msgType === "text")  { await handleTextMessage(from, session, msg.text.body.trim()); return; }
    // WhatsApp native catalog order
    if (msgType === "order") {
      await handleCatalogOrder(from, session, msg.order);
      return;
    }
    if (msgType === "interactive" && msg.interactive?.type === "nfm_reply") {
      await handleFlowResponse(from, session, msg.interactive.nfm_reply); return;
    }
    if (msgType === "interactive" && msg.interactive?.type === "button_reply") {
      const payload = msg.interactive.button_reply?.id || "";
      if (payload === "START_SHOPPING") {
        // Customer tapped "Start Shopping" from template
        saveSession(from, { state: "browsing", lang: session.lang || "en", customerType: session.customerType || "retail" });
        await sendMainMenu(from, session.lang || "en", k => t(session.lang || "en", k));
        return;
      }
    }
    if (msgType === "image") { await handlePaymentScreenshot(from, session); return; }
    if (msgType === "order") { await handleNativeOrder(from, session, msg.order); return; }
  } catch (err) { console.error("Webhook error:", err.message, err.stack); }
});

// ── Language selection menu ───────────────────────────────────────────────────
async function sendLanguageMenu(from) {
  // Use buttons instead of list — more reliable, no flag emoji issues
  await sendButtons(from, {
    bodyText: "🌾 *Welcome to Phasal Bazar!*\n\nPlease choose your language / भाषा चुनें:",
    buttons: [
      { id: "lang_en", title: "English" },
      { id: "lang_hi", title: "हिंदी (Hindi)" },
      { id: "lang_ta", title: "Tamil / தமிழ்" },
    ],
  });
  // Send Telugu separately since buttons max is 3
  await sendButtons(from, {
    bodyText: "More languages / अधिक भाषाएं:",
    buttons: [
      { id: "lang_te", title: "Telugu / తెలుగు" },
    ],
  });
}

// ── Text handler ──────────────────────────────────────────────────────────────
async function handleTextMessage(from, session, text) {
  const { lang = "en" } = session;
  const lower = text.trim().toLowerCase();

  // ── PRIORITY 1: Active order states (NEVER interrupted by greetings) ────────

  // Awaiting delivery address
  if (session.state === "awaiting_address") {
    if (lower === "cancel") {
      saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
      const msg = { en: "❌ Order cancelled.", hi: "❌ Cancel ho gaya.", ta: "❌ ரத்து.", te: "❌ రద్దు." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    if (text.trim().length < 5) {
      const msg = { en: "Please send your full delivery address (street, area, city).", hi: "Kripya poora address bhejein (gali, area, shahar).", ta: "முழு முகவரி அனுப்பவும்.", te: "పూర్తి చిరునామా పంపండి." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    const newAddress = text.trim();
    // Save address to user profile permanently
    saveUser(from, { address: newAddress, lang, customerType: session.customerType });
    saveSession(from, { address: newAddress });
    await sendFinalConfirmation(from, { ...session, address: newAddress });
    return;
  }

  // Using saved address confirmation
  if (session.state === "confirm_saved_address") {
    if (lower === "yes" || lower === "y" || lower === "haan" || lower === "ha") {
      const savedAddress = getUserAddress(from);
      saveSession(from, { address: savedAddress, state: "awaiting_confirm" });
      await sendFinalConfirmation(from, { ...session, address: savedAddress });
      return;
    }
    // No — ask for new address
    saveSession(from, { state: "awaiting_address" });
    const msg = { en: "📍 Please send your new delivery address:", hi: "📍 Naya delivery address bhejein:", ta: "📍 புதிய முகவரி அனுப்பவும்:", te: "📍 కొత్త చిరునామా పంపండి:" };
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // Awaiting CONFIRM or CANCEL
  if (session.state === "awaiting_confirm") {
    const confirms = ["confirm", "yes", "ok", "haan", "ha", "हां", "உறுதி", "సరే"];
    const cancels  = ["cancel", "no", "nahi", "नहीं", "band", "nope"];
    if (confirms.some(w => lower.includes(w))) {
      await placeConfirmedOrder(from, session);
      return;
    }
    if (cancels.some(w => lower.includes(w))) {
      saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
      const msg = { en: "❌ Order cancelled. Type *Hi* to start again.", hi: "❌ Order cancel. *Hi* likhein dobara shuru karne ke liye.", ta: "❌ ரத்து. மீண்டும் தொடங்க *Hi* என்று அனுப்பவும்.", te: "❌ రద్దు. మళ్ళీ ప్రారంభించడానికి *Hi* అని పంపండి." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    // Not understood — remind clearly
    const remind = {
      en: "Reply *CONFIRM* ✅ to place order\nReply *CANCEL* ❌ to cancel",
      hi: "*CONFIRM* likhein order ke liye\n*CANCEL* likhein cancel karne ke liye",
      ta: "ஆர்டர் செய்ய *CONFIRM* ✅\nரத்து செய்ய *CANCEL* ❌",
      te: "ఆర్డర్‌కు *CONFIRM* ✅\nరద్దుకు *CANCEL* ❌",
    };
    await sendText(from, remind[lang] || remind.en);
    return;
  }

  // Awaiting quantity input for wholesale cart
  if (session.state === "awaiting_qty") {
    const qty = parseInt(text.trim());
    if (isNaN(qty) || qty < 1) {
      const msg = { en: "Please send a valid number (e.g. 5, 10, 50)", hi: "Kripya ek valid number likhein (jaise 5, 10, 50)", ta: "சரியான எண் அனுப்பவும் (எ.கா. 5, 10, 50)", te: "సరైన సంఖ్య పంపండి (ఉదా. 5, 10, 50)" };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    const productId = session.pendingCartProduct;
    if (!productId) { saveSession(from, { state: "browsing" }); return; }
    await addToCart(from, session, productId, qty, lang);
    return;
  }

  // Awaiting PAID confirmation after screenshot
  if (session.state === "awaiting_paid_confirm") {
    const word = text.trim().toLowerCase();
    if (word === "paid") {
      const { pendingOrder } = session;
      if (pendingOrder) {
        confirmOrder(pendingOrder.orderId);
        const msg = {
          en: `✅ *Payment Confirmed!*\nOrder *${pendingOrder.orderId}* placed 🎉\nDelivery in 2-3 days. Thank you! 🌾`,
          hi: `✅ *Payment Confirm!*\nOrder *${pendingOrder.orderId}* place ho gaya 🎉\n2-3 din mein delivery. Dhanyavaad! 🌾`,
          ta: `✅ *Payment உறுதி!*\nOrder *${pendingOrder.orderId}* 🎉\n2-3 நாட்களில் டெலிவரி. நன்றி! 🌾`,
          te: `✅ *Payment నిర్ధారణ!*\nOrder *${pendingOrder.orderId}* 🎉\n2-3 రోజుల్లో డెలివరీ. ధన్యవాదాలు! 🌾`,
        };
        await sendText(from, msg[lang] || msg.en);
        saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
      }
      return;
    }
    if (word === "cancel") {
      const { pendingOrder } = session;
      if (pendingOrder) cancelOrder(pendingOrder.orderId);
      saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
      const msg = { en: "❌ Order cancelled.", hi: "❌ Cancel ho gaya.", ta: "❌ ரத்து.", te: "❌ రద్దు." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    const remind = { en: "Please type *PAID* to confirm or *CANCEL* to cancel.", hi: "*PAID* ya *CANCEL* likhein.", ta: "*PAID* அல்லது *CANCEL* என்று அனுப்பவும்.", te: "*PAID* లేదా *CANCEL* అని టైప్ చేయండి." };
    await sendText(from, remind[lang] || remind.en);
    return;
  }

  // Awaiting payment screenshot
  if (session.state === "awaiting_payment") {
    const msg = {
      en: "📸 Please send the *payment screenshot* to confirm your order, or type *CANCEL* to cancel.",
      hi: "📸 Order confirm karne ke liye *payment screenshot* bhejein, ya *CANCEL* likhein.",
      ta: "📸 ஆர்டர் உறுதிப்படுத்த *payment screenshot* அனுப்பவும்.",
      te: "📸 ఆర్డర్ నిర్ధారించడానికి *payment screenshot* పంపండి.",
    };
    if (lower === "cancel") {
      const { pendingOrder } = session;
      if (pendingOrder) cancelOrder(pendingOrder.orderId);
      saveSession(from, { state: "idle", cart: [], pendingOrder: null });
      const cm = { en: "❌ Order cancelled.", hi: "❌ Cancel ho gaya.", ta: "❌ ரத்து.", te: "❌ రద్దు." };
      await sendText(from, cm[lang] || cm.en);
      return;
    }
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // ── PRIORITY 2 & 3: Send Flow for ALL customers (new + returning) ───────────

  const greetings = ["hi","hello","hey","start","menu","helo","hii"];
  const isGreeting = greetings.some(g => lower === g || lower.startsWith(g+" ")) || /^[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text);
  const isNewCustomer = !session.lang || session.state === "new";

  if (isGreeting || isNewCustomer) {
    // Send welcome + main menu exactly like old bot
    saveSession(from, { state: "browsing", lang: lang || "en", customerType: session.customerType || "retail", messages: [] });
    await sendMainMenu(from, lang || "en", k => t(lang || "en", k));
    return;
  }

  // Customer type not set — ask
  if (!session.customerType || session.state === "choosing_type") {
    await sendCustomerTypeMenu(from, lang);
    return;
  }

  const m = text.match(/order\s+([A-Za-z]\d{3})(?:\s+(\d+))?/i);
  if (m) { await initiateOrder(from, session, m[1].toUpperCase(), parseInt(m[2]||"1")); return; }

  const { reply, updatedMessages } = await getAIReply(session, text);
  await sendText(from, reply);
  saveSession(from, { messages: updatedMessages });
}

// ── Interactive reply handler ─────────────────────────────────────────────────
async function handleInteractiveReply(from, session, replyId, replyTitle) {

  // Language selection
  if (replyId.startsWith("lang_")) {
    const chosen = replyId.replace("lang_", ""); // en, hi, ta, te
    saveSession(from, { lang: chosen, state: "browsing", messages: [] });
    session.lang = chosen;

    const welcome = {
      en: "🎉 Great! You selected *English*.",
      hi: "🎉 बढ़िया! आपने *हिंदी* चुनी।",
      ta: "🎉 நன்று! நீங்கள் *தமிழ்* தேர்ந்தெடுத்தீர்கள்.",
      te: "🎉 చాలా బాగుంది! మీరు *తెలుగు* ఎంచుకున్నారు.",
    };
    await sendText(from, welcome[chosen] || welcome.en);
    // Now ask customer type
    saveSession(from, { lang: chosen, state: "choosing_type", messages: [] });
    saveUser(from, { lang: chosen });
    await sendCustomerTypeMenu(from, chosen);
    return;
  }

  const { lang } = session;
  const ui = k => t(lang, k);

  if (replyId === "action_shop") {
    // Send catalog link exactly like old bot
    const catalogMsg = {
      en: "Click on the view catalog button to explore products https://wa.me/c/917771012123",
      hi: "Products dekhne ke liye catalog button click karein https://wa.me/c/917771012123",
      ta: "பொருட்கள் பார்க்க catalog button click செய்யவும் https://wa.me/c/917771012123",
      te: "ఉత్పత్తులు చూడటానికి catalog button click చేయండి https://wa.me/c/917771012123",
    };
    await sendText(from, catalogMsg[lang] || catalogMsg.en);
    // Also send catalog as native WhatsApp message
    await sendCatalogLink(from, lang);
    return;
  }
  if (replyId === "action_categories") {
    await sendCategoriesMenu(from, catalog.categories, lang, ui); return;
  }
  if (replyId === "action_support") {
    if (FLOW_SUPPORT) {
      await sendFlow(from, {
        flowId:     FLOW_SUPPORT,
        headerText: "🙋 Customer Support",
        bodyText:   "We are here to help! Available Mon-Sat, 9AM-6PM.",
        footerText: "Phasal Bazar Support",
        buttonText: "Contact Support",
        screenName: "SUPPORT_MENU",
      });
    } else {
      await sendText(from, ui("support_msg"));
    }
    return;
  }
  if (replyId === "action_orders")  { await sendOrderHistory(from, session); return; }

  if (replyId.startsWith("cat_")) {
    const id       = replyId.replace("cat_", "");
    const products = getProductsByCategory(id);
    const cat      = catalog.categories.find(c => c.id === id);
    const name     = cat?.name[lang] || cat?.name.en || id;
    if (!products.length) { await sendText(from, "No products yet."); return; }
    await sendProductsMenu(from, products, lang, name, ui, session.customerType || "retail");
    return;
  }

  if (replyId.startsWith("product_")) {
    const product = getProductById(replyId.replace("product_", ""));
    if (!product) { await sendText(from, "Product not found."); return; }
    await sendProductCard(from, product, lang, session.customerType || "retail");
    const cart = session.cart || [];
    const cartLabel = cart.length > 0
      ? (lang === "hi" ? `🛒 Cart (${cart.length})` : `🛒 Cart (${cart.length})`)
      : (lang === "hi" ? "🛒 Cart (0)" : "🛒 Cart (0)");
    await sendButtons(from, {
      bodyText: lang === "hi" ? "Kya karna chahte hain?" : "What would you like to do?",
      buttons: [
        { id: `addcart_${product.id}`, title: "🛒 Add to Cart" },
        { id: `order_${product.id}_1`, title: "⚡ Order Now (1)" },
        { id: "view_cart",             title: cartLabel },
      ],
    });
    return;
  }

  // Add to cart — ask quantity for wholesale, default 1 for retail
  if (replyId.startsWith("addcart_")) {
    const productId = replyId.replace("addcart_", "");
    const product   = getProductById(productId);
    if (!product) { await sendText(from, "Product not found."); return; }

    const isWholesale = session.customerType === "wholesale";

    if (isWholesale) {
      // Save pending product and ask quantity
      saveSession(from, { state: "awaiting_qty", pendingCartProduct: productId });
      const price = getPrice(product, "wholesale");
      const name  = product.name[lang] || product.name.en;
      const ask = {
        en: `${product.emoji} *${name}*\nPrice: ₹${price} per ${product.unit}\n\nHow many units do you want?\nReply with a number (e.g. 5, 10, 50)`,
        hi: `${product.emoji} *${name}*\nPrice: ₹${price} per ${product.unit}\n\nKitni quantity chahiye?\nNumber likhein (jaise 5, 10, 50)`,
        ta: `${product.emoji} *${name}*\nவிலை: ₹${price}\n\nஎத்தனை வேண்டும்? எண் அனுப்பவும்`,
        te: `${product.emoji} *${name}*\nధర: ₹${price}\n\nఎన్ని కావాలి? సంఖ్య పంపండి`,
      };
      await sendText(from, ask[lang] || ask.en);
      return;
    }

    // Retail — just add 1
    await addToCart(from, session, productId, 1, lang);
    return;
  }

  // View cart
  if (replyId === "view_cart") {
    const cart = session.cart || [];
    if (!cart.length) {
      const msg = { en: "🛒 Your cart is empty. Browse products to add items.", hi: "🛒 Cart khali hai.", ta: "🛒 Cart காலியாக உள்ளது.", te: "🛒 Cart ఖాళీగా ఉంది." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    const total = cart.reduce((s, i) => s + i.subtotal, 0);
    const lines = cart.map(i => `${i.emoji} ${i.name} x${i.qty} = Rs.${i.subtotal}`).join("\n");
    const sep = "─────────────────";
    const summaryText = `🛒 *Your Cart*\n${sep}\n${lines}\n${sep}\n💰 Total: Rs.${total}`;
    const summary = { en: summaryText, hi: summaryText, ta: summaryText, te: summaryText };
    await sendText(from, summary[lang] || summary.en);
    await sendButtons(from, {
      bodyText: lang === "hi" ? "Aage kya karein?" : "What next?",
      buttons: [
        { id: "checkout_cart", title: "✅ Checkout" },
        { id: "clear_cart",    title: "🗑️ Clear Cart" },
        { id: "action_shop",   title: "➕ Add More" },
      ],
    });
    return;
  }

  // Clear cart
  if (replyId === "clear_cart") {
    saveSession(from, { cart: [] });
    const msg = { en: "🗑️ Cart cleared.", hi: "🗑️ Cart saaf ho gaya.", ta: "🗑️ Cart அழிக்கப்பட்டது.", te: "🗑️ Cart క్లియర్ అయింది." };
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // Checkout cart
  if (replyId === "checkout_cart") {
    const cart = session.cart || [];
    if (!cart.length) {
      const msg = { en: "🛒 Cart is empty.", hi: "Cart khali hai.", ta: "Cart காலியாக உள்ளது.", te: "Cart ఖాళీగా ఉంది." };
      await sendText(from, msg[lang] || msg.en);
      return;
    }
    const total   = cart.reduce((s, i) => s + i.subtotal, 0);
    const orderId = generateOrderId();
    saveSession(from, { state: "choosing_payment", pendingOrder: { orderId, cartItem: cart[0], items: cart, total } });
    const ask = { en: "How would you like to pay?", hi: "Kaise payment karein?", ta: "எப்படி பணம் செலுத்த விரும்புகிறீர்கள்?", te: "ఎలా చెల్లించాలనుకుంటున్నారు?" };
    await sendButtons(from, {
      bodyText: ask[lang] || ask.en,
      buttons: [
        { id: "pay_upi",    title: "💳 UPI / PhonePe" },
        { id: "pay_cod",    title: "💵 Cash on Delivery" },
        { id: "pay_cancel", title: "❌ Cancel" },
      ],
    });
    return;
  }

  if (replyId.startsWith("order_")) {
    const p = replyId.split("_");
    await initiateOrder(from, session, p[1], parseInt(p[2]||"1"));
    return;
  }

  // Saved address buttons
  if (replyId === "use_saved_address") {
    const savedAddress = getUserAddress(from);
    saveSession(from, { address: savedAddress, state: "awaiting_confirm" });
    await sendFinalConfirmation(from, { ...session, address: savedAddress });
    return;
  }
  if (replyId === "new_address") {
    saveSession(from, { state: "awaiting_address" });
    const msg = { en: "📍 Please send your new delivery address:", hi: "📍 Naya address bhejein:", ta: "📍 புதிய முகவரி அனுப்பவும்:", te: "📍 కొత్త చిరునామా పంపండి:" };
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // Customer type selection
  if (replyId === "type_retail" || replyId === "type_wholesale") {
    const customerType = replyId === "type_retail" ? "retail" : "wholesale";
    const chosenLang = session.lang || "en";
    saveSession(from, { customerType, state: "browsing" });
    saveUser(from, { customerType, lang: chosenLang });
    const msg = {
      retail: {
        en: "🛒 *Retail prices (MRP)* selected. Here is our menu:",
        hi: "🛒 *Retail prices (MRP)* चुनी। यह हमारा मेनू है:",
        ta: "🛒 *சில்லறை விலை (MRP)* தேர்ந்தெடுக்கப்பட்டது:",
        te: "🛒 *రిటైల్ ధరలు (MRP)* ఎంచుకున్నారు:",
      },
      wholesale: {
        en: "🏪 *Wholesale prices* selected. Here is our menu:",
        hi: "🏪 *Wholesale prices* चुनी। यह हमारा मेनू है:",
        ta: "🏪 *மொத்த விலை* தேர்ந்தெடுக்கப்பட்டது:",
        te: "🏪 *హోల్‌సేల్ ధరలు* ఎంచుకున్నారు:",
      },
    };
    await sendText(from, msg[customerType][lang] || msg[customerType].en);
    await sendMainMenu(from, lang, k => t(lang, k));
    return;
  }

  // Native cart order confirmed by customer
  if (replyId === "place_cart_order") {
    const { pendingOrder } = session;
    if (!pendingOrder) { await sendText(from, "No order found."); return; }
    // Ask for address using WhatsApp native address flow
    saveSession(from, { chosenPayment: "COD", state: "awaiting_address" });
    const askAddr = {
      en: "Thanks for your order! Tell us what address you'd like this order delivered to.",
      hi: "Order ke liye shukriya! Delivery address batayein.",
      ta: "ஆர்டருக்கு நன்றி! டெலிவரி முகவரி சொல்லுங்கள்.",
      te: "ఆర్డర్‌కు ధన్యవాదాలు! డెలివరీ చిరునామా చెప్పండి.",
    };
    await sendButtons(from, {
      bodyText: askAddr[lang] || askAddr.en,
      buttons: [
        { id: "pay_cod", title: "Cash on Delivery" },
        { id: "pay_upi", title: "UPI/Net-Banking/Card" },
        { id: "pay_cancel", title: "Cancel" },
      ],
    });
    return;
  }

  if (replyId === "pay_upi") {
    await showSummaryThenPay(from, session, "UPI");
    return;
  }
  if (replyId === "pay_cod") {
    await showSummaryThenPay(from, session, "COD");
    return;
  }
  if (replyId === "pay_cancel") {
    const { pendingOrder } = session;
    if (pendingOrder) await cancelOrder(pendingOrder.orderId);
    saveSession(from, { state: "idle", cart: [], pendingOrder: null });
    const msg = { en: "❌ Order cancelled.", hi: "❌ Order cancel ho gaya.", ta: "❌ ஆர்டர் ரத்து.", te: "❌ ఆర్డర్ రద్దు." };
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // Rate order
  if (replyId === "rate_order" || replyId.startsWith("rate_order_")) {
    await sendListMenu(from, {
      bodyText: "Order Rating\n\nPlease select the rating.\n\nYour feedback fuels our service enhancement.",
      buttonLabel: "Select Rating",
      sections: [{
        title: "Rating",
        rows: [
          { id: "rating_5", title: "😎😎😎😎😎 Excellent", description: "5 Stars" },
          { id: "rating_4", title: "😊😊😊😊 Good",       description: "4 Stars" },
          { id: "rating_3", title: "😐😐😐 Average",      description: "3 Stars" },
          { id: "rating_2", title: "😞😞 Poor",            description: "2 Stars" },
          { id: "rating_1", title: "😡 Very Poor",         description: "1 Star" },
        ],
      }],
    });
    return;
  }
  if (replyId.startsWith("rating_")) {
    const rating = replyId.replace("rating_","");
    const stars = { "5":"😎😎😎😎😎 Excellent","4":"😊😊😊😊 Good","3":"😐😐😐 Average","2":"😞😞 Poor","1":"😡 Very Poor" };
    await sendText(from, "Thank you for rating this order " + (rating === "5" ? "😊" : "🙏"));
    return;
  }

  await sendText(from, replyTitle || "Got it!");
}

// ── Order history ─────────────────────────────────────────────────────────────
async function sendOrderHistory(from, session) {
  const { lang } = session;
  const result = getAllOrders({ search: from });
  const orders = (Array.isArray(result) ? result : []).slice(0, 5);
  if (!orders.length) {
    await sendText(from, lang === "hi" ? "Aapka koi order nahi hai." : "You have no recent orders.");
    return;
  }
  const emoji = { pending:"⏳", confirmed:"✅", delivered:"📦", cancelled:"❌" };
  const lines = ["📋 *Your Recent Orders:*\n"];
  orders.forEach(o => {
    lines.push(`${emoji[o.orderStatus]||"📋"} *${o.orderId}*`);
    lines.push(`   ₹${o.total} | ${o.paymentMethod} | ${o.orderStatus}`);
    lines.push(`   ${new Date(o.createdAt).toLocaleDateString()}\n`);
  });
  await sendText(from, lines.join("\n"));
}

// ── Customer type menu ───────────────────────────────────────────────────────
async function sendCustomerTypeMenu(from, lang) {
  const ask = {
    en: "Are you buying for personal use or wholesale?",
    hi: "Aap personal use ke liye khareed rahe hain ya wholesale?",
    ta: "நீங்கள் தனிப்பட்ட பயன்பாட்டிற்கா அல்லது மொத்தமாகவா வாங்குகிறீர்கள்?",
    te: "మీరు వ్యక్తిగత వినియోగానికా లేదా హోల్‌సేల్‌కా కొనుగోలు చేస్తున్నారు?",
  };
  await sendButtons(from, {
    bodyText: ask[lang] || ask.en,
    buttons: [
      { id: "type_retail",    title: "🛒 Retail (MRP)" },
      { id: "type_wholesale", title: "🏪 Wholesale" },
    ],
  });
}

// ── Add to cart helper ───────────────────────────────────────────────────────
async function addToCart(from, session, productId, qty, lang) {
  const product  = getProductById(productId);
  if (!product) return;
  const cart     = session.cart || [];
  const price    = getPrice(product, session.customerType || "retail");
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.qty      += qty;
    existing.subtotal  = existing.qty * price;
  } else {
    cart.push({ id: productId, emoji: product.emoji, name: product.name[lang]||product.name.en, qty, subtotal: qty * price, price });
  }
  saveSession(from, { cart, state: "browsing", pendingCartProduct: null });
  const total = cart.reduce((s, i) => s + i.subtotal, 0);
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  const added = {
    en: `✅ *Added ${qty} × ${product.name.en}*\n\nCart: ${cart.length} product(s), ${totalItems} units — ₹${total}`,
    hi: `✅ *${qty} × ${product.name.en} add ho gaya*\n\nCart: ${cart.length} product, ${totalItems} units — ₹${total}`,
    ta: `✅ *${qty} × ${product.name.en} சேர்க்கப்பட்டது*\n\nCart: ${cart.length} — ₹${total}`,
    te: `✅ *${qty} × ${product.name.en} జోడించబడింది*\n\nCart: ${cart.length} — ₹${total}`,
  };
  await sendButtons(from, {
    bodyText: added[lang] || added.en,
    buttons: [
      { id: "action_shop",   title: "➕ Add More" },
      { id: "view_cart",     title: `🛒 Cart (${cart.length})` },
      { id: "checkout_cart", title: "✅ Checkout" },
    ],
  });
}

// ── Step 1: Ask payment method FIRST ─────────────────────────────────────────
async function initiateOrder(from, session, productId, qty) {
  const { lang, customerType = "retail" } = session;
  const product  = getProductById(productId);
  if (!product)            { await sendText(from, "Product not found."); return; }
  if (product.stock < qty) { await sendText(from, t(lang, "out_of_stock")); return; }

  const price    = getPrice(product, customerType);
  const subtotal = price * qty;
  const orderId  = generateOrderId();
  const name     = product.name[lang] || product.name.en;
  const cartItem = { id: productId, emoji: product.emoji, name, qty, subtotal, price, customerType };

  saveSession(from, { state: "choosing_payment", cart: [cartItem], pendingOrder: { orderId, cartItem, total: subtotal } });

  const ask = {
    en: "How would you like to pay?",
    hi: "Aap kaise payment karna chahte hain?",
    ta: "நீங்கள் எப்படி பணம் செலுத்த விரும்புகிறீர்கள்?",
    te: "మీరు ఎలా చెల్లించాలనుకుంటున్నారు?",
  };

  await sendButtons(from, {
    bodyText: ask[lang] || ask.en,
    buttons: [
      { id: "pay_upi",    title: "💳 UPI / PhonePe" },
      { id: "pay_cod",    title: "💵 Cash on Delivery" },
      { id: "pay_cancel", title: "❌ Cancel" },
    ],
  });
}

// ── Step 2: After payment chosen → check saved address or ask ────────────────
async function showSummaryThenPay(from, session, paymentMethod) {
  const { lang } = session;
  saveSession(from, { chosenPayment: paymentMethod });

  // Check if user has a saved address
  const savedAddress = getUserAddress(from);

  if (savedAddress) {
    // Ask if they want to use saved address
    saveSession(from, { state: "confirm_saved_address" });
    const ask = {
      en: `📍 *Delivery Address*\n\nUse your saved address?\n*"${savedAddress}"*\n\nReply *YES* to use it or *NO* to enter a new one.`,
      hi: `📍 *Delivery Address*\n\nKya aap apna purana address use karna chahte hain?\n*"${savedAddress}"*\n\n*YES* likhein use karne ke liye ya *NO* naya address ke liye.`,
      ta: `📍 *Delivery Address*\n\nசேமித்த முகவரி பயன்படுத்தவா?\n*"${savedAddress}"*\n\n*YES* அல்லது *NO* அனுப்பவும்.`,
      te: `📍 *Delivery Address*\n\nసేవ్ చేసిన చిరునామా వాడాలా?\n*"${savedAddress}"*\n\n*YES* లేదా *NO* పంపండి.`,
    };
    await sendButtons(from, {
      bodyText: ask[lang] || ask.en,
      buttons: [
        { id: "use_saved_address", title: "✅ Yes, use this" },
        { id: "new_address",       title: "📝 Enter new one" },
      ],
    });
    return;
  }

  // No saved address — ask fresh
  saveSession(from, { state: "awaiting_address" });
  const ask = {
    en: `📍 *Almost there!*\n\nPlease send your *delivery address* (street, area, city).`,
    hi: `📍 *Bas thoda aur!*\n\nApna *delivery address* bhejein (gali, area, shahar).`,
    ta: `📍 *கிட்டத்தட்ட முடிந்தது!*\n\nஉங்கள் *முகவரி* அனுப்பவும் (தெரு, பகுதி, நகரம்).`,
    te: `📍 *దాదాపు అయిపోయింది!*\n\nమీ *డెలివరీ చిరునామా* పంపండి (వీధి, ప్రాంతం, నగరం).`,
  };
  await sendText(from, ask[lang] || ask.en);
}

// ── Step 3: Show final summary + ask CONFIRM ──────────────────────────────────
async function sendFinalConfirmation(from, session) {
  const { lang, pendingOrder, chosenPayment, address } = session;
  if (!pendingOrder) { await sendText(from, "No pending order."); return; }
  const { cartItem, total } = pendingOrder;

  const ptype = session.customerType === "wholesale" ? "🏪 Wholesale" : "🛒 Retail";

  const summary = {
    en: `🧾 *Final Order Summary*
─────────────────────
${cartItem.emoji} *${cartItem.name}*
   Qty: ${cartItem.qty}  |  Price: ₹${cartItem.price} each
   Subtotal: ₹${total}
─────────────────────
💳 Payment: *${chosenPayment}*
🏷️ Type: ${ptype}
📍 Deliver to: ${address}
─────────────────────
Reply *CONFIRM* to place your order
Reply *CANCEL* to cancel`,

    hi: `🧾 *Final Order Summary*
─────────────────────
${cartItem.emoji} *${cartItem.name}*
   Qty: ${cartItem.qty}  |  Price: ₹${cartItem.price} each
   Subtotal: ₹${total}
─────────────────────
💳 Payment: *${chosenPayment}*
🏷️ Type: ${ptype}
📍 Pata: ${address}
─────────────────────
Order karne ke liye *CONFIRM* likhein
Cancel karne ke liye *CANCEL* likhein`,

    ta: `🧾 *இறுதி ஆர்டர் விவரம்*
─────────────────────
${cartItem.emoji} *${cartItem.name}*
   Qty: ${cartItem.qty}  |  விலை: ₹${cartItem.price}
   மொத்தம்: ₹${total}
─────────────────────
💳 கட்டணம்: *${chosenPayment}*
📍 முகவரி: ${address}
─────────────────────
ஆர்டர் செய்ய *CONFIRM* என்று பதில் அளிக்கவும்`,

    te: `🧾 *తుది ఆర్డర్ వివరాలు*
─────────────────────
${cartItem.emoji} *${cartItem.name}*
   Qty: ${cartItem.qty}  |  ధర: ₹${cartItem.price}
   మొత్తం: ₹${total}
─────────────────────
💳 చెల్లింపు: *${chosenPayment}*
📍 చిరునామా: ${address}
─────────────────────
ఆర్డర్ చేయడానికి *CONFIRM* అని రిప్లై చేయండి`,
  };

  saveSession(from, { state: "awaiting_confirm" });
  await sendText(from, summary[lang] || summary.en);
}

// ── Step 4: Place order after CONFIRM ────────────────────────────────────────
async function placeConfirmedOrder(from, session) {
  const { lang, pendingOrder, chosenPayment, address } = session;
  if (!pendingOrder) { await sendText(from, "No pending order."); return; }
  const { orderId, cartItem, total } = pendingOrder;

  const items = pendingOrder.items || [cartItem];
  await saveOrder({
    orderId,
    customerPhone: from,
    items,
    total,
    paymentMethod: chosenPayment,
    address,
    lang,
    customerType: session.customerType || "retail",
  });

  if (chosenPayment === "UPI") {
    saveSession(from, { state: "awaiting_payment" });
    await sendText(from, buildPaymentMessage({ lang, items, total, orderId }));
    // Send QR code if manually configured in Railway env vars
    if (process.env.UPI_QR_IMAGE_URL) {
      const qrCaption = { en: "📱 *Scan to pay instantly*", hi: "📱 *Scan karke pay karein*", ta: "📱 *Scan செய்து pay செய்யவும்*", te: "📱 *Scan చేసి pay చేయండి*" };
      await sendImage(from, process.env.UPI_QR_IMAGE_URL, qrCaption[lang] || qrCaption.en);
    }
  } else {
    // COD — done! Show confirmation like old bot
    saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
    const orderDate = new Date().toLocaleString("en-IN", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const confirmMsg = "🎉 *Thank you for placing your order!* 🎊\n\n" +
      "🛒 *Order Details:*\n" +
      "────────────────────────────────────\n" +
      "*Order ID*: " + orderId + "\n" +
      "*Order Value*: Rs. " + total + "\n" +
      "*Order Date*: " + orderDate + "\n" +
      "*Order Status*: Processing\n\n" +
      "🚚 *Shipment Details:*\n" +
      "────────────────────────────────────\n" +
      "*Address*: " + address + "\n" +
      "*Payment*: " + chosenPayment + "\n\n" +
      "We will update you once the order is shipped.";
    if (process.env.THANKYOU_IMAGE_URL) {
      await sendImage(from, process.env.THANKYOU_IMAGE_URL, "Thank you for shopping with Phasal Bazar! Pure Natural Desi");
    }
    await sendButtons(from, {
      bodyText: confirmMsg,
      buttons: [
        { id: "rate_order", title: "Rate this order" },
        { id: "action_support", title: "Contact support" },
      ],
    });
  }
}

// ── UPI Payment ───────────────────────────────────────────────────────────────
async function handleUPIPayment(from, session) {
  const { lang, pendingOrder } = session;
  if (!pendingOrder) { await sendText(from, "No pending order."); return; }
  const { orderId, cartItem, total } = pendingOrder;
  await saveOrder({ orderId, customerPhone: from, items: [cartItem], total, paymentMethod: "UPI", lang });
  saveSession(from, { state: "awaiting_payment" });
  await sendText(from, buildPaymentMessage({ lang, items: [cartItem], total, orderId }));
  const msg = { en: "📸 Send payment screenshot to confirm your order.", hi: "📸 Screenshot bhejein order confirm karne ke liye.", ta: "📸 Screenshot anupungal.", te: "📸 Screenshot pamandi." };
  await sendText(from, msg[lang] || msg.en);
}

// ── COD Payment ───────────────────────────────────────────────────────────────
async function handleCODPayment(from, session) {
  const { lang, pendingOrder } = session;
  if (!pendingOrder) { await sendText(from, "No pending order."); return; }
  const { orderId, cartItem, total } = pendingOrder;
  await saveOrder({ orderId, customerPhone: from, items: [cartItem], total, paymentMethod: "COD", lang });
  saveSession(from, { state: "idle", cart: [], pendingOrder: null });
  const msg = {
    en: `✅ *Order Confirmed!*\n\nOrder ID: *${orderId}*\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 ₹${total} — Pay on delivery\n\nDelivery in 2-3 days. We'll contact you soon! 🌾`,
    hi: `✅ *Order Confirm!*\n\nOrder ID: *${orderId}*\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 ₹${total} — Delivery par cash\n\n2-3 din mein delivery. Hum jald contact karenge! 🌾`,
    ta: `✅ *ஆர்டர் உறுதி!*\n\nOrder ID: *${orderId}*\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 ₹${total} — டெலிவரியில் பணம்\n\n2-3 நாட்களில் டெலிவரி! 🌾`,
    te: `✅ *ఆర్డర్ నిర్ధారణ!*\n\nOrder ID: *${orderId}*\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 ₹${total} — డెలివరీలో చెల్లింపు\n\n2-3 రోజుల్లో డెలివరీ! 🌾`,
  };
  await sendText(from, msg[lang] || msg.en);
}

// ── Payment screenshot ────────────────────────────────────────────────────────
async function handlePaymentScreenshot(from, session) {
  const { lang, pendingOrder } = session;
  if (session.state !== "awaiting_payment" || !pendingOrder) {
    // Random image sent — ignore silently
    return;
  }
  // Screenshot received — now require PAID confirmation
  saveSession(from, { state: "awaiting_paid_confirm" });
  const msg = {
    en: `📸 *Screenshot received!*\n\nPlease type *PAID* to confirm your payment.\nType *CANCEL* if you want to cancel.`,
    hi: `📸 *Screenshot mil gaya!*\n\nPayment confirm karne ke liye *PAID* likhein.\nCancel karne ke liye *CANCEL* likhein.`,
    ta: `📸 *Screenshot கிடைத்தது!*\n\nஉறுதிப்படுத்த *PAID* என்று அனுப்பவும்.\nரத்து செய்ய *CANCEL* அனுப்பவும்.`,
    te: `📸 *Screenshot వచ్చింది!*\n\nనిర్ధారించడానికి *PAID* అని టైప్ చేయండి.\nరద్దు చేయడానికి *CANCEL* అని టైప్ చేయండి.`,
  };
  await sendText(from, msg[lang] || msg.en);
}

// ── Flow response handler ─────────────────────────────────────────────────────
async function handleFlowResponse(from, session, nfmReply) {
  const { lang = "en" } = session;
  let data = {};
  try { data = JSON.parse(nfmReply.response_json); } catch {}

  console.log("Flow response from", from, ":", data);

  // Shopping flow completed
  if (data.customer_name && data.order_details && data.address) {
    const orderId = generateOrderId();
    const customerType = data.customer_type || "retail";
    const paymentMethod = data.payment_method || "COD";

    // Save order
    await saveOrder({
      orderId,
      customerPhone: from,
      items: [{ name: data.order_details, qty: 1, subtotal: 0, emoji: "🌾" }],
      total: 0,
      paymentMethod,
      address: data.address,
      lang,
      customerType,
    });

    // Save user profile
    saveUser(from, { address: data.address, customerType, lang });

    const msg = {
      en: `✅ *Order Received!*

Order ID: *${orderId}*
Name: ${data.customer_name}
Items: ${data.order_details}
Address: ${data.address}
Payment: ${paymentMethod}

We will confirm your order shortly! 🚚`,
      hi: `✅ *Order Mil Gaya!*

Order ID: *${orderId}*
Naam: ${data.customer_name}
Items: ${data.order_details}
Pata: ${data.address}
Payment: ${paymentMethod}

Hum jaldi confirm karenge! 🚚`,
    };
    await sendText(from, msg[lang] || msg.en);

    if (paymentMethod === "UPI") {
      await sendText(from, buildPaymentMessage({ lang, items: [{ name: data.order_details, qty: 1, subtotal: 0, emoji: "🌾" }], total: 0, orderId }));
    }
    return;
  }

  // Support flow completed
  if (data.message && data.support_type) {
    const msg = {
      en: `✅ Support request received!

Type: ${data.support_type}
Message: ${data.message}

Our team will contact you within 2-4 hours. 📞`,
      hi: `✅ Support request mil gaya!

Hamari team 2-4 ghante mein contact karegi. 📞`,
    };
    await sendText(from, msg[lang] || msg.en);
    return;
  }

  // Generic flow completion
  await sendText(from, lang === "hi" ? "✅ Dhanyavaad! Hum aapko jaldi contact karenge." : "✅ Thank you! We will contact you shortly.");
}

// ── Handle native catalog order (WhatsApp cart → Place order) ────────────────
async function handleCatalogOrder(from, session, order) {
  const { lang = "en" } = session;
  if (!order || !order.product_items) {
    await sendText(from, "Sorry, could not process your order. Please try again.");
    return;
  }

  const items = order.product_items.map(item => ({
    id:       item.product_retailer_id,
    name:     item.product_name || item.product_retailer_id,
    qty:      item.quantity,
    price:    item.item_price,
    subtotal: item.quantity * item.item_price,
    emoji:    "🌾",
  }));

  const total   = items.reduce((s, i) => s + i.subtotal, 0);
  const orderId = generateOrderId();

  // Save to session for address collection
  saveSession(from, {
    state:        "awaiting_address",
    chosenPayment: "COD",
    pendingOrder:  { orderId, items, total, cartItem: items[0] },
  });

  // Show order summary
  const itemsList = items.map(i => `${i.emoji} ${i.name} x${i.qty} = Rs.${i.subtotal.toFixed(2)}`).join("\n");
  const msg = {
    en: `🛒 *Order Received!*

${itemsList}

💰 *Total: ₹${total.toFixed(2)}*

📍 Please send your *delivery address* to confirm the order.`,
    hi: `🛒 *Order Mila!*

${itemsList}

💰 *Total: ₹${total.toFixed(2)}*

📍 Order confirm karne ke liye apna *delivery address* bhejein.`,
    ta: `🛒 *ஆர்டர் கிடைத்தது!*

${itemsList}

💰 *மொத்தம்: ₹${total.toFixed(2)}*

📍 முகவரி அனுப்பவும்.`,
    te: `🛒 *ఆర్డర్ అందింది!*

${itemsList}

💰 *మొత్తం: ₹${total.toFixed(2)}*

📍 డెలివరీ చిరునామా పంపండి.`,
  };
  await sendText(from, msg[lang] || msg.en);
}

// ── Native WhatsApp Cart Order Handler ───────────────────────────────────────
async function handleNativeOrder(from, session, order) {
  const { lang = "en" } = session;
  console.log("Native order received from:", from, JSON.stringify(order));

  if (!order || !order.product_items) {
    await sendText(from, "Order received but no items found. Please try again.");
    return;
  }

  const orderId = generateOrderId();
  const items = order.product_items.map(item => ({
    id:       item.product_retailer_id,
    name:     item.product_retailer_id,
    emoji:    "🌾",
    qty:      item.quantity,
    price:    item.item_price,
    subtotal: item.item_price * item.quantity,
  }));

  const total = items.reduce((s, i) => s + i.subtotal, 0);

  // Save session with pending order — ask for address next
  saveSession(from, {
    state:        "awaiting_address",
    chosenPayment: "COD",
    pendingOrder: { orderId, cartItem: items[0], items, total },
    cart:         items,
  });

  // Save user profile
  saveUser(from, { lang, customerType: session.customerType || "retail" });

  // Show order details exactly like old bot
  const sep = "─────────────────────────────────────────────";
  const itemLines = items.map(function(item, idx) {
    return (idx+1) + ". *Product Name*: " + item.name + ", Qty: x " + item.qty + ", Price: Rs. " + item.price;
  }).join("\n");
  const orderSummary = "🛒 *Your Order Details*\n" + sep + "\n" + itemLines + "\n" + sep + "\n*Grand Total*: Rs. " + total;
  await sendButtons(from, {
    bodyText: orderSummary,
    buttons: [
      { id: "place_cart_order", title: "Place this order" },
      { id: "pay_cancel",       title: "Start a new order" },
    ],
  });
}

app.listen(PORT, () => console.log(`🌾 Phasal Bazar Bot running on port ${PORT}`));