//15/10

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const router = express.Router();

const db = require('../config/database');
const secrets = require('../utils/secrets');
const wa = require('../services/whatsapp');

/*
 * WHATSAPP EMBEDDED SIGNUP  (1-click WhatsApp connect for a client)
 *
 *   GET  /api/whatsapp-onboard/config
 *   GET  /api/whatsapp-onboard/status?store_id=...
 *   POST /api/whatsapp-onboard/complete     { code, waba_id, phone_number_id, store_id }
 *   POST /api/whatsapp-onboard/disconnect   { store_id }
 *   GET  /api/whatsapp-onboard/health?store_id=...
 *   POST /api/whatsapp-onboard/test-send    { store_id, to }
 *
 * .env: META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID, (optional) WHATSAPP_ES_REDIRECT_URI
 * Mounted in server.js behind auth.requireAuth.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const HOST = 'https://graph.facebook.com';

function settings() {
  return {
    appId: String(process.env.META_APP_ID || '').trim(),
    secret: String(process.env.META_APP_SECRET || '').trim(),
    configId: String(process.env.WHATSAPP_ES_CONFIG_ID || '').trim(),
    redirectUri: String(process.env.WHATSAPP_ES_REDIRECT_URI || '').trim()
  };
}

/* A logged-in business is locked to its own store. Admin picks a store. */
function getStore(req, res) {
  const id = req.user?.store_id || req.headers['x-store-id'] || req.query.store_id || req.body?.store_id || null;

  if (!id) {
    res.status(400).json({ success: false, error: 'store_id is required' });
    return null;
  }

  const store = db.getStore(id);

  if (!store) {
    res.status(404).json({ success: false, error: 'Store not found' });
    return null;
  }

  if (req.user?.store_id && String(req.user.store_id) !== String(store.id)) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }

  return store;
}

async function graph(method, path, { token, params, data } = {}) {
  try {
    const res = await axios({
      method,
      url: `${HOST}/${GRAPH_VERSION}/${path}`,
      params,
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeout: 20000
    });

    return res.data;
  } catch (error) {
    const g = error.response?.data?.error || null;

    const err = new Error(g?.message || error.message);
    err.graph = g;
    throw err;
  }
}

async function assertWabaBelongsToToken(token, wabaId, s) {
  const result = await graph('get', 'debug_token', {
    params: { input_token: token, access_token: `${s.appId}|${s.secret}` }
  });

  const info = result?.data || {};

  if (info.is_valid === false) throw new Error('Meta says this access token is not valid');

  const scopes = Array.isArray(info.granular_scopes) ? info.granular_scopes : [];

  const whatsappScopes = scopes.filter(
    item => item.scope === 'whatsapp_business_management' || item.scope === 'whatsapp_business_messaging'
  );

  if (whatsappScopes.length) {
    const allowed = whatsappScopes.flatMap(item => item.target_ids || []).map(String);

    if (!allowed.includes(String(wabaId))) {
      throw new Error('This WhatsApp Business Account does not belong to the Meta account that signed in.');
    }
  }
}

function view(store) {
  return {
    store_id: store.id,
    connected: Boolean(store.whatsapp_phone_number_id && store.whatsapp_access_token),
    via: store.whatsapp_onboarded_via || null,
    whatsapp_number: store.whatsapp_number || '',
    verified_name: store.whatsapp_verified_name || '',
    waba_id: store.whatsapp_waba_id || '',
    connected_at: store.whatsapp_connected_at || null
  };
}

const HINTS = {
  exchange:
    'The sign-in code is only valid for a short time and can be used once. Try again. If it keeps failing, check META_APP_ID / META_APP_SECRET, and that this website address is in the Allowed domains and Valid OAuth redirect URIs of your Facebook Login for Business settings.',
  verify:
    'The new token could not read that phone number. Make sure the person completed the whole signup, including the phone number step.',
  register:
    'Registering the number for Cloud API failed. If the number is still active in the normal WhatsApp or WhatsApp Business app, it must be removed there first.',
  subscribe:
    'Could not subscribe your app to this WhatsApp Business Account, so no customer messages would arrive. Check that the app has the whatsapp_business_management permission.',
  save: 'Saving to the server failed. Check the server log.'
};

/* ============================================================
 * ROUTES
 * ============================================================ */

