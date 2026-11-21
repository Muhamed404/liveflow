import { http, bearer } from './http.js';
import { HttpError } from '../middleware/errors.js';

const call = (cluster, path, opts = {}) =>
  http('kubernetes', cluster.api_url.replace(/\/+$/, '') + path, {
    ...opts,
    headers: { authorization: bearer(cluster.token), ...opts.headers },
    tls: { ca: cluster.ca_cert, insecure: cluster.insecure_skip_tls },
  });

const labelSelector = (matchLabels = {}) =>
  Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',');

const imageTag = (image = '') => {
  const at = image.lastIndexOf(':');
  return at > image.lastIndexOf('/') ? image.slice(at + 1) : 'latest';
};

// Is this event about one of the Deployments, its ReplicaSets or its pods? Matched by kind + exact name shape,
// so the "catalog" Deployment does not pick up events of catalog-db (StatefulSet) or catalog-db-0 (its pod).
const RS = '[a-z0-9]{1,10}', POD = '[a-z0-9]{5}';
function ownedBy(obj, deployments) {
  const n = obj?.name || '';
  return deployments.some((d) => {
    if (obj?.kind === 'Deployment') return n === d;
    if (obj?.kind === 'ReplicaSet') return new RegExp(`^${d}-${RS}$`).test(n);
    if (obj?.kind === 'Pod') return new RegExp(`^${d}-${RS}-${POD}$`).test(n);
    return false;
  });
}

function summarizePod(p) {
  const statuses = p.status?.containerStatuses || [];
  const waiting = statuses.find((s) => s.state?.waiting)?.state.waiting.reason;
  const image = p.spec?.containers?.[0]?.image || '';
  return {
    name: p.metadata.name,
    phase: p.metadata.deletionTimestamp ? 'Terminating' : waiting || p.status?.phase,
    ready: statuses.length > 0 && statuses.every((s) => s.ready),
    restarts: statuses.reduce((n, s) => n + (s.restartCount || 0), 0),
    image,
    version: imageTag(image),
    node: p.spec?.nodeName || null,
    started_at: p.status?.startTime || null,
  };
}

export const k8s = {
  async test(cluster) {
    const { data } = await call(cluster, '/version');
    await call(cluster, '/api'); // requires a valid token
    return `connected — Kubernetes ${data.gitVersion}`;
  },

  /** Checks every deployment of the environment; one missing name fails the test and is named. */
  async testWorkload(cluster, namespace, deployments) {
    const deps = await Promise.all([].concat(deployments).map((d) => this.getDeployment(cluster, namespace, d)));
    if (deps.length === 1) return `deployment ${namespace}/${deps[0].name} found (${deps[0].ready_replicas}/${deps[0].desired_replicas} ready)`;
    return `${deps.length} deployments found in ${namespace}: ${deps.map((d) => `${d.name} ${d.ready_replicas}/${d.desired_replicas}`).join(', ')}`;
  },

  async getDeployment(cluster, namespace, name) {
    const { data, status } = await call(cluster, `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`, { allow: [404] });
    if (status === 404) throw new HttpError(404, `deployment ${namespace}/${name} not found`);
    const image = data.spec.template.spec.containers?.[0]?.image || '';
    return {
      name: data.metadata.name,
      desired_replicas: data.spec.replicas ?? 0,          // live value — set by HPA
      ready_replicas: data.status.readyReplicas ?? 0,
      updated_replicas: data.status.updatedReplicas ?? 0,
      available_replicas: data.status.availableReplicas ?? 0,
      image,
      version: imageTag(image),
      selector: data.spec.selector?.matchLabels || {},
      rolling_out: (data.status.updatedReplicas ?? 0) < (data.spec.replicas ?? 0) ||
                   (data.status.observedGeneration ?? 0) < (data.metadata.generation ?? 0),
    };
  },

  /** Pass the deployment's selector if you already fetched it (saves one API call). */
  async listPods(cluster, namespace, deployment, selector) {
    const matchLabels = selector || (await this.getDeployment(cluster, namespace, deployment)).selector;
    const sel = encodeURIComponent(labelSelector(matchLabels));
    const { data } = await call(cluster, `/api/v1/namespaces/${namespace}/pods?labelSelector=${sel}`);
    return (data.items || []).map(summarizePod).sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Recent events for the deployments, their ReplicaSets / Pods and their HPAs (names: one or many). */
  async listEvents(cluster, namespace, deployments, hpaNames = []) {
    const deps = [].concat(deployments), hpas = [].concat(hpaNames).filter(Boolean);
    const { data } = await call(cluster, `/api/v1/namespaces/${namespace}/events?limit=300`);
    return (data.items || [])
      .filter((e) => ownedBy(e.involvedObject, deps) || hpas.includes(e.involvedObject?.name))
      .map((e) => ({
        at: e.lastTimestamp || e.eventTime || e.firstTimestamp || e.metadata?.creationTimestamp,
        kind: e.involvedObject?.kind,
        object: e.involvedObject?.name,
        reason: e.reason,
        message: e.message,
        warning: e.type === 'Warning',
      }))
      .filter((e) => e.at);
  },

  /** Every HPA in the namespace that targets a Deployment; `target` is that Deployment's name. One API call. */
  async listHpas(cluster, namespace) {
    const { data } = await call(cluster, `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers`);
    return (data.items || [])
      .filter((h) => h.spec?.scaleTargetRef?.kind === 'Deployment')
      .map((hpa) => {
        const cpuTarget = hpa.spec.metrics?.find((m) => m.resource?.name === 'cpu')?.resource.target.averageUtilization ?? null;
        const cpuCurrent = hpa.status?.currentMetrics?.find((m) => m.resource?.name === 'cpu')?.resource.current.averageUtilization ?? null;
        return {
          name: hpa.metadata.name,
          target: hpa.spec.scaleTargetRef.name,
          min_replicas: hpa.spec.minReplicas ?? 1,
          max_replicas: hpa.spec.maxReplicas,
          current_replicas: hpa.status?.currentReplicas ?? 0,
          desired_replicas: hpa.status?.desiredReplicas ?? 0,
          cpu_target_percent: cpuTarget,
          cpu_current_percent: cpuCurrent,
          last_scale_time: hpa.status?.lastScaleTime || null,
        };
      });
  },

  /** HPA that targets this deployment (null if none). */
  async getHpa(cluster, namespace, deployment) {
    return (await this.listHpas(cluster, namespace)).find((h) => h.target === deployment) || null;
  },
};
