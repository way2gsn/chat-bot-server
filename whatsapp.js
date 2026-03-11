// lib/whatsapp.js — WhatsApp Cloud API Helpers

const BASE_URL = `https://graph.facebook.com/v19.0`;

async function apiCall(endpoint, body) {
  const res = await fetch(`${BASE_URL}/${process.env.WHATSAPP_PHONE_ID}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const err = await res.json();
    console.error("WhatsApp API error:", JSON.stringify(err));
  }
  return res;
}

// ── Mark message as read ──────────────────────────────────────────────────────
async function markRead(messageId) {
  return apiCall("messages", { status: "read", message_id: messageId });
}

// ── Send plain text ───────────────────────────────────────────────────────────
async function sendText(to, text) {
  return apiCall("messages", {
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
}

// ── Send image with caption ───────────────────────────────────────────────────
async function sendImage(to, imageUrl, caption = "") {
  return apiCall("messages", {
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

// ── Send interactive LIST menu (like Phasal Bazar screenshot) ─────────────────
async function sendListMenu(to, { bodyText, buttonLabel, sections }) {
  return apiCall("messages", {
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections,            // [{ title, rows: [{ id, title, description }] }]
      },
    },
  });
}

// ── Send interactive BUTTONS (max 3 buttons) ──────────────────────────────────
async function sendButtons(to, { bodyText, buttons }) {
  return apiCall("messages", {
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type: "reply",
          reply: { id: b.id, title: b.title.substring(0, 20) },
        })),
      },
    },
  });
}

// ── Send product image + details as a formatted message ───────────────────────
async function sendProductCard(to, product, lang = "en") {
  const name  = product.name[lang]  || product.name.en;
  const desc  = product.desc[lang]  || product.desc.en;
  const caption = `${product.emoji} *${name}*\n${desc}\n\n💰 ₹${product.price}/${product.unit}\n📦 Stock: ${product.stock} available\n\nReply with: *ORDER ${product.id}* to buy`;

  if (product.image_url && !product.image_url.includes("your-image-host")) {
    await sendImage(to, product.image_url, caption);
  } else {
    await sendText(to, caption);
  }
}

// ── Send main menu ────────────────────────────────────────────────────────────
async function sendMainMenu(to, lang, ui) {
  return sendListMenu(to, {
    bodyText:    `${ui("welcome")}\n\n${ui("choose")}`,
    buttonLabel: ui("menu_btn"),
    sections: [{
      title: "Menu",
      rows: [
        { id: "action_shop",       title: ui("shop"),       description: ui("shop_desc") },
        { id: "action_categories", title: ui("categories"), description: ui("categories_desc") },
        { id: "action_orders",     title: ui("orders"),     description: ui("orders_desc") },
        { id: "action_support",    title: ui("support"),    description: ui("support_desc") },
      ],
    }],
  });
}

// ── Send categories menu ──────────────────────────────────────────────────────
async function sendCategoriesMenu(to, categories, lang, ui) {
  return sendListMenu(to, {
    bodyText:    ui("categories"),
    buttonLabel: ui("menu_btn"),
    sections: [{
      title: ui("categories"),
      rows: categories.map(cat => ({
        id:          `cat_${cat.id}`,
        title:       `${cat.emoji} ${cat.name[lang] || cat.name.en}`,
        description: "",
      })),
    }],
  });
}

// ── Send products in a category ───────────────────────────────────────────────
async function sendProductsMenu(to, products, lang, categoryName, ui) {
  return sendListMenu(to, {
    bodyText:    `📦 *${categoryName}*\nSelect a product to see details:`,
    buttonLabel: ui("menu_btn"),
    sections: [{
      title: categoryName,
      rows: products.map(p => ({
        id:          `product_${p.id}`,
        title:       `${p.emoji} ${p.name[lang] || p.name.en}`,
        description: `₹${p.price}/${p.unit}`,
      })),
    }],
  });
}

module.exports = {
  markRead,
  sendText,
  sendImage,
  sendListMenu,
  sendButtons,
  sendProductCard,
  sendMainMenu,
  sendCategoriesMenu,
  sendProductsMenu,
};
