// Real-world integration quirks: self-signed TLS, Jenkins CSRF crumb, tenant header, metric labels, upstream messages
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import express from 'express';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.AUTH_MODE = 'off';
process.env.DB_PATH = './data/integration-test.db';
fs.rmSync('./data/integration-test.db', { force: true });

let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 5 }); } };

// ---- a self-signed HTTPS "Prometheus" that requires a tenant header ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`], { stdio: 'ignore' });
const cert = fs.readFileSync(`${dir}/cert.pem`, 'utf8');
const tlsApp = express();
tlsApp.get('/api/v1/status/buildinfo', (req, res) => req.headers['x-scope-orgid'] === 'team-a'
  ? res.json({ data: { version: '2.53.0' } }) : res.status(401).json({ error: 'no org id' }));
const tlsServer = https.createServer({ key: fs.readFileSync(`${dir}/key.pem`), cert }, tlsApp).listen(0);
const tlsUrl = `https://127.0.0.1:${tlsServer.address().port}`;

// ---- Jenkins that insists on a crumb; ArgoCD that is busy ----
const plain = express();
plain.use(express.urlencoded({ extended: false }));
let crumbHits = 0, built = 0;
plain.get('/crumbIssuer/api/json', (req, res) => { crumbHits++; res.json({ crumbRequestField: 'Jenkins-Crumb', crumb: 'abc' }); });
plain.post('/job/app/build', (req, res) => {
  if (req.headers['jenkins-crumb'] !== 'abc') return res.status(403).type('text/html').send('<h1>No valid crumb was included in the request</h1>');
  built++; res.status(201).set('location', 'http://j/queue/item/9/').end();
});
plain.post('/api/v1/applications/busy/sync', (req, res) => res.status(400).json({ error: 'another operation is already in progress', message: 'another operation is already in progress' }));
plain.get('/api/v1/applications/missing', (req, res) => res.status(404).json({ message: 'applications.argoproj.io "missing" not found' }));
const plainServer = plain.listen(0);
const P = `http://127.0.0.1:${plainServer.address().port}`;

const { createServer } = await import('../src/server.js');
const A = await import('../src/adapters/index.js');
const { buildQueries } = await import('../src/adapters/queries.js');
const { integrationsRepo } = await import('../src/repositories/integrations.js');
const api = createServer().listen(0);
const base = `http://127.0.0.1:${api.address().port}/api`;
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

await call('POST', '/integrations', { id: 'p-strict', type: 'prometheus', name: 'strict', base_url: tlsUrl, tenant_id: 'team-a' });
await call('POST', '/integrations', { id: 'p-insecure', type: 'prometheus', name: 'insecure', base_url: tlsUrl, tenant_id: 'team-a', insecure_skip_tls: true });
await call('POST', '/integrations', { id: 'p-ca', type: 'prometheus', name: 'ca', base_url: tlsUrl, tenant_id: 'team-a', ca_cert: cert });
await call('POST', '/integrations', { id: 'p-notenant', type: 'prometheus', name: 'nt', base_url: tlsUrl, ca_cert: cert });

let r = await call('POST', '/integrations/p-strict/test');
expect('self-signed cert rejected by default', !r.body.ok && /unreachable/.test(r.body.message), r.body);
r = await call('POST', '/integrations/p-insecure/test');
expect('insecure_skip_tls connects', r.body.ok, r.body);
r = await call('POST', '/integrations/p-ca/test');
expect('pasted CA certificate connects (verified TLS)', r.body.ok && r.body.message.includes('2.53.0'), r.body);
r = await call('POST', '/integrations/p-notenant/test');
expect('tenant header is what the server checks', !r.body.ok && r.body.message.includes('authentication failed'), r.body);
r = await call('GET', '/integrations/p-ca');
expect('CA flagged, never echoed back', r.body.has_ca_cert === true && !('ca_cert' in r.body) && r.body.tenant_id === 'team-a', r.body);

const jen = { id: 'j1', base_url: P, username: 'u', token: 't' };
const q = await A.jenkins.triggerBuild(jen, 'app');
expect('Jenkins CSRF: crumb fetched once and request retried', q.queue_id === 9 && built === 1 && crumbHits === 1, { q, built, crumbHits });
await A.jenkins.triggerBuild(jen, 'app');
expect('crumb reused on the next POST', built === 2 && crumbHits === 1, { built, crumbHits });

const argo = { id: 'a1', base_url: P, token: 't' };
try { await A.argocd.sync(argo, 'busy'); expect('busy sync throws', false); } catch (e) {
  expect('ArgoCD busy -> 409 with a plain message', e.status === 409 && e.message === 'argocd: a sync is already running for this app', e.message);
}
try { await A.argocd.getApp(argo, 'missing'); } catch (e) {
  expect('upstream message is surfaced', e.message.includes('not found') && e.message.includes('"missing"'), e.message);
}

const ctx = { k8s: { namespace: 'web', deployment: 'web' }, prometheus: { selector: 'job="web"', http_metric: 'http_server_requests_seconds_count', http_status_label: 'code' } };
const qs = buildQueries(ctx);
expect('custom HTTP metric + status label used in PromQL', qs.rps.includes('http_server_requests_seconds_count{job="web"}') && qs.error_rate.includes('code=~"5.."'), qs);
await call('POST', '/apps', { id: 'web', name: 'Web' });
r = await call('PUT', '/apps/web/environments/dev', { runtime: 'compose', compose_project: 'web', prometheus_integration_id: 'p-ca', http_metric: 'bad metric!' });
expect('invalid metric name rejected', r.status === 400 && r.body.details[0].path[0] === 'http_metric', r);
r = await call('PUT', '/apps/web/environments/dev', { runtime: 'compose', compose_project: 'web', prometheus_integration_id: 'p-ca', http_status_label: ' code ' });
expect('pasted label with spaces is trimmed and accepted', r.status === 201 && r.body.http_status_label === 'code', r);
expect('tls carried into adapter connection', integrationsRepo.getWithSecret('p-ca').tls.ca === cert);

api.close(); tlsServer.close(); plainServer.close();
fs.rmSync('./data', { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
