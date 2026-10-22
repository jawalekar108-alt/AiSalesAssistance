//13/10

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const router = express.Router();

const db = require('../config/database');
const secrets = require('../utils/secrets');
const wa = require('../services/whatsapp');
const { normalizeNumber, buildWhatsAppLink } = require('../services/whatsappLink');

/*
 * Per-business WhatsApp settings (multi-tenant).
 *
 *   GET  /api/whatsapp/:storeId           -> current settings (token is never returned)
 *   PUT  /api/whatsapp/:storeId           -> save settings
 *   POST /api/whatsapp/:storeId/test      -> send a test message { "to": "919876543210" }
 *   GET  /api/whatsapp/:storeId/diagnose  -> checks the token and phone number id with Meta
 *
 * SECURITY
 *   Set ADMIN_API_KEY in .env and send it as header  x-admin-key.
 *   Without ADMIN_API_KEY these routes only answer direct requests from this same computer
 *   (requests coming through ngrok / a proxy are refused).
 *   If your dashboard already has a login for tenants, replace guard() with that middleware
 *   and make sure a tenant can only open its own :storeId.
 */

/* ============================================================
 * ACCESS GUARD
 * ============================================================ */

function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));

  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isDirectLocalRequest(req) {
  if (req.get('x-forwarded-for') || req.get('forwarded')) return false;

  const ip = String(req.socket?.remoteAddress || '');

  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

function guard(req, res, next) {
  const key = process.env.ADMIN_API_KEY;

  if (key) {
    if (sameKey(req.get('x-admin-key'), key)) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (isDirectLocalRequest(req)) return next();

  return res.status(403).json({
    success: false,
    error: 'Set ADMIN_API_KEY in .env to use this API from another device.'
  });
}

router.use(guard);

/* ============================================================
 * HELPERS
 * ============================================================ */

function findStore(req, res) {
  const store = db.getStore(req.params.storeId);

  if (!store) {
    res.status(404).json({ success: false, error: `Store "${req.params.storeId}" not found` });
    return null;
  }

  return store;
}

function cleanToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function publicView(store) {
  return {
    store_id: store.id,
    business_name: store.business_name || store.name || '',
    whatsapp_number: store.whatsapp_number || '',
    whatsapp_phone_number_id: store.whatsapp_phone_number_id || '',
    whatsapp_link_enabled: store.whatsapp_link_enabled !== false,
    whatsapp_welcome_template: store.whatsapp_welcome_template || '',
    upi_id: store.upi_id || '',
    owner_whatsapp: store.owner_whatsapp || '',
    owner_email: store.owner_email || '',
    token_saved: Boolean(store.whatsapp_access_token),
    configured: wa.isConfigured(store),
    sample_link: buildWhatsAppLink(store, null)
  };
}

/* ============================================================
 * ROUTES
 * ============================================================ */

router.get('/:storeId', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  res.json({ success: true, settings: publicView(store) });
});

router.put('/:storeId', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const body = req.body || {};
  const updates = {};

  // Number customers chat with
  if (body.whatsapp_number !== undefined) {
    const raw = String(body.whatsapp_number || '').trim();

    if (raw === '') {
      updates.whatsapp_number = '';
    } else {
      const number = normalizeNumber(raw);

      if (!number) {
        return res.status(400).json({
          success: false,
          error: 'whatsapp_number must include the country code, e.g. 919876543210'
        });
      }

      updates.whatsapp_number = number;
    }
  }

  // Meta phone number id (must be unique: it decides which business receives a message)
  if (body.whatsapp_phone_number_id !== undefined) {
    const id = String(body.whatsapp_phone_number_id || '').trim();

    if (id !== '' && !/^\d{5,25}$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'whatsapp_phone_number_id must be the numeric "Phone number ID" from Meta (not the phone number)'
      });
    }

    if (id !== '') {
      const clash = db
        .getStores()
        .find(s => String(s.id) !== String(store.id) && String(s.whatsapp_phone_number_id || '') === id);

      if (clash) {
        return res.status(409).json({
          success: false,
          error: 'This phone number id is already used by another business'
        });
      }
    }

    updates.whatsapp_phone_number_id = id;
  }

  // Token: only changed when a new one is sent. Stored encrypted when TOKEN_ENCRYPTION_KEY is set.
  if (typeof body.whatsapp_access_token === 'string' && body.whatsapp_access_token.trim() !== '') {
    const token = cleanToken(body.whatsapp_access_token);

    if (token.length < 20) {
      return res.status(400).json({ success: false, error: 'whatsapp_access_token looks too short' });
    }

    updates.whatsapp_access_token = secrets.encrypt(token);
  }

  if (body.whatsapp_link_enabled !== undefined) {
    updates.whatsapp_link_enabled = body.whatsapp_link_enabled === true || body.whatsapp_link_enabled === 'true';
  }

  if (body.whatsapp_welcome_template !== undefined) {
    updates.whatsapp_welcome_template = String(body.whatsapp_welcome_template || '').slice(0, 900);
  }

  if (body.upi_id !== undefined) {
    updates.upi_id = String(body.upi_id || '').trim().slice(0, 80);
  }

  if (body.owner_whatsapp !== undefined) {
    const raw = String(body.owner_whatsapp || '').trim();

    if (raw === '') {
      updates.owner_whatsapp = '';
    } else {
      const number = normalizeNumber(raw);

      if (!number) {
        return res.status(400).json({ success: false, error: 'owner_whatsapp must include the country code, e.g. 919876543210' });
      }

      if (number === normalizeNumber(store.whatsapp_number)) {
        return res.status(400).json({ success: false, error: 'owner_whatsapp must be different from the business number the bot uses' });
      }

      updates.owner_whatsapp = number;
    }
  }

  if (body.owner_email !== undefined) {
    const email = String(body.owner_email || '').trim().slice(0, 120);

    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'owner_email is not a valid email address' });
    }

    updates.owner_email = email;
  }

  const saved = db.updateStore(store.id, updates);

  res.json({ success: true, settings: publicView(saved) });
});

