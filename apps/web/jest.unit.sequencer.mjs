/**
 * Web unit suite sequencer (#1091): balances `--shard=i/N` by recorded
 * duration instead of Jest's default path-hash split.
 *
 * CI runs the suite as N shards, one per runner (`WEB_UNIT_SHARD`, see
 * `test:unit` in package.json). A path-hash split balances file counts, not
 * time, and the RegionEditor and workflow suites are several times heavier
 * than a component test; the check is only as fast as its slowest shard.
 * `shard()` here bin-packs by `src/__tests__/durations.json` instead, with the
 * packing the integration suite uses (`assignShards`, shared from
 * `scripts/test-shards.lib.mjs`). Jest calls it only when `--shard` is passed,
 * so a local `npm run test:unit` is untouched.
 *
 * Turbo hashes the shared lib into this package's `test:unit` through
 * `apps/web/turbo.json`'s `inputs`, and this file and the durations through
 * the package's own files, so a change to any of them re-runs every shard
 * rather than restoring a cached "pass" for a shard whose files have changed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import TestSequencerModule from "@jest/test-sequencer";

import { assignShards } from "../../scripts/test-shards.lib.mjs";

// Under ESM interop the CommonJS class arrives as `.default`.
const BaseSequencer = TestSequencerModule.default ?? TestSequencerModule;

/** Seconds per test file, keyed by path relative to apps/web. */
export const DURATIONS_PATH = "src/__tests__/durations.json";

function readDurations(rootDir) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, DURATIONS_PATH), "utf8"));
  } catch {
    // Missing (before the first recording) or unreadable: every file weighs
    // the same, so the split is by count. Still a partition, just not
    // balanced by time.
    return {};
  }
}

export default class WebUnitSequencer extends BaseSequencer {
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
