import { Brand } from './components/Logo.jsx';
import { LoginStory } from './components/LoginStory.jsx';
import { LoginBackdrop } from './components/LoginBackdrop.jsx';
import { createContext, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api/client.js';
import { useMe } from './api/hooks.js';

const AuthContext = createContext({ user: null, mode: 'off', role: 'admin' });
export const useAuth = () => useContext(AuthContext);
const RANK = { viewer: 0, operator: 1, admin: 2 };
export const can = (user, min) => Boolean(user) && RANK[user.role] >= RANK[min];

function LoginPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: form });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }
  return (
    <main className="login">
      <LoginBackdrop />
      <LoginStory />

      <section className="login__panel">
        <form className="login__card" onSubmit={submit} aria-labelledby="login-title">
          <span className="brand login__brand"><Brand /></span>
          <div className="login__intro">
            <h1 id="login-title" className="login__title">Sign in</h1>
            <p className="login__lead">Use the account your administrator gave you.</p>
          </div>
          <label className="field">
            <span className="field__label">Username</span>
            <input className="input login__input" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input login__input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          {error && <p className="login__error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary login__submit" disabled={busy || !form.username || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="login__help">Forgot your password? An admin can set a new one in Settings → Users.</p>
        </form>
        <footer className="login__legal"><span>Liveflow</span><span>Sessions end after 12 hours</span></footer>
      </section>
    </main>
  );
}

/** Renders children once signed in; shows the login page on 401. AUTH_MODE=off skips it. */
export function AuthGate({ children }) {
  const q = useMe();
  if (q.isLoading) return <div className="boot">Loading…</div>;
  if (q.isError) return <main className="page"><div className="section-error" role="alert"><strong>Can’t reach the backend.</strong> {q.error.message}</div></main>;
  if (!q.data.user) return <LoginPage />;
  return <AuthContext.Provider value={{ user: q.data.user, mode: q.data.auth_mode }}>{children}</AuthContext.Provider>;
}

export async function signOut(qc) {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  qc.clear();
  window.location.assign('/');
}
