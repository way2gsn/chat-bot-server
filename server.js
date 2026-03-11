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
const { buildPaymentMessage, generateOrderId }      = require("./lib/payment");
const { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats } = require("./lib/orders");
const { markRead, sendText, sendProductCard, sendMainMenu, sendCategoriesMenu, sendProductsMenu, sendButtons, sendListMenu } = require("./lib/whatsapp");

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
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/orders", adminAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    const result = getAllOrders({ status, search });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/admin/orders/:orderId", adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { orderStatus, paymentStatus } = req.body;
    const updates = {};
    if (orderStatus)   updates.orderStatus   = orderStatus;
    if (paymentStatus) updates.paymentStatus = paymentStatus;
    updateOrder(orderId, updates);
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
    if (msgType === "image") { await handlePaymentScreenshot(from, session); return; }
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
    saveSession(from, { address: text.trim() });
    await sendFinalConfirmation(from, { ...session, address: text.trim() });
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

  // ── PRIORITY 2: New customer setup ─────────────────────────────────────────

  if (!session.lang || session.state === "new") {
    saveSession(from, { state: "choosing_lang" });
    await sendLanguageMenu(from);
    return;
  }

  if (!session.customerType || session.state === "choosing_type") {
    await sendCustomerTypeMenu(from, lang);
    return;
  }

  // ── PRIORITY 3: Normal browsing ─────────────────────────────────────────────

  const greetings = ["hi","hello","hey","start","menu","helo","hii"];
  if (greetings.some(g => lower === g || lower.startsWith(g+" ")) || /^[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text)) {
    await sendMainMenu(from, lang, k => t(lang, k));
    saveSession(from, { state: "browsing", messages: [] });
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
    await sendCustomerTypeMenu(from, chosen);
    return;
  }

  const { lang } = session;
  const ui = k => t(lang, k);

  if (replyId === "action_shop" || replyId === "action_categories") {
    await sendCategoriesMenu(from, catalog.categories, lang, ui); return;
  }
  if (replyId === "action_support") { await sendText(from, ui("support_msg")); return; }
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
    await sendButtons(from, {
      bodyText: lang === "hi" ? "Order karna chahte hain?" : "Would you like to order this?",
      buttons: [
        { id: `order_${product.id}_1`, title: "Order 1" },
        { id: `order_${product.id}_2`, title: "Order 2" },
        { id: "action_shop",           title: "Back" },
      ],
    });
    return;
  }

  if (replyId.startsWith("order_")) {
    const p = replyId.split("_");
    await initiateOrder(from, session, p[1], parseInt(p[2]||"1"));
    return;
  }

  // Customer type selection
  if (replyId === "type_retail" || replyId === "type_wholesale") {
    const customerType = replyId === "type_retail" ? "retail" : "wholesale";
    const chosenLang = session.lang || "en";
    saveSession(from, { customerType, state: "browsing" });
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

// ── Step 2: After payment chosen → ask delivery address ──────────────────────
async function showSummaryThenPay(from, session, paymentMethod) {
  const { lang } = session;
  // Save payment method to session
  saveSession(from, { chosenPayment: paymentMethod, state: "awaiting_address" });

  const ask = {
    en: `📍 *Almost there!*\n\nPlease send your *delivery address* so we can deliver your order.`,
    hi: `📍 *Bas thoda aur!*\n\nApna *delivery address* bhejein taaki hum aapka order deliver kar sakein.`,
    ta: `📍 *கிட்டத்தட்ட முடிந்தது!*\n\nடெலிவரிக்காக உங்கள் *முகவரி* அனுப்பவும்.`,
    te: `📍 *దాదాపు అయిపోయింది!*\n\nమీ *డెలివరీ చిరునామా* పంపించండి.`,
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

  await saveOrder({
    orderId,
    customerPhone: from,
    items: [cartItem],
    total,
    paymentMethod: chosenPayment,
    address,
    lang,
    customerType: session.customerType || "retail",
  });

  if (chosenPayment === "UPI") {
    saveSession(from, { state: "awaiting_payment" });
    await sendText(from, buildPaymentMessage({ lang, items: [cartItem], total, orderId }));
    const msg = { en: "📸 Now send the payment screenshot to confirm your order.", hi: "📸 Ab payment screenshot bhejein.", ta: "📸 இப்போது payment screenshot அனுப்பவும்.", te: "📸 ఇప్పుడు payment screenshot పంపండి." };
    await sendText(from, msg[lang] || msg.en);
  } else {
    // COD — done!
    saveSession(from, { state: "idle", cart: [], pendingOrder: null, address: null });
    const msg = {
      en: `✅ *Order Confirmed!*\n\nOrder ID: *${orderId}*\nTotal: ₹${total}\nPayment: Cash on Delivery\nAddress: ${address}\n\nWe will deliver soon! 🚚`,
      hi: `✅ *Order Confirm Ho Gaya!*\n\nOrder ID: *${orderId}*\nTotal: ₹${total}\nPayment: Cash on Delivery\nPata: ${address}\n\nHum jaldi deliver karenge! 🚚`,
      ta: `✅ *ஆர்டர் உறுதிப்பட்டது!*\n\nOrder ID: *${orderId}*\nமொத்தம்: ₹${total}\nDelivery விரைவில் வரும்! 🚚`,
      te: `✅ *ఆర్డర్ నిర్ధారించబడింది!*\n\nOrder ID: *${orderId}*\nమొత్తం: ₹${total}\nDelivery త్వరలో వస్తుంది! 🚚`,
    };
    await sendText(from, msg[lang] || msg.en);
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
  if (session.state === "awaiting_payment" && pendingOrder) {
    await confirmOrder(pendingOrder.orderId);
    const msg = {
      en: `✅ *Payment received!*\nOrder *${pendingOrder.orderId}* confirmed 🎉\nDelivery in 2-3 days. Thank you! 🌾`,
      hi: `✅ *Payment mil gaya!*\nOrder *${pendingOrder.orderId}* confirm 🎉\n2-3 din mein delivery. Dhanyavaad! 🌾`,
      ta: `✅ *பணம் கிடைத்தது!*\nOrder *${pendingOrder.orderId}* உறுதி 🎉\n2-3 நாட்களில் டெலிவரி. நன்றி! 🌾`,
      te: `✅ *చెల్లింపు అందింది!*\nOrder *${pendingOrder.orderId}* నిర్ధారణ 🎉\n2-3 రోజుల్లో డెలివరీ. ధన్యవాదాలు! 🌾`,
    };
    await sendText(from, msg[lang] || msg.en);
    saveSession(from, { state: "idle", cart: [], pendingOrder: null });
  }
}

app.listen(PORT, () => console.log(`🌾 Phasal Bazar Bot running on port ${PORT}`));