router.get('/config', (req, res) => {
  const s = settings();

  res.json({
    success: true,
    enabled: Boolean(s.appId && s.secret && s.configId),
    app_id: s.appId || null,
    config_id: s.configId || null,
    graph_version: GRAPH_VERSION
  });
});

router.get('/status', (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  res.json({ success: true, status: view(store) });
});

router.post('/complete', async (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  const s = settings();

  if (!s.appId || !s.secret || !s.configId) {
    return res.status(503).json({
      success: false,
      error: 'Embedded Signup is not enabled on the server yet (META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID).'
    });
  }

  const code = String(req.body?.code || '').trim();
  const wabaId = String(req.body?.waba_id || '').trim();
  const phoneId = String(req.body?.phone_number_id || '').trim();

  if (code.length < 10 || code.length > 4000) {
    return res.status(400).json({ success: false, error: 'Missing sign-in code' });
  }

  if (!/^\d{5,25}$/.test(wabaId) || !/^\d{5,25}$/.test(phoneId)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid waba_id / phone_number_id' });
  }

  // One phone number belongs to one business
  const clash = db
    .getStores()
    .find(item => String(item.id) !== String(store.id) && String(item.whatsapp_phone_number_id || '') === phoneId);

  if (clash) {
    return res.status(409).json({ success: false, error: 'This WhatsApp number is already connected to another business.' });
  }

  let step = 'exchange';

  try {
    // 1) exchange the one-time code for this customer's business token
    const exchanged = await graph('get', 'oauth/access_token', {
      params: {
        client_id: s.appId,
        client_secret: s.secret,
        code,
        ...(s.redirectUri ? { redirect_uri: s.redirectUri } : {})
      }
    });

    const token = exchanged.access_token;
    if (!token) throw new Error('Meta did not return an access token');

    // 2) never trust ids sent by the browser: check them against the new token
    step = 'verify';

    await assertWabaBelongsToToken(token, wabaId, s);

    const phone = await graph('get', phoneId, {
      token,
      params: { fields: 'display_phone_number,verified_name,platform_type' }
    });

    // 3) register the number for Cloud API (skipped if it already is)
    let pin = null;

    if (phone.platform_type !== 'CLOUD_API') {
      step = 'register';
      pin = String(crypto.randomInt(100000, 1000000));

      await graph('post', `${phoneId}/register`, {
        token,
        data: { messaging_product: 'whatsapp', pin }
      });
    }

    // 4) make Meta send this customer's messages to our webhook
    step = 'subscribe';

    await graph('post', `${wabaId}/subscribed_apps`, { token });

    // 5) save on this store
    step = 'save';

    const digits = String(phone.display_phone_number || '').replace(/\D/g, '');

    const updated = db.updateStore(store.id, {
      whatsapp_access_token: secrets.encrypt(token),
      whatsapp_phone_number_id: phoneId,
      whatsapp_waba_id: wabaId,
      whatsapp_number: digits.length >= 11 && digits.length <= 15 ? digits : store.whatsapp_number || '',
      whatsapp_verified_name: phone.verified_name || '',
      whatsapp_link_enabled: true,
      whatsapp_onboarded_via: 'embedded_signup',
      whatsapp_connected_at: new Date().toISOString(),
      ...(pin ? { whatsapp_register_pin: secrets.encrypt(pin) } : {})
    });

    console.log(`[WA-ONBOARD] Connected store ${store.id}: phone_number_id=${phoneId} waba=${wabaId}`);

    res.json({
      success: true,
      status: view(updated),
      next:
        'Connected. Add a payment method in WhatsApp Manager so messages that Meta charges for can be sent. Replies inside 24 hours are free.'
    });
  } catch (error) {
    console.error(`[WA-ONBOARD] Failed at "${step}":`, error.graph || error.message);

    res.status(502).json({
      success: false,
      step,
      error: error.message,
      meta: error.graph || null,
      hint: HINTS[step] || ''
    });
  }
});

