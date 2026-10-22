const express = require('express');
const router = express.Router();

const db = require('../config/database');
const auth = require('../services/auth');

function fail(res, error) {
  res.status(error.status || 500).json({ success: false, message: error.message });
}

router.post('/signup', (req, res) => {
  try {
    const user = auth.signup(req.body || {});

    auth.setSessionCookie(req, res, user.id);

    res.status(201).json({ success: true, redirect: '/account.html' });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/login', (req, res) => {
  try {
    const user = auth.login(req, req.body || {});

    auth.setSessionCookie(req, res, user.id);

    res.json({ success: true, redirect: '/account.html' });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

// Visit /api/auth/logout in the browser to log out
router.get('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/login.html');
});

router.get('/me', auth.requireAuth, (req, res) => {
  const store = db.getStore(req.user.home_store_id);

  res.json({
    success: true,
    user: { email: req.user.email, role: req.user.role },
    store: {
      id: store.id,
      business_name: store.business_name || store.name,
      type: store.type,
      instagram_username: store.instagram_username || null,
      instagram_connected: Boolean(store.instagram_user_id && store.instagram_access_token),
      instagram_token_status: store.instagram_token_status || null,
      instagram_token_expires_at: store.instagram_token_expires_at || null,
      whatsapp_number: store.whatsapp_number || '',
      whatsapp_link_enabled: store.whatsapp_link_enabled !== false
    }
  });
});

module.exports = router;