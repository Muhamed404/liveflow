import { db } from '../db/index.js';
import { updateRow } from '../db/helpers.js';

export const appsRepo = {
  list() {
    const apps = db.prepare('SELECT * FROM apps ORDER BY name').all();
    const envs = db.prepare('SELECT app_id, name, runtime, deploy_mode FROM environments ORDER BY id').all();
    return apps.map((a) => ({ ...a, environments: envs.filter((e) => e.app_id === a.id).map(({ app_id, ...e }) => e) }));
  },

  get: (id) => db.prepare('SELECT * FROM apps WHERE id = ?').get(id),

  create({ id, name, github_integration_id, github_repo }) {
    db.prepare(`INSERT INTO apps (id, name, github_integration_id, github_repo)
                VALUES (@id, @name, @github_integration_id, @github_repo)`)
      .run({ id, name, github_integration_id: github_integration_id || null, github_repo: github_repo || null });
    return this.get(id);
  },

  update(id, fields) {
    updateRow('apps', { id }, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === '' ? null : v])));
    return this.get(id);
  },

  remove: (id) => db.prepare('DELETE FROM apps WHERE id = ?').run(id).changes,
};
