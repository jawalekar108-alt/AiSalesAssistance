// src/routes/catalog.js
// Catalog + stores + Instagram sync (multi-tenant)

const express = require('express');

const router = express.Router();

const db = require('../config/database');
const ig = require('../services/instagram');

const DEFAULT_STORE_ID = process.env.DEFAULT_STORE_TYPE || 'clothing';

/* ============================================================
 * TENANT HELPERS
 *
 * The dashboard sends the store in the x-store-id header,
 * ?store_id=, or the body (store_id / store_type).
 * When login is active, req.user.store_id wins and any other
 * store is refused automatically.
 * ============================================================ */

function getStoreId(req) {
  return (
    req.user?.store_id ||
    req.headers['x-store-id'] ||
    req.query.store_id ||
    req.query.store_type ||
    req.body?.store_id ||
    req.body?.store_type ||
    null
  );
}

function getStore(req, res, { fallbackToDefault = false } = {}) {
  let id = getStoreId(req);

  if (!id && fallbackToDefault) id = DEFAULT_STORE_ID;

  if (!id) {
    res.status(400).json({ success: false, message: 'store_id is required' });
    return null;
  }

  const store = db.getStore(id);

  if (!store) {
    res.status(404).json({ success: false, message: 'Store not found' });
    return null;
  }

  if (req.user?.store_id && String(req.user.store_id) !== String(store.id)) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }

  return store;
}

function belongsToStore(item, storeId) {
  return String(item.store_id || item.store_type || '') === String(storeId);
}

// Never send tokens to the browser
function publicStore(store) {
  return {
    id: store.id,
    name: store.name,
    business_name: store.business_name || store.name,
    type: store.type,
    status: store.status || 'active',
    ai_enabled: store.ai_enabled !== false,
    comment_reply_enabled: store.comment_reply_enabled !== false,
    dm_reply_enabled: store.dm_reply_enabled !== false,
    currency: store.currency,
    active_promo_code: store.active_promo_code || '',
    promo_discount_percent: store.promo_discount_percent || 0,
    urgency_timer_minutes: store.urgency_timer_minutes,
    free_shipping_threshold: store.free_shipping_threshold,
    return_policy: store.return_policy,
    warranty_policy: store.warranty_policy,
    whatsapp_number: store.whatsapp_number || '',
    whatsapp_link_enabled: store.whatsapp_link_enabled !== false,
    social_proof: store.social_proof,
    instagram_username: store.instagram_username || null,
    instagram_user_id: store.instagram_user_id || null,
    instagram_connected: Boolean(store.instagram_user_id && store.instagram_access_token),
    instagram_token_status: store.instagram_token_status || null,
    instagram_token_expires_at: store.instagram_token_expires_at || null
  };
}

// Only these store fields can be changed from the dashboard.
// Tokens, ids, status and Instagram fields can NOT be changed here.
const EDITABLE_STORE_FIELDS = [
  'name',
  'business_name',
  'currency',
  'active_promo_code',
  'promo_discount_percent',
  'urgency_timer_minutes',
  'free_shipping_threshold',
  'return_policy',
  'warranty_policy',
  'whatsapp_number',
  'whatsapp_link_enabled',
  'social_proof',
  'ai_enabled',
  'comment_reply_enabled',
  'dm_reply_enabled'
];

/* ============================================================
 * PRODUCTS
 * ============================================================ */

router.get('/products', (req, res) => {
  try {
    const store = getStore(req, res, { fallbackToDefault: true });
    if (!store) return;

    res.json({ success: true, products: db.getProducts(store.id) });
  } catch (error) {
    console.error('[Catalog] Get products error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/products/:id', (req, res) => {
  try {
    const store = getStore(req, res, { fallbackToDefault: true });
    if (!store) return;

    const product = db.getProductById(req.params.id);

    if (!product || !belongsToStore(product, store.id)) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/products', (req, res) => {
  try {
    const store = getStore(req, res);
    if (!store) return;

    const product = db.addProduct({
      ...req.body,
      store_id: store.id,
      store_type: store.type || store.id,
      source: req.body.source || 'manual'
    });

    res.status(201).json({ success: true, product });
  } catch (error) {
    console.error('[Catalog] Add product error:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/products/:id', (req, res) => {
  try {
    const store = getStore(req, res);
    if (!store) return;

    const existing = db.getProductById(req.params.id);

    if (!existing || !belongsToStore(existing, store.id)) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const updated = db.updateProduct(req.params.id, { ...req.body, store_id: store.id });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, product: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/products/:id', (req, res) => {
  try {
    const store = getStore(req, res);
    if (!store) return;

    const existing = db.getProductById(req.params.id);

    if (!existing || !belongsToStore(existing, store.id)) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: db.deleteProduct(req.params.id) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* ============================================================
 * STORES
 * ============================================================ */

router.get('/stores', (req, res) => {
  try {
    let stores = db.getStores();

    // With login, a user only sees their own store
    if (req.user?.store_id) {
      stores = stores.filter(s => String(s.id) === String(req.user.store_id));
    }

    res.json({ success: true, stores: stores.map(publicStore) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/stores/:id', (req, res) => {
  try {
    const store = db.getStore(req.params.id);

    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    if (req.user?.store_id && String(req.user.store_id) !== String(store.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const updates = {};

    for (const field of EDITABLE_STORE_FIELDS) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    // WhatsApp number is stored as digits only (country code + number)
    if (typeof updates.whatsapp_number === 'string') {
      updates.whatsapp_number = updates.whatsapp_number.replace(/\D/g, '');
    }

    const updated = db.updateStore(store.id, updates);

    res.json({ success: true, store: publicStore(updated) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

/* ============================================================
 * INSTAGRAM SYNC (uses the selected tenant's own token)
 * ============================================================ */

router.post('/sync-instagram', async (req, res) => {
  try {
    const store = getStore(req, res);
    if (!store) return;

    console.log(`[Instagram Sync] [${store.id}] Fetching Instagram posts...`);

    // Throws a clear error if this store has no valid token
    const allMedia = await ig.listMedia(store);

    console.log(`[Instagram Sync] [${store.id}] Found ${allMedia.length} posts`);

    // store.id (not store.type) so every tenant keeps its own products
    const syncResult = db.syncInstagramProducts(allMedia, store.id);

    const instagramIds = allMedia.map(media => media.id).filter(Boolean);

    // Safety: never wipe a catalog because an API call returned nothing
    const removed = instagramIds.length
      ? db.removeOldInstagramProducts(instagramIds, store.id)
      : 0;

    console.log(`[Instagram Sync] [${store.id}] Complete:`, syncResult, `Removed: ${removed}`);

    res.json({
      success: true,
      message: 'Instagram products synchronized successfully',
      added: syncResult.added,
      updated: syncResult.updated,
      removed,
      total: syncResult.total,
      products: db.getProducts(store.id)
    });
  } catch (error) {
    const apiError = error.graph || error.response?.data?.error || null;

    console.error('[Instagram Sync Error]', apiError || error.message);

    let status = 500;
    let message = apiError?.message || error.message || 'Instagram synchronization failed';

    if (error.code === 'NO_TOKEN') {
      status = 400;
      message = 'This business has not connected Instagram yet. Use "Connect Instagram" first.';
    } else if (apiError) {
      status = 502;
    }

    res.status(status).json({ success: false, message, error: apiError });
  }
});

/* ============================================================
 * SYNC STATUS (per store)
 * ============================================================ */

router.get('/instagram-status', (req, res) => {
  try {
    const store = getStore(req, res, { fallbackToDefault: true });
    if (!store) return;

    const products = db.getProducts(store.id);
    const instagramProducts = products.filter(product => product.source === 'instagram');

    const creds = ig.describeCredentials(store);
    const connected = !creds.error;

    res.json({
      success: true,
      store_id: store.id,
      connected,
      credentials_source: connected ? creds.source : null,
      instagram_username: store.instagram_username || null,
      instagram_account_id: store.instagram_user_id ? 'CONFIGURED' : 'MISSING',
      token_status: store.instagram_token_status || null,
      instagram_products: instagramProducts.length,
      total_products: products.length,
      last_sync: instagramProducts.length
        ? instagramProducts
            .map(p => p.synced_at)
            .filter(Boolean)
            .sort()
            .pop()
        : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;