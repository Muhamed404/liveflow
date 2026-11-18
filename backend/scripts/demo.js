// Demo mode: real API + mock tools that move on their own. No infra needed.
//   npm run demo   ->  API on http://localhost:4000, mock tools on :4100
import crypto from 'node:crypto';
process.env.AUTH_MODE ||= 'off'; // AUTH_MODE=local npm run demo -> sign in as admin / demo-admin-123
if (process.env.AUTH_MODE === 'local') process.env.ADMIN_PASSWORD ||= 'demo-admin-123';
import fs from 'node:fs';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.DB_PATH = './data/demo.db';
fs.rmSync('./data/demo.db', { force: true });
fs.rmSync('./data/demo.db-wal', { force: true });
fs.rmSync('./data/demo.db-shm', { force: true });

const { startMockTools } = await import('./mock-tools.js');
const { createServer } = await import('../src/server.js');
const { invalidate } = await import('../src/utils/cache.js');
const { bootstrapAdmin, users } = await import('../src/services/auth.js');
bootstrapAdmin({ log() {}, warn() {} });
const mock = await startMockTools(4100);
const PORT = Number(process.env.PORT || 4000);
createServer().listen(PORT);
let cookie = '';
const api = (method, path, body, user = 'demo') => fetch(`http://127.0.0.1:${PORT}/api${path}`, {
  method, headers: { 'content-type': 'application/json', 'x-user': user, ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body),
}).then((r) => (r.status === 204 ? null : r.json()));
if (process.env.AUTH_MODE === 'local') {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
  for (const [username, role, display_name] of [['sara', 'operator', 'Sara K.'], ['ahmed', 'viewer', 'Ahmed T.']]) {
    if (!users.list().some((u) => u.username === username)) users.create({ username, role, display_name, password: `${username}-demo-123` });
  }
}

const M = mock.base;
await api('POST', '/clusters', { id: 'cluster-stg', name: 'cluster-stg', api_url: `${M}/k8s`, token: 'sa-stg-secret' });
for (const [id, type, url, username, token] of [
  ['jenkins-main', 'jenkins', `${M}/ci`, 'admin', 'jenkins-token'], ['github-main', 'github', `${M}/github`, null, 'github-main-token'],
  ['argocd-main', 'argocd', `${M}/argocd`, null, 'argocd-main-token'], ['prom-stg', 'prometheus', `${M}/prom-stg`, null, null],
  ['prom-dev', 'prometheus', `${M}/prom-dev`, null, null], ['loki-main', 'loki', `${M}/loki`, null, null],
]) await api('POST', '/integrations', { id, type, name: id, base_url: url, username, token });
await api('POST', '/apps', { id: 'frontend-app', name: 'Frontend', github_integration_id: 'github-main', github_repo: 'myorg/frontend-app' });
const common = { cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend, catalog, cart, orders, checkout', jenkins_integration_id: 'jenkins-main',
  argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging', prometheus_integration_id: 'prom-stg', loki_integration_id: 'loki-main' };
await api('PUT', '/apps/frontend-app/environments/dev', { runtime: 'compose', compose_project: 'frontend', prometheus_integration_id: 'prom-dev', loki_integration_id: 'loki-main', jenkins_integration_id: 'jenkins-main', jenkins_job: 'frontend-staging-ci', git_branch: 'dev' });
await api('PUT', '/apps/frontend-app/environments/staging', { runtime: 'k8s', ...common, git_branch: 'staging', jenkins_job: 'frontend-staging-ci', stress_job: 'k6-stress', stress_target_url: 'http://frontend.frontend-stg.svc/' });
await api('PUT', '/apps/frontend-app/environments/prod', { runtime: 'k8s', ...common, namespace: 'frontend-prod', argocd_app: 'frontend-prod', git_branch: 'main', jenkins_job: 'frontend-prod' });

mock.state.allReady = true;
mock.state.realistic = true;
mock.state.argoApps = { 'frontend-staging': { sync: 'Synced', manual: false }, 'frontend-prod': { sync: 'OutOfSync', manual: true } };
// prod: a release built and waiting at the gate (Sync in the UI opens it; it re-closes on the next loop)
await api('POST', '/apps/frontend-app/environments/prod/releases', { version: 'v2.2.0', confirm: true }, 'mohamed');
mock.state.finish('frontend-prod');

// staging: build -> rolling update -> live, every 45s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async function loop() {
  for (;;) {
    await api('POST', '/apps/frontend-app/environments/staging/builds', {}, 'mohamed');
    await sleep(15000);
    mock.state.finish('frontend-staging-ci'); mock.state.rolling = true; invalidate('');
    await sleep(10000);
    mock.state.rolling = false; invalidate('');
    mock.state.argoApps['frontend-prod'].sync = 'OutOfSync'; // keep prod at its gate
    await sleep(20000);
  }
})();

console.log(`\nDemo API      http://localhost:${PORT}/api`);
console.log(`Mock tools    ${M}`);
console.log('Staging runs a build -> rolling update -> live loop every 45s; prod waits at the gate.');
console.log(process.env.AUTH_MODE === 'local' ? 'Sign in: admin / demo-admin-123 · sara / sara-demo-123 (operator) · ahmed / ahmed-demo-123 (viewer)\n' : 'Auth off (AUTH_MODE=local to try sign-in).\n');
