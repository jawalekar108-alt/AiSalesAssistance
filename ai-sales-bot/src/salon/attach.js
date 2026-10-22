// Plugs the parlour module into your existing Express app.
//   server.js : attachSalon(app)        -> mounts /api/salon/* and starts the reminders
//   webhook.js: getSalon()              -> asks "is this WhatsApp number a parlour?"
const pool = require('./db');
const llm = require('./llm');
const { init } = require('./index');
const salesWhatsApp = require('../services/whatsapp'); // your sales stores' WhatsApp numbers

let salon = null;

function attachSalon(app) {
  if (!pool) return null;

  // isReservedPhone: a parlour may never take over a number that a sales store already uses
  salon = init({ pool, llm, isReservedPhone: (id) => Boolean(salesWhatsApp.findStoreByPhoneNumberId(id)) });

  // /api/salon/*  (onboarding API, health check, reminder cron)
  app.use(salon.router);

  // Reminders 24h and 2h before the visit. Runs inside your server, no external cron needed.
  if (process.env.SALON_REMINDERS !== 'off') {
    const tick = () =>
      salon
        .runReminders()
        .then((n) => n && console.log(`[salon] reminders sent: ${n}`))
        .catch((e) => console.error('[salon] reminders', e.message));

    setInterval(tick, 5 * 60 * 1000).unref();
  }

  console.log('[salon] parlour module ready');
  return salon;
}

const getSalon = () => salon;

module.exports = { attachSalon, getSalon };
