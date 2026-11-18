// Stroke icons (24×24). Paths are static strings owned by this file.
const PATHS = {
  git: "<circle cx=\"6\" cy=\"6\" r=\"2.5\"/><circle cx=\"6\" cy=\"18\" r=\"2.5\"/><circle cx=\"18\" cy=\"9\" r=\"2.5\"/><path d=\"M6 8.5v7M18 11.5c0 3-3 4-9.5 5\"/>",
  gear: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1\"/>",
  box: "<path d=\"M21 8l-9-5-9 5 9 5 9-5z\"/><path d=\"M3 8v8l9 5 9-5V8\"/><path d=\"M12 13v8\"/>",
  sync: "<path d=\"M21 12a9 9 0 0 1-15.5 6.3M3 12A9 9 0 0 1 18.5 5.7\"/><path d=\"M21 4v5h-5M3 20v-5h5\"/>",
  cluster: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><circle cx=\"4\" cy=\"6\" r=\"2\"/><circle cx=\"20\" cy=\"6\" r=\"2\"/><circle cx=\"4\" cy=\"18\" r=\"2\"/><circle cx=\"20\" cy=\"18\" r=\"2\"/><path d=\"M6 7l4 3M18 7l-4 3M6 17l4-3M18 17l-4-3\"/>",
  term: "<path d=\"M4 17l6-5-6-5M12 19h8\"/>",
  bolt: "<path d=\"M13 2L3 14h8l-1 8 10-12h-8z\"/>",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  play: "<path d=\"M7 4l13 8-13 8z\"/>",
  stop: "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"1\"/>",
  lock: "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/>",
  alert: "<path d=\"M12 3l10 18H2z\"/><path d=\"M12 10v5M12 18v.5\"/>",
  check: "<path d=\"M5 12l5 5 9-10\"/>",
  x: "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  ext: "<path d=\"M14 4h6v6M20 4l-9 9M18 14v6H4V6h6\"/>",
  back: "<path d=\"M9 14L4 9l5-5\"/><path d=\"M4 9h11a5 5 0 0 1 0 10h-3\"/>",
  plug: "<path d=\"M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4\"/>",
  tag: "<path d=\"M3 12V4h8l10 10-8 8z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\"1.5\"/>",
  server: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"13\" width=\"18\" height=\"7\" rx=\"1.5\"/><path d=\"M7 7.5h.01M7 16.5h.01\"/>",
  chart: "<path d=\"M3 3v18h18\"/><path d=\"M7 15l4-4 3 3 5-6\"/>",
  grid: "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/>",
  flow: "<circle cx=\"5\" cy=\"12\" r=\"2\"/><circle cx=\"19\" cy=\"12\" r=\"2\"/><path d=\"M7 12h10\"/><path d=\"M14 9l3 3-3 3\"/>",
  rocket: "<path d=\"M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2M9 12a22 22 0 0 1 11-9c0 3-1 8-9 11zM9 12l3 3\"/>",
};

export function Icon({ name, size = 16, stroke = 1.8, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />
  );
}
