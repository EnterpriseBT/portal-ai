import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  SyncLockService,
  UPGRADE_LOCK_NAMESPACE,
} from "../services/sync-lock.service.js";
import { SeedService } from "../services/seed.service.js";
import { createLogger } from "../utils/logger.util.js";
import { runMigrations } from "./db-migrate.js";

const logger = createLogger({ module: "db-upgrade" });

/**
 * Per-install upgrade entrypoint (#581).
 *
 * One safe, idempotent operation that a customer's `helm upgrade` (or our own
 * `portalops db upgrade`) runs on their maintenance window: apply pending
 * schema migrations + the `0080`-style per-org data backfills that ride them
 * (the resolver-aware `runMigrations`, #505/#500), then run the idempotent
 * global bootstrap seed. The whole thing is held under the EXISTING
 * session-scoped advisory lock (`SyncLockService.withAdvisoryLock`, #460/#472),
 * so two concurrent passes never both migrate — the second reports
 * `acquiredLock: false` and does nothing.
 *
 * Forward-only, expand-only: a failed migrate leaves the schema in whatever
 * forward state it reached (valid under the previous image), so `helm upgrade
 * --atomic` can roll the workloads back while the schema stays serviceable.
 * The entrypoint maps the summary to an exit code — a non-zero exit is the
 * fail-closed signal an operator (or Helm) acts on.
 */

/** The constant subject id for the singleton upgrade lock. */
export const UPGRADE_LOCK_KEY = "db-upgrade";

export interface UpgradeSummary {
  /** false ⇒ another upgrade held the lock; nothing ran. */
  acquiredLock: boolean;
  /** `drizzle.__drizzle_migrations` row-count delta across the migrate step. */
  migrationsApplied: number;
  /** the global bootstrap seed step completed. */
  seedOk: boolean;
  durationMs: number;
}

/**
 * The upgrade's steps, injectable so the orchestration is testable without a
 * real migration/seed side effect while still exercising the real lock.
 */
export interface UpgradeSteps {
  countMigrations: () => Promise<number>;
  migrate: () => Promise<void>;
  seed: () => Promise<void>;
  withLock: <T>(
    fn: () => Promise<T>
  ) => Promise<{ acquired: true; value: T } | { acquired: false }>;
}

/** Run `fn` under the singleton upgrade advisory lock (reuse, not reinvent). */
export function withUpgradeLock<T>(
  fn: () => Promise<T>
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  return SyncLockService.withAdvisoryLock(
    UPGRADE_LOCK_NAMESPACE,
    UPGRADE_LOCK_KEY,
    fn,
    { event: "db-upgrade.lock", subject: "upgrade" }
  );
}

async function countAppliedMigrations(): Promise<number> {
  // The drizzle journal table lives in the `drizzle` schema. Reading it is the
  // only way to report how many files this pass applied — `migrate()` returns
  // nothing. Log-only; a fragile read degrades to a count, never a failure.
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"`
  )) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

export const DEFAULT_UPGRADE_STEPS: UpgradeSteps = {
  countMigrations: countAppliedMigrations,
  migrate: runMigrations,
  // `SeedService.seed()` is bootstrap-idempotent (insert-if-absent) and swallows
  // its own errors with a rollback; `seedOk` therefore means "the seed step
  // completed". Migration failure is the fail-closed signal that gates the exit.
  seed: () => new SeedService().seed(),
  withLock: withUpgradeLock,
};

/**
 * Acquire the upgrade lock, then migrate → seed. Returns a summary; throws if
 * migrate (or an injected seed) fails, in which case the lock is released by
 * `withAdvisoryLock`'s `finally` and the entrypoint exits non-zero.
 */
export async function runUpgrade(
  steps: UpgradeSteps = DEFAULT_UPGRADE_STEPS
): Promise<UpgradeSummary> {
  const start = Date.now();

  const outcome = await steps.withLock(async () => {
    const before = await steps.countMigrations();
    await steps.migrate();
    const after = await steps.countMigrations();
    await steps.seed();
    return after - before;
  });

  if (!outcome.acquired) {
    logger.warn("UPGRADE SKIPPED: another upgrade is already running");
    return {
      acquiredLock: false,
      migrationsApplied: 0,
      seedOk: false,
      durationMs: Date.now() - start,
    };
  }

  const summary: UpgradeSummary = {
    acquiredLock: true,
    migrationsApplied: outcome.value,
    seedOk: true,
    durationMs: Date.now() - start,
  };
  logger.info(
    { summary },
    `UPGRADE COMPLETE (migrations: ${summary.migrationsApplied}, seed: ok)`
  );
  return summary;
}

// Run only as an entrypoint (`node dist/scripts/db-upgrade.js`), never on import
// — the tests import `runUpgrade`/`withUpgradeLock` without triggering a run.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runUpgrade()
    .then((summary) => {
      // Fail-closed: a skipped (lock-held) or unseeded upgrade is not a success.
      process.exit(summary.acquiredLock && summary.seedOk ? 0 : 1);
    })
    .catch((error) => {
      logger.error({ error }, `UPGRADE FAILED: ${(error as Error).message}`);
      process.exit(1);
    });
}
