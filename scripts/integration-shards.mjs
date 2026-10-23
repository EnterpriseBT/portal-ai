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
 * Usage: node scripts/integration-shards.mjs --self-test
 */

import { assignShards } from "../apps/api/jest.integration.sequencer.mjs";

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

const [command] = process.argv.slice(2);
if (command === "--self-test") {
  process.exit(selfTest() ? 0 : 1);
} else {
  console.error("usage: node scripts/integration-shards.mjs --self-test");
  process.exit(2);
}
