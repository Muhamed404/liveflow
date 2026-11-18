import { describe, it, expect } from 'vitest';
import { headline } from '../lib/headline.js';
import staging from './fixtures/staging.json';
import prod from './fixtures/prod.json';

describe('headline', () => {
  it('prod waiting at the gate names the version', () => {
    expect(prod.path.phase).toBe('waiting_gate');
    expect(headline(prod).title).toBe('v2.2.0 is ready. Production is waiting on you.');
  });
  it('rolling out names the version and progress', () => {
    expect(staging.path.phase).toBe('rolling_out');
    const h = headline(staging);
    expect(h.title).toBe('stg-abc1234 is rolling out');
    expect(h.sub).toBe('2 of 3 pods are on the new image. Old pods leave as new ones get ready.');
  });
  it('building uses the run number and current stage', () => {
    const o = structuredClone(staging);
    o.path.phase = 'building';
    Object.assign(o.path.stations.find((s) => s.id === 'jenkins'), { build_number: 7, current_stage: 'Build + push' });
    const h = headline(o);
    expect(h.title).toBe('Run #7 is building');
    expect(h.sub).toContain('Now at Build + push');
  });
});
