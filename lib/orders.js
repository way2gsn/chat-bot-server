// lib/orders.js — Persistent storage using Supabase (PostgreSQL)

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Public API ───────────────────────────────────────────────────────────────
async function saveOrder({ orderId, customerPhone, items, total, paymentMethod, address, lang, customerType }) {
  const { data, error } = await supabase
    .from('orders')
    .insert([{
      order_id: orderId,
      customer_phone: customerPhone,
      items,
      total,
      payment_method: paymentMethod,
      address,
      lang,
      customer_type: customerType,
      payment_status: paymentMethod === 'COD' ? 'Pending' : 'Awaiting',
      order_status: 'pending'
    }]);

  if (error) throw new Error(error.message);
  console.log("✅ Order saved to Supabase:", orderId);
}

async function updateOrder(orderId, updates) {
  const dbUpdates = {};
  if (updates.orderStatus) dbUpdates.order_status = updates.orderStatus;
  if (updates.paymentStatus) dbUpdates.payment_status = updates.paymentStatus;

  const { error } = await supabase
    .from('orders')
    .update(dbUpdates)
    .eq('order_id', orderId);

  if (error) throw new Error(error.message);
}

async function confirmOrder(orderId) { 
  await updateOrder(orderId, { orderStatus: "confirmed", paymentStatus: "Paid" }); 
}

async function cancelOrder(orderId)  { 
  await updateOrder(orderId, { orderStatus: "cancelled" }); 
}

async function getAllOrders({ status, search } = {}) {
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('order_status', status);
  }
  if (search) {
    query = query.or(`order_id.ilike.%${search}%,customer_phone.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Map database snake_case back to camelCase properties expected by frontend
  return data.map(o => ({
    orderId: o.order_id,
    customerPhone: o.customer_phone,
    customerName: o.customer_name,
    items: o.items,
    total: o.total,
    paymentMethod: o.payment_method,
    address: o.address,
    lang: o.lang,
    customerType: o.customer_type,
    paymentStatus: o.payment_status,
    orderStatus: o.order_status,
    createdAt: o.created_at
  }));
}

async function getStats() {
  const orders = await getAllOrders();
  const today  = new Date().toISOString().split("T")[0];
  const todayOrders = orders.filter(o => o.createdAt?.startsWith(today));
  return {
    total:        orders.length,
    pending:      orders.filter(o => o.orderStatus === "pending").length,
    confirmed:    orders.filter(o => o.orderStatus === "confirmed").length,
    delivered:    orders.filter(o => o.orderStatus === "delivered").length,
    cancelled:    orders.filter(o => o.orderStatus === "cancelled").length,
    totalRevenue: orders.filter(o => o.orderStatus !== "cancelled").reduce((s,o) => s+(Number(o.total)||0), 0),
    todayOrders:  todayOrders.length,
    todayRevenue: todayOrders.reduce((s,o) => s+(Number(o.total)||0), 0),
    codOrders:    orders.filter(o => o.paymentMethod === "COD").length,
    upiOrders:    orders.filter(o => o.paymentMethod === "UPI").length,
  };
}

module.exports = { saveOrder, confirmOrder, cancelOrder, updateOrder, getAllOrders, getStats };