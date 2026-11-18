import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Button, Segmented, SectionError, Pill } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { SeriesChart } from './Charts.jsx';
import { useEvents, useLogs, useMetric, useEnvAction } from '../api/hooks.js';
import { clock, num, pct, mib } from '../lib/format.js';

// ---------- numbers under the path ----------
function Stat({ label, value, sub, tone, mono }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${mono ? ' mono' : ''}${tone ? ` tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export function StatRow({ overview }) {
  const w = overview.workload.data;
  const m = overview.metrics?.data;
  const hpa = w?.hpa;
  const n = w?.services?.length || 0;
  const multi = n > 1; // several deployments: numbers are totals, HPA belongs to the first (main) service
  const errTone = m?.error_rate == null ? null : m.error_rate > 0.05 ? 'bad' : m.error_rate > 0.01 ? 'warn' : 'ok';
  const versionSub = !w ? overview.workload.error
    : multi ? (w.versions.length > 1 ? `${w.versions.length} versions across ${n} services` : `all ${n} services on this version`)
    : `${w.replicas.on_current_version} of ${w.replicas.desired} on this image`;
  const podsSub = hpa ? `HPA ${hpa.min_replicas}–${hpa.max_replicas}${multi ? ` on ${w.services[0].name}` : ', read from the cluster'}`
    : w?.runtime === 'compose' ? 'from cAdvisor' : 'no HPA';
  const cpuTotal = multi && m?.cpu_cores != null;
  return (
    <div className="statrow">
      <Stat label="Running version" value={w?.version || '—'} mono sub={versionSub} />
      <Stat label={w?.runtime === 'compose' ? 'Containers' : 'Pods'} value={w ? `${w.replicas.ready} / ${w.replicas.desired}` : '—'}
        tone={w && w.replicas.ready < w.replicas.desired ? 'warn' : null} sub={podsSub} />
      <Stat label="CPU" value={cpuTotal ? `${num(m.cpu_cores, 2)} cores` : hpa?.cpu_current_percent != null ? `${hpa.cpu_current_percent}%` : m?.cpu_cores != null ? `${num(m.cpu_cores, 2)} cores` : '—'}
        sub={cpuTotal ? `all ${n} services` : hpa?.cpu_target_percent ? `target ${hpa.cpu_target_percent}%` : m?.memory_bytes != null ? `memory ${mib(m.memory_bytes)}` : null} />
      <Stat label="Requests" value={m?.rps != null ? `${num(m.rps, 1)}/s` : '—'} sub={m?.rps == null ? 'needs http_requests_total' : 'last minute'} />
      <Stat label="Errors" value={pct(m?.error_rate)} tone={errTone} sub="5xx, last minute" />
    </div>
  );
}

// ---------- one row per deployment (only when the environment has more than one) ----------
function serviceState(s) {
  if (s.rolling_out) return { tone: 'info', text: 'Rolling out' };
  if (s.replicas.desired === 0) return { tone: 'bad', text: 'Scaled to 0' };
  if (s.replicas.ready < s.replicas.desired) return { tone: 'warn', text: `${s.replicas.ready} / ${s.replicas.desired} ready` };
  return { tone: 'ok', text: 'Healthy' };
}

export function ServicesPanel({ overview }) {
  const w = overview.workload.data;
  if (!w?.services || w.services.length < 2) return null;
  const main = w.services[0];
  const unit = w.runtime === 'compose' ? 'Containers' : 'Pods';
  return (
    <Panel title="Services" icon="box" sub={`${w.services.length} ${w.runtime === 'compose' ? 'Compose services' : 'deployments'} in this environment, read live.`}>
      <div className="tablewrap">
        <table className="table services">
          <thead><tr><th scope="col">Service</th><th scope="col">Version</th><th scope="col">{unit}</th><th scope="col">HPA</th><th scope="col">State</th></tr></thead>
          <tbody>
            {w.services.map((s, i) => {
              const st = serviceState(s);
              const drift = s.version && main.version && s.version !== main.version;
              return (
                <tr key={s.name}>
                  <td className="mono strong">{s.name}{i === 0 && <span className="services__main">main</span>}</td>
                  <td className={`mono${drift ? ' tone-warn' : ''}`} title={drift ? `differs from ${main.name} (${main.version})` : undefined}>{s.version || '—'}</td>
                  <td className="mono">{s.replicas.ready} / {s.replicas.desired}</td>
                  <td className="mono muted">{s.hpa ? `${s.hpa.min_replicas}–${s.hpa.max_replicas}${s.hpa.cpu_current_percent != null ? ` · CPU ${s.hpa.cpu_current_percent}%` : ''}` : '—'}</td>
                  <td><Pill tone={st.tone}>{st.text}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- prod gate ----------
export function GatePanel({ app, env, overview }) {
  const g = overview.gate;
  const [typed, setTyped] = useState('');
  const sync = useEnvAction(app, env, '/sync');
  if (!g?.waiting) return null;
  const ready = !g.requires_confirm || typed.trim() === env;
  const canSync = overview.can.sync;
  return (
    <section className="gate" aria-labelledby="gate-title">
      <div className="gate__facts">
        <h2 id="gate-title" className="gate__title"><Icon name="lock" size={20} />Open the gate</h2>
        <dl>
          <dt>Change</dt><dd className="mono">{g.from_version || '?'} → {g.to_version || '?'}</dd>
          <dt>Target</dt><dd className="mono">{g.target}</dd>
          <dt>Rollout</dt><dd>Rolling update of {g.pods ?? 'all'} pods, no downtime</dd>
          <dt>Undo</dt><dd>Roll back from Releases if something looks wrong</dd>
        </dl>
      </div>
      <div className="gate__act">
        {g.requires_confirm && (
          <>
            <label htmlFor="gate-confirm">Type <span className="mono tone-warn">{env}</span> to sync</label>
            <input id="gate-confirm" className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </>
        )}
        <Button kind="warn" icon="sync" disabled={!ready || !canSync.allowed || sync.isPending}
          onClick={() => sync.mutate({ confirm: true }, { onSuccess: () => setTyped('') })}>
          {sync.isPending ? 'Syncing…' : `Sync ${g.to_version || ''} to ${env}`}
        </Button>
        {!canSync.allowed && <p className="hint">{canSync.reason}</p>}
        {sync.isError && <p className="hint tone-bad" role="alert">{sync.error.message}</p>}
      </div>
    </section>
  );
}

// ---------- chart ----------
const METRICS = [
  { value: 'rps', label: 'Requests', color: 'var(--blue)', fmt: (v) => `${num(v, 1)}/s` },
  { value: 'cpu_cores', label: 'CPU', color: 'var(--blue)', fmt: (v) => `${num(v, 2)} cores` },
  { value: 'memory_bytes', label: 'Memory', color: 'var(--blue)', fmt: mib },
  { value: 'error_rate', label: 'Errors', color: 'var(--red)', fmt: pct },
];
export function SignalsPanel({ app, env, available }) {
  // only the metrics the backend can query for this env (dev has no rps unless a selector is set)
  const options = METRICS.filter((m) => available?.includes(m.value));
  const hasPrometheus = options.length > 0;
  const [picked, setMetric] = useState('rps');
  const metric = options.some((o) => o.value === picked) ? picked : options[0]?.value;
  const [minutes, setMinutes] = useState(15);
  const q = useMetric(app, env, metric, minutes, hasPrometheus);
  const def = METRICS.find((m) => m.value === metric) || METRICS[0];
  return (
    <Panel title="Signals" icon="chart" sub="Deploys and stress tests are marked on the timeline."
      actions={<>
        {hasPrometheus && <Segmented label="Metric" value={metric} onChange={setMetric} options={options} />}
        <Segmented label="Time range" value={minutes} onChange={setMinutes} mono
          options={[{ value: 15, label: '15m' }, { value: 60, label: '1h' }, { value: 360, label: '6h' }]} />
      </>}>
      {!hasPrometheus ? <p className="empty">Connect Prometheus to this environment in Settings to see charts.</p>
        : q.isError ? <SectionError what={def.label.toLowerCase()} error={q.error.message} />
        : q.isLoading ? <div className="skeleton" style={{ height: 200 }} />
        : <SeriesChart points={q.data.points} markers={q.data.markers} color={def.color} label={def.label} format={def.fmt} />}
    </Panel>
  );
}

// ---------- timeline ----------
export function EventStream({ app, env }) {
  const q = useEvents(app, env);
  return (
    <Panel title="What just happened" icon="clock" sub="Jenkins, ArgoCD, Kubernetes, the HPA and people, on one timeline.">
      {q.isLoading && <div className="skeleton" style={{ height: 220 }} />}
      {q.isError && <SectionError what="the timeline" error={q.error.message} />}
      {q.data && (
        <>
          {q.data.sources_failed.length > 0 && (
            <p className="hint">Missing from the timeline: {q.data.sources_failed.map((s) => s.source).join(', ')}.</p>
          )}
          {q.data.events.length === 0 ? <p className="empty">Nothing yet. Events show up here as soon as something runs.</p> : (
            <ol className="stream">
              {q.data.events.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`stream__row${e.level === 'warn' ? ' is-warn' : ''}`}>
                  <time className="stream__time" dateTime={e.at}>{clock(e.at)}</time>
                  <span className={`stream__src src-${e.source}`}>{e.source}</span>
                  <span className="stream__text">{e.text}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------- logs ----------
export function LogsPanel({ app, env, hasLoki }) {
  const [level, setLevel] = useState('all');
  const [contains, setContains] = useState('');
  const [applied, setApplied] = useState('');
  const q = useLogs(app, env, applied, hasLoki);
  const lines = (q.data || []).filter((l) => level === 'all' || l.level === level);
  return (
    <Panel title="Logs" icon="term" sub="Loki, newest first"
      actions={<>
        <form role="search" onSubmit={(e) => { e.preventDefault(); setApplied(contains.trim()); }}>
          <label htmlFor="log-filter" className="sr-only">Filter logs</label>
          <input id="log-filter" type="search" className="input input--sm" placeholder="Filter, then Enter"
            value={contains} onChange={(e) => setContains(e.target.value)} />
        </form>
        <Segmented label="Level" value={level} onChange={setLevel}
          options={[{ value: 'all', label: 'All' }, { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' }]} />
      </>}>
      {!hasLoki ? <p className="empty">Connect Loki to this environment in Settings to see logs.</p>
        : q.isError ? <SectionError what="logs" error={q.error.message} />
        : q.isLoading ? <div className="skeleton" style={{ height: 160 }} />
        : lines.length === 0 ? <p className="empty">No {level === 'all' ? '' : `${level} `}lines{applied ? ` matching “${applied}”` : ''} in the last 15 minutes.</p>
        : (
          <div className="logs">
            {lines.map((l, i) => (
              <div key={`${l.ts}-${i}`} className={`log log--${l.level}`}>
                <time className="log__time">{clock(l.ts)}</time>
                <span className="log__level">{l.level}</span>
                <span className="log__pod">{l.pod}</span>
                <span className="log__line">{l.line}</span>
              </div>
            ))}
          </div>
        )}
    </Panel>
  );
}

export function RunLink({ app, env, number }) {
  if (!number) return null;
  return <Link className="link" to={`/${app}/${env}/runs`}>View run #{number}</Link>;
}

export { Pill };
