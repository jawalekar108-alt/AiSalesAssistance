const crypto = require('crypto');

/*
 * Optional AES-256-GCM encryption for tokens stored in the DB.
 * Set TOKEN_ENCRYPTION_KEY in .env (any long random string) to enable.
 * Without a key, values are stored as plain text (fine for local dev only).
 * Already-stored plain tokens keep working; they are encrypted next time they are saved.
 */

const PREFIX = 'enc:v1:';

function getKey() {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k) return null;
  return crypto.createHash('sha256').update(k).digest();
}

function encrypt(plain) {
  const key = getKey();
  if (!key || !plain) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(value) {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value;
  }

  const key = getKey();
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is missing but the stored token is encrypted');

  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
