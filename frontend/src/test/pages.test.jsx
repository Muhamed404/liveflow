import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App.jsx';
import { AuthGate } from '../auth.jsx';
import apps from './fixtures/apps.json';
import prod from './fixtures/prod.json';
import staging from './fixtures/staging.json';

const calls = [];
let me = { user: { id: 1, username: 'admin', role: 'admin' }, auth_mode: 'local' };
const releases = { live_version: 'v2.1.0', pending_version: 'v2.2.0', latest_tag: 'v2.2.0', suggested_next: 'v2.2.1',
  releases: [{ tag: 'v2.2.0', state: 'waiting', can_rollback: false }, { tag: 'v2.1.0', state: 'live', can_rollback: false }, { tag: 'v2.0.0', state: 'previous', can_rollback: true }] };
const envCfg = { app_id: 'frontend-app', name: 'staging', runtime: 'k8s', deploy_mode: 'auto', cluster_id: 'cluster-stg', namespace: 'frontend-stg', deployment: 'frontend', prometheus_integration_id: 'prom-stg', prom_selector: 'x' };

beforeEach(() => {
  calls.length = 0;
  localStorage.setItem('liveflow.user', 'Mohamed'); // AUTH_MODE=off asks for a name otherwise
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const body = opts.body && JSON.parse(opts.body);
    calls.push({ url, method: opts.method || 'GET', body });
    const json = (b, status = 200) => ({ status, ok: status < 400, json: async () => b });
    if (url === '/api/auth/me') return me.user ? json(me) : json({ error: 'Sign in to continue.' }, 401);
    if (url === '/api/auth/login') return body.password === 'right' ? json(me) : json({ error: 'Wrong username or password.' }, 401);
    if (url === '/api/apps') return json(apps);
    if (url.endsWith('/prod/overview')) return json(prod);
    if (url.endsWith('/staging/overview')) return json(staging);
    if (url.endsWith('/prod/releases') && (opts.method || 'GET') === 'GET') return json(releases);
    if (url.endsWith('/prod/rollback') || url.endsWith('/prod/releases')) return json({ queue_id: 1 }, 202);
    if (url === '/api/clusters') return json([{ id: 'cluster-stg', name: 'cluster-stg' }]);
    if (url === '/api/integrations') return json([{ id: 'prom-stg', type: 'prometheus', name: 'prom-stg' }]);
    if (url === '/api/apps/frontend-app/environments/staging') return opts.method === 'PUT' ? json({ ...envCfg, ...body }) : json(envCfg);
    if (url.includes('/events')) return json({ events: [], sources_failed: [] });
    if (url === '/api/presence') return json([]);
    return json([]);
  });
});
const renderAt = (path, gate = false) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{gate ? <AuthGate><App /></AuthGate> : <App />}</MemoryRouter>
  </QueryClientProvider>,
);

describe('Releases', () => {
  it('rollback on prod needs the env name typed, then sends confirm', async () => {
    renderAt('/frontend-app/prod/releases');
    await userEvent.click(await screen.findByRole('button', { name: 'Roll back' }));
    const dlg = screen.getByRole('dialog');
    const go = within(dlg).getByRole('button', { name: 'Roll back to v2.0.0' });
    expect(go.disabled).toBe(true);
    await userEvent.type(within(dlg).getByLabelText(/to confirm/), 'prod');
    await userEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/rollback'))?.body).toEqual({ version: 'v2.0.0', confirm: true }));
  });

  it('new release suggests the next version and rejects bad formats', async () => {
    renderAt('/frontend-app/prod/releases');
    const input = await screen.findByLabelText('Version');
    expect(input.value).toBe('v2.2.1');
    await userEvent.clear(input); await userEvent.type(input, '2.3');
    expect(screen.getByText('Use the form vX.Y.Z')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create release' }).disabled).toBe(true);
  });
});

describe('Settings', () => {
  it('saving an environment sends cleared fields as null', async () => {
    renderAt('/settings?app=frontend-app&env=staging');
    const sel = await screen.findByLabelText('App selector');
    await userEvent.clear(sel);
    await userEvent.click(screen.getByRole('button', { name: 'Save environment' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body.prom_selector).toBeNull();
    expect(put.body.namespace).toBe('frontend-stg');
  });
});

describe('Sign in', () => {
  it('shows the login page, reports a wrong password, then lets you in', async () => {
    me = { user: null, auth_mode: 'local' };
    renderAt('/', true);
    await userEvent.type(await screen.findByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong username or password.')).toBeTruthy();
    me = { user: { id: 1, username: 'admin', role: 'admin' }, auth_mode: 'local' };
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('Settings validation errors', () => {
  it('names the field and marks it, instead of a generic "Validation failed"', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (opts.method === 'PUT') return { status: 400, ok: false, json: async () => ({ error: 'Validation failed', details: [{ path: ['http_status_label'], message: 'must be a Prometheus label name' }] }) };
      return orig(url, opts);
    });
    renderAt('/settings?app=frontend-app&env=staging');
    await userEvent.type(await screen.findByLabelText('Status label'), 'status=~"5.."');
    await userEvent.click(screen.getByRole('button', { name: 'Save environment' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t save the environment.');
    expect(alert.textContent).toContain('Status label: must be a Prometheus label name');
    expect(screen.getAllByText('must be a Prometheus label name').length).toBeGreaterThan(0); // under the field too
  });
});

describe('Settings rule errors', () => {
  it('compose without Prometheus marks the Prometheus picker', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (opts.method === 'PUT') return { status: 400, ok: false, json: async () => ({ error: 'Invalid environment', details: [{ path: ['prometheus_integration_id'], message: 'required for Docker Compose: containers are read from cAdvisor through Prometheus' }] }) };
      return orig(url, opts);
    });
    renderAt('/settings?app=frontend-app&env=staging');
    await userEvent.click(await screen.findByRole('button', { name: 'Save environment' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Prometheus: required for Docker Compose');
    expect(screen.getByLabelText('Prometheus').getAttribute('aria-invalid')).toBe('true');
  });
});
