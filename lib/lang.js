// lib/lang.js — Language detection & UI strings

const SUPPORTED_LANGS = ["en", "hi", "ta", "te"];

// Script detection patterns
const PATTERNS = {
  hi: /[\u0900-\u097F]/,   // Devanagari (Hindi)
  ta: /[\u0B80-\u0BFF]/,   // Tamil
  te: /[\u0C00-\u0C7F]/,   // Telugu
};

function detectLanguage(text) {
  for (const [lang, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(text)) return lang;
  }
  return "en"; // default English
}

// UI strings for each language
const UI = {
  en: {
    welcome:        "Welcome to *Phasal Bazar* 🌾\nFarm fresh products delivered to you!",
    choose:         "How can I help you today?",
    menu_btn:       "View",
    shop:           "🛒 Shop Products",
    shop_desc:      "Browse our fresh catalog",
    categories:     "📦 Explore Categories",
    categories_desc:"Vegetables, Grains, Snacks & more",
    orders:         "📋 My Orders",
    orders_desc:    "View your order history",
    support:        "🙋 Customer Care",
    support_desc:   "Talk to our support team",
    pay_msg:        "Click below to pay via UPI/PhonePe 👇",
    pay_btn:        "💳 Pay Now",
    order_confirm:  "✅ Order confirmed!",
    out_of_stock:   "Sorry, this item is currently out of stock.",
    select_qty:     "How many would you like to order?",
    total:          "Total",
    thank_you:      "Thank you for shopping with us! 🙏",
    support_msg:    "Our team will contact you shortly on this number.",
  },
  hi: {
    welcome:        "Phasal Bazar में आपका स्वागत है 🌾\nखेत से ताजा उत्पाद आपके दरवाजे तक!",
    choose:         "आज हम आपकी कैसे मदद कर सकते हैं?",
    menu_btn:       "देखें",
    shop:           "🛒 प्रोडक्ट खरीदें",
    shop_desc:      "हमारा ताजा कैटलॉग देखें",
    categories:     "📦 कैटेगरी देखें",
    categories_desc:"सब्जियां, अनाज, स्नैक्स और अधिक",
    orders:         "📋 मेरे ऑर्डर",
    orders_desc:    "अपने ऑर्डर इतिहास देखें",
    support:        "🙋 ग्राहक सेवा",
    support_desc:   "हमारी सहायता टीम से बात करें",
    pay_msg:        "UPI/PhonePe से भुगतान करने के लिए नीचे क्लिक करें 👇",
    pay_btn:        "💳 अभी भुगतान करें",
    order_confirm:  "✅ ऑर्डर कन्फर्म हो गया!",
    out_of_stock:   "क्षमा करें, यह आइटम अभी स्टॉक में नहीं है।",
    select_qty:     "आप कितना ऑर्डर करना चाहते हैं?",
    total:          "कुल",
    thank_you:      "हमारे साथ खरीदारी के लिए धन्यवाद! 🙏",
    support_msg:    "हमारी टीम जल्द ही आपसे इस नंबर पर संपर्क करेगी।",
  },
  ta: {
    welcome:        "Phasal Bazar-க்கு வரவேற்கிறோம் 🌾\nபண்ணை புதிதாக, உங்கள் வீட்டிற்கு!",
    choose:         "இன்று நாங்கள் எப்படி உதவலாம்?",
    menu_btn:       "தேர்வு",
    shop:           "🛒 பொருட்கள் வாங்க",
    shop_desc:      "புதிய கேட்டலாக் பார்க்க",
    categories:     "📦 வகைகளை ஆராய",
    categories_desc:"காய்கறிகள், தானியங்கள், சிற்றுண்டிகள்",
    orders:         "📋 என் ஆர்டர்கள்",
    orders_desc:    "ஆர்டர் வரலாறு பார்க்க",
    support:        "🙋 வாடிக்கையாளர் சேவை",
    support_desc:   "எங்கள் குழுவிடம் பேசுங்கள்",
    pay_msg:        "UPI/PhonePe மூலம் பணம் செலுத்த கீழே கிளிக் செய்யவும் 👇",
    pay_btn:        "💳 இப்போது பணம் செலுத்து",
    order_confirm:  "✅ ஆர்டர் உறுதிப்படுத்தப்பட்டது!",
    out_of_stock:   "மன்னிக்கவும், இந்த பொருள் தற்போது இல்லை.",
    select_qty:     "எத்தனை ஆர்டர் செய்ய விரும்புகிறீர்கள்?",
    total:          "மொத்தம்",
    thank_you:      "எங்களுடன் கடை பார்த்ததற்கு நன்றி! 🙏",
    support_msg:    "எங்கள் குழு விரைவில் தொடர்பு கொள்ளும்.",
  },
  te: {
    welcome:        "Phasal Bazar కి స్వాగతం 🌾\nపొలం నుండి తాజాగా మీ ఇంటికి!",
    choose:         "ఈరోజు మేము ఎలా సహాయపడగలం?",
    menu_btn:       "ఎంచుకోండి",
    shop:           "🛒 ఉత్పత్తులు కొనండి",
    shop_desc:      "తాజా కేటలాగ్ చూడండి",
    categories:     "📦 వర్గాలు అన్వేషించండి",
    categories_desc:"కూరగాయలు, ధాన్యాలు, స్నాక్స్",
    orders:         "📋 నా ఆర్డర్లు",
    orders_desc:    "ఆర్డర్ చరిత్ర చూడండి",
    support:        "🙋 కస్టమర్ కేర్",
    support_desc:   "మా బృందంతో మాట్లాడండి",
    pay_msg:        "UPI/PhonePe ద్వారా చెల్లించడానికి క్లిక్ చేయండి 👇",
    pay_btn:        "💳 ఇప్పుడు చెల్లించు",
    order_confirm:  "✅ ఆర్డర్ నిర్ధారించబడింది!",
    out_of_stock:   "క్షమించండి, ఈ వస్తువు ప్రస్తుతం అందుబాటులో లేదు.",
    select_qty:     "మీరు ఎంత ఆర్డర్ చేయాలనుకుంటున్నారు?",
    total:          "మొత్తం",
    thank_you:      "మాతో కొనుగోలు చేసినందుకు ధన్యవాదాలు! 🙏",
    support_msg:    "మా బృందం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది.",
  },
};

function t(lang, key) {
  return (UI[lang] && UI[lang][key]) || UI.en[key] || key;
}

module.exports = { detectLanguage, t, SUPPORTED_LANGS };