import { Icon } from './Icon.jsx';
import { duration } from '../lib/format.js';

const ICON_FOR = { github: 'git', jenkins: 'gear', argocd: 'sync', cluster: 'cluster', dev_server: 'server' };

function PodSquares({ pods, look, label }) {
  return (
    <ul className="podfield__grid" aria-label={label}>
      {pods.map((p) => (
        <li key={p.name} className={`pod pod--${look(p)}`} title={`${p.name} · ${p.version || ''} · ${look(p)}`}>
          {p.name.slice(-1)}
        </li>
      ))}
    </ul>
  );
}

function PodField({ instances, rolling }) {
  if (!instances?.length) return null;
  // outside a rollout every pod is on the current image: show it as plain running
  const look = (p) => (!rolling && p.look === 'new' ? 'running' : p.look);
  const counts = instances.reduce((a, p) => ({ ...a, [look(p)]: (a[look(p)] || 0) + 1 }), {});
  const caption = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
  // several services: one labelled row of squares each, in the configured order
  const services = [...new Set(instances.map((p) => p.service).filter(Boolean))];
  if (services.length > 1) {
    return (
      <div className="podfield">
        <div className="podfield__rows">
          {services.map((svc) => {
            const pods = instances.filter((p) => p.service === svc);
            return (
              <div key={svc} className="podfield__row">
                <span className="podfield__svc">{svc}</span>
                <PodSquares pods={pods} look={look} label={`${svc}: ${pods.length} pods`} />
              </div>
            );
          })}
        </div>
        <span className="podfield__caption">{caption}</span>
      </div>
    );
  }
  return (
    <div className="podfield">
      <PodSquares pods={instances} look={look} label={`Pods: ${caption}`} />
      <span className="podfield__caption">{caption}</span>
    </div>
  );
}

function Stages({ stages }) {
  if (!stages) {
    return <p className="stages__none">Stage list needs the Pipeline Stage View plugin.</p>;
  }
  return (
    <div className="stages">
      <ol>
        {stages.map((s, i) => (
          <li key={`${s.name}-${i}`} className={`stage stage--${s.state}`}>
            <span className="stage__dot" aria-hidden="true" />
            <span className="stage__name">{s.name}</span>
            <span className="stage__time">{s.state === 'pending' ? '—' : duration(s.duration_ms)}</span>
            <span className="sr-only">{s.state}</span>
          </li>
        ))}
      </ol>
      <span className="stages__source">From your Jenkinsfile</span>
    </div>
  );
}

function Station({ s }) {
  const icon = s.icon || (s.id === 'argocd' && s.state === 'gate' ? 'lock' : ICON_FOR[s.id]) || 'gear';
  const wide = s.id === 'jenkins';
  return (
    <li className={`station station--${s.state}${wide ? ' station--wide' : ''}`}>
      <span className="station__mark"><Icon name={icon} size={26} stroke={1.7} /></span>
      <span className="station__text">
        <span className="station__name">{s.name}</span>
        <span className="station__status">{s.status}</span>
        {s.detail && <span className="station__detail">{s.detail}</span>}
      </span>
      {wide && s.build_number && <Stages stages={s.stages} />}
      {(s.id === 'cluster' || s.id === 'dev_server') && <PodField instances={s.instances} rolling={s.rolling_out} />}
    </li>
  );
}

function Rail({ state }) {
  return (
    <li aria-hidden="true" className={`rail rail--${state}`}>
      {state === 'active' && <span className="rail__mover" />}
    </li>
  );
}

/** Renders overview.path exactly as the backend computed it */
export function DeliveryPath({ path, label = 'Delivery path' }) {
  const items = [];
  path.stations.forEach((s, i) => {
    if (i > 0) items.push(<Rail key={`r${i}`} state={path.rails[i - 1]} />);
    items.push(<Station key={s.id} s={s} />);
  });
  return (
    <div className="path-scroll">
      <ol className="path" aria-label={label}>{items}</ol>
    </div>
  );
}
