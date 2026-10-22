//21/10
//15/10 (updated: public privacy / terms / data-deletion pages for Meta + startup checks)

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const webhookRoutes = require('./src/routes/webhook');
const authRoutes = require('./src/routes/auth');
const instagramAuthRoutes = require('./src/routes/instagramAuth');
const catalogRoutes = require('./src/routes/catalog');
const leadsRoutes = require('./src/routes/leads');
const simulatorRoutes = require('./src/routes/simulator');
const { attachSalon } = require('./src/salon/attach'); // beauty-parlour appointment bot

const followUpWorker = require('./src/engine/followUpWorker');
const instagramService = require('./src/services/instagram');
const auth = require('./src/services/auth');

const app = express();

// Behind Cloudflare / nginx / Render / Railway: set TRUST_PROXY=1 in .env so req.ip and req.secure are correct
// (login rate-limit and the Secure cookie flag depend on them)
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

const PORT = process.env.PORT || 3000;

// Create / update the admin account from .env
auth.seedAdmin();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

// Keep the raw body so Meta's X-Hub-Signature-256 can be verified
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.use(express.urlencoded({ extended: true }));

// Prevent cache
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Read the login cookie on every request (sets req.user when logged in)
app.use(auth.attachUser);

// ============================================================
// PUBLIC ROUTES (no login)
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    service: 'AI Sales Bot',
    timestamp: new Date().toISOString()
  });
});

/*
 * Public legal pages. Meta asks for a Privacy Policy URL, Terms URL and a
 * Data Deletion URL before an app can go Live / pass App Review.
 * Set APP_NAME and SUPPORT_EMAIL in .env. Have a lawyer review the wording.
 */
const APP_NAME = process.env.APP_NAME || 'AI Sales Bot Studio';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

function legalPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - ${APP_NAME}</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;line-height:1.7}
  main{max-width:780px;margin:0 auto;padding:32px 20px}
  h1{font-size:28px;margin-bottom:4px} h2{font-size:18px;margin-top:28px;color:#f1f5f9}
  a{color:#60a5fa} .muted{color:#94a3b8;font-size:13px}
</style></head><body><main>
<h1>${title}</h1>
<div class="muted">${APP_NAME} · Last updated: ${new Date().toISOString().slice(0, 10)}</div>
${bodyHtml}
</main></body></html>`;
}

app.get('/privacy', (req, res) => {
  res.type('html').send(
    legalPage(
      'Privacy Policy',
      `
<h2>Who we are</h2>
<p>${APP_NAME} provides automated sales assistants for businesses on Instagram and WhatsApp. Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
<h2>Data we process</h2>
<p>When a business connects its Instagram or WhatsApp account, we process the messages and comments customers send to that business, customer names or handles, phone numbers, delivery addresses, order details, and the business's product catalogue.</p>
<h2>Why we process it</h2>
<p>Only to reply to customers, take orders, show the business its chats, leads and orders, and keep the service secure. We do not sell personal data.</p>
<h2>Who we share it with</h2>
<p>Meta (WhatsApp and Instagram) to send and receive messages, and AI and hosting providers that help us generate replies and run the service. They process data only on our instructions.</p>
<h2>How long we keep it</h2>
<p>For as long as the business uses the service, then deleted within 30 days of a deletion request or account closure, unless the law requires us to keep it.</p>
<h2>Your rights</h2>
<p>You can ask us to access, correct or delete your data. See <a href="/data-deletion">how to request deletion</a>.</p>
`
    )
  );
});

app.get('/terms', (req, res) => {
  res.type('html').send(
    legalPage(
      'Terms of Service',
      `
<h2>Use of the service</h2>
<p>${APP_NAME} lets a business automate replies and order-taking on Instagram and WhatsApp. The business is responsible for its products, prices, deliveries and for following WhatsApp's and Instagram's policies, including getting customers' consent before sending marketing messages.</p>
<h2>Acceptable use</h2>
<p>No spam, illegal goods, harassment, or misleading messages. We may suspend accounts that put the service or other users at risk.</p>
<h2>Messaging costs</h2>
<p>Meta may charge for some WhatsApp messages. These charges are billed by Meta to the business's WhatsApp payment method.</p>
<h2>Availability</h2>
<p>The service is provided as is. We work to keep it running but do not guarantee uninterrupted operation.</p>
<h2>Contact</h2>
<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
`
    )
  );
});

app.get('/data-deletion', (req, res) => {
  res.type('html').send(
    legalPage(
      'Data Deletion Instructions',
      `
<h2>How to delete your data</h2>
<p>1. Send an email to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the subject "Delete my data".</p>
<p>2. Include the phone number or Instagram handle you used to message a business. Businesses should include their account email.</p>
<p>3. We delete the data within 30 days and confirm by email.</p>
<h2>Businesses</h2>
<p>A business can also disconnect WhatsApp and Instagram at any time from its dashboard, which stops all processing of new messages.</p>
`
    )
  );
});

// Beauty-parlour module: /api/salon/* (protected by SALON_ADMIN_KEY) + appointment reminders
attachSalon(app);

// Login / signup / logout / me
app.use('/api/auth', authRoutes);

// Webhook logs contain customer messages of ALL tenants -> admin only.
// (Declared BEFORE the webhook router so it takes priority.)
app.get(['/webhook/logs', '/api/webhook/logs'], auth.requireAdmin, (req, res) => {
  res.json({ success: true, logs: webhookRoutes.webhookLogs });
});

// Meta webhooks must stay public
app.use('/webhook', webhookRoutes);
app.use('/api/webhook', webhookRoutes);

// Instagram connect (login required inside) + OAuth callback (public, signed state)
app.use('/api/instagram', instagramAuthRoutes);

// ============================================================
// LOGGED-IN ROUTES
// ============================================================

app.use('/api/catalog', auth.requireAuth, catalogRoutes);
app.use('/api/leads', auth.requireAuth, leadsRoutes);
app.use('/api/simulator', auth.requireAuth, auth.forceTenant, simulatorRoutes);

// Manual WhatsApp settings (login required; harmless if the router also checks)
app.use('/api/whatsapp', auth.requireAuth, require('./src/routes/whatsappSettings'));

// Orders placed on WhatsApp (list + change status)
app.use('/api/orders', auth.requireAuth, require('./src/routes/ordersApi'));

// Products a business adds by hand (with photo) - shown in the WhatsApp catalogue
app.use('/api/products', auth.requireAuth, require('./src/routes/productsApi'));

// Beauty parlour: setup, WhatsApp number, appointments (owner is locked to their own store)
app.use('/api/salon-app', auth.requireAuth, require('./src/routes/salonApi'));

// 1-click WhatsApp connect (Embedded Signup) + health check + test message.
// Inactive until META_APP_ID etc. are set in .env
app.use('/api/whatsapp-onboard', auth.requireAuth, require('./src/routes/whatsappOnboard'));

// Any other /api or /webhook URL is a real 404 in JSON.
app.use(['/api', '/webhook'], (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`
  });
});