router.post('/disconnect', async (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  // Stop Meta from sending this customer's messages to us (best effort)
  try {
    if (store.whatsapp_waba_id && store.whatsapp_access_token && typeof secrets.decrypt === 'function') {
      const token = secrets.decrypt(store.whatsapp_access_token);

      if (token) await graph('delete', `${store.whatsapp_waba_id}/subscribed_apps`, { token });
    }
  } catch (error) {
    console.warn(`[WA-ONBOARD] Could not unsubscribe store ${store.id}:`, error.graph || error.message);
  }

  const updated = db.updateStore(store.id, {
    whatsapp_access_token: null,
    whatsapp_phone_number_id: '',
    whatsapp_waba_id: '',
    whatsapp_verified_name: '',
    whatsapp_register_pin: null,
    whatsapp_onboarded_via: null,
    whatsapp_connected_at: null
  });

  res.json({ success: true, status: view(updated) });
});

/* ============================================================
 * HEALTH CHECK: tells the owner exactly what is working
 * ============================================================ */

router.get('/health', async (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail || '' });

  const s = settings();

  add(
    'Server: META_VERIFY_TOKEN set',
    Boolean(process.env.META_VERIFY_TOKEN),
    process.env.META_VERIFY_TOKEN ? '' : 'Set it in .env so the webhook stops using the old built-in tokens'
  );

  add(
    'Server: 1-click signup configured',
    Boolean(s.appId && s.secret && s.configId),
    'Needs META_APP_ID, META_APP_SECRET and WHATSAPP_ES_CONFIG_ID'
  );

  let creds = null;

  try {
    creds = wa.resolve(store);
    add('Token and phone number saved for this business', true, `phone_number_id ${creds.phoneId}`);
  } catch (error) {
    add('Token and phone number saved for this business', false, 'Not connected yet. Press Connect WhatsApp.');
  }

  if (creds) {
    try {
      const phone = await graph('get', creds.phoneId, {
        token: creds.token,
        params: { fields: 'display_phone_number,verified_name,quality_rating,platform_type,status,name_status' }
      });

      add('Token works and can read the number', true, `${phone.display_phone_number || ''} (${phone.verified_name || 'no name'})`);
      add('Number status is CONNECTED', phone.status === 'CONNECTED', `status: ${phone.status || 'unknown'}`);
      add('Number runs on Cloud API', phone.platform_type === 'CLOUD_API', `platform: ${phone.platform_type || 'unknown'}`);
      add('Display name', !phone.name_status || phone.name_status === 'APPROVED', `name status: ${phone.name_status || 'unknown'}`);
      add('Quality rating', phone.quality_rating !== 'RED', `quality: ${phone.quality_rating || 'unknown'}`);
    } catch (error) {
      const code = error.graph?.code;

      add(
        'Token works and can read the number',
        false,
        `${error.message}${code === 190 ? ' (token expired: reconnect WhatsApp)' : ''}`
      );
    }

    if (store.whatsapp_waba_id) {
      try {
        const subs = await graph('get', `${store.whatsapp_waba_id}/subscribed_apps`, { token: creds.token });
        const list = Array.isArray(subs?.data) ? subs.data : [];

        add(
          'Messages are delivered to this app (subscribed_apps)',
          list.length > 0,
          list.length ? 'subscribed' : 'No app subscribed: customer messages will NOT arrive. Reconnect WhatsApp.'
        );
      } catch (error) {
        add('Messages are delivered to this app (subscribed_apps)', false, error.message);
      }
    } else {
      add(
        'Messages are delivered to this app (subscribed_apps)',
        true,
        'Not checked: no waba_id saved (normal for the Meta test number or a manual setup)'
      );
    }
  }

 // res.json({ success: true, all_ok: checks.every(c => c.ok), checks });

res.json({
  success: true,
  store_used: store.id,
  phone_number_id_saved: store.whatsapp_phone_number_id || null,
  all_ok: checks.every(c => c.ok),
  checks
});


});

/* ============================================================
 * TEST MESSAGE
 * ============================================================ */

router.post('/test-send', async (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  const to = String(req.body?.to || '').replace(/\D/g, '');

  if (to.length < 10 || to.length > 15) {
    return res
      .status(400)
      .json({ success: false, error: 'Enter the phone number with country code, digits only (for example 919876543210).' });
  }

  try {
    await wa.sendTextOrTemplate(
      store,
      to,
      `✅ Test message from ${store.business_name || store.name || 'your store'}. WhatsApp is connected!`,
      { name: 'hello_world', language: 'en_US' }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error.message,
      hint: error.hint || '',
      meta: error.graph || null
    });
  }
});

module.exports = router;

