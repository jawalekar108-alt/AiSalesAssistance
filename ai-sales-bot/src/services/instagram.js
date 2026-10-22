//21/10

const axios = require('axios');
const crypto = require('crypto');
const db = require('../config/database');
const secrets = require('../utils/secrets');
const { buildWhatsAppLink, withWhatsAppLink } = require('./whatsappLink');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const IG_HOST = 'https://graph.instagram.com';
const FB_HOST = 'https://graph.facebook.com';

const DEFAULT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments'
];

/* ============================================================
 * TOKEN HELPERS
 * ============================================================ */

function cleanToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function looksLikeToken(t) {
  return typeof t === 'string' && t.length >= 40 && !/\s/.test(t);
}

// Instagram Login tokens start with IGAA / IGQV...; Facebook tokens start with EAA...
function isInstagramToken(t) {
  return /^IG/.test(t);
}

/*
 * Find a tenant by ANY Instagram id (webhook id or app-scoped id).
 * Lives here so database.js does not need to be edited.
 */
function findStoreByInstagramId(id) {
  if (!id) return null;
  const wanted = String(id);

  return (
    db.getStores().find(
      s =>
        String(s.instagram_user_id || '') === wanted ||
        String(s.instagram_scoped_id || '') === wanted
    ) || null
  );
}

function defaultStoreId() {
  return process.env.DEFAULT_STORE_TYPE || 'clothing';
}

/*
 * The host (graph.instagram.com vs graph.facebook.com) is decided from the
 * SAME token that is actually sent.
 */
function resolveCredentials(store) {
  let token = '';

  try {
    token = cleanToken(secrets.decrypt(store?.instagram_access_token));
  } catch (e) {
    console.error('[IG] Could not decrypt token for store', store?.id, e.message);
  }

  let source = 'store';

  if (!looksLikeToken(token)) {
    token = '';

    // Env-token fallback is ONLY for the legacy default store (single-tenant mode).
    const envToken = cleanToken(
      process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN
    );

    const allowFallback =
      process.env.ALLOW_ENV_TOKEN_FALLBACK !== 'false' &&
      store &&
      String(store.id) === String(defaultStoreId());

    if (allowFallback && looksLikeToken(envToken)) {
      token = envToken;
      source = 'env';
    }
  }

  if (!looksLikeToken(token)) {
    const err = new Error(
      `No valid Instagram token for store "${store?.id}". ` +
      `Connect it: /api/instagram/connect?store_id=${store?.id}`
    );
    err.code = 'NO_TOKEN';
    throw err;
  }

  const igLogin = isInstagramToken(token);

  return {
    token,
    source,
    igLogin,
    host: igLogin ? IG_HOST : FB_HOST,
    accountId: store?.instagram_user_id || process.env.INSTAGRAM_ACCOUNT_ID || ''
  };
}

// Safe for logs - never prints the token itself.
function describeCredentials(store) {
  try {
    const c = resolveCredentials(store);
    return { source: c.source, host: c.host, prefix: c.token.slice(0, 4), length: c.token.length };
  } catch (e) {
    return { error: e.message };
  }
}

/* ============================================================
 * GRAPH REQUEST
 * ============================================================ */

async function graphRequest(store, creds, method, path, body) {
  try {
    const res = await axios({
      method,
      url: `${creds.host}/${GRAPH_VERSION}/${path}`,
      data: body,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    return res.data;
  } catch (error) {
    const graph = error.response?.data?.error || null;

    if (graph?.code === 190 && creds.source === 'store' && store?.id) {
      db.updateStore(store.id, { instagram_token_status: 'invalid' });
    }

    const err = new Error(graph?.message || error.message);
    err.graph = graph;
    err.status = error.response?.status;
    throw err;
  }
}

function messagesPath(creds) {
  // With an Instagram Login token "me" always resolves to the right account.
  return creds.igLogin ? 'me/messages' : `${creds.accountId}/messages`;
}

/* ============================================================
 * SEND DM / REPLY TO COMMENT
 * ============================================================ */

async function sendDM(store, recipientId, text) {
  const creds = resolveCredentials(store);

  return graphRequest(store, creds, 'post', messagesPath(creds), {
    recipient: { id: String(recipientId) },
    message: { text: String(text).slice(0, 1000) }
  });
}

// Public reply under the comment
async function replyToComment(store, commentId, text) {
  const creds = resolveCredentials(store);

  return graphRequest(store, creds, 'post', `${commentId}/replies`, {
    message: String(text).slice(0, 2000)
  });
}

// Private reply (DM) to a person who commented - allowed once per comment, within 7 days
async function privateReplyToComment(store, commentId, text) {
  const creds = resolveCredentials(store);

  return graphRequest(store, creds, 'post', messagesPath(creds), {
    recipient: { comment_id: String(commentId) },
    message: { text: String(text).slice(0, 1000) }
  });
}

/*
 * Product picture in the chat. Instagram downloads the picture itself, so the link must be public:
 * pictures saved on this server ("/uploads/...") need PUBLIC_BASE_URL in .env (your ngrok / website address).
 */
function publicImageUrl(imageUrl) {
  const url = String(imageUrl || '').trim();

  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;

  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

  if (!base) {
    console.warn('[IG] Cannot send the product picture: set PUBLIC_BASE_URL in .env (your public https address)');
    return '';
  }

  return base + (url.startsWith('/') ? url : '/' + url);
}

async function sendImageDM(store, recipientId, imageUrl) {
  const creds = resolveCredentials(store);

  return graphRequest(store, creds, 'post', messagesPath(creds), {
    recipient: { id: String(recipientId) },
    message: { attachment: { type: 'image', payload: { url: imageUrl } } }
  });
}

/* ============================================================
 * WHATSAPP BUTTON (tap button inside the Instagram chat)
 *
 * Instagram "button template": message text (max 640 chars) + a button that opens
 * wa.me/<store number>?text=...(Code: XXXXX). If Instagram refuses the button
 * (for example on some private replies), the plain text + link is sent instead,
 * so the customer always gets an answer.
 * ============================================================ */

function clipText(text, max) {
  const s = String(text || '').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function whatsappButtonMessage(text, url) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: clipText(text, 640) || 'Chat with us on WhatsApp',
        buttons: [{ type: 'web_url', url, title: '💬 Chat on WhatsApp' }]
      }
    }
  };
}

