#!/usr/bin/env node
/**
 * The sharded integration suite's control logic (#857).
 *
 * `apps/api`'s integration suite runs as N shards, each on its own runner
 * with its own Postgres + Redis, behind the one required check
 * `Integration Tests`. This file holds the pieces CI calls between those
 * jobs. Each is a pure function with embedded self-test cases
 * (`npm run lint:integration-shards`), and the CLI subcommands are thin
 * wrappers around them.
 *
 * The bin-packing itself (`assignShards`) lives in
 * `apps/api/jest.integration.sequencer.mjs`, not here: turbo hashes
 * `apps/api`'s files into `test:integration`'s cache key, so a change to the
 * packing invalidates every shard's cached result. Kept at the root, a
 * cached "pass" for shard 2 could be restored after the assignment had moved
 * files into shard 2 that never ran.
 *
 * Usage: node scripts/integration-shards.mjs <command>
 *   --self-test                         the embedded cases (lint:integration-shards)
 *   plan                                the shard count + matrix for CI (step outputs)
 *   summarize --reports <dir>           the Integration Tests verdict over every shard
 *                                       (job results via CHANGES_RESULT, RUN, PLAN_RESULT,
 *                                       SHARD_RESULT, PLANNED_COUNT, CAPPED)
 *   check-durations                     fail on a file over the ceiling (lint:integration-durations)
 *   update-durations --reports <dir> [--if-changed]
 *                                       rewrite durations.json from Jest JSON reports: each file's
 *                                       median over the runs in <dir> (one subdirectory per run,
 *                                       or the shard artifacts of a single run directly)
 *   sample-runs                         how many recent runs a refresh samples (SAMPLE_RUNS)
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Only the self-test needs the packer, and it pulls in @jest/test-sequencer.
// CI's plan and summary jobs run without `npm ci`, so it isn't loaded there.
const { assignShards } =
  process.argv[2] === "--self-test"
    ? await import("../apps/api/jest.integration.sequencer.mjs")
    : { assignShards: null };
import {
  CEILING_ALLOWLIST,
  DURATIONS_FILE,
  FILE_CEILING_SECONDS,
  ceilingViolations,
  durationsChanged,
  mergeReports,
  mergeRuns,
  SAMPLE_RUNS,
  isIntegrationTestPath,
  parseDurations,
  planShards,
  summaryVerdict,
} from "./integration-shards.lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Self-test ───────────────────────────────────────────────────────────────

/** `n` fake test paths, `f000`…, with weights from `weight(i)`. */
const fixture = (n, weight = (i) => (i % 7) + 1) => {
  const files = Array.from({ length: n }, (_, i) => `f${String(i).padStart(3, "0")}`);
  const durations = Object.fromEntries(files.map((f, i) => [f, weight(i)]));
  return { files, durations };
};

/** Every file in exactly one shard, and nothing else. */
const partitions = (files, shards) => {
  const seen = shards.flat();
  return seen.length === files.length && new Set(seen).size === files.length && files.every((f) => seen.includes(f));
};

const load = (shards, durations, fallback = 0) =>
  shards.map((s) => s.reduce((n, f) => n + (durations[f] ?? fallback), 0));

