/**
 * Pure functions behind the sharded integration suite (#857). The CLI and
 * self-test are in `integration-shards.mjs`; everything here is
 * side-effect-free so the self-test drives it directly.
 */

/** Target Jest seconds per shard; N = ⌈recorded total ÷ this⌉. 150s leaves
 *  room for runner variance: identically sized shards measured up to ~30%
 *  apart, and a 210s budget put one run at 6m17s (#857). */
export const BUDGET_SECONDS = 150;
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

/**
 * Whether a path (relative to apps/api) is a test Jest's integration config
 * runs: its testMatch is any `*.integration.test.ts` under a
 * `__tests__/__integration__/` directory in `src`.
 * The summary's expected file set and the durations writer both use this,
 * so a `*.integration.test.ts` outside `__integration__/` (which Jest never
 * runs) is neither expected nor recorded.
 */
export function isIntegrationTestPath(relative) {
  return /^src\/(.*\/)?__tests__\/__integration__\/(.*\/)?[^/]+\.integration\.test\.ts$/.test(relative);
}

/**
 * durations.json's contents, validated: an object of finite numbers. Throws
 * on anything else, so a broken file fails the lint and the planner rather
 * than quietly reading as "nothing recorded".
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parseDurations(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("durations.json must be an object of seconds per file");
  }
  for (const [file, seconds] of Object.entries(parsed)) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      throw new Error(`durations.json: ${file} is ${JSON.stringify(seconds)}, not a number of seconds`);
    }
  }
  return parsed;
}

/** A Jest report path made relative to apps/api, whatever machine ran it. */
const toApiRelative = (absolute) => {
  const normalized = absolute.split("\\").join("/");
  const at = normalized.lastIndexOf(API_MARKER);
  return at === -1 ? null : normalized.slice(at + API_MARKER.length);
};

const round1 = (seconds) => Math.round(seconds * 10) / 10;

/** How many recent runs a refresh samples. Per-file times are noisy run to
 *  run (a heavy file measured 21–46s across runs of one commit), so each
 *  file's duration is its median over this many runs. */
export const SAMPLE_RUNS = 5;

/** One run's seconds per file: suite `endTime − startTime`, the longest if a
 *  file appears twice, files outside `existing` dropped. */
function runSeconds(reports, existing) {
  const seconds = {};
  for (const report of reports) {
    for (const result of report.testResults ?? []) {
      const file = toApiRelative(result.name ?? "");
      if (!file || !existing.has(file)) continue;
      const elapsed = (result.endTime - result.startTime) / 1000;
      if (!(file in seconds) || elapsed > seconds[file]) seconds[file] = elapsed;
    }
  }
  return seconds;
}

/** A run's identity, from its suites' start times: a turbo-cached re-run
 *  restores the original run's reports verbatim, so it matches exactly. */
const runFingerprint = (reports) =>
  reports
    .flatMap((r) => (r.testResults ?? []).map((t) => `${t.name}@${t.startTime}`))
    .sort()
    .join("|");

const medianOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Durations from several runs' Jest JSON reports, keyed by path relative to
 * apps/api: each file's MEDIAN across the runs that ran it. One run is a
 * noisy sample (a file's time moves with its runner, its neighbours, and
 * whether it ran first and paid the module compile), and the median keeps a
 * single slow or fast run from skewing the split. A new file uses the
 * samples it has. A run repeated verbatim (a turbo-cached re-run) counts once,
 * and files the checkout no longer has are dropped, so a report from a
 * branch with extra tests can't add them.
 * @param {Array<Array<{testResults?: Array<{name: string, startTime: number, endTime: number}>}>>} runs
 *   one array of shard reports per run
 * @param {string[]} existingFiles paths relative to apps/api
 * @returns {Record<string, number>} keys sorted, seconds to 0.1
 */
export function mergeRuns(runs, existingFiles) {
  const existing = new Set(existingFiles);
  const seen = new Set();
  const samples = {};
  for (const reports of runs) {
    const fingerprint = runFingerprint(reports);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    for (const [file, s] of Object.entries(runSeconds(reports, existing))) {
      (samples[file] ??= []).push(s);
    }
  }
  return Object.fromEntries(
    Object.keys(samples)
      .sort()
      .map((f) => [f, round1(medianOf(samples[f]))])
  );
}

/** A single run's durations: `mergeRuns` over one run. */
export function mergeReports(reports, existingFiles) {
  return mergeRuns([reports], existingFiles);
}

/**
 * Whether a refresh is worth a PR. Per-file times are noisy between runs of
 * the same commit: the first suite on each runner pays the module compile, so
 * files trade tens of seconds as the split changes (measured on #857: 22.9s →
 * 1.1s for one file, 0.8s → 8.5s for another, totals within 10%). So a
 * refresh counts only what planning acts on:
 * - a file added or removed;
 * - the total moving more than 10% (the shard count may move);
 * - one file moving more than 30s AND 50% (it may be nearing the ceiling).
 */