// ============================================================
// FRONTEND
// ============================================================

// The dashboard itself needs login (declared BEFORE express.static)
// Beauty parlour owners get their own dashboard (cream design). Admin can preview it with /salon?store_id=...
app.get('/salon', auth.requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/salon.html'));
});

app.get(['/', '/index.html'], auth.requireAuth, async (req, res) => {
  try {
    const salon = require('./src/salon/attach').getSalon();

    // A business that has a parlour set up lands on the salon dashboard instead of the sales one.
    // (?classic=1 still opens the sales dashboard.)
    if (salon && req.user.role !== 'admin' && !req.query.classic && (await salon.storeExists(req.user.store_id))) {
      return res.redirect('/salon');
    }
  } catch (error) {
    console.warn('[salon] could not check parlour for redirect:', error.message);
  }

  res.sendFile(path.join(__dirname, 'src/public/index.html'));
});

// login.html, account.html, css, js, icons, uploads ...
app.use(
  express.static(path.join(__dirname, 'src/public'), {
    etag: false,
    maxAge: 0
  })
);

// SPA fallback (login required)
app.get('*', auth.requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/index.html'));
});

// ============================================================
// ERROR HANDLER (always JSON for /api and /webhook)
// ============================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = err.status || err.statusCode || 500;

  let message = 'Server error';

  if (err.type === 'entity.too.large') {
    message = 'The upload is too large. Please use a smaller photo.';
  } else if (err.type === 'entity.parse.failed') {
    message = 'Invalid JSON sent to the server.';
  } else if (status < 500) {
    message = err.message || 'Bad request';
  }

  console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err.message);

  if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/webhook')) {
    return res.status(status).json({ success: false, error: message });
  }

  res.status(status).send(message);
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log('============================================================');
  console.log('🔥 AI SALES BOT (multi-tenant)');
  console.log('============================================================');
  console.log(`🔑 Login:            http://localhost:${PORT}/login.html`);
  console.log(`👤 My Account:       http://localhost:${PORT}/account.html`);
  console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
  console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
  console.log(`📜 Legal pages:      /privacy  /terms  /data-deletion`);
  console.log(`❤️  Health:           http://localhost:${PORT}/health`);
  console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
  console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(
    `🔐 Legacy IG Token:  ${
      process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
    }`
  );
  console.log(
    `🧩 OAuth app:        ${
      process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
        ? 'CONFIGURED'
        : 'NOT CONFIGURED (needed for tenant connect)'
    }`
  );
  console.log(
    `💬 WhatsApp 1-click: ${
      process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WHATSAPP_ES_CONFIG_ID
        ? 'CONFIGURED'
        : 'OFF (needs META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID)'
    }`
  );
  console.log(
    `🪝 Webhook verify:   ${
      process.env.META_VERIFY_TOKEN
        ? 'META_VERIFY_TOKEN set'
        : 'WARNING: META_VERIFY_TOKEN not set (old built-in tokens are being used)'
    }`
  );
  console.log(`👑 Admin login:      ${process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? process.env.ADMIN_EMAIL : 'NOT CONFIGURED'}`);
  console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
  console.log('============================================================');

  if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
    followUpWorker.start();
  }

  // Refresh tenants' 60-day Instagram tokens before they expire
  instagramService.startTokenRefreshWorker();
});



// //20/10 (updated: public privacy / terms / data-deletion pages for Meta + startup checks)

// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const path = require('path');

// const webhookRoutes = require('./src/routes/webhook');
// const authRoutes = require('./src/routes/auth');
// const instagramAuthRoutes = require('./src/routes/instagramAuth');
// const catalogRoutes = require('./src/routes/catalog');
// const leadsRoutes = require('./src/routes/leads');
// const simulatorRoutes = require('./src/routes/simulator');
// const { attachSalon } = require('./src/salon/attach'); // beauty-parlour appointment bot

// const followUpWorker = require('./src/engine/followUpWorker');
// const instagramService = require('./src/services/instagram');
// const auth = require('./src/services/auth');

// const app = express();

// // Behind Cloudflare / nginx / Render / Railway: set TRUST_PROXY=1 in .env so req.ip and req.secure are correct
// // (login rate-limit and the Secure cookie flag depend on them)
// if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

// const PORT = process.env.PORT || 3000;

// // Create / update the admin account from .env
// auth.seedAdmin();

// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.use(cors());

