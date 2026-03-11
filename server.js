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
const { catalog, getProductById, getProductsByCategory } = require("./lib/catalog");
const { getSession, saveSession }                   = require("./lib/session");
const { getAIReply }                                = require("./lib/claude");
const { buildPaymentMessage, generateOrderId }      = require("./lib/payment");
const { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats } = require("./lib/orders");
const { markRead, sendText, sendProductCard, sendMainMenu, sendCategoriesMenu, sendProductsMenu, sendButtons } = require("./lib/whatsapp");

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
    res.json(result?.documents || []);
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
    if (msgType === "image") { await handlePaymentScreenshot(from, session); return; }
  } catch (err) { console.error("Webhook error:", err); }
});

// ── Text handler ──────────────────────────────────────────────────────────────
async function handleTextMessage(from, session, text) {
  const lang = detectLanguage(text);
  if (lang !== session.lang) { saveSession(from, { lang }); session.lang = lang; }

  const lower = text.toLowerCase();
  const greetings = ["hi","hello","hey","start","menu"];
  if (greetings.some(g => lower.includes(g)) || /^[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text)) {
    await sendMainMenu(from, lang, k => t(lang, k));
    saveSession(from, { lang, state: "browsing", messages: [] });
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
    await sendProductsMenu(from, products, lang, name, ui);
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

  if (replyId === "pay_upi") {
    await showSummaryThenPay(from, session, "UPI");
    await handleUPIPayment(from, session);
    return;
  }
  if (replyId === "pay_cod") {
    await showSummaryThenPay(from, session, "COD");
    await handleCODPayment(from, session);
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
  const result = await getAllOrders({ search: from });
  const orders = (result?.documents || []).slice(0, 5);
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

// ── Step 1: Ask payment method FIRST ─────────────────────────────────────────
async function initiateOrder(from, session, productId, qty) {
  const { lang } = session;
  const product  = getProductById(productId);
  if (!product)            { await sendText(from, "Product not found."); return; }
  if (product.stock < qty) { await sendText(from, t(lang, "out_of_stock")); return; }

  const subtotal = product.price * qty;
  const orderId  = generateOrderId();
  const name     = product.name[lang] || product.name.en;
  const cartItem = { id: productId, emoji: product.emoji, name, qty, subtotal };

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

// ── Step 2: Show order summary then proceed ───────────────────────────────────
async function showSummaryThenPay(from, session, paymentMethod) {
  const { lang, pendingOrder } = session;
  if (!pendingOrder) { await sendText(from, "No pending order found."); return; }
  const { cartItem, total } = pendingOrder;

  const summary = {
    en: `🧾 *Order Summary*\n─────────────────\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 Total: ₹${total}\n💳 Payment: ${paymentMethod}\n─────────────────`,
    hi: `🧾 *Order Summary*\n─────────────────\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 Total: ₹${total}\n💳 Payment: ${paymentMethod}\n─────────────────`,
    ta: `🧾 *Order Summary*\n─────────────────\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 மொத்தம்: ₹${total}\n💳 Payment: ${paymentMethod}\n─────────────────`,
    te: `🧾 *Order Summary*\n─────────────────\n${cartItem.emoji} ${cartItem.name} × ${cartItem.qty}\n💰 మొత్తం: ₹${total}\n💳 Payment: ${paymentMethod}\n─────────────────`,
  };
  await sendText(from, summary[lang] || summary.en);
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