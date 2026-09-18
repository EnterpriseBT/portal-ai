/**
 * Integration tests for the `db:upgrade` entrypoint (#581 slice 1).
 *
 * `runUpgrade()` composes the EXISTING session-scoped advisory lock
 * (`SyncLockService.withAdvisoryLock`, #460/#472), the resolver-aware
 * `runMigrations` (#505), and the idempotent `SeedService.seed`. The lock's
 * own behavior is covered by the sync-lock suite; here we prove the
 * orchestration: idempotent no-op re-run, fail-closed skip when another
 * upgrade holds the lock, lock-release on a migrate failure, and that the
 * migrate step is the resolver-aware `runMigrations` (not a re-implementation).
 *
 * The shared test DB is already migrated by global setup (migrate() no-ops on
 * a reused container), so `migrationsApplied` is 0 on the happy path — which is
 * exactly the "safe to re-run" invariant the ticket requires.
 */

import { describe, it, expect, jest } from "@jest/globals";

import {
  runUpgrade,
  withUpgradeLock,
  DEFAULT_UPGRADE_STEPS,
  type UpgradeSteps,
} from "../../../scripts/db-upgrade.js";
import { runMigrations } from "../../../scripts/db-migrate.js";

describe("db:upgrade — runUpgrade", () => {
  // ── Case 1 — happy path against the (already-migrated) test DB ─────

  it("acquires the lock, migrates, seeds, and reports a summary", async () => {
    const summary = await runUpgrade();

    expect(summary.acquiredLock).toBe(true);
    expect(summary.seedOk).toBe(true);
    // Already migrated by global setup → a re-run applies nothing.
    expect(summary.migrationsApplied).toBe(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Case 2 — a second run is a safe no-op ─────────────────────────

  it("is a safe no-op when re-run", async () => {
    await runUpgrade();
    const second = await runUpgrade();

    expect(second.acquiredLock).toBe(true);
    expect(second.migrationsApplied).toBe(0);
    expect(second.seedOk).toBe(true);
  });

  // ── Case 3 — lock already held ⇒ skip, no migrate/seed ────────────

  it("does not migrate or seed when the upgrade lock is already held", async () => {
    const migrate = jest.fn<UpgradeSteps["migrate"]>().mockResolvedValue();
    const seed = jest.fn<UpgradeSteps["seed"]>().mockResolvedValue();

    // Hold the real upgrade lock on an outer session, then run inside it —
    // the inner runUpgrade reserves a second connection and cannot acquire.
    const outcome = await withUpgradeLock(async () => {
      return runUpgrade({
        countMigrations: async () => 0,
        migrate,
        seed,
        withLock: withUpgradeLock,
      });
    });

    // The outer lock ran fn; its value is the inner summary.
    expect(outcome.acquired).toBe(true);
    const inner = outcome.acquired ? outcome.value : null;
    expect(inner?.acquiredLock).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
  });

  // ── Case 4 — a migrate failure rejects and releases the lock ──────

  it("propagates a migrate failure and releases the lock", async () => {
    const seed = jest.fn<UpgradeSteps["seed"]>().mockResolvedValue();
    const failingSteps: UpgradeSteps = {
      countMigrations: async () => 0,
      migrate: async () => {
        throw new Error("migrate boom");
      },
      seed,
      withLock: withUpgradeLock,
    };

    await expect(runUpgrade(failingSteps)).rejects.toThrow("migrate boom");
    expect(seed).not.toHaveBeenCalled();

    // Lock was released despite the throw → a normal run acquires again.
    const after = await runUpgrade();
    expect(after.acquiredLock).toBe(true);
  });

  // ── Case 5 — migrate delegates to the resolver-aware runMigrations ─

  it("uses the resolver-aware runMigrations as its migrate step (#505)", () => {
    expect(DEFAULT_UPGRADE_STEPS.migrate).toBe(runMigrations);
  });
});