// productOrName: a product object, or a product name (both are understood by whatsappLink)
async function sendDMWithWhatsApp(store, recipientId, text, productOrName) {
  const link = buildWhatsAppLink(store, productOrName);

  if (!link) return sendDM(store, recipientId, text);

  const creds = resolveCredentials(store);

  try {
    return await graphRequest(store, creds, 'post', messagesPath(creds), {
      recipient: { id: String(recipientId) },
      message: whatsappButtonMessage(text, link)
    });
  } catch (error) {
    console.warn('[IG] Button message failed, sending text link instead:', error.graph?.message || error.message);

    return sendDM(store, recipientId, withWhatsAppLink(store, text, productOrName));
  }
}

async function privateReplyWithWhatsApp(store, commentId, text, productOrName) {
  const link = buildWhatsAppLink(store, productOrName);

  if (!link) return privateReplyToComment(store, commentId, text);

  const creds = resolveCredentials(store);

  try {
    return await graphRequest(store, creds, 'post', messagesPath(creds), {
      recipient: { comment_id: String(commentId) },
      message: whatsappButtonMessage(text, link)
    });
  } catch (error) {
    console.warn('[IG] Private reply button failed, sending text link instead:', error.graph?.message || error.message);

    return privateReplyToComment(store, commentId, withWhatsAppLink(store, text, productOrName));
  }
}

/* ============================================================
 * OAUTH (Instagram Business Login) - multi tenant connect flow
 * ============================================================ */

function requireAppConfig() {
  const id = process.env.INSTAGRAM_APP_ID;
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const redirect = process.env.INSTAGRAM_REDIRECT_URI;

  if (!id || !secret || !redirect) {
    throw new Error('Set INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and INSTAGRAM_REDIRECT_URI in .env');
  }

  return { id, secret, redirect };
}

function signState(storeId) {
  const { secret } = requireAppConfig();

  const payload = Buffer.from(
    JSON.stringify({ s: storeId, t: Date.now(), n: crypto.randomBytes(6).toString('hex') })
  ).toString('base64url');

  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return `${payload}.${sig}`;
}

function verifyState(state) {
  try {
    const { secret } = requireAppConfig();
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) return null;

    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.t > 15 * 60 * 1000) return null; // 15 minutes

    return data.s;
  } catch {
    return null;
  }
}

function buildAuthUrl(storeId) {
  const { id, redirect } = requireAppConfig();

  const scopes = process.env.INSTAGRAM_SCOPES
    ? process.env.INSTAGRAM_SCOPES.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_SCOPES;

  const params = new URLSearchParams({
    force_reauth: 'true',
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: scopes.join(','),
    state: signState(storeId)
  });

  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const { id, secret, redirect } = requireAppConfig();

  const form = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code: String(code).replace(/#_$/, '')
  });

  const res = await axios.post('https://api.instagram.com/oauth/access_token', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  const d = res.data?.data?.[0] || res.data;

  if (!d?.access_token) throw new Error('Instagram did not return an access token');

  return { accessToken: d.access_token, userId: d.user_id ? String(d.user_id) : null };
}

async function toLongLived(shortToken) {
  const { secret } = requireAppConfig();

  const res = await axios.get(`${IG_HOST}/access_token`, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: secret,
      access_token: shortToken
    },
    timeout: 15000
  });

  return { token: res.data.access_token, expiresIn: Number(res.data.expires_in) || 60 * 24 * 3600 };
}