const CASES = [
  ...[0, 1, 4, 5, 198].map((n) => ({
    name: `assignShards: ${n} files over 5 shards land exactly once each`,
    run: () => {
      const { files, durations } = fixture(n);
      const shards = assignShards(files, durations, 5);
      return shards.length === 5 && partitions(files, shards);
    },
  })),
  {
    name: "assignShards: deterministic, whatever order the files arrive in",
    run: () => {
      const { files, durations } = fixture(60);
      const a = assignShards(files, durations, 4);
      const b = assignShards([...files].reverse(), durations, 4);
      return JSON.stringify(a) === JSON.stringify(b);
    },
  },
  {
    name: "assignShards: a file with no recorded duration weighs the median",
    run: () => {
      // Known weights 1, 2, 3 (median 2) plus one unknown file. With two
      // shards and the unknown at 2, the packer must reach loads {4, 4}.
      const durations = { a: 1, b: 2, c: 3 };
      const shards = assignShards(["a", "b", "c", "x"], durations, 2);
      const loads = load(shards, { ...durations, x: 2 }).sort();
      return partitions(["a", "b", "c", "x"], shards) && loads[0] === 4 && loads[1] === 4;
    },
  },
  {
    name: "assignShards: the heaviest shard is within one file of the ideal",
    run: () => {
      const { files, durations } = fixture(198, (i) => ((i * 37) % 97) + 1);
      const shards = assignShards(files, durations, 5);
      const loads = load(shards, durations);
      const total = loads.reduce((a, b) => a + b, 0);
      const biggest = Math.max(...Object.values(durations));
      return Math.max(...loads) <= total / 5 + biggest;
    },
  },
  {
    name: "assignShards: one shard holds every file",
    run: () => {
      const { files, durations } = fixture(10);
      const shards = assignShards(files, durations, 1);
      return shards.length === 1 && partitions(files, shards);
    },
  },
  {
    name: "assignShards: no recorded durations at all still partitions, by count",
    run: () => {
      const { files } = fixture(23);
      const shards = assignShards(files, {}, 5);
      const sizes = shards.map((s) => s.length);
      return partitions(files, shards) && Math.max(...sizes) - Math.min(...sizes) <= 1;
    },
  },
  {
    name: "mergeReports: paths relative to apps/api, seconds to 0.1, from any checkout",
    run: () => {
      const report = {
        testResults: [
          { name: "/home/runner/work/portal-ai/portal-ai/apps/api/src/a.integration.test.ts", startTime: 1000, endTime: 13_440 },
          { name: "/workspace/apps/api/src/b.integration.test.ts", startTime: 0, endTime: 250 },
        ],
      };
      const out = mergeReports([report], ["src/a.integration.test.ts", "src/b.integration.test.ts"]);
      return JSON.stringify(out) === JSON.stringify({ "src/a.integration.test.ts": 12.4, "src/b.integration.test.ts": 0.3 });
    },
  },
  {
    name: "mergeReports: drops a file the checkout no longer has, keeps the longest of repeats",
    run: () => {
      const r = (name, ms) => ({ testResults: [{ name: `/x/apps/api/${name}`, startTime: 0, endTime: ms }] });
      const out = mergeReports([r("src/gone.integration.test.ts", 5000), r("src/a.integration.test.ts", 2000), r("src/a.integration.test.ts", 3000)], ["src/a.integration.test.ts"]);
      return JSON.stringify(out) === JSON.stringify({ "src/a.integration.test.ts": 3 });
    },
  },
  ...(() => {
    /** One run's reports: a single shard report holding `files` → seconds,
     *  starting at `t0` (runs are told apart by their start times). */
    const run = (files, t0 = 0) => [
      {
        testResults: Object.entries(files).map(([f, seconds], i) => ({
          name: `/x/apps/api/${f}`,
          startTime: t0 + i,
          endTime: t0 + i + seconds * 1000,
        })),
      },
    ];
    const A = "src/__tests__/__integration__/a.integration.test.ts";
    const B = "src/__tests__/__integration__/b.integration.test.ts";
    const N = "src/__tests__/__integration__/new.integration.test.ts";
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return [
      {
        name: "mergeRuns: each file's median across runs, so one noisy run doesn't skew it",
        run: () =>
          same(
            mergeRuns([run({ [A]: 20, [B]: 1 }, 0), run({ [A]: 46, [B]: 23 }, 1e6), run({ [A]: 22, [B]: 1.2 }, 2e6)], [A, B]),
            { [A]: 22, [B]: 1.2 }
          ),
      },
      {
        name: "mergeRuns: a file only some runs have uses the samples it has",
        run: () =>
          same(mergeRuns([run({ [A]: 10 }, 0), run({ [A]: 12, [N]: 7 }, 1e6)], [A, N]), { [A]: 11, [N]: 7 }),
      },
      {
        name: "mergeRuns: a run repeated verbatim (a turbo-cached re-run) counts once",
        run: () => {
          const cached = run({ [A]: 40 }, 5);
          return same(mergeRuns([cached, cached, run({ [A]: 10 }, 1e6)], [A]), { [A]: 25 });
        },
      },
    ];
  })(),
  {
    name: "durationsChanged: a file added or removed is a change",
    run: () => durationsChanged({ a: 10 }, { a: 10, b: 1 }) && durationsChanged({ a: 10, b: 1 }, { a: 10 }),
  },
  {
    name: "durationsChanged: per-file swings with a steady total are noise, not a change",
    // Measured between two CI runs of one commit (#857): the first suite on
    // each runner pays the module compile, so files trade seconds as the
    // split changes while the total barely moves.
    run: () => !durationsChanged({ a: 22.9, b: 0.8, c: 57.1, d: 100 }, { a: 1.1, b: 8.5, c: 28.5, d: 140 }),
  },
  {
    name: "durationsChanged: the total moving over 10% is a change (the shard count may move)",
    run: () => durationsChanged({ a: 100, b: 100 }, { a: 115, b: 115 }),
  },
  {
    name: "durationsChanged: one file moving over 30s and 50% is a change (it may near the ceiling)",
    run: () => durationsChanged({ a: 40, b: 500 }, { a: 75, b: 470 }),
  },
  {
    name: "ceilingViolations: a file over the ceiling is listed with its seconds",
    run: () => {
      const v = ceilingViolations({ "src/slow.integration.test.ts": 121, "src/ok.integration.test.ts": 120 }, []);
      return v.length === 1 && v[0].file === "src/slow.integration.test.ts" && v[0].seconds === 121;
    },
  },
  {
    name: "ceilingViolations: an allowlisted file is not listed",
    run: () => ceilingViolations({ "src/slow.integration.test.ts": 300 }, [{ file: "src/slow.integration.test.ts", reason: "x" }]).length === 0,
  },
  {
    name: "isIntegrationTestPath: only what Jest's testMatch runs (under __tests__/__integration__/)",
    run: () =>
      isIntegrationTestPath("src/__tests__/__integration__/routes/a.integration.test.ts") &&
      isIntegrationTestPath("src/modules/__tests__/__integration__/b.integration.test.ts") &&
      !isIntegrationTestPath("src/services/c.integration.test.ts") &&
      !isIntegrationTestPath("src/__tests__/__integration__/d.test.ts"),
  },
  {
    name: "parseDurations: a valid file parses",
    run: () => JSON.stringify(parseDurations('{"src/a.integration.test.ts": 1.5}')) === '{"src/a.integration.test.ts":1.5}',
  },
  ...['{"a": 1', "[1, 2]", '{"a": "fast"}', "null"].map((text) => ({
    name: `parseDurations: refuses malformed content ${JSON.stringify(text)}`,
    run: () => {
      try {
        parseDurations(text);
        return false;
      } catch {
        return true;
      }
    },
  })),
  ...[
    [{}, 5, false, "no recorded durations → the fallback"],
    [{ a: 50 }, 2, false, "a small suite → MIN"],
    [{ a: 688 }, 5, false, "today's ~688s of CI time → 5"],
    [{ a: 1500 }, 10, false, "1,500s → exactly the cap"],
    [{ a: 5000 }, 10, true, "5,000s → the cap, flagged"],
  ].map(([durations, count, capped, label]) => ({
    name: `planShards: ${label}`,
    run: () => {
      const plan = planShards(durations);
      return (
        plan.count === count &&
        plan.capped === capped &&
        JSON.stringify(plan.matrix) === JSON.stringify({ index: Array.from({ length: count }, (_, i) => i + 1) })
      );
    },
  })),
  ...(() => {
    const file = (shard, i) => `src/__tests__/__integration__/s${shard}-${i}.integration.test.ts`;
    /** A shard's Jest report: `suites` suites of `seconds` each, or the
     *  files named in `files`. */
    const shardReport = (shard, suites, seconds = 10, failed = 0, files) => {
      const names = files ?? Array.from({ length: suites }, (_, i) => file(shard, i));
      return {
        shard,
        report: {
          numTotalTestSuites: names.length,
          numFailedTestSuites: failed,
          testResults: names.map((f) => ({
            name: `/home/runner/work/portal-ai/portal-ai/apps/api/${f}`,
            startTime: 0,
            endTime: seconds * 1000,
          })),
        },
      };
    };
    const expectedFiles = [1, 2].flatMap((shard) => [0, 1, 2].map((i) => file(shard, i)));
    const green = {
      changesResult: "success",
      run: "true",
      planResult: "success",
      shardResult: "success",
      plannedCount: 2,
      expectedFiles,
      capped: false,
      reports: [shardReport(1, 3), shardReport(2, 3)],
    };
    const verdict = (over) => summaryVerdict({ ...green, ...over });
    return [
      {
        name: "summaryVerdict: a docs-only skip is green, with no shard",
        run: () => {
          const v = verdict({ run: "false", planResult: "skipped", shardResult: "skipped", reports: [] });
          return v.ok && v.skipped;
        },
      },
      {
        name: "summaryVerdict: the skip decision itself failing is red",
        run: () => !verdict({ changesResult: "failure", run: "" }).ok,
      },
      {
        name: "summaryVerdict: a cancelled shard is red, never green",
        run: () => !verdict({ shardResult: "cancelled" }).ok,
      },
      {
        name: "summaryVerdict: a failed plan is red",
        run: () => !verdict({ planResult: "failure" }).ok,
      },
      {
        name: "summaryVerdict: a missing shard report is red",
        run: () => !verdict({ reports: [shardReport(1, 3)] }).ok,
      },
      {
        name: "summaryVerdict: a file run in two shards and another in none is red, naming both, though the counts match",
        run: () => {
          const twice = file(1, 0);
          const never = file(2, 2);
          const v = verdict({
            reports: [shardReport(1, 3), shardReport(2, 3, 10, 0, [file(2, 0), file(2, 1), twice])],
          });
          return (
            !v.ok &&
            v.errors.some((e) => e.includes(twice) && /more than one shard/.test(e)) &&
            v.errors.some((e) => e.includes(never) && /no shard/.test(e))
          );
        },
      },
      {
        name: "summaryVerdict: a test file that no shard ran is red, by name",
        run: () => {
          const extra = "src/__tests__/__integration__/new.integration.test.ts";
          const v = verdict({ expectedFiles: [...expectedFiles, extra] });
          return !v.ok && v.errors.some((e) => e.includes(extra));
        },
      },
      {
        name: "summaryVerdict: a failed suite is red",
        run: () => !verdict({ reports: [shardReport(1, 3, 10, 1), shardReport(2, 3)] }).ok,
      },
      {
        name: "summaryVerdict: every shard green and every file counted is green, without warnings",
        run: () => {
          const v = verdict({});
          return v.ok && !v.skipped && v.errors.length === 0 && v.warnings.length === 0;
        },
      },
      {
        name: "summaryVerdict: a shard well over budget warns but stays green",
        run: () => {
          const v = verdict({ reports: [shardReport(1, 3, 100), shardReport(2, 3)] });
          return v.ok && v.warnings.some((w) => /shard 1/.test(w));
        },
      },
      {
        name: "summaryVerdict: a capped plan warns but stays green",
        run: () => {
          const v = verdict({ capped: true });
          return v.ok && v.warnings.some((w) => /cap/.test(w));
        },
      },
    ];
  })(),
];

