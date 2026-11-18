// Sign-in background: slow aurora light in the environment colors, with flow lines drifting across it.
// Pure decoration; motion stops for people who turn it off (prefers-reduced-motion in app.css).
const LINES = [
  { tone: 'blue', d: 'M-80 640 C 240 640, 360 300, 720 380 S 1180 700, 1540 260', speed: 26 },
  { tone: 'orange', d: 'M-80 730 C 300 690, 480 470, 800 510 S 1220 760, 1540 430', speed: 32 },
  { tone: 'red', d: 'M-80 500 C 200 460, 520 160, 840 240 S 1260 520, 1540 120', speed: 38 },
  { tone: 'green', d: 'M-80 840 C 360 820, 620 640, 940 660 S 1300 820, 1540 600', speed: 22 },
];

export function LoginBackdrop() {
  return (
    <div className="login__bg" aria-hidden="true">
      <span className="aurora aurora--blue" />
      <span className="aurora aurora--orange" />
      <span className="aurora aurora--red" />
      <span className="aurora aurora--green" />
      <svg className="flowlines" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        {LINES.map((l) => (
          <g key={l.tone} className={`flowline flowline--${l.tone}`}>
            <path className="flowline__base" d={l.d} />
            <path className="flowline__dash" d={l.d} style={{ animationDuration: `${l.speed}s` }} />
          </g>
        ))}
      </svg>
      <span className="login__veil" />
    </div>
  );
}
