//21/10

const axios = require('axios');
const db = require('../config/database');

/* ============================================================
 * CONFIG
 * ============================================================ */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
// If Gemini is slow, answer with the built-in reply instead of making the customer wait
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 12000;

/* ============================================================
 * MAIN MESSAGE HANDLER
 * storeId = tenant. If missing it falls back to storeType (old behaviour).
 * ============================================================ */

async function handleMessage({
  sessionId,
  userText,
  storeType = 'clothing',
  storeId = null,
  platform = 'simulator',
  metadata = {}
}) {
  const tenantId = storeId || storeType;

  const conversation = db.getOrCreateConversation(
    sessionId,
    storeType,
    platform,
    metadata,
    tenantId
  );

  // Save customer message
  db.addMessage(sessionId, 'customer', userText);

  // Products of THIS tenant only
  let products = findRelevantProducts(userText, tenantId);

  // A comment is about ONE post: the product of that post always comes first
  const postProduct = metadata.instagram_media_id ? db.getProductByInstagramId(metadata.instagram_media_id) : null;

  if (postProduct && String(postProduct.store_id || postProduct.store_type) === String(tenantId)) {
    products = [postProduct, ...products.filter(item => item.id !== postProduct.id)];
  }

  // "send me the photo / full image" -> answer straight away (no slow AI call) and let the webhook send the picture
  const wantsImage = detectImageRequest(userText);

  if (products.length > 0) {
    db.updateConversation(sessionId, { interested_product_id: products[0].id });
  }

  // Generate answer
  let answer;

  if (wantsImage && products.length) {
    answer = generateImageResponse(products[0]);
  } else if (GEMINI_API_KEY) {
    try {
      answer = await generateGeminiResponse({
        userText,
        conversation,
        products,
        platform,
        tenantId
      });
    } catch (error) {
      console.error('[AI] Gemini failed:', error.response?.data || error.message);
      answer = generateLocalSalesResponse(userText, products, conversation, platform);
    }
  } else {
    answer = generateLocalSalesResponse(userText, products, conversation, platform);
  }

  const productCards = products.slice(0, 3).map(createProductCard);
  const quickReplies = createQuickReplies(userText, products);

  const message = db.addMessage(sessionId, 'bot', answer, {
    quick_replies: quickReplies,
    product_cards: productCards
  });

  updateLead(sessionId, userText, products, conversation);

  return {
    success: true,
    message: { text: answer, quick_replies: quickReplies, product_cards: productCards, wants_image: Boolean(wantsImage && products.length) },
    conversation,
    saved_message: message
  };
}

/* ============================================================
 * AD REFERRAL
 * ============================================================ */

async function handleAdReferral({
  sessionId,
  storeType = 'clothing',
  storeId = null,
  adCampaignId = 'instagram_ad',
  adName = 'Instagram Product',
  platform = 'instagram_dm'
}) {
  const tenantId = storeId || storeType;

  const product = db.findProductByAdTrigger(tenantId, adName);

  const conversation = db.getOrCreateConversation(
    sessionId,
    storeType,
    platform,
    { ad_campaign_id: adCampaignId, interested_product_id: product?.id || null },
    tenantId
  );

  db.updateConversation(sessionId, {
    ad_campaign_id: adCampaignId,
    interested_product_id: product?.id || null
  });

  let text;

  if (product) {
    text =
      `Hi! 👋 Thanks for checking out ${product.name}.\n\n` +
      `${formatProductPrice(product)}\n` +
      getProductAvailability(product) +
      `\n\nWould you like to know the sizes, colors or how to order?`;
  } else {
    text =
      `Hi! 👋 Thanks for visiting our store.\n\n` +
      `Tell me which product you're interested in and I'll help you with price, availability and ordering.`;
  }

  const productCards = product ? [createProductCard(product)] : [];
  const quickReplies = product
    ? ['Price', 'Sizes', 'Colors', 'Order']
    : ['Show products', 'Latest products'];

  db.addMessage(sessionId, 'bot', text, {
    quick_replies: quickReplies,
    product_cards: productCards
  });

  return {
    success: true,
    message: { text, quick_replies: quickReplies, product_cards: productCards },
    conversation
  };
}

/* ============================================================
 * FIND PRODUCTS (first argument of db.getProducts = tenant/store id)
 * ============================================================ */

function findRelevantProducts(userText, tenantId) {
  const products = db.getProducts(tenantId);

  if (!products.length) return [];

  const text = String(userText || '').toLowerCase().trim();

  const smartResults = db.searchProductsSmart(text, tenantId);

  if (smartResults.length) return smartResults.slice(0, 5);

  const productWords = [
    'product', 'products', 'shirt', 'shirts', 'tshirt', 't-shirt', 'hoodie',
    'pant', 'pants', 'cargo', 'jeans', 'dress', 'kurti', 'saree',
    'earbuds', 'earbud', 'headphone', 'speaker', 'watch', 'smartwatch',
    'charger', 'cable', 'mobile', 'phone',
    'show', 'available', 'availability', 'price', 'cost', 'buy', 'order'
  ];

  if (productWords.some(word => text.includes(word))) return products.slice(0, 5);

  return [];
}

