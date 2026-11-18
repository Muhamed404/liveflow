import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DeliveryPath } from '../components/DeliveryPath.jsx';
import staging from './fixtures/staging.json';
import prod from './fixtures/prod.json';

describe('DeliveryPath', () => {
  it('renders every station the backend sent, with rails between', () => {
    const { container } = render(<DeliveryPath path={staging.path} />);
    const names = [...container.querySelectorAll('.station__name')].map((n) => n.textContent);
    expect(names).toEqual(staging.path.stations.map((s) => s.name));
    expect(container.querySelectorAll('.rail')).toHaveLength(staging.path.rails.length);
  });

  it('jenkins lists the stages from the Jenkinsfile, in order', () => {
    const { container } = render(<DeliveryPath path={staging.path} />);
    const jenkins = staging.path.stations.find((s) => s.id === 'jenkins');
    const rows = [...container.querySelectorAll('.stage__name')].map((n) => n.textContent);
    expect(rows).toEqual(jenkins.stages.map((s) => s.name));
    expect(screen.getByText('From your Jenkinsfile')).toBeTruthy();
  });

  it('a stage list it has never seen still renders (stages are data, not code)', () => {
    const path = structuredClone(staging.path);
    path.stations.find((s) => s.id === 'jenkins').stages = [
      { name: 'Lint', state: 'ok', duration_ms: 4000 }, { name: 'Security scan', state: 'running', duration_ms: 9000 },
      { name: 'SBOM', state: 'pending', duration_ms: null },
    ];
    const { container } = render(<DeliveryPath path={path} />);
    expect([...container.querySelectorAll('.stage__name')].map((n) => n.textContent)).toEqual(['Lint', 'Security scan', 'SBOM']);
    expect(container.querySelector('.stage--running .stage__name').textContent).toBe('Security scan');
  });

  it('rolling update draws one square per pod with its look', () => {
    const { container } = render(<DeliveryPath path={staging.path} />);
    const cluster = staging.path.stations.find((s) => s.id === 'cluster');
    const pods = [...container.querySelectorAll('.pod')].map((p) => p.className.replace('pod pod--', ''));
    expect(pods).toEqual(cluster.instances.map((i) => i.look));
  });

  it('prod gate shows a lock on ArgoCD and a blocked rail', () => {
    const { container } = render(<DeliveryPath path={prod.path} />);
    expect(container.querySelector('.station--gate .station__name').textContent).toBe('ArgoCD');
    expect(container.querySelector('.rail--blocked')).toBeTruthy();
    expect(within(container.querySelector('.station--gate')).getByText('Waiting for approval')).toBeTruthy();
  });
});
