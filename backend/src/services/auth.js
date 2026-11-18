import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';

export const ROLES = ['viewer', 'operator', 'admin'];
const RANK = { viewer: 0, operator: 1, admin: 2 };
export const atLeast = (role, min) => RANK[role] >= RANK[min];
export const COOKIE = 'lf_session';

// ---------- passwords (scrypt, no native deps) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, got);
}
// spend the same time on unknown users so usernames can't be probed by timing
const DUMMY = hashPassword(crypto.randomBytes(12).toString('hex'));

// ---------- users ----------
const PUBLIC = 'id, username, display_name, role, created_at, last_login_at';
export const users = {
  count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  list: () => db.prepare(`SELECT ${PUBLIC} FROM users ORDER BY username`).all(),
  get: (id) => db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id),
  create({ username, display_name, role, password }) {
    const r = db.prepare('INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(username, display_name || null, role, hashPassword(password));
    return this.get(r.lastInsertRowid);
  },
  update(id, { display_name, role, password }) {
    if (display_name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name || null, id);
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (password !== undefined) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // password change signs out everywhere
    }
    return this.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes,
  admins: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n,
};

// ---------- login throttling: 10 failures per user+IP per 15 min ----------
const failures = new Map();
const WINDOW = 15 * 60 * 1000;
function throttleKey(username, ip) { return `${String(username).toLowerCase()}|${ip}`; }
function checkThrottle(key) {
  const f = failures.get(key);
  if (f && Date.now() - f.first < WINDOW && f.count >= 10) {
    throw new HttpError(429, 'Too many failed sign-ins. Try again in 15 minutes.');
  }
}
function noteFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

// ---------- sessions ----------
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function login(username, password, ip) {
  const key = throttleKey(username, ip);
  checkThrottle(key);
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = row ? verifyPassword(password, row.password_hash) : (verifyPassword(password, DUMMY), false);
  if (!ok) {
    noteFailure(key);
    throw new HttpError(401, 'Wrong username or password.');
  }
  failures.delete(key);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionHours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), row.id, expires);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  return { token, user: users.get(row.id), maxAgeSec: config.sessionHours * 3600 };
}

export function userFromToken(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha(token)) || null;
}

export const logout = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

/** First start: create the admin from ADMIN_PASSWORD so nobody has to touch the DB */
export function bootstrapAdmin(log = console) {
  if (config.authMode === 'off' || users.count() > 0) return;
  if (!config.adminPassword) {
    log.warn('No users yet. Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) and restart, or run: npm run user:create');
    return;
  }
  users.create({ username: config.adminUsername, role: 'admin', password: config.adminPassword });
  log.log(`Created admin user "${config.adminUsername}" from ADMIN_PASSWORD.`);
}
