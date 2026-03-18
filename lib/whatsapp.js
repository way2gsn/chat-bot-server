// lib/whatsapp.js — WhatsApp Cloud API Helpers (using https module)

const https = require("https");

function httpsPost(hostname, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      port: 443,
      path,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", chunk => { responseData += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          console.error("WhatsApp API error:", res.statusCode, responseData);
        }
        resolve({ status: res.statusCode, body: responseData });
      });
    });

    req.on("error", (err) => {
      console.error("WhatsApp HTTPS error:", err.message);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

async function apiCall(body) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const path    = `/v19.0/${phoneId}/messages`;

  return httpsPost("graph.facebook.com", path, token, {
    messaging_product: "whatsapp",
    ...body,
  });
}

// Mark message as read
async function markRead(messageId) {
  return apiCall({ status: "read", message_id: messageId });
}

// Send plain text
async function sendText(to, text) {
  return apiCall({
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
}

// Send image with caption
async function sendImage(to, imageUrl, caption = "") {
  return apiCall({
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

// Send interactive LIST menu
async function sendListMenu(to, { bodyText, buttonLabel, sections }) {
  // WhatsApp button label max 20 chars, body max 1024 chars
  const safeLabel = (buttonLabel || "View").substring(0, 20);
  const safeBody  = (bodyText || "Select an option").substring(0, 1024);
  // Each row title max 24 chars, description max 72 chars
  const safeSections = sections.map(s => ({
    ...s,
    rows: s.rows.map(r => ({
      ...r,
      title:       (r.title || "").substring(0, 24),
      description: (r.description || "").substring(0, 72),
    })),
  }));
  return apiCall({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: safeBody },
      action: { button: safeLabel, sections: safeSections },
    },
  });
}

// Send interactive BUTTONS (max 3)
async function sendButtons(to, { bodyText, buttons }) {
  return apiCall({
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

// Send product card
async function sendProductCard(to, product, lang = "en", customerType = "retail") {
  const name    = product.name[lang] || product.name.en;
  const desc    = product.desc[lang] || product.desc.en;
  const price   = customerType === "wholesale" ? product.wholesale : product.mrp;
  const priceLabel = customerType === "wholesale"
    ? `💰 Wholesale: ₹${product.wholesale}\n🏷️ MRP: ₹${product.mrp}`
    : `💰 Price: ₹${product.mrp}`;
  const caption = `${product.emoji} *${name}*\n${desc}\n\n${priceLabel}\n📦 Unit: ${product.unit}`;

  if (product.image_url && product.image_url.startsWith("http")) {
    return sendImage(to, product.image_url, caption);
  }
  return sendText(to, caption);
}

// Send main menu
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

// Send categories menu
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

// Send products in a category — max 10 rows per message (WhatsApp hard limit)
async function sendProductsMenu(to, products, lang, categoryName, ui, customerType = "retail") {
  const rows = products.map(p => {
    const price = customerType === "wholesale" ? p.wholesale : p.mrp;
    return {
      id:          `product_${p.id}`,
      title:       `${p.emoji} ${(p.name[lang] || p.name.en).substring(0, 24)}`,
      description: `Rs.${price} / ${p.unit}`,
    };
  });

  // WhatsApp HARD limit: max 10 rows TOTAL per list message
  // Send multiple messages if more than 10 products
  const chunks = [];
  for (let i = 0; i < rows.length; i += 10) {
    chunks.push(rows.slice(i, i + 10));
  }

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? ` (${i+1}/${chunks.length})` : "";
    await sendListMenu(to, {
      bodyText:    `📦 *${categoryName}${part}*\nSelect a product:`,
      buttonLabel: ui("menu_btn"),
      sections: [{
        title: categoryName,
        rows:  chunks[i],
      }],
    });
  }
}

// Send a WhatsApp Flow
async function sendFlow(to, { flowId, headerText, bodyText, footerText, buttonText, screenName = "WELCOME", payload = {} }) {
  return apiCall({
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: headerText || "Phasal Bazar" },
      body:   { text: bodyText || "Shop fresh farm products" },
      footer: { text: footerText || "Pure • Natural • Desi" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token:           `flow_${Date.now()}`,
          flow_id:              flowId,
          flow_cta:             buttonText || "Open Shop 🌾",
          flow_action:          "navigate",
          flow_action_payload:  { screen: screenName, data: payload },
        },
      },
    },
  });
}

module.exports = {
  markRead, sendText, sendImage,
  sendListMenu, sendButtons, sendProductCard,
  sendMainMenu, sendCategoriesMenu, sendProductsMenu,
  sendFlow,
};