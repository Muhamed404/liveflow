// Responses shaped for the "Live flow" UI: delivery path, gate, can-flags, timeline, markers, presence
import crypto from 'node:crypto';
process.env.AUTH_MODE ||= 'off'; // these tests drive the API with x-user; auth has its own test
import fs from 'node:fs';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.DB_PATH = './data/frontend-api-test.db';
fs.rmSync('./data/frontend-api-test.db', { force: true });

const { startMockTools } = await import('./mock-tools.js');
const { createServer } = await import('../src/server.js');
const { invalidate } = await import('../src/utils/cache.js');
const mock = await startMockTools();
const api = createServer().listen(0);
const base = `http://127.0.0.1:${api.address().port}/api`;
const call = async (method, path, body, user = 'mohamed') => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 7 }); } };
const M = mock.base, S = '/apps/frontend-app/environments/staging', P = '/apps/frontend-app/environments/prod', D = '/apps/frontend-app/environments/dev';
const fresh = () => invalidate('');
const station = (o, id) => o.path.stations.find((s) => s.id === id);

await call('POST', '/clusters', { id: 'cluster-stg', name: 'Staging', api_url: `${M}/k8s`, token: 'sa-stg-secret' });
for (const [id, type, url, username, token] of [
  ['jenkins-ci', 'jenkins', `${M}/ci`, 'admin', 'jenkins-token'], ['github-main', 'github', `${M}/github`, null, 'github-main-token'],
  ['argocd-main', 'argocd', `${M}/argocd`, null, 'argocd-main-token'], ['prom-stg', 'prometheus', `${M}/prom-stg`, null, null],
  ['prom-dev', 'prometheus', `${M}/prom-dev`, null, null],
]) await call('POST', '/integrations', { id, type, name: id, base_url: url, username, token });
await call('POST', '/apps', { id: 'frontend-app', name: 'Frontend', github_integration_id: 'github-main', github_repo: 'myorg/frontend-app' });
await call('PUT', S, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend', git_branch: 'staging',
  jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-staging-ci', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging',
  prometheus_integration_id: 'prom-stg', stress_job: 'k6-stress', stress_target_url: 'http://frontend.frontend-stg.svc/' });
await call('PUT', P, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend', git_branch: 'main',
  jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-prod', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging' });
await call('PUT', D, { runtime: 'compose', compose_project: 'frontend', prometheus_integration_id: 'prom-dev', jenkins_integration_id: 'jenkins-ci', jenkins_job: 'frontend-staging-ci' });

// ---- staging path: idle -> building -> rolling out ----
let o = (await call('GET', `${S}/overview`)).body;
expect('k8s path = github → jenkins → argocd → cluster', o.path.stations.map((s) => s.id).join() === 'github,jenkins,argocd,cluster' && o.path.rails.length === 3, o.path);
expect('no runs yet; a pod starting w/o deploy = scaling, not rolling out', o.path.phase === 'scaling' && station(o, 'jenkins').state === 'idle' && station(o, 'github').state === 'idle', o.path);

await call('POST', `${S}/builds`, {});
o = (await call('GET', `${S}/overview`)).body;
const jk = station(o, 'jenkins');
expect('building: jenkins active with current stage', o.path.phase === 'building' && jk.state === 'active' && jk.detail === 'Build + push', jk);
expect('stages straight from the Jenkinsfile, normalized', jk.stages.map((s) => s.state).join() === 'ok,running,pending' && jk.stages[1].name === 'Build + push', jk.stages);
expect('running build reports elapsed time', jk.duration_ms >= 90000, jk.duration_ms);
expect('github station shows commit → branch', station(o, 'github').detail === 'd41e0a7 → staging' && station(o, 'github').trigger.user === 'Mohamed', station(o, 'github'));
expect('argocd waits while jenkins runs (real status kept)', station(o, 'argocd').state === 'idle' && station(o, 'argocd').status === 'Waits for Jenkins' && station(o, 'argocd').sync_status === 'Synced', station(o, 'argocd'));
expect('rail into jenkins is animated', o.path.rails[0] === 'active', o.path.rails);
expect('can.run_pipeline blocked with reason', !o.can.run_pipeline.allowed && o.can.run_pipeline.reason.includes('#1 is running'), o.can);