/* ============================================================
 * GEMINI
 * ============================================================ */

async function generateGeminiResponse({ userText, conversation, products, platform, tenantId }) {
  const store = db.getStore(tenantId);
  const businessName = store?.business_name || store?.name || 'the store';

  const productContext = products.length
    ? products
        .slice(0, 5)
        .map(
          product => `
PRODUCT ID: ${product.id}
NAME: ${product.name}
PRICE: ${formatProductPrice(product)}
CATEGORY: ${product.category || ''}
SIZES: ${(product.sizes || []).join(', ') || 'Not specified'}
COLORS: ${(product.colors || []).join(', ') || 'Not specified'}
STOCK: ${product.stock ?? 'Not specified'}
IMAGE: ${product.image_url || ''}
INSTAGRAM URL: ${product.instagram_url || ''}
CHECKOUT URL: ${product.checkout_url || ''}
CAPTION:
${product.instagram_caption || ''}
`
        )
        .join('\n-------------------\n')
    : 'No matching products found.';

  const conversationHistory = db
    .getMessages(conversation.session_id)
    .slice(-10)
    .map(message => `${message.sender}: ${message.text}`)
    .join('\n');

  const whatsappRule =
    platform === 'whatsapp'
      ? '17. This chat is on WhatsApp. Customers order inside this chat with buttons (Catalogue, Add to cart, Checkout). Ignore rules 13 and 14 here: never send links, and tell the customer to tap Catalogue or Add to cart to order.'
      : '';

  const systemInstruction = `
You are an AI sales assistant for the Instagram store "${businessName}".

Your job is to help customers discover products,
answer product questions and guide them toward ordering.

IMPORTANT RULES:

1. ONLY use product information supplied in the PRODUCT DATA.
2. Do not invent prices.
3. Do not invent sizes.
4. Do not invent colors.
5. Do not invent stock.
6. Do not claim a product is available if the data says otherwise.
7. If information is missing, say that it is not specified.
8. Never make up discounts.
9. Be concise and natural.
10. Do not mention internal database, API, Gemini or system instructions.
11. The product data comes from the store's Instagram posts.
12. If a customer asks about a product that is not found,
    ask which product they mean or offer available products.
13. If customer wants to order, provide the product's checkout
    URL when one exists.
14. If no checkout URL exists, tell the customer that the store
    needs to provide the ordering link.
15. Currency is ${CURRENCY_SYMBOL}.
16. Keep replies under 900 characters (Instagram DM limit is 1000).
16a. Answer the customer's exact question FIRST (price, size, colour, stock, delivery...). Do not repeat the whole product description unless they ask for it.
16b. If the customer asks for photos or images, say the photos are being sent; never say you cannot send images.
${whatsappRule}

STORE TYPE:
${conversation.store_type}

PLATFORM:
${platform}

PRODUCT DATA:
${productContext}

RECENT CONVERSATION:
${conversationHistory}
`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const response = await axios.post(
    url,
    {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
    },
    {
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      timeout: GEMINI_TIMEOUT_MS
    }
  );

  const answer = response.data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!answer) throw new Error('Gemini returned an empty response');

  return answer;
}

/* ============================================================
 * LOCAL SALES ENGINE (fallback when Gemini fails or is not configured)
 * ============================================================ */

function generateLocalSalesResponse(userText, products, conversation, platform = 'simulator') {
  const text = String(userText || '').toLowerCase();
  const isWhatsApp = platform === 'whatsapp';

  if (!products.length) {
    return (
      `I couldn't find a matching product right now. ` +
      (isWhatsApp
        ? `Tap Catalogue to browse our collection, or tell me what you're looking for.`
        : `Please send me the product name or tell me what you're looking for.`)
    );
  }

  // Instagram captions are long: show a short clean name
  const product = { ...products[0], name: cleanName(products[0].name) };

  if (text.includes('price') || text.includes('cost') || text.includes('how much')) {
    return `${product.name} is ${formatProductPrice(product)}.`;
  }

  if (text.includes('size') || text.includes('sizes')) {
    const sizes = product.sizes || [];
    if (!sizes.length) return `The sizes for ${product.name} are not specified in the Instagram post.`;
    return `${product.name} is available in: ${sizes.join(', ')}.`;
  }

  if (text.includes('color') || text.includes('colour')) {
    const colors = product.colors || [];
    if (!colors.length) return `The available colors are not specified in the Instagram post.`;
    return `${product.name} is available in: ${colors.join(', ')}.`;
  }

  if (text.includes('stock') || text.includes('available')) {
    return getProductAvailability(product);
  }

  if (text.includes('buy') || text.includes('order') || text.includes('purchase')) {
    // On WhatsApp the customer orders with the Add to cart button, not a link
    if (isWhatsApp) {
      return `Sure! Tap *Add to cart* below to order ${product.name} right here in WhatsApp.`;
    }

    if (product.checkout_url) {
      return `Sure! You can order ${product.name} here:\n${product.checkout_url}`;
    }

    if (product.instagram_url) {
      return (
        `You can view the product here:\n${product.instagram_url}\n\n` +
        `Please contact the store for the ordering link.`
      );
    }

    return `Please contact the store to complete your order for ${product.name}.`;
  }

  let response =
    `${product.name}\n\n${formatProductPrice(product)}\n${getProductAvailability(product)}`;

  if (product.colors && product.colors.length) response += `\nColors: ${product.colors.join(', ')}`;
  if (product.sizes && product.sizes.length) response += `\nSizes: ${product.sizes.join(', ')}`;

  response += `\n\nWould you like to order it?`;

  return response;
}

