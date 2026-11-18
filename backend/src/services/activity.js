import { db } from '../db/index.js';

export const activity = {
  record({ actor, app_id, env, action, status = 'ok', details }) {
    db.prepare(`INSERT INTO activity (actor, app_id, env, action, status, details)
                VALUES (@actor, @app_id, @env, @action, @status, @details)`)
      .run({ actor, app_id, env, action, status, details: details ? JSON.stringify(details) : null });
  },
  list({ app_id, env, limit = 50 } = {}) {
    const where = [], params = { limit };
    if (app_id) { where.push('app_id = @app_id'); params.app_id = app_id; }
    if (env) { where.push('env = @env'); params.env = env; }
    const sql = `SELECT * FROM activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT @limit`;
    return db.prepare(sql).all(params).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  },
};

/** Run an action and always log it, success or failure. */
export async function audited(meta, fn, summarize = (r) => r) {
  try {
    const result = await fn();
    activity.record({ ...meta, status: 'ok', details: { ...meta.details, result: summarize(result) } });
    return result;
  } catch (err) {
    activity.record({ ...meta, status: 'failed', details: { ...meta.details, error: err.message } });
    throw err;
  }
}
