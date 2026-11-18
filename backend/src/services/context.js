import { appsRepo } from '../repositories/apps.js';
import { environmentsRepo } from '../repositories/environments.js';
import { clustersRepo } from '../repositories/clusters.js';
import { integrationsRepo } from '../repositories/integrations.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { deploymentsOf } from '../routes/schemas.js';

// Which env column points to which integration type
export const INTEGRATION_COLUMNS = {
  jenkins_integration_id: 'jenkins',
  argocd_integration_id: 'argocd',
  prometheus_integration_id: 'prometheus',
  loki_integration_id: 'loki',
  grafana_integration_id: 'grafana',
};

export function assertIntegrationTypes(row) {
  const issues = [];
  for (const [col, type] of Object.entries(INTEGRATION_COLUMNS)) {
    if (!row[col]) continue;
    const integ = integrationsRepo.get(row[col]);
    if (!integ) issues.push({ path: [col], message: `"${row[col]}" does not exist` });
    else if (integ.type !== type) issues.push({ path: [col], message: `"${row[col]}" is a ${integ.type} integration, expected ${type}` });
  }
  if (row.cluster_id && !clustersRepo.get(row.cluster_id)) issues.push({ path: ['cluster_id'], message: `"${row.cluster_id}" does not exist` });
  if (issues.length) throw new HttpError(400, 'Invalid environment references', issues);
}

/**
 * Resolves everything an adapter needs for one app + env, with decrypted secrets.
 * INTERNAL USE ONLY — never send this object to the browser.
 */
export function resolveContext(appId, envName) {
  const app = appsRepo.get(appId);
  if (!app) throw notFound(`App "${appId}"`);
  const env = environmentsRepo.get(appId, envName);
  if (!env) throw notFound(`Environment "${envName}" for app "${appId}"`);

  const integ = (id) => integrationsRepo.getWithSecret(id);

  return {
    app: { id: app.id, name: app.name },
    env: { name: env.name, runtime: env.runtime, deploy_mode: env.deploy_mode, git_branch: env.git_branch },
    github: app.github_repo ? { ...integ(app.github_integration_id), repo: app.github_repo } : null,
    k8s: env.runtime === 'k8s'
      // deployments: every Deployment of this environment; deployment: the first one (the "primary",
      // e.g. ui), whose version, image and HPA stand for the environment in headlines and the stress test
      ? (() => {
        const deployments = deploymentsOf(env.deployment);
        return { cluster: clustersRepo.getWithSecret(env.cluster_id), namespace: env.namespace, deployment: deployments[0], deployments };
      })()
      : null,
    compose: env.runtime === 'compose'
      ? { project: env.compose_project }
      : null,
    jenkins: env.jenkins_integration_id ? { ...integ(env.jenkins_integration_id), job: env.jenkins_job } : null,
    argocd: env.argocd_integration_id ? { ...integ(env.argocd_integration_id), app: env.argocd_app } : null,
    prometheus: env.prometheus_integration_id ? {
      ...integ(env.prometheus_integration_id), selector: env.prom_selector,
      http_metric: env.http_metric || 'http_requests_total', http_status_label: env.http_status_label || 'status',
    } : null,
    loki: env.loki_integration_id ? { ...integ(env.loki_integration_id), selector: env.loki_selector } : null,
    stress: env.stress_job && env.jenkins_integration_id
      ? { ...integ(env.jenkins_integration_id), job: env.stress_job, target_url: env.stress_target_url } : null,
    grafana: env.grafana_integration_id ? { ...integ(env.grafana_integration_id), dashboard_uid: env.grafana_dashboard_uid } : null,
  };
}
