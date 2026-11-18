import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOverview, useEnvAction, useMetric, useEvents } from '../api/hooks.js';
import { Panel, Button, SectionError } from '../components/ui.jsx';
import { SeriesChart } from '../components/Charts.jsx';
import { ConfirmDialog } from '../components/forms.jsx';
import { DeliveryPath } from '../components/DeliveryPath.jsx';
import { clock, num } from '../lib/format.js';

function Countdown({ seconds }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, [seconds]);
  return <>{Math.floor(left / 60)}m {String(left % 60).padStart(2, '0')}s</>;
}

function Slider({ id, label, value, min, max, step = 1, unit, onChange, disabled }) {
  return (
    <div className="field">
      <div className="slider__head"><label className="field__label" htmlFor={id}>{label}</label><span className="mono">{value} {unit}</span></div>
      <input id={id} type="range" className="slider" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function StressPage() {
  const { appId, env } = useParams();
  const q = useOverview(appId, env);
  const start = useEnvAction(appId, env, '/stress');
  const stop = useEnvAction(appId, env, '/stress', 'DELETE');
  const [vus, setVus] = useState(50);
  const [dur, setDur] = useState(120);
  const [confirming, setConfirming] = useState(false);
  const cpu = useMetric(appId, env, 'cpu_cores', 15, Boolean(q.data?.metrics));
  const events = useEvents(appId, env);

  if (q.isLoading) return <div className="skeleton skeleton--hero" />;
  if (q.isError) return <SectionError what="the stress test" error={q.error.message} />;
  const o = q.data;
  if (!o.stress) {
    return (
      <section className="panel placeholder">
        <h1 className="hero__title">No stress test for {env}</h1>
        <p className="hero__sub">Add a Jenkins k6 job and a target URL to this environment in Settings. The job receives TARGET_URL, VUS and DURATION.</p>
      </section>
    );
  }
  if (o.stress.error) return <SectionError what="the stress test status" error={o.stress.error} />;
  const s = o.stress.data;
  const cluster = o.path.stations.find((x) => x.id === 'cluster' || x.id === 'dev_server');
  const hpa = o.workload.data?.hpa;
  const scaling = (events.data?.events || []).filter((e) => e.source === 'hpa' || e.source === 'k6' || (e.source === 'user' && /stress/.test(e.text)));
  const [vmin, vmax] = s.limits.vus, [dmin, dmax] = s.limits.duration_sec;

  return (
    <>
      <section className="hero" aria-labelledby="stress-title">
        <div className="hero__head">
          <div className="hero__copy">
            <p className="hero__kicker">Stress test</p>
            <h1 id="stress-title" className="hero__title">{s.running ? `${env} under load: watch the HPA react` : 'Put load on it and watch the HPA'}</h1>
            <p className="hero__sub">
              {s.running
                ? <>{s.started_by || 'Someone'} is running {s.vus} virtual users for {s.duration_sec}s. <Countdown seconds={s.remaining_sec} /> left.</>
                : <>k6 sends traffic to <span className="mono">{s.target_url}</span>. One test at a time per environment.</>}
            </p>
          </div>
          {s.running && (
            <div className="hero__action">
              <Button kind="danger" icon="stop" disabled={stop.isPending} onClick={() => stop.mutate()}>{stop.isPending ? 'Stopping…' : 'Stop test'}</Button>
              {stop.isError && <span className="hint tone-bad" role="alert">{stop.error.message}</span>}
            </div>
          )}
        </div>
        {cluster && <DeliveryPath label="Load path" path={{
          stations: [
            { id: 'k6', icon: 'bolt', name: 'k6', state: s.running ? 'active' : 'idle', status: s.running ? `${s.vus} VUs` : 'Idle', detail: s.build ? `#${s.build.number}` : null },
            { id: 'svc', icon: 'flow', name: 'Service', state: s.running ? 'done' : 'idle', status: o.metrics?.data?.rps != null ? `${num(o.metrics.data.rps, 0)} req/s` : 'Target', detail: s.target_url.replace(/^https?:\/\//, '') },
            { ...cluster, state: s.running ? 'active' : cluster.state },
            { id: 'hpa', icon: 'chart', name: 'HPA', state: !hpa ? 'idle' : hpa.current_replicas !== hpa.desired_replicas ? 'active' : 'done',
              status: hpa ? `${hpa.current_replicas} → ${hpa.desired_replicas} pods` : 'No HPA', detail: hpa ? `CPU ${hpa.cpu_current_percent ?? '—'}% / ${hpa.cpu_target_percent ?? '—'}%` : null },
          ],
          rails: s.running ? ['active', 'active', 'active'] : ['idle', 'idle', 'idle'],
        }} />}
      </section>

      <div className="split">
        <div className="split__main">
          <Panel title="CPU during the test" icon="chart" sub="Stress starts are marked on the timeline.">
            {!o.metrics ? <p className="empty">Connect Prometheus to see CPU.</p>
              : cpu.isError ? <SectionError what="CPU" error={cpu.error.message} />
              : cpu.data ? <SeriesChart points={cpu.data.points} markers={cpu.data.markers} label="CPU" format={(v) => `${num(v, 2)} cores`} />
              : <div className="skeleton" style={{ height: 200 }} />}
            {hpa && <p className="hint">HPA {hpa.min_replicas}–{hpa.max_replicas} pods, target {hpa.cpu_target_percent}% CPU. Now {hpa.current_replicas} running.</p>}
          </Panel>
        </div>
        <div className="split__side split__side--narrow">
          <Panel title="Next test" icon="bolt">
            <Slider id="vus" label="Virtual users" value={vus} min={vmin} max={vmax} unit="VUs" onChange={setVus} disabled={s.running} />
            <Slider id="dur" label="Duration" value={dur} min={dmin} max={dmax} step={10} unit="s" onChange={setDur} disabled={s.running} />
            <Button kind="primary" icon="play" disabled={!o.can.stress.allowed || start.isPending} onClick={() => { start.reset(); setConfirming(true); }}>Start test</Button>
            {!o.can.stress.allowed && <p className="hint">{o.can.stress.reason}</p>}
          </Panel>
        </div>
      </div>

      <Panel title="Scaling events" icon="clock" sub="HPA decisions and stress tests, newest first">
        {scaling.length === 0 ? <p className="empty">No scaling yet. Start a test and the HPA decisions show up here.</p> : (
          <ol className="stream">
            {scaling.map((e, i) => (
              <li key={`${e.at}-${i}`} className="stream__row">
                <time className="stream__time" dateTime={e.at}>{clock(e.at)}</time>
                <span className={`stream__src src-${e.source}`}>{e.source}</span>
                <span className="stream__text">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {confirming && (
        <ConfirmDialog title={`Start ${vus} virtual users for ${dur}s?`} confirmLabel="Start test" confirmWord={env === 'prod' ? env : null}
          busy={start.isPending} error={start.error?.message} onCancel={() => setConfirming(false)}
          onConfirm={() => start.mutate({ vus, duration_sec: dur, confirm: true }, { onSuccess: () => setConfirming(false) })}>
          <p>k6 hits <span className="mono">{s.target_url}</span>. Everyone watching {env} sees the test and can stop it.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
