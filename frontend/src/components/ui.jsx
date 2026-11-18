import { Icon } from './Icon.jsx';

export function Pill({ tone = 'dim', children }) {
  return <span className={`pill pill--${tone}`}><span className="pill__dot" />{children}</span>;
}

export function Panel({ title, icon, sub, actions, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel__head">
        <div>
          <h2 className="panel__title">{icon && <Icon name={icon} className="panel__icon" />}{title}</h2>
          {sub && <p className="panel__sub">{sub}</p>}
        </div>
        {actions && <div className="panel__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Button({ kind = 'ghost', icon, children, ...rest }) {
  return (
    <button type="button" className={`btn btn--${kind}`} {...rest}>
      {icon && <Icon name={icon} size={15} />}{children}
    </button>
  );
}

/** Section of the overview that failed on its own: say which tool and why */
export function SectionError({ what, error, verb }) {
  return (
    <div className="section-error" role="alert">
      <Icon name="alert" size={16} />
      <div><strong>{verb ? `${verb} ${what}.` : `Couldn’t load ${what}.`}</strong> <span className="mono">{error}</span></div>
    </div>
  );
}

export function Segmented({ label, value, options, onChange, mono }) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className={mono ? 'mono' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
