//13/10
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../config/database');
const secrets = require('../utils/secrets');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const HOST = 'https://graph.facebook.com';

function clean(raw) {
  return String(raw || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function defaultStoreId() {
  return process.env.DEFAULT_STORE_TYPE || 'clothing';
}

function resolve(store) {
  let token = '';

  try {
    token = clean(secrets.decrypt(store?.whatsapp_access_token));
  } catch (error) {
    console.error('[WA] Could not decrypt WhatsApp token for', store?.id, error.message);
  }

  let phoneId = String(store?.whatsapp_phone_number_id || '').trim();
  const isDefault = store && String(store.id) === String(defaultStoreId());

  if (!token && isDefault && process.env.ALLOW_ENV_TOKEN_FALLBACK !== 'false') {
    token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  }

  if (!phoneId && isDefault) {
    phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  }

  if (!token || !phoneId) {
    const error = new Error(`WhatsApp is not set up for store "${store?.id}"`);
    error.code = 'NO_WHATSAPP';
    throw error;
  }

  return { token, phoneId };
}

function isConfigured(store) {
  try {
    resolve(store);
    return true;
  } catch {
    return false;
  }
}

function findStoreByPhoneNumberId(id) {
  const wanted = String(id || '');
  if (!wanted) return null;

  const store = db.getStores().find(item => String(item.whatsapp_phone_number_id || '') === wanted);
  if (store) return store;

  const envPhoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
  if (envPhoneId && envPhoneId === wanted) return db.getStore(defaultStoreId());

  return null;
}

/* ---------- readable error hints ---------- */

function hintFor(graphError) {
  const code = graphError?.code;

  if (code === 190) return 'Access token expired or invalid. If this business used 1-click signup, ask them to press Connect WhatsApp again. Otherwise create a permanent System User token and save it again (node set_whatsapp.js ...).';
  if (code === 131030) return 'Recipient is not in the allowed list. With Meta TEST numbers, add the customer phone under WhatsApp > API Setup > "To".';
  if (code === 131047) return 'More than 24 hours since the customer last messaged. Only approved templates can be sent now.';
  if (code === 131009) return 'A parameter is invalid (button title > 20 chars, empty list row, etc.).';
  if (code === 131053) return 'WhatsApp could not download the media file.';
  if (code === 100) return 'Bad request. Check phone_number_id and the message format.';
  return '';
}

async function post(store, payload, { raw = false } = {}) {
  const { token, phoneId } = resolve(store);

  const body = raw
    ? { messaging_product: 'whatsapp', ...payload }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload };

  try {
    const response = await axios.post(`${HOST}/${GRAPH_VERSION}/${phoneId}/messages`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    return response.data;
  } catch (error) {
    const graphError = error.response?.data?.error || null;
    const hint = hintFor(graphError);

    console.error(
      `[WA] Send failed (store ${store?.id}): code=${graphError?.code} msg=${graphError?.message || error.message}` +
        (hint ? `\n[WA] HINT: ${hint}` : '')
    );

    const wrappedError = new Error(graphError?.message || error.message);
    wrappedError.graph = graphError;
    wrappedError.hint = hint;
    wrappedError.status = error.response?.status;
    throw wrappedError;
  }
}

/* ============================================================
 * IMAGE UPLOAD
 * Instagram image links often cannot be downloaded by WhatsApp. We load the
 * picture ourselves (from disk for photos uploaded in the dashboard, from the
 * web for Instagram photos), upload it to WhatsApp and send the media id.
 * Needs Node 18+.
 * ============================================================ */

const mediaCache = new Map(); // url -> { id, at }
const MEDIA_TTL = 20 * 24 * 3600 * 1000; // WhatsApp keeps media 30 days

const UPLOADS_ROOT = path.resolve(path.join(__dirname, '../public/uploads'));

async function loadImageBytes(url) {
  // Photos uploaded from the dashboard live on this server
  if (String(url).startsWith('/uploads/')) {
    const file = path.resolve(path.join(__dirname, '../public', String(url).split('?')[0]));

    if (!file.startsWith(UPLOADS_ROOT)) throw new Error('Invalid image path');

    const data = await fs.promises.readFile(file);
    const type = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

    return { data, type };
  }

  const img = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 5 * 1024 * 1024
  });

  const type = String(img.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (type !== 'image/jpeg' && type !== 'image/png') {
    throw new Error(`Unsupported image type: ${type || 'unknown'}`);
  }

  return { data: img.data, type };
}

async function uploadImage(store, url) {
  const { token, phoneId } = resolve(store);

  // A WhatsApp media id only works for the phone number that uploaded it,
  // so the cache is kept per number (a business that reconnects another number must not reuse old ids)
  const cacheKey = `${phoneId}|${url}`;
  const cached = mediaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MEDIA_TTL) return cached.id;

  const { data, type } = await loadImageBytes(url);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', type);
  form.append('file', new Blob([data], { type }), type === 'image/png' ? 'product.png' : 'product.jpg');

  const res = await fetch(`${HOST}/${GRAPH_VERSION}/${phoneId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.id) {
    throw new Error(json?.error?.message || `Media upload failed (${res.status})`);
  }

  if (mediaCache.size > 500) mediaCache.clear();
  mediaCache.set(cacheKey, { id: json.id, at: Date.now() });

  return json.id;
}

/* ============================================================
 * SENDERS
 * ============================================================ */

function forgetImage(store, url) {
  try {
    mediaCache.delete(`${resolve(store).phoneId}|${url}`);
  } catch {
    /* ignore */
  }
}

function sendText(store, to, body) {
  return post(store, {
    to,
    type: 'text',
    text: { body: clip(body, 4000), preview_url: false }
  });
}

async function sendButtons(store, to, { body, buttons = [], image, footer }) {
  const interactive = {
    type: 'button',
    body: { text: clip(body, 1024) },
    action: {
      buttons: buttons.slice(0, 3).map(button => ({
        type: 'reply',
        reply: {
          id: clip(button.id, 256),
          title: clip(button.title, 20)
        }
      }))
    }
  };

  if (footer) interactive.footer = { text: clip(footer, 60) };

  let usedImage = false;

  if (image) {
    try {
      const mediaId = await uploadImage(store, image);
      interactive.header = { type: 'image', image: { id: mediaId } };
      usedImage = true;
    } catch (error) {
      // Could not prepare the picture: send the card without it (never lose the message)
      console.warn('[WA] Image skipped:', error.message);
    }
  }

  try {
    return await post(store, { to, type: 'interactive', interactive });
  } catch (error) {
    // WhatsApp rejected the picture (old / wrong media id): forget it and send the card without it
    if (usedImage && [100, 131053].includes(error.graph?.code)) {
      console.warn('[WA] Picture rejected by WhatsApp, resending the card without it');
      forgetImage(store, image);
      delete interactive.header;

      return post(store, { to, type: 'interactive', interactive });
    }

    throw error;
  }
}

function sendList(store, to, { body, button, rows = [], sectionTitle, footer }) {
  const interactive = {
    type: 'list',
    body: { text: clip(body, 1024) },
    action: {
      button: clip(button || 'View options', 20),
      sections: [
        {
          title: clip(sectionTitle || 'Options', 24),
          rows: rows.slice(0, 10).map(row => ({
            id: clip(row.id, 200),
            title: clip(row.title || 'Item', 24),
            ...(row.description ? { description: clip(row.description, 72) } : {})
          }))
        }
      ]
    }
  };

  if (footer) interactive.footer = { text: clip(footer, 60) };

  return post(store, { to, type: 'interactive', interactive });
}

/*
 * Approved message template. Needed whenever the customer last wrote more than 24 hours ago
 * (order status updates, follow-ups). Example:
 *   sendTemplate(store, '9198...', {
 *     name: 'order_update', language: 'en',
 *     components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'ORD-12' }] }]
 *   })
 */
function sendTemplate(store, to, { name, language = 'en', components = [] }) {
  return post(store, {
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(components.length ? { components } : {})
    }
  });
}

/*
 * Normal message first. If WhatsApp says the 24-hour window is closed (code 131047),
 * send the approved template instead (when one is given).
 */
async function sendTextOrTemplate(store, to, body, template) {
  try {
    return await sendText(store, to, body);
  } catch (error) {
    if (error.graph?.code === 131047 && template?.name) return sendTemplate(store, to, template);
    throw error;
  }
}

function markRead(store, messageId) {
  // Skip simulated messages (fake ids) so Meta is not called with them
  if (!messageId || String(messageId).startsWith('wamid.TEST')) return Promise.resolve();

  return post(store, { status: 'read', message_id: messageId }, { raw: true });
}

module.exports = {
  clip,
  resolve,
  isConfigured,
  findStoreByPhoneNumberId,
  uploadImage,
  sendText,
  sendButtons,
  sendList,
  sendTemplate,
  sendTextOrTemplate,
  markRead
};


