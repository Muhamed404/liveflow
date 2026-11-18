const RE = /^v(\d+)\.(\d+)\.(\d+)$/;
export const isSemverTag = (t) => RE.test(t);
export function compareTags(a, b) {
  const pa = RE.exec(a).slice(1).map(Number), pb = RE.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
export const latestTag = (tags) => tags.filter(isSemverTag).sort(compareTags).at(-1) || null;
