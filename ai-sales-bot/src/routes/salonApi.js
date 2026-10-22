//21/10

const express = require('express');
const router = express.Router();

const db = require('../config/database');
const { getSalon } = require('../salon/attach');

/*
 * BEAUTY PARLOUR - dashboard API
 * Mounted in server.js behind login:
 *   app.use('/api/salon-app', auth.requireAuth, require('./src/routes/salonApi'));
 *
 *   GET    /state
 *   POST   /save
 *   POST   /connect
 *   GET    /health
 *   GET    /appointments?when=upcoming|past
 *   POST   /appointments/:id/cancel
 *   POST   /holiday           { day }
 *   DELETE /holiday/:day
 *
 * A business owner is locked to its own store (req.user.store_id).
 * Admin works on the store given in ?store_id= or the body.
 */

function getSalonOr503(res) {
  const salon = getSalon();

  if (!salon) {
    res.status(503).json({
      success: false,
      message: 'The parlour module is not enabled. Set SALON_DATABASE_URL in .env and restart the server.'
    });
    return null;
  }

  return salon;
}

async function tenantId(req, res, salon) {
  const id = req.user?.store_id || req.query.store_id || req.body?.store_id || null;

  if (!id) {
    res.status(400).json({ success: false, message: 'Choose a store first' });
    return null;
  }

  // Owners always have their own store. Admin may also open a parlour created earlier
  // from the onboarding page (its id exists in the parlour tables).
  if (!db.getStore(id)) {
    const known = req.user?.role === 'admin' && (await salon.storeExists(id).catch(() => false));

    if (!known) {
      res.status(404).json({ success: false, message: 'Store not found' });
      return null;
    }
  }

  return String(id);
}

// The Google account the owner must share their calendar with
function serviceAccountEmail() {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;

    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');

    return JSON.parse(text).client_email || null;
  } catch {
    return null;
  }
}

// Wraps a handler: checks the module is on, resolves the store, turns errors into JSON
const route = fn => async (req, res) => {
  const salon = getSalonOr503(res);
  if (!salon) return;

  const id = await tenantId(req, res, salon);
  if (!id) return;

  try {
    res.json({ success: true, ...(await fn({ salon, id, req })) });
  } catch (error) {
    if (!error.status) console.error('[salon-app]', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

/*
 * Tells the dashboard whether to show the Parlour tab.
 * Admin: always. Owner: only when their store already has a parlour.
 */
router.get('/state', async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const salon = getSalon();

  const base = { success: true, enabled: Boolean(salon), is_admin: isAdmin, service_account_email: serviceAccountEmail() };

  if (!salon) return res.json({ ...base, exists: false });

  const id = req.user?.store_id || req.query.store_id || null;

  if (!id) return res.json({ ...base, exists: false });

  if (!db.getStore(id) && !(isAdmin && (await salon.storeExists(id).catch(() => false)))) {
    return res.status(404).json({ success: false, message: 'Store not found' });
  }

  try {
    res.json({ ...base, ...(await salon.getState(String(id))) });
  } catch (error) {
    console.error('[salon-app] state', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: parlours already created (for example from the onboarding page)
router.get('/stores', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });

  const salon = getSalonOr503(res);
  if (!salon) return;

  try {
    res.json({ success: true, stores: await salon.listStores() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/slots', route(async ({ salon, id, req }) => ({
  slots: await salon.freeSlots(id, req.query.service_id, req.query.day)
})));

router.post('/book', route(async ({ salon, id, req }) => {
  const b = req.body || {};

  return salon.createBooking({
    storeId: id,
    serviceId: b.service_id,
    day: b.day,
    time: b.time,
    name: b.name,
    phone: b.phone,
    notify: b.notify !== false
  });
}));

router.post('/save', route(async ({ salon, id, req }) => {
  await salon.saveStore({ ...req.body, store_id: id });
  return { saved: true };
}));

router.post('/connect', route(async ({ salon, id, req }) => {
  const result = await salon.connectNumber({ ...req.body, store_id: id });
  return result;
}));

router.get('/stats', route(async ({ salon, id }) => ({ stats: await salon.getStats(id) })));

router.get('/customers', route(async ({ salon, id }) => ({ customers: await salon.listCustomers(id) })));

router.post('/appointments/:id/status', route(async ({ salon, id, req }) => {
  await salon.setAppointmentStatus(id, req.params.id, req.body?.status);
  return { updated: true };
}));

router.get('/health', route(({ salon, id }) => salon.healthFor(id)));

router.get('/appointments', route(async ({ salon, id, req }) => ({
  appointments: await salon.listAppointments(id, req.query.when === 'past' ? 'past' : 'upcoming')
})));

router.post('/appointments/:id/cancel', route(async ({ salon, id, req }) => {
  await salon.cancelAppointment(id, req.params.id);
  return { cancelled: true };
}));

router.post('/holiday', route(async ({ salon, id, req }) => {
  await salon.addHoliday(id, req.body?.day);
  return { added: true };
}));

router.delete('/holiday/:day', route(async ({ salon, id, req }) => {
  await salon.removeHoliday(id, req.params.day);
  return { removed: true };
}));

module.exports = router;

