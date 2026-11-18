import { Routes, Route, Navigate, useParams, Link } from 'react-router-dom';
import { useApps, useOverview } from './api/hooks.js';
import { Shell } from './components/Shell.jsx';
import { Pill, SectionError } from './components/ui.jsx';
import { FlowPage } from './pages/FlowPage.jsx';
import { RunsPage } from './pages/RunsPage.jsx';
import { ReleasesPage } from './pages/ReleasesPage.jsx';
import { StressPage } from './pages/StressPage.jsx';
import { SettingsPage } from './pages/settings/SettingsPage.jsx';

const TONE = { done: 'ok', active: 'info', gate: 'warn', fail: 'bad', idle: 'dim', unknown: 'bad' };

/** Live status pills in the context bar, from the same overview query the page uses */
function Chips({ appId, env }) {
  const q = useOverview(appId, env);
  if (!q.data) return null;
  return q.data.path.stations
    .filter((s) => s.id === 'jenkins' || s.id === 'argocd')
    .map((s) => <Pill key={s.id} tone={TONE[s.state]}>{s.name}: {s.status}</Pill>);
}

function EnvRoute({ apps, page, children }) {
  const { appId, env } = useParams();
  const app = apps.find((a) => a.id === appId);
  if (!app) return <Navigate to="/" replace />;
  if (!app.environments.some((e) => e.name === env)) {
    const first = app.environments[0]?.name;
    return <Navigate to={first ? `/${appId}/${first}` : '/settings'} replace />;
  }
  return <Shell apps={apps} appId={appId} env={env} page={page} chips={<Chips appId={appId} env={env} />}>{children}</Shell>;
}

function Home({ apps }) {
  const first = apps.find((a) => a.environments.length);
  if (first) {
    const env = ['staging', 'dev', 'prod'].find((e) => first.environments.some((x) => x.name === e));
    return <Navigate to={`/${first.id}/${env}`} replace />;
  }
  return (
    <Shell apps={apps} page="settings">
      <section className="panel placeholder">
        <h1 className="hero__title">Add your first app</h1>
        <p className="hero__sub">Connect a cluster and your tools, then add an app with at least one environment.</p>
        <Link className="btn btn--primary" to="/settings">Open settings</Link>
      </section>
    </Shell>
  );
}

export function App() {
  const q = useApps();
  if (q.isLoading) return <div className="boot">Loading…</div>;
  if (q.isError) return <main className="page"><SectionError what="apps" error={q.error.message} /></main>;
  const apps = q.data;
  return (
    <Routes>
      <Route path="/" element={<Home apps={apps} />} />
      <Route path="/settings/*" element={<Shell apps={apps} page="settings"><SettingsPage apps={apps} /></Shell>} />
      <Route path="/:appId/:env" element={<EnvRoute apps={apps} page="flow"><FlowPage /></EnvRoute>} />
      <Route path="/:appId/:env/runs" element={<EnvRoute apps={apps} page="runs"><RunsPage /></EnvRoute>} />
      <Route path="/:appId/:env/releases" element={<EnvRoute apps={apps} page="releases"><ReleasesPage /></EnvRoute>} />
      <Route path="/:appId/:env/stress" element={<EnvRoute apps={apps} page="stress"><StressPage /></EnvRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
