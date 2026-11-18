import { config } from '../config/env.js';
import { userFromToken, atLeast, COOKIE } from '../services/auth.js';
import { HttpError } from './errors.js';

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Sets req.user (or leaves it null). AUTH_MODE=off: everyone is an admin named by x-user. */
export function authenticate(req, res, next) {
  if (config.authMode === 'off') {
    const name = (req.get('x-user') || 'anonymous').slice(0, 60);
    req.user = { id: 0, username: name, display_name: name, role: 'admin' };
  } else {
    req.user = userFromToken(readCookie(req, COOKIE));
  }
  req.actor = req.user ? (req.user.display_name || req.user.username) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  next();
}

export const requireRole = (min) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  if (!atLeast(req.user.role, min)) return next(new HttpError(403, `Needs the ${min} role (you are ${req.user.role}).`));
  next();
};

/** Mutations need a role and must be JSON (with SameSite=Strict cookies this blocks cross-site form posts) */
export const mutationsNeed = (min) => (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.method !== 'DELETE' && !(req.get('content-type') || '').includes('application/json')) {
    return next(new HttpError(415, 'Send JSON (content-type: application/json).'));
  }
  return requireRole(min)(req, res, next);
};

/**
 * /api/apps/...: settings (app + env CRUD) need admin; env actions (release, sync, builds, stress)
 * and connection tests need operator; reads need any signed-in user.
 */
export function appsGuard(req, res, next) {
  const seg = req.path.split('/').filter(Boolean); // [app, 'environments', env, action...]
  const isAction = seg.length >= 4 && seg[1] === 'environments';
  return mutationsNeed(isAction ? 'operator' : 'admin')(req, res, next);
}

/** /api/clusters and /api/integrations: edits need admin, "Test" needs operator */
export function settingsGuard(req, res, next) {
  return mutationsNeed(req.path.endsWith('/test') ? 'operator' : 'admin')(req, res, next);
}