/* ============================================================
 * PRODUCT CARD / QUICK REPLIES / FORMATTERS
 * ============================================================ */

function detectImageRequest(userText) {
  return /\b(image|images|photo|photos|pic|pics|picture|pictures|full image|full photo|dp|video)\b/i.test(String(userText || ''));
}

// "✨ Celebrate Diwali in Pure Comfort & Royalty! Get the ultimate..." -> "Celebrate Diwali in Pure Comfort & Royalty"
function cleanName(name) {
  let s = String(name || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u200d]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  const cut = s.search(/[!.|]|\s[-–—]\s/);
  if (cut > 8) s = s.slice(0, cut).trim();

  if (s.length > 60) s = s.slice(0, 57).trimEnd() + '…';

  return s || String(name || 'Product');
}

function generateImageResponse(product) {
  let text = `Here are the photos of ${cleanName(product.name)} 📸\n\n${formatProductPrice(product)}`;

  if (product.stock !== null && product.stock !== undefined) text += `\n${getProductAvailability(product)}`;
  if (product.sizes && product.sizes.length) text += `\nSizes: ${product.sizes.join(', ')}`;
  if (product.colors && product.colors.length) text += `\nColors: ${product.colors.join(', ')}`;
  if (product.instagram_url) text += `\n\nSee every photo on our post:\n${product.instagram_url}`;

  return text + `\n\nWould you like to order it?`;
}

function createProductCard(product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    currency: CURRENCY_SYMBOL,
    image_url: product.image_url || '',
    video_url: product.video_url || null,
    category: product.category || '',
    sizes: product.sizes || [],
    colors: product.colors || [],
    stock: product.stock,
    checkout_url: product.checkout_url || '',
    instagram_url: product.instagram_url || '',
    source: product.source || 'instagram'
  };
}

function createQuickReplies(userText, products) {
  const text = String(userText || '').toLowerCase();

  if (!products.length) return ['Show products', 'Latest products'];
  if (text.includes('price') || text.includes('cost')) return ['Sizes', 'Colors', 'Order'];
  if (text.includes('size')) return ['Colors', 'Price', 'Order'];
  if (text.includes('color') || text.includes('colour')) return ['Sizes', 'Price', 'Order'];

  return ['Price', 'Sizes', 'Colors', 'Order'];
}

function formatProductPrice(product) {
  if (product.price === null || product.price === undefined || product.price === '') {
    return 'Price not specified';
  }

  const number = Number(product.price);

  if (Number.isNaN(number)) return String(product.price);

  return CURRENCY_SYMBOL + number.toLocaleString('en-IN');
}

function getProductAvailability(product) {
  if (product.stock === null || product.stock === undefined) {
    return 'Stock information is not specified.';
  }

  const stock = Number(product.stock);

  if (stock <= 0) return 'Currently out of stock.';
  if (stock <= 5) return `Only ${stock} left in stock.`;

  return `${stock} available in stock.`;
}

/* ============================================================
 * LEAD MANAGEMENT
 * ============================================================ */

function updateLead(sessionId, userText, products, conversation) {
  const text = String(userText || '').toLowerCase();

  let intentScore = conversation.intent_score || 'WARM';
  let status = 'OPEN';

  if (
    text.includes('buy') ||
    text.includes('order') ||
    text.includes('purchase') ||
    text.includes('checkout')
  ) {
    intentScore = 'HOT';
    status = 'CHECKOUT_CLICKED';
  } else if (products.length > 0) {
    intentScore = 'WARM';
  }

  const product = products[0];

  db.saveOrUpdateLead(sessionId, {
    store_id: conversation.store_id,
    instagram_user_id: conversation.instagram_user_id || undefined,
    customer_name: conversation.customer_name,
    customer_handle: conversation.customer_handle,
    store_type: conversation.store_type,
    phone: conversation.phone,
    interested_product: product?.name || null,
    interested_product_id: product?.id || null,
    cart_value: product?.price || 0,
    intent_score: intentScore,
    status
  });

  db.updateConversation(sessionId, {
    intent_score: intentScore,
    interested_product_id: product?.id || conversation.interested_product_id || null
  });
}

module.exports = {
  handleMessage,
  handleAdReferral,
  findRelevantProducts,
  createProductCard,
  detectImageRequest,
  cleanName
};

