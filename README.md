# 🌾 Agri Fresh Store — WhatsApp AI Bot (Production)

**Multilingual • Catalog with Images • UPI Payments • Interactive Menus**

---

## ✅ Features

| Feature | Details |
|---|---|
| 🤖 AI Model | Claude Haiku — reliable, ~$0.001/msg |
| 🌍 Languages | English, Hindi, Tamil, Telugu (auto-detect) |
| 📦 Catalog | Images + price + stock for each product |
| 🎛️ Menus | Native WhatsApp interactive list menus |
| 💳 Payments | UPI deep link (PhonePe, GPay, Paytm) |
| 📸 Orders | Customer sends payment screenshot to confirm |
| ☁️ Hosting | Vercel (free tier) |

---

## 🚀 Deploy in 3 Steps

### Step 1 — Add environment variables to Vercel
```bash
vercel env add ANTHROPIC_API_KEY
vercel env add WHATSAPP_TOKEN
vercel env add WHATSAPP_PHONE_ID
vercel env add VERIFY_TOKEN
```
Select **all 3 environments** (Production, Preview, Development) for each.

### Step 2 — Update client details in lib/catalog.js
```js
store: {
  name:     "Your Client's Store Name",
  upi_id:   "clientupi@ybl",       // ← Client's UPI ID
  upi_name: "Client Name",          // ← Client's name
}
```

### Step 3 — Deploy
```bash
git add .
git commit -m "production bot"
git push origin main
# Vercel auto-deploys on push ✅
```

---

## 📱 Connect to Real WhatsApp

1. Go to **developers.facebook.com** → Your App → WhatsApp → Configuration
2. **Webhook URL**: `https://your-app.vercel.app/webhook`
3. **Verify Token**: same as your `VERIFY_TOKEN` env variable
4. Click **Verify and Save**
5. Subscribe to **messages** field

---

## 🖼️ Adding Real Product Images

In `lib/catalog.js`, replace each `image_url` with a real hosted URL:

```js
image_url: "https://your-cdn.com/muruku.jpg",
```

**Where to host images (free options):**
- **Cloudinary** — free 25GB, best for product photos
- **Firebase Storage** — free 5GB
- **GitHub** — upload to repo, use raw URL

Image requirements for WhatsApp:
- Format: JPG or PNG
- Max size: 5MB
- Min dimensions: 300×300px

---

## 💬 How the Bot Works

```
Customer: "Hi"
→ Bot: Shows main menu (Shop / Categories / Orders / Support)

Customer: Selects "Explore Categories"
→ Bot: Shows category list (Fresh / Grains / Snacks / Pickles)

Customer: Selects "Snacks & Namkeen"
→ Bot: Shows products with prices

Customer: Selects "Muruku"
→ Bot: Sends product image + details + Order button

Customer: Taps "Order 1"
→ Bot: Sends UPI payment link with order summary

Customer: Pays & sends screenshot
→ Bot: Confirms order received
```

---

## 📁 File Structure

```
agri-bot/
├── api/
│   └── webhook.js      ← Main bot logic (Vercel serverless)
├── lib/
│   ├── catalog.js      ← Products, categories, prices, images
│   ├── claude.js       ← Claude Haiku AI integration
│   ├── lang.js         ← Language detection + translations
│   ├── payment.js      ← UPI payment link generator
│   ├── session.js      ← User session management
│   └── whatsapp.js     ← WhatsApp API helpers
├── vercel.json         ← Vercel config
├── package.json
└── .env.example
```

---

## 💰 Monthly Cost Estimate

| Service | Cost |
|---|---|
| Vercel hosting | $0 (free) |
| WhatsApp Cloud API | $0 up to 1000 conversations |
| Claude Haiku AI | ~$0.001 per message |
| **500 customers × 10 msgs** | **~$5/month** |
