// lib/orders.js — Persistent storage using JSONBin.io (free, survives redeployment)
// Sign up at jsonbin.io → get API key → set JSONBIN_API_KEY in Railway env vars

const https = require("https");

// In-memory fallback (used if JSONBin not configured)
const memOrders = [];

const JSONBIN_KEY  = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN  = process.env.JSONBIN_BIN_ID;

// ── JSONBin helpers ──────────────────────────────────────────────────────────
function jsonbinRequest(method, path, body = null) {
  return new Promise((resolve) => {
    if (!JSONBIN_KEY || !JSONBIN_BIN) { resolve(null); return; }
    const options = {
      hostname: "api.jsonbin.io",
      path,
      method,
      headers: {
        "X-Master-Key": JSONBIN_KEY,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadOrders() {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return memOrders;
  const res = await jsonbinRequest("GET", `/v3/b/${JSONBIN_BIN}/latest`);
  return res?.record?.orders || [];
}

async function saveAllOrders(orders) {
  if (!JSONBIN_KEY || !JSONBIN_BIN) return;
  await jsonbinRequest("PUT", `/v3/b/${JSONBIN_BIN}`, { orders });
}

// ── Public API ───────────────────────────────────────────────────────────────
async function saveOrder({ orderId, customerPhone, items, total, paymentMethod, address, lang, customerType }) {
  const orders = await loadOrders();
  orders.unshift({
    orderId, customerPhone, items, total,
    paymentMethod, address, lang, customerType,
    paymentStatus: paymentMethod === "COD" ? "Pending" : "Awaiting",
    orderStatus:   "pending",
    createdAt:     new Date().toISOString(),
  });
  if (JSONBIN_KEY) await saveAllOrders(orders);
  else memOrders.unshift(orders[0]);
  console.log("✅ Order saved:", orderId);
}

async function updateOrder(orderId, updates) {
  const orders = await loadOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx !== -1) {
    orders[idx] = { ...orders[idx], ...updates };
    if (JSONBIN_KEY) await saveAllOrders(orders);
    else Object.assign(memOrders[memOrders.findIndex(o => o.orderId === orderId)], updates);
  }
}

async function confirmOrder(orderId) { await updateOrder(orderId, { orderStatus: "confirmed", paymentStatus: "Paid" }); }
async function cancelOrder(orderId)  { await updateOrder(orderId, { orderStatus: "cancelled" }); }

async function getAllOrders({ status, search } = {}) {
  let orders = await loadOrders();
  if (status && status !== "all") orders = orders.filter(o => o.orderStatus === status);
  if (search) orders = orders.filter(o =>
    (o.orderId||"").includes(search) || (o.customerPhone||"").includes(search)
  );
  return orders;
}

async function getStats() {
  const orders = await loadOrders();
  const today  = new Date().toISOString().split("T")[0];
  const todayOrders = orders.filter(o => o.createdAt?.startsWith(today));
  return {
    total:        orders.length,
    pending:      orders.filter(o => o.orderStatus === "pending").length,
    confirmed:    orders.filter(o => o.orderStatus === "confirmed").length,
    delivered:    orders.filter(o => o.orderStatus === "delivered").length,
    cancelled:    orders.filter(o => o.orderStatus === "cancelled").length,
    totalRevenue: orders.filter(o => o.orderStatus !== "cancelled").reduce((s,o) => s+(o.total||0), 0),
    todayOrders:  todayOrders.length,
    todayRevenue: todayOrders.reduce((s,o) => s+(o.total||0), 0),
    codOrders:    orders.filter(o => o.paymentMethod === "COD").length,
    upiOrders:    orders.filter(o => o.paymentMethod === "UPI").length,
  };
}

module.exports = { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats };