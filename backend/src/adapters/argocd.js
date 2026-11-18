import { http, bearer, tlsOf } from './http.js';

const call = (conn, path, opts = {}) =>
  http('argocd', conn.base_url + path, { ...opts, headers: { authorization: bearer(conn.token), ...opts.headers }, tls: tlsOf(conn) });

export const argocd = {
  async test(conn) {
    const { data } = await call(conn, '/api/v1/session/userinfo');
    if (!data.loggedIn) throw new Error('argocd: token is not logged in');
    return `authenticated as ${data.username}`;
  },

  async testApp(conn, app) {
    const a = await this.getApp(conn, app);
    return `app "${app}" — ${a.sync_status} / ${a.health_status}`;
  },

  async getApp(conn, app) {
    const { data } = await call(conn, `/api/v1/applications/${encodeURIComponent(app)}`);
    const op = data.status?.operationState;
    return {
      name: data.metadata.name,
      sync_status: data.status?.sync?.status || 'Unknown',      // Synced | OutOfSync
      health_status: data.status?.health?.status || 'Unknown',  // Healthy | Progressing | Degraded ...
      revision: data.status?.sync?.revision || null,
      images: data.status?.summary?.images || [],
      auto_sync: Boolean(data.spec?.syncPolicy?.automated),
      operation: op ? { phase: op.phase, message: op.message, started_at: op.startedAt, finished_at: op.finishedAt || null } : null,
      history: (data.status?.history || []).slice(-10).reverse().map((h) => ({
        id: h.id, revision: h.revision, deployed_at: h.deployedAt,
      })),
    };
  },

  /** Manual sync — used for prod (deploy_mode = manual). */
  async sync(conn, app, { revision, prune = false } = {}) {
    try {
      await call(conn, `/api/v1/applications/${encodeURIComponent(app)}/sync`, {
        method: 'POST',
        body: { prune, ...(revision ? { revision } : {}) },
      });
    } catch (err) {
      if (/operation is already in progress/i.test(err.message)) {
        err.status = 409;
        err.message = 'argocd: a sync is already running for this app';
      }
      throw err;
    }
    return { requested: true };
  },
};
