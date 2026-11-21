import { describe, it, expect } from 'vitest';
import { headline } from '../lib/headline.js';

// an environment with three services where only cart is rolling out (1 of 3 pods on the new image)
const overview = (services) => ({
  gate: null,
  path: {
    phase: 'rolling_out',
    stations: [
      { id: 'github', status: 'Changes picked up', detail: 'abc1234 → staging' },
      { id: 'jenkins', build_number: 9 },
      { id: 'cluster', version: 'ui-1', rolling_out: true, services,
        instances: services.flatMap((s) => Array.from({ length: s.desired }, (_, i) => ({ name: `${s.name}-${i}`, look: i < s.on_new ? 'new' : 'old' }))) },
    ],
  },
});
const s = (name, version, desired, onNew, rolling) => ({ name, version, desired, ready: desired, on_new: onNew, rolling_out: rolling });

describe('rolling-out headline with several services', () => {
  it('names the one service that rolls, with its own pod count', () => {
    const h = headline(overview([s('ui', 'ui-1', 3, 3, false), s('catalog', 'cat-1', 3, 3, false), s('cart', 'cart-2', 3, 1, true)]));
    expect(h.title).toBe('cart cart-2 is rolling out');
    expect(h.sub).toMatch(/^1 of 3 cart pods/);
  });

  it('lists every service when several roll at once', () => {
    const h = headline(overview([s('ui', 'ui-2', 3, 2, true), s('cart', 'cart-2', 3, 1, true)]));
    expect(h.title).toBe('2 services are rolling out');
    expect(h.sub).toContain('ui 2 / 3 · cart 1 / 3');
  });

  it('keeps the old wording for a single service', () => {
    const h = headline(overview([s('ui', 'ui-2', 3, 1, true)]));
    expect(h.title).toBe('ui-1 is rolling out');
    expect(h.sub).toMatch(/^1 of 3 pods/);
  });
});
