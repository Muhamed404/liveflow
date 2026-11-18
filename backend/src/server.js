import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { config } from './config/env.js';
import './db/index.js';
import { clustersRouter } from './routes/clusters.js';
import { integrationsRouter } from './routes/integrations.js';
import { appsRouter } from './routes/apps.js';
import { authRouter, usersRouter } from './routes/auth.js';
import { errorHandler } from './middleware/errors.js';
import { authenticate, requireUser, appsGuard, settingsGuard, mutationsNeed } from './middleware/auth.js';
import { activity } from './services/activity.js';
import { presence } from './services/presence.js';
import { bootstrapAdmin } from './services/auth.js';

export function createServer() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Grafana panels are embedded in an iframe
        frameSrc: ["'self'", 'http:', 'https:'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // only force https when the dashboard is served over https; inside a plain-http network it would break every request
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
  }));
  if (config.corsOrigin !== 'same-origin') app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // ---------- public ----------
  app.get('/api/health', (req, res) => res.json({ status: 'ok', auth_mode: config.authMode }));
  app.use('/api', authenticate);
  app.use('/api/auth', authRouter);

  // ---------- signed in ----------
  app.use('/api', requireUser);
  app.use('/api/users', usersRouter);
  app.use('/api/clusters', settingsGuard, clustersRouter);
  app.use('/api/integrations', settingsGuard, integrationsRouter);
  app.use('/api/apps', appsGuard, appsRouter);

  // presence: the UI sends a heartbeat every ~10s; "N watching" reads it
  app.post('/api/presence', mutationsNeed('viewer'), (req, res) => {
    const body = z.object({ app: z.string().max(60).optional(), env: z.string().max(20).optional(), page: z.string().max(40).optional() }).parse(req.body || {});
    presence.beat({ user: req.actor, ...body });
    res.json(presence.list({ app: body.app, env: body.env }));
  });
  app.get('/api/presence', (req, res) => res.json(presence.list({ app: req.query.app, env: req.query.env })));
  app.get('/api/activity', (req, res) => res.json(activity.list({ limit: Math.min(Number(req.query.limit) || 50, 200) })));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

  // ---------- the built frontend (one container serves both) ----------
  if (config.staticDir && fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
    // SPA routes get index.html; a missing file (has an extension) stays a real 404
    app.get('*', (req, res, next) => (path.extname(req.path) ? next() : res.sendFile(path.resolve(config.staticDir, 'index.html'))));
  }

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  bootstrapAdmin();
  createServer().listen(config.port, () => console.log(`liveflow-backend listening on :${config.port} (auth: ${config.authMode})`));
}