export function durationsChanged(prev, next) {
  const a = Object.keys(prev);
  const b = Object.keys(next);
  if (a.length !== b.length || a.some((f) => !(f in next))) return true;
  const total = (d) => Object.values(d).reduce((n, s) => n + s, 0);
  const before = total(prev);
  if (before > 0 && Math.abs(total(next) - before) > before * 0.1) return true;
  return b.some((f) => {
    const delta = Math.abs(next[f] - prev[f]);
    return delta > 30 && delta > prev[f] * 0.5;
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

/**
 * The verdict of the one required check, `Integration Tests`, over every
 * shard. Fails closed: green only when the docs-only skip decided not to run,
 * or when the plan and every shard succeeded, every shard's report is
 * present, no suite failed, and the shards together ran exactly the
 * checkout's integration test files, each once. That is checked by name, not
 * by count: a file run twice and another never run would cancel out in a
 * count. Running over budget or at the cap only warns: slow is not
 * broken.
 *
 * @param {{
 *   changesResult: string, run: string, planResult: string, shardResult: string,
 *   plannedCount: number, expectedFiles: string[], capped: boolean,
 *   reports: Array<{shard: number, report: {numTotalTestSuites?: number, numFailedTestSuites?: number, testResults?: Array<{startTime: number, endTime: number}>}}>
 * }} input  `*Result` are GitHub `needs.<job>.result` values
 * @returns {{ok: boolean, skipped: boolean, errors: string[], warnings: string[], table: string}}
 */
export function summaryVerdict(input) {
  const errors = [];
  const warnings = [];

  if (input.changesResult !== "success") {
    errors.push(
      `the docs-only skip decision ended ${input.changesResult || "without a result"}`
    );
    return { ok: false, skipped: false, errors, warnings, table: "" };
  }
  if (input.run !== "true") {
    return {
      ok: true,
      skipped: true,
      errors,
      warnings,
      table: "Skipped: only docs changed since this branch's last green run.",
    };
  }

  if (input.planResult !== "success") errors.push(`the shard plan ended ${input.planResult}`);
  if (input.shardResult !== "success") {
    errors.push(`the shards ended ${input.shardResult} (any failed or cancelled shard fails the check)`);
  }
  if (input.reports.length !== input.plannedCount) {
    errors.push(`${input.reports.length} of ${input.plannedCount} shard report(s) arrived`);
  }

  const rows = [...input.reports]
    .sort((a, b) => a.shard - b.shard)
    .map(({ shard, report }) => {
      const seconds = round1(
        (report.testResults ?? []).reduce((n, t) => n + (t.endTime - t.startTime) / 1000, 0)
      );
      return {
        shard,
        suites: report.numTotalTestSuites ?? 0,
        failed: report.numFailedTestSuites ?? 0,
        seconds,
      };
    });

  const suites = rows.reduce((n, r) => n + r.suites, 0);
  if (input.reports.length === input.plannedCount) {
    const runs = new Map();
    for (const { report } of input.reports) {
      for (const t of report.testResults ?? []) {
        const f = toApiRelative(t.name ?? "");
        if (f) runs.set(f, (runs.get(f) ?? 0) + 1);
      }
    }
    const expected = new Set(input.expectedFiles);
    const list = (files) =>
      files.slice(0, 10).join(", ") + (files.length > 10 ? `, and ${files.length - 10} more` : "");
    const twice = [...runs].filter(([, n]) => n > 1).map(([f]) => f);
    const never = input.expectedFiles.filter((f) => !runs.has(f));
    const unknown = [...runs.keys()].filter((f) => !expected.has(f));
    if (twice.length) errors.push(`ran in more than one shard: ${list(twice)}`);
    if (never.length) errors.push(`ran in no shard: ${list(never)}`);
    if (unknown.length) errors.push(`ran but isn't an integration test file in the checkout: ${list(unknown)}`);
  }
  const failed = rows.reduce((n, r) => n + r.failed, 0);
  if (failed > 0) errors.push(`${failed} suite(s) failed`);

  for (const r of rows) {
    if (r.seconds > BUDGET_SECONDS * DRIFT_FACTOR) {
      warnings.push(
        `shard ${r.shard} ran ${r.seconds}s of Jest, over the ${BUDGET_SECONDS}s budget by more than ${Math.round((DRIFT_FACTOR - 1) * 100)}%: refresh durations.json`
      );
    }
  }
  if (input.capped) {
    warnings.push(
      `the suite needs more than the ${MAX_SHARDS}-shard cap, so shards run over budget: time for one database per Jest worker (#857 follow-up)`
    );
  }

  const table = [
    "| Shard | Suites | Failed | Jest seconds |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.shard} | ${r.suites} | ${r.failed} | ${r.seconds} |`),
    `| **Total** | **${suites}** of ${input.expectedFiles.length} files | ${failed} | ${round1(rows.reduce((n, r) => n + r.seconds, 0))} |`,
  ].join("\n");

  return { ok: errors.length === 0, skipped: false, errors, warnings, table };
}
