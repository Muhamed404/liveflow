import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { login, logout, users, ROLES, COOKIE } from '../services/auth.js';
import { readCookie, requireRole } from '../middleware/auth.js';
import { HttpError, notFound } from '../middleware/errors.js';

export const authRouter = Router();

const cookieOpts = (maxAgeSec) => [
  `Path=/`, `HttpOnly`, `SameSite=Strict`, config.cookieSecure ? 'Secure' : null, `Max-Age=${maxAgeSec}`,
].filter(Boolean).join('; ');

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.', auth_mode: config.authMode });
  res.json({ user: req.user, auth_mode: config.authMode });
});

authRouter.post('/login', (req, res) => {
  if (config.authMode === 'off') return res.json({ user: req.user, auth_mode: 'off' });
  const { username, password } = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body);
  const s = login(username, password, req.ip);
  res.setHeader('Set-Cookie', `${COOKIE}=${s.token}; ${cookieOpts(s.maxAgeSec)}`);
  res.json({ user: s.user, auth_mode: 'local' });
});

authRouter.post('/logout', (req, res) => {
  logout(readCookie(req, COOKIE));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOpts(0)}`);
  res.status(204).end();
});

// ---------- user management (admin) ----------
export const usersRouter = Router();
usersRouter.use(requireRole('admin'));
const password = z.string().min(10, 'at least 10 characters').max(200);
const userCreate = z.object({
  username: z.string().regex(/^[a-zA-Z0-9._-]{2,40}$/, 'letters, digits, . _ -'),
  display_name: z.string().max(60).optional().nullable(),
  role: z.enum(ROLES),
  password,
});

usersRouter.get('/', (req, res) => res.json(users.list()));
usersRouter.post('/', (req, res) => res.status(201).json(users.create(userCreate.parse(req.body))));
usersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = users.get(id);
  if (!u) throw notFound('User');
  const body = userCreate.omit({ username: true }).partial().parse(req.body);
  if (body.role && body.role !== 'admin' && u.role === 'admin' && users.admins() === 1) {
    throw new HttpError(409, 'Keep at least one admin.');
  }
  res.json(users.update(id, body));
});
usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = users.get(id);
  if (!u) throw notFound('User');
  if (id === req.user.id) throw new HttpError(409, 'You can’t delete your own account.');
  if (u.role === 'admin' && users.admins() === 1) throw new HttpError(409, 'Keep at least one admin.');
  users.remove(id);
  res.status(204).end();
});
