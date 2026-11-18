// Who is looking at what — in memory, 30s TTL. Real identity comes with auth (phase 5).
const TTL = 30_000;
const viewers = new Map(); // user -> { user, app, env, page, seen }

export const presence = {
  beat({ user, app, env, page }) {
    viewers.set(user, { user, app: app || null, env: env || null, page: page || null, seen: Date.now() });
  },
  list({ app, env } = {}) {
    const now = Date.now();
    for (const [k, v] of viewers) if (now - v.seen > TTL) viewers.delete(k);
    return [...viewers.values()]
      .filter((v) => (!app || v.app === app) && (!env || v.env === env))
      .map(({ seen, ...v }) => ({ ...v, last_seen: new Date(seen).toISOString() }));
  },
};
