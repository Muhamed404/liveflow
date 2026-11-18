import { db } from '../db/index.js';
import { updateRow } from '../db/helpers.js';

export const ENV_FIELDS = [
  'runtime', 'deploy_mode', 'git_branch',
  'cluster_id', 'namespace', 'deployment',
  'compose_project',
  'jenkins_integration_id', 'jenkins_job',
  'argocd_integration_id', 'argocd_app',
  'prometheus_integration_id', 'prom_selector',
  'loki_integration_id', 'loki_selector',
  'grafana_integration_id', 'grafana_dashboard_uid',
  'stress_job', 'stress_target_url',
  'http_metric', 'http_status_label',
];

const pick = (obj) => Object.fromEntries(ENV_FIELDS.map((f) => [f, obj[f]]));

export const environmentsRepo = {
  list: (appId) => db.prepare('SELECT * FROM environments WHERE app_id = ? ORDER BY id').all(appId),

  get: (appId, name) => db.prepare('SELECT * FROM environments WHERE app_id = ? AND name = ?').get(appId, name),

  create(appId, name, data) {
    const row = pick(data);
    for (const k of ENV_FIELDS) if (row[k] === undefined || row[k] === '') row[k] = null;
    row.deploy_mode ??= name === 'prod' ? 'manual' : 'auto';
    const cols = ENV_FIELDS.join(', ');
    const vals = ENV_FIELDS.map((f) => '@' + f).join(', ');
    db.prepare(`INSERT INTO environments (app_id, name, ${cols}) VALUES (@app_id, @name, ${vals})`)
      .run({ app_id: appId, name, ...row });
    return this.get(appId, name);
  },

  update(appId, name, data) {
    // '' from a cleared form field means "unset" (and must not hit a foreign key as '')
    const row = Object.fromEntries(Object.entries(pick(data)).map(([k, v]) => [k, v === '' ? null : v]));
    updateRow('environments', { app_id: appId, name }, row);
    return this.get(appId, name);
  },

  remove: (appId, name) => db.prepare('DELETE FROM environments WHERE app_id = ? AND name = ?').run(appId, name).changes,
};
