import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBuilds, useBuild, useOverview, useEnvAction } from '../api/hooks.js';
import { api, envPath } from '../api/client.js';
import { DeliveryPath } from '../components/DeliveryPath.jsx';
import { Panel, Button, SectionError, Pill } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { duration, clock } from '../lib/format.js';

const STATUS_TONE = { RUNNING: 'info', SUCCESS: 'ok', FAILURE: 'bad', ABORTED: 'dim', UNSTABLE: 'warn' };
const STAGE_TO_STATION = { ok: 'done', running: 'active', failed: 'fail', pending: 'idle' };
const STAGE_ICON = (name) => (/test|lint|scan/i.test(name) ? 'check' : /checkout|git/i.test(name) ? 'git' : /build|push|image|docker/i.test(name) ? 'box'
  : /deploy|compose|helm|values|sync/i.test(name) ? 'tag' : /health|smoke/i.test(name) ? 'cluster' : 'gear');
const label = (s) => ({ RUNNING: 'Running', SUCCESS: 'Passed', FAILURE: 'Failed', ABORTED: 'Aborted', UNSTABLE: 'Unstable' }[s] || s);

/** Jenkinsfile stages drawn as their own path */
function stagePath(stages) {
  const stations = stages.map((s, i) => ({
    id: `stage-${i}`, name: s.name, icon: STAGE_ICON(s.name), state: STAGE_TO_STATION[s.state] || 'idle',
    status: s.state === 'pending' ? 'Next' : s.state === 'running' ? `${duration(s.duration_ms)} so far` : duration(s.duration_ms),
  }));
  const rails = stations.slice(1).map((s) => ({ done: 'done', active: 'active', fail: 'done', idle: 'idle' }[s.state]));
  return { stations, rails };
}

/** Jenkins progressive console: appends chunks while the run is going */
function Console({ app, env, number, running }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef(null);
  useEffect(() => {
    let start = 0, stop = false, timer;
    setText(''); setError('');
    async function pull() {
      try {
        const r = await api(`${envPath(app, env)}/builds/${number}/log?start=${start}`);
        if (stop) return;
        if (r.text) setText((t) => (t + r.text).slice(-400_000)); // keep the tail on huge logs
        start = r.next_start;
        if (r.more) timer = setTimeout(pull, 1500);
      } catch (e) { if (!stop) setError(e.message); }
    }
    pull();
    return () => { stop = true; clearTimeout(timer); };
  }, [app, env, number, running]);
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [text, follow]);
  return (
    <Panel title="Console" icon="term" actions={
      <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow output</label>
    }>
      {error && <SectionError what="the console log" error={error} />}
      <pre ref={box} className="console" tabIndex={0} aria-label={`Console output of run ${number}`}>{text || (error ? '' : 'Waiting for output…')}</pre>
    </Panel>
  );
}

export function RunsPage() {
  const { appId, env } = useParams();
  const [params, setParams] = useSearchParams();
  const builds = useBuilds(appId, env);
  const overview = useOverview(appId, env);
  const run = useEnvAction(appId, env, '/builds');
  const selected = Number(params.get('run')) || builds.data?.[0]?.number || null;
  const build = useBuild(appId, env, selected);

  if (builds.isError) return <SectionError what="runs" error={builds.error.message} />;
  const can = overview.data?.can?.run_pipeline;
  const b = build.data;

  return (
    <>
      <section className="hero" aria-labelledby="run-title">
        <div className="hero__head">
          <div className="hero__copy">
            <p className="hero__kicker">Pipeline run</p>
            <h1 id="run-title" className="hero__title">{b ? `Run #${b.number}: ${label(b.status).toLowerCase()}` : builds.isLoading ? 'Loading runs…' : 'No runs yet'}</h1>
            {b && <p className="hero__sub">
              {b.trigger?.text || 'Triggered'}{b.commit ? `, commit ${b.commit.short}${b.commit.branch ? ` on ${b.commit.branch}` : ''}` : ''}.{' '}
              {b.status === 'RUNNING' ? `${duration(b.duration_ms)} so far.` : `Took ${duration(b.duration_ms)}.`}
              {Object.keys(b.params || {}).length > 0 && <> Parameters: <span className="mono">{Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(' ')}</span>.</>}
            </p>}
          </div>
          {env !== 'prod' && can && (
            <div className="hero__action">
              <Button icon="play" disabled={!can.allowed || run.isPending}
                onClick={() => run.mutate({}, { onSuccess: () => setTimeout(() => setParams({}), 1500) })}>Run pipeline</Button>
              {!can.allowed && <span className="hint">{can.reason}</span>}
              {run.isError && <span className="hint tone-bad" role="alert">{run.error.message}</span>}
            </div>
          )}
        </div>
        {b?.stages?.length > 0 && <DeliveryPath path={stagePath(b.stages)} label="Stages of this run" />}
        {b && !b.stages && <p className="hint">Install the Pipeline Stage View plugin on Jenkins to see stages here.</p>}
      </section>

      <div className="split">
        <div className="split__side split__side--narrow">
          <Panel title="Runs" icon="clock" sub={overview.data ? `Jenkins job of ${env}` : ''}>
            {builds.isLoading ? <div className="skeleton" style={{ height: 240 }} /> : builds.data.length === 0 ? (
              <p className="empty">Nothing ran yet. Push to the branch or run the pipeline.</p>
            ) : (
              <ol className="runlist">
                {builds.data.map((r) => (
                  <li key={r.number}>
                    <button type="button" className="runlist__item" aria-current={r.number === selected ? 'true' : undefined}
                      onClick={() => setParams({ run: String(r.number) })}>
                      <span className="mono runlist__n">#{r.number}</span>
                      <Pill tone={STATUS_TONE[r.status] || 'dim'}>{label(r.status)}</Pill>
                      <span className="runlist__meta">{clock(r.started_at)}, {r.status === 'RUNNING' ? `${duration(r.duration_ms)} so far` : duration(r.duration_ms)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="split__main">
          {selected ? <Console app={appId} env={env} number={selected} running={b?.status === 'RUNNING'} />
            : <Panel title="Console" icon="term"><p className="empty"><Icon name="term" /> Pick a run to see its output.</p></Panel>}
        </div>
      </div>
    </>
  );
}
