// Auth: login, sessions, roles, throttling, CSRF-ish JSON rule
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.AUTH_MODE = 'local';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.DB_PATH = './data/auth-test.db';
fs.rmSync('./data/auth-test.db', { force: true });

const { createServer } = await import('../src/server.js');
const { bootstrapAdmin } = await import('../src/services/auth.js');
bootstrapAdmin({ log() {}, warn() {} });
const api = createServer().listen(0);
const base = `http://127.0.0.1:${api.address().port}/api`;
let failed = 0;
const expect = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed++; console.dir(extra, { depth: 5 }); } };

async function call(method, path, body, { cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, setCookie: r.headers.get('set-cookie') };
}
async function signIn(username, password) {
  const r = await call('POST', '/auth/login', { username, password });
  return { ...r, cookie: r.setCookie?.split(';')[0] };
}

let r = await call('GET', '/health');
expect('health is public', r.status === 200 && r.body.auth_mode === 'local', r);
r = await call('GET', '/apps');
expect('no session -> 401', r.status === 401, r);
r = await call('GET', '/apps', undefined, { headers: { 'x-user': 'admin' } });
expect('x-user header is ignored when auth is on', r.status === 401, r);

r = await signIn('admin', 'nope');
expect('wrong password -> 401, no cookie', r.status === 401 && !r.setCookie, r);
r = await signIn('ghost', 'whatever');
expect('unknown user -> same 401 message', r.status === 401 && r.body.error === 'Wrong username or password.', r);

const admin = await signIn('admin', 'correct-horse-battery');
expect('admin bootstrapped from ADMIN_PASSWORD and can sign in', admin.status === 200 && admin.body.user.role === 'admin', admin);
expect('cookie is HttpOnly + SameSite=Strict', /HttpOnly/.test(admin.setCookie) && /SameSite=Strict/.test(admin.setCookie), admin.setCookie);
r = await call('GET', '/auth/me', undefined, { cookie: admin.cookie });
expect('/auth/me returns the user', r.body.user.username === 'admin', r);

// users
r = await call('POST', '/users', { username: 'sara', role: 'operator', password: 'short' }, { cookie: admin.cookie });
expect('weak password rejected', r.status === 400, r);
r = await call('POST', '/users', { username: 'sara', display_name: 'Sara K.', role: 'operator', password: 'operator-pass-123' }, { cookie: admin.cookie });
expect('admin creates operator', r.status === 201 && r.body.role === 'operator' && !('password_hash' in r.body), r);
await call('POST', '/users', { username: 'ahmed', role: 'viewer', password: 'viewer-pass-123' }, { cookie: admin.cookie });
const sara = await signIn('SARA', 'operator-pass-123');
expect('usernames are case-insensitive', sara.status === 200, sara);
const ahmed = await signIn('ahmed', 'viewer-pass-123');

// settings need admin
r = await call('POST', '/integrations', { id: 'prom-x', type: 'prometheus', name: 'x', base_url: 'http://127.0.0.1:1' }, { cookie: sara.cookie });
expect('operator cannot change settings (403)', r.status === 403 && r.body.error.includes('admin'), r);
r = await call('POST', '/integrations', { id: 'prom-x', type: 'prometheus', name: 'x', base_url: 'http://127.0.0.1:1' }, { cookie: admin.cookie });
expect('admin can change settings', r.status === 201, r);
r = await call('POST', '/integrations/prom-x/test', {}, { cookie: sara.cookie });
expect('operator can run connection tests', r.status === 200 && r.body.ok === false, r);
r = await call('POST', '/integrations/prom-x/test', {}, { cookie: ahmed.cookie });
expect('viewer cannot run tests', r.status === 403, r);
await call('POST', '/apps', { id: 'web' }, { cookie: admin.cookie });
await call('POST', '/apps', { id: 'web', name: 'Web' }, { cookie: admin.cookie });
r = await call('PUT', '/apps/web/environments/dev', { runtime: 'compose', compose_project: 'web', prometheus_integration_id: 'prom-x' }, { cookie: sara.cookie });
expect('operator cannot edit environments', r.status === 403, r);
r = await call('PUT', '/apps/web/environments/dev', { runtime: 'compose', compose_project: 'web', prometheus_integration_id: 'prom-x' }, { cookie: admin.cookie });
expect('admin edits environments', r.status === 201, r);

// actions need operator
r = await call('GET', '/apps/web/environments/dev/overview', undefined, { cookie: ahmed.cookie });
expect('viewer can read the overview', r.status === 200 && r.body.role === 'viewer', r);
expect('viewer sees every action disabled with a reason', Object.values(r.body.can).every((c) => !c.allowed), r.body.can);
r = await call('POST', '/apps/web/environments/dev/builds', {}, { cookie: ahmed.cookie });
expect('viewer cannot run actions (403)', r.status === 403, r);
r = await call('POST', '/apps/web/environments/dev/builds', {}, { cookie: sara.cookie });
expect('operator passes the role check (fails later for config)', r.status === 400 && r.body.error.includes('Jenkins'), r);

// presence + activity use the session identity
r = await call('POST', '/presence', { app: 'web', env: 'dev' }, { cookie: sara.cookie, headers: { 'x-user': 'spoofed' } });
expect('presence uses the signed-in name, not x-user', r.body.some((v) => v.user === 'Sara K.') && !r.body.some((v) => v.user === 'spoofed'), r.body);

// JSON-only mutations
r = await call('POST', '/apps/web/environments/dev/builds', 'a=1', { cookie: sara.cookie, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
expect('form posts are refused (415)', r.status === 415, r);

// admin safety
const me = (await call('GET', '/auth/me', undefined, { cookie: admin.cookie })).body.user;
r = await call('DELETE', `/users/${me.id}`, undefined, { cookie: admin.cookie });
expect('cannot delete yourself', r.status === 409, r);
r = await call('PUT', `/users/${me.id}`, { role: 'viewer' }, { cookie: admin.cookie });
expect('cannot demote the last admin', r.status === 409, r);
r = await call('GET', '/users', undefined, { cookie: sara.cookie });
expect('only admins list users', r.status === 403, r);

// password change signs out everywhere; logout kills the session
const saraId = (await call('GET', '/users', undefined, { cookie: admin.cookie })).body.find((u) => u.username === 'sara').id;
await call('PUT', `/users/${saraId}`, { password: 'new-operator-pass' }, { cookie: admin.cookie });
r = await call('GET', '/apps', undefined, { cookie: sara.cookie });
expect('password change ends existing sessions', r.status === 401, r);
r = await call('POST', '/auth/logout', {}, { cookie: ahmed.cookie });
r = await call('GET', '/apps', undefined, { cookie: ahmed.cookie });
expect('logout ends the session', r.status === 401, r);

// throttling
for (let i = 0; i < 10; i++) await signIn('admin', 'bad');
r = await signIn('admin', 'correct-horse-battery');
expect('10 failures -> 429 even with the right password', r.status === 429, r);

const raw = fs.readFileSync('./data/auth-test.db').toString('latin1');
expect('no plaintext passwords or session tokens in the DB', !raw.includes('operator-pass-123') && !raw.includes(admin.cookie.split('=')[1]));

api.close();
fs.rmSync('./data', { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
