/**
 * Coarse "started X ago" formatting for running-job surfaces (#391).
 * Buckets only — job-age copy needs legibility, not precision. A future
 * timestamp (clock skew between API and browser) clamps to "just now"
 * rather than going negative.
 */
export function formatAgo(epochMs: number, nowMs: number = Date.now()): string {
  const elapsed = Math.max(0, nowMs - epochMs);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (elapsed < MIN) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MIN)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

/** True when `epochMs` is older than `thresholdMs` — the render-safe seam
 *  for staleness checks (the lint rules bar impure calls in component
 *  bodies; tests pass `nowMs` for determinism). */
export function isOlderThan(
  epochMs: number,
  thresholdMs: number,
  nowMs: number = Date.now()
): boolean {
  return nowMs - epochMs > thresholdMs;
}
