// lib/orders.js — In-memory storage (persists while server is running)
// Note: orders reset on redeploy — good enough for small client to start

const orders = [];

function saveOrder({ orderId, customerPhone, items, total, paymentMethod, lang }) {
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
  console.log("✅ Order saved:", orderId, "| Total orders:", orders.length);
}

function updateOrder(orderId, updates) {
  const o = orders.find(o => o.orderId === orderId);
  if (o) Object.assign(o, updates);
}

function confirmOrder(orderId) { updateOrder(orderId, { orderStatus: "confirmed", paymentStatus: "Paid" }); }
function cancelOrder(orderId)  { updateOrder(orderId, { orderStatus: "cancelled" }); }

function getAllOrders({ status, search } = {}) {
  let list = [...orders];
  if (status && status !== "all") list = list.filter(o => o.orderStatus === status);
  if (search) list = list.filter(o =>
    (o.orderId || "").includes(search) ||
    (o.customerPhone || "").includes(search)
  );
  return list;
}

function getStats() {
  const today = new Date().toISOString().split("T")[0];
  const todayOrders = orders.filter(o => o.createdAt.startsWith(today));
  return {
    total:        orders.length,
    pending:      orders.filter(o => o.orderStatus === "pending").length,
    confirmed:    orders.filter(o => o.orderStatus === "confirmed").length,
    delivered:    orders.filter(o => o.orderStatus === "delivered").length,
    cancelled:    orders.filter(o => o.orderStatus === "cancelled").length,
    totalRevenue: orders.filter(o => o.orderStatus !== "cancelled").reduce((s, o) => s + (o.total || 0), 0),
    todayOrders:  todayOrders.length,
    todayRevenue: todayOrders.reduce((s, o) => s + (o.total || 0), 0),
    codOrders:    orders.filter(o => o.paymentMethod === "COD").length,
    upiOrders:    orders.filter(o => o.paymentMethod === "UPI").length,
  };
}

module.exports = { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats };