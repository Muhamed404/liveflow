// Tiny TTL cache + in-flight de-duplication.
// Many interviewers polling the same app/env => one upstream call per TTL window.
const store = new Map();

export async function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && (hit.pending || hit.expires > now)) return hit.pending || hit.value;

  const pending = Promise.resolve().then(fn);
  const entry = { pending };
  store.set(key, entry);
  try {
    const value = await pending;
    // invalidate() may have run while we waited (e.g. right after a sync): don't put the old answer back
    if (store.get(key) === entry) store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  } catch (err) {
    if (store.get(key) === entry) store.delete(key);
    throw err;
  }
}

export function invalidate(prefix) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
