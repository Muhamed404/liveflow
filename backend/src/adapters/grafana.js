import { http, bearer, tlsOf } from './http.js';

const call = (conn, path) => http('grafana', conn.base_url + path, { headers: { authorization: bearer(conn.token) }, tls: tlsOf(conn) });

export const grafana = {
  async test(conn) {
    await call(conn, '/api/search?limit=1');
    return 'connected — API key accepted';
  },

  async testDashboard(conn, uid) {
    const { data } = await call(conn, `/api/dashboards/uid/${encodeURIComponent(uid)}`);
    return `dashboard "${data.dashboard?.title}" found`;
  },

  /** URL for an iframe (Grafana needs allow_embedding = true) */
  embedUrl(conn, uid, { from = 'now-1h', vars = {} } = {}) {
    const params = new URLSearchParams({ orgId: '1', from, to: 'now', kiosk: '', theme: 'dark', refresh: '10s' });
    for (const [k, v] of Object.entries(vars)) params.set(`var-${k}`, v);
    return `${conn.base_url}/d/${encodeURIComponent(uid)}?${params}`;
  },
};
