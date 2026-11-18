import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../middleware/async.js';
import { envName } from './schemas.js';
import { resolveContext } from '../services/context.js';
import { audited, activity } from '../services/activity.js';
import * as observe from '../services/observe.js';
import * as deploy from '../services/deploy.js';
import * as stress from '../services/stress.js';
import { getEvents, getMarkers } from '../services/events.js';

// Mounted at /api/apps/:appId/environments/:env
export const envActionsRouter = Router({ mergeParams: true });

envActionsRouter.use((req, res, next) => {
  if (req.path === '/') return next('router'); // plain env CRUD is handled by apps.js
  req.ctx = resolveContext(req.params.appId, envName.parse(req.params.env));
  next();
});

const meta = (req, action, details) => ({ actor: req.actor, app_id: req.ctx.app.id, env: req.ctx.env.name, action, details });
const int = (min, max, def) => z.coerce.number().int().min(min).max(max).default(def);

// ---------------- observe ----------------
envActionsRouter.get('/overview', ah(async (req, res) => {
  const o = await observe.getOverview(req.ctx);
  // the overview is cached and shared; role limits are applied per request on a copy
  if (req.user.role === 'viewer') {
    const can = Object.fromEntries(Object.entries(o.can).map(([k, v]) => [k, v.allowed ? { allowed: false, reason: 'Viewers can watch but not run actions.' } : v]));
    return res.json({ ...o, can, role: req.user.role });
  }
  res.json({ ...o, role: req.user.role });
}));

envActionsRouter.get('/workload', ah(async (req, res) => res.json(await observe.getWorkload(req.ctx))));

envActionsRouter.get('/metrics', ah(async (req, res) => res.json(await observe.getMetrics(req.ctx))));

envActionsRouter.get('/metrics/:metric', ah(async (req, res) => {
  const minutes = int(5, 360, 15).parse(req.query.minutes);
  const [range, markers] = await Promise.all([
    observe.getMetricRange(req.ctx, req.params.metric, minutes),
    getMarkers(req.ctx, minutes),
  ]);
  res.json({ ...range, markers });
}));

envActionsRouter.get('/logs', ah(async (req, res) => {
  const q = z.object({
    limit: int(1, 500, 100),
    minutes: int(1, 1440, 15),
    contains: z.string().max(200).optional(),
  }).parse(req.query);
  res.json(await observe.getLogs(req.ctx, q));
}));

envActionsRouter.get('/events', ah(async (req, res) => {
  res.json(await getEvents(req.ctx, { limit: int(1, 200, 40).parse(req.query.limit) }));
}));

envActionsRouter.get('/activity', (req, res) => {
  res.json(activity.list({ app_id: req.ctx.app.id, env: req.ctx.env.name, limit: int(1, 200, 50).parse(req.query.limit) }));
});

// ---------------- pipeline ----------------
envActionsRouter.get('/builds', ah(async (req, res) => res.json(await deploy.listBuilds(req.ctx, int(1, 50, 10).parse(req.query.limit)))));

envActionsRouter.post('/builds', ah(async (req, res) => {
  const params = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().max(200)).default({}).parse(req.body?.params);
  res.status(202).json(await audited(meta(req, 'build', { params }), () => deploy.triggerBuild(req.ctx, params)));
}));

envActionsRouter.get('/builds/:number', ah(async (req, res) => {
  res.json(await deploy.getBuild(req.ctx, int(1, 1e9, 1).parse(req.params.number)));
}));

envActionsRouter.get('/builds/:number/log', ah(async (req, res) => {
  res.json(await deploy.getBuildLog(req.ctx, int(1, 1e9, 1).parse(req.params.number), int(0, 1e12, 0).parse(req.query.start)));
}));

envActionsRouter.get('/queue/:id', ah(async (req, res) => res.json(await deploy.queueStatus(req.ctx, int(1, 1e12, 1).parse(req.params.id)))));

// ---------------- releases (prod) ----------------
envActionsRouter.get('/releases', ah(async (req, res) => res.json(await deploy.listReleases(req.ctx))));

envActionsRouter.post('/releases', ah(async (req, res) => {
  deploy.requireProdConfirm(req.ctx, req.body);
  const body = z.object({ version: z.string(), notes: z.string().max(5000).optional() }).parse(req.body);
  res.status(202).json(await audited(meta(req, 'release', { version: body.version }), () => deploy.createRelease(req.ctx, body)));
}));

envActionsRouter.post('/rollback', ah(async (req, res) => {
  deploy.requireProdConfirm(req.ctx, req.body);
  const body = z.object({ version: z.string() }).parse(req.body);
  res.status(202).json(await audited(meta(req, 'rollback', body), () => deploy.rollback(req.ctx, body)));
}));

// ---------------- ArgoCD sync (prod gate) ----------------
envActionsRouter.post('/sync', ah(async (req, res) => {
  deploy.requireProdConfirm(req.ctx, req.body);
  res.json(await audited(meta(req, 'sync'), () => deploy.sync(req.ctx),
    (a) => ({ sync_status: a.sync_status, health_status: a.health_status, revision: a.revision })));
}));

// ---------------- stress test ----------------
envActionsRouter.get('/stress', ah(async (req, res) => res.json(await stress.stressStatus(req.ctx))));

envActionsRouter.post('/stress', ah(async (req, res) => {
  deploy.requireProdConfirm(req.ctx, req.body);
  const [vmin, vmax] = stress.STRESS_LIMITS.vus, [dmin, dmax] = stress.STRESS_LIMITS.duration_sec;
  const body = z.object({
    vus: z.number().int().min(vmin).max(vmax),
    duration_sec: z.number().int().min(dmin).max(dmax),
  }).parse(req.body);
  res.status(202).json(await audited(meta(req, 'stress_start', body), () => stress.startStress(req.ctx, body)));
}));

envActionsRouter.delete('/stress', ah(async (req, res) => {
  res.json(await audited(meta(req, 'stress_stop'), () => stress.stopStress(req.ctx)));
}));
