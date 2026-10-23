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
 *   check-durations                     fail on a file over the ceiling (lint:integration-durations)
 *   update-durations --reports <dir> [--if-changed]
 *                                       rewrite durations.json from Jest JSON reports
 */

import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assignShards } from "../apps/api/jest.integration.sequencer.mjs";
import {
  CEILING_ALLOWLIST,
  DURATIONS_FILE,
  FILE_CEILING_SECONDS,
  ceilingViolations,
  durationsChanged,
  mergeReports,
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
  {
    name: "durationsChanged: a file added or removed is a change",
    run: () => durationsChanged({ a: 10 }, { a: 10, b: 1 }) && durationsChanged({ a: 10, b: 1 }, { a: 10 }),
  },
  {
    name: "durationsChanged: a small move is not a change (under 20% or under 5s)",
    run: () => !durationsChanged({ a: 10, b: 100 }, { a: 14, b: 115 }),
  },
  {
    name: "durationsChanged: a move over 20% and 5s is a change",
    run: () => durationsChanged({ a: 100 }, { a: 130 }),
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

/** Every *.json file under `dir`, recursively (one per shard artifact). */
const jsonFilesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));

/** The integration test files the checkout has, relative to apps/api. */
const integrationFiles = () =>
  readdirSync(path.join(REPO_ROOT, "apps/api/src"), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".integration.test.ts"))
    .map((f) => path.posix.join("src", f.split(path.sep).join("/")));

/** A GitHub Actions step output; a no-op outside Actions. */
const setOutput = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

const argValue = (flag) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
};

function checkDurations() {
  const durations = readJson(path.join(REPO_ROOT, DURATIONS_FILE), {});
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
  const reports = jsonFilesUnder(dir).map((f) => readJson(f, {}));
  const next = mergeReports(reports, integrationFiles());
  if (Object.keys(next).length === 0) {
    console.error(`no integration test results found under ${dir}`);
    return false;
  }
  const target = path.join(REPO_ROOT, DURATIONS_FILE);
  const prev = readJson(target, {});
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

const COMMANDS = {
  "--self-test": selfTest,
  "check-durations": checkDurations,
  "update-durations": updateDurations,
};

const run = COMMANDS[process.argv[2]];
if (!run) {
  console.error(`usage: node scripts/integration-shards.mjs <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(2);
}
process.exit(run() ? 0 : 1);
