/**
 * Pure functions behind the sharded test suites: the integration suite
 * (#857) and the web unit suite (#1091). The CLI and self-test are in
 * `test-shards.mjs`; everything here is side-effect-free so the self-test
 * drives it directly, and it imports nothing, so a Jest sequencer can load it.
 *
 * Each suite's specifics live in `SUITES`; every function that depends on
 * them takes the suite first.
 *
 * `assignShards` lives here too, shared by both suites' Jest sequencers.
 * Turbo still hashes it into both test tasks: each lists
 * `$TURBO_ROOT$/scripts/test-shards.lib.mjs` in `inputs`, so a change to the
 * packing re-runs every shard instead of restoring a cached "pass" for a
 * shard whose files have moved.
 */

/** How many recent runs a refresh samples. Per-file times are noisy run to
 *  run (a heavy file measured 21–46s across runs of one commit), so each
 *  file's duration is its median over this many runs. */
export const SAMPLE_RUNS = 5;
/** A shard this far over budget warns in the summary. */
export const DRIFT_FACTOR = 1.25;
/** GitHub Free's concurrent-job limit, per account, shared by every workflow
 *  and PR. lint:ci-cache rule 8 holds one push's peak under it, counting each
 *  suite's shard matrix at its cap. */
export const CONCURRENT_JOB_LIMIT = 20;

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
 * Whether a path (relative to apps/web) is a test web's Jest config runs:
 * its testMatch (`jest.config.js`) is any `*.test.ts(x)` or `*.spec.ts(x)`,
 * and every one of them lives under `src`. `lint:test-files` holds this
 * equal to `jest --listTests`, so the two can't drift apart unnoticed.
 */
export function isWebUnitTestPath(relative) {
  return /^src\/(.*\/)?[^/]+\.(test|spec)\.tsx?$/.test(relative);
}

/**
 * @typedef {{
 *   key: "integration" | "web",
 *   title: string,
 *   packageDir: string,
 *   isTestPath: (relative: string) => boolean,
 *   durationsFile: string,
 *   durationsRequired: boolean,
 *   budgetSeconds: number,
 *   minShards: number,
 *   maxShards: number,
 *   fallbackShards: number,
 *   fileCeilingSeconds: number,
 *   ceilingAllowlist: Array<{file: string, reason: string}>,
 *   shardVar: string,
 *   turboFile: string,
 *   turboTask: string,
 *   reportFile: string,
 *   artifactPrefix: string,
 *   workflowFile: string,
 *   driftIssueTitle: string,
 *   skippable: boolean,
 *   capAdvice: string,
 * }} Suite
 * - `title`: the required check's name (annotations, step summary).
 * - `packageDir`: report paths are made relative to it.
 * - `budgetSeconds`: recorded file-seconds per shard; N = ⌈total ÷ this⌉.
 * - `durationsRequired`: whether a missing durations file fails the lint.
 * - `shardVar` / `turboFile` / `turboTask`: the "i/N" env var and the turbo
 *   task that must hash it (lint:ci-cache rule 6).
 * - `skippable`: the suite's workflow has a docs-only `changes` job (#663).
 */