// // Keep the raw body so Meta's X-Hub-Signature-256 can be verified
// app.use(
//   express.json({
//     limit: '2mb',
//     verify: (req, res, buf) => {
//       req.rawBody = buf;
//     }
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Prevent cache
// app.use((req, res, next) => {
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });

// // Read the login cookie on every request (sets req.user when logged in)
// app.use(auth.attachUser);

// // ============================================================
// // PUBLIC ROUTES (no login)
// // ============================================================

// app.get('/health', (req, res) => {
//   res.json({
//     success: true,
//     status: 'online',
//     service: 'AI Sales Bot',
//     timestamp: new Date().toISOString()
//   });
// });

// /*
//  * Public legal pages. Meta asks for a Privacy Policy URL, Terms URL and a
//  * Data Deletion URL before an app can go Live / pass App Review.
//  * Set APP_NAME and SUPPORT_EMAIL in .env. Have a lawyer review the wording.
//  */
// const APP_NAME = process.env.APP_NAME || 'AI Sales Bot Studio';
// const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

// function legalPage(title, bodyHtml) {
//   return `<!doctype html>
// <html lang="en"><head>
// <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
// <title>${title} - ${APP_NAME}</title>
// <style>
//   body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;line-height:1.7}
//   main{max-width:780px;margin:0 auto;padding:32px 20px}
//   h1{font-size:28px;margin-bottom:4px} h2{font-size:18px;margin-top:28px;color:#f1f5f9}
//   a{color:#60a5fa} .muted{color:#94a3b8;font-size:13px}
// </style></head><body><main>
// <h1>${title}</h1>
// <div class="muted">${APP_NAME} · Last updated: ${new Date().toISOString().slice(0, 10)}</div>
// ${bodyHtml}
// </main></body></html>`;
// }

// app.get('/privacy', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Privacy Policy',
//       `
// <h2>Who we are</h2>
// <p>${APP_NAME} provides automated sales assistants for businesses on Instagram and WhatsApp. Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
// <h2>Data we process</h2>
// <p>When a business connects its Instagram or WhatsApp account, we process the messages and comments customers send to that business, customer names or handles, phone numbers, delivery addresses, order details, and the business's product catalogue.</p>
// <h2>Why we process it</h2>
// <p>Only to reply to customers, take orders, show the business its chats, leads and orders, and keep the service secure. We do not sell personal data.</p>
// <h2>Who we share it with</h2>
// <p>Meta (WhatsApp and Instagram) to send and receive messages, and AI and hosting providers that help us generate replies and run the service. They process data only on our instructions.</p>
// <h2>How long we keep it</h2>
// <p>For as long as the business uses the service, then deleted within 30 days of a deletion request or account closure, unless the law requires us to keep it.</p>
// <h2>Your rights</h2>
// <p>You can ask us to access, correct or delete your data. See <a href="/data-deletion">how to request deletion</a>.</p>
// `
//     )
//   );
// });

// app.get('/terms', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Terms of Service',
//       `
// <h2>Use of the service</h2>
// <p>${APP_NAME} lets a business automate replies and order-taking on Instagram and WhatsApp. The business is responsible for its products, prices, deliveries and for following WhatsApp's and Instagram's policies, including getting customers' consent before sending marketing messages.</p>
// <h2>Acceptable use</h2>
// <p>No spam, illegal goods, harassment, or misleading messages. We may suspend accounts that put the service or other users at risk.</p>
// <h2>Messaging costs</h2>
// <p>Meta may charge for some WhatsApp messages. These charges are billed by Meta to the business's WhatsApp payment method.</p>
// <h2>Availability</h2>
// <p>The service is provided as is. We work to keep it running but do not guarantee uninterrupted operation.</p>
// <h2>Contact</h2>
// <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
// `
//     )
//   );
// });

// app.get('/data-deletion', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Data Deletion Instructions',
//       `
// <h2>How to delete your data</h2>
// <p>1. Send an email to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the subject "Delete my data".</p>
// <p>2. Include the phone number or Instagram handle you used to message a business. Businesses should include their account email.</p>
// <p>3. We delete the data within 30 days and confirm by email.</p>
// <h2>Businesses</h2>
// <p>A business can also disconnect WhatsApp and Instagram at any time from its dashboard, which stops all processing of new messages.</p>
// `
//     )
//   );
// });

// // Beauty-parlour module: /api/salon/* (protected by SALON_ADMIN_KEY) + appointment reminders
// attachSalon(app);

// // Login / signup / logout / me
// app.use('/api/auth', authRoutes);

// // Webhook logs contain customer messages of ALL tenants -> admin only.
// // (Declared BEFORE the webhook router so it takes priority.)
// app.get(['/webhook/logs', '/api/webhook/logs'], auth.requireAdmin, (req, res) => {
//   res.json({ success: true, logs: webhookRoutes.webhookLogs });
// });

// // Meta webhooks must stay public
// app.use('/webhook', webhookRoutes);
// app.use('/api/webhook', webhookRoutes);

// // Instagram connect (login required inside) + OAuth callback (public, signed state)
// app.use('/api/instagram', instagramAuthRoutes);

// // ============================================================
// // LOGGED-IN ROUTES
// // ============================================================

// app.use('/api/catalog', auth.requireAuth, catalogRoutes);
// app.use('/api/leads', auth.requireAuth, leadsRoutes);
// app.use('/api/simulator', auth.requireAuth, auth.forceTenant, simulatorRoutes);

// // Manual WhatsApp settings (login required; harmless if the router also checks)
// app.use('/api/whatsapp', auth.requireAuth, require('./src/routes/whatsappSettings'));

