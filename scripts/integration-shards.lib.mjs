/**
 * Pure functions behind the sharded integration suite (#857). The CLI and
 * self-test are in `integration-shards.mjs`; everything here is
 * side-effect-free so the self-test drives it directly.
 */

/** Target Jest seconds per shard; N = ⌈recorded total ÷ this⌉. */
export const BUDGET_SECONDS = 210;
/** Shard-count bounds. MAX is sized to GitHub's free plan: 20 concurrent
 *  jobs per account, shared by every workflow and PR, and a push already
 *  starts three other checks. */
export const MIN_SHARDS = 2;
export const MAX_SHARDS = 10;
/** Used when no durations are recorded at all. */
export const FALLBACK_SHARDS = 5;
/** A file can't be split across shards, so it's a floor on any shard's time.
 *  Past this, split it by concern (as demo-seed was). */
export const FILE_CEILING_SECONDS = 120;
/** A shard this far over budget warns in the summary. */
export const DRIFT_FACTOR = 1.25;
/** Files allowed past the ceiling, each `{ file, reason }`. Starts empty and
 *  only shrinks. */
export const CEILING_ALLOWLIST = [];

/** Where durations.json lives, relative to the repo root. */
export const DURATIONS_FILE =
  "apps/api/src/__tests__/__integration__/durations.json";

const API_MARKER = "/apps/api/";

/** A Jest report path made relative to apps/api, whatever machine ran it. */
const toApiRelative = (absolute) => {
  const normalized = absolute.split("\\").join("/");
  const at = normalized.lastIndexOf(API_MARKER);
  return at === -1 ? null : normalized.slice(at + API_MARKER.length);
};

const round1 = (seconds) => Math.round(seconds * 10) / 10;

/**
 * Durations from Jest JSON reports, keyed by path relative to apps/api.
 * A file's time is its suite's `endTime − startTime`. A file reported more
 * than once keeps its longest time, and files the checkout no longer has are
 * dropped, so a report from a branch with extra tests can't add them.
 * @param {Array<{testResults?: Array<{name: string, startTime: number, endTime: number}>}>} reports
 * @param {string[]} existingFiles paths relative to apps/api
 * @returns {Record<string, number>} keys sorted
 */
export function mergeReports(reports, existingFiles) {
  const existing = new Set(existingFiles);
  const seconds = {};
  for (const report of reports) {
    for (const result of report.testResults ?? []) {
      const file = toApiRelative(result.name ?? "");
      if (!file || !existing.has(file)) continue;
      const elapsed = round1((result.endTime - result.startTime) / 1000);
      if (!(file in seconds) || elapsed > seconds[file]) seconds[file] = elapsed;
    }
  }
  return Object.fromEntries(
    Object.keys(seconds)
      .sort()
      .map((f) => [f, seconds[f]])
  );
}

/**
 * Whether a refresh is worth a PR: a file added or removed, or one that moved
 * by more than 20% AND more than 5s. Smaller moves are run-to-run noise.
 */
export function durationsChanged(prev, next) {
  const a = Object.keys(prev);
  const b = Object.keys(next);
  if (a.length !== b.length || a.some((f) => !(f in next))) return true;
  return b.some((f) => {
    const delta = Math.abs(next[f] - prev[f]);
    return delta > 5 && delta > prev[f] * 0.2;
  });
}

/** Files over the ceiling that the allowlist doesn't excuse. */
export function ceilingViolations(durations, allowlist = CEILING_ALLOWLIST) {
  const allowed = new Set(allowlist.map((a) => a.file));
  return Object.entries(durations)
    .filter(([file, s]) => s > FILE_CEILING_SECONDS && !allowed.has(file))
    .map(([file, seconds]) => ({ file, seconds }));
}

/**
 * How many shards to run: enough that each gets about `BUDGET_SECONDS` of
 * recorded Jest time, clamped to `[MIN_SHARDS, MAX_SHARDS]`. `capped` means
 * the suite has outgrown the cap: shards now run over budget, and the
 * per-worker-database follow-up is due.
 * @param {Record<string, number>} durations
 * @returns {{count: number, matrix: {index: number[]}, totalSeconds: number, capped: boolean}}
 */
export function planShards(durations) {
  const totalSeconds = round1(
    Object.values(durations).reduce((n, s) => n + (Number.isFinite(s) ? s : 0), 0)
  );
  const wanted = Math.ceil(totalSeconds / BUDGET_SECONDS);
  const count =
    totalSeconds === 0
      ? FALLBACK_SHARDS
      : Math.min(MAX_SHARDS, Math.max(MIN_SHARDS, wanted));
  return {
    count,
    matrix: { index: Array.from({ length: count }, (_, i) => i + 1) },
    totalSeconds,
    capped: wanted > MAX_SHARDS,
  };
}
