// Phase 3: action APIs end-to-end against the mock tools
import crypto from 'node:crypto';
process.env.AUTH_MODE ||= 'off'; // these tests drive the API with x-user; auth has its own test
import fs from 'node:fs';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.DB_PATH = './data/actions-test.db';
fs.rmSync('./data/actions-test.db', { force: true });

const { startMockTools } = await import('./mock-tools.js');
const { createServer } = await import('../src/server.js');
const mock = await startMockTools();
const api = createServer().listen(0);
const base = `http://127.0.0.1:${api.address().port}/api`;
const call = async (method, path, body, user = 'mohamed') => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 6 }); } };
const M = mock.base, S = '/apps/frontend-app/environments/staging', P = '/apps/frontend-app/environments/prod', D = '/apps/frontend-app/environments/dev';
const lastCi = (job) => mock.state.ci.jobs[job].at(-1);

// ---- seed ----
await call('POST', '/clusters', { id: 'cluster-stg', name: 'Staging', api_url: `${M}/k8s`, token: 'sa-stg-secret' });
for (const [id, type, url, username, token] of [
  ['jenkins-ci', 'jenkins', `${M}/ci`, 'admin', 'jenkins-token'],
  ['github-main', 'github', `${M}/github`, null, 'github-main-token'],
  ['argocd-main', 'argocd', `${M}/argocd`, null, 'argocd-main-token'],
  ['argocd-bad', 'argocd', `${M}/argocd`, null, 'nope'],
  ['prom-stg', 'prometheus', `${M}/prom-stg`, null, null],
  ['prom-dev', 'prometheus', `${M}/prom-dev`, null, null],
  ['loki-down', 'loki', 'http://127.0.0.1:1', null, null],
]) await call('POST', '/integrations', { id, type, name: id, base_url: url, username, token });

await call('POST', '/apps', { id: 'frontend-app', name: 'Frontend', github_integration_id: 'github-main', github_repo: 'myorg/frontend-app' });
let r = await call('PUT', S, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend',
  jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-staging-ci', argocd_integration_id: 'argocd-bad', argocd_app: 'frontend-staging',
  prometheus_integration_id: 'prom-stg', prom_selector: 'namespace="frontend-stg"', loki_integration_id: 'loki-down',
  stress_job: 'k6-stress', stress_target_url: 'http://frontend.frontend-stg.svc/' });
expect('staging env with stress job', r.status === 201, r);
r = await call('PUT', S, { stress_job: 'k6-stress', stress_target_url: '' });
expect('stress job without target rejected', r.status === 400, r);
await call('PUT', P, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend', git_branch: 'main',
  jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-prod', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging' });
