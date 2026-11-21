// Pure logic: delivery path states and the shared cache (no server, no mock tools)
import { buildPath } from '../src/services/path.js';
import { cached, invalidate } from '../src/utils/cache.js';

let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 6 }); } };

const ctx = (runtime = 'k8s') => ({
  app: { id: 'a' }, env: { name: 'staging', runtime, deploy_mode: 'auto' },
  k8s: runtime === 'k8s' ? { cluster: { id: 'c' }, namespace: 'shop', deployment: 'ui', deployments: ['ui', 'cart'] } : null,
  compose: runtime === 'compose' ? { project: 'shop' } : null, argocd: runtime === 'k8s' ? { app: 'shop' } : null,
});
const svc = (name, desired, ready, onNew = ready, rolling = false) => ({
  name, version: `${name}-1`, image: `r/${name}:1`, rolling_out: rolling, hpa: null,
  replicas: { desired, ready, updated: onNew, on_current_version: onNew },
  instances: Array.from({ length: Math.max(desired, ready) }, (_, i) => ({ name: `${name}-abc12345-xxxx${i}`, phase: 'Running', ready: i < ready, current: i < onNew, service: name })),
});
const workload = (runtime, services) => {
  const sum = (k) => services.reduce((n, s) => n + s.replicas[k], 0);
  return { runtime, version: services[0]?.version, versions: [], instances: services.flatMap((s) => s.instances), services,
    replicas: { desired: sum('desired'), ready: sum('ready'), updated: sum('updated'), on_current_version: sum('on_current_version') },
    rolling_out: services.some((s) => s.rolling_out) };
};
const path = (runtime, services) => buildPath(ctx(runtime), {
  pipeline: { data: { number: 3, status: 'SUCCESS', params: {} } },
  argocd: { data: { sync_status: 'Synced', health_status: 'Healthy', auto_sync: true } },
  workload: { data: workload(runtime, services) },
});
const last = (p) => p.stations.at(-1);

let p = path('k8s', [svc('ui', 0, 0)]);
expect('scaled to 0 is not healthy', last(p).state === 'fail' && last(p).status === 'Scaled to 0' && p.phase === 'unhealthy', last(p));
p = path('k8s', [svc('ui', 3, 3), svc('cart', 0, 0)]);
expect('one service at 0 is named', last(p).state === 'fail' && last(p).status === 'cart scaled to 0' && p.phase === 'unhealthy', last(p));
p = path('compose', []);
expect('compose with no containers', last(p).state === 'fail' && last(p).status === 'No containers running', last(p));
p = path('k8s', [svc('ui', 3, 2)]);
expect('not ready yet is still "scaling", not a failure', last(p).state === 'active' && p.phase === 'scaling', last(p));
p = path('k8s', [svc('ui', 3, 3), svc('cart', 3, 3, 1, true)]);
expect('rolling: one service named in the path', last(p).status === 'Rolling out cart 1 / 3' && p.phase === 'rolling_out', last(p));
expect('rolling: station services carry their own new-pod count', last(p).services.find((s) => s.name === 'cart').on_new === 1, last(p).services);
p = path('k8s', [svc('ui', 3, 3)]);
expect('healthy stays done', last(p).state === 'done' && p.phase === 'live', last(p));

// cache: an answer that was in flight when the cache was invalidated must not be stored afterwards
let release;
const slow = cached('k:argocd', 60_000, () => new Promise((r) => { release = r; }));
await new Promise((r) => setTimeout(r)); // let cached() start the call
invalidate('k:');
release('OutOfSync (old)');
expect('in-flight call still answers its caller', (await slow) === 'OutOfSync (old)');
expect('...but is not cached after an invalidate', (await cached('k:argocd', 60_000, async () => 'Synced (fresh)')) === 'Synced (fresh)');

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
