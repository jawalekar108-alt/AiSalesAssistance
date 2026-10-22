const axios = require('axios');

class GeminiClient {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  hasApiKey() {
    return !!(this.apiKey && this.apiKey.trim().length > 5);
  }

  /**
   * Main generation method for sales conversations
   */
  async generateSalesResponse(systemPrompt, conversationHistory, latestUserMessage, catalogContext) {
    const populatedSystemPrompt = systemPrompt.replace('{{PRODUCT_CATALOG}}', JSON.stringify(catalogContext, null, 2));

    // If no API key is provided, use our intelligent local rule-based sales engine
    if (!this.hasApiKey()) {
      return this.generateMockSalesResponse(conversationHistory, latestUserMessage, catalogContext);
    }

    try {
      const contents = [];

      // Convert conversation history into Gemini format
      conversationHistory.slice(-8).forEach(msg => {
        contents.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text) }]
        });
      });

      // Add the latest message if not already present
      if (!contents.length || contents[contents.length - 1].role !== 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: latestUserMessage }]
        });
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      
      const payload = {
        system_instruction: {
          parts: [{ text: populatedSystemPrompt }]
        },
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 800,
          responseMimeType: 'application/json'
        }
      };

      const response = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000
      });

      const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidate) {
        throw new Error('Empty response from Gemini API');
      }

      try {
        const parsed = JSON.parse(candidate);
        return parsed;
      } catch (jsonErr) {
        // In case of extra formatting or markdown code blocks
        const cleaned = candidate.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
      }
    } catch (err) {
      console.warn('[Gemini] API error or rate limit hit, falling back to smart sales engine:', err.response?.data || err.message);
      return this.generateMockSalesResponse(conversationHistory, latestUserMessage, catalogContext);
    }
  }

  /**
   * High-converting Smart Rule-Based Engine (Fallback / Zero-Key Simulator Mode)
   */
  generateMockSalesResponse(history, userText, catalog) {
    const text = (userText || '').toLowerCase();
    const isClothing = catalog && catalog[0] && catalog[0].store_type === 'clothing';
    const primaryProduct = catalog && catalog[0] ? catalog[0] : null;

    if (isClothing) {
      // Clothing Sizing logic
      if (text.includes('5\'') || text.includes('cm') || text.includes('lbs') || text.includes('kg') || text.includes('size') || text.includes('fit') || text.includes('tall') || text.includes('weight')) {
        let recSize = 'L';
        if (text.includes('5\'7') || text.includes('5\'8') || text.includes('160') || text.includes('150') || text.includes('140')) recSize = 'M';
        if (text.includes('5\'5') || text.includes('5\'6') || text.includes('130') || text.includes('120')) recSize = 'S';
        if (text.includes('6\'') || text.includes('190') || text.includes('200')) recSize = 'XL';

        return {
          reply_text: `For your build, **Size ${recSize}** will give you that perfect boxy streetwear drape! 🔥 It's tailored from 480 GSM French Terry so the shoulders and hood keep their structure without sagging.`,
          quick_replies: [`Order Size ${recSize} Now`, "Is shipping free?", "Claim 15% OFF"],
          recommended_product_id: primaryProduct ? primaryProduct.id : 'cloth_001',
          recommended_size: recSize,
          flash_coupon: 'FLASH15',
          detected_stage: 'RECOMMEND',
          lead_intent: 'HOT',
          customer_attributes: { fit_preference: 'boxy oversized', recommended_size: recSize }
        };
      }

      // Price / discount inquiry
      if (text.includes('price') || text.includes('discount') || text.includes('promo') || text.includes('coupon') || text.includes('how much') || text.includes('cost') || text.includes('sale')) {
        return {
          reply_text: `Right now the **${primaryProduct.name}** is on flash promo for only $${primaryProduct.price} (down from $${primaryProduct.original_price})! ⚡ Plus, I just unlocked secret VIP code **FLASH15** for an extra 15% OFF!`,
          quick_replies: ["Apply FLASH15 & Checkout", "What's the sizing like?", "Available colors"],
          recommended_product_id: primaryProduct ? primaryProduct.id : 'cloth_001',
          flash_coupon: 'FLASH15',
          detected_stage: 'OBJECTION_HANDLING',
          lead_intent: 'HOT',
          customer_attributes: {}
        };
      }

      // Default Greeting / Ad Referral
      return {
        reply_text: `Hey! Thanks for tapping on our Instagram drop! 🔥 The **${primaryProduct.name}** is our #1 best-seller this week. To make sure you get the perfect fit, what's your height and weight?`,
        quick_replies: ["5'10, 165 lbs (M/L)", "6'1, 190 lbs (XL)", "See Size Chart", "Check Flash Price"],
        recommended_product_id: primaryProduct ? primaryProduct.id : 'cloth_001',
        flash_coupon: 'FLASH15',
        detected_stage: 'HOOK',
        lead_intent: 'WARM',
        customer_attributes: {}
      };
    } else {
      // Electronics logic
      if (text.includes('battery') || text.includes('charge') || text.includes('hours') || text.includes('life')) {
        return {
          reply_text: `⚡ Battery life is huge: you get **9 continuous hours** on a single charge and **42 hours total** with the wireless charging case! A quick 10-minute USB-C charge gives you 3 hours of listening.`,
          quick_replies: ["Claim 10% Discount", "Does it work with iPhone?", "Get Checkout Link"],
          recommended_product_id: primaryProduct ? primaryProduct.id : 'elec_001',
          flash_coupon: 'TECH10',
          detected_stage: 'QUALIFY',
          lead_intent: 'HOT',
          customer_attributes: { priority: 'battery life' }
        };
      }

      if (text.includes('iphone') || text.includes('android') || text.includes('mac') || text.includes('pc') || text.includes('compatible') || text.includes('bluetooth') || text.includes('connect')) {
        return {
          reply_text: `100% plug-and-play with all iPhones, Androids, MacBooks & Windows PCs! 🚀 Plus it has **Dual-Device Multipoint Switching** so you can take calls on your phone while watching videos on your laptop.`,
          quick_replies: ["Order with TECH10 Code", "What about warranty?", "Check ANC Specs"],
          recommended_product_id: primaryProduct ? primaryProduct.id : 'elec_001',
          flash_coupon: 'TECH10',
          detected_stage: 'OBJECTION_HANDLING',
          lead_intent: 'HOT',
          customer_attributes: { ecosystem: 'cross-platform' }
        };
      }

      if (text.includes('price') || text.includes('cost') || text.includes('coupon') || text.includes('deal') || text.includes('discount')) {
        return {
          reply_text: `The **${primaryProduct.name}** is on sale for **$${primaryProduct.price}** (regularly $${primaryProduct.original_price})! 🎧 Use VIP promo code **TECH10** right now for an extra 10% OFF + Free Express Shipping!`,
          quick_replies: ["Buy with TECH10 Code", "Check Warranty", "Compare with AirPods"],
          recommended_product_id: primaryProduct ? primaryProduct.id : 'elec_001',
          flash_coupon: 'TECH10',
          detected_stage: 'CLOSING',
          lead_intent: 'HOT',
          customer_attributes: {}
        };
      }

      // Default Greeting
      return {
        reply_text: `Hey! Thanks for checking out our tech drop! 🎧 The **${primaryProduct.name}** features -42dB Hybrid ANC and 42-hour battery life. Are you pairing this with an iPhone or Android?`,
        quick_replies: ["Apple iPhone / Mac", "Android / Windows", "Check Specs", "Claim 10% Promo"],
        recommended_product_id: primaryProduct ? primaryProduct.id : 'elec_001',
        flash_coupon: 'TECH10',
        detected_stage: 'HOOK',
        lead_intent: 'WARM',
        customer_attributes: {}
      };
    }
  }
}

module.exports = new GeminiClient();