// // Orders placed on WhatsApp (list + change status)
// app.use('/api/orders', auth.requireAuth, require('./src/routes/ordersApi'));

// // Products a business adds by hand (with photo) - shown in the WhatsApp catalogue
// app.use('/api/products', auth.requireAuth, require('./src/routes/productsApi'));

// // Beauty parlour: setup, WhatsApp number, appointments (owner is locked to their own store)
// app.use('/api/salon-app', auth.requireAuth, require('./src/routes/salonApi'));

// // 1-click WhatsApp connect (Embedded Signup) + health check + test message.
// // Inactive until META_APP_ID etc. are set in .env
// app.use('/api/whatsapp-onboard', auth.requireAuth, require('./src/routes/whatsappOnboard'));

// // Any other /api or /webhook URL is a real 404 in JSON.
// app.use(['/api', '/webhook'], (req, res) => {
//   res.status(404).json({
//     success: false,
//     error: `API route not found: ${req.method} ${req.originalUrl}`
//   });
// });

// // ============================================================
// // FRONTEND
// // ============================================================

// // The dashboard itself needs login (declared BEFORE express.static)
// app.get(['/', '/index.html'], auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // login.html, account.html, css, js, icons, uploads ...
// app.use(
//   express.static(path.join(__dirname, 'src/public'), {
//     etag: false,
//     maxAge: 0
//   })
// );

// // SPA fallback (login required)
// app.get('*', auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // ============================================================
// // ERROR HANDLER (always JSON for /api and /webhook)
// // ============================================================

// // eslint-disable-next-line no-unused-vars
// app.use((err, req, res, next) => {
//   if (res.headersSent) return next(err);

//   const status = err.status || err.statusCode || 500;

//   let message = 'Server error';

//   if (err.type === 'entity.too.large') {
//     message = 'The upload is too large. Please use a smaller photo.';
//   } else if (err.type === 'entity.parse.failed') {
//     message = 'Invalid JSON sent to the server.';
//   } else if (status < 500) {
//     message = err.message || 'Bad request';
//   }

//   console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err.message);

//   if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/webhook')) {
//     return res.status(status).json({ success: false, error: message });
//   }

//   res.status(status).send(message);
// });

// // ============================================================
// // START SERVER
// // ============================================================

// app.listen(PORT, () => {
//   console.log('============================================================');
//   console.log('🔥 AI SALES BOT (multi-tenant)');
//   console.log('============================================================');
//   console.log(`🔑 Login:            http://localhost:${PORT}/login.html`);
//   console.log(`👤 My Account:       http://localhost:${PORT}/account.html`);
//   console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
//   console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
//   console.log(`📜 Legal pages:      /privacy  /terms  /data-deletion`);
//   console.log(`❤️  Health:           http://localhost:${PORT}/health`);
//   console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
//   console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
//   console.log(
//     `🔐 Legacy IG Token:  ${
//       process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
//     }`
//   );
//   console.log(
//     `🧩 OAuth app:        ${
//       process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
//         ? 'CONFIGURED'
//         : 'NOT CONFIGURED (needed for tenant connect)'
//     }`
//   );
//   console.log(
//     `💬 WhatsApp 1-click: ${
//       process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WHATSAPP_ES_CONFIG_ID
//         ? 'CONFIGURED'
//         : 'OFF (needs META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID)'
//     }`
//   );
//   console.log(
//     `🪝 Webhook verify:   ${
//       process.env.META_VERIFY_TOKEN
//         ? 'META_VERIFY_TOKEN set'
//         : 'WARNING: META_VERIFY_TOKEN not set (old built-in tokens are being used)'
//     }`
//   );
//   console.log(`👑 Admin login:      ${process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? process.env.ADMIN_EMAIL : 'NOT CONFIGURED'}`);
//   console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
//   console.log('============================================================');

//   if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
//     followUpWorker.start();
//   }

//   // Refresh tenants' 60-day Instagram tokens before they expire
//   instagramService.startTokenRefreshWorker();
// });


// //15/10 (updated: public privacy / terms / data-deletion pages for Meta + startup checks)

// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const path = require('path');

// const webhookRoutes = require('./src/routes/webhook');
// const authRoutes = require('./src/routes/auth');
// const instagramAuthRoutes = require('./src/routes/instagramAuth');
// const catalogRoutes = require('./src/routes/catalog');
// const leadsRoutes = require('./src/routes/leads');
// const simulatorRoutes = require('./src/routes/simulator');

// const followUpWorker = require('./src/engine/followUpWorker');
// const instagramService = require('./src/services/instagram');
// const auth = require('./src/services/auth');

// const app = express();

// // Behind Cloudflare / nginx / Render / Railway: set TRUST_PROXY=1 in .env so req.ip and req.secure are correct
// // (login rate-limit and the Secure cookie flag depend on them)
// if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

// const PORT = process.env.PORT || 3000;

// // Create / update the admin account from .env
// auth.seedAdmin();

// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.use(cors());

// // Keep the raw body so Meta's X-Hub-Signature-256 can be verified
// app.use(
//   express.json({
//     limit: '2mb',
//     verify: (req, res, buf) => {
//       req.rawBody = buf;
//     }
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Prevent cache
// app.use((req, res, next) => {
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });

// // Read the login cookie on every request (sets req.user when logged in)
// app.use(auth.attachUser);

// // ============================================================
// // PUBLIC ROUTES (no login)
// // ============================================================

// app.get('/health', (req, res) => {
//   res.json({
//     success: true,
//     status: 'online',
//     service: 'AI Sales Bot',
//     timestamp: new Date().toISOString()
//   });
// });

