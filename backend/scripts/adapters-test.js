// Adapters + connectivity tests against the mock tools
import crypto from 'node:crypto';
process.env.AUTH_MODE ||= 'off'; // these tests drive the API with x-user; auth has its own test
import fs from 'node:fs';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.DB_PATH = './data/adapters-test.db';
fs.rmSync('./data/adapters-test.db', { force: true });

const { startMockTools } = await import('./mock-tools.js');
const { createServer } = await import('../src/server.js');
const { resolveContext } = await import('../src/services/context.js');
const A = await import('../src/adapters/index.js');
const { buildQueries } = await import('../src/adapters/queries.js');

const mock = await startMockTools();
const api = createServer().listen(0);
const base = `http://127.0.0.1:${api.address().port}/api`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 6 }); } };
const M = mock.base;

// ---- seed config ----
await call('POST', '/clusters', { id: 'cluster-stg', name: 'Staging', api_url: `${M}/k8s`, token: 'sa-stg-secret' });
const integ = [
  ['jenkins-main', 'jenkins', '/jenkins', 'admin', 'jenkins-token'],
  ['github-main', 'github', '/github', null, 'github-main-token'],
  ['argocd-main', 'argocd', '/argocd', null, 'argocd-main-token'],
  ['prom-dev', 'prometheus', '/prom-dev', null, null],
  ['prom-stg', 'prometheus', '/prom-stg', null, null],
  ['loki-main', 'loki', '/loki', null, null],
  ['grafana-main', 'grafana', '/grafana', null, 'grafana-token'],
  ['jenkins-bad', 'jenkins', '/jenkins', 'admin', 'wrong'],
  ['prom-down', 'prometheus', 'http://127.0.0.1:1', null, null],
];
for (const [id, type, path, username, token] of integ) {
  await call('POST', '/integrations', { id, type, name: id, base_url: path.startsWith('http') ? path : M + path, username, token });
}
await call('POST', '/apps', { id: 'frontend-app', name: 'Frontend', github_integration_id: 'github-main', github_repo: 'myorg/frontend-app' });
await call('PUT', '/apps/frontend-app/environments/dev', { runtime: 'compose', compose_project: 'frontend', prometheus_integration_id: 'prom-dev', jenkins_integration_id: 'jenkins-main', jenkins_job: 'frontend-stg' });
await call('PUT', '/apps/frontend-app/environments/staging', {
  runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend',
  jenkins_integration_id: 'jenkins-main', jenkins_job: 'frontend-stg', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging',
  prometheus_integration_id: 'prom-stg', prom_selector: 'namespace="frontend-stg",app="frontend"', loki_integration_id: 'loki-main',
  grafana_integration_id: 'grafana-main', grafana_dashboard_uid: 'd3f8a2bc',
});

// ---- validation rules ----
let r = await call('PUT', '/apps/frontend-app/environments/prod', { runtime: 'compose', compose_project: 'x' });
expect('compose env requires prometheus (cAdvisor), on that field', r.status === 400 && r.body.details.some((d) => d.path[0] === 'prometheus_integration_id'), r);
r = await call('PUT', '/apps/frontend-app/environments/prod', { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'Bad_NS"', deployment: 'x' });
expect('reject unsafe namespace value', r.status === 400, r);

// ---- connectivity routes ----
r = await call('POST', '/integrations/jenkins-main/test');
expect('jenkins test ok', r.body.ok && r.body.message.includes('admin'), r);
r = await call('POST', '/integrations/jenkins-bad/test');
expect('jenkins bad token -> authentication failed', !r.body.ok && r.body.message.includes('authentication failed'), r);
r = await call('POST', '/integrations/prom-down/test');
expect('unreachable tool reported, not crashed', !r.body.ok && r.body.message.includes('unreachable'), r);
r = await call('POST', '/clusters/cluster-stg/test');
expect('cluster test ok', r.body.ok && r.body.message.includes('v1.30.2'), r);

