import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || './data/config.db',
  encryptionKey: required('ENCRYPTION_KEY'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // local = users + sessions (default) · off = no login, user name from the x-user header (demo / tests only)
  authMode: process.env.AUTH_MODE === 'off' ? 'off' : 'local',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  // set true when served over HTTPS (or behind a TLS-terminating proxy with TRUST_PROXY=1)
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY || false,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  staticDir: process.env.STATIC_DIR || '',
};
