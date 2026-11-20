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
 * The packing (`assignShards`) is shared with the web unit suite's sequencer
 * and lives in `scripts/test-shards.lib.mjs` (#1091). Turbo hashes it into
 * `test:integration` through that task's `inputs`, and this file and
 * `durations.json` through the package's own files, so a change to any of
 * them re-runs every shard rather than restoring a cached "pass" for a shard
 * whose files have changed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import TestSequencerModule from "@jest/test-sequencer";

import { assignShards } from "../../scripts/test-shards.lib.mjs";

// Under ESM interop the CommonJS class arrives as `.default`.
const BaseSequencer = TestSequencerModule.default ?? TestSequencerModule;

/** Seconds per test file, keyed by path relative to apps/api. */
export const DURATIONS_PATH = "src/__tests__/__integration__/durations.json";

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
