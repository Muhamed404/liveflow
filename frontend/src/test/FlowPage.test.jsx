import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App.jsx';
import apps from './fixtures/apps.json';
import staging from './fixtures/staging.json';
import prod from './fixtures/prod.json';
import events from './fixtures/events.json';
import rps from './fixtures/rps.json';

const calls = [];
function mockFetch() {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body), user: opts.headers?.['x-user'] });
    const json = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
    if (url === '/api/apps') return json(apps);
    if (url.endsWith('/staging/overview')) return json(staging);
    if (url.endsWith('/prod/overview')) return json(prod);
    if (url.includes('/events')) return json(events);
    if (url.includes('/metrics/')) return json(rps);
    if (url.includes('/logs')) return json([{ ts: new Date().toISOString(), level: 'error', pod: 'frontend-1', line: 'db timeout' }]);
    if (url === '/api/presence') return json([{ user: 'Mohamed', env: 'prod', page: 'flow' }, { user: 'Sara K', env: 'prod', page: 'flow' }]);
    if (url.endsWith('/sync')) return json({ sync_status: 'Synced' });
    return json({ error: 'not mocked' }, 404);
  });
}
const renderAt = (path) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { calls.length = 0; localStorage.setItem('liveflow.user', 'Mohamed'); mockFetch(); });

describe('Flow page', () => {
  it('prod: headline, gate, and typed confirmation before sync', async () => {
    renderAt('/frontend-app/prod');
    expect(await screen.findByRole('heading', { level: 1, name: 'v2.2.0 is ready. Production is waiting on you.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Open the gate' })).toBeTruthy();

    const sync = screen.getByRole('button', { name: 'Sync v2.2.0 to prod' });
    expect(sync.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/to sync/), 'prod');
    expect(sync.disabled).toBe(false);
    await userEvent.click(sync);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/prod/sync') && c.method === 'POST' && c.body.confirm === true)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/sync')).user).toBe('Mohamed');
  });

  it('prod has no Run pipeline button; staging does', async () => {
    renderAt('/frontend-app/prod');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Run pipeline' })).toBeNull();
  });

  it('staging: path, timeline, viewers and logs render from the API', async () => {
    renderAt('/frontend-app/staging');
    expect(await screen.findByRole('heading', { level: 1, name: 'stg-abc1234 is rolling out' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Delivery path' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Open the gate' })).toBeNull();
    expect(await screen.findByText(events.events[0].text)).toBeTruthy();
    expect(await screen.findByText('2 watching')).toBeTruthy();
    expect(await screen.findByText('db timeout')).toBeTruthy();
    const run = screen.getByRole('button', { name: 'Run pipeline' });
    expect(run.disabled).toBe(!staging.can.run_pipeline.allowed);
  });

  it('env tabs only show configured environments and mark the current one', async () => {
    renderAt('/frontend-app/staging');
    await screen.findByRole('heading', { level: 1 });
    const tabs = screen.getByRole('group', { name: 'Environment' });
    expect(tabs.querySelectorAll('a')).toHaveLength(3);
    expect(tabs.querySelector('[aria-current="true"]').textContent).toBe('staging');
  });

  it('backend down: says what failed instead of a blank page', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); });
    renderAt('/frontend-app/staging');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Can’t reach the backend/)).toBeTruthy();
  });
});
