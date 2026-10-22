/*
 * Quick command-line setup of one business's WhatsApp settings.
 * Put this file in the project ROOT (next to server.js). Do NOT put it in src/public.
 *
 * Usage:
 *   node set_whatsapp.js <storeId> <whatsappNumber> <phoneNumberId> <accessToken>
 *
 * Example:
 *   node set_whatsapp.js clothing 15551234567 123456789012345 EAAG...
 *
 * Stop the running server first, or restart it afterwards. The server keeps its own copy of the
 * database in memory, so a change made by this script is only picked up after a restart.
 * (The /api/whatsapp route in whatsappSettings.js has no such limit.)
 */
require('dotenv').config();

const db = require('./src/config/database');
const secrets = require('./src/utils/secrets');
const { normalizeNumber } = require('./src/services/whatsappLink');

const [storeId, numberRaw, phoneNumberId, tokenRaw] = process.argv.slice(2);

if (!storeId || !numberRaw || !phoneNumberId || !tokenRaw) {
  console.log('Usage: node set_whatsapp.js <storeId> <whatsappNumber> <phoneNumberId> <accessToken>');
  process.exit(1);
}

const store = db.getStore(storeId);

if (!store) {
  console.log(`Store "${storeId}" not found. Existing stores: ${db.getStores().map(s => s.id).join(', ')}`);
  process.exit(1);
}

const number = normalizeNumber(numberRaw);

if (!number) {
  console.log('The WhatsApp number must include the country code, e.g. 919876543210');
  process.exit(1);
}

if (!/^\d{5,25}$/.test(phoneNumberId)) {
  console.log('phoneNumberId must be the numeric "Phone number ID" from Meta, not the phone number.');
  process.exit(1);
}

const clash = db
  .getStores()
  .find(s => String(s.id) !== String(store.id) && String(s.whatsapp_phone_number_id || '') === phoneNumberId);

if (clash) {
  console.log(`This phone number id is already used by store "${clash.id}".`);
  process.exit(1);
}

const token = String(tokenRaw).trim().replace(/^Bearer\s+/i, '');

db.updateStore(store.id, {
  whatsapp_number: number,
  whatsapp_phone_number_id: phoneNumberId,
  whatsapp_access_token: secrets.encrypt(token),
  whatsapp_link_enabled: true
});

console.log(`Saved WhatsApp settings for store "${store.id}" (number +${number}).`);

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.log('Note: TOKEN_ENCRYPTION_KEY is not set in .env, so the token was stored as plain text.');
}