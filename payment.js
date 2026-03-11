// lib/payment.js — UPI / PhonePe Payment Link Generator

const { catalog } = require("./catalog");

/**
 * Generates a UPI deep link that opens PhonePe, GPay, Paytm etc.
 * Works on any UPI-enabled app on the customer's phone.
 */
function generateUPILink({ amount, orderId, note }) {
  const { upi_id, upi_name } = catalog.store;

  const params = new URLSearchParams({
    pa: upi_id,                          // Payee UPI ID
    pn: upi_name,                        // Payee name
    am: amount.toFixed(2),               // Amount
    cu: "INR",                           // Currency
    tn: note || `Order-${orderId}`,      // Transaction note
    tr: orderId,                         // Transaction reference
  });

  return `upi://pay?${params.toString()}`;
}

/**
 * Generates a PhonePe-specific payment link (web fallback)
 * Customers can also just tap the UPI link — it opens their preferred app
 */
function generatePhonePeLink({ amount, orderId, note }) {
  // PhonePe uses standard UPI deep links
  // For web fallback, use this format:
  const upiLink = generateUPILink({ amount, orderId, note });

  // Encode for web
  const encoded = encodeURIComponent(upiLink);
  return `https://phpe.app.link/pay?url=${encoded}`;
}

/**
 * Build the full payment message to send to the customer
 */
function buildPaymentMessage({ lang, items, total, orderId }) {
  const lines = [];

  lines.push(`🧾 *Order Summary #${orderId}*`);
  lines.push("─────────────────");
  items.forEach(item => {
    lines.push(`${item.emoji} ${item.name} × ${item.qty} = ₹${item.subtotal}`);
  });
  lines.push("─────────────────");
  lines.push(`💰 *Total: ₹${total}*`);
  lines.push("");
  lines.push("📲 *Pay via UPI / PhonePe / GPay / Paytm:*");

  const upiLink = generateUPILink({ amount: total, orderId });
  lines.push(upiLink);
  lines.push("");
  lines.push(`🏦 UPI ID: *${catalog.store.upi_id}*`);
  lines.push(`👤 Name: *${catalog.store.upi_name}*`);
  lines.push("");
  lines.push("✅ After payment, send screenshot here to confirm your order.");

  return lines.join("\n");
}

/**
 * Generate a simple order ID
 */
function generateOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `AGF-${timestamp}-${random}`;
}

module.exports = { generateUPILink, generatePhonePeLink, buildPaymentMessage, generateOrderId };
