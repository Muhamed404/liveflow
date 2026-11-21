import { k8s, prometheus, loki, jenkins, argocd, grafana } from '../adapters/index.js';
import { buildQueries } from '../adapters/queries.js';
import { cached } from '../utils/cache.js';
import { HttpError } from '../middleware/errors.js';
import { buildPath } from './path.js';

const key = (ctx, part) => `${ctx.app.id}:${ctx.env.name}:${part}`;
const ensure = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };

const imageTag = (image = '') => {
  const at = image.lastIndexOf(':');
  return at > image.lastIndexOf('/') ? image.slice(at + 1) : null;
};

/**
 * The environment as a whole plus one entry per service.
 * Top-level fields are totals (replicas, instances, rolling_out) or the primary service's
 * (version, image, hpa), so single-service environments look exactly as before.
 */
function summarise(runtime, services) {
  const primary = services[0] || null;
  const sum = (k) => services.reduce((n, s) => n + s.replicas[k], 0);
  return {
    runtime,
    version: primary?.version || null,
    image: primary?.image || null,
    versions: [...new Set(services.map((s) => s.version).filter(Boolean))],
    replicas: { desired: sum('desired'), ready: sum('ready'), updated: sum('updated'), on_current_version: sum('on_current_version') },
    rolling_out: services.some((s) => s.rolling_out),
    hpa: primary?.hpa || null,
    instances: services.flatMap((s) => s.instances),
    services,
  };
}

/** Pods (k8s) or containers (compose via cAdvisor) — same shape for the UI */
export function getWorkload(ctx) {
  return cached(key(ctx, 'workload'), 2000, async () => {
    if (ctx.k8s) {
      const { cluster, namespace, deployments } = ctx.k8s;
      const [deps, hpas] = await Promise.all([
        Promise.all(deployments.map((d) => k8s.getDeployment(cluster, namespace, d))),
        k8s.listHpas(cluster, namespace),
      ]);
      const podLists = await Promise.all(deps.map((dep) => k8s.listPods(cluster, namespace, dep.name, dep.selector)));
      const seen = new Set(); // overlapping selectors must not count a pod twice
      const services = deps.map((dep, i) => {
        // "current" = pod runs the deployment's desired image -> drives the rolling-update squares in the UI
        const instances = podLists[i].filter((p) => !seen.has(p.name) && seen.add(p.name))
          .map((p) => ({ ...p, service: dep.name, current: p.image === dep.image }));
        return {
          name: dep.name,
          version: dep.version,
          image: dep.image,
          replicas: {
            desired: dep.desired_replicas,
            ready: dep.ready_replicas,
            updated: dep.updated_replicas,
            on_current_version: instances.filter((p) => p.current && p.ready).length,
          },
          rolling_out: dep.rolling_out || instances.some((p) => !p.current || p.phase === 'Terminating'),
          hpa: hpas.find((h) => h.target === dep.name) || null,
          instances,
        };
      });
      return summarise('k8s', services);
    }
    ensure(ctx.prometheus, 'compose env needs a prometheus integration (cAdvisor)');
    const series = await prometheus.query(ctx.prometheus, buildQueries(ctx).containers);
    const now = Date.now() / 1000;
    const instances = series.map((s) => ({
      name: s.labels.name,
      service: s.labels.container_label_com_docker_compose_service || null,
      phase: now - s.value < 60 ? 'Running' : 'Stopped',
      ready: now - s.value < 60,
      image: s.labels.image || null,
      version: imageTag(s.labels.image),
      current: true,
    })).sort((a, b) => a.name.localeCompare(b.name));
    // one service per Compose service label (container name when the label is missing)
    const groups = new Map();
    for (const i of instances) {
      const name = i.service || i.name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ ...i, service: name });
    }
    const services = [...groups].map(([name, list]) => {
      const running = list.filter((i) => i.ready).length;
      return {
        name,
        version: list.find((i) => i.version)?.version || null,
        image: list.find((i) => i.image)?.image || null,
        replicas: { desired: list.length, ready: running, updated: running, on_current_version: running },
        rolling_out: false,
        hpa: null,
        instances: list,
      };
    });
    return summarise('compose', services);
  });
}

export function getMetrics(ctx) {
  ensure(ctx.prometheus, 'no prometheus integration for this environment');
  return cached(key(ctx, 'metrics'), 3000, async () => {
    const q = buildQueries(ctx);
    const names = ['cpu_cores', 'memory_bytes', 'rps', 'error_rate'].filter((n) => q[n]);
    const values = await Promise.all(names.map((n) => prometheus.scalar(ctx.prometheus, q[n])));
    return Object.fromEntries(names.map((n, i) => [n, values[i]]));
  });
}

