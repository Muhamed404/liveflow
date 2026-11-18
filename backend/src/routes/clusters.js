import { Router } from 'express';
import { clustersRepo } from '../repositories/clusters.js';
import { clusterCreate, clusterUpdate } from './schemas.js';
import { notFound } from '../middleware/errors.js';
import { ah } from '../middleware/async.js';
import { testCluster } from '../services/connectivity.js';

export const clustersRouter = Router();

clustersRouter.get('/', (req, res) => res.json(clustersRepo.list()));

clustersRouter.get('/:id', (req, res) => {
  const c = clustersRepo.get(req.params.id);
  if (!c) throw notFound('Cluster');
  res.json(c);
});

clustersRouter.post('/', (req, res) => {
  res.status(201).json(clustersRepo.create(clusterCreate.parse(req.body)));
});

clustersRouter.put('/:id', (req, res) => {
  if (!clustersRepo.get(req.params.id)) throw notFound('Cluster');
  res.json(clustersRepo.update(req.params.id, clusterUpdate.parse(req.body)));
});

clustersRouter.post('/:id/test', ah(async (req, res) => res.json(await testCluster(req.params.id))));

clustersRouter.delete('/:id', (req, res) => {
  if (!clustersRepo.remove(req.params.id)) throw notFound('Cluster');
  res.status(204).end();
});