function selfTest() {
  let failed = 0;
  for (const c of CASES) {
    let ok;
    let detail = "";
    try {
      ok = c.run() === true;
    } catch (err) {
      ok = false;
      detail = ` — threw ${err?.message ?? err}`;
    }
    console.log(`${ok ? "✓" : "✗"} ${c.name}${detail}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`integration-shards self-test: ${failed} of ${CASES.length} case(s) failed`);
    return false;
  }
  console.log(`integration-shards self-test: ${CASES.length} case(s) passed`);
  return true;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** Every *.json file under `dir`, recursively (one per shard artifact). A
 *  missing dir is no reports, which the summary turns into a clear error. */
const jsonFilesUnder = (dir) =>
  (existsSync(dir) ? readdirSync(dir, { recursive: true }) : [])
    .map(String)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));

/** The integration test files the checkout has, relative to apps/api: the
 *  ones Jest's integration config runs, by the same rule. */
const integrationFiles = () =>
  readdirSync(path.join(REPO_ROOT, "apps/api/src"), { recursive: true })
    .map((f) => path.posix.join("src", String(f).split(path.sep).join("/")))
    .filter(isIntegrationTestPath)
    .sort();

/**
 * The committed durations. A missing file reads as "nothing recorded" only
 * when `allowMissing`; a malformed one always throws, so the lint and the
 * planner fail on it instead of quietly losing the balance.
 */
const readDurations = ({ allowMissing }) => {
  const file = path.join(REPO_ROOT, DURATIONS_FILE);
  if (!existsSync(file)) {
    if (allowMissing) return {};
    throw new Error(`${DURATIONS_FILE} is missing`);
  }
  return parseDurations(readFileSync(file, "utf8"));
};

/** A GitHub Actions step output; a no-op outside Actions. */
const setOutput = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

const argValue = (flag) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
};

function checkDurations() {
  const durations = readDurations({ allowMissing: false });
  const over = ceilingViolations(durations, CEILING_ALLOWLIST);
  if (over.length) {
    for (const { file, seconds } of over) {
      console.error(
        `✗ apps/api/${file}: ${seconds}s, over the ${FILE_CEILING_SECONDS}s ceiling. A file can't be split ` +
          `across shards, so it sets the floor on its shard's time: split it by concern (as the ` +
          `demo-seed suite was, #857), or add it to CEILING_ALLOWLIST with a reason.`
      );
    }
    return false;
  }
  console.log(`integration durations: ${Object.keys(durations).length} file(s) within ${FILE_CEILING_SECONDS}s`);
  return true;
}

