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
 * The class is the shared `durationSequencer` from
 * `scripts/test-shards.lib.mjs`, the web unit suite's too (#1091). Turbo hashes it into
 * `test:integration` through that task's `inputs`, and this file and
 * `durations.json` through the package's own files, so a change to any of
 * them re-runs every shard rather than restoring a cached "pass" for a shard
 * whose files have changed.
 */

import TestSequencerModule from "@jest/test-sequencer";

import { durationSequencer } from "../../scripts/test-shards.lib.mjs";

// Under ESM interop the CommonJS class arrives as `.default`.
const BaseSequencer = TestSequencerModule.default ?? TestSequencerModule;

/** Seconds per test file, keyed by path relative to apps/api. */
export const DURATIONS_PATH = "src/__tests__/__integration__/durations.json";

export default durationSequencer(BaseSequencer, DURATIONS_PATH);
