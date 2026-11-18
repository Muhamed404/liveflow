import { z } from 'zod';
import { INTEGRATION_TYPES } from '../repositories/integrations.js';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'lowercase letters, digits and dashes only');
const url = z.string().url();
const optStr = z.string().trim().max(500).optional().nullable();
// DNS-1123 names: also keeps PromQL / LogQL label values injection-safe
const K8S_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const k8sName = z.string().regex(K8S_NAME, 'must be a valid k8s name').max(63).optional().nullable();
// One or more Deployments, comma or space separated ("ui, catalog, cart"). Stored normalised as "a, b, c".
// Each name is DNS-1123, which also keeps the PromQL pod regex built from them injection-safe.
const deploymentList = z.string().trim().max(1000).optional().nullable().transform((s, ctx) => {
  if (s == null || s === '') return s;
  const names = [...new Set(s.split(/[\s,]+/).filter(Boolean))];
  const bad = names.filter((n) => n.length > 63 || !K8S_NAME.test(n));
  if (bad.length) ctx.addIssue({ code: 'custom', message: `not a valid Kubernetes name: ${bad.join(', ')}` });
  if (names.length > 20) ctx.addIssue({ code: 'custom', message: 'at most 20 deployments per environment' });
  return names.join(', ');
});
export const deploymentsOf = (value) => (value || '').split(/[\s,]+/).filter(Boolean);
const composeName = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, - and _').max(63).optional().nullable();

export const clusterCreate = z.object({
  id: slug,
  name: z.string().min(1).max(100),
  api_url: url,
  token: z.string().min(1),
  ca_cert: z.string().optional().nullable(),
  insecure_skip_tls: z.boolean().optional(),
});
export const clusterUpdate = clusterCreate.omit({ id: true }).partial();

export const integrationCreate = z.object({
  id: slug,
  type: z.enum(INTEGRATION_TYPES),
  name: z.string().min(1).max(100),
  base_url: url,
  username: optStr,
  token: z.string().optional().nullable(),
  ca_cert: z.string().max(20000).optional().nullable(),
  insecure_skip_tls: z.boolean().optional(),
  tenant_id: optStr,
});
export const integrationUpdate = integrationCreate.omit({ id: true, type: true }).partial();

export const appCreate = z.object({
  id: slug,
  name: z.string().min(1).max(100),
  github_integration_id: optStr,
  github_repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'format: owner/repo').optional().nullable(),
});
export const appUpdate = appCreate.omit({ id: true }).partial();

export const envName = z.enum(['dev', 'staging', 'prod']);

export const envBody = z.object({
  runtime: z.enum(['compose', 'k8s']),
  deploy_mode: z.enum(['auto', 'manual']).optional(),
  git_branch: optStr,
  cluster_id: optStr,
  namespace: k8sName.or(z.literal('')),
  deployment: deploymentList,
  compose_project: composeName.or(z.literal('')),
  jenkins_integration_id: optStr,
  jenkins_job: optStr,
  argocd_integration_id: optStr,
  argocd_app: optStr,
  prometheus_integration_id: optStr,
  prom_selector: optStr,
  loki_integration_id: optStr,
  loki_selector: optStr,
  grafana_integration_id: optStr,
  grafana_dashboard_uid: optStr,
  http_metric: z.string().trim().regex(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/, 'must be a Prometheus metric name').optional().nullable().or(z.literal('')),
  http_status_label: z.string().trim().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'must be a Prometheus label name').optional().nullable().or(z.literal('')),
  stress_job: optStr,
  stress_target_url: z.string().url().optional().nullable().or(z.literal('')),
});

// Rules that depend on the runtime — applied to the final (merged) row.
// Same shape as zod issues ({ path, message }) so the UI can mark the field.
export function checkEnvRules(row) {
  const issues = [];
  const need = (field, message) => issues.push({ path: [field], message });
  if (row.runtime === 'k8s') {
    for (const f of ['cluster_id', 'namespace', 'deployment']) if (!row[f]) need(f, 'required for Kubernetes');
    if (row.argocd_integration_id && !row.argocd_app) need('argocd_app', 'required when ArgoCD is set');
  }
  if (row.runtime === 'compose') {
    if (!row.compose_project) need('compose_project', 'required for Docker Compose');
    if (row.argocd_integration_id) need('argocd_integration_id', 'Docker Compose is deployed by Jenkins, not ArgoCD');
    if (!row.prometheus_integration_id) need('prometheus_integration_id', 'required for Docker Compose: containers are read from cAdvisor through Prometheus');
  }
  if (row.stress_job && !row.stress_target_url) need('stress_target_url', 'required when a k6 job is set');
  if (row.stress_job && !row.jenkins_integration_id) need('jenkins_integration_id', 'the k6 job runs on Jenkins: pick one');
  if (row.jenkins_integration_id && !row.jenkins_job) need('jenkins_job', 'required when Jenkins is set');
  return issues;
}
