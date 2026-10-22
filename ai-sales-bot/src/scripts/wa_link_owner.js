require('dotenv').config();
const db = require('../config/database');
const secrets = require('../utils/secrets');

const V = process.env.META_GRAPH_VERSION || 'v23.0';
const [storeId, wabaId, phoneId] = process.argv.slice(2);
const token = process.env.WHATSAPP_ACCESS_TOKEN;

if (!storeId || !wabaId || !phoneId || !token) {
  console.error('Usage: node src/scripts/wa_link_owner.js <storeId> <wabaId> <phoneNumberId>');
  console.error('Needs WA_TEST_ACCESS_TOKEN in .env');
  process.exit(1);
}

(async () => {
  // 1) read the number from Meta first
  const r = await fetch(
    `https://graph.facebook.com/${V}/${phoneId}?fields=display_phone_number,verified_name,status,platform_type,quality_rating,name_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const phone = await r.json();
  console.log('Meta says:', phone);
  if (!r.ok) process.exit(1);

  // 2) refuse if another store already owns this number
  const clash = db.getStores().find(
    s => String(s.id) !== String(storeId) && String(s.whatsapp_phone_number_id || '') === String(phoneId)
  );
  if (clash) {
    console.error(`Phone number is already linked to store "${clash.id}". Clear it there first.`);
    process.exit(1);
  }

  // 3) create the store if it does not exist yet
  if (!db.getStores().some(s => String(s.id) === String(storeId))) {
    db.createStore({
      id: storeId,
      name: 'Owner Test Store',
      business_name: 'Owner Test Store',
      type: 'clothing' // uses the same bot flow as the clothing store
    });
    console.log('Created store:', storeId);
  }

  // 4) save the WhatsApp details on it
  const digits = String(phone.display_phone_number || '').replace(/\D/g, '');
  const updated = db.updateStore(storeId, {
    whatsapp_access_token: secrets.encrypt(token),
    whatsapp_phone_number_id: phoneId,
    whatsapp_waba_id: wabaId,
    whatsapp_number: digits,
    whatsapp_verified_name: phone.verified_name || '',
    whatsapp_link_enabled: true,
    whatsapp_onboarded_via: 'manual',
    whatsapp_connected_at: new Date().toISOString()
  });

  console.log('Saved on store:', updated?.id, '| phone_number_id:', updated?.whatsapp_phone_number_id);
})();



