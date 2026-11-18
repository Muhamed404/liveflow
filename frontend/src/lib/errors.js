// Backend validation errors -> per-field messages + one readable summary
const LABELS = {
  runtime: 'Runs on', deploy_mode: 'Deploys', git_branch: 'Git branch', cluster_id: 'Cluster', namespace: 'Namespace',
  deployment: 'Deployments', compose_project: 'Compose project', jenkins_integration_id: 'Jenkins', jenkins_job: 'Job',
  argocd_integration_id: 'ArgoCD', argocd_app: 'Application', prometheus_integration_id: 'Prometheus', prom_selector: 'App selector',
  http_metric: 'Request metric', http_status_label: 'Status label', loki_integration_id: 'Loki', loki_selector: 'Log selector',
  grafana_integration_id: 'Grafana', grafana_dashboard_uid: 'Dashboard UID', stress_job: 'k6 job', stress_target_url: 'Target URL',
  name: 'Name', base_url: 'Base URL', api_url: 'API server URL', token: 'Token', username: 'Username', tenant_id: 'Tenant', id: 'Name',
};

export function fieldErrors(error) {
  const out = {};
  for (const d of error?.details || []) {
    const key = Array.isArray(d.path) ? d.path[0] : null;
    if (key && d.message && !out[key]) out[key] = d.message;
  }
  return out;
}

/** "Status label: must be a Prometheus label name" instead of "Validation failed · must be …" */
export function describeError(error) {
  if (!error) return '';
  const details = error.details || [];
  if (!details.length) return error.message;
  return details.map((d) => (typeof d === 'string' ? d : `${LABELS[d.path?.[0]] || d.path?.[0] || 'Field'}: ${d.message}`)).join(' · ');
}