mock.state.finish('frontend-staging-ci'); mock.state.rolling = true; fresh();
o = (await call('GET', `${S}/overview`)).body;
expect('jenkins done shows pushed image tag', station(o, 'jenkins').status === '#1 passed' && station(o, 'jenkins').detail === 'pushed stg-d41e0a7', station(o, 'jenkins'));
const cl = station(o, 'cluster');
expect('rolling update: new / old squares', o.path.phase === 'rolling_out' && cl.state === 'active' && cl.status === 'Rolling out 2 / 3' && cl.instances.map((i) => i.look).join() === 'new,new,starting', cl);
expect('rail into cluster active', o.path.rails[2] === 'active', o.path.rails);
mock.state.rolling = false; fresh();
o = (await call('GET', `${S}/overview`)).body;
expect('all pods on new image -> cluster no longer rolling', !station(o, 'cluster').status.startsWith('Rolling'), station(o, 'cluster'));

// ---- prod: gate ----
mock.state.argoManual = true; mock.state.argoSync = 'OutOfSync';
let r = await call('POST', `${P}/releases`, { version: 'v2.2.0', confirm: true });
expect('prod release accepted', r.status === 202, r);
mock.state.finish('frontend-prod'); fresh();
o = (await call('GET', `${P}/overview`)).body;
expect('prod waits at the gate', o.path.phase === 'waiting_gate' && station(o, 'argocd').state === 'gate' && o.path.rails[1] === 'blocked', o.path);
expect('prod workload station named Production', station(o, 'cluster').name === 'Production');
expect('gate panel data', o.gate.waiting && o.gate.to_version === 'v2.2.0' && o.gate.from_version === 'stg-abc1234' && o.gate.target === 'cluster-stg/frontend-stg' && o.gate.pods === 3 && o.gate.requires_confirm, o.gate);
expect('github station shows tag', station(o, 'github').status === 'Tagged v2.2.0', station(o, 'github'));
expect('can.sync allowed when OutOfSync', o.can.sync.allowed && !o.can.run_pipeline.allowed, o.can);

r = await call('GET', `${P}/releases`);
const rel = r.body;
expect('releases carry live / pending / suggested next', rel.pending_version === 'v2.2.0' && rel.latest_tag === 'v2.2.0' && rel.suggested_next === 'v2.2.1', rel);
expect('release states + rollback flags', rel.releases.find((x) => x.tag === 'v2.2.0').state === 'waiting' && rel.releases.find((x) => x.tag === 'v2.1.0').can_rollback, rel.releases);
mock.state.argoSync = 'Synced'; fresh();
o = (await call('GET', `${P}/overview`)).body;
expect('synced -> no gate, can.sync blocked', !o.gate.waiting && !o.can.sync.allowed && o.can.sync.reason === 'already in sync', { gate: o.gate, can: o.can });

// ---- timeline ----
r = await call('GET', `${S}/events`);
const srcs = new Set(r.body.events.map((e) => e.source));
expect('timeline merges user, jenkins, argocd, k8s, hpa', ['user', 'jenkins', 'argocd', 'k8s', 'hpa'].every((s) => srcs.has(s)) && r.body.sources_failed.length === 0, r.body);
expect('HPA event readable', r.body.events.some((e) => e.source === 'hpa' && e.text.startsWith('Scaled to 3 ·')), r.body.events);
expect('other workloads filtered out', !r.body.events.some((e) => e.text.includes('should be filtered')));
const ats = r.body.events.map((e) => e.at);
expect('newest first', ats.every((t, i) => i === 0 || ats[i - 1] >= t), ats);
expect('user action sentence', r.body.events.some((e) => e.source === 'user' && e.text === 'mohamed ran the pipeline'), r.body.events.filter((e) => e.source === 'user'));

// ---- chart markers ----
r = await call('GET', `${S}/metrics/cpu_cores?minutes=15`);
expect('deploy marker inside window only', r.body.markers.length === 1 && r.body.markers[0].kind === 'deploy' && r.body.markers[0].label === 'deploy abc1234', r.body.markers);

// ---- stress progress ----
await call('POST', `${S}/stress`, { vus: 50, duration_sec: 120 }, 'sara'); fresh();
o = (await call('GET', `${S}/overview`)).body;
const s = o.stress.data;
expect('stress summary in overview', s.running && s.vus === 50 && s.duration_sec === 120 && s.started_by === 'sara' && s.remaining_sec <= 120 && s.limits.vus[1] === 500, s);
expect('can.stress blocked while running', !o.can.stress.allowed, o.can.stress);
r = await call('GET', `${S}/metrics/cpu_cores?minutes=15`);
expect('stress start marked on chart', r.body.markers.some((m) => m.kind === 'stress' && m.label === 'stress 50 VUs'), r.body.markers);