// /*
//  * Public legal pages. Meta asks for a Privacy Policy URL, Terms URL and a
//  * Data Deletion URL before an app can go Live / pass App Review.
//  * Set APP_NAME and SUPPORT_EMAIL in .env. Have a lawyer review the wording.
//  */
// const APP_NAME = process.env.APP_NAME || 'AI Sales Bot Studio';
// const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

// function legalPage(title, bodyHtml) {
//   return `<!doctype html>
// <html lang="en"><head>
// <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
// <title>${title} - ${APP_NAME}</title>
// <style>
//   body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;line-height:1.7}
//   main{max-width:780px;margin:0 auto;padding:32px 20px}
//   h1{font-size:28px;margin-bottom:4px} h2{font-size:18px;margin-top:28px;color:#f1f5f9}
//   a{color:#60a5fa} .muted{color:#94a3b8;font-size:13px}
// </style></head><body><main>
// <h1>${title}</h1>
// <div class="muted">${APP_NAME} · Last updated: ${new Date().toISOString().slice(0, 10)}</div>
// ${bodyHtml}
// </main></body></html>`;
// }

// app.get('/privacy', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Privacy Policy',
//       `
// <h2>Who we are</h2>
// <p>${APP_NAME} provides automated sales assistants for businesses on Instagram and WhatsApp. Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
// <h2>Data we process</h2>
// <p>When a business connects its Instagram or WhatsApp account, we process the messages and comments customers send to that business, customer names or handles, phone numbers, delivery addresses, order details, and the business's product catalogue.</p>
// <h2>Why we process it</h2>
// <p>Only to reply to customers, take orders, show the business its chats, leads and orders, and keep the service secure. We do not sell personal data.</p>
// <h2>Who we share it with</h2>
// <p>Meta (WhatsApp and Instagram) to send and receive messages, and AI and hosting providers that help us generate replies and run the service. They process data only on our instructions.</p>
// <h2>How long we keep it</h2>
// <p>For as long as the business uses the service, then deleted within 30 days of a deletion request or account closure, unless the law requires us to keep it.</p>
// <h2>Your rights</h2>
// <p>You can ask us to access, correct or delete your data. See <a href="/data-deletion">how to request deletion</a>.</p>
// `
//     )
//   );
// });

// app.get('/terms', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Terms of Service',
//       `
// <h2>Use of the service</h2>
// <p>${APP_NAME} lets a business automate replies and order-taking on Instagram and WhatsApp. The business is responsible for its products, prices, deliveries and for following WhatsApp's and Instagram's policies, including getting customers' consent before sending marketing messages.</p>
// <h2>Acceptable use</h2>
// <p>No spam, illegal goods, harassment, or misleading messages. We may suspend accounts that put the service or other users at risk.</p>
// <h2>Messaging costs</h2>
// <p>Meta may charge for some WhatsApp messages. These charges are billed by Meta to the business's WhatsApp payment method.</p>
// <h2>Availability</h2>
// <p>The service is provided as is. We work to keep it running but do not guarantee uninterrupted operation.</p>
// <h2>Contact</h2>
// <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
// `
//     )
//   );
// });

// app.get('/data-deletion', (req, res) => {
//   res.type('html').send(
//     legalPage(
//       'Data Deletion Instructions',
//       `
// <h2>How to delete your data</h2>
// <p>1. Send an email to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the subject "Delete my data".</p>
// <p>2. Include the phone number or Instagram handle you used to message a business. Businesses should include their account email.</p>
// <p>3. We delete the data within 30 days and confirm by email.</p>
// <h2>Businesses</h2>
// <p>A business can also disconnect WhatsApp and Instagram at any time from its dashboard, which stops all processing of new messages.</p>
// `
//     )
//   );
// });

// // Login / signup / logout / me
// app.use('/api/auth', authRoutes);

// // Webhook logs contain customer messages of ALL tenants -> admin only.
// // (Declared BEFORE the webhook router so it takes priority.)
// app.get(['/webhook/logs', '/api/webhook/logs'], auth.requireAdmin, (req, res) => {
//   res.json({ success: true, logs: webhookRoutes.webhookLogs });
// });

// // Meta webhooks must stay public
// app.use('/webhook', webhookRoutes);
// app.use('/api/webhook', webhookRoutes);

// // Instagram connect (login required inside) + OAuth callback (public, signed state)
// app.use('/api/instagram', instagramAuthRoutes);

// // ============================================================
// // LOGGED-IN ROUTES
// // ============================================================

// app.use('/api/catalog', auth.requireAuth, catalogRoutes);
// app.use('/api/leads', auth.requireAuth, leadsRoutes);
// app.use('/api/simulator', auth.requireAuth, auth.forceTenant, simulatorRoutes);

// // Manual WhatsApp settings (login required; harmless if the router also checks)
// app.use('/api/whatsapp', auth.requireAuth, require('./src/routes/whatsappSettings'));

// // Orders placed on WhatsApp (list + change status)
// app.use('/api/orders', auth.requireAuth, require('./src/routes/ordersApi'));

// // Products a business adds by hand (with photo) - shown in the WhatsApp catalogue
// app.use('/api/products', auth.requireAuth, require('./src/routes/productsApi'));

// // 1-click WhatsApp connect (Embedded Signup) + health check + test message.
// // Inactive until META_APP_ID etc. are set in .env
// app.use('/api/whatsapp-onboard', auth.requireAuth, require('/src/routes/whatsappOnboard'));

// // Any other /api or /webhook URL is a real 404 in JSON.
// app.use(['/api', '/webhook'], (req, res) => {
//   res.status(404).json({
//     success: false,
//     error: `API route not found: ${req.method} ${req.originalUrl}`
//   });
// });

// // ============================================================
// // FRONTEND
// // ============================================================

// // The dashboard itself needs login (declared BEFORE express.static)
// app.get(['/', '/index.html'], auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // login.html, account.html, css, js, icons, uploads ...
// app.use(
//   express.static(path.join(__dirname, 'src/public'), {
//     etag: false,
//     maxAge: 0
//   })
// );

// // SPA fallback (login required)
// app.get('*', auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // ============================================================
// // ERROR HANDLER (always JSON for /api and /webhook)
// // ============================================================

// // eslint-disable-next-line no-unused-vars
// app.use((err, req, res, next) => {
//   if (res.headersSent) return next(err);

//   const status = err.status || err.statusCode || 500;

//   let message = 'Server error';

//   if (err.type === 'entity.too.large') {
//     message = 'The upload is too large. Please use a smaller photo.';
//   } else if (err.type === 'entity.parse.failed') {
//     message = 'Invalid JSON sent to the server.';
//   } else if (status < 500) {
//     message = err.message || 'Bad request';
//   }

//   console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err.message);

//   if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/webhook')) {
//     return res.status(status).json({ success: false, error: message });
//   }

//   res.status(status).send(message);
// });

// // ============================================================
// // START SERVER
// // ============================================================

// app.listen(PORT, () => {
//   console.log('============================================================');
//   console.log('🔥 AI SALES BOT (multi-tenant)');
//   console.log('============================================================');
//   console.log(`🔑 Login:            http://localhost:${PORT}/login.html`);
//   console.log(`👤 My Account:       http://localhost:${PORT}/account.html`);
//   console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
//   console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
//   console.log(`📜 Legal pages:      /privacy  /terms  /data-deletion`);
//   console.log(`❤️  Health:           http://localhost:${PORT}/health`);
//   console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
//   console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
//   console.log(
//     `🔐 Legacy IG Token:  ${
//       process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
//     }`
//   );
//   console.log(
//     `🧩 OAuth app:        ${
//       process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
//         ? 'CONFIGURED'
//         : 'NOT CONFIGURED (needed for tenant connect)'
//     }`
//   );
//   console.log(
//     `💬 WhatsApp 1-click: ${
//       process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WHATSAPP_ES_CONFIG_ID
//         ? 'CONFIGURED'
//         : 'OFF (needs META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID)'
//     }`
//   );
//   console.log(
//     `🪝 Webhook verify:   ${
//       process.env.META_VERIFY_TOKEN
//         ? 'META_VERIFY_TOKEN set'
//         : 'WARNING: META_VERIFY_TOKEN not set (old built-in tokens are being used)'
//     }`
//   );
//   console.log(`👑 Admin login:      ${process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? process.env.ADMIN_EMAIL : 'NOT CONFIGURED'}`);
//   console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
//   console.log('============================================================');

//   if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
//     followUpWorker.start();
//   }

//   // Refresh tenants' 60-day Instagram tokens before they expire
//   instagramService.startTokenRefreshWorker();
// });

//13/10 (updated: JSON 404 for unknown API routes + JSON error handler)

// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const path = require('path');

// const webhookRoutes = require('./src/routes/webhook');
// const authRoutes = require('./src/routes/auth');
// const instagramAuthRoutes = require('./src/routes/instagramAuth');
// const catalogRoutes = require('./src/routes/catalog');
// const leadsRoutes = require('./src/routes/leads');
// const simulatorRoutes = require('./src/routes/simulator');

// const followUpWorker = require('./src/engine/followUpWorker');
// const instagramService = require('./src/services/instagram');
// const auth = require('./src/services/auth');

// const app = express();

// // Behind Cloudflare / nginx / Render / Railway: set TRUST_PROXY=1 in .env so req.ip and req.secure are correct
// // (login rate-limit and the Secure cookie flag depend on them)
// if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

// const PORT = process.env.PORT || 3000;

// // Create / update the admin account from .env
// auth.seedAdmin();

// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.use(cors());

// // Keep the raw body so Meta's X-Hub-Signature-256 can be verified
// app.use(
//   express.json({
//     limit: '2mb',
//     verify: (req, res, buf) => {
//       req.rawBody = buf;
//     }
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Prevent cache
// app.use((req, res, next) => {
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });

// // Read the login cookie on every request (sets req.user when logged in)
// app.use(auth.attachUser);

// // ============================================================
// // PUBLIC ROUTES (no login)
// // ============================================================

// app.get('/health', (req, res) => {
//   res.json({
//     success: true,
//     status: 'online',
//     service: 'AI Sales Bot',
//     timestamp: new Date().toISOString()
//   });
// });

// // Login / signup / logout / me
// app.use('/api/auth', authRoutes);

// // Webhook logs contain customer messages of ALL tenants -> admin only.
// // (Declared BEFORE the webhook router so it takes priority.)
// app.get(['/webhook/logs', '/api/webhook/logs'], auth.requireAdmin, (req, res) => {
//   res.json({ success: true, logs: webhookRoutes.webhookLogs });
// });

// // Meta webhooks must stay public
// app.use('/webhook', webhookRoutes);
// app.use('/api/webhook', webhookRoutes);

// // Instagram connect (login required inside) + OAuth callback (public, signed state)
// app.use('/api/instagram', instagramAuthRoutes);

// // ============================================================
// // LOGGED-IN ROUTES
// // ============================================================

// app.use('/api/catalog', auth.requireAuth, catalogRoutes);
// app.use('/api/leads', auth.requireAuth, leadsRoutes);
// app.use('/api/simulator', auth.requireAuth, auth.forceTenant, simulatorRoutes);

// // Manual WhatsApp settings (login required; harmless if the router also checks)
// app.use('/api/whatsapp', auth.requireAuth, require('./src/routes/whatsappSettings'));

