import { Agent, request } from 'undici';
import { HttpError } from '../middleware/errors.js';

export class UpstreamError extends HttpError {
  constructor(tool, status, message, body) {
    super(502, `${tool}: ${message}`, { tool, upstream_status: status, body: body?.slice?.(0, 500) });
    this.upstreamStatus = status;
  }
}

const agents = new Map();
function agentFor(tls) {
  const key = tls ? `${tls.insecure ? 1 : 0}:${tls.ca || ''}` : 'default';
  if (!agents.has(key)) {
    agents.set(key, new Agent({
      connect: tls ? { ca: tls.ca || undefined, rejectUnauthorized: !tls.insecure } : undefined,
      keepAliveTimeout: 10_000,
    }));
  }
  return agents.get(key);
}

/**
 * Small HTTP helper used by all adapters.
 * Returns { status, headers, data } — data is parsed JSON when possible, else text.
 * Throws UpstreamError on network errors or non-2xx (unless status is in opts.allow).
 */
export async function http(tool, url, { method = 'GET', headers = {}, body, form, timeout = 8000, tls, allow = [] } = {}) {
  const h = { accept: 'application/json', ...headers };
  let payload = body;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h['content-type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined && typeof body !== 'string') {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }

  let res;
  try {
    res = await request(url, {
      method, headers: h, body: payload,
      dispatcher: agentFor(tls),
      headersTimeout: timeout, bodyTimeout: timeout,
    });
  } catch (err) {
    throw new UpstreamError(tool, null, `unreachable (${err.code || err.message})`);
  }

  const text = await res.body.text();
  let data = text;
  if (text && (res.headers['content-type'] || '').includes('json')) {
    try { data = JSON.parse(text); } catch { /* keep text */ }
  }

  const ok = res.statusCode >= 200 && res.statusCode < 300;
  if (!ok && !allow.includes(res.statusCode)) {
    // surface the tool's own message (ArgoCD, GitHub, K8s all send one) — it is what you need to debug
    const upstream = typeof data === 'object' && data ? (data.message || data.error || data.reason) : null;
    let msg = res.statusCode === 401 ? 'authentication failed'
      : res.statusCode === 403 ? 'permission denied'
      : res.statusCode === 404 ? 'not found'
      : `HTTP ${res.statusCode}`;
    if (upstream && typeof upstream === 'string') msg += ` — ${upstream.slice(0, 200)}`;
    throw new UpstreamError(tool, res.statusCode, msg, text);
  }
  return { status: res.statusCode, headers: res.headers, data };
}

/** TLS options of an integration (self-signed / private CA is common for internal tools) */
export const tlsOf = (conn) => (conn?.tls && (conn.tls.ca || conn.tls.insecure) ? conn.tls : undefined);

export const basic = (user, token) => 'Basic ' + Buffer.from(`${user || ''}:${token || ''}`).toString('base64');
export const bearer = (token) => `Bearer ${token}`;

// Time a test call and normalise the result for the UI status strip
export async function probe(tool, fn) {
  const t0 = Date.now();
  try {
    const message = await fn();
    return { tool, ok: true, message, latency_ms: Date.now() - t0 };
  } catch (err) {
    return { tool, ok: false, message: err.message, latency_ms: Date.now() - t0 };
  }
}
