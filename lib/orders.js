// lib/orders.js — Simple file-based storage (persists on Railway)

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../orders.json");

function readOrders() {
  try {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return []; }
}

function writeOrders(orders) {
  fs.writeFileSync(FILE, JSON.stringify(orders, null, 2));
}

function saveOrder({ orderId, customerPhone, items, total, paymentMethod, lang }) {
  const orders = readOrders();
  orders.unshift({
    orderId,
    customerPhone,
    items,
    total,
    paymentMethod,
    paymentStatus: paymentMethod === "COD" ? "Pending" : "Awaiting",
    orderStatus:   "pending",
    lang,
    createdAt: new Date().toISOString(),
  });
  writeOrders(orders);
  console.log("✅ Order saved:", orderId);
}

function updateOrder(orderId, updates) {
  const orders = readOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx !== -1) { orders[idx] = { ...orders[idx], ...updates }; writeOrders(orders); }
}

function confirmOrder(orderId) { updateOrder(orderId, { orderStatus: "confirmed", paymentStatus: "Paid" }); }
function cancelOrder(orderId)  { updateOrder(orderId, { orderStatus: "cancelled" }); }

function getAllOrders({ status, search } = {}) {
  let orders = readOrders();
  if (status && status !== "all") orders = orders.filter(o => o.orderStatus === status);
  if (search) orders = orders.filter(o => o.orderId.includes(search) || o.customerPhone.includes(search));
  return orders;
}

function getStats() {
  const orders = readOrders();
  const today  = new Date().toISOString().split("T")[0];
  const todayOrders = orders.filter(o => o.createdAt.startsWith(today));
  return {
    total:        orders.length,
    pending:      orders.filter(o => o.orderStatus === "pending").length,
    confirmed:    orders.filter(o => o.orderStatus === "confirmed").length,
    delivered:    orders.filter(o => o.orderStatus === "delivered").length,
    cancelled:    orders.filter(o => o.orderStatus === "cancelled").length,
    totalRevenue: orders.filter(o => o.orderStatus !== "cancelled").reduce((s,o) => s + o.total, 0),
    todayOrders:  todayOrders.length,
    todayRevenue: todayOrders.reduce((s,o) => s + o.total, 0),
    codOrders:    orders.filter(o => o.paymentMethod === "COD").length,
    upiOrders:    orders.filter(o => o.paymentMethod === "UPI").length,
  };
}

module.exports = { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats };