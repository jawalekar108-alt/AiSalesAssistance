require('dotenv').config();
const db = require('../config/database');
const wa = require('../services/whatsapp');

const V = process.env.META_GRAPH_VERSION || 'v23.0';
const [storeId, to] = process.argv.slice(2);

async function g(path, token) {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json() };
}

(async () => {
  const store = db.getStore(storeId || 'owner-test');
  if (!store) throw new Error('Store not found');
  const { token, phoneId } = wa.resolve(store);
  console.log('Store:', store.id, '| phone_number_id:', phoneId, '| waba:', store.whatsapp_waba_id);

  const phone = await g(`${phoneId}?fields=display_phone_number,verified_name,status,platform_type,quality_rating`, token);
  console.log('Number:', phone.status, phone.body);

  const subs = await g(`${store.whatsapp_waba_id}/subscribed_apps`, token);
  console.log('Subscribed apps:', subs.status, JSON.stringify(subs.body));

  const found = wa.findStoreByPhoneNumberId(String(phoneId));
  console.log('Webhook would route to store:', found ? found.id : 'NONE');

  if (to) {
    const digits = String(to).replace(/\D/g, '');
    await wa.sendTextOrTemplate(store, digits, `Test message from ${store.business_name}. WhatsApp is connected!`, { name: 'hello_world', language: 'en_US' });
    console.log('Test message sent to', digits);
  }
})().catch(e => console.error('FAILED:', e.graph || e.message));