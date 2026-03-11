// lib/claude.js — Groq AI using native https module

const https = require("https");
const { getCatalogText } = require("./catalog");

function buildSystemPrompt(lang) {
  return `You are a friendly WhatsApp shopping assistant for "Agri Fresh Store" — an Indian agriculture and food products business selling fresh vegetables, grains, snacks (muruku, chakli, namkeen), pickles, and papad.

CATALOG:
${getCatalogText(lang)}

LANGUAGE RULES:
- Current customer language: ${lang}
- en = English, hi = Hindi, ta = Tamil, te = Telugu
- Reply ONLY in the customer's language. Never mix languages.
- Use natural, warm, conversational tone.

BEHAVIOR:
1. Keep replies SHORT — max 4 lines. Use emojis naturally.
2. When customer asks about products, mention the product ID (e.g. P001).
3. For ordering: confirm product ID + quantity, then say payment details will be sent.
4. For greetings: say hi warmly and offer to help shop.
5. Delivery: "We deliver within 2-3 days to your location."
6. Unknown queries: "Let me connect you with our team."
7. Never reveal you are an AI.`;
}

function httpsPost(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: "api.groq.com",
      port: 443,
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", chunk => { responseData += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(responseData)); }
        catch (e) { reject(new Error("Failed to parse Groq response")); }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getAIReply(session, userMessage) {
  const { lang, messages } = session;
  const updatedMessages = [...messages, { role: "user", content: userMessage }];

  try {
    const data = await httpsPost({
      model: "llama-3.1-8b-instant",
      max_tokens: 300,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildSystemPrompt(lang) },
        ...updatedMessages.slice(-12),
      ],
    });

    const reply = data?.choices?.[0]?.message?.content || "Sorry, no response 🙏";
    return {
      reply,
      updatedMessages: [...updatedMessages, { role: "assistant", content: reply }],
    };

  } catch (err) {
    console.error("Groq API error:", err.message);
    const fallback = {
      en: "Sorry, having a little trouble. Please try again 🙏",
      hi: "Kshama karein, thodi dikkat hai. Phir koshish karein 🙏",
      ta: "Mannikkavum, sinna prachanai. Meedum muyarchikkavum 🙏",
      te: "Kshaminchamdi, chinna samasya. Marchesi prayantninchamdi 🙏",
    };
    return {
      reply: fallback[lang] || fallback.en,
      updatedMessages,
    };
  }
}

module.exports = { getAIReply };