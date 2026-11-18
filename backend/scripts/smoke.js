// End-to-end smoke test against a temporary DB
import crypto from 'node:crypto';
process.env.AUTH_MODE ||= 'off'; // these tests drive the API with x-user; auth has its own test
import fs from 'node:fs';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.DB_PATH = './data/smoke.db';
fs.rmSync('./data/smoke.db', { force: true });

const { createServer } = await import('../src/server.js');
const { resolveContext } = await import('../src/services/context.js');
const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.log(extra); } };

let r = await call('POST', '/clusters', { id: 'cluster-stg', name: 'Staging', api_url: 'https://k8s-stg.internal:6443', token: 'sa-stg-secret' });
expect('create cluster', r.status === 201 && r.body.has_token === true && !('token_enc' in r.body), r);
await call('POST', '/clusters', { id: 'cluster-prod', name: 'Prod', api_url: 'https://k8s-prod.internal:6443', token: 'sa-prod-secret' });

for (const [id, type, url] of [['jenkins-main','jenkins','http://jenkins:8080'],['github-main','github','https://api.github.com'],['argocd-main','argocd','https://argocd.internal'],['prom-stg','prometheus','http://prom-stg:9090'],['prom-dev','prometheus','http://prom-dev:9090']]) {
  r = await call('POST', '/integrations', { id, type, name: id, base_url: url + '/', username: 'admin', token: `${id}-token` });
  expect(`create integration ${id}`, r.status === 201 && !r.body.base_url.endsWith('/'), r);
}

r = await call('POST', '/apps', { id: 'frontend-app', name: 'Frontend', github_integration_id: 'github-main', github_repo: 'myorg/frontend-app' });
expect('create app', r.status === 201, r);

r = await call('PUT', '/apps/frontend-app/environments/dev', { runtime: 'compose', compose_project: 'frontend', prometheus_integration_id: 'prom-dev', jenkins_integration_id: 'jenkins-main', jenkins_job: 'frontend-dev', git_branch: 'dev' });
expect('create dev env (compose)', r.status === 201 && r.body.deploy_mode === 'auto', r);

r = await call('PUT', '/apps/frontend-app/environments/staging', { runtime: 'k8s', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend', jenkins_integration_id: 'jenkins-main', jenkins_job: 'frontend-stg', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-staging', prometheus_integration_id: 'prom-stg', prom_selector: 'namespace="frontend-stg"' });
expect('create staging env (k8s)', r.status === 201, r);

r = await call('PUT', '/apps/frontend-app/environments/prod', { runtime: 'k8s', cluster_id: 'cluster-prod', namespace: 'frontend-prod', deployment: 'frontend', argocd_integration_id: 'argocd-main', argocd_app: 'frontend-prod' });
expect('prod defaults to manual deploy', r.status === 201 && r.body.deploy_mode === 'manual', r);

r = await call('PUT', '/apps/frontend-app/environments/staging', { runtime: 'k8s' , namespace: '' });
expect('reject k8s env without namespace', r.status === 400, r);

r = await call('PUT', '/apps/frontend-app/environments/staging', { jenkins_integration_id: 'prom-stg' });
expect('reject wrong integration type', r.status === 400, r);

r = await call('PUT', '/apps/frontend-app/environments/qa', { runtime: 'k8s' });
expect('reject unknown env name', r.status === 400, r);

r = await call('DELETE', '/clusters/cluster-stg');
expect('block deleting a cluster in use', r.status === 409, r);

r = await call('PUT', '/apps/frontend-app/environments/staging', { prometheus_integration_id: '' });
expect('clearing an integration field stores null (no FK error)', r.status === 200 && r.body.prometheus_integration_id === null, r);

r = await call('GET', '/apps');
expect('list apps with envs', r.body[0].environments.length === 3, r);

const ctx = resolveContext('frontend-app', 'staging');
expect('context decrypts cluster token', ctx.k8s.cluster.token === 'sa-stg-secret');
expect('context decrypts jenkins token', ctx.jenkins.token === 'jenkins-main-token' && ctx.jenkins.job === 'frontend-stg');
const raw = fs.readFileSync('./data/smoke.db').toString('latin1');
expect('tokens not stored in plaintext', !raw.includes('sa-stg-secret') && !raw.includes('jenkins-main-token'));

server.close();
fs.rmSync('./data', { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
