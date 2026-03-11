// lib/claude.js — Groq AI (Free Tier)

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
2. When customer asks about products, mention the product ID (e.g. P001) so they can order easily.
3. For ordering: confirm product ID + quantity, then say you'll send payment details.
4. For greetings: just say hi warmly and mention you can help them shop.
5. If asked about delivery: say "We deliver within 2-3 days to your location."
6. If asked something you don't know: say "Let me connect you with our team."
7. Never reveal you are Claude or an AI.

IMPORTANT: The system handles menus, images, and payments separately. 
Just handle natural conversation and questions. Keep it simple and helpful.`;
}

async function getAIReply(session, userMessage) {
  const { lang, messages } = session;

  // Add user message to history
  const updatedMessages = [...messages, { role: "user", content: userMessage }];

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 300,
        temperature: 0.7,
        messages: [
          { role: "system", content: buildSystemPrompt(lang) },
          ...updatedMessages.slice(-12),
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Groq API error");

    const reply = data?.choices?.[0]?.message?.content || "Sorry, no response 🙏";

    return {
      reply,
      updatedMessages: [...updatedMessages, { role: "assistant", content: reply }],
    };
  } catch (err) {
    console.error("Groq API error:", err.message);
    const fallback = {
      en: "Sorry, I'm having a little trouble. Please try again 🙏",
      hi: "क्षमा करें, कुछ गड़बड़ी है। कृपया फिर कोशिश करें 🙏",
      ta: "மன்னிக்கவும், சிறிய பிரச்சனை. மீண்டும் முயற்சிக்கவும் 🙏",
      te: "క్షమించండి, చిన్న సమస్య. మళ్ళీ ప్రయత్నించండి 🙏",
    };
    return {
      reply: fallback[lang] || fallback.en,
      updatedMessages,
    };
  }
}

module.exports = { getAIReply };