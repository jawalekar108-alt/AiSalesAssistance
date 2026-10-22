//13/10

const db = require('../config/database');
const wa = require('../services/whatsapp');
const orders = require('../services/orders');
const conversationFlow = require('./conversationFlow');
const { extractRef, findProductByRef } = require('../services/whatsappLink');

// Owner notifications (new order alerts). The bot keeps working if the file is missing.
let notifier = { notifyNewOrder: async () => {}, notifyPaymentProof: async () => {} };

try {
  notifier = require('../services/notifier');
} catch (error) {
  console.warn('[WA-BOT] notifier not available (owner alerts off):', error.message);
}

/*
 * WHATSAPP SALES CHATBOT  -  catalogue -> product -> cart -> checkout -> order, all inside WhatsApp.
 *
 *  Instagram button  -> product welcome ("Saw you checking out X from our Instagram video") -> Add to cart
 *  "Hi" / "menu"     -> fresh start: greeting + product cards (photo, price, sizes, Add to cart)
 *  First message     -> greeting + product cards
 *  Cart              -> Add more / Edit cart / Checkout
 *  Checkout          -> name -> address -> payment -> summary -> Place order
 *  Typing anything   -> AI answers, then the buttons come back.
 *
 * Saved on the conversation record:
 *   wa_state    : IDLE | AWAIT_NAME | AWAIT_ADDRESS
 *   wa_state_at : when the state was set (an unfinished step expires after 1 hour)
 *   wa_items    : [{ pid, name, size, qty, price }]      (the cart)
 *   wa_checkout : { name, address, payment }              (kept for repeat orders)
 */

const clip = wa.clip;

const CARD_PAGE_SIZE = 5; // product cards per page
const STATE_TIMEOUT_MS = 60 * 60 * 1000; // an unfinished name/address step expires after 1 hour

const GREETING_RE = /^(hi+|hello+|hey+|hlo|namaste|hola|good\s*(morning|afternoon|evening))\b/i;
const MENU_RE = /^(menu|start|home|help|catalog(ue)?|products?|shop|browse|collection|cart|my cart|view cart|bag)\b/i;

