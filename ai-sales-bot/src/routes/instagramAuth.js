//6/10

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const ig = require('../services/instagram');
const auth = require('../services/auth');

function page(title, message, ok = true) {
  const color = ok ? '#10b981' : '#ef4444';
  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="background:#0b0f17;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
    <div style="background:#121824;padding:2rem;border-radius:16px;text-align:center;border:1px solid ${color};max-width:480px;margin:1rem;">
      <h2 style="color:${color};">${title}</h2>
      <p style="color:#94a3b8;">${message}</p>
      <a href="/account.html" style="display:inline-block;background:#8b5cf6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px;">Back to My Account</a>
    </div>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/*
 * START CONNECT  (login required)
 * Always connects the Instagram account to the LOGGED-IN user's own store.
 * (No store_id in the URL anymore, so nobody can attach an account to someone else's store.)
 */
router.get('/connect', auth.requireAuth, (req, res) => {
  try {
    res.redirect(ig.buildAuthUrl(req.user.home_store_id));
  } catch (error) {
    res.status(500).send(page('Cannot start connection', escapeHtml(error.message), false));
  }
});

/*
 * OAUTH CALLBACK - public (Instagram sends the browser back here).
 * Safe because "state" is signed and contains the store id chosen at /connect.
 * Must match INSTAGRAM_REDIRECT_URI exactly.
 */
router.get('/oauth-callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(page('Instagram connection cancelled', escapeHtml(error_description || error), false));
  }

  const storeId = ig.verifyState(state);

  if (!storeId || !code) {
    return res.status(400).send(page('Invalid or expired link', 'Please start the connection again.', false));
  }

  try {
    const result = await ig.connectStoreFromCode(storeId, code);

    const warn = result.subscribed
      ? ''
      : '<br><br><small>Connected, but webhook subscription failed - check server logs.</small>';

    res.send(page('✓ Instagram connected', `@${escapeHtml(result.username)} is now connected. Auto-replies are active.${warn}`));
  } catch (err) {
    console.error('[IG OAuth] failed:', err.response?.data || err.message);
    res.status(500).send(page('Connection failed', escapeHtml(err.response?.data?.error_message || err.message), false));
  }
});

// Connection status of the logged-in user's store (never returns the token)
router.get('/status', auth.requireAuth, (req, res) => {
  const store = db.getStore(req.user.home_store_id);
  if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

  res.json({
    success: true,
    connected: Boolean(store.instagram_user_id && store.instagram_access_token),
    username: store.instagram_username || null,
    token_status: store.instagram_token_status || null,
    token_expires_at: store.instagram_token_expires_at || null
  });
});

router.post('/disconnect', auth.requireAuth, (req, res) => {
  const store = db.getStore(req.user.home_store_id);
  if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

  db.updateStore(store.id, {
    instagram_access_token: null,
    instagram_user_id: null,
    instagram_scoped_id: null,
    instagram_username: null,
    instagram_token_expires_at: null,
    instagram_token_status: null
  });

  res.json({ success: true });
});

module.exports = router;


