import { adapters, k8s, jenkins, argocd, prometheus, loki, grafana, github } from '../adapters/index.js';
import { probe } from '../adapters/http.js';
import { buildQueries } from '../adapters/queries.js';
import { clustersRepo } from '../repositories/clusters.js';
import { integrationsRepo } from '../repositories/integrations.js';
import { resolveContext } from './context.js';
import { notFound } from '../middleware/errors.js';

export async function testCluster(id) {
  const cluster = clustersRepo.getWithSecret(id);
  if (!cluster) throw notFound('Cluster');
  return probe('kubernetes', () => k8s.test(cluster));
}

export async function testIntegration(id) {
  const conn = integrationsRepo.getWithSecret(id);
  if (!conn) throw notFound('Integration');
  return probe(conn.type, () => adapters[conn.type].test(conn));
}

/**
 * Full check for one app + env: auth AND the specific resources this env points to.
 * This feeds the "Test connections" status strip in Settings.
 */
export async function testEnvironment(appId, envName) {
  const ctx = resolveContext(appId, envName);
  const checks = [];

  if (ctx.github) checks.push(probe('github', () => github.testRepo(ctx.github, ctx.github.repo)));
  if (ctx.jenkins) checks.push(probe('jenkins', () => jenkins.testJob(ctx.jenkins, ctx.jenkins.job)));
  if (ctx.k8s) checks.push(probe('kubernetes', () => k8s.testWorkload(ctx.k8s.cluster, ctx.k8s.namespace, ctx.k8s.deployments)));
  if (ctx.argocd) checks.push(probe('argocd', () => argocd.testApp(ctx.argocd, ctx.argocd.app)));
  if (ctx.prometheus) {
    checks.push(probe('prometheus', async () => {
      const q = buildQueries(ctx);
      const series = await prometheus.query(ctx.prometheus, ctx.compose ? q.containers : q.cpu_cores);
      if (series.length === 0) throw new Error(ctx.compose
        ? `no cAdvisor series for compose project "${ctx.compose.project}"`
        : 'no CPU series found for this workload');
      return ctx.compose ? `${series.length} container(s) visible via cAdvisor` : 'workload metrics found';
    }));
  }
  if (ctx.loki) {
    checks.push(probe('loki', async () => {
      const lines = await loki.recent(ctx.loki, loki.selectorFor(ctx), { limit: 5, minutes: 60 });
      return lines.length ? `log stream active (${lines.length}+ lines in last hour)` : 'reachable, but no logs in the last hour';
    }));
  }
  if (ctx.grafana?.dashboard_uid) checks.push(probe('grafana', () => grafana.testDashboard(ctx.grafana, ctx.grafana.dashboard_uid)));

  const results = await Promise.all(checks);
  return { app: ctx.app.id, env: ctx.env.name, ok: results.every((r) => r.ok), checks: results };
}
