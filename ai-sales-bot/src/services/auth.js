const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../config/database');

/*
 * Simple built-in login (no extra npm packages).
 *
 * - Users are stored in data/users.json (passwords are hashed with scrypt).
 * - Login sets an HttpOnly cookie "sb_session" (signed with SESSION_SECRET).
 * - Every user belongs to exactly ONE store (store_id).
 * - role "admin"  = platform owner (you): can see all stores in the dashboard.
 *   role "owner"  = a business that signed up: sees ONLY its own store.
 */

const USERS_PATH = path.join(__dirname, '../../data/users.json');
const COOKIE_NAME = 'sb_session';
const SESSION_DAYS = 7;
const DEFAULT_STORE_ID = process.env.DEFAULT_STORE_TYPE || 'clothing';

/* ============================================================
 * USERS FILE
 * ============================================================ */

function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
      return Array.isArray(parsed.users) ? parsed.users : [];
    }
  } catch (error) {
    console.error('[Auth] Could not read users file:', error.message);
  }

  return [];
}

let users = loadUsers();

function saveUsers() {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2), 'utf8');
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findUserByEmail(email) {
  const e = normEmail(email);
  return users.find(u => u.email === e) || null;
}

/* ============================================================
 * PASSWORDS
 * ============================================================ */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = String(stored).split('$');
    const test = crypto.scryptSync(String(password), salt, 64);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(known, test);
  } catch {
    return false;
  }
}

/* ============================================================
 * SESSION COOKIE
 * ============================================================ */

let devSecret = null;

function sessionSecret() {
  const s = process.env.SESSION_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (s) return s;

  if (!devSecret) {
    devSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[Auth] SESSION_SECRET is not set - everyone is logged out on every restart. Add it to .env');
  }

  return devSecret;
}

function signSession(userId) {
  const body = Buffer.from(
    JSON.stringify({ u: userId, exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000 })
  ).toString('base64url');

  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');

  return `${body}.${sig}`;
}

function verifySession(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;

    const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;

    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};

  String(header || '')
    .split(';')
    .forEach(part => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });

  return out;
}

function setSessionCookie(req, res, userId) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';

  const cookie = [
    `${COOKIE_NAME}=${signSession(userId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 3600}`
  ];

  if (secure) cookie.push('Secure');

  res.setHeader('Set-Cookie', cookie.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ============================================================
 * LOGIN RATE LIMIT (10 failed tries / 15 min per ip+email)
 * ============================================================ */

const failures = new Map();

function tooManyAttempts(key) {
  const now = Date.now();
  const recent = (failures.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  failures.set(key, recent);
  return recent.length >= 10;
}

function noteFailure(key) {
  failures.set(key, [...(failures.get(key) || []), Date.now()]);
}

/* ============================================================
 * SIGNUP / LOGIN
 * ============================================================ */

function signup({ email, password, businessName, inviteCode }) {
  if (process.env.ALLOW_SIGNUP === 'false') {
    throw httpError(403, 'Signup is closed');
  }

  const invite = process.env.SIGNUP_INVITE_CODE;

  if (invite && String(inviteCode || '').trim() !== invite) {
    throw httpError(403, 'Invalid invite code');
  }

  const e = normEmail(email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw httpError(400, 'Enter a valid email');
  if (String(password || '').length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (findUserByEmail(e)) throw httpError(409, 'An account with this email already exists');

  const store = db.createStore({
    business_name: String(businessName || 'My Business').trim().slice(0, 80) || 'My Business',
    type: 'custom'
  });

  const user = {
    id: 'usr_' + crypto.randomBytes(6).toString('hex'),
    email: e,
    password_hash: hashPassword(password),
    store_id: store.id,
    role: 'owner',
    created_at: new Date().toISOString()
  };

  users.push(user);
  saveUsers();

  return user;
}

function login(req, { email, password }) {
  const key = `${req.ip}|${normEmail(email)}`;

  if (tooManyAttempts(key)) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');

  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    noteFailure(key);
    throw httpError(401, 'Wrong email or password');
  }

  return user;
}

/*
 * ADMIN (you): set ADMIN_EMAIL and ADMIN_PASSWORD in .env.
 * The admin owns the default store (clothing) and can see all stores.
 * .env is the source of truth: changing ADMIN_PASSWORD there resets the password on next start.
 */
function seedAdmin() {
  const email = normEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('[Auth] ADMIN_EMAIL / ADMIN_PASSWORD not set - nobody can log in as admin yet.');
    return;
  }

  let admin = findUserByEmail(email);

  if (!admin) {
    admin = {
      id: 'usr_' + crypto.randomBytes(6).toString('hex'),
      email,
      password_hash: hashPassword(password),
      store_id: DEFAULT_STORE_ID,
      role: 'admin',
      created_at: new Date().toISOString()
    };

    users.push(admin);
    saveUsers();
    console.log(`[Auth] Admin account created: ${email}`);
    return;
  }

  let changed = false;

  if (!verifyPassword(password, admin.password_hash)) {
    admin.password_hash = hashPassword(password);
    changed = true;
  }

  if (admin.role !== 'admin' || admin.store_id !== DEFAULT_STORE_ID) {
    admin.role = 'admin';
    admin.store_id = DEFAULT_STORE_ID;
    changed = true;
  }

  if (changed) {
    saveUsers();
    console.log(`[Auth] Admin account updated: ${email}`);
  }
}

/* ============================================================
 * MIDDLEWARE
 * ============================================================ */

/*
 * Sets req.user = { id, email, role, home_store_id, store_id }
 *   home_store_id : the user's own store (always set)
 *   store_id      : set ONLY for normal businesses. The catalog/leads/simulator routes
 *                   force this store, so a tenant can never read another tenant's data.
 *                   It is empty for admin (admin may switch stores in the dashboard).
 */
function attachUser(req, res, next) {
  const data = verifySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);

  if (data) {
    const user = users.find(u => u.id === data.u);

    if (user && db.getStore(user.store_id)) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        home_store_id: user.store_id,
        store_id: user.role === 'admin' ? null : user.store_id
      };
    }
  }

  next();
}

function wantsJson(req) {
  return (
    req.originalUrl.startsWith('/api/') ||
    req.originalUrl.startsWith('/webhook') ||
    String(req.headers.accept || '').includes('application/json')
  );
}

function requireAuth(req, res, next) {
  if (req.user) return next();

  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Login required' });
  }

  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);

  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  next();
}

// For routes that read the store from body/header (e.g. simulator): force the tenant's own store
function forceTenant(req, res, next) {
  if (req.user?.store_id) {
    req.body = req.body || {};
    req.body.store_id = req.user.store_id;
    req.body.store_type = req.user.store_id;
    req.headers['x-store-id'] = req.user.store_id;
  }

  next();
}

module.exports = {
  signup,
  login,
  seedAdmin,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  forceTenant
};