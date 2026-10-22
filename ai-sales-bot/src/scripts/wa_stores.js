require('dotenv').config();
const db = require('../config/database');

for (const s of db.getStores()) {
  console.log({
    id: s.id,
    name: s.business_name || s.name,
    phone_number_id: s.whatsapp_phone_number_id || null,
    waba_id: s.whatsapp_waba_id || null,
    token_saved: Boolean(s.whatsapp_access_token),
    via: s.whatsapp_onboarded_via || null
  });
}