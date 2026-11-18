const USER_KEY = 'liveflow.user';
let memoryUser = '';

export function getUser() {
  try { return localStorage.getItem(USER_KEY) || memoryUser; } catch { return memoryUser; }
}
export function setUser(name) {
  memoryUser = name;
  try { localStorage.setItem(USER_KEY, name); } catch { /* private mode: memory only */ }
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || (status ? `Request failed (HTTP ${status})` : 'Can’t reach the backend. Is it running on :4000?'));
    this.status = status;
    this.details = body?.details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      // x-user only matters when the backend runs with AUTH_MODE=off (demo); otherwise the session cookie wins
      headers: { 'content-type': 'application/json', 'x-user': getUser() || 'anonymous' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, null);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const envPath = (app, env) => `/apps/${encodeURIComponent(app)}/environments/${env}`;