/** @type {Record<"integration" | "web", Suite>} */
export const SUITES = {
  integration: {
    key: "integration",
    title: "Integration Tests",
    packageDir: "apps/api",
    isTestPath: isIntegrationTestPath,
    durationsFile: "apps/api/src/__tests__/__integration__/durations.json",
    durationsRequired: true,
    // 150s leaves room for runner variance: identically sized shards
    // measured up to ~30% apart, and a 210s budget put one run at 6m17s
    // (#857). Each shard runs its files serially (--maxWorkers=1).
    budgetSeconds: 150,
    minShards: 2,
    // Sized to GitHub Free's 20 concurrent jobs alongside the other
    // push-triggered checks; lint:ci-cache rule 8 holds the sum.
    maxShards: 10,
    fallbackShards: 5,
    // A file can't be split across shards, so it's a floor on any shard's
    // time. Past this, split it by concern (as demo-seed was).
    fileCeilingSeconds: 120,
    // Each `{ file, reason }`. Starts empty and only shrinks.
    ceilingAllowlist: [],
    shardVar: "INTEGRATION_SHARD",
    turboFile: "turbo.json",
    turboTask: "test:integration",
    reportFile: "apps/api/jest-integration-report.json",
    artifactPrefix: "integration-jest-",
    workflowFile: "integration-test.yml",
    driftIssueTitle: "Integration test durations have drifted",
    skippable: true,
    capAdvice: "time for one database per Jest worker (#857 follow-up)",
  },
  web: {
    key: "web",
    title: "Unit Tests",
    packageDir: "apps/web",
    isTestPath: isWebUnitTestPath,
    durationsFile: "apps/web/src/__tests__/durations.json",
    // Recorded from this suite's first sharded CI runs (#1091); until then
    // the planner uses the fallback.
    durationsRequired: false,
    // File-seconds, not wall time: each web shard runs Jest's default 3
    // workers on a 4-core runner, so 450s of recorded file time is about
    // 150s of wall time, the integration suite's budget.
    budgetSeconds: 450,
    minShards: 2,
    // 6 shards + the checks job make Unit Tests' peak 7; with integration's
    // 10 and three single-job checks, one push peaks at exactly 20
    // (lint:ci-cache rule 8).
    maxShards: 6,
    fallbackShards: 3,
    fileCeilingSeconds: 120,
    ceilingAllowlist: [],
    shardVar: "WEB_UNIT_SHARD",
    turboFile: "apps/web/turbo.json",
    turboTask: "test:unit",
    reportFile: "apps/web/jest-unit-report.json",
    artifactPrefix: "web-unit-jest-",
    workflowFile: "unit-test.yml",
    driftIssueTitle: "Web unit test durations have drifted",
    skippable: false,
    capAdvice: "split the heaviest web suites, or rebalance the caps within lint:ci-cache rule 8",
  },
};

/**
 * Durations-file contents, validated: an object of finite numbers. Throws
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

/** A Jest report path made relative to the suite's package, whatever
 *  machine ran it; null when it isn't under that package. */
export function toPackageRelative(suite, absolute) {
  const marker = `/${suite.packageDir}/`;
  const normalized = absolute.split("\\").join("/");
  const at = normalized.lastIndexOf(marker);
  return at === -1 ? null : normalized.slice(at + marker.length);
}

const round1 = (seconds) => Math.round(seconds * 10) / 10;

/** One run's seconds per file: suite `endTime − startTime`, the longest if a
 *  file appears twice, files outside `existing` dropped. */