r = await call('POST', '/apps/frontend-app/environments/staging/test');
expect('staging env: all checks ok', r.body.ok && r.body.checks.length === 7, r.body);
r = await call('POST', '/apps/frontend-app/environments/dev/test');
expect('dev env: cAdvisor containers visible', r.body.ok && r.body.checks.find((c) => c.tool === 'prometheus').message.includes('2 container'), r.body);

// ---- adapters directly ----
const stg = resolveContext('frontend-app', 'staging');
const dev = resolveContext('frontend-app', 'dev');

const dep = await A.k8s.getDeployment(stg.k8s.cluster, 'frontend-stg', 'frontend');
expect('deployment replicas read live (3 desired / 2 ready)', dep.desired_replicas === 3 && dep.ready_replicas === 2 && dep.version === 'stg-abc1234', dep);
const pods = await A.k8s.listPods(stg.k8s.cluster, 'frontend-stg', 'frontend');
expect('pods listed via deployment selector + sorted', pods.length === 3 && pods[0].name.endsWith('-a') && pods[2].phase === 'ContainerCreating', pods);
const hpa = await A.k8s.getHpa(stg.k8s.cluster, 'frontend-stg', 'frontend');
expect('hpa matched to deployment', hpa.min_replicas === 2 && hpa.max_replicas === 5 && hpa.cpu_current_percent === 64, hpa);

const q = await A.jenkins.triggerBuild(stg.jenkins, 'frontend-stg', { VERSION: 'v2.2.0' });
expect('jenkins trigger returns queue id', q.queue_id === 42 && mock.state.builds[0].VERSION === 'v2.2.0', q);
const qi = await A.jenkins.resolveQueue(stg.jenkins, 42);
expect('queue -> build number', qi.build_number === 7, qi);
const b = await A.jenkins.getBuild(stg.jenkins, 'frontend-stg', 7);
expect('build status + stages + params', b.status === 'RUNNING' && b.stages.length === 2 && b.params.VERSION === 'v2.2.0', b);
const log = await A.jenkins.getLog(stg.jenkins, 'frontend-stg', 7);
expect('progressive log', log.more && log.next_start === 24, log);

const app = await A.argocd.getApp(stg.argocd, 'frontend-staging');
expect('argocd app summary', app.sync_status === 'Synced' && app.auto_sync && app.history[0].id === 2, app);
await A.argocd.sync(stg.argocd, 'frontend-staging');
expect('argocd manual sync called', mock.state.syncs === 1);

expect('github tag exists check', await A.github.tagExists(stg.github, 'myorg/frontend-app', 'v2.1.0') && !(await A.github.tagExists(stg.github, 'myorg/frontend-app', 'v9.9.9')));
const rel = await A.github.createRelease(stg.github, 'myorg/frontend-app', { tag: 'v2.2.0' });
expect('github create release', rel.tag === 'v2.2.0', rel);

const qs = buildQueries(stg), qd = buildQueries(dev);
expect('k8s queries use namespace + pod regex', qs.cpu_cores.includes('namespace="frontend-stg",pod=~"frontend-.*"') && qs.rps.includes('app="frontend"'));
expect('dev queries use compose label', qd.cpu_cores.includes('container_label_com_docker_compose_project="frontend"') && qd.containers);
expect('prom scalar', (await A.prometheus.scalar(stg.prometheus, qs.cpu_cores)) === 0.42);
const rng = await A.prometheus.range(stg.prometheus, qs.cpu_cores);
expect('prom range handles NaN', rng[0].points[1][1] === null && rng[0].points.length === 3, rng);

const lines = await A.loki.recent(stg.loki, A.loki.selectorFor(stg));
expect('loki lines newest first + level detection', lines.length === 2 && lines[0].level === 'info' && lines[1].level === 'error', lines);
expect('grafana embed url', A.grafana.embedUrl(stg.grafana, 'd3f8a2bc', { vars: { namespace: 'frontend-stg' } }).includes('var-namespace=frontend-stg'));

api.close(); mock.server.close();
fs.rmSync('./data', { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
