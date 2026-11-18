import { APP_NAME } from '../lib/brand.js';

// The L route: a delivery route shaped like an L, from dev blue through staging orange and prod red to live green
export function LogoMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="3.5" stroke="var(--blue)" />
      <path d="M12 12.5V30" stroke="var(--blue)" />
      <path d="M12 30v4a6 6 0 0 0 6 6h4" stroke="var(--orange)" />
      <path d="M22 40h10" stroke="var(--red)" />
      <circle cx="38" cy="40" r="4.5" fill="var(--green)" stroke="none" />
    </svg>
  );
}

/** Mark on its tile + the wordmark ("Live" a weight heavier than "flow") */
export function Brand() {
  const live = APP_NAME.slice(0, 4), rest = APP_NAME.slice(4);
  return (
    <>
      <span className="brand__mark"><LogoMark /></span>
      <span className="brand__word" aria-label={APP_NAME}><b>{live}</b>{rest}</span>
    </>
  );
}
