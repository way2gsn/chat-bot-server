// lib/catalog.js — Product Catalog
// Replace image_url values with your real hosted image URLs later

const catalog = {
  store: {
    name: "Agri Fresh Store",
    tagline: {
      en: "Farm Fresh, Delivered to You 🌾",
      hi: "खेत से ताजा, आपके दरवाजे तक 🌾",
      ta: "பண்ணை புதிதாக, உங்கள் வீட்டிற்கு 🌾",
      te: "పొలం నుండి తాజాగా, మీ ఇంటికి 🌾",
    },
    upi_id: "yourstore@upi",          // ← Replace with client's UPI ID
    upi_name: "Agri Fresh Store",     // ← Replace with client's name
    currency: "INR",
  },

  categories: [
    { id: "fresh",     emoji: "🥬", name: { en: "Fresh Produce",    hi: "ताजा उत्पाद",       ta: "புதிய விளைபொருட்கள்", te: "తాజా ఉత్పత్తులు" } },
    { id: "grains",    emoji: "🌾", name: { en: "Grains & Pulses",  hi: "अनाज और दालें",    ta: "தானியங்கள்",           te: "ధాన్యాలు మరియు పప్పులు" } },
    { id: "snacks",    emoji: "🍘", name: { en: "Snacks & Namkeen", hi: "स्नैक्स और नमकीन", ta: "சிற்றுண்டிகள்",        te: "స్నాక్స్ మరియు నమ్కీన్" } },
    { id: "pickles",   emoji: "🫙", name: { en: "Pickles & Papad",  hi: "अचार और पापड़",    ta: "ஊறுகாய் மற்றும் பாபட்", te: "పచ్చళ్ళు మరియు పాపడ్" } },
  ],

  products: [
    // ── Fresh Produce ────────────────────────────────────────────────────────
    {
      id: "F001", category: "fresh", emoji: "🥕",
      image_url: "https://your-image-host.com/carrot.jpg",  // ← Replace
      name:  { en: "Fresh Carrots (1kg)",   hi: "ताजी गाजर (1 किग्रा)",   ta: "புதிய கேரட் (1கி.கி)",   te: "తాజా క్యారెట్లు (1కి.గ్రా)" },
      desc:  { en: "Farm-fresh, organic",   hi: "खेत से ताजा, जैविक",      ta: "பண்ணை புதியது, ஜைவம்",   te: "పొలం నుండి తాజా, సేంద్రీయ" },
      price: 40, stock: 100, unit: "kg",
    },
    {
      id: "F002", category: "fresh", emoji: "🍅",
      image_url: "https://your-image-host.com/tomato.jpg",
      name:  { en: "Tomatoes (1kg)",        hi: "टमाटर (1 किग्रा)",        ta: "தக்காளி (1கி.கி)",        te: "టమాటాలు (1కి.గ్రా)" },
      desc:  { en: "Ripe & juicy",          hi: "पके और रसीले",            ta: "பழுத்த & சாறுள்ள",        te: "పండిన మరియు రసకరమైన" },
      price: 30, stock: 150, unit: "kg",
    },
    {
      id: "F003", category: "fresh", emoji: "🧅",
      image_url: "https://your-image-host.com/onion.jpg",
      name:  { en: "Onions (1kg)",          hi: "प्याज (1 किग्रा)",         ta: "வெங்காயம் (1கி.கி)",      te: "ఉల్లిపాయలు (1కి.గ్రా)" },
      desc:  { en: "Premium quality",       hi: "प्रीमियम गुणवत्ता",        ta: "உயர்தர தரம்",             te: "ప్రీమియం నాణ్యత" },
      price: 35, stock: 200, unit: "kg",
    },

    // ── Grains & Pulses ──────────────────────────────────────────────────────
    {
      id: "G001", category: "grains", emoji: "🌾",
      image_url: "https://your-image-host.com/rice.jpg",
      name:  { en: "Basmati Rice (5kg)",    hi: "बासमती चावल (5 किग्रा)",  ta: "பாஸ்மதி அரிசி (5கி.கி)",  te: "బాస్మతి బియ్యం (5కి.గ్రా)" },
      desc:  { en: "Long grain, aromatic",  hi: "लंबे दाने, सुगंधित",       ta: "நீண்ட தானியம், வாசனை",    te: "పొడవాటి ధాన్యం, సువాసన" },
      price: 350, stock: 50, unit: "bag",
    },
    {
      id: "G002", category: "grains", emoji: "🫘",
      image_url: "https://your-image-host.com/toor-dal.jpg",
      name:  { en: "Toor Dal (1kg)",        hi: "तूर दाल (1 किग्रा)",       ta: "துவரம் பருப்பு (1கி.கி)", te: "కందిపప్పు (1కి.గ్రా)" },
      desc:  { en: "Pure & clean",          hi: "शुद्ध और साफ",             ta: "தூய்மையான",               te: "స్వచ్ఛమైన మరియు శుభ్రమైన" },
      price: 120, stock: 80, unit: "kg",
    },

    // ── Snacks & Namkeen ─────────────────────────────────────────────────────
    {
      id: "S001", category: "snacks", emoji: "🍘",
      image_url: "https://your-image-host.com/muruku.jpg",
      name:  { en: "Muruku (250g)",         hi: "मुरुक्कू (250 ग्राम)",     ta: "முறுக்கு (250கி.)",        te: "మురుకు (250గ్రా)" },
      desc:  { en: "Crispy, homemade style",hi: "कुरकुरा, घर जैसा स्वाद",  ta: "மொறுமொறுப்பான, வீட்டு சுவை", te: "క్రిస్పీ, ఇంటి శైలి" },
      price: 80, stock: 60, unit: "pack",
    },
    {
      id: "S002", category: "snacks", emoji: "🌶️",
      image_url: "https://your-image-host.com/namkeen.jpg",
      name:  { en: "Spicy Namkeen (200g)",  hi: "मसालेदार नमकीन (200 ग्राम)", ta: "காரமான நம்கீன் (200கி.)", te: "స్పైసీ నమ్కీన్ (200గ్రా)" },
      desc:  { en: "Crunchy & spicy",       hi: "करारा और मसालेदार",         ta: "மொறுமொறுப்பு & காரம்",    te: "క్రంచీ మరియు మసాలా" },
      price: 60, stock: 80, unit: "pack",
    },
    {
      id: "S003", category: "snacks", emoji: "🫓",
      image_url: "https://your-image-host.com/chakli.jpg",
      name:  { en: "Chakli (200g)",         hi: "चकली (200 ग्राम)",          ta: "சக்லி (200கி.)",           te: "చక్లి (200గ్రా)" },
      desc:  { en: "Traditional recipe",    hi: "पारंपरिक रेसिपी",           ta: "பாரம்பரிய செய்முறை",       te: "సాంప్రదాయ వంటకం" },
      price: 70, stock: 50, unit: "pack",
    },

    // ── Pickles & Papad ──────────────────────────────────────────────────────
    {
      id: "P001", category: "pickles", emoji: "🫙",
      image_url: "https://your-image-host.com/mango-pickle.jpg",
      name:  { en: "Mango Pickle (500g)",   hi: "आम का अचार (500 ग्राम)",   ta: "மாங்காய் ஊறுகாய் (500கி.)", te: "మామిడి పచ్చడి (500గ్రా)" },
      desc:  { en: "Tangy & authentic",     hi: "खट्टा और असली स्वाद",      ta: "புளிப்பான & அசல்",         te: "పులుపుగా మరియు ప్రామాణికమైన" },
      price: 120, stock: 40, unit: "jar",
    },
    {
      id: "P002", category: "pickles", emoji: "🫓",
      image_url: "https://your-image-host.com/papad.jpg",
      name:  { en: "Urad Dal Papad (200g)", hi: "उड़द दाल पापड़ (200 ग्राम)", ta: "உளுந்து பாபட் (200கி.)",   te: "మినప పాపడ్ (200గ్రా)" },
      desc:  { en: "Thin & crispy",         hi: "पतले और कुरकुरे",           ta: "மெல்லிய & மொறுமொறுப்பு",  te: "సన్నగా మరియు క్రిస్పీగా" },
      price: 90, stock: 70, unit: "pack",
    },
    {
      id: "P003", category: "pickles", emoji: "🫙",
      image_url: "https://your-image-host.com/lime-pickle.jpg",
      name:  { en: "Lime Pickle (250g)",    hi: "नींबू का अचार (250 ग्राम)", ta: "எலுமிச்சை ஊறுகாய் (250கி.)", te: "నిమ్మ పచ్చడి (250గ్రా)" },
      desc:  { en: "Spicy & tangy",         hi: "तीखा और खट्टा",             ta: "காரமான & புளிப்பான",       te: "వేడిగా మరియు పులుపుగా" },
      price: 80, stock: 45, unit: "jar",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getProductById(id) {
  return catalog.products.find(p => p.id === id) || null;
}

function getProductsByCategory(categoryId) {
  return catalog.products.filter(p => p.category === categoryId);
}

function getCatalogText(lang = "en") {
  const lines = [];
  catalog.categories.forEach(cat => {
    lines.push(`\n${cat.emoji} ${cat.name[lang] || cat.name.en}:`);
    getProductsByCategory(cat.id).forEach(p => {
      lines.push(`  [${p.id}] ${p.emoji} ${p.name[lang] || p.name.en} — ₹${p.price}/${p.unit} (${p.stock} in stock)`);
      lines.push(`       ${p.desc[lang] || p.desc.en}`);
    });
  });
  return lines.join("\n");
}

module.exports = { catalog, getProductById, getProductsByCategory, getCatalogText };
