import { http, basic, bearer, tlsOf } from './http.js';

// username set -> basic auth (e.g. nginx in front), token only -> bearer, nothing -> no auth
// username -> basic auth, token only -> bearer; tenant_id -> X-Scope-OrgID (multi-tenant Loki / Mimir)
const authHeaders = (conn) => ({
  ...(conn.username ? { authorization: basic(conn.username, conn.token) } : conn.token ? { authorization: bearer(conn.token) } : {}),
  ...(conn.tenant_id ? { 'x-scope-orgid': conn.tenant_id } : {}),
});

const call = (conn, path) => http('prometheus', conn.base_url + path, { headers: authHeaders(conn), tls: tlsOf(conn) });

const toNumber = (v) => (v === undefined || v === 'NaN' ? null : Number(v));

export const prometheus = {
  async test(conn) {
    const { data } = await call(conn, '/api/v1/status/buildinfo');
    return `connected — Prometheus ${data.data?.version}`;
  },

  /** Instant query -> [{ labels, value }] */
  async query(conn, promql) {
    const { data } = await call(conn, `/api/v1/query?query=${encodeURIComponent(promql)}`);
    return (data.data?.result || []).map((r) => ({ labels: r.metric, value: toNumber(r.value?.[1]) }));
  },

  /** Single scalar (first series) or null */
  async scalar(conn, promql) {
    const res = await this.query(conn, promql);
    return res[0]?.value ?? null;
  },

  /** Range query -> [{ labels, points: [[unixSec, value]] }] */
  async range(conn, promql, { minutes = 15, stepSec = 15 } = {}) {
    const end = Math.floor(Date.now() / 1000);
    const start = end - minutes * 60;
    const qs = `query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=${stepSec}`;
    const { data } = await call(conn, `/api/v1/query_range?${qs}`);
    return (data.data?.result || []).map((r) => ({
      labels: r.metric,
      points: r.values.map(([t, v]) => [t, toNumber(v)]),
    }));
  },
};
