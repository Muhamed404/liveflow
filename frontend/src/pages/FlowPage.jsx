import { useParams } from 'react-router-dom';
import { useOverview, useEnvAction } from '../api/hooks.js';
import { DeliveryPath } from '../components/DeliveryPath.jsx';
import { StatRow, ServicesPanel, GatePanel, SignalsPanel, EventStream, LogsPanel, RunLink } from '../components/FlowParts.jsx';
import { Button, SectionError } from '../components/ui.jsx';
import { headline } from '../lib/headline.js';

function RunPipeline({ app, env, can }) {
  const run = useEnvAction(app, env, '/builds');
  if (env === 'prod') return null;
  const c = can.run_pipeline;
  return (
    <div className="hero__action">
      <Button icon="play" disabled={!c.allowed || run.isPending} onClick={() => run.mutate({})}>
        {run.isPending ? 'Starting…' : 'Run pipeline'}
      </Button>
      {!c.allowed && <span className="hint">{c.reason}</span>}
      {run.isError && <span className="hint tone-bad" role="alert">{run.error.message}</span>}
    </div>
  );
}

export function FlowPage() {
  const { appId, env } = useParams();
  const q = useOverview(appId, env);

  if (q.isLoading) return <div className="skeleton skeleton--hero" aria-label="Loading" />;
  if (q.isError) return <SectionError what={`${appId} / ${env}`} error={q.error.message} />;

  const o = q.data;
  const h = headline(o);
  const jenkins = o.path.stations.find((s) => s.id === 'jenkins');

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__head">
          <div className="hero__copy">
            <p className="hero__kicker">Delivery path, live</p>
            <h1 id="hero-title" className="hero__title">{h.title}</h1>
            <p className="hero__sub">{h.sub}</p>
          </div>
          <div className="hero__actions">
            <RunLink app={appId} env={env} number={jenkins?.build_number} />
            <RunPipeline app={appId} env={env} can={o.can} />
          </div>
        </div>
        <DeliveryPath path={o.path} />
      </section>

      <GatePanel key={`${appId}-${env}-${o.gate?.to_version}`} app={appId} env={env} overview={o} />
      <StatRow overview={o} />
      <ServicesPanel overview={o} />

      <div className="split">
        <div className="split__main"><SignalsPanel app={appId} env={env} available={o.metrics?.data ? Object.keys(o.metrics.data) : []} /></div>
        <div className="split__side"><EventStream app={appId} env={env} /></div>
      </div>
      <LogsPanel app={appId} env={env} hasLoki={o.features.logs} />
    </>
  );
}
