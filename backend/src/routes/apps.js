import { Router } from 'express';
import { appsRepo } from '../repositories/apps.js';
import { environmentsRepo } from '../repositories/environments.js';
import { integrationsRepo } from '../repositories/integrations.js';
import { appCreate, appUpdate, envName, envBody, checkEnvRules } from './schemas.js';
import { assertIntegrationTypes } from '../services/context.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { ah } from '../middleware/async.js';
import { testEnvironment } from '../services/connectivity.js';
import { envActionsRouter } from './env-actions.js';

export const appsRouter = Router();

function assertGithub(id) {
  if (!id) return;
  const i = integrationsRepo.get(id);
  if (!i || i.type !== 'github') throw new HttpError(400, `github_integration_id "${id}" is not a github integration`);
}

function validateEnvRow(row, name) {
  const issues = checkEnvRules({ ...row, name });
  if (issues.length) throw new HttpError(400, 'Invalid environment', issues);
  assertIntegrationTypes(row);
}

// ---------- apps ----------
appsRouter.get('/', (req, res) => res.json(appsRepo.list()));

appsRouter.get('/:appId', (req, res) => {
  const app = appsRepo.get(req.params.appId);
  if (!app) throw notFound('App');
  res.json({ ...app, environments: environmentsRepo.list(app.id) });
});

appsRouter.post('/', (req, res) => {
  const body = appCreate.parse(req.body);
  assertGithub(body.github_integration_id);
  res.status(201).json(appsRepo.create(body));
});

appsRouter.put('/:appId', (req, res) => {
  if (!appsRepo.get(req.params.appId)) throw notFound('App');
  const body = appUpdate.parse(req.body);
  assertGithub(body.github_integration_id);
  res.json(appsRepo.update(req.params.appId, body));
});

appsRouter.delete('/:appId', (req, res) => {
  if (!appsRepo.remove(req.params.appId)) throw notFound('App');
  res.status(204).end();
});

// ---------- environment actions (overview, release, sync, stress ...) ----------
appsRouter.use('/:appId/environments/:env', envActionsRouter);

// ---------- environments ----------
appsRouter.get('/:appId/environments', (req, res) => {
  if (!appsRepo.get(req.params.appId)) throw notFound('App');
  res.json(environmentsRepo.list(req.params.appId));
});

appsRouter.get('/:appId/environments/:env', (req, res) => {
  const e = environmentsRepo.get(req.params.appId, envName.parse(req.params.env));
  if (!e) throw notFound('Environment');
  res.json(e);
});

// PUT = create or update (upsert) for app + env
appsRouter.put('/:appId/environments/:env', (req, res) => {
  const { appId } = req.params;
  const name = envName.parse(req.params.env);
  if (!appsRepo.get(appId)) throw notFound('App');

  const existing = environmentsRepo.get(appId, name);
  if (existing) {
    const patch = envBody.partial().parse(req.body);
    validateEnvRow({ ...existing, ...patch }, name);
    return res.json(environmentsRepo.update(appId, name, patch));
  }
  const body = envBody.parse(req.body);
  validateEnvRow(body, name);
  res.status(201).json(environmentsRepo.create(appId, name, body));
});

appsRouter.post('/:appId/environments/:env/test', ah(async (req, res) => {
  res.json(await testEnvironment(req.params.appId, envName.parse(req.params.env)));
}));

appsRouter.delete('/:appId/environments/:env', (req, res) => {
  if (!environmentsRepo.remove(req.params.appId, envName.parse(req.params.env))) throw notFound('Environment');
  res.status(204).end();
});
