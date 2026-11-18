import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, envPath } from './client.js';

// Polling intervals: the backend caches 2–5s, so polling faster buys nothing.
export const useApps = () => useQuery({ queryKey: ['apps'], queryFn: () => api('/apps'), refetchInterval: 30_000 });

export const useOverview = (app, env) => useQuery({
  queryKey: ['overview', app, env], queryFn: () => api(`${envPath(app, env)}/overview`),
  enabled: Boolean(app && env), refetchInterval: 3000,
});

export const useEvents = (app, env) => useQuery({
  queryKey: ['events', app, env], queryFn: () => api(`${envPath(app, env)}/events?limit=40`),
  enabled: Boolean(app && env), refetchInterval: 5000,
});

export const useMetric = (app, env, metric, minutes, enabled = true) => useQuery({
  queryKey: ['metric', app, env, metric, minutes],
  queryFn: () => api(`${envPath(app, env)}/metrics/${metric}?minutes=${minutes}`),
  enabled: Boolean(app && env && enabled), refetchInterval: 10_000,
});

export const useLogs = (app, env, contains, enabled = true) => useQuery({
  queryKey: ['logs', app, env, contains],
  queryFn: () => api(`${envPath(app, env)}/logs?limit=100${contains ? `&contains=${encodeURIComponent(contains)}` : ''}`),
  enabled: Boolean(app && env && enabled), refetchInterval: 5000,
});

/** Heartbeat and "who's watching" in one call */
export const usePresence = (app, env, page) => useQuery({
  queryKey: ['presence', app, env, page],
  queryFn: () => api('/presence', { method: 'POST', body: { app, env, page } }),
  enabled: Boolean(app), refetchInterval: 10_000,
});

/** Any env action; refreshes overview + events as soon as it lands */
export function useEnvAction(app, env, path, method = 'POST') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api(`${envPath(app, env)}${path}`, { method, body }),
    // everything about this env may have changed: overview, timeline, releases, runs
    onSettled: () => ['overview', 'events', 'releases', 'builds', 'build']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k, app, env] })),
  });
}

// ---------- auth ----------
export const useMe = () => useQuery({
  queryKey: ['me'],
  queryFn: async () => {
    try { return await api('/auth/me'); } catch (e) { if (e.status === 401) return { user: null }; throw e; }
  },
  staleTime: 60_000, refetchInterval: 60_000,
});

/** Generic mutation that refreshes the given query keys afterwards */
export function useApiMutation(request, invalidate = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () => invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key })),
  });
}

// ---------- runs ----------
export const useBuilds = (app, env) => useQuery({
  queryKey: ['builds', app, env], queryFn: () => api(`${envPath(app, env)}/builds?limit=15`), enabled: Boolean(app && env), refetchInterval: 5000,
});
export const useBuild = (app, env, n) => useQuery({
  queryKey: ['build', app, env, n], queryFn: () => api(`${envPath(app, env)}/builds/${n}`), enabled: Boolean(app && env && n),
  refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 2500 : false),
});

// ---------- releases / stress ----------
export const useReleases = (app, env, enabled = true) => useQuery({
  queryKey: ['releases', app, env], queryFn: () => api(`${envPath(app, env)}/releases`), enabled: Boolean(app && env && enabled), refetchInterval: 10_000,
});

// ---------- settings ----------
export const useClusters = () => useQuery({ queryKey: ['clusters'], queryFn: () => api('/clusters') });
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => api('/integrations') });
export const useEnvConfig = (app, env) => useQuery({
  queryKey: ['envconfig', app, env],
  queryFn: async () => { try { return await api(`/apps/${app}/environments/${env}`); } catch (e) { if (e.status === 404) return null; throw e; } },
  enabled: Boolean(app && env),
});
export const useUsers = (enabled) => useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled });
