# 🚀 24/7 AI Sales Bot for Clothing & Electronics (Zero-Cost Commerce)

An autonomous 24/7 social commerce sales bot modeled after **Chinese live-commerce conversational psychology** (Douyin / Taobao AI live-selling formulas). Converts Instagram Ad traffic (Click-to-Instagram Direct Ads) and organic DM inquiries into paying customers with **$0 operating costs (no credit card required anywhere)**.

---

## 🌟 Key Features

1. **Industry-Specific AI Sales Engines**:
   - 👗 **Clothing & Fashion**: Height/weight sizing calculator, fabric weight (e.g. 480 GSM heavy French Terry), fit preference styling, and 30-day exchange reassurance.
   - ⚡ **Consumer Electronics**: Use-case matching (iOS/Android/PC), technical spec comparisons (-42dB ANC, 14-day battery, multipoint pairing), and 1-year replacement warranty objection killing.
2. **Chinese Conversational Commerce Psychology**:
   - Proactive selling: `Hook -> Qualification -> Value Pitch -> Objection Handling -> 1-Click Closing`.
   - Micro-Urgency: Flash promo codes (`FLASH15`, `TECH10`) with countdown timers and low-stock indicators.
   - Frictionless Checkout: 1-click buy links with pre-applied discounts and selected sizes.
3. **Automated 24/7 Follow-Up Engine**:
   - Re-engages stalled or abandoned DMs automatically:
     - **+15 mins**: Size/compatibility reassurance check.
     - **+2 hours**: Secret VIP flash promo code drop.
     - **+24 hours**: Final stock alert before price resets.
4. **Interactive Glassmorphism Studio Dashboard**:
   - Real-time Instagram DM emulator.
   - Live Sales Psychology inspector and Lead Intent tracker (`HOT`, `WARM`, `COLD`).
   - Sizing & Specs Catalog manager.
   - Leads CRM and pipeline conversion analytics.
5. **100% Free / \$0 Run Cost**:
   - Free LLM: **Google Gemini 2.0 / 1.5 Flash** (Google AI Studio - 0 credit card needed).
   - Free Database: Self-contained embedded SQLite JSON engine.
   - Free Webhooks: Meta for Developers Standard Graph API + Cloudflare Tunnel / Localtunnel.

---

## 🚀 Quick Start Guide

### 1. Start the Server
```bash
cd C:\Users\Avinash\.gemini\antigravity\scratch\ai-sales-bot
npm start
```

### 2. Open the Studio Dashboard
Open your browser to: **[http://localhost:3000](http://localhost:3000)**

---

## 🔑 How to Add Your Free Gemini Key (0 Cards Required)

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Sign in with any standard Google account.
3. Click **"Get API Key"** and create your free key (no credit card or billing information is ever requested).
4. Either:
   - Paste it in `.env`: `GEMINI_API_KEY=AIzaSy...`
   - Or paste it directly in the **"$0 Setup & Webhooks"** tab in the web dashboard for instant activation.

---

## 📡 Connecting to Live Instagram DMs

### Step 1: Create a Public HTTPS Webhook URL (Free)
Run Cloudflare Tunnel or Localtunnel in your terminal:
```bash
npx cloudflared tunnel --url http://localhost:3000
```
*Output: `https://xxxx.trycloudflare.com`*

### Step 2: Configure Meta for Developers
1. Go to [Meta for Developers](https://developers.facebook.com/) and create a free App.
2. Under **Instagram Graph API -> Webhooks**:
   - **Callback URL**: `https://xxxx.trycloudflare.com/webhook`
   - **Verify Token**: `ai_sales_bot_secret_token_2026` (configured in `.env`)
3. Subscribe to: `messages`, `messaging_postbacks`, `messaging_referrals`.
4. In your `.env` file, set `META_PAGE_ACCESS_TOKEN=your_token_here`.

---

## 📁 Project Architecture

```
ai-sales-bot/
├── .env                        # Environment configuration
├── .env.example                # Template
├── package.json                # Project dependencies
├── server.js                   # Express server & API gateway
├── test_sales_bot.js           # Automated verification test suite
├── data/
│   └── sales_bot_db.json       # Self-contained database storage
├── src/
│   ├── config/
│   │   └── database.js         # SQLite/JSON persistence layer
│   ├── engine/
│   │   ├── gemini.js           # Google Gemini 2.0 Flash AI client
│   │   ├── salesPrompts.js     # Fashion & Tech conversational sales prompts
│   │   ├── conversationFlow.js # Sales state-machine & lead capture
│   │   └── followUpWorker.js   # 24/7 background follow-up scheduler
│   ├── routes/
│   │   ├── webhook.js          # Meta / Instagram Graph API webhook
│   │   ├── catalog.js          # Product management API
│   │   ├── leads.js            # Leads CRM & analytics API
│   │   └── simulator.js        # Simulator & config API
│   └── public/
│       ├── index.html          # Web Studio UI
│       ├── css/style.css       # Glassmorphism dark mode styling
│       └── js/
│           ├── simulator.js    # Live Instagram DM simulator
│           ├── catalog.js      # Product catalog manager
│           └── analytics.js    # CRM pipeline analytics
```
