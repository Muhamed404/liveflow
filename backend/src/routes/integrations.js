import { Router } from 'express';
import { integrationsRepo } from '../repositories/integrations.js';
import { integrationCreate, integrationUpdate } from './schemas.js';
import { notFound } from '../middleware/errors.js';
import { ah } from '../middleware/async.js';
import { testIntegration } from '../services/connectivity.js';

export const integrationsRouter = Router();

// GET /api/integrations?type=jenkins
integrationsRouter.get('/', (req, res) => res.json(integrationsRepo.list(req.query.type)));

integrationsRouter.get('/:id', (req, res) => {
  const i = integrationsRepo.get(req.params.id);
  if (!i) throw notFound('Integration');
  res.json(i);
});

integrationsRouter.post('/', (req, res) => {
  res.status(201).json(integrationsRepo.create(integrationCreate.parse(req.body)));
});

integrationsRouter.put('/:id', (req, res) => {
  if (!integrationsRepo.get(req.params.id)) throw notFound('Integration');
  res.json(integrationsRepo.update(req.params.id, integrationUpdate.parse(req.body)));
});

integrationsRouter.post('/:id/test', ah(async (req, res) => res.json(await testIntegration(req.params.id))));

integrationsRouter.delete('/:id', (req, res) => {
  if (!integrationsRepo.remove(req.params.id)) throw notFound('Integration');
  res.status(204).end();
});