// // Orders placed on WhatsApp (list + change status)
// app.use('/api/orders', auth.requireAuth, require('./src/routes/ordersApi'));

// // Products a business adds by hand (with photo) - shown in the WhatsApp catalogue
// app.use('/api/products', auth.requireAuth, require('./src/routes/productsApi'));

// // 1-click WhatsApp connect (Embedded Signup). Inactive until META_APP_ID etc. are set in .env
// app.use('/api/whatsapp-onboard', auth.requireAuth, require('./src/routes/whatsappOnboard'));

// // Any other /api or /webhook URL is a real 404 in JSON.
// // Without this, the SPA fallback below returned index.html (HTML) for a missing
// // API route, which the browser showed as: Unexpected token '<' ... is not valid JSON
// app.use(['/api', '/webhook'], (req, res) => {
//   res.status(404).json({
//     success: false,
//     error: `API route not found: ${req.method} ${req.originalUrl}`
//   });
// });

// // ============================================================
// // FRONTEND
// // ============================================================

// // The dashboard itself needs login (declared BEFORE express.static)
// app.get(['/', '/index.html'], auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // login.html, account.html, css, js, icons, uploads ...
// app.use(
//   express.static(path.join(__dirname, 'src/public'), {
//     etag: false,
//     maxAge: 0
//   })
// );

// // SPA fallback (login required)
// app.get('*', auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // ============================================================
// // ERROR HANDLER (always JSON for /api and /webhook)
// // Catches e.g. a product photo that is too large (413) or broken JSON (400)
// // ============================================================

// // eslint-disable-next-line no-unused-vars
// app.use((err, req, res, next) => {
//   if (res.headersSent) return next(err);

//   const status = err.status || err.statusCode || 500;

//   let message = 'Server error';

//   if (err.type === 'entity.too.large') {
//     message = 'The upload is too large. Please use a smaller photo.';
//   } else if (err.type === 'entity.parse.failed') {
//     message = 'Invalid JSON sent to the server.';
//   } else if (status < 500) {
//     message = err.message || 'Bad request';
//   }

//   console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err.message);

//   if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/webhook')) {
//     return res.status(status).json({ success: false, error: message });
//   }

//   res.status(status).send(message);
// });

// // ============================================================
// // START SERVER
// // ============================================================

// app.listen(PORT, () => {
//   console.log('============================================================');
//   console.log('🔥 AI SALES BOT (multi-tenant)');
//   console.log('============================================================');
//   console.log(`🔑 Login:            http://localhost:${PORT}/login.html`);
//   console.log(`👤 My Account:       http://localhost:${PORT}/account.html`);
//   console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
//   console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
//   console.log(`❤️  Health:           http://localhost:${PORT}/health`);
//   console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
//   console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
//   console.log(
//     `🔐 Legacy IG Token:  ${
//       process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
//     }`
//   );
//   console.log(
//     `🧩 OAuth app:        ${
//       process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
//         ? 'CONFIGURED'
//         : 'NOT CONFIGURED (needed for tenant connect)'
//     }`
//   );
//   console.log(
//     `💬 WhatsApp 1-click: ${
//       process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WHATSAPP_ES_CONFIG_ID
//         ? 'CONFIGURED'
//         : 'OFF (needs META_APP_ID, META_APP_SECRET, WHATSAPP_ES_CONFIG_ID)'
//     }`
//   );
//   console.log(`👑 Admin login:      ${process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? process.env.ADMIN_EMAIL : 'NOT CONFIGURED'}`);
//   console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
//   console.log('============================================================');

//   if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
//     followUpWorker.start();
//   }

//   // Refresh tenants' 60-day Instagram tokens before they expire
//   instagramService.startTokenRefreshWorker();
// });


// //6/10

// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const path = require('path');

// const webhookRoutes = require('./src/routes/webhook');
// const authRoutes = require('./src/routes/auth');
// const instagramAuthRoutes = require('./src/routes/instagramAuth');
// const catalogRoutes = require('./src/routes/catalog');
// const leadsRoutes = require('./src/routes/leads');
// const simulatorRoutes = require('./src/routes/simulator');

// const followUpWorker = require('./src/engine/followUpWorker');
// const instagramService = require('./src/services/instagram');
// const auth = require('./src/services/auth');

// const app = express();

// const PORT = process.env.PORT || 3000;

// // Create / update the admin account from .env
// auth.seedAdmin();

// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.use(cors());

// // Keep the raw body so Meta's X-Hub-Signature-256 can be verified
// app.use(
//   express.json({
//     limit: '2mb',
//     verify: (req, res, buf) => {
//       req.rawBody = buf;
//     }
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Prevent cache
// app.use((req, res, next) => {
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });

// // Read the login cookie on every request (sets req.user when logged in)
// app.use(auth.attachUser);

// // ============================================================
// // PUBLIC ROUTES (no login)
// // ============================================================

// app.get('/health', (req, res) => {
//   res.json({
//     success: true,
//     status: 'online',
//     service: 'AI Sales Bot',
//     timestamp: new Date().toISOString()
//   });
// });

// // Login / signup / logout / me
// app.use('/api/auth', authRoutes);

// // Webhook logs contain customer messages of ALL tenants -> admin only.
// // (Declared BEFORE the webhook router so it takes priority.)
// app.get(['/webhook/logs', '/api/webhook/logs'], auth.requireAdmin, (req, res) => {
//   res.json({ success: true, logs: webhookRoutes.webhookLogs });
// });

// // Meta webhooks must stay public
// app.use('/webhook', webhookRoutes);
// app.use('/api/webhook', webhookRoutes);

// // Instagram connect (login required inside) + OAuth callback (public, signed state)
// app.use('/api/instagram', instagramAuthRoutes);