// ---- dev path ----
o = (await call('GET', `${D}/overview`)).body;
expect('compose path = github → jenkins → dev_server', o.path.stations.map((x) => x.id).join() === 'github,jenkins,dev_server' && station(o, 'dev_server').instances.length === 2, o.path);
expect('dev has no gate / no sync', o.gate === null && !o.can.sync.allowed, { gate: o.gate, can: o.can });

// ---- several deployments in one environment (retail-store has five services) ----
const SH = '/apps/shop/environments/staging';
await call('POST', '/apps', { id: 'shop', name: 'Shop' });
r = await call('PUT', SH, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend, catalog Bad_Name', prometheus_integration_id: 'prom-stg' });
expect('an invalid name in the list is rejected on the deployment field', r.status === 400
  && r.body.details.some((d) => d.path?.[0] === 'deployment' && /Bad_Name/.test(d.message)), r.body);
r = await call('PUT', SH, { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: ' frontend,catalog  cart, cart ', prometheus_integration_id: 'prom-stg' });
expect('deployment list stored normalised and de-duplicated', r.status === 201 && r.body.deployment === 'frontend, catalog, cart', r.body);

mock.state.allReady = true; mock.state.rolling = false; fresh();
o = (await call('GET', `${SH}/overview`)).body;
let w = o.workload.data;
expect('workload has one entry per service, in the configured order', w.services.map((s) => s.name).join() === 'frontend,catalog,cart', w.services);
expect('replicas are totals across services (3 + 2 + 2)', w.replicas.desired === 7 && w.replicas.ready === 7 && w.instances.length === 7, w.replicas);
expect('version, image and HPA come from the first (primary) service', w.version === 'stg-abc1234' && w.hpa?.target === 'frontend' && w.services[2].hpa?.target === 'cart', { version: w.version, hpa: w.hpa });
expect('every pod is tagged with its service', w.instances.every((p) => p.service) && w.instances.filter((p) => p.service === 'catalog').length === 2, w.instances);
let sc = station(o, 'cluster');
expect('cluster station lists services and says how many', sc.services.length === 3 && /3 services$/.test(sc.detail) && sc.status === 'stg-abc1234 · 7 / 7', sc);
expect('station pods carry their service for grouping', sc.instances.every((p) => p.service), sc.instances);

mock.state.rolling = true; fresh();
o = (await call('GET', `${SH}/overview`)).body;
sc = station(o, 'cluster');
expect('when only one service rolls out, the station names it', o.path.phase === 'rolling_out' && /^Rolling out frontend /.test(sc.status), sc.status);
mock.state.rolling = false; fresh();

r = await call('GET', `${SH}/events`);
expect('HPA events say which service scaled', r.body.events.some((e) => e.source === 'hpa' && /^cart scaled to 2/.test(e.text)), r.body.events);
r = await call('POST', `${SH}/test`, {});
const kt = r.body.checks.find((c) => c.tool === 'kubernetes');
expect('connection test checks every deployment', kt.ok && /3 deployments found/.test(kt.message) && /cart 2\/2/.test(kt.message), kt);
await call('PUT', SH, { deployment: 'frontend, payments' });
r = await call('POST', `${SH}/test`, {});
expect('a missing deployment fails the test and is named', r.body.checks.some((c) => c.tool === 'kubernetes' && !c.ok && /payments/.test(c.message)), r.body.checks);
const { buildQueries } = await import('../src/adapters/queries.js');
const q = buildQueries({ k8s: { namespace: 'shop', deployment: 'ui', deployments: ['ui', 'cart'] } });
expect('metrics cover every service: pod=~"(ui|cart)-[a-z0-9]{1,10}-[a-z0-9]{5}"', q.cpu_cores.includes('pod=~"(ui|cart)-[a-z0-9]{1,10}-[a-z0-9]{5}"'), q.cpu_cores);
o = (await call('GET', `${S}/overview`)).body;
expect('single-deployment env keeps its old shape', o.workload.data.services.length === 1 && !/services$/.test(station(o, 'cluster').detail), station(o, 'cluster'));

// ---- presence ----
await call('POST', '/presence', { app: 'frontend-app', env: 'staging', page: 'flow' }, 'mohamed');
await call('POST', '/presence', { app: 'frontend-app', env: 'prod', page: 'releases' }, 'sara');
r = await call('GET', '/presence?app=frontend-app');
expect('presence lists viewers', r.body.length === 2, r.body);
r = await call('GET', '/presence?app=frontend-app&env=prod');
expect('presence filtered by env', r.body.length === 1 && r.body[0].user === 'sara', r.body);

api.close(); mock.server.close();
fs.rmSync('./data', { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
