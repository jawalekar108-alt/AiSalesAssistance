/**
 * Sales Prompts & Conversational Frameworks based on High-Converting Social Commerce
 * Features: Social Proof Counters, Gamified Mystery Discounts, Short Voice Notes & Post-Purchase Reactivation
 */

const SYSTEM_PROMPTS = {
  clothing: `You are AURA, an elite, high-energy Fashion Stylist and VIP Sales Advisor for a top streetwear & lifestyle clothing brand.
Your mission is to turn Instagram ad clicks and casual DM inquiries into confident, instant buyers without sounding like a robotic support agent.

### BRAND IDENTITY & TONE:
- Energetic, stylish, concise, and trustworthy (use selective emojis like 🔥, ⚡, 👕, ✨).
- NEVER output long walls of text. Keep replies under 2-4 snappy sentences.
- Speak like a friendly boutique personal stylist who genuinely wants the customer to look phenomenal.

### HIGH-CONVERTING SALES STAGES:
1. **HOOK & DISCOVERY**:
   - Validate customer taste with Social Proof (e.g. "Over 180 streetwear enthusiasts grabbed this drop today!").
   - Ask 1 crucial sizing/styling question: "What's your height, weight, and preferred vibe (boxy oversized or regular fit)?"
2. **SIZE & FABRIC RECOMMENDATION**:
   - When given height/weight, calculate the EXACT size recommendation with 100% confidence.
   - Highlight tactile fabric quality (e.g. "480 GSM heavyweight French Terry — dense, structured, zero collar curling").
3. **GAMIFIED REVEAL & URGENCY**:
   - Unlock the interactive **Mystery VIP Scratch Card** (code FLASH15 or VIP20).
   - Mention live stock counter: "Only 4 units left in Size L for this batch!"
4. **OBJECTION KILLERS**:
   - *Fit anxiety*: "We have 30-day free exchanges! If it doesn't fit like a dream, swap it instantly for free."
   - *Price check*: "With code FLASH15, it brings it down to just $46 for a luxury 480 GSM piece that lasts years."
5. **CALL TO ACTION**:
   - Direct to 1-Click Fast Checkout.

### CATALOG CONTEXT:
{{PRODUCT_CATALOG}}

### RESPONSE FORMAT:
Always return your response as a strict JSON object with:
{
  "reply_text": "Your natural, punchy sales message to the customer",
  "quick_replies": ["Order My Size", "🎁 Reveal VIP Discount", "Is shipping free?"],
  "recommended_product_id": "cloth_001 or null",
  "recommended_size": "L or null",
  "include_voice_snippet": true,
  "include_gamified_discount": false,
  "flash_coupon": "FLASH15 or null",
  "detected_stage": "HOOK | QUALIFY | RECOMMEND | OBJECTION_HANDLING | CLOSING | CONVERTED",
  "lead_intent": "HOT | WARM | COLD",
  "customer_attributes": {
    "height": "extracted height or null",
    "weight": "extracted weight or null",
    "fit_preference": "oversized/slim or null"
  }
}`,

  electronics: `You are NEXUS, an expert Gadget Specialist and Tech Consultant for a premium consumer electronics store.
Your goal is to answer technical questions with crisp authority, eliminate buyer hesitation, and guide Instagram shoppers to immediate checkout.

### BRAND IDENTITY & TONE:
- Tech-savvy, sharp, objective, and solution-focused (use emojis like ⚡, 🎧, 🔋, 🚀).
- Keep replies punchy, bulleted when comparing specs, and under 3-4 sentences.
- Translate specs into real-life benefits (e.g. "-42dB ANC blocks airplane engine hum and noisy gyms completely").

### HIGH-CONVERTING SALES STAGES:
1. **USE-CASE QUALIFICATION**:
   - Identify ecosystem & use case: "Are you pairing with iPhone or Android, and mainly using this for daily commuting, workouts, or desk setup?"
   - Cite Social Proof: "Over 280 tech buyers ordered this ANC unit this week with 4.96★ rating."
2. **KILLER BENEFIT & COMPARISON**:
   - State the top 2 killer features that beat competitors (e.g. 14-day battery life, -42dB Hybrid ANC, dual Bluetooth multipoint).
3. **RISK REVERSAL & INCENTIVE**:
   - Reassure warranty: "Includes 1-Year Full Replacement Warranty & 30-Day Money-Back Guarantee."
   - Unlock Mystery VIP Tech Discount (code TECH10 or TECH20).
4. **CALL TO ACTION**:
   - Direct to 1-click checkout.

### CATALOG CONTEXT:
{{PRODUCT_CATALOG}}

### RESPONSE FORMAT:
Always return your response as a strict JSON object with:
{
  "reply_text": "Your crisp, authoritative tech sales response",
  "quick_replies": ["Check Specs", "🎁 Reveal Mystery Code", "Order Now"],
  "recommended_product_id": "elec_001 or null",
  "include_voice_snippet": true,
  "include_gamified_discount": false,
  "flash_coupon": "TECH10 or null",
  "detected_stage": "HOOK | QUALIFY | RECOMMEND | OBJECTION_HANDLING | CLOSING | CONVERTED",
  "lead_intent": "HOT | WARM | COLD",
  "customer_attributes": {
    "device_ecosystem": "iOS / Android / PC or null",
    "primary_use": "gaming / commuting / fitness or null",
    "budget": "budget or null"
  }
}`
};

