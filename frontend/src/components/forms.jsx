import { useEffect, useRef, useState } from 'react';

export function Field({ label, hint, error, children, id }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field__hint tone-bad">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Text({ id, label, hint, value, onChange, mono, error, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input id={id} aria-invalid={error ? 'true' : undefined} className={`input${mono ? ' mono' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Secret({ id, label, hint, has, value, onChange, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <input id={id} type="password" className="input mono" autoComplete="new-password" value={value ?? ''}
        placeholder={has ? 'Saved. Type a new value to replace it' : ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Pick({ id, label, hint, value, onChange, options, empty = 'None', error, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select id={id} aria-invalid={error ? 'true' : undefined} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
        <option value="">{empty}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Check({ id, label, checked, onChange, hint, ...rest }) {
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} {...rest} />
        <span>{label}</span>
      </label>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Area({ id, label, hint, value, onChange, rows = 4, mono, placeholder, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <textarea id={id} rows={rows} className={`input input--area${mono ? ' mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

/** Confirmation dialog. confirmWord: the user must type it first (prod actions). */
export function ConfirmDialog({ title, children, confirmLabel, confirmWord, tone = 'primary', busy, error, onConfirm, onCancel }) {
  const [word, setWord] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('input, button')?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const ready = !confirmWord || word.trim() === confirmWord;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="cd-title"
        onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onConfirm(); }}>
        <h2 id="cd-title">{title}</h2>
        <div className="dialog__body">{children}</div>
        {confirmWord && (
          <Field id="cd-word" label={<>Type <span className="mono tone-warn">{confirmWord}</span> to confirm</>}>
            <input id="cd-word" className="input mono" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
          </Field>
        )}
        {error && <p className="hint tone-bad" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className={`btn btn--${tone}`} disabled={!ready || busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