// Questions about an order that already exists ("where is my order", "cancel my order").
// These must NOT be mistaken for "I want to order" and start a new purchase.
const ORDER_WORD_RE = /\b(order|parcel|package|delivery)\b/i;
const ORDER_STATUS_RE = /\b(track(ing)?|status|where\s+is|where's|delivered|shipped|dispatch(ed)?|arrive|reach(ed)?|when\s+will)\b/i;
const ORDER_CHANGE_RE = /\b(cancel|return|refund|exchange|replace(ment)?|change|wrong|damaged)\b/i;

// WhatsApp errors that mean "stop trying to send" (no point retrying the next card)
const FATAL_SEND_CODES = [190, 131030, 131031, 131047];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
 * SMALL HELPERS
 * ============================================================ */

function currency(store) {
  return store.currency || process.env.CURRENCY_SYMBOL || '₹';
}

function fmt(store, n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return `${currency(store)}${v.toLocaleString('en-IN')}`;
}

function priceOf(store, product) {
  if (product.price === null || product.price === undefined || product.price === '') return '';
  const n = Number(product.price);
  return Number.isNaN(n) ? String(product.price) : fmt(store, n);
}

function isOut(product) {
  return product.stock !== null && product.stock !== undefined && Number(product.stock) <= 0;
}

function businessName(store) {
  return store.business_name || store.name || 'our store';
}

function whatsappBold(text) {
  // Gemini writes **bold**, WhatsApp uses *bold*
  return String(text || '').replace(/\*\*(.+?)\*\*/g, '*$1*');
}

function getConv(ctx) {
  return db.getConversation(ctx.sessionId) || {};
}

function sameStore(ctx, product) {
  return Boolean(product) && String(product.store_id || product.store_type) === String(ctx.store.id);
}

function productById(ctx, id) {
  const product = db.getProductById(id);
  return sameStore(ctx, product) ? product : null;
}

function currentProduct(ctx) {
  const id = getConv(ctx).interested_product_id;
  return id ? productById(ctx, id) : null;
}

function firstName(ctx) {
  return ctx.name && ctx.name !== 'there' ? ctx.name.split(/\s+/)[0] : '';
}

function setState(ctx, state) {
  db.updateConversation(ctx.sessionId, { wa_state: state, wa_state_at: new Date().toISOString() });
}

function patchCheckout(ctx, patch) {
  db.updateConversation(ctx.sessionId, { wa_checkout: { ...(getConv(ctx).wa_checkout || {}), ...patch } });
}

function setProduct(ctx, product) {
  db.updateConversation(ctx.sessionId, { interested_product_id: product.id });
}

/* ---------- cart ---------- */

function cartItems(ctx) {
  return Array.isArray(getConv(ctx).wa_items) ? getConv(ctx).wa_items : [];
}

function saveCart(ctx, list) {
  db.updateConversation(ctx.sessionId, { wa_items: list });
}

function cartCount(list) {
  return list.reduce((n, i) => n + i.qty, 0);
}

function lineKey(item) {
  return `${item.pid}:${item.size || '-'}`;
}

function pricing(store, list) {
  const sub = list.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
  const pct = Number(store.promo_discount_percent) || 0;
  const code = store.active_promo_code || '';
  const discount = code && pct > 0 ? Math.round((sub * pct) / 100) : 0;

  return { sub, pct, code, discount, total: sub - discount };
}

function lineText(store, item) {
  const lineTotal = Number(item.price) > 0 ? ` = ${fmt(store, Number(item.price) * item.qty)}` : '';
  return `${clip(item.name, 40)}${item.size ? ` (${item.size})` : ''} × ${item.qty}${lineTotal}`;
}

function cartLines(store, list) {
  return list.map((item, i) => `${i + 1}. ${lineText(store, item)}`).join('\n');
}

function totalsText(store, list) {
  const p = pricing(store, list);
  const lines = [];

  if (p.sub <= 0) return '*Total:* to be confirmed';

  if (p.discount > 0) {
    lines.push(`Subtotal: ${fmt(store, p.sub)}`);
    lines.push(`🎁 Offer ${p.code} (${p.pct}% off): -${fmt(store, p.discount)}`);
  }

  lines.push(`*Total: ${fmt(store, p.total)}*`);

  return lines.join('\n');
}

function shippingHint(store, list) {
  const threshold = Number(store.free_shipping_threshold) || 0;
  if (!threshold) return '';

  const total = pricing(store, list).total;

  return total >= threshold
    ? '🚚 Free shipping applied!'
    : `🚚 Add ${fmt(store, threshold - total)} more for free shipping`;
}

function saveLead(ctx, product, intent, status) {
  const list = cartItems(ctx);
  const value = list.length ? pricing(ctx.store, list).total : Number(product?.price) || 0;

  db.saveOrUpdateLead(ctx.sessionId, {
    store_id: ctx.store.id,
    customer_name: ctx.name !== 'there' ? ctx.name : undefined,
    customer_handle: `+${ctx.from}`,
    phone: `+${ctx.from}`,
    interested_product: product?.name || null,
    interested_product_id: product?.id || null,
    cart_value: value,
    intent_score: intent,
    status
  });
}

/* ---------- incoming message parsing ---------- */

function parseInput(message) {
  if (message.type === 'text') {
    return { kind: 'text', text: String(message.text?.body || '').trim() };
  }

  if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    if (reply) return { kind: 'action', id: reply.id, text: reply.title };
  }

  if (message.type === 'button') {
    return { kind: 'text', text: String(message.button?.text || message.button?.payload || '').trim() };
  }

  return { kind: 'other', type: message.type };
}

// Click-to-WhatsApp ads / posts send a "referral" object on the first message
function productFromReferral(store, referral) {
  if (!referral) return null;

  const products = db.getProducts(store.id);

  return (
    products.find(p => referral.source_id && String(p.instagram_media_id) === String(referral.source_id)) ||
    products.find(
      p =>
        referral.source_url &&
        p.instagram_permalink &&
        (String(referral.source_url).includes(p.instagram_permalink) ||
          String(p.instagram_permalink).includes(String(referral.source_url)))
    ) ||
    null
  );
}