function runSeconds(suite, reports, existing) {
  const seconds = {};
  for (const report of reports) {
    for (const result of report.testResults ?? []) {
      const file = toPackageRelative(suite, result.name ?? "");
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
 * the suite's package: each file's MEDIAN across the runs that ran it. One run is a
 * noisy sample (a file's time moves with its runner, its neighbours, and
 * whether it ran first and paid the module compile), and the median keeps a
 * single slow or fast run from skewing the split. A new file uses the
 * samples it has. A run repeated verbatim (a turbo-cached re-run) counts once,
 * and files the checkout no longer has are dropped, so a report from a
 * branch with extra tests can't add them.
 * @param {Suite} suite
 * @param {Array<Array<{testResults?: Array<{name: string, startTime: number, endTime: number}>}>>} runs
 *   one array of shard reports per run
 * @param {string[]} existingFiles paths relative to the suite's package
 * @returns {Record<string, number>} keys sorted, seconds to 0.1
 */
export function mergeRuns(suite, runs, existingFiles) {
  const existing = new Set(existingFiles);
  const seen = new Set();
  const samples = {};
  for (const reports of runs) {
    const fingerprint = runFingerprint(reports);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    for (const [file, s] of Object.entries(runSeconds(suite, reports, existing))) {
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
export function mergeReports(suite, reports, existingFiles) {
  return mergeRuns(suite, [reports], existingFiles);
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

/** Files over the suite's ceiling that its allowlist doesn't excuse. */
export function ceilingViolations(suite, durations) {
  const allowed = new Set(suite.ceilingAllowlist.map((a) => a.file));
  return Object.entries(durations)
    .filter(([file, s]) => s > suite.fileCeilingSeconds && !allowed.has(file))
    .map(([file, seconds]) => ({ file, seconds }));
}

/**
 * How many shards to run: enough that each gets about the suite's
 * `budgetSeconds` of recorded Jest time, clamped to `[minShards, maxShards]`,
 * or `fallbackShards` when nothing is recorded. `capped` means the suite has
 * outgrown the cap: shards now run over budget (see the suite's `capAdvice`).
 * @param {Suite} suite
 * @param {Record<string, number>} durations
 * @returns {{count: number, matrix: {index: number[]}, totalSeconds: number, capped: boolean}}
 */
export function planShards(suite, durations) {
  const totalSeconds = round1(
    Object.values(durations).reduce((n, s) => n + (Number.isFinite(s) ? s : 0), 0)
  );
  const wanted = Math.ceil(totalSeconds / suite.budgetSeconds);
  const count =
    totalSeconds === 0
      ? suite.fallbackShards
      : Math.min(suite.maxShards, Math.max(suite.minShards, wanted));
  return {
    count,
    matrix: { index: Array.from({ length: count }, (_, i) => i + 1) },
    totalSeconds,
    capped: wanted > suite.maxShards,
  };
}

/**
 * The verdict of a suite's one required check (its `title`) over every
 * shard. Fails closed: green only when (for a skippable suite) the docs-only
 * skip decided not to run, or when every gate, the plan and every shard
 * succeeded, every shard's report is
 * present, no suite failed, and the shards together ran exactly the
 * checkout's integration test files, each once. That is checked by name, not
 * by count: a file run twice and another never run would cancel out in a
 * count. Running over budget or at the cap only warns: slow is not
 * broken.
 *
 * @param {Suite} suite
 * @param {{
 *   changesResult?: string, run?: string, planResult: string, shardResult: string,
 *   gates?: Array<{label: string, result: string}>,
 *   plannedCount: number, expectedFiles: string[], capped: boolean,
 *   reports: Array<{shard: number, report: {numTotalTestSuites?: number, numFailedTestSuites?: number, testResults?: Array<{startTime: number, endTime: number}>}}>
 * }} input  `*Result` and gate results are GitHub `needs.<job>.result` values
 * @returns {{ok: boolean, skipped: boolean, errors: string[], warnings: string[], table: string}}
 */
export function summaryVerdict(suite, input) {
  const errors = [];
  const warnings = [];

  if (suite.skippable) {
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
  }

  for (const gate of input.gates ?? []) {
    if (gate.result !== "success") errors.push(`${gate.label} ended ${gate.result || "without a result"}`);
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
        const f = toPackageRelative(suite, t.name ?? "");
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
    if (unknown.length) errors.push(`ran but isn't a ${suite.key} test file in the checkout: ${list(unknown)}`);
  }
  const failed = rows.reduce((n, r) => n + r.failed, 0);
  if (failed > 0) errors.push(`${failed} suite(s) failed`);

  for (const r of rows) {
    if (r.seconds > suite.budgetSeconds * DRIFT_FACTOR) {
      warnings.push(
        `shard ${r.shard} ran ${r.seconds}s of Jest, over the ${suite.budgetSeconds}s budget by more than ${Math.round((DRIFT_FACTOR - 1) * 100)}%: refresh ${suite.durationsFile}`
      );
    }
  }
  if (input.capped) {
    warnings.push(
      `the suite needs more than the ${suite.maxShards}-shard cap, so shards run over budget: ${suite.capAdvice}`
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

const median = (values) => {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Longest-processing-time bin packing, shared by both suites' Jest
 * sequencers. Pure and deterministic: files are placed heaviest first (ties
 * by path), each onto the currently lightest shard (ties to the lowest
 * index). A file with no recorded duration weighs the median of the known
 * ones, so new files spread out rather than piling onto one shard. Every
 * file lands in exactly one shard.
 *
 * @param {string[]} files paths relative to the suite's package
 * @param {Record<string, number>} durations seconds per file
 * @param {number} shardCount at least 1
 * @returns {string[][]} `shardCount` lists of files
 */
export function assignShards(files, durations, shardCount) {
  const fallback = median(
    Object.values(durations).filter((v) => Number.isFinite(v))
  );
  const weight = (f) =>
    Number.isFinite(durations[f]) ? durations[f] : fallback;

  const ordered = [...files].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0)
  );
  const shards = Array.from({ length: shardCount }, () => []);
  const loads = new Array(shardCount).fill(0);
  for (const file of ordered) {
    let lightest = 0;
    for (let i = 1; i < shardCount; i++) {
      if (loads[i] < loads[lightest]) lightest = i;
    }
    shards[lightest].push(file);
    loads[lightest] += weight(file);
  }
  return shards;
}
