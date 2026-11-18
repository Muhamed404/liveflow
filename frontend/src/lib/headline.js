// overview.path.phase -> the big sentence on top of the Flow page
const find = (o, id) => o.path.stations.find((s) => s.id === id);

export function headline(o) {
  const g = find(o, 'github'), j = find(o, 'jenkins');
  const w = find(o, 'cluster') || find(o, 'dev_server');
  const who = g?.trigger?.user ? ` by ${g.trigger.user}` : '';
  const change = g?.detail ? `${g.status}: ${g.detail}${who}` : g?.status;

  switch (o.path.phase) {
    case 'building':
      return { title: `Run #${j.build_number} is building`, sub: `${change}. Now at ${j.current_stage || 'start'}.` };
    case 'deploying':
      return { title: 'ArgoCD is syncing', sub: 'Kubernetes is applying the new manifests.' };
    case 'rolling_out':
      {
        const total = w.instances.length, onNew = w.instances.filter((p) => p.look === 'new').length;
        return { title: `${w.version || 'New version'} is rolling out`, sub: `${onNew} of ${total} pods are on the new image. Old pods leave as new ones get ready.` };
      }
    case 'scaling':
      return { title: `Scaling: ${w.status}`, sub: 'Pods are starting without a new deploy, usually the HPA reacting to load.' };
    case 'waiting_gate':
      return {
        title: `${o.gate?.to_version || 'A new version'} is ready. Production is waiting on you.`,
        sub: 'Jenkins built the image and updated the values file. Production changes only when someone syncs.',
      };
    case 'failed':
      return { title: `Run #${j.build_number} failed${j.detail ? ` ${j.detail}` : ''}`, sub: 'Open the run to see the failing stage, then push a fix or run it again.' };
    case 'unhealthy':
      return { title: 'This environment needs attention', sub: `${w?.name}: ${w?.status}.` };
    case 'idle':
      return { title: 'No runs yet', sub: 'Push to the branch or run the pipeline to start.' };
    default:
      return { title: w?.version ? `${w.version} is live` : `Live on ${w?.name || 'the server'}`, sub: change ? `Last change: ${change}.` : `${w?.status}.` };
  }
}
