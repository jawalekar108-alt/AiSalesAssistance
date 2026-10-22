// One shared Postgres (Supabase) pool for the salon module.
// Use the Supabase "Transaction pooler" connection string (port 6543) in SALON_DATABASE_URL.
const { Pool } = require('pg');

const connectionString = process.env.SALON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[salon] SALON_DATABASE_URL is not set - the parlour bot is disabled.');
}

const pool = connectionString
  ? new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;

if (pool) pool.on('error', (e) => console.error('[salon] pg pool error', e.message));

module.exports = pool;
