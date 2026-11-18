/**
 * PromQL builders per runtime.
 *  - k8s:     cAdvisor metrics from the kubelet (namespace + pod labels)
 *  - compose: cAdvisor running on the dev server (docker compose labels)
 * Label values come from validated names (DNS-1123 / compose names), so they are safe to interpolate.
 * HTTP metrics (rps / error rate): metric + status label are configurable per env (default http_requests_total / status).
 */
export function buildQueries(ctx) {
  let workload;
  if (ctx.k8s) {
    // every deployment of the environment: pod=~"(ui|catalog|cart)-.*" (names are DNS-1123, so regex-safe)
    const deps = ctx.k8s.deployments || [ctx.k8s.deployment];
    const pods = deps.length > 1 ? `(${deps.join('|')})` : deps[0];
    workload = `namespace="${ctx.k8s.namespace}",pod=~"${pods}-.*",container!="",container!="POD"`;
  } else {
    workload = `container_label_com_docker_compose_project="${ctx.compose.project}"`;
  }

  const app = ctx.prometheus?.selector
    || (ctx.k8s ? `namespace="${ctx.k8s.namespace}"` : null);

  const q = {
    cpu_cores: `sum(rate(container_cpu_usage_seconds_total{${workload}}[1m]))`,
    memory_bytes: `sum(container_memory_working_set_bytes{${workload}})`,
  };
  if (app) {
    const metric = ctx.prometheus?.http_metric || 'http_requests_total';
    const status = ctx.prometheus?.http_status_label || 'status';
    q.rps = `sum(rate(${metric}{${app}}[1m]))`;
    q.error_rate = `(sum(rate(${metric}{${app},${status}=~"5.."}[1m])) or vector(0)) / sum(rate(${metric}{${app}}[1m]))`;
  }
  if (ctx.compose) {
    // one series per container; value = last-seen unix time
    q.containers = `container_last_seen{${workload}}`;
  }
  return q;
}
