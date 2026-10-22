//7/10

const crypto = require('crypto');
const db = require('../config/database');

/*
 * WhatsApp click-to-chat link for Instagram replies  +  product code matching.
 *
 * Store settings (set per business):
 *   whatsapp_number        the number customers chat with, e.g. "919876543210"
 *                          (country code + number, digits only).
 *                          With Meta's TEST number this is the test number shown in the dashboard.
 *   whatsapp_link_enabled  true / false (default true when a number exists)
 *
 * .env (optional):
 *   WHATSAPP_DEFAULT_COUNTRY_CODE=91   -> a 10-digit number gets 91 added in front
 *
 * How the product is recognised:
 *   Instagram DM  -> link  wa.me/<number>?text=Hi Store! I'm interested in Kurta (Code: A1B2C)
 *   Customer taps -> WhatsApp opens with that text pre-filled -> customer taps Send
 *   whatsappBot   -> extractRef() reads "A1B2C" -> findProductByRef() -> product welcome message
 * The code is calculated from the product id, so nothing new has to be stored in the database.
 */

/* ============================================================
 * PRODUCT CODE
 * ============================================================ */

function productCode(product) {
  if (!product || !product.id) return '';

  return crypto
    .createHash('sha1')
    .update(String(product.id))
    .digest('hex')
    .slice(0, 5)
    .toUpperCase();
}

// Accepts a product object OR a product name (the webhook passes the card name)
function resolveProduct(store, productOrName) {
  if (!productOrName) return null;
  if (typeof productOrName === 'object') return productOrName;

  const wanted = String(productOrName).trim().toLowerCase();
  if (!wanted) return null;

  return (
    db
      .getProducts(store.id)
      .find(p => String(p.name || '').trim().toLowerCase() === wanted) || null
  );
}

// Reads "Code: A1B2C" from the first WhatsApp message
function extractRef(text) {
  const match = String(text || '').match(/code:\s*([A-F0-9]{5})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function findProductByRef(products, ref) {
  if (!ref || !Array.isArray(products)) return null;

  return products.find(p => productCode(p) === String(ref).toUpperCase()) || null;
}

/* ============================================================
 * LINK BUILDING
 * ============================================================ */

function normalizeNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return '';

  const cc = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');

  // 10 digit local number -> add country code
  if (cc && digits.length === 10) digits = cc + digits;

  // Remove a leading 0 before the country code (e.g. 0091...)
  digits = digits.replace(/^0+/, '');

  return digits.length >= 11 && digits.length <= 15 ? digits : '';
}

function buildWhatsAppLink(store, productOrName) {
  if (!store || store.whatsapp_link_enabled === false) return '';

  const number = normalizeNumber(store.whatsapp_number);
  if (!number) return '';

  const business = store.business_name || store.name || '';
  const product = resolveProduct(store, productOrName);
  const greeting = `Hi${business ? ' ' + business : ''}!`;

  let prefill;

  if (product) {
    const name = String(product.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    prefill = `${greeting} I'm interested in ${name} (Code: ${productCode(product)})`;
  } else if (typeof productOrName === 'string' && productOrName.trim()) {
    prefill = `${greeting} I'm interested in ${productOrName.trim().slice(0, 60)}`;
  } else {
    prefill = `${greeting} I have a question about your products`;
  }

  return `https://wa.me/${number}?text=${encodeURIComponent(prefill)}`;
}

/*
 * Appends the WhatsApp link to a DM text.
 * Instagram DMs allow ~1000 characters, so the original text is shortened
 * (never the link) when needed.
 */
function withWhatsAppLink(store, text, productOrName, maxLen = 1000) {
  const body = String(text || '').trim();
  const link = buildWhatsAppLink(store, productOrName);

  if (!body || !link) return body;

  const tail = `\n\n💬 Chat with us on WhatsApp:\n${link}`;

  if (body.length + tail.length <= maxLen) return body + tail;

  const room = maxLen - tail.length - 1;

  // If the link itself is too long for the limit, skip it rather than break the reply
  if (room < 80) return body.slice(0, maxLen);

  return body.slice(0, room).trimEnd() + '…' + tail;
}

module.exports = {
  normalizeNumber,
  buildWhatsAppLink,
  withWhatsAppLink,
  productCode,
  extractRef,
  findProductByRef
};

