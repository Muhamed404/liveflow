import { useState } from 'react';
import { NavLink, Routes, Route, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useClusters, useIntegrations, useApiMutation, useUsers } from '../../api/hooks.js';
import { useAuth, can } from '../../auth.jsx';
import { Panel, Button, SectionError, Pill } from '../../components/ui.jsx';
import { Text, Pick, Secret, Check, Area, ConfirmDialog } from '../../components/forms.jsx';
import { EnvForm } from './EnvForm.jsx';
import { describeError } from '../../lib/errors.js';

const ENVS = ['dev', 'staging', 'prod'];
const TYPES = [
  { value: 'jenkins', label: 'Jenkins', user: true, token: 'API token', hint: 'User → Configure → API Token. Needs Job/Read, Build, Cancel.' },
  { value: 'github', label: 'GitHub', token: 'Personal access token', hint: 'repo scope with push access. Base URL https://api.github.com or https://<ghe>/api/v3' },
  { value: 'argocd', label: 'ArgoCD', token: 'API token', hint: 'argocd account generate-token --account liveflow' },
  { value: 'prometheus', label: 'Prometheus', user: true, token: 'Password or bearer token', tenant: true, hint: 'Leave auth empty if Prometheus is open inside the network.' },
  { value: 'loki', label: 'Loki', user: true, token: 'Password or bearer token', tenant: true, hint: 'Tenant = X-Scope-OrgID for multi-tenant Loki.' },
  { value: 'grafana', label: 'Grafana', token: 'Service account token', hint: 'Viewer role. Grafana needs allow_embedding = true.' },
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const tabs = [{ to: '/settings', label: 'Apps & environments', end: true }, { to: '/settings/connections', label: 'Clusters & integrations' }, { to: '/settings/users', label: 'Users', admin: true }];

// ---------------- apps & environments ----------------
function AddApp({ integrations, onCreated }) {
  const [f, setF] = useState({ name: '', github_integration_id: null, github_repo: '' });
  const create = useApiMutation((body) => api('/apps', { method: 'POST', body }), [['apps']]);
  return (
    <form className="addapp" onSubmit={(e) => { e.preventDefault(); create.mutate({ id: slug(f.name), name: f.name, github_integration_id: f.github_integration_id, github_repo: f.github_repo || null }, { onSuccess: (a) => { setF({ name: '', github_integration_id: null, github_repo: '' }); onCreated(a.id); } }); }}>
      <Text id="new-app" label="New app" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Retail Store" hint={f.name ? `id: ${slug(f.name)}` : null} />
      <Pick id="new-app-gh" label="GitHub" value={f.github_integration_id} onChange={(v) => setF({ ...f, github_integration_id: v })} options={integrations.filter((i) => i.type === 'github').map((i) => ({ value: i.id, label: i.name }))} />
      <Text id="new-app-repo" label="Repository" mono value={f.github_repo} onChange={(v) => setF({ ...f, github_repo: v })} placeholder="owner/repo" />
      {create.isError && <p className="hint tone-bad" role="alert">{create.error.message}</p>}
      <Button kind="primary" disabled={!slug(f.name) || create.isPending} onClick={() => {}} type="submit">Add app</Button>
    </form>
  );
}

function AppsTab({ apps, admin }) {
  const [params, setParams] = useSearchParams();
  const clusters = useClusters(); const integrations = useIntegrations();
  const app = params.get('app') || apps[0]?.id;
  const env = params.get('env') || apps.find((a) => a.id === app)?.environments[0]?.name || 'staging';
  if (clusters.isError || integrations.isError) return <SectionError what="settings" error={(clusters.error || integrations.error).message} />;
  if (!clusters.data || !integrations.data) return <div className="skeleton" style={{ height: 400 }} />;
  return (
    <div className="split">
      <div className="split__side split__side--narrow">
        <Panel title="Apps" icon="box">
          {apps.length === 0 && <p className="empty">No apps yet.</p>}
          {apps.map((a) => (
            <div key={a.id} className="appblock">
              <div className="appblock__name mono">{a.id}</div>
              {ENVS.map((e) => {
                const has = a.environments.some((x) => x.name === e);
                return (
                  <button key={e} type="button" className={`envlink envtab--${e}`} aria-current={a.id === app && e === env ? 'true' : undefined}
                    onClick={() => setParams({ app: a.id, env: e })}>
                    <span className="envdot" />{e}{!has && <span className="envlink__missing">not set</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {admin && <AddApp integrations={integrations.data} onCreated={(id) => setParams({ app: id, env: 'dev' })} />}
        </Panel>
      </div>
      <div className="split__main">
        {app ? <EnvForm key={`${app}-${env}`} app={app} env={env} integrations={integrations.data} clusters={clusters.data} readOnly={!admin} />
          : <Panel title="Environment"><p className="empty">Add an app to configure its environments.</p></Panel>}
      </div>
    </div>
  );
}

// ---------------- clusters & integrations ----------------
function ConnectionForm({ kind, item, onDone }) {
  const isCluster = kind === 'cluster';
  const [f, setF] = useState(item ? { ...item, token: '' } : { type: 'jenkins', name: '', base_url: '', api_url: '', username: '', token: '', ca_cert: '', insecure_skip_tls: false, tenant_id: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const type = TYPES.find((t) => t.value === f.type) || TYPES[0];
  const path = isCluster ? '/clusters' : '/integrations';
  const save = useApiMutation((body) => api(item ? `${path}/${item.id}` : path, { method: item ? 'PUT' : 'POST', body }), [['clusters'], ['integrations']]);
  function submit(e) {
    e.preventDefault();
    const body = isCluster
      ? { name: f.name, api_url: f.api_url, insecure_skip_tls: f.insecure_skip_tls }
      : { name: f.name, base_url: f.base_url, username: type.user ? f.username || null : null, insecure_skip_tls: f.insecure_skip_tls, tenant_id: type.tenant ? f.tenant_id || null : null };
    if (f.token) body.token = f.token;          // empty = keep the saved one
    if (f.ca_cert) body.ca_cert = f.ca_cert;
    if (!item) { body.id = slug(f.name); if (!isCluster) body.type = f.type; }
    save.mutate(body, { onSuccess: onDone });
  }
  return (
    <form className="panel" onSubmit={submit} aria-labelledby="conn-title">
      <div className="panel__head"><h2 id="conn-title" className="panel__title">{item ? `Edit ${item.id}` : isCluster ? 'Add cluster' : 'Add integration'}</h2>
        <button type="button" className="btn btn--quiet" onClick={onDone}>Close</button></div>
      {!isCluster && !item && <Pick id="c-type" label="Tool" value={f.type} onChange={(v) => set('type')(v || 'jenkins')} options={TYPES} empty="Choose" />}
      <Text id="c-name" label="Name" value={f.name} onChange={set('name')} hint={!item && f.name ? `id: ${slug(f.name)}` : null} />
      {isCluster
        ? <Text id="c-url" label="API server URL" mono value={f.api_url} onChange={set('api_url')} placeholder="https://k8s-stg.internal:6443" />
        : <Text id="c-url" label="Base URL" mono value={f.base_url} onChange={set('base_url')} placeholder={f.type === 'github' ? 'https://api.github.com' : 'https://…'} />}
      {!isCluster && type.user && <Text id="c-user" label="Username" value={f.username} onChange={set('username')} />}
      <Secret id="c-token" label={isCluster ? 'ServiceAccount token' : type.token} has={item?.has_token} value={f.token} onChange={set('token')}
        hint={isCluster ? 'Read-only SA: pods, events, deployments, HPA (autoscaling/v2).' : type.hint} />
      {!isCluster && type.tenant && <Text id="c-tenant" label="Tenant (optional)" mono value={f.tenant_id} onChange={set('tenant_id')} />}
      <Area id="c-ca" label="CA certificate (optional)" mono rows={3} value={f.ca_cert} onChange={set('ca_cert')}
        placeholder={item?.has_ca_cert ? 'Saved. Paste a new PEM to replace it' : '-----BEGIN CERTIFICATE-----'} hint="For private or self-signed certificates." />
      <Check id="c-insecure" label="Skip TLS verification" checked={f.insecure_skip_tls} onChange={set('insecure_skip_tls')} hint="Lab use only. Prefer pasting the CA." />
      {save.isError && <SectionError what="save the connection" verb="Couldn’t" error={describeError(save.error)} />}
      <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

function ConnRow({ kind, item, admin, operator, onEdit }) {
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const path = kind === 'cluster' ? `/clusters/${item.id}` : `/integrations/${item.id}`;
  const remove = useApiMutation(() => api(path, { method: 'DELETE' }), [['clusters'], ['integrations']]);
  async function test() {
    setTesting(true);
    try { setResult(await api(`${path}/test`, { method: 'POST', body: {} })); } catch (e) { setResult({ ok: false, message: e.message }); }
    finally { setTesting(false); }
  }
  return (
    <tr>
      <td><span className="typetag">{kind === 'cluster' ? 'k8s' : item.type}</span></td>
      <td className="mono strong">{item.id}</td>
      <td className="mono muted wrap">{item.api_url || item.base_url}</td>
      <td className="muted">{[item.username, item.has_token ? 'token set' : 'no token', item.tenant_id && `tenant ${item.tenant_id}`, item.has_ca_cert && 'CA', item.insecure_skip_tls && 'TLS not verified'].filter(Boolean).join(', ')}</td>
      <td>{result ? <span className={result.ok ? 'tone-ok' : 'tone-bad'}>{result.message}</span> : <span className="hint">not tested</span>}</td>
      <td><div className="cellactions">
        {operator && <Button icon="plug" disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test'}</Button>}
        {admin && <Button onClick={() => onEdit(item)}>Edit</Button>}
        {admin && <Button kind="danger" aria-label={`Delete ${item.id}`} onClick={() => { remove.reset(); setRemoving(true); }}>Delete</Button>}
        {removing && (
          <ConfirmDialog title={`Delete ${item.id}?`} confirmLabel="Delete" tone="danger" busy={remove.isPending} error={remove.error?.message}
            onCancel={() => setRemoving(false)} onConfirm={() => remove.mutate(undefined, { onSuccess: () => setRemoving(false) })}>
            <p>{kind === 'cluster' ? 'Environments using this cluster block the delete.' : 'Environments using it lose this tool until you pick another.'}</p>
          </ConfirmDialog>
        )}
      </div></td>
    </tr>
  );
}

function ConnectionsTab({ admin, operator }) {
  const clusters = useClusters(); const integrations = useIntegrations();
  const [editing, setEditing] = useState(null); // { kind, item }
  if (clusters.isError || integrations.isError) return <SectionError what="connections" error={(clusters.error || integrations.error).message} />;
  if (!clusters.data || !integrations.data) return <div className="skeleton" style={{ height: 400 }} />;
  const table = (kind, rows) => (
    <div className="tablewrap"><table className="table">
      <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">URL</th><th scope="col">Auth</th><th scope="col">Last test</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{rows.map((r) => <ConnRow key={r.id} kind={kind} item={r} admin={admin} operator={operator} onEdit={(item) => setEditing({ kind, item })} />)}</tbody>
    </table></div>
  );
  return (
    <div className="split">
      <div className="split__main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Panel title="Kubernetes clusters" icon="cluster" actions={admin && <Button onClick={() => setEditing({ kind: 'cluster' })}>Add cluster</Button>}>
          {clusters.data.length ? table('cluster', clusters.data) : <p className="empty">No clusters yet. Add staging and prod clusters to deploy with ArgoCD.</p>}
        </Panel>
        <Panel title="Integrations" icon="plug" sub="Add each tool once and reuse it in any environment." actions={admin && <Button onClick={() => setEditing({ kind: 'integration' })}>Add integration</Button>}>
          {integrations.data.length ? table('integration', integrations.data) : <p className="empty">No tools yet. Start with Jenkins and Prometheus.</p>}
        </Panel>
      </div>
      {editing && <div className="split__side split__side--narrow"><ConnectionForm key={editing.item?.id || editing.kind} kind={editing.kind} item={editing.item} onDone={() => setEditing(null)} /></div>}
    </div>
  );
}

// ---------------- users ----------------
function UsersTab() {
  const q = useUsers(true);
  const { user: me } = useAuth();
  const [f, setF] = useState({ username: '', display_name: '', role: 'operator', password: '' });
  const [pw, setPw] = useState({});
  const inv = [['users']];
  const create = useApiMutation((body) => api('/users', { method: 'POST', body }), inv);
  const update = useApiMutation(({ id, ...body }) => api(`/users/${id}`, { method: 'PUT', body }), inv);
  const remove = useApiMutation((id) => api(`/users/${id}`, { method: 'DELETE' }), inv);
  if (q.isError) return <SectionError what="users" error={q.error.message} />;
  if (!q.data) return <div className="skeleton" style={{ height: 300 }} />;
  const err = create.error || update.error || remove.error;
  return (
    <div className="split">
      <div className="split__main">
        <Panel title="Users" icon="grid" sub="viewer: watch · operator: run pipelines, releases, sync, stress · admin: settings and users">
          {err && <SectionError what="the change" error={err.message} />}
          <div className="tablewrap"><table className="table">
            <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col">New password</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{q.data.map((u) => (
              <tr key={u.id}>
                <td><span className="strong">{u.display_name || u.username}</span> <span className="mono muted">{u.username}</span>{u.id === me.id && <Pill tone="info">you</Pill>}</td>
                <td><label className="sr-only" htmlFor={`role-${u.id}`}>Role of {u.username}</label>
                  <select id={`role-${u.id}`} className="input" value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}>
                    {['viewer', 'operator', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></td>
                <td className="muted">{u.last_login_at ? new Date(`${u.last_login_at}Z`).toLocaleString() : 'never'}</td>
                <td><label className="sr-only" htmlFor={`pw-${u.id}`}>New password for {u.username}</label>
                  <input id={`pw-${u.id}`} type="password" className="input" autoComplete="new-password" placeholder="min 10 characters" value={pw[u.id] || ''} onChange={(e) => setPw({ ...pw, [u.id]: e.target.value })} /></td>
                <td><div className="cellactions">
                  <Button disabled={(pw[u.id] || '').length < 10} onClick={() => update.mutate({ id: u.id, password: pw[u.id] }, { onSuccess: () => setPw({ ...pw, [u.id]: '' }) })}>Set password</Button>
                  {u.id !== me.id && <Button kind="danger" onClick={() => remove.mutate(u.id)}>Remove</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      </div>
      <div className="split__side split__side--narrow">
        <form className="panel" onSubmit={(e) => { e.preventDefault(); create.mutate({ ...f, display_name: f.display_name || null }, { onSuccess: () => setF({ username: '', display_name: '', role: 'operator', password: '' }) }); }}>
          <h2 className="panel__title">Add user</h2>
          <Text id="u-name" label="Username" value={f.username} onChange={(v) => setF({ ...f, username: v })} autoComplete="off" />
          <Text id="u-display" label="Display name" value={f.display_name} onChange={(v) => setF({ ...f, display_name: v })} />
          <Pick id="u-role" label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v || 'viewer' })} options={['viewer', 'operator', 'admin'].map((r) => ({ value: r, label: r }))} empty="Choose" />
          <Text id="u-pw" label="Password" type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} hint="At least 10 characters" autoComplete="new-password" />
          <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={!f.username || f.password.length < 10 || create.isPending}>Add user</button></div>
        </form>
      </div>
    </div>
  );
}

export function SettingsPage({ apps }) {
  const { user, mode } = useAuth();
  const admin = mode === 'off' || can(user, 'admin');
  const operator = mode === 'off' || can(user, 'operator');
  return (
    <>
      <div className="settings-head">
        <h1 className="hero__title">Settings</h1>
        <nav aria-label="Settings sections" className="subtabs">
          {tabs.filter((t) => !t.admin || (admin && mode !== 'off')).map((t) => <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
        </nav>
      </div>
      <Routes>
        <Route index element={<AppsTab apps={apps} admin={admin} />} />
        <Route path="connections" element={<ConnectionsTab admin={admin} operator={operator} />} />
        <Route path="users" element={admin && mode !== 'off' ? <UsersTab /> : <p className="notice">Only admins manage users.</p>} />
      </Routes>
    </>
  );
}
