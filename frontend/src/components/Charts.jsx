import { useMemo } from 'react';

/** Area chart with deploy / stress markers. points: [[unixSec, value|null]] */
export function SeriesChart({ points = [], markers = [], height = 200, color = 'var(--blue)', label, format = (v) => v }) {
  const W = 720, H = height;
  const geo = useMemo(() => {
    const valid = points.filter(([, v]) => v != null);
    if (valid.length < 2) return null;
    const t0 = points[0][0], t1 = points.at(-1)[0];
    const max = Math.max(...valid.map(([, v]) => v)) * 1.15 || 1;
    const x = (t) => ((t - t0) / (t1 - t0 || 1)) * W;
    const y = (v) => H - (v / max) * (H - 8) - 4;
    // gaps (null) split the line
    const segs = [];
    let cur = [];
    for (const [t, v] of points) {
      if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(t).toFixed(1)},${y(v).toFixed(1)}`);
    }
    if (cur.length) segs.push(cur);
    const ms = markers.map((m) => {
      const t = Date.parse(m.at) / 1000;
      return t >= t0 && t <= t1 ? { ...m, pct: ((t - t0) / (t1 - t0)) * 100 } : null;
    }).filter(Boolean);
    return { segs, ms, last: valid.at(-1)[1], max };
  }, [points, markers, H]);

  if (!geo) return <p className="empty">Not enough data yet for {label.toLowerCase()}.</p>;
  return (
    <div className="chart">
      {geo.ms.map((m) => (
        <span key={m.at + m.label} className={`chart__marker chart__marker--${m.kind}`} style={{ left: `${m.pct}%` }}>{m.label}</span>
      ))}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${label}, latest ${format(geo.last)}`}>
        {geo.segs.map((s, i) => (
          <g key={i}>
            <polygon points={`${s[0].split(',')[0]},${H} ${s.join(' ')} ${s.at(-1).split(',')[0]},${H}`} fill={color} fillOpacity="0.12" />
            <polyline points={s.join(' ')} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {geo.ms.map((m) => (
          <line key={m.at + m.label} x1={(m.pct / 100) * W} x2={(m.pct / 100) * W} y1="0" y2={H}
            stroke="currentColor" strokeOpacity="0.45" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}