await call('PUT', D, { runtime: 'compose', compose_project: 'frontend', prometheus_integration_id: 'prom-dev', jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-staging-ci' });

// ---- observe ----
r = await call('GET', `${S}/overview`);
const o = r.body;
expect('overview: workload live from cluster', o.workload.data?.replicas.desired === 3 && o.workload.data.hpa.max_replicas === 5 && o.workload.data.instances.length === 3, o);
expect('overview: metrics snapshot', o.metrics.data?.cpu_cores === 0.42 && 'rps' in o.metrics.data, o.metrics);
expect('overview: partial failure isolated (bad argocd token)', o.argocd.error?.includes('authentication failed') && o.workload.data, o.argocd);
expect('overview: pipeline empty before first build', o.pipeline.data === null, o.pipeline);
expect('overview: feature flags', o.features.stress && o.features.build && !o.features.release, o.features);

r = await call('GET', `${D}/workload`);
expect('dev workload = compose containers via cAdvisor', r.body.runtime === 'compose' && r.body.replicas.ready === 2 && r.body.instances[0].service, r.body);

const before = mock.state.k8sHits;
await new Promise((res) => setTimeout(res, 2100)); // let cache expire
await Promise.all(Array.from({ length: 5 }, () => call('GET', `${S}/workload`)));
expect('5 concurrent viewers -> 1 cluster call (cache + de-dup)', mock.state.k8sHits - before === 1, mock.state.k8sHits - before);

r = await call('GET', `${S}/metrics/cpu_cores?minutes=15`);
expect('metric range', r.status === 200 && r.body.points.length === 3, r);
r = await call('GET', `${S}/metrics/containers`);
expect('unknown metric rejected', r.status === 400, r);
r = await call('GET', `${S}/logs`);
expect('loki down -> clean 502', r.status === 502 && r.body.error.includes('unreachable'), r);

// ---- pipeline: dev / staging ----
r = await call('POST', `${S}/builds`, {});
expect('trigger staging build', r.status === 202 && r.body.queue_id >= 500, r);
r = await call('GET', `${S}/queue/${r.body.queue_id}`);
expect('queue -> build #1', r.body.build_number === 1, r);
r = await call('POST', `${S}/builds`, {}, 'sara');
expect('second interviewer blocked while running (409)', r.status === 409, r);
r = await call('GET', `${S}/builds/1`);
expect('build detail with stages', r.body.status === 'RUNNING' && r.body.stages.length === 3 && r.body.current_stage === 'Build + push', r);
mock.state.finish('frontend-staging-ci');
r = await call('POST', `${P}/builds`, {});
expect('prod cannot use /builds', r.status === 400, r);

// ---- prod release ----
r = await call('POST', `${P}/releases`, { version: 'v2.2.0' });
expect('prod release without confirm -> 428', r.status === 428, r);
r = await call('POST', `${P}/releases`, { version: 'v2.2', confirm: true });
expect('bad semver rejected', r.status === 400, r);
r = await call('POST', `${P}/releases`, { version: 'v2.0.5', confirm: true });
expect('older than latest rejected', r.status === 400 && r.body.error.includes('v2.1.0'), r);
r = await call('POST', `${S}/releases`, { version: 'v2.2.0' });
expect('release only on prod', r.status === 400, r);
r = await call('POST', `${P}/releases`, { version: 'v2.2.0', confirm: true });
expect('prod release: tag + jenkins', r.status === 202 && mock.state.tags.includes('v2.2.0') && lastCi('frontend-prod').params.VERSION === 'v2.2.0' && lastCi('frontend-prod').params.ACTION === 'release', r);
expect('release tagged on prod branch', mock.state.lastRelease.target_commitish === 'main');
r = await call('POST', `${P}/releases`, { version: 'v2.3.0', confirm: true }, 'sara');
expect('release blocked while prod pipeline runs, no tag created', r.status === 409 && !mock.state.tags.includes('v2.3.0'), r);
mock.state.finish('frontend-prod');

r = await call('POST', `${P}/rollback`, { version: 'v9.9.9', confirm: true });
expect('rollback to unknown tag -> 404', r.status === 404, r);
r = await call('POST', `${P}/rollback`, { version: 'v2.1.0', confirm: true });
expect('rollback triggers jenkins with ACTION=rollback', r.status === 202 && lastCi('frontend-prod').params.ACTION === 'rollback', r);

r = await call('POST', `${P}/sync`, {});
expect('prod sync without confirm -> 428', r.status === 428, r);
r = await call('POST', `${P}/sync`, { confirm: true });
expect('prod sync calls argocd', r.status === 200 && mock.state.syncs === 1 && r.body.sync_status, r);

r = await call('GET', `${P}/releases`);
expect('releases listed', r.body.releases[0].tag === 'v2.2.0', r);

// ---- stress ----
r = await call('POST', `${S}/stress`, { vus: 1000, duration_sec: 30 });
expect('stress limits enforced', r.status === 400, r);
r = await call('POST', `${S}/stress`, { vus: 50, duration_sec: 30 });
const sp = lastCi('k6-stress').params;
expect('stress starts k6 job', r.status === 202 && sp.VUS === '50' && sp.DURATION === '30s' && sp.TARGET_URL.includes('frontend-stg'), { r, sp });
r = await call('POST', `${S}/stress`, { vus: 50, duration_sec: 30 }, 'sara');
expect('only one stress test at a time', r.status === 409, r);
r = await call('GET', `${S}/stress`);
expect('stress status running', r.body.running === true, r);
r = await call('DELETE', `${S}/stress`);
expect('stop stress', r.status === 200 && lastCi('k6-stress').result === 'ABORTED', r);
r = await call('GET', `${S}/stress`);
expect('stress stopped', r.body.running === false, r);
r = await call('POST', `${P}/stress`, { vus: 10, duration_sec: 10 });
expect('prod stress needs confirm', r.status === 428, r);

// ---- activity ----
r = await call('GET', `${P}/activity`);
const actions = r.body.map((a) => `${a.action}:${a.status}`);
expect('prod activity log', actions.includes('release:ok') && actions.includes('release:failed') && actions.includes('rollback:ok') && actions.includes('sync:ok'), actions);
expect('actor recorded', r.body.find((a) => a.details?.version === 'v2.3.0').actor === 'sara', r.body);
expect('sync activity summarized', Object.keys(r.body.find((a) => a.action === 'sync').details.result).length === 3);
r = await call('GET', '/activity');
expect('global activity feed', r.body.length >= 8, r.body.length);

// env CRUD still works with the actions router mounted
r = await call('GET', S);
expect('env GET still served by CRUD route', r.status === 200 && r.body.stress_job === 'k6-stress', r);

api.close(); mock.server.close();
fs.rmSync('./data', { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
