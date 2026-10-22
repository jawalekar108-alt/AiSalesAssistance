// WhatsApp connections of the parlours. The access token is stored ENCRYPTED
// with the same helper your clothing stores use (src/utils/secrets.js).
const secrets = require('../utils/secrets');

function open(row) {
  if (!row) return row;

  let token = row.access_token;

  try {
    token = secrets.decrypt(token) || token;
  } catch {
    /* an old plain-text token: use it as it is */
  }

  return { ...row, access_token: token };
}

const seal = (token) => secrets.encrypt(token);

async function byPhoneId(pool, phoneNumberId) {
  const { rows } = await pool.query('select * from salon_wa_connections where phone_number_id=$1', [String(phoneNumberId)]);
  return open(rows[0]);
}

async function byStore(pool, storeId) {
  const { rows } = await pool.query('select * from salon_wa_connections where store_id=$1 limit 1', [storeId]);
  return open(rows[0]);
}

module.exports = { open, seal, byPhoneId, byStore };
