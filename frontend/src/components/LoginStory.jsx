import { Brand } from './Logo.jsx';
import { Icon } from './Icon.jsx';

// The left side of the sign-in page: what Liveflow is, shown as a still preview of the dashboard.
// Decoration only — none of these numbers come from the API.
const STATIONS = [
  { name: 'GitHub', state: 'v2.3.0 tagged', tone: 'blue' },
  { name: 'Jenkins', state: '#214 passed', tone: 'orange' },
  { name: 'ArgoCD', state: 'Synced', tone: 'red' },
  { name: 'Production', state: '4 / 4 pods', tone: 'green' },
];

// requests per second over 15 minutes; the deploy lands at point 11
const RPS = [42, 44, 41, 47, 45, 49, 46, 52, 50, 48, 51, 58, 63, 61, 66, 64, 69, 67, 72, 70];
const W = 300, H = 64, DEPLOY = 11;
const max = Math.max(...RPS) * 1.1;
const pts = RPS.map((v, i) => [(i / (RPS.length - 1)) * W, H - (v / max) * (H - 6) - 3]);
const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const area = `0,${H} ${line} ${W},${H}`;
const deployX = pts[DEPLOY][0];

const FEATURES = [
  { icon: 'gear', title: 'Your pipeline, stage by stage', text: 'Stages come straight from the Jenkinsfile.' },
  { icon: 'lock', title: 'A real production gate', text: 'Nothing reaches prod until someone syncs.' },
  { icon: 'cluster', title: 'Rollouts and autoscaling', text: 'Pods, HPA and metrics read live from the cluster.' },
];

function Preview() {
  return (
    <figure className="lp" aria-hidden="true">
      <div className="lp__head">
        <span className="lp__app">frontend-app</span>
        <span className="lp__env">prod</span>
        <span className="lp__status"><span className="lp__pulse" />v2.3.0 is live</span>
      </div>
      <ol className="lp__path">
        {STATIONS.map((s) => (
          <li key={s.name} className={`lp__stop lp__stop--${s.tone}`}>
            <span className="lp__dot" />
            <span className="lp__name">{s.name}</span>
            <span className="lp__state">{s.state}</span>
          </li>
        ))}
      </ol>
      <div className="lp__body">
        <dl className="lp__stats">
          <div><dt>Requests</dt><dd>70/s</dd></div>
          <div><dt>Errors</dt><dd className="tone-ok">0.02%</dd></div>
          <div><dt>CPU</dt><dd>41%</dd></div>
        </dl>
        <div className="lp__chartwrap">
          <svg className="lp__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <polygon points={area} className="lp__area" />
            <polyline points={line} className="lp__line" vectorEffect="non-scaling-stroke" />
            <line x1={deployX} x2={deployX} y1="0" y2={H} className="lp__deploy" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="lp__marker" style={{ left: `${(deployX / W) * 100}%` }}>deploy v2.3.0</span>
        </div>
      </div>
    </figure>
  );
}

export function LoginStory() {
  return (
    <aside className="login__story" aria-label="About Liveflow">
      <span className="brand"><Brand /></span>
      <div className="login__pitch">
        <p className="login__kicker">Continuous delivery, live</p>
        <h2 className="login__headline">Every release, from commit to production, on one screen.</h2>
        <p className="login__sub">Run the pipeline, open the production gate and watch the rollout land, without a terminal.</p>
      </div>
      <Preview />
      <ul className="login__features">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <span className="login__ficon"><Icon name={f.icon} size={16} /></span>
            <span><strong>{f.title}</strong>{f.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