// // ============================================================
// // LOGGED-IN ROUTES
// // ============================================================

// app.use('/api/catalog', auth.requireAuth, catalogRoutes);
// app.use('/api/leads', auth.requireAuth, leadsRoutes);
// app.use('/api/simulator', auth.requireAuth, auth.forceTenant, simulatorRoutes);
// app.use('/api/orders', auth.requireAuth, auth.forceTenant, require('./src/routes/ordersApi'));
// app.use('/api/whatsapp', require('./src/routes/whatsappSettings'));

// // ============================================================
// // FRONTEND
// // ============================================================

// // The dashboard itself needs login (declared BEFORE express.static)
// app.get(['/', '/index.html'], auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // login.html, account.html, css, js, icons ...
// app.use(
//   express.static(path.join(__dirname, 'src/public'), {
//     etag: false,
//     maxAge: 0
//   })
// );

// // SPA fallback (login required)
// app.get('*', auth.requireAuth, (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // ============================================================
// // START SERVER
// // ============================================================

// app.listen(PORT, () => {
//   console.log('============================================================');
//   console.log('🔥 AI SALES BOT (multi-tenant)');
//   console.log('============================================================');
//   console.log(`🔑 Login:            http://localhost:${PORT}/login.html`);
//   console.log(`👤 My Account:       http://localhost:${PORT}/account.html`);
//   console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
//   console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
//   console.log(`❤️  Health:           http://localhost:${PORT}/health`);
//   console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
//   console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
//   console.log(
//     `🔐 Legacy IG Token:  ${
//       process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
//     }`
//   );
//   console.log(
//     `🧩 OAuth app:        ${
//       process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
//         ? 'CONFIGURED'
//         : 'NOT CONFIGURED (needed for tenant connect)'
//     }`
//   );
//   console.log(`👑 Admin login:      ${process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? process.env.ADMIN_EMAIL : 'NOT CONFIGURED'}`);
//   console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
//   console.log('============================================================');

//   if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
//     followUpWorker.start();
//   }

//   // Refresh tenants' 60-day Instagram tokens before they expire
//   instagramService.startTokenRefreshWorker();
// });




// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const path = require('path');

// const webhookRoutes = require('./src/routes/webhook');
// const instagramAuthRoutes = require('./src/routes/instagramAuth');
// const catalogRoutes = require('./src/routes/catalog');
// const leadsRoutes = require('./src/routes/leads');
// const simulatorRoutes = require('./src/routes/simulator');

// const followUpWorker = require('./src/engine/followUpWorker');
// const instagramService = require('./src/services/instagram');

// const app = express();

// const PORT = process.env.PORT || 3000;

// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.use(cors());

// // Keep the raw body so Meta's X-Hub-Signature-256 can be verified
// app.use(
//   express.json({
//     limit: '2mb',
//     verify: (req, res, buf) => {
//       req.rawBody = buf;
//     }
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // Prevent cache
// app.use((req, res, next) => {
//   res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');
//   next();
// });

// // Static frontend
// app.use(
//   express.static(path.join(__dirname, 'src/public'), {
//     etag: false,
//     maxAge: 0
//   })
// );

// // ============================================================
// // HEALTH CHECK
// // ============================================================

// app.get('/health', (req, res) => {
//   res.json({
//     success: true,
//     status: 'online',
//     service: 'AI Sales Bot',
//     timestamp: new Date().toISOString()
//   });
// });

// // ============================================================
// // API ROUTES
// // ============================================================

// app.use('/webhook', webhookRoutes);
// app.use('/api/webhook', webhookRoutes);

// // Instagram connect + OAuth callback (replaces the old redirect that dropped ?code=)
// app.use('/api/instagram', instagramAuthRoutes);

// app.use('/api/catalog', catalogRoutes);
// app.use('/api/leads', leadsRoutes);
// app.use('/api/simulator', simulatorRoutes);

// // ============================================================
// // SPA FALLBACK
// // ============================================================

// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'src/public/index.html'));
// });

// // ============================================================
// // START SERVER
// // ============================================================

// app.listen(PORT, () => {
//   console.log('============================================================');
//   console.log('🔥 AI SALES BOT (multi-tenant)');
//   console.log('============================================================');
//   console.log(`🚀 Dashboard:        http://localhost:${PORT}`);
//   console.log(`📡 Webhook:          http://localhost:${PORT}/webhook`);
//   console.log(`🔗 Connect account:  http://localhost:${PORT}/api/instagram/connect?store_id=clothing`);
//   console.log(`❤️  Health:           http://localhost:${PORT}/health`);
//   console.log(`🤖 Gemini Model:     ${process.env.GEMINI_MODEL || 'gemini-flash-latest'}`);
//   console.log(`🔑 Gemini:           ${process.env.GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
//   console.log(`📸 Legacy IG Acc ID: ${process.env.INSTAGRAM_ACCOUNT_ID || 'NOT CONFIGURED'}`);
//   console.log(
//     `🔐 Legacy IG Token:  ${
//       process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'
//     }`
//   );
//   console.log(
//     `🧩 OAuth app:        ${
//       process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI
//         ? 'CONFIGURED'
//         : 'NOT CONFIGURED (needed for tenant connect)'
//     }`
//   );
//   console.log(`🔁 Auto Follow-Up:   ${process.env.ENABLE_AUTO_FOLLOW_UP !== 'false' ? 'ENABLED' : 'DISABLED'}`);
//   console.log('============================================================');

//   if (process.env.ENABLE_AUTO_FOLLOW_UP !== 'false') {
//     followUpWorker.start();
//   }

//   // Refresh tenants' 60-day Instagram tokens before they expire
//   instagramService.startTokenRefreshWorker();
// });
