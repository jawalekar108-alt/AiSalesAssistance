//13/10

const express = require('express');

const router = express.Router();

const db = require('../config/database');
const orders = require('../services/orders');
const wa = require('../services/whatsapp');

/*
 * Orders for the business owner.
 *
 *   GET   /api/orders?store_id=clothing          -> list orders of that store
 *   PATCH /api/orders/:id/status                 -> { "store_id": "clothing", "status": "SHIPPED", "notify": true }
 *
 * Mounted in server.js behind auth.requireAuth + auth.forceTenant so a business
 * can only see its own orders.
 */

const STATUSES = ['NEW', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

const CUSTOMER_MESSAGES = {
  PAID: '✅ We received your payment for order {id}. Thank you!',
  CONFIRMED: '✅ Your order {id} is confirmed and is being packed. 📦',
  SHIPPED: '🚚 Good news! Your order {id} has been shipped.',
  DELIVERED: '🎉 Your order {id} was delivered. Thank you for shopping with {business}! 💛',
  CANCELLED: 'Your order {id} was cancelled. Please message us if you have any questions.'
};

// Same tenant rule as routes/catalog.js: a logged-in business is locked to its own store.
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

router.get('/', (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let list = orders.list(store.id, limit);

  if (req.query.status) list = list.filter(o => o.status === String(req.query.status).toUpperCase());

  res.json({ success: true, count: list.length, orders: list });
});

router.patch('/:id/status', async (req, res) => {
  const store = getStore(req, res);
  if (!store) return;

  const order = orders.get(req.params.id);

  if (!order || String(order.store_id) !== String(store.id)) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  const status = String(req.body?.status || '').toUpperCase();

  if (!STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  const updated = orders.update(order.id, { status });

  let customerNotified = false;
  let hint = null;

  if (req.body?.notify !== false && CUSTOMER_MESSAGES[status]) {
    try {
      const text = CUSTOMER_MESSAGES[status]
        .replace('{id}', order.id)
        .replace('{business}', store.business_name || store.name || 'us');

      await wa.sendText(store, String(order.customer_phone || '').replace(/\D/g, ''), text);
      customerNotified = true;
    } catch (error) {
      hint =
        error.hint ||
        'Customer was not messaged. WhatsApp only allows free text within 24 hours of their last message.';
    }
  }

  res.json({ success: true, order: updated, customer_notified: customerNotified, hint });
});

module.exports = router;