// "Hi Store! I'm interested in Kurta (Code: A1B2C)"  ->  product "Kurta"
// Used when the Code is missing or does not match.
function productFromText(store, text) {
  const match = String(text || '').match(/interested in\s+(.+?)\s*(?:\(code:.*)?$/i);
  if (!match) return null;

  const wanted = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
  if (!wanted) return null;

  return (
    db.getProducts(store.id).find(p => {
      const name = String(p.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
      return name && (name === wanted || name.startsWith(wanted) || wanted.startsWith(name));
    }) || null
  );
}

/* ============================================================
 * PRODUCT CARDS
 * ============================================================ */

function productButtons(ctx, product) {
  if (isOut(product)) return [{ id: 'cat:0', title: '🛍️ Catalogue' }];

  const n = cartCount(cartItems(ctx));

  return [
    { id: `add:${product.id}`, title: '🛒 Add to cart' },
    { id: 'cat:0', title: '🛍️ Catalogue' },
    n ? { id: 'cart', title: `🧾 Cart (${n})` } : { id: 'ask', title: '💬 Ask us' }
  ];
}

// Buttons under every product card in the catalogue
function cardButtons(ctx, product) {
  const n = cartCount(cartItems(ctx));

  return [
    { id: `add:${product.id}`, title: '🛒 Add to cart' },
    n ? { id: 'cart', title: `🧾 Cart (${n})` } : { id: 'ask', title: '💬 Ask us' }
  ];
}

function productFacts(ctx, product) {
  const lines = [`*${clip(product.name, 60)}*`];

  const price = priceOf(ctx.store, product);
  if (price) lines.push(`💰 ${price}`);

  if ((product.sizes || []).length) lines.push(`📏 Sizes: ${product.sizes.join(', ')}`);
  if ((product.colors || []).length) lines.push(`🎨 Colors: ${product.colors.join(', ')}`);

  if (product.stock !== null && product.stock !== undefined) {
    const stock = Number(product.stock);
    lines.push(stock <= 0 ? '❌ Sold out' : stock <= 5 ? `⚡ Only ${stock} left` : '✅ In stock');
  }

  return lines.join('\n');
}

// Text of one catalogue card: name, price (with old price), sizes, colors, stock, short description
function cardBody(ctx, product) {
  const lines = [`*${clip(product.name, 60)}*`];

  const price = priceOf(ctx.store, product);

  if (price) {
    let line = `💰 ${price}`;

    if (product.original_price && Number(product.original_price) > Number(product.price)) {
      line += `  (was ${fmt(ctx.store, product.original_price)})`;
    }

    lines.push(line);
  }

  if ((product.sizes || []).length) lines.push(`📏 Sizes: ${product.sizes.join(', ')}`);
  if ((product.colors || []).length) lines.push(`🎨 Colors: ${product.colors.join(', ')}`);

  if (product.stock !== null && product.stock !== undefined) {
    const stock = Number(product.stock);
    lines.push(stock <= 5 ? `⚡ Only ${stock} left` : '✅ In stock');
  }

  const description = String(product.description || '').replace(/\s+/g, ' ').trim();
  if (description) lines.push('', clip(description, 200));

  return lines.join('\n');
}

// Product photo + text + buttons.
// The image upload / fallback to text-only lives inside wa.sendButtons.
async function sendProductCard(ctx, product, body, buttons) {
  await wa.sendButtons(ctx.store, ctx.from, {
    body,
    buttons,
    image: product.image_url || undefined,
    footer: 'Or just type your question 💬'
  });
}

function welcomeBody(ctx, product) {
  const store = ctx.store;
  const source = product.media_type === 'VIDEO' ? 'video' : 'post';
  const name = clip(product.name, 60);

  if (store.whatsapp_welcome_template) {
    return String(store.whatsapp_welcome_template)
      .replace(/\{product\}/g, name)
      .replace(/\{source\}/g, source)
      .replace(/\{business\}/g, businessName(store))
      .replace(/\{price\}/g, priceOf(store, product));
  }

  const hi = firstName(ctx) ? `Hey ${firstName(ctx)}! 👋` : 'Hey there! 👋';
  const intro = `${hi} Saw you were checking out our *${name}* from our Instagram ${source}.`;

  if (isOut(product)) {
    return `${intro}\n\nThis one just sold out 😔 Want to browse our other styles?`;
  }

  const extra = productFacts(ctx, product).split('\n').slice(1).join('\n');

  return `${intro}\n\n${extra ? extra + '\n\n' : ''}Want to add it to your cart, or browse matching styles?`;
}

async function sendWelcome(ctx, product) {
  setProduct(ctx, product);
  setState(ctx, 'IDLE');
  saveLead(ctx, product, 'WARM', 'OPEN');

  await sendProductCard(ctx, product, welcomeBody(ctx, product), productButtons(ctx, product));
}

async function showProduct(ctx, product) {
  setProduct(ctx, product);
  setState(ctx, 'IDLE');
  saveLead(ctx, product, 'WARM', 'OPEN');

  const body = isOut(product)
    ? `${productFacts(ctx, product)}\n\nThis one is sold out right now 😔`
    : `${productFacts(ctx, product)}\n\nTap *Add to cart* to order it 👇`;

  await sendProductCard(ctx, product, body, productButtons(ctx, product));
}

/* ============================================================
 * CATALOGUE  (one photo card per product, with an Add to cart button)
 * ============================================================ */

async function sendCatalogue(ctx, page, intro) {
  const store = ctx.store;
  const all = db.getProducts(store.id).filter(p => !isOut(p));
  const list = cartItems(ctx);
  const n = cartCount(list);

  if (!all.length) {
    return wa.sendText(
      store,
      ctx.from,
      `Hi! 👋 Welcome to ${businessName(store)}. Our collection is being updated — please check back shortly.`
    );
  }

  const pages = Math.max(1, Math.ceil(all.length / CARD_PAGE_SIZE));
  const current = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const slice = all.slice(current * CARD_PAGE_SIZE, (current + 1) * CARD_PAGE_SIZE);

  const hello =
    intro ||
    `Hi${firstName(ctx) ? ' ' + firstName(ctx) : ''}! 👋 Welcome to *${businessName(store)}*.\n\n` +
      'Here are our latest styles 👇 Tap *Add to cart* on the one you like, and check out right here in WhatsApp ✨';

  await wa.sendText(store, ctx.from, hello);

  for (const product of slice) {
    try {
      await sendProductCard(ctx, product, cardBody(ctx, product), cardButtons(ctx, product));
    } catch (error) {
      // Stop on problems that will hit every card (token, allowed list, 24h window)
      if (FATAL_SEND_CODES.includes(error.graph?.code)) throw error;

      console.warn(`[WA-BOT] Card for "${product.name}" failed, skipping:`, error.graph?.message || error.message);
    }

    await sleep(350); // keeps the cards in order
  }

  const buttons = [];

  if (current + 1 < pages) buttons.push({ id: `cat:${current + 1}`, title: '➡️ More styles' });

  if (n) {
    buttons.push({ id: 'cart', title: `🧾 Cart (${n})` });
    buttons.push({ id: 'checkout', title: '✅ Checkout' });
  }

  if (!buttons.length) buttons.push({ id: 'ask', title: '💬 Ask us' });

  const from = current * CARD_PAGE_SIZE + 1;
  const to = from + slice.length - 1;

  return wa.sendButtons(store, ctx.from, {
    body: `Showing ${from}–${to} of ${all.length} styles${n ? `\n🛒 ${n} item${n > 1 ? 's' : ''} in your cart` : ''}`,
    buttons
  });
}

/* ============================================================
 * CART ACTIONS
 * ============================================================ */

async function sendSizePicker(ctx, product, headline) {
  const sizes = product.sizes || [];

  const body =
    `${headline || 'Great pick! 🎉'}\n\n` +
    `*${clip(product.name, 60)}*\n` +
    `📏 Sizes: ${sizes.join(', ')}` +
    ((product.colors || []).length ? `\n🎨 Colors: ${product.colors.join(', ')}` : '') +
    '\n\nTap your size 👇';

  if (sizes.length <= 3) {
    return wa.sendButtons(ctx.store, ctx.from, {
      body,
      buttons: sizes.map(s => ({ id: `size:${product.id}:${s}`, title: `Size ${s}` }))
    });
  }

  return wa.sendList(ctx.store, ctx.from, {
    body,
    button: 'Choose size',
    sectionTitle: 'Sizes',
    rows: sizes.slice(0, 10).map(s => ({ id: `size:${product.id}:${s}`, title: `Size ${s}` }))
  });
}

async function requestAdd(ctx, product) {
  if (isOut(product)) {
    return wa.sendButtons(ctx.store, ctx.from, {
      body: `Sorry, ${clip(product.name, 60)} just sold out 😔`,
      buttons: [{ id: 'cat:0', title: '🛍️ Catalogue' }]
    });
  }

  setProduct(ctx, product);

  if ((product.sizes || []).length) return sendSizePicker(ctx, product);

  return addToCart(ctx, product, null);
}

async function addToCart(ctx, product, size) {
  const list = [...cartItems(ctx)];
  const wanted = size || null;

  const inCart = list.filter(i => i.pid === product.id).reduce((n, i) => n + i.qty, 0);

  if (product.stock !== null && product.stock !== undefined && inCart + 1 > Number(product.stock)) {
    return wa.sendButtons(ctx.store, ctx.from, {
      body: `Only ${Number(product.stock)} of ${clip(product.name, 50)} available, and they're already in your cart 🛒`,
      buttons: [
        { id: 'cart', title: '🧾 View cart' },
        { id: 'cat:0', title: '🛍️ Catalogue' }
      ]
    });
  }

  const existing = list.find(i => i.pid === product.id && (i.size || null) === wanted);

  if (existing) {
    existing.qty += 1;
  } else {
    list.push({
      pid: product.id,
      name: product.name,
      size: wanted,
      qty: 1,
      price: product.price === undefined || product.price === '' ? null : product.price
    });
  }

  saveCart(ctx, list);
  setProduct(ctx, product);
  setState(ctx, 'IDLE');
  db.updateConversation(ctx.sessionId, { is_active: true });
  saveLead(ctx, product, 'HOT', 'OPEN');

  const n = cartCount(list);
  const total = fmt(ctx.store, pricing(ctx.store, list).total);

  return wa.sendButtons(ctx.store, ctx.from, {
    body:
      '✅ *Added to your cart!*\n' +
      `• ${lineText(ctx.store, { name: product.name, size: wanted, qty: 1, price: null })}\n\n` +
      `🛒 Cart: ${n} item${n > 1 ? 's' : ''}${total && pricing(ctx.store, list).sub > 0 ? ` · ${total}` : ''}\n\n` +
      'Add more styles, or go to checkout?',
    buttons: [
      { id: 'cat:0', title: '➕ Add more' },
      { id: 'cart', title: '🧾 View cart' },
      { id: 'checkout', title: '✅ Checkout' }
    ]
  });
}

async function showCart(ctx, headline) {
  const list = cartItems(ctx);

  if (!list.length) {
    return wa.sendButtons(ctx.store, ctx.from, {
      body: `${headline ? headline + '\n\n' : ''}Your cart is empty 🛒 Let's find something you'll love!`,
      buttons: [{ id: 'cat:0', title: '🛍️ Catalogue' }]
    });
  }

  const hint = shippingHint(ctx.store, list);

  return wa.sendButtons(ctx.store, ctx.from, {
    body:
      (headline ? `${headline}\n\n` : '') +
      '🧾 *Your cart*\n' +
      `${cartLines(ctx.store, list)}\n\n` +
      `${totalsText(ctx.store, list)}` +
      (hint ? `\n${hint}` : ''),
    buttons: [
      { id: 'checkout', title: '✅ Checkout' },
      { id: 'cat:0', title: '➕ Add more' },
      { id: 'editcart', title: '✏️ Edit cart' }
    ]
  });
}

async function showEditCart(ctx) {
  const list = cartItems(ctx);

  if (!list.length) return showCart(ctx);

  const rows = list.slice(0, 9).map(item => ({
    id: `rm:${lineKey(item)}`,
    title: `❌ ${item.name}`,
    description: `Remove${item.size ? ` · size ${item.size}` : ''} · qty ${item.qty}`
  }));

  rows.push({ id: 'clear', title: '🗑️ Clear cart', description: 'Remove everything' });

  return wa.sendList(ctx.store, ctx.from, {
    body: 'Tap an item to remove it from your cart 👇',
    button: 'Edit cart',
    sectionTitle: 'Your cart',
    rows
  });
}

/* ============================================================
 * CHECKOUT (all inside WhatsApp)
 * ============================================================ */

async function startCheckout(ctx) {
  const list = cartItems(ctx);

  if (!list.length) return showCart(ctx);

  saveLead(ctx, currentProduct(ctx), 'HOT', 'CHECKOUT_CLICKED');

  const saved = getConv(ctx).wa_checkout || {};

  // Returning customer: reuse the saved name and address
  if (saved.name && saved.address) return askPaymentOrSummary(ctx);

  return askName(ctx);
}

async function askName(ctx) {
  setState(ctx, 'AWAIT_NAME');

  if (ctx.name && ctx.name !== 'there') {
    return wa.sendButtons(ctx.store, ctx.from, {
      body: `Almost there! 🎉 Who should we deliver this to?\nYour WhatsApp name is *${clip(ctx.name, 40)}*.`,
      buttons: [
        { id: 'name:ok', title: "✅ Yes, that's me" },
        { id: 'name:other', title: '✏️ Other name' }
      ]
    });
  }

  return wa.sendText(ctx.store, ctx.from, '✍️ Please type the name for the delivery.\n\nType *menu* to start over.');
}

async function askAddress(ctx) {
  setState(ctx, 'AWAIT_ADDRESS');

  return wa.sendText(
    ctx.store,
    ctx.from,
    '📍 Please send your full delivery address with pincode.\n(House no., street, area, city, pincode)\n\nType *cancel* to stop, or *menu* to start over.'
  );
}

async function askPaymentOrSummary(ctx) {
  if (ctx.store.upi_id) {
    setState(ctx, 'IDLE');

    return wa.sendButtons(ctx.store, ctx.from, {
      body: 'How would you like to pay?',
      buttons: [
        { id: 'pay:cod', title: '💵 Cash on delivery' },
        { id: 'pay:upi', title: '📲 Pay by UPI' }
      ]
    });
  }

  patchCheckout(ctx, { payment: 'COD' });
  setState(ctx, 'IDLE');

  return showSummary(ctx);
}

async function showSummary(ctx) {
  const list = cartItems(ctx);
  const checkout = getConv(ctx).wa_checkout || {};

  if (!list.length) return showCart(ctx);

  return wa.sendButtons(ctx.store, ctx.from, {
    body:
      '🧾 *Order summary*\n' +
      `${cartLines(ctx.store, list)}\n\n` +
      `${totalsText(ctx.store, list)}\n\n` +
      `👤 ${checkout.name}\n` +
      `📍 ${clip(checkout.address, 150)}\n` +
      `💳 ${checkout.payment === 'UPI' ? 'UPI' : 'Cash on delivery'}\n\n` +
      'Shall I place this order?',
    buttons: [
      { id: 'confirm', title: '✅ Place order' },
      { id: 'edit', title: '✏️ Edit details' },
      { id: 'editcart', title: '🛒 Edit cart' }
    ]
  });
}

async function confirmOrder(ctx) {
  const list = cartItems(ctx);
  const checkout = getConv(ctx).wa_checkout || {};

  if (!list.length) return showCart(ctx);
  if (!checkout.name || !checkout.address) return askName(ctx);

  const p = pricing(ctx.store, list);
  const payment = checkout.payment === 'UPI' ? 'UPI' : 'COD';

  const order = orders.add({
    store_id: ctx.store.id,
    session_id: ctx.sessionId,
    items: list.map(i => ({
      product_id: i.pid,
      name: i.name,
      size: i.size || null,
      qty: i.qty,
      price: i.price === undefined ? null : i.price
    })),
    product_id: list[0].pid,
    product_name: list.map(i => `${i.name}${i.size ? ` (${i.size})` : ''} x${i.qty}`).join(', '),
    qty: cartCount(list),
    subtotal: p.sub,
    discount: p.discount,
    promo_code: p.discount > 0 ? p.code : null,
    total: p.total,
    currency: currency(ctx.store),
    customer_name: checkout.name,
    customer_phone: `+${ctx.from}`,
    address: checkout.address,
    payment,
    status: payment === 'UPI' ? 'PENDING_PAYMENT' : 'NEW'
  });

  // Tell the owner (never blocks the customer's reply)
  notifier.notifyNewOrder(ctx.store, order).catch(() => {});

  // Reduce stock for products that track it
  for (const item of list) {
    const product = db.getProductById(item.pid);

    if (product && product.stock !== null && product.stock !== undefined) {
      db.updateProduct(product.id, { stock: Math.max(0, Number(product.stock) - item.qty) });
    }
  }

  db.completeCheckout(ctx.sessionId, {
    total_price: p.total,
    product_name: order.product_name,
    product_id: list[0].pid
  });

  // Empty the cart, keep name/address for the next order
  saveCart(ctx, []);
  setState(ctx, 'IDLE');
  patchCheckout(ctx, { payment: undefined });
  db.updateConversation(ctx.sessionId, { wa_last_order_id: order.id });

  let text =
    '🎉 *Order confirmed!*\n' +
    `Order ID: *${order.id}*\n\n` +
    `${cartLines(ctx.store, list)}\n\n` +
    `${totalsText(ctx.store, list)}\n\n` +
    `📍 ${clip(checkout.name, 40)}, ${clip(checkout.address, 120)}`;

  if (payment === 'UPI') {
    text += `\n\n📲 Please pay ${fmt(ctx.store, p.total) || 'the total'} to UPI ID:\n*${ctx.store.upi_id}*\nand send the payment screenshot here.`;
  } else {
    text += '\n\n💵 Pay cash on delivery.';
  }

  text += `\n\nThank you for shopping with ${businessName(ctx.store)}! 💛 We'll confirm your order here shortly.`;

  return wa.sendButtons(ctx.store, ctx.from, {
    body: text,
    buttons: [{ id: 'cat:0', title: '🛍️ Shop more' }]
  });
}

async function cancelFlow(ctx) {
  setState(ctx, 'IDLE');

  if (cartItems(ctx).length) return showCart(ctx, 'No problem — your cart is saved 🛒');

  return sendCatalogue(ctx, 0, 'No problem! Here is our collection whenever you are ready 👇');
}

/* ============================================================
 * TYPED ANSWERS DURING CHECKOUT
 * ============================================================ */

async function onName(ctx, text) {
  if (/^cancel$/i.test(text)) return cancelFlow(ctx);

  const name = clip(text.replace(/\s+/g, ' ').trim(), 60);

  if (name.length < 2) return wa.sendText(ctx.store, ctx.from, 'Please type a valid name 🙂\n\nType *menu* to start over.');

  patchCheckout(ctx, { name });
  return askAddress(ctx);
}

async function onAddress(ctx, text) {
  if (/^cancel$/i.test(text)) return cancelFlow(ctx);

  if (text.length < 15) {
    return wa.sendText(
      ctx.store,
      ctx.from,
      'Please send the complete address — house no., street, area, city and pincode 📍\n\nType *cancel* to stop, or *menu* to start over.'
    );
  }

  patchCheckout(ctx, { address: clip(text, 300) });
  return askPaymentOrSummary(ctx);
}

/* ============================================================
 * ORDER STATUS ("where is my order")
 * ============================================================ */

async function sendOrderStatus(ctx) {
  const lastId = getConv(ctx).wa_last_order_id;
  const order = lastId ? orders.get(lastId) : null;

  if (!order) {
    return wa.sendButtons(ctx.store, ctx.from, {
      body: "I couldn't find a recent order on this number 🙂 Type your question, or browse our collection.",
      buttons: [
        { id: 'cat:0', title: '🛍️ Catalogue' },
        { id: 'ask', title: '💬 Ask us' }
      ]
    });
  }

  const status = String(order.status || 'NEW')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());

  const total = Number(order.total) > 0 ? `\nTotal: ${fmt(ctx.store, order.total)}` : '';

  return wa.sendButtons(ctx.store, ctx.from, {
    body: `📦 *Order ${order.id}*\nStatus: *${status}*${total}\n\nWe will message you here when it changes. Need anything else? Just type your question 💬`,
    buttons: [
      { id: 'cat:0', title: '🛍️ Catalogue' },
      { id: 'ask', title: '💬 Ask us' }
    ]
  });
}

/* ============================================================
 * AI ANSWER (anything the customer types that is not a button)
 * ============================================================ */

async function answerWithAI(ctx, text) {
  const product = currentProduct(ctx);

  const result = await conversationFlow.handleMessage({
    sessionId: ctx.sessionId,
    userText: text,
    storeType: ctx.store.type || ctx.store.id,
    storeId: ctx.store.id,
    platform: 'whatsapp',
    metadata: {
      customer_name: ctx.name !== 'there' ? ctx.name : undefined,
      customer_handle: `+${ctx.from}`,
      phone: `+${ctx.from}`,
      product_id: product?.id || null
    }
  });

  const reply = clip(whatsappBold(result?.message?.text), 950) || 'Happy to help! 😊';

  const n = cartCount(cartItems(ctx));

  const buttons = product
    ? productButtons(ctx, product)
    : [
        { id: 'cat:0', title: '🛍️ Catalogue' },
        ...(n ? [{ id: 'cart', title: `🧾 Cart (${n})` }] : [])
      ];

  return wa.sendButtons(ctx.store, ctx.from, { body: reply, buttons });
}

/* ============================================================
 * BUTTON / LIST TAPS
 * ============================================================ */

async function onAction(ctx, id) {
  const idx = id.indexOf(':');
  const kind = idx === -1 ? id : id.slice(0, idx);
  const arg = idx === -1 ? '' : id.slice(idx + 1);

  // Tapping any button leaves a half-finished typed step
  if (kind !== 'name' && (getConv(ctx).wa_state || 'IDLE') !== 'IDLE') setState(ctx, 'IDLE');

  switch (kind) {
    case 'home':
      return sendCatalogue(ctx, 0);

    case 'cat': {
      const page = Number(arg) || 0;

      return sendCatalogue(
        ctx,
        page,
        page > 0 ? '🛍️ More styles 👇' : '🛍️ Our collection 👇 Tap *Add to cart* on the one you like.'
      );
    }

    case 'prod': {
      const product = productById(ctx, arg);
      return product ? showProduct(ctx, product) : sendCatalogue(ctx, 0);
    }

    case 'add': {
      const product = productById(ctx, arg);
      return product ? requestAdd(ctx, product) : sendCatalogue(ctx, 0);
    }

    case 'size': {
      const cut = arg.indexOf(':');
      const product = productById(ctx, cut === -1 ? arg : arg.slice(0, cut));
      const size = cut === -1 ? '' : arg.slice(cut + 1);

      if (!product) return sendCatalogue(ctx, 0);
      if ((product.sizes || []).length && !(product.sizes || []).includes(size)) return sendSizePicker(ctx, product);

      return addToCart(ctx, product, size || null);
    }

    case 'ask':
      return wa.sendText(ctx.store, ctx.from, 'Sure! 💬 Type your question and I will answer right away.');

    case 'cart':
      return showCart(ctx);

    case 'editcart':
      return showEditCart(ctx);

    case 'rm': {
      const list = cartItems(ctx).filter(i => lineKey(i) !== arg);
      saveCart(ctx, list);

      return list.length ? showCart(ctx, '🗑️ Removed.') : showCart(ctx, '🗑️ Removed. Your cart is now empty.');
    }

    case 'clear':
      saveCart(ctx, []);
      return sendCatalogue(ctx, 0, '🗑️ Cart cleared. Pick something new 👇');

    case 'checkout':
      return startCheckout(ctx);

    case 'name':
      if (!cartItems(ctx).length) return showCart(ctx);

      if (arg === 'ok') {
        patchCheckout(ctx, { name: ctx.name });
        return askAddress(ctx);
      }

      setState(ctx, 'AWAIT_NAME');
      return wa.sendText(ctx.store, ctx.from, '✍️ Please type the name for the delivery.\n\nType *menu* to start over.');

    case 'pay':
      if (!cartItems(ctx).length) return showCart(ctx);

      patchCheckout(ctx, { payment: arg === 'upi' ? 'UPI' : 'COD' });
      return showSummary(ctx);

    case 'confirm':
      return confirmOrder(ctx);

    case 'edit':
      patchCheckout(ctx, { name: undefined, address: undefined });
      return askName(ctx);

    case 'cancel':
      return cancelFlow(ctx);

    default:
      return sendCatalogue(ctx, 0);
  }
}

/* ============================================================
 * ENTRY POINT (called by the webhook for every incoming WhatsApp message)
 * ============================================================ */

async function handleIncoming({ store, message, contact }) {
  const from = String(message.from);

  // Webhook retry protection
  const key = `wa_msg_${store.id}_${message.id}`;
  if (db.hasProcessedWebhookEvent(key)) return;
  db.markWebhookEventProcessed(key, store.id);

  if (store.status !== 'active' || store.ai_enabled === false) return;

  wa.markRead(store, message.id).catch(() => {});

  const profileName = contact?.profile?.name || '';

  const ctx = {
    store,
    from,
    name: profileName || 'there',
    sessionId: `wa_${store.id}_${from}`
  };

  // Is this the very first message from this customer?
  const isNew = !db.getConversation(ctx.sessionId, store.id);

  db.getOrCreateConversation(
    ctx.sessionId,
    store.type || store.id,
    'whatsapp',
    {
      customer_name: profileName || undefined,
      customer_handle: `+${from}`,
      phone: `+${from}`
    },
    store.id
  );

  try {
    const input = parseInput(message);

    // Tap on a button / list item
    if (input.kind === 'action') return await onAction(ctx, input.id);

    // Photos, voice notes, etc.
    if (input.kind === 'other') {
      const conv = getConv(ctx);

      if (message.type === 'image' && conv.wa_last_order_id) {
        orders.update(conv.wa_last_order_id, { payment_proof_media_id: message.image?.id || null });

        const proofOrder = orders.get(conv.wa_last_order_id);
        if (proofOrder) notifier.notifyPaymentProof(store, proofOrder).catch(() => {});

        return await wa.sendText(store, from, '✅ Screenshot received, thank you! We will confirm your payment shortly.');
      }

      return await wa.sendButtons(store, from, {
        body: 'I can read text messages for now 🙂 Tap an option below or type your question.',
        buttons: [{ id: 'cat:0', title: '🛍️ Catalogue' }]
      });
    }

    const text = input.text;
    if (!text) return;

    console.log(`[WA-BOT] [${store.id}] from +${from} (new=${isNew}): "${text}"`);

    // 1) Link from Instagram: product code in the message
    const product = findProductByRef(db.getProducts(store.id), extractRef(text));
    if (product) return await sendWelcome(ctx, product);

    // 1b) Click-to-WhatsApp ad / post
    const adProduct = productFromReferral(store, message.referral);
    if (adProduct) return await sendWelcome(ctx, adProduct);

    // 1c) Instagram button text without a usable code: match the product by name
    const namedProduct = productFromText(store, text);
    if (namedProduct) return await sendWelcome(ctx, namedProduct);

    // 2) Stop
    if (/^(stop|unsubscribe)$/i.test(text)) {
      setState(ctx, 'IDLE');
      db.updateConversation(ctx.sessionId, { is_active: false });

      return await wa.sendText(store, from, "Okay, you won't get more messages from us. Say *hi* anytime to chat again 🙂");
    }

    const words = text.split(/\s+/).length;
    const isGreeting = words <= 5 && GREETING_RE.test(text);
    const isMenuWord = words <= 3 && MENU_RE.test(text);

    // 3) A checkout step (name / address) is waiting for an answer.
    //    A greeting, a menu word, or an old unfinished step starts fresh instead.
    let conv = getConv(ctx);

    if ((conv.wa_state || 'IDLE') !== 'IDLE') {
      const since = Date.parse(conv.wa_state_at || '');
      const stale = !Number.isFinite(since) || Date.now() - since > STATE_TIMEOUT_MS;

      if (isGreeting || isMenuWord || stale) {
        setState(ctx, 'IDLE');
        conv = getConv(ctx);
      }
    }

    if (conv.wa_state === 'AWAIT_NAME') return await onName(ctx, text);
    if (conv.wa_state === 'AWAIT_ADDRESS') return await onAddress(ctx, text);

    // 4) First message ever, or a greeting -> welcome + product cards
    if (isNew || isGreeting) return await sendCatalogue(ctx, 0);

    // 5) Catalogue words
    if (words <= 3 && /^(catalog(ue)?|products?|shop|menu|browse|collection|start|home|help)\b/i.test(text)) {
      return await sendCatalogue(ctx, 0, '🛍️ Our collection 👇 Tap *Add to cart* on the one you like.');
    }

    // 6) Cart / checkout words
    if (words <= 3 && /^(cart|my cart|view cart|bag)\b/i.test(text)) return await showCart(ctx);

    // 6b) Questions about an existing order never start a new purchase
    if (ORDER_WORD_RE.test(text) && (ORDER_STATUS_RE.test(text) || ORDER_CHANGE_RE.test(text))) {
      return ORDER_STATUS_RE.test(text) ? await sendOrderStatus(ctx) : await answerWithAI(ctx, text);
    }

    if (words <= 4 && /\b(checkout|place order|order|buy|purchase|book)\b/i.test(text)) {
      if (cartItems(ctx).length) return await startCheckout(ctx);

      const current = currentProduct(ctx);
      return current ? await requestAdd(ctx, current) : await sendCatalogue(ctx, 0);
    }

    // 7) Anything else -> AI answer + buttons
    return await answerWithAI(ctx, text);
  } catch (error) {
    console.error('[WhatsApp Bot] ERROR:', error.graph || error.message);

    try {
      await wa.sendText(store, from, 'Sorry, something went wrong on our side 🙏 Please try again in a moment.');
    } catch {
      /* ignore */
    }

    throw error;
  }
}

module.exports = { handleIncoming };



