export function duration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function clock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`);
export const num = (v, digits = 0) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }));
export const mib = (bytes) => (bytes == null ? '—' : `${Math.round(bytes / 1048576)} MiB`);
export const shortTag = (image) => (image ? image.split(':').pop() : null);
