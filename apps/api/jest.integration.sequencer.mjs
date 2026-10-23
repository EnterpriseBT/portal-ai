/**
 * Integration suite sequencer (#857): balances `--shard=i/N` by recorded
 * duration instead of Jest's default path-hash split.
 *
 * CI runs the suite as N shards, one per runner (`INTEGRATION_SHARD`, see
 * `test:integration` in package.json). A path-hash split can stack the heavy
 * files on one shard, and the check is only as fast as its slowest shard.
 * `shard()` here bin-packs by `durations.json` instead. Jest calls it only when
 * `--shard` is passed, so a local `npm run test:integration` is untouched.
 *
 * This file and `durations.json` both live in apps/api on purpose: turbo
 * hashes the package's files into `test:integration`'s cache key, so a change
 * to either re-runs every shard rather than restoring a cached "pass" for a
 * shard whose files have changed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import TestSequencerModule from "@jest/test-sequencer";

// Under ESM interop the CommonJS class arrives as `.default`.
const BaseSequencer = TestSequencerModule.default ?? TestSequencerModule;

/** Seconds per test file, keyed by path relative to apps/api. */
export const DURATIONS_PATH = "src/__tests__/__integration__/durations.json";

const median = (values) => {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Longest-processing-time bin packing. Pure and deterministic: files are
 * placed heaviest first (ties by path), each onto the currently lightest
 * shard (ties to the lowest index). A file with no recorded duration weighs
 * the median of the known ones, so new files spread out rather than piling
 * onto one shard. Every file lands in exactly one shard.
 *
 * @param {string[]} files paths relative to apps/api
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

function readDurations(rootDir) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, DURATIONS_PATH), "utf8"));
  } catch {
    // Missing or unreadable: every file weighs the same, so the split is by
    // count. Still a partition, just not balanced by time.
    return {};
  }
}

export default class IntegrationSequencer extends BaseSequencer {
  /** Jest's shard hook. `shardIndex` is 1-based. */
  shard(tests, { shardIndex, shardCount }) {
    if (tests.length === 0) return tests;
    const rootDir = tests[0].context.config.rootDir;
    const relative = (t) => path.relative(rootDir, t.path).split(path.sep).join("/");
    const mine = new Set(
      assignShards(tests.map(relative), readDurations(rootDir), shardCount)[
        shardIndex - 1
      ]
    );
    return tests.filter((t) => mine.has(relative(t)));
  }
}
