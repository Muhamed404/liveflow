import { Brand } from './Logo.jsx';
import { AppBackdrop } from './AppBackdrop.jsx';
import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Pill } from './ui.jsx';
import { useQueryClient } from '@tanstack/react-query';
import { usePresence } from '../api/hooks.js';
import { getUser, setUser } from '../api/client.js';
import { useAuth, signOut } from '../auth.jsx';

const ENVS = ['dev', 'staging', 'prod'];
const initials = (n) => n.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

function Viewers({ app, env, page }) {
  const q = usePresence(app, env, page);
  const list = q.data || [];
  if (!list.length) return null;
  return (
    <div className="viewers" aria-label={`${list.length} watching: ${list.map((v) => v.user).join(', ')}`}>
      <span className="viewers__faces">{list.slice(0, 4).map((v) => <span key={v.user} className="viewer" title={`${v.user} · ${v.env || ''} ${v.page || ''}`}>{initials(v.user)}</span>)}</span>
      <span className="viewers__count">{list.length} watching</span>
    </div>
  );
}

function NamePrompt({ onDone }) {
  const [name, setName] = useState('');
  return (
    <div className="dialog-backdrop">
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="name-title"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) { setUser(name.trim()); onDone(); } }}>
        <h2 id="name-title">Who’s at the controls?</h2>
        <p className="hint">Your name shows next to the actions you take and in “watching”.</p>
        <label htmlFor="who" className="sr-only">Your name</label>
        <input id="who" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mohamed" />
        <button type="submit" className="btn btn--primary" disabled={!name.trim()}>Continue</button>
      </form>
    </div>
  );
}

/** chips = small live status pills taken from the overview (optional) */
export function Shell({ apps, appId, env, page, chips, children }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, mode } = useAuth();
  const [askName, setAskName] = useState(mode === 'off' && !getUser());
  const app = apps.find((a) => a.id === appId);
  const envs = app?.environments?.map((e) => e.name) || [];
  const base = appId && env ? `/${appId}/${env}` : null;
  const settings = page === 'settings';

  return (
    <div className="shell" data-env={settings ? 'none' : env}>
      <AppBackdrop />
      <div className="shell__stripe" />
      <header className="topbar">
        <Link to="/" className="brand"><Brand /></Link>
        <nav aria-label="Main" className="mainnav">
          {base ? <NavLink end to={base}>Flow</NavLink> : <NavLink end to="/">Flow</NavLink>}
          {base && <NavLink to={`${base}/runs`}>Runs</NavLink>}
          {base && <NavLink to={`${base}/releases`}>Releases</NavLink>}
          {base && <NavLink to={`${base}/stress`}>Stress</NavLink>}
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="topbar__right">
          <Viewers app={appId} env={env} page={page} />
          {mode === 'off' ? (
            <button type="button" className="you" onClick={() => setAskName(true)} title="Change name">{getUser() || 'Set name'}</button>
          ) : (
            <span className="you-menu">
              <span className="you-menu__who">{user.display_name || user.username}<span className="you-menu__role">{user.role}</span></span>
              <button type="button" className="btn btn--quiet" onClick={() => signOut(qc)}>Sign out</button>
            </span>
          )}
        </div>
      </header>

      {!settings && app && (
        <div className="contextbar">
          <label htmlFor="app-select" className="sr-only">App</label>
          <select id="app-select" className="select mono" value={appId}
            onChange={(e) => {
              const next = apps.find((a) => a.id === e.target.value);
              const nextEnv = next.environments.find((x) => x.name === env)?.name || next.environments[0]?.name;
              navigate(nextEnv ? `/${next.id}/${nextEnv}` : '/settings');
            }}>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
          <div role="group" aria-label="Environment" className="envtabs">
            {ENVS.filter((e) => envs.includes(e)).map((e) => (
              <NavLink key={e} to={`/${appId}/${e}${page && page !== 'flow' ? `/${page}` : ''}`} className={`envtab envtab--${e}`}
                aria-current={e === env ? 'true' : undefined}>
                <span className="envdot" />{e}
              </NavLink>
            ))}
          </div>
          <div className="contextbar__chips">{chips}</div>
        </div>
      )}

      <main className="page">{children}</main>
      {askName && <NamePrompt onDone={() => setAskName(false)} />}
    </div>
  );
}

export { Pill };
