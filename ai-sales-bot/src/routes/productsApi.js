//13/10

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const db = require('../config/database');
const { buildWhatsAppLink } = require('../services/whatsappLink');

/*
 * Products added by hand in the dashboard (not from Instagram).
 * They are saved in the same product list the WhatsApp bot reads, so they
 * show up in the WhatsApp catalogue automatically.
 *
 *   GET    /api/products?store_id=clothing       -> manual products of that store
 *   POST   /api/products                         -> add a product (with optional image_data)
 *   PUT    /api/products/:id                     -> edit a product
 *   DELETE /api/products/:id?store_id=clothing   -> delete a product
 *
 * Mounted in server.js behind auth.requireAuth + auth.forceTenant.
 * Photos are saved to src/public/uploads/products/ (JPG or PNG, max 1.5 MB).
 */

const UPLOAD_DIR = path.join(__dirname, '../public/uploads/products');
const URL_PREFIX = '/uploads/products/';
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ============================================================
 * HELPERS
 * ============================================================ */

// Same tenant rule as routes/catalog.js: a logged-in business is locked to its own store.
function findStore(req, res) {
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

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');

  return [...new Set(items.map(v => String(v).trim()).filter(Boolean))].slice(0, 20);
}

// '' / null / undefined -> null (not set).  Bad number -> NaN.
function parseNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  const n = Number(String(value).replace(/,/g, ''));

  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function saveImage(dataUrl) {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');

  if (comma === -1 || !/^data:image\/(jpeg|png);base64$/.test(text.slice(0, comma))) {
    throw new Error('Image must be a JPG or PNG');
  }

  const buffer = Buffer.from(text.slice(comma + 1), 'base64');

  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 1.5 MB)');
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;

  if (!isJpeg && !isPng) throw new Error('The file is not a real JPG or PNG image');

  const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${isPng ? 'png' : 'jpg'}`;

  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);

  return URL_PREFIX + name;
}

function removeImage(url) {
  if (!String(url || '').startsWith(URL_PREFIX)) return;

  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(url)));
  } catch {
    /* already gone */
  }
}

// Reads and checks the form fields. requireAll = true when creating.
function readFields(body, requireAll) {
  const out = {};

  if (requireAll || body.name !== undefined) {
    const name = cleanText(body.name, 120);
    if (name.length < 2) return { error: 'Product name is required' };
    out.name = name;
  }

  if (requireAll || body.price !== undefined) {
    const price = parseNumber(body.price);
    if (price === null || Number.isNaN(price)) return { error: 'Price is required and must be a number' };
    out.price = price;
  }

  if (body.original_price !== undefined) {
    const original = parseNumber(body.original_price);
    if (Number.isNaN(original)) return { error: 'Original price must be a number' };
    out.original_price = original;
  }

  if (body.stock !== undefined) {
    const stock = parseNumber(body.stock);
    if (Number.isNaN(stock)) return { error: 'Stock must be a number (or leave it empty)' };
    out.stock = stock === null ? null : Math.floor(stock);
  }

  if (body.category !== undefined) out.category = cleanText(body.category, 60) || 'General';
  if (body.sizes !== undefined) out.sizes = toList(body.sizes).map(s => s.toUpperCase());
  if (body.colors !== undefined) out.colors = toList(body.colors).map(c => c.toLowerCase());
  if (body.description !== undefined) out.description = cleanText(body.description, 500);

  return { fields: out };
}

// The AI assistant reads this text as the product's "caption"
function captionFor(store, product) {
  return [
    product.name,
    product.description,
    product.price !== null && product.price !== undefined
      ? `Price: ${store.currency || '₹'}${product.price}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function view(store, product) {
  return { ...product, wa_link: buildWhatsAppLink(store, product) };
}

function ownManual(store, id) {
  const product = db.getProductById(id);

  if (!product) return null;
  if (String(product.store_id || product.store_type) !== String(store.id)) return null;
  if (product.source !== 'manual') return null;

  return product;
}

/* ============================================================
 * ROUTES
 * ============================================================ */

router.get('/', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const all = db.getProducts(store.id);

  const products = all
    .filter(p => p.source === 'manual')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(p => view(store, p));

  res.json({
    success: true,
    products,
    instagram_count: all.filter(p => p.source === 'instagram').length
  });
});

router.post('/', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const body = req.body || {};
  const { fields, error } = readFields(body, true);

  if (error) return res.status(400).json({ success: false, error });

  const duplicate = db
    .getProducts(store.id)
    .find(p => String(p.name || '').trim().toLowerCase() === fields.name.toLowerCase());

  if (duplicate) {
    return res.status(409).json({ success: false, error: 'A product with this name already exists in this store' });
  }

  let imageUrl = '';

  if (body.image_data) {
    try {
      imageUrl = saveImage(body.image_data);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  const original = fields.original_price ?? fields.price;

  const product = db.addProduct({
    id: `man_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    source: 'manual',
    store_id: store.id,
    store_type: store.type || store.id,

    name: fields.name,
    category: fields.category || 'General',
    price: fields.price,
    original_price: original,
    stock: fields.stock ?? null,
    sizes: fields.sizes || [],
    colors: fields.colors || [],
    description: fields.description || '',

    tags: [],
    ad_triggers: [],

    image_url: imageUrl,
    video_url: null,
    media_type: 'IMAGE',
    checkout_url: '',

    instagram_caption: '',
    created_at: new Date().toISOString()
  });

  const saved = db.updateProduct(product.id, { instagram_caption: captionFor(store, product) });

  res.json({ success: true, product: view(store, saved) });
});

router.put('/:id', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const existing = ownManual(store, req.params.id);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Product not found (only manually added products can be edited here)' });
  }

  const body = req.body || {};
  const { fields, error } = readFields(body, false);

  if (error) return res.status(400).json({ success: false, error });

  if (fields.name) {
    const duplicate = db
      .getProducts(store.id)
      .find(p => p.id !== existing.id && String(p.name || '').trim().toLowerCase() === fields.name.toLowerCase());

    if (duplicate) {
      return res.status(409).json({ success: false, error: 'A product with this name already exists in this store' });
    }
  }

  const updates = { ...fields };

  if (updates.original_price === null) updates.original_price = updates.price ?? existing.price;

  if (body.image_data) {
    try {
      updates.image_url = saveImage(body.image_data);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  } else if (body.remove_image === true) {
    updates.image_url = '';
  }

  const merged = { ...existing, ...updates };
  updates.instagram_caption = captionFor(store, merged);

  const saved = db.updateProduct(existing.id, updates);

  if (updates.image_url !== undefined && updates.image_url !== existing.image_url) {
    removeImage(existing.image_url);
  }

  res.json({ success: true, product: view(store, saved) });
});

router.delete('/:id', (req, res) => {
  const store = findStore(req, res);
  if (!store) return;

  const existing = ownManual(store, req.params.id);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Product not found (only manually added products can be deleted here)' });
  }

  db.deleteProduct(existing.id);
  removeImage(existing.image_url);

  res.json({ success: true });
});

module.exports = router;


