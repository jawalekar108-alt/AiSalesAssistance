/*
 * List / delete business accounts and reset a password.
 * STOP THE SERVER FIRST (it keeps the data in memory and would overwrite your change).
 *
 *   node src/scripts/manage_accounts.js list
 *   node src/scripts/manage_accounts.js delete <store_id>          (shows what would be removed)
 *   node src/scripts/manage_accounts.js delete <store_id> --yes    (really removes it, after making a backup)
 *   node src/scripts/manage_accounts.js password <email> <new password>
 *   node src/scripts/manage_accounts.js whatsapp <store_id> <number with country code>   (sets the "Chat on WhatsApp" number)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/sales_bot_db.json');
const USERS_PATH = path.join(__dirname, '../../data/users.json');
const DEFAULT_STORE_ID = process.env.DEFAULT_STORE_TYPE || 'clothing';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const file of [DB_PATH, USERS_PATH]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${stamp}.bak`);
  }

  console.log(`Backup saved next to the data files (*.${stamp}.bak)`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

const [, , command, a, b, c] = process.argv;

const db = read(DB_PATH);
const usersFile = fs.existsSync(USERS_PATH) ? read(USERS_PATH) : { users: [] };
const users = usersFile.users || [];

if (command === 'list') {
  console.log('\nSTORES (business accounts)');
  console.log('-'.repeat(100));

  for (const s of db.stores || []) {
    const owners = users.filter(u => u.store_id === s.id).map(u => `${u.email} (${u.role})`).join(', ') || 'no login';
    console.log(`${String(s.id).padEnd(34)} ${String(s.business_name || s.name).padEnd(28)} type=${String(s.type).padEnd(12)} created=${String(s.created_at || '').slice(0, 10)}`);
    console.log(`   login: ${owners}`);
    console.log(`   whatsapp button number: ${s.whatsapp_number || 'NOT SET'}   link ${s.whatsapp_link_enabled === false ? 'OFF' : 'on'}`);
  }

  console.log('\nThe username is the EMAIL. Passwords are stored hashed and cannot be shown: use the "password" command to set a new one.\n');
} else if (command === 'delete') {
  const id = a;

  if (!id) throw new Error('Usage: delete <store_id> [--yes]');
  if (String(id) === String(DEFAULT_STORE_ID)) throw new Error(`"${id}" is your main default store. Refusing to delete it.`);

  const store = (db.stores || []).find(s => String(s.id) === String(id));
  if (!store) throw new Error(`No store with id "${id}". Run "list" to see the ids.`);

  const owners = users.filter(u => u.store_id === id);
  if (owners.some(u => u.role === 'admin')) throw new Error('This store belongs to the admin account. Refusing to delete it.');

  // everything in the database that carries this store id
  const related = {};

  for (const [key, value] of Object.entries(db)) {
    if (key === 'stores' || !Array.isArray(value)) continue;

    const n = value.filter(item => item && typeof item === 'object' && String(item.store_id ?? item.store_type ?? '') === String(id)).length;
    if (n) related[key] = n;
  }

  console.log(`\nStore:  ${store.business_name || store.name}  (${id})`);
  console.log(`Logins: ${owners.map(u => u.email).join(', ') || 'none'}`);
  console.log(`Data:   ${Object.entries(related).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing else'}`);

  if (!process.argv.includes('--yes')) {
    console.log('\nNothing was deleted. Run the same command with --yes to delete it.\n');
    process.exit(0);
  }

  backup();

  db.stores = db.stores.filter(s => String(s.id) !== String(id));

  for (const key of Object.keys(related)) {
    db[key] = db[key].filter(item => String(item.store_id ?? item.store_type ?? '') !== String(id));
  }

  usersFile.users = users.filter(u => u.store_id !== id);

  write(DB_PATH, db);
  write(USERS_PATH, usersFile);

  console.log(`\nDeleted "${store.business_name || store.name}" and ${owners.length} login(s). Start the server again.`);
  console.log('If this business also has a parlour in Supabase, delete it there too (see the SQL I sent).\n');
} else if (command === 'password') {
  const email = String(a || '').trim().toLowerCase();
  const user = users.find(u => u.email === email);

  if (!user) throw new Error(`No login with email "${email}". Run "list" to see the emails.`);
  if (String(b || '').length < 8) throw new Error('Usage: password <email> <new password of at least 8 characters>');

  backup();

  user.password_hash = hashPassword(b);
  write(USERS_PATH, usersFile);

  console.log(`\nNew password set for ${email}. Start the server and log in.\n`);
} else if (command === 'whatsapp') {
  const store = (db.stores || []).find(item => String(item.id) === String(a));
  const digits = String(b || '').replace(/\D/g, '');

  if (!store) throw new Error(`No store with id "${a}". Run "list" to see the ids.`);
  if (digits.length < 11 || digits.length > 15) throw new Error('Usage: whatsapp <store_id> <number with country code, e.g. 919876543210>');

  backup();

  store.whatsapp_number = digits;
  store.whatsapp_link_enabled = true;
  store.updated_at = new Date().toISOString();

  write(DB_PATH, db);

  console.log(`\nStore "${store.business_name || store.name}" now uses +${digits} for the "Chat on WhatsApp" button. Start the server again.\n`);
} else {
  console.log('Commands: list | delete <store_id> [--yes] | password <email> <new password> | whatsapp <store_id> <number>');
}
// /*
//  * List / delete business accounts and reset a password.
//  * STOP THE SERVER FIRST (it keeps the data in memory and would overwrite your change).
//  *
//  *   node src/scripts/manage_accounts.js list
//  *   node src/scripts/manage_accounts.js delete <store_id>          (shows what would be removed)
//  *   node src/scripts/manage_accounts.js delete <store_id> --yes    (really removes it, after making a backup)
//  *   node src/scripts/manage_accounts.js password <email> <new password>