export function getMetricRange(ctx, metric, minutes) {
  ensure(ctx.prometheus, 'no prometheus integration for this environment');
  const q = buildQueries(ctx)[metric];
  ensure(q && metric !== 'containers', `unknown metric "${metric}"`);
  const step = Math.max(15, Math.round((minutes * 60) / 120)); // ~120 points
  return cached(key(ctx, `range:${metric}:${minutes}`), 5000, async () => {
    const series = await prometheus.range(ctx.prometheus, q, { minutes, stepSec: step });
    return { metric, step_sec: step, points: series[0]?.points || [] };
  });
}

export function getLogs(ctx, { limit, contains, minutes }) {
  ensure(ctx.loki, 'no loki integration for this environment');
  return cached(key(ctx, `logs:${limit}:${contains || ''}:${minutes}`), 2000,
    () => loki.recent(ctx.loki, loki.selectorFor(ctx), { limit, contains, minutes }));
}

export function getLatestBuild(ctx) {
  if (!ctx.jenkins) return null;
  return cached(key(ctx, 'build:last'), 2000, async () => {
    try {
      return await jenkins.getBuild(ctx.jenkins, ctx.jenkins.job, 'lastBuild');
    } catch (err) {
      if (err.upstreamStatus === 404) return null; // job never ran
      throw err;
    }
  });
}

export function getArgo(ctx) {
  if (!ctx.argocd) return null;
  return cached(key(ctx, 'argocd'), 2000, () => argocd.getApp(ctx.argocd, ctx.argocd.app));
}

/**
 * One call for the Overview page. Each section succeeds or fails on its own,
 * so a down Loki doesn't blank the whole dashboard.
 */
export async function getOverview(ctx) {
  const sections = {
    workload: () => getWorkload(ctx),
    metrics: () => (ctx.prometheus ? getMetrics(ctx) : null),
    pipeline: () => getLatestBuild(ctx),
    argocd: () => getArgo(ctx),
  };
  const names = Object.keys(sections);
  const settled = await Promise.allSettled(names.map((n) => sections[n]()));
  const out = {
    app: ctx.app,
    env: ctx.env,
    grafana_url: ctx.grafana?.dashboard_uid
      ? grafana.embedUrl(ctx.grafana, ctx.grafana.dashboard_uid, { vars: ctx.k8s ? { namespace: ctx.k8s.namespace } : {} })
      : null,
    features: {
      release: ctx.env.name === 'prod' && Boolean(ctx.github && ctx.jenkins),
      build: Boolean(ctx.jenkins) && ctx.env.name !== 'prod',
      sync: Boolean(ctx.argocd),
      stress: Boolean(ctx.stress),
      logs: Boolean(ctx.loki),
    },
  };
  names.forEach((n, i) => {
    const r = settled[i];
    out[n] = r.status === 'fulfilled' ? { data: r.value } : { error: r.reason.message };
  });

  out.path = buildPath(ctx, out);
  const build = out.pipeline.data;
  const running = build?.status === 'RUNNING';
  const argo = out.argocd.data;

  // The prod gate panel: what a sync would change
  out.gate = null;
  if (ctx.argocd && ctx.env.deploy_mode === 'manual') {
    const to = build?.params?.VERSION || build?.image?.split(':').pop() || null;
    out.gate = {
      waiting: out.path.stations.some((s) => s.state === 'gate'),
      from_version: out.workload.data?.version || null,
      to_version: to,
      target: ctx.k8s ? `${ctx.k8s.cluster?.id}/${ctx.k8s.namespace}` : null,
      pods: out.workload.data?.replicas.desired ?? null,
      requires_confirm: ctx.env.name === 'prod',
    };
  }

  // What the buttons can do right now, with the reason when they can't
  const no = (reason) => ({ allowed: false, reason });
  const yes = { allowed: true, reason: null };
  out.can = {
    run_pipeline: !out.features.build ? no('not available for this environment')
      : running ? no(`#${build.number} is running — one pipeline per environment`) : yes,
    release: !out.features.release ? no('releases are for prod') : running ? no(`#${build.number} is running`) : yes,
    sync: !ctx.argocd ? no('not deployed by ArgoCD') : running ? no(`wait for #${build.number}`)
      : !argo ? no('ArgoCD is unavailable right now') // its state is unknown: don't offer a blind sync
        : argo.sync_status === 'Synced' ? no('already in sync') : yes,
  };

  if (ctx.stress) {
    try {
      const { stressStatus } = await import('./stress.js');
      out.stress = { data: await cached(key(ctx, 'stress'), 2000, () => stressStatus(ctx)) };
    } catch (err) {
      out.stress = { error: err.message };
    }
    out.can.stress = out.stress.data?.running ? no(`test #${out.stress.data.build.number} is running`) : yes;
  } else {
    out.stress = null;
    out.can.stress = no('no stress job configured');
  }
  return out;
}