async function fetchProfile(token) {
  const res = await axios.get(`${IG_HOST}/${GRAPH_VERSION}/me`, {
    params: { fields: 'user_id,username,account_type,name', access_token: token },
    timeout: 15000
  });

  return res.data; // { user_id: '1784...', id: '2803...', username, ... }
}

async function subscribeWebhooks(token) {
  const res = await axios.post(
    `${IG_HOST}/${GRAPH_VERSION}/me/subscribed_apps`,
    null,
    {
      params: { subscribed_fields: 'messages,comments' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    }
  );

  return res.data;
}

async function connectStoreFromCode(storeId, code) {
  const store = db.getStore(storeId);
  if (!store) throw new Error('Store not found');

  const short = await exchangeCode(code);
  const long = await toLongLived(short.accessToken);
  const profile = await fetchProfile(long.token);

  // webhook "entry.id" is the professional account id = profile.user_id
  const webhookId = String(profile.user_id || short.userId || profile.id);

  const owner = findStoreByInstagramId(webhookId);
  if (owner && String(owner.id) !== String(store.id)) {
    throw new Error(`@${profile.username} is already connected to another business`);
  }

  let subscribed = true;
  try {
    await subscribeWebhooks(long.token);
  } catch (e) {
    subscribed = false;
    console.error('[IG] subscribed_apps failed:', e.response?.data || e.message);
  }

  const updated = db.updateStore(store.id, {
    instagram_access_token: secrets.encrypt(long.token),
    instagram_user_id: webhookId,
    instagram_scoped_id: profile.id ? String(profile.id) : null,
    instagram_username: profile.username || null,
    instagram_token_expires_at: new Date(Date.now() + long.expiresIn * 1000).toISOString(),
    instagram_token_status: 'active',
    instagram_connected_at: new Date().toISOString(),
    instagram_webhook_subscribed: subscribed
  });

  return { store: updated, username: profile.username, subscribed };
}

/* ============================================================
 * TOKEN REFRESH (long-lived tokens last 60 days)
 * ============================================================ */

async function refreshStoreToken(store) {
  const token = cleanToken(secrets.decrypt(store.instagram_access_token));

  const res = await axios.get(`${IG_HOST}/refresh_access_token`, {
    params: { grant_type: 'ig_refresh_token', access_token: token },
    timeout: 15000
  });

  const expiresIn = Number(res.data.expires_in) || 60 * 24 * 3600;

  db.updateStore(store.id, {
    instagram_access_token: secrets.encrypt(res.data.access_token || token),
    instagram_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    instagram_token_status: 'active'
  });
}

async function refreshExpiringTokens() {
  for (const store of db.getStores()) {
    if (!store.instagram_access_token || !store.instagram_token_expires_at) continue;

    const left = Date.parse(store.instagram_token_expires_at) - Date.now();
    if (left > 10 * 24 * 3600 * 1000) continue;

    try {
      await refreshStoreToken(store);
      console.log(`[IG] Token refreshed for store ${store.id}`);
    } catch (e) {
      console.error(`[IG] Token refresh failed for ${store.id}:`, e.response?.data || e.message);
      db.updateStore(store.id, { instagram_token_status: 'refresh_failed' });
    }
  }
}

function startTokenRefreshWorker() {
  setTimeout(() => refreshExpiringTokens().catch(() => {}), 30 * 1000);
  setInterval(() => refreshExpiringTokens().catch(() => {}), 12 * 3600 * 1000);
}

/* ============================================================
 * LIST MEDIA (used by catalog sync) - uses THIS tenant's token
 * ============================================================ */

async function listMedia(store, maxPages = 10) {
  const creds = resolveCredentials(store);

  const owner = creds.igLogin ? 'me' : creds.accountId;
  if (!owner) throw new Error('Instagram account id is missing for this store');

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';

  let url =
    `${creds.host}/${GRAPH_VERSION}/${owner}/media` +
    `?fields=${encodeURIComponent(fields)}&limit=100`;

  const all = [];

  for (let page = 0; url && page < maxPages; page++) {
    let res;

    try {
      res = await axios.get(url, {
        headers: { Authorization: `Bearer ${creds.token}` },
        timeout: 20000
      });
    } catch (error) {
      const graph = error.response?.data?.error || null;

      if (graph?.code === 190 && creds.source === 'store' && store?.id) {
        db.updateStore(store.id, { instagram_token_status: 'invalid' });
      }

      const err = new Error(graph?.message || error.message);
      err.graph = graph;
      err.status = error.response?.status;
      throw err;
    }

    if (Array.isArray(res.data?.data)) all.push(...res.data.data);

    url = res.data?.paging?.next || null;
  }

  return all;
}

module.exports = {
  findStoreByInstagramId,
  listMedia,
  sendDM,
  sendDMWithWhatsApp,
  sendImageDM,
  publicImageUrl,
  replyToComment,
  privateReplyToComment,
  privateReplyWithWhatsApp,
  describeCredentials,
  buildAuthUrl,
  verifyState,
  connectStoreFromCode,
  startTokenRefreshWorker
};

