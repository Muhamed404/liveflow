// Fake Jenkins / K8s / ArgoCD / GitHub / Prometheus / Loki / Grafana for local tests
import express from 'express';

export function startMockTools(port = 0) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const need = (expected) => (req, res, next) => (req.headers.authorization === expected ? next() : res.status(401).json({ message: 'unauthorized' }));
  const basicAuth = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
  const state = { syncs: 0, builds: [], k8sHits: 0, tags: ['v2.0.0', 'v2.1.0'], ci: { jobs: { 'frontend-staging-ci': [], 'frontend-prod': [], 'k6-stress': [] }, queue: {}, nextQueue: 500 } };
  state.finish = (job, result = 'SUCCESS') => { const b = state.ci.jobs[job].at(-1); if (b) { b.building = false; b.result = result; } };

  // ---------- Jenkins ----------
  const j = express.Router();
  j.use(need(basicAuth('admin', 'jenkins-token')));
  j.get('/me/api/json', (req, res) => res.json({ id: 'admin' }));
  j.get('/job/frontend-stg/api/json', (req, res) => {
    if (req.query.tree?.startsWith('builds')) return res.json({ builds: [{ number: 7, result: null, building: true, timestamp: Date.now(), duration: 0 }, { number: 6, result: 'SUCCESS', building: false, timestamp: Date.now() - 1e6, duration: 300000 }] });
    res.json({ name: 'frontend-stg', buildable: true });
  });
  j.post('/job/frontend-stg/buildWithParameters', (req, res) => { state.builds.push(req.body); res.status(201).set('location', 'http://jenkins/queue/item/42/').end(); });
  j.get('/queue/item/42/api/json', (req, res) => res.json({ executable: { number: 7 } }));
  j.get('/job/frontend-stg/7/api/json', (req, res) => res.json({ number: 7, result: null, building: true, timestamp: Date.now(), duration: 0, actions: [{ parameters: [{ name: 'VERSION', value: 'v2.2.0' }] }, {}] }));
  j.get('/job/frontend-stg/7/wfapi/describe', (req, res) => res.json({ stages: [{ name: 'Checkout', status: 'SUCCESS', durationMillis: 11000 }, { name: 'Test', status: 'IN_PROGRESS', durationMillis: 4000 }] }));
  j.get('/job/frontend-stg/7/logText/progressiveText', (req, res) => res.set({ 'x-text-size': '24', 'x-more-data': 'true', 'content-type': 'text/plain' }).send('Started by remote host\n'));
  app.use('/jenkins', j);

  // ---------- Generic stateful Jenkins (/ci) ----------
  const ci = express.Router();
  ci.use(need(basicAuth('admin', 'jenkins-token')));
  const jobOr404 = (req, res) => { const j = state.ci.jobs[req.params.job]; if (!j) res.status(404).json({}); return j; };
  ci.get('/me/api/json', (req, res) => res.json({ id: 'admin' }));
  ci.get('/job/:job/api/json', (req, res) => {
    const builds = jobOr404(req, res); if (!builds) return;
    if (req.query.tree?.startsWith('builds')) return res.json({ builds: [...builds].reverse().map((b) => ({ number: b.number, result: b.result, building: b.building, timestamp: b.ts, duration: 1000 })) });
    res.json({ name: req.params.job, buildable: true });
  });
  ci.post('/job/:job/:kind(build|buildWithParameters)', (req, res) => {
    const builds = jobOr404(req, res); if (!builds) return;
    const b = { number: builds.length + 1, building: true, result: null, params: { ...req.body }, ts: Date.now() - 100000, sha: 'd41e0a7c9b1f00112233445566778899aabbccdd' };
    builds.push(b);
    const q = state.ci.nextQueue++; state.ci.queue[q] = b.number;
    res.status(201).set('location', `http://jenkins/queue/item/${q}/`).end();
  });
  ci.get('/queue/item/:id/api/json', (req, res) => res.json({ executable: { number: state.ci.queue[req.params.id] } }));
  const findBuild = (req, res) => {
    const builds = jobOr404(req, res); if (!builds) return null;
    const b = req.params.b === 'lastBuild' ? builds.at(-1) : builds.find((x) => x.number === Number(req.params.b));
    if (!b) res.status(404).json({});
    return b;
  };
  ci.get('/job/:job/:b/api/json', (req, res) => { const b = findBuild(req, res); if (!b) return;
    res.json({ number: b.number, result: b.result, building: b.building, timestamp: b.ts, duration: b.building ? 0 : 300000, description: b.building ? null : `image=registry/frontend:${b.params.VERSION || 'stg-d41e0a7'}`,
      actions: [{ parameters: Object.entries(b.params).map(([name, value]) => ({ name, value })) }, { causes: [{ shortDescription: 'Started by user Mohamed', userName: 'Mohamed' }] }, { lastBuiltRevision: { SHA1: b.sha, branch: [{ name: 'origin/staging' }] } }] }); });
  ci.get('/job/:job/:b/wfapi/describe', (req, res) => { const b = findBuild(req, res); if (!b) return;
    res.json({ stages: [{ name: 'Checkout', status: 'SUCCESS', durationMillis: 1000 }, { name: 'Build + push', status: b.building ? 'IN_PROGRESS' : b.result === 'FAILURE' ? 'FAILED' : b.result, durationMillis: 2000 }, { name: 'Update values', status: b.building ? 'NOT_EXECUTED' : b.result === 'FAILURE' ? 'NOT_EXECUTED' : 'SUCCESS', durationMillis: 500 }] }); });
  // progressive console: grows while the build runs
  ci.get('/job/:job/:b/logText/progressiveText', (req, res) => { const b = findBuild(req, res); if (!b) return;
    const lines = ['Started by user Mohamed', '[Pipeline] stage (Checkout)', '+ git checkout ' + b.sha.slice(0, 7), '[Pipeline] stage (Build + push)',
      '+ docker build -t registry/frontend:' + (b.params.VERSION || 'stg-d41e0a7') + ' .', '#6 DONE 34.2s', '+ docker push …', '[Pipeline] stage (Update values)', '+ git push', b.building ? '' : `Finished: ${b.result}`];
    const full = lines.filter(Boolean).join('\n') + '\n';
    const shown = b.building ? full.slice(0, Math.min(full.length, 40 + Math.floor((Date.now() - b.ts - 100000) / 200))) : full;
    const start = Number(req.query.start || 0);
    res.set({ 'content-type': 'text/plain', 'x-text-size': String(shown.length), 'x-more-data': String(b.building) }).send(shown.slice(start)); });
  ci.post('/job/:job/:b/stop', (req, res) => { const b = findBuild(req, res); if (!b) return; b.building = false; b.result = 'ABORTED'; res.status(302).set('location', '/').end(); });
  app.use('/ci', ci);

  // ---------- Kubernetes ----------
  const k = express.Router();
  k.get('/version', (req, res) => res.json({ gitVersion: 'v1.30.2' }));
  k.use(need('Bearer sa-stg-secret'));
  k.get('/api', (req, res) => res.json({ versions: ['v1'] }));
  const nsImage = (ns) => (ns === 'frontend-prod' ? 'registry/frontend:v2.1.0' : 'registry/frontend:stg-abc1234');
  const isRolling = (ns) => state.rolling && ns === (state.rollingNs || 'frontend-stg');
  k.get('/apis/apps/v1/namespaces/:ns(frontend-stg|frontend-prod)/deployments/frontend', (req, res) => (state.k8sHits++, res.json({
    metadata: { name: 'frontend', generation: 3 },
    spec: { replicas: 3, selector: { matchLabels: { app: 'frontend' } }, template: { spec: { containers: [{ image: nsImage(req.params.ns) }] } } },
    status: { readyReplicas: state.allReady && !isRolling(req.params.ns) ? 3 : 2, updatedReplicas: 3, availableReplicas: 2, observedGeneration: 3 },
  })));
  // more services next to "frontend", so an environment can list several deployments (retail-store has five)
  const EXTRA = { catalog: 2, cart: 2, orders: 1, checkout: 1 };
  const extraImage = (ns, name) => nsImage(ns).replace('registry/frontend:', `registry/${name}:`);
  k.get('/apis/apps/v1/namespaces/:ns(frontend-stg|frontend-prod)/deployments/:name(catalog|cart|orders|checkout)', (req, res) => {
    const { ns, name } = req.params, n = EXTRA[name];
    res.json({
      metadata: { name, generation: 2 },
      spec: { replicas: n, selector: { matchLabels: { app: name } }, template: { spec: { containers: [{ image: extraImage(ns, name) }] } } },
      status: { readyReplicas: n, updatedReplicas: n, availableReplicas: n, observedGeneration: 2 },
    });
  });
  k.get('/apis/apps/v1/namespaces/:ns/deployments/:name', (req, res) => res.status(404).json({}));
  k.get('/api/v1/namespaces/:ns(frontend-stg|frontend-prod)/pods', (req, res) => {
    const ns = req.params.ns;
    const extra = /^app=(catalog|cart|orders|checkout)$/.exec(req.query.labelSelector || '')?.[1];
    if (extra) {
      return res.json({ items: Array.from({ length: EXTRA[extra] }, (_, i) => ({
        metadata: { name: `${extra}-5c8b-${'xyz'[i]}` }, spec: { nodeName: `node-${i + 1}`, containers: [{ image: extraImage(ns, extra) }] },
        status: { phase: 'Running', startTime: '2026-10-20T10:00:00Z', containerStatuses: [{ ready: true, restartCount: 0, state: { running: {} } }] },
      })) });
    }
    if (req.query.labelSelector !== 'app=frontend') return res.json({ items: [] });
    const pod = (n, ready, waiting) => ({ metadata: { name: `frontend-7d9f-${n}` }, spec: { nodeName: 'node-1', containers: [{ image: nsImage(ns) }] },
      status: { phase: 'Running', startTime: '2026-10-20T10:00:00Z', containerStatuses: [{ ready, restartCount: 1, state: waiting ? { waiting: { reason: 'ContainerCreating' } } : { running: {} } }] } });
    const cReady = state.allReady && !isRolling(ns);
    const items = [pod('b', true), pod('a', true), pod('c', cReady, !cReady)];
    if (isRolling(ns)) items[2].spec.containers[0].image = 'registry/frontend:stg-old0000';
    res.json({ items });
  });
  k.get('/api/v1/namespaces/:ns(frontend-stg|frontend-prod)/events', (req, res) => res.json({ items: [
    { involvedObject: { kind: 'HorizontalPodAutoscaler', name: 'frontend-hpa' }, reason: 'SuccessfulRescale', message: 'New size: 3; reason: cpu resource utilization (percentage of request) above target', type: 'Normal', lastTimestamp: new Date(Date.now() - 60000).toISOString() },
    { involvedObject: { kind: 'Pod', name: 'frontend-7d9f8c6b5-x2k4c' }, reason: 'Pulling', message: 'Pulling image "registry/frontend:stg-abc1234"', type: 'Normal', lastTimestamp: new Date(Date.now() - 30000).toISOString() },
    { involvedObject: { kind: 'Pod', name: 'other-app-1' }, reason: 'BackOff', message: 'should be filtered out', type: 'Warning', lastTimestamp: new Date().toISOString() },
    // a database next to the "catalog" Deployment: same prefix, must not show up as catalog events
    { involvedObject: { kind: 'Pod', name: 'catalog-db-0' }, reason: 'BackOff', message: 'should be filtered out (database pod)', type: 'Warning', lastTimestamp: new Date().toISOString() },
    { involvedObject: { kind: 'StatefulSet', name: 'catalog-db' }, reason: 'SuccessfulCreate', message: 'should be filtered out (database set)', type: 'Normal', lastTimestamp: new Date().toISOString() },
    { involvedObject: { kind: 'HorizontalPodAutoscaler', name: 'cart-hpa' }, reason: 'SuccessfulRescale', message: 'New size: 2; reason: cpu resource utilization (percentage of request) above target', type: 'Normal', lastTimestamp: new Date(Date.now() - 90000).toISOString() },
  ] }));
  k.get('/apis/autoscaling/v2/namespaces/:ns(frontend-stg|frontend-prod)/horizontalpodautoscalers', (req, res) => res.json({ items: [{
    metadata: { name: 'frontend-hpa' },
    spec: { minReplicas: 2, maxReplicas: 5, scaleTargetRef: { kind: 'Deployment', name: 'frontend' }, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { averageUtilization: 70 } } }] },
    status: { currentReplicas: 3, desiredReplicas: 3, currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 64 } } }] },
  }, {
    metadata: { name: 'cart-hpa' },
    spec: { minReplicas: 1, maxReplicas: 4, scaleTargetRef: { kind: 'Deployment', name: 'cart' }, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { averageUtilization: 70 } } }] },
    status: { currentReplicas: 2, desiredReplicas: 2, currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 48 } } }] },
  }] }));
  app.use('/k8s', k);

  // ---------- ArgoCD ----------
  const a = express.Router();
  a.use(need('Bearer argocd-main-token'));
  a.get('/api/v1/session/userinfo', (req, res) => res.json({ loggedIn: true, username: 'liveflow' }));
  // per-app overrides in state.argoApps[name] = { sync, manual }; otherwise the global argoSync/argoManual flags
  a.get('/api/v1/applications/:name(frontend-staging|frontend-prod)', (req, res) => { const o = state.argoApps?.[req.params.name] || { sync: state.argoSync, manual: state.argoManual }; res.json({
    metadata: { name: req.params.name },
    spec: { syncPolicy: o.manual ? {} : { automated: { prune: true } } },
    status: { sync: { status: o.sync || 'Synced', revision: 'abc1234' }, health: { status: 'Healthy' }, summary: { images: ['registry/frontend:stg-abc1234'] },
      history: [{ id: 1, revision: 'old0000', deployedAt: '2026-10-19T10:00:00Z' }, { id: 2, revision: 'abc1234', deployedAt: new Date(Date.now() - 5 * 60000).toISOString() }] },
  }); });
  a.post('/api/v1/applications/:name(frontend-staging|frontend-prod)/sync', (req, res) => { state.syncs++; if (state.argoApps?.[req.params.name]) state.argoApps[req.params.name].sync = 'Synced'; res.json({}); });
  app.use('/argocd', a);

  // ---------- GitHub ----------
  const g = express.Router();
  g.use(need('Bearer github-main-token'));
  g.get('/user', (req, res) => res.json({ login: 'mohamed' }));
  g.get('/repos/myorg/frontend-app', (req, res) => res.json({ full_name: 'myorg/frontend-app', default_branch: 'main', permissions: { push: true } }));
  g.get('/repos/myorg/frontend-app/git/ref/tags/:tag', (req, res) => res.status(state.tags.includes(req.params.tag) ? 200 : 404).json({}));
  g.get('/repos/myorg/frontend-app/releases', (req, res) => res.json([...state.tags].reverse().map((t) => ({ tag_name: t, name: t, target_commitish: 'main', created_at: '2026-10-19T10:00:00Z', html_url: `https://gh/r/${t}` }))));
  g.post('/repos/myorg/frontend-app/releases', (req, res) => { state.tags.push(req.body.tag_name); state.lastRelease = req.body; res.status(201).json({ tag_name: req.body.tag_name, html_url: 'https://gh/r/new', created_at: new Date().toISOString() }); });
  app.use('/github', g);

  // ---------- Prometheus (no auth) ----------
  for (const p of ['/prom-dev', '/prom-stg']) {
    const r = express.Router();
    r.get('/api/v1/status/buildinfo', (req, res) => res.json({ status: 'success', data: { version: '2.53.0' } }));
    r.get('/api/v1/query', (req, res) => {
      const q = req.query.query;
      if (q.includes('container_last_seen')) {
        if (!q.includes('container_label_com_docker_compose_project="frontend"')) return res.json({ data: { result: [] } });
        return res.json({ data: { result: [
          { metric: { name: 'frontend-web-1', container_label_com_docker_compose_service: 'web' }, value: [0, String(Date.now() / 1000)] },
          { metric: { name: 'frontend-redis-1', container_label_com_docker_compose_service: 'redis' }, value: [0, String(Date.now() / 1000)] },
        ] } });
      }
      // tests expect 0.42 by default; the demo turns on realistic per-metric values
      if (!state.realistic) return res.json({ data: { result: [{ metric: {}, value: [0, '0.42'] }] } });
      const v = q.includes('status=~') ? 0.004 : q.includes('http_requests_total') ? 142 : q.includes('memory') ? 640 * 1048576 : 0.41;
      res.json({ data: { result: [{ metric: {}, value: [0, String(v * (0.95 + Math.random() * 0.1))] }] } });
    });
    r.get('/api/v1/query_range', (req, res) => {
      if (!state.realistic) return res.json({ data: { result: [{ metric: {}, values: [[1, '0.1'], [2, 'NaN'], [3, '0.3']] }] } });
      const q = req.query.query, start = Number(req.query.start), end = Number(req.query.end), step = Number(req.query.step);
      const base = q.includes('status=~') ? 0.004 : q.includes('http_requests_total') ? 120 : q.includes('memory') ? 600 * 1048576 : 0.35;
      const values = [];
      for (let t = start, i = 0; t <= end; t += step, i++) {
        const wave = 1 + 0.18 * Math.sin(i / 6) + 0.25 * (i / ((end - start) / step)) + (Math.random() - 0.5) * 0.08;
        values.push([t, String(base * wave)]);
      }
      res.json({ data: { result: [{ metric: {}, values }] } });
    });
    app.use(p, r);
  }

  // ---------- Loki ----------
  const l = express.Router();
  l.get('/loki/api/v1/labels', (req, res) => res.json({ data: ['namespace'] }));
  l.get('/loki/api/v1/query_range', (req, res) => {
    const ns = (BigInt(Date.now()) * 1_000_000n);
    res.json({ data: { result: [{ stream: { pod: 'frontend-7d9f-a' }, values: [[String(ns), 'GET /health 200'], [String(ns - 1_000_000_000n), 'ERROR db timeout']] }] } });
  });
  app.use('/loki', l);

  // ---------- Grafana ----------
  const gr = express.Router();
  gr.use(need('Bearer grafana-token'));
  gr.get('/api/search', (req, res) => res.json([]));
  gr.get('/api/dashboards/uid/d3f8a2bc', (req, res) => res.json({ dashboard: { title: 'Frontend' } }));
  app.use('/grafana', gr);

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, state }));
  });
}
