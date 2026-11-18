import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useReleases, useOverview, useEnvAction } from '../api/hooks.js';
import { Panel, Button, SectionError, Pill } from '../components/ui.jsx';
import { GatePanel } from '../components/FlowParts.jsx';
import { Text, Area, ConfirmDialog } from '../components/forms.jsx';

const STATE = {
  live: { tone: 'ok', text: 'Live' },
  waiting: { tone: 'warn', text: 'Built, waiting at the gate' },
  building: { tone: 'info', text: 'Building' },
  previous: { tone: 'dim', text: 'Previous' },
};
const SEMVER = /^v\d+\.\d+\.\d+$/;

function NewRelease({ app, env, data, can }) {
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const release = useEnvAction(app, env, '/releases');
  const v = version || data.suggested_next;
  const invalid = !SEMVER.test(v) ? 'Use the form vX.Y.Z' : null;
  return (
    <Panel title="New release" icon="rocket" sub="Tags the branch on GitHub and runs the prod job. Production changes only after Sync.">
      <Text id="rel-version" label="Version" mono value={v} onChange={setVersion} error={version && invalid}
        hint={`Latest is ${data.latest_tag || 'none'}. Must be newer.`} />
      <Area id="rel-notes" label="Release notes (optional)" hint="Left empty, GitHub writes them from the commits." value={notes} onChange={setNotes} />
      <div className="form-actions">
        {!can.allowed && <span className="hint">{can.reason}</span>}
        <Button kind="primary" icon="tag" disabled={!can.allowed || Boolean(invalid)} onClick={() => { release.reset(); setConfirming(true); }}>Create release</Button>
      </div>
      {confirming && (
        <ConfirmDialog title={`Create release ${v}?`} confirmLabel="Create release" confirmWord={env === 'prod' ? env : null}
          busy={release.isPending} error={release.error?.message} onCancel={() => setConfirming(false)}
          onConfirm={() => release.mutate({ version: v, notes: notes || undefined, confirm: true }, {
            onSuccess: () => { setConfirming(false); setVersion(''); setNotes(''); },
          })}>
          <dl>
            <dt>Tag</dt><dd className="mono">{v}</dd>
            <dt>Jenkins</dt><dd className="mono">VERSION={v} ACTION=release</dd>
            <dt>Then</dt><dd>ArgoCD waits for Sync on the Flow page.</dd>
          </dl>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

export function ReleasesPage() {
  const { appId, env } = useParams();
  const overview = useOverview(appId, env);
  const q = useReleases(appId, env, overview.data?.features?.release !== false || env === 'prod');
  const rollback = useEnvAction(appId, env, '/rollback');
  const [target, setTarget] = useState(null);

  if (overview.data && !overview.data.features.release) {
    return (
      <section className="panel placeholder">
        <h1 className="hero__title">Releases are for production</h1>
        <p className="hero__sub">{env} deploys straight from its branch. Versioned releases, rollbacks and the sync gate live on prod.</p>
        <Link className="btn" to={`/${appId}/prod/releases`}>Open prod releases</Link>
      </section>
    );
  }
  if (q.isError) return <SectionError what="releases" error={q.error.message} />;
  if (q.isLoading || !overview.data) return <div className="skeleton skeleton--hero" />;
  const d = q.data;
  const canRelease = overview.data.can.release;

  return (
    <>
      <section className="hero" aria-labelledby="rel-title">
        <div className="hero__copy">
          <p className="hero__kicker">Releases</p>
          <h1 id="rel-title" className="hero__title">
            {d.pending_version ? `${d.pending_version} is waiting at the gate` : `${d.live_version || 'Nothing'} is live`}
          </h1>
          <p className="hero__sub">Live: <span className="mono">{d.live_version || '—'}</span>. Latest tag: <span className="mono">{d.latest_tag || '—'}</span>.</p>
        </div>
      </section>
      <GatePanel key={`${appId}-${env}-${overview.data.gate?.to_version}`} app={appId} env={env} overview={overview.data} />
      <div className="split">
        <div className="split__main">
          <Panel title="Versions" icon="tag" sub="GitHub tags, newest first">
            {d.releases.length === 0 ? <p className="empty">No tags yet. Create the first release.</p> : (
              <ol className="releases">
                {d.releases.map((r) => (
                  <li key={r.tag} className="release">
                    <span className="release__tag mono">{r.tag}</span>
                    <span className="release__info">
                      <Pill tone={STATE[r.state]?.tone || 'dim'}>{STATE[r.state]?.text || r.state}</Pill>
                      <span className="hint">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
                    </span>
                    {r.can_rollback && (
                      <Button icon="back" disabled={!canRelease.allowed} onClick={() => { rollback.reset(); setTarget(r.tag); }}>Roll back</Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="split__side"><NewRelease app={appId} env={env} data={d} can={canRelease} /></div>
      </div>
      {target && (
        <ConfirmDialog title={`Roll back to ${target}?`} confirmLabel={`Roll back to ${target}`} tone="danger" confirmWord={env === 'prod' ? env : null}
          busy={rollback.isPending} error={rollback.error?.message} onCancel={() => setTarget(null)}
          onConfirm={() => rollback.mutate({ version: target, confirm: true }, { onSuccess: () => setTarget(null) })}>
          <p>Jenkins redeploys the existing <span className="mono">{target}</span> image (no rebuild) and updates the values file. Then Sync it from the gate.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