function updateDurations() {
  const dir = argValue("--reports");
  if (!dir) {
    console.error("update-durations needs --reports <dir>");
    return false;
  }
  // `<dir>/integration-jest-*/` is one run's shard artifacts; otherwise each
  // subdirectory of <dir> is a run (as the refresh workflow lays them out).
  const entries = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  const singleRun = entries.some((e) => e.name.startsWith("integration-jest-"));
  const runDirs = singleRun
    ? [dir]
    : entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  const runs = runDirs.map((d) => jsonFilesUnder(d).map((f) => readJson(f, {})));
  console.log(`sampling ${runs.length} run(s)`);
  const next = mergeRuns(runs, integrationFiles());
  if (Object.keys(next).length === 0) {
    console.error(`no integration test results found under ${dir}`);
    return false;
  }
  const target = path.join(REPO_ROOT, DURATIONS_FILE);
  const prev = readDurations({ allowMissing: true });
  const changed = durationsChanged(prev, next);
  setOutput("changed", String(changed));

  const added = Object.keys(next).filter((f) => !(f in prev));
  const removed = Object.keys(prev).filter((f) => !(f in next));
  console.log(`added ${added.length}, removed ${removed.length}, files ${Object.keys(next).length}`);
  for (const f of added) console.log(`  + ${f} (${next[f]}s)`);
  for (const f of removed) console.log(`  - ${f}`);
  for (const { file, seconds } of ceilingViolations(next, CEILING_ALLOWLIST)) {
    console.log(`  ! ${file}: ${seconds}s is over the ${FILE_CEILING_SECONDS}s ceiling`);
  }

  if (process.argv.includes("--if-changed") && !changed) {
    console.log("durations unchanged beyond noise; nothing written");
    return true;
  }
  writeFileSync(target, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote ${DURATIONS_FILE}`);
  return true;
}

function plan() {
  // Missing means nothing recorded yet (the fallback count); malformed throws.
  const result = planShards(readDurations({ allowMissing: true }));
  setOutput("count", String(result.count));
  setOutput("matrix", JSON.stringify(result.matrix));
  setOutput("capped", String(result.capped));
  console.log(JSON.stringify(result));
  return true;
}

function summarize() {
  const dir = argValue("--reports");
  // Each shard's artifact lands in its own `integration-jest-<i>/` folder.
  const reports = dir
    ? jsonFilesUnder(dir).map((file) => ({
        shard: Number(/integration-jest-(\d+)/.exec(file)?.[1] ?? 0),
        report: readJson(file, {}),
      }))
    : [];
  const env = process.env;
  const verdict = summaryVerdict({
    changesResult: env.CHANGES_RESULT ?? "",
    run: env.RUN ?? "",
    planResult: env.PLAN_RESULT ?? "",
    shardResult: env.SHARD_RESULT ?? "",
    plannedCount: Number(env.PLANNED_COUNT ?? 0),
    capped: env.CAPPED === "true",
    expectedFiles: integrationFiles(),
    reports,
  });

  for (const e of verdict.errors) console.log(`::error title=Integration Tests::${e}`);
  for (const w of verdict.warnings) console.log(`::warning title=Integration Tests::${w}`);
  console.log(verdict.table);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      [
        "## Integration Tests",
        "",
        verdict.table,
        "",
        ...verdict.errors.map((e) => `- ❌ ${e}`),
        ...verdict.warnings.map((w) => `- ⚠️ ${w}`),
        "",
      ].join("\n")
    );
  }
  return verdict.ok;
}

const COMMANDS = {
  "sample-runs": () => {
    console.log(SAMPLE_RUNS);
    return true;
  },
  "--self-test": selfTest,
  plan,
  summarize,
  "check-durations": checkDurations,
  "update-durations": updateDurations,
};

const run = COMMANDS[process.argv[2]];
if (!run) {
  console.error(`usage: node scripts/integration-shards.mjs <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(2);
}
let ok;
try {
  ok = run();
} catch (err) {
  console.error(`✗ ${err?.message ?? err}`);
  ok = false;
}
process.exit(ok ? 0 : 1);
