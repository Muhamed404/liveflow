import { http, basic, bearer, tlsOf } from './http.js';

// username -> basic auth, token only -> bearer; tenant_id -> X-Scope-OrgID (multi-tenant Loki / Mimir)
const authHeaders = (conn) => ({
  ...(conn.username ? { authorization: basic(conn.username, conn.token) } : conn.token ? { authorization: bearer(conn.token) } : {}),
  ...(conn.tenant_id ? { 'x-scope-orgid': conn.tenant_id } : {}),
});

const call = (conn, path) => http('loki', conn.base_url + path, { headers: authHeaders(conn), tls: tlsOf(conn) });

const LEVEL = /\b(error|err|fatal|panic)\b/i;
const WARN = /\b(warn|warning)\b/i;
const levelOf = (line) => (LEVEL.test(line) ? 'error' : WARN.test(line) ? 'warn' : 'info');

export const loki = {
  async test(conn) {
    await call(conn, '/loki/api/v1/labels');
    return 'connected — labels API reachable';
  },

  /** Default stream selector when the env doesn't define one */
  selectorFor(ctx) {
    if (ctx.loki?.selector) return ctx.loki.selector;
    if (ctx.k8s) return `{namespace="${ctx.k8s.namespace}"}`;
    return `{compose_project="${ctx.compose.project}"}`; // depends on your promtail docker labels
  },

  /** Latest log lines, newest first */
  async recent(conn, selector, { limit = 100, minutes = 15, contains } = {}) {
    const end = BigInt(Date.now()) * 1_000_000n;
    const start = end - BigInt(minutes * 60) * 1_000_000_000n;
    const query = contains ? `${selector} |= ${JSON.stringify(contains)}` : selector;
    const qs = `query=${encodeURIComponent(query)}&limit=${limit}&direction=backward&start=${start}&end=${end}`;
    const { data } = await call(conn, `/loki/api/v1/query_range?${qs}`);

    const lines = (data.data?.result || []).flatMap((stream) =>
      stream.values.map(([ns, line]) => ({
        ts: new Date(Number(BigInt(ns) / 1_000_000n)).toISOString(),
        line,
        level: levelOf(line),
        pod: stream.stream.pod || stream.stream.container || stream.stream.container_name || null,
      })),
    );
    return lines.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
  },
};