router.post('/:storeId/test', async (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const to = String(req.body?.to || '').replace(/\D/g, '');

  if (to.length < 10) {
    return res.status(400).json({ success: false, error: 'Send { "to": "919876543210" } (country code + number)' });
  }

  try {
    const sent = await wa.sendText(
      store,
      to,
      `✅ WhatsApp is connected for ${store.business_name || store.name || 'your store'}.`
    );

    res.json({ success: true, sent });
  } catch (error) {
    if (error.code === 'NO_WHATSAPP') {
      return res.status(400).json({
        success: false,
        error: 'Save whatsapp_phone_number_id and whatsapp_access_token for this store first'
      });
    }

    res.status(502).json({
      success: false,
      error: error.message,
      meta: error.graph || null,
      hint:
        error.hint ||
        'Test numbers can only message recipients added in Meta, and plain text only works if that person messaged you in the last 24 hours.'
    });
  }
});

/*
 * Quick health check:
 *   curl http://localhost:3000/api/whatsapp/clothing/diagnose
 * If token_ok is false, replies cannot be sent (expired token / wrong phone number id).
 */
router.get('/:storeId/diagnose', async (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const report = {
    store_id: store.id,
    has_whatsapp_number: Boolean(store.whatsapp_number),
    has_phone_number_id: Boolean(store.whatsapp_phone_number_id),
    has_token: Boolean(store.whatsapp_access_token),
    has_verify_token: Boolean(process.env.META_VERIFY_TOKEN),
    welcome_template: store.whatsapp_welcome_template || '(default greeting)',
    product_count: db.getProducts(store.id).length
  };

  try {
    const { token, phoneId } = wa.resolve(store);

    const r = await axios.get(
      `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/${phoneId}`,
      {
        params: { fields: 'display_phone_number,verified_name,quality_rating' },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      }
    );

    report.meta = r.data;
    report.token_ok = true;
  } catch (error) {
    report.token_ok = false;
    report.error = error.response?.data?.error?.message || error.message;
    report.fix =
      'Token expired/invalid or wrong phone_number_id. Re-run set_whatsapp.js with a permanent System User token.';
  }

  res.json({ success: true, report });
});

module.exports = router;



