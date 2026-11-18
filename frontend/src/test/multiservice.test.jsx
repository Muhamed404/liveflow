import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryPath } from '../components/DeliveryPath.jsx';
import { ServicesPanel, StatRow } from '../components/FlowParts.jsx';
import multi from './fixtures/multi.json';
import staging from './fixtures/staging.json';

// multi.json: a real overview of one environment with five deployments (frontend, catalog, cart, orders, checkout)
const services = multi.workload.data.services;

describe('an environment with several deployments', () => {
  it('groups the pod squares into one labelled row per service, in order', () => {
    const { container } = render(<DeliveryPath path={multi.path} />);
    const rows = [...container.querySelectorAll('.podfield__row')];
    expect(rows.map((r) => r.querySelector('.podfield__svc').textContent)).toEqual(services.map((s) => s.name));
    expect(rows.map((r) => r.querySelectorAll('.pod').length)).toEqual(services.map((s) => s.instances.length));
  });

  it('keeps the single row of squares when there is only one deployment', () => {
    const { container } = render(<DeliveryPath path={staging.path} />);
    expect(container.querySelector('.podfield__row')).toBeNull();
    expect(container.querySelectorAll('.pod').length).toBeGreaterThan(0);
  });

  it('lists every service with its version, pods and state', () => {
    render(<ServicesPanel overview={multi} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(services.length);
    services.forEach((s, i) => {
      expect(rows[i].textContent).toContain(s.name);
      expect(rows[i].textContent).toContain(`${s.replicas.ready} / ${s.replicas.desired}`);
    });
    expect(rows[0].textContent).toContain('main');
    expect(screen.getAllByText('Healthy')).toHaveLength(services.length);
  });

  it('shows nothing for a single-deployment environment', () => {
    const { container } = render(<ServicesPanel overview={staging} />);
    expect(container.innerHTML).toBe('');
  });

  it('says the numbers cover all services and whose HPA it is', () => {
    render(<StatRow overview={multi} />);
    expect(screen.getByText(`all ${services.length} services on this version`)).toBeTruthy();
    expect(screen.getByText(`HPA ${services[0].hpa.min_replicas}–${services[0].hpa.max_replicas} on ${services[0].name}`)).toBeTruthy();
  });
});
