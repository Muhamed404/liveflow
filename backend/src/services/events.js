import { jenkins, k8s } from '../adapters/index.js';
import { activity } from './activity.js';
import { getArgo } from './observe.js';
import { cached } from '../utils/cache.js';

// activity row -> one human sentence for the timeline
function describeActivity(a) {
  const d = a.details || {};
  const [done, tried] = {
    build: ['ran the pipeline', 'run the pipeline'],
    release: [`released ${d.version}`, `release ${d.version}`],
    rollback: [`rolled back to ${d.version}`, `roll back to ${d.version}`],
    sync: ['synced ArgoCD', 'sync ArgoCD'],
    stress_start: [`started a stress test · ${d.vus} VUs, ${d.duration_sec}s`, 'start a stress test'],
    stress_stop: ['stopped the stress test', 'stop the stress test'],
  }[a.action] || [a.action, a.action];
  return a.status === 'ok' ? done : `tried to ${tried} — ${d.error}`;
}

const sources = {
  user: async (ctx) => activity.list({ app_id: ctx.app.id, env: ctx.env.name, limit: 30 }).map((a) => ({
    at: a.ts, source: 'user', actor: a.actor, text: `${a.actor} ${describeActivity(a)}`, level: a.status === 'ok' ? 'info' : 'warn',
  })),

  jenkins: async (ctx) => {
    if (!ctx.jenkins) return [];
    const builds = await jenkins.listBuilds(ctx.jenkins, ctx.jenkins.job, 8);
    return builds.flatMap((b) => {
      const out = [{ at: b.started_at, source: 'jenkins', text: `#${b.number} started`, level: 'info', build_number: b.number }];
      if (b.status !== 'RUNNING' && b.duration_ms) { // finished: duration is the real run time
        out.push({
          at: new Date(Date.parse(b.started_at) + b.duration_ms).toISOString(), source: 'jenkins',
          text: `#${b.number} ${b.status === 'SUCCESS' ? 'passed' : b.status.toLowerCase()}`,
          level: b.status === 'SUCCESS' ? 'info' : 'warn', build_number: b.number,
        });
      }
      return out;
    });
  },

  argocd: async (ctx) => {
    if (!ctx.argocd) return [];
    const app = await getArgo(ctx);
    return (app?.history || []).map((h) => ({
      at: h.deployed_at, source: 'argocd', text: `Synced ${ctx.argocd.app} to ${String(h.revision).slice(0, 7)}`, level: 'info',
    }));
  },

  k8s: async (ctx) => {
    if (!ctx.k8s) return [];
    const { cluster, namespace, deployments } = ctx.k8s;
    const hpas = (await k8s.listHpas(cluster, namespace)).filter((h) => deployments.includes(h.target));
    const evs = await k8s.listEvents(cluster, namespace, deployments, hpas.map((h) => h.name));
    // with several services, say which one scaled ("cart scaled to 3")
    const scaled = (e) => {
      const target = deployments.length > 1 ? hpas.find((h) => h.name === e.object)?.target : null;
      return e.message.replace(/^New size: (\d+); reason: /, `${target ? `${target} scaled` : 'Scaled'} to $1 · `);
    };
    return evs.map((e) => ({
      at: e.at,
      source: e.kind === 'HorizontalPodAutoscaler' ? 'hpa' : 'k8s',
      text: e.reason === 'SuccessfulRescale' ? scaled(e) : `${e.object}: ${e.message}`,
      level: e.warning ? 'warn' : 'info',
    }));
  },
};

/** "What just happened" — every source merged into one timeline, newest first. A failing source is skipped, not fatal. */
export function getEvents(ctx, { limit = 40 } = {}) {
  return cached(`${ctx.app.id}:${ctx.env.name}:events:${limit}`, 3000, async () => {
    const names = Object.keys(sources);
    const settled = await Promise.allSettled(names.map((n) => sources[n](ctx)));
    const events = [], sources_failed = [];
    settled.forEach((r, i) => (r.status === 'fulfilled' ? events.push(...r.value) : sources_failed.push({ source: names[i], error: r.reason.message })));
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return { events: events.slice(0, limit), sources_failed };
  });
}

/** Vertical markers on metric charts: deploys and stress tests inside the window. */
export async function getMarkers(ctx, minutes) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const markers = [];
  try {
    if (ctx.argocd) {
      const app = await getArgo(ctx);
      for (const h of app?.history || []) markers.push({ at: h.deployed_at, kind: 'deploy', label: `deploy ${String(h.revision).slice(0, 7)}` });
    } else if (ctx.jenkins) {
      // compose: a successful Jenkins run is the deploy
      for (const b of await jenkins.listBuilds(ctx.jenkins, ctx.jenkins.job, 10)) {
        if (b.status === 'SUCCESS') markers.push({ at: new Date(Date.parse(b.started_at) + b.duration_ms).toISOString(), kind: 'deploy', label: `deploy #${b.number}` });
      }
    }
  } catch { /* markers are decoration — never fail the chart */ }
  for (const a of activity.list({ app_id: ctx.app.id, env: ctx.env.name, limit: 50 })) {
    if (a.action === 'stress_start' && a.status === 'ok') markers.push({ at: a.ts, kind: 'stress', label: `stress ${a.details.vus} VUs` });
  }
  return markers.filter((m) => m.at >= since).sort((a, b) => a.at.localeCompare(b.at));
}
