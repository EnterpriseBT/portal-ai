/**
 * Web unit suite sequencer (#1091): balances `--shard=i/N` by recorded
 * duration instead of Jest's default path-hash split.
 *
 * CI runs the suite as N shards, one per runner (`WEB_UNIT_SHARD`, see
 * `test:unit` in package.json). A path-hash split balances file counts, not
 * time, and the RegionEditor and workflow suites are several times heavier
 * than a component test; the check is only as fast as its slowest shard.
 * The class is the shared `durationSequencer` from
 * `scripts/test-shards.lib.mjs`, the integration suite's too, over
 * `src/__tests__/durations.json`. Jest calls it only when `--shard` is
 * passed, so a local `npm run test:unit` is untouched.
 *
 * Turbo hashes the shared lib into this package's `test:unit` through
 * `apps/web/turbo.json`'s `inputs`, and this file and the durations through
 * the package's own files, so a change to any of them re-runs every shard
 * rather than restoring a cached "pass" for a shard whose files have changed.
 */

import TestSequencerModule from "@jest/test-sequencer";

import { durationSequencer } from "../../scripts/test-shards.lib.mjs";

// Under ESM interop the CommonJS class arrives as `.default`.
const BaseSequencer = TestSequencerModule.default ?? TestSequencerModule;

/** Seconds per test file, keyed by path relative to apps/web. */
export const DURATIONS_PATH = "src/__tests__/durations.json";

export default durationSequencer(BaseSequencer, DURATIONS_PATH);