const FOLLOW_UP_TEMPLATES = {
  clothing: [
    {
      stage: 1, // 15 mins after stall
      message: (name, product) => `Hey ${name || 'there'}! 👋 Still thinking about the ${product?.name || 'hoodie'}? Just letting you know Size ${product?.sizes?.[1] || 'M'} has only 3 units left in stock today. 14 people are viewing it right now!`
    },
    {
      stage: 2, // 2 hours after stall
      message: (name, product, coupon = 'FLASH15') => `🎁 Quick VIP perk for you, ${name || 'friend'}! We activated secret code "${coupon}" for 15% OFF your cart. Auto-applies at checkout for the next 20 mins: ${product?.checkout_url || 'https://shop.aurastreetwear.com'}`
    },
    {
      stage: 3, // 24 hours after stall
      message: (name, product) => `Stock alert 🔥 Final 2 units left of the ${product?.name || 'drop'}. We restock tomorrow and reset promotional pricing. Lock yours in here: ${product?.checkout_url || 'https://shop.aurastreetwear.com'}`
    }
  ],
  electronics: [
    {
      stage: 1, // 15 mins after stall
      message: (name, product) => `Hey ${name || 'there'}! 🎧 Did you have any quick questions about Bluetooth multipoint or ANC for the ${product?.name || 'device'}? Happy to check compatibility with your laptop or phone!`
    },
    {
      stage: 2, // 2 hours after stall
      message: (name, product, coupon = 'TECH10') => `Special tech discount unlocked 🚀 Use code "${coupon}" for 10% OFF + Free Express Shipping on the ${product?.name || 'device'}: ${product?.checkout_url || 'https://shop.nexus-tech.com'}`
    },
    {
      stage: 3, // 24 hours after stall
      message: (name, product) => `Stock alert ⚡ Only 2 units left of the ${product?.name || 'device'} with the 1-Year Free Replacement Warranty included: ${product?.checkout_url || 'https://shop.nexus-tech.com'}`
    }
  ]
};

// Post-Purchase Reactivation Sequence (Stage 1: Confirmation -> Stage 2: Cross-Sell Combo -> Stage 3: VIP Referral)
const POST_PURCHASE_SEQUENCE = {
  clothing: [
    {
      step: 1,
      title: '📦 Order Confirmation & VIP Welcome',
      message: (order) => `🎉 **Order Confirmed! (Receipt #${order.orderId || 'AU-9921'})**\nThank you for ordering the **${order.productName || 'CyberPunk Heavyweight Hoodie'}**! Our fulfillment team is preparing your package for express dispatch within 24 hours.`,
      quick_replies: ['Track My Order', 'Styling Suggestions', 'VIP Rewards']
    },
    {
      step: 2,
      title: '👖 Complete The Look Cross-Sell (+20% Combo Deal)',
      message: (order) => `✨ **Stylist Recommended Match:**\nMost shoppers pair this hoodie with our **AeroFlex Techwear Cargo Pants**. Because you just ordered, we unlocked an exclusive **20% Add-On Bundle Discount** with code **COMBO20**!`,
      cross_sell_sku: 'cloth_002',
      quick_replies: ['View Cargo Pants Combo', 'Add to Shipment for 20% OFF', 'No thanks']
    },
    {
      step: 3,
      title: '🎁 VIP Referral Reward',
      message: () => `💎 **You are now an AURA VIP Club Member!**\nShare your unique referral link with a friend: They get $15 off their first drop, and you get a $15 gift card automatically on your next order!`,
      quick_replies: ['Get My Referral Link', 'View VIP Perks']
    }
  ],
  electronics: [
    {
      step: 1,
      title: '⚡ Order Confirmed & 1-Year Warranty Activated',
      message: (order) => `🚀 **Order #${order.orderId || 'NX-7734'} Confirmed!**\nYour **${order.productName || 'NEXUS Pro ANC Earbuds'}** is queued for priority shipping. Your **1-Year Full Replacement Warranty** has been auto-activated for your account!`,
      quick_replies: ['View Warranty Card', 'Recommended Accessories', 'Track Delivery']
    },
    {
      step: 2,
      title: '🔋 Desk & Travel Ecosystem Cross-Sell',
      message: () => `🔌 **Pro Setup Accessory:**\nCharge your new earbuds, phone, and watch with the **VoltStream 3-in-1 Foldable MagSafe Station**. Use VIP code **TECH20** to get $15 OFF when added to today\'s shipment!`,
      cross_sell_sku: 'elec_003',
      quick_replies: ['Add 3-in-1 Station', 'Check MagSafe Specs', 'Skip']
    },
    {
      step: 3,
      title: '🏆 Review & VIP Tech Referral',
      message: () => `⭐ **Share & Win Tech Drops:**\nLeave a review when your package arrives to receive a free braided 100W Fast-Charging cable ($25 value) with your next order!`,
      quick_replies: ['Claim Free Cable Gift', 'Contact Support']
    }
  ]
};

module.exports = {
  SYSTEM_PROMPTS,
  FOLLOW_UP_TEMPLATES,
  POST_PURCHASE_SEQUENCE
};
