import { reserveConnection } from "../db/client.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "sync-lock" });

/**
 * Namespace for this application's advisory locks (#460).
 *
 * `pg_try_advisory_lock` has a single global keyspace per database, so the
 * two-int form is used with this constant as the first key — otherwise a
 * `hashtext` collision with any other advisory-lock user (an extension, a
 * migration tool, a future feature) would silently block a sync.
 *
 * `0x5359_4e43` is ASCII "SYNC".
 */
export const SYNC_LOCK_NAMESPACE = 0x5359_4e43;

/**
 * Advisory-lock namespace for the dissolve-precompute job (#472), keyed by
 * `portalResultId` so two refreshes of one pin cannot dissolve concurrently.
 * Distinct from `SYNC_LOCK_NAMESPACE` so a pin lock and an instance-sync lock
 * never collide in Postgres's single advisory keyspace. `0x4453_4c56` is ASCII
 * "DSLV".
 */
export const DISSOLVE_LOCK_NAMESPACE = 0x4453_4c56;

export type SyncLockOutcome<T> =
  | { acquired: true; value: T }
  | { acquired: false };

/**
 * Thrown by {@link SyncLockService.withInstanceLockWait} when the wait budget
 * elapses (#461). A distinct class so callers can tell "I never owned the
 * work" apart from "the work failed": a commit pass that times out here must
 * NOT run failure cleanup (e.g. the draft rollback) — the lock holder is
 * still alive and still writing the very rows that cleanup would delete.
 */
export class SyncLockWaitTimeoutError extends Error {
  constructor(timeoutMs: number, connectorInstanceId: string) {
    super(
      `Timed out after ${timeoutMs}ms waiting for the sync lock on connector instance ${connectorInstanceId}`
    );
    this.name = "SyncLockWaitTimeoutError";
  }
}

/**
 * Ownership lock for the operations that reap by watermark (#460).
 *
 * **Why this exists.** A connector sync can be re-delivered by BullMQ while
 * its first invocation is still running, so two passes execute over one
 * instance. Each pass ends by soft-deleting "everything older than my
 * watermark", so the later pass deletes the earlier pass's still-in-flight
 * writes. Measured: 34,000 records lost from a 397,960-record layer, on a job
 * reporting `completed` with internally consistent counts.
 *
 * **Why a predicate cannot fix it.** "Rows this pass did not touch" is
 * *correct* from each pass's own point of view — pass B genuinely had not
 * written those rows when it looked. Scoping the reap to a generation does not
 * help either: both passes of one job share a generation key (#439) and write
 * identical `source_id`s; giving them distinct generations inverts the failure
 * into duplication. The premise that one pass is the only writer is what is
 * wrong, so a pass must establish ownership.
 *
 * **Why a Postgres session lock and not a Redis TTL lease.** BullMQ
 * re-delivered the job precisely *because it guessed wrong* about whether the
 * first pass was alive — its lock renewal was starved by a 6.5-minute reap. A
 * TTL lease answers "is the holder alive?" with another timer, starved by the
 * same reap. A session lock lets the database answer: the holder's connection
 * is open, or it is not. If the process dies, the TCP session drops and the
 * lock is gone with no renewal, no TTL, and no operator action. That property
 * is asserted against a real server in `sync-lock.integration.test.ts`.
 */
export class SyncLockService {
  /**
   * Run `fn` while holding an exclusive advisory lock on
   * `connectorInstanceId`. Returns `{ acquired: false }` **without running
   * `fn`** when another live session holds it.
   *
   * Keyed by *instance* rather than entity: a sync is already scoped to an
   * instance, and `layout_plan_commit` — the other reaper — carries the same
   * id in its metadata, so one key covers both. It matches the key the
   * job-level entity lock already uses (`CLAUDE.md` → "Async Job State").
   *
   * Fail-closed by construction: a caller that cannot prove ownership does no
   * work. A delayed sync costs time; an optimistic reap costs customer data.
   */
  static async withInstanceLock<T>(
    connectorInstanceId: string,
    fn: () => Promise<T>
  ): Promise<SyncLockOutcome<T>> {
    return SyncLockService.withAdvisoryLock(
      SYNC_LOCK_NAMESPACE,
      connectorInstanceId,
      fn,
      { event: "sync-lock", subject: "connectorInstanceId" }
    );
  }

  /**
   * Like {@link withInstanceLock}, but **waits** for the lock instead of
   * aborting, polling the same try-acquire until `timeoutMs` elapses (#461).
   *
   * Exists for `layout_plan_commit` only: unlike a sync, a user is actively
   * blocked in a live wizard, so a delayed commit beats a skipped one — and a
   * pass that reported "superseded" would terminate the shared job row with a
   * false result while the real pass is still writing. The non-blocking
   * contract above stays the right call for syncs; do not migrate them here.
   *
   * Throws on timeout rather than returning an outcome: by then the holder is
   * presumed dead but its session has not dropped, and handing the attempt
   * back to BullMQ (via `statusForFailedAttempt`, #441) is the only honest
   * move left. Always runs `fn` otherwise.
   *
   * The reserved connection is held for the whole wait — a session lock must
   * be taken on the session that runs `fn`. Bounded by the jobs worker's
   * concurrency, so it stays well inside the pool headroom `reserveConnection`
   * documents.
   */
  static async withInstanceLockWait<T>(
    connectorInstanceId: string,
    fn: () => Promise<T>,
    opts: { timeoutMs: number; pollMs?: number }
  ): Promise<T> {
    const pollMs = opts.pollMs ?? 5_000;
    const deadline = Date.now() + opts.timeoutMs;
    const reserved = await reserveConnection();
    let held = false;

    try {
      for (;;) {
        const rows = (await reserved.unsafe(
          `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
          [SYNC_LOCK_NAMESPACE, connectorInstanceId]
        )) as unknown as Array<{ locked: boolean }>;
        held = rows[0]?.locked === true;
        if (held) break;

        if (Date.now() + pollMs > deadline) {
          logger.warn(
            { event: "sync-lock.wait-timeout", connectorInstanceId },
            "Advisory lock not released within the wait budget — returning this attempt to the queue"
          );
          throw new SyncLockWaitTimeoutError(
            opts.timeoutMs,
            connectorInstanceId
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      return await fn();
    } finally {
      if (held) {
        try {
          await reserved.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
            SYNC_LOCK_NAMESPACE,
            connectorInstanceId,
          ]);
        } catch (err) {
          // Same rationale as withAdvisoryLock: never mask fn's error, and the
          // lock dies with the session — losing the connection would be worse.
          logger.error(
            { event: "sync-lock.unlock-failed", connectorInstanceId, err },
            "Advisory unlock failed; the lock will be released when this session ends"
          );
        }
      }
      reserved.release();
    }
  }

  /**
   * Run `fn` while holding a session-scoped Postgres advisory lock on
   * `(namespace, hashtext(key))`. Returns `{ acquired: false }` **without
   * running `fn`** when another live session holds it — the same fail-closed,
   * non-blocking contract `withInstanceLock` documents, generalized so other
   * off-request reapers/recomputers (e.g. `dissolve_precompute`, #472) can key
   * on their own subject id without a second implementation.
   */
  static async withAdvisoryLock<T>(
    namespace: number,
    key: string,
    fn: () => Promise<T>,
    log: { event: string; subject: string } = {
      event: "advisory-lock",
      subject: "key",
    }
  ): Promise<SyncLockOutcome<T>> {
    // An advisory lock is session-scoped, so it must not be taken on a pooled
    // connection — the lock would be released back into the pool still held.
    const reserved = await reserveConnection();
    let held = false;

    try {
      const rows = (await reserved.unsafe(
        `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
        [namespace, key]
      )) as unknown as Array<{ locked: boolean }>;
      held = rows[0]?.locked === true;

      if (!held) {
        logger.warn(
          { event: `${log.event}.refused`, [log.subject]: key },
          "Another live session holds this advisory lock — skipping this pass rather than acting under a foreign owner"
        );
        return { acquired: false };
      }

      // `try`, never the blocking `pg_advisory_lock`: a pass that would block
      // is a pass that should abort. Blocking would hold a worker slot for the
      // duration of someone else's run, for work that is redundant.
      return { acquired: true, value: await fn() };
    } finally {
      if (held) {
        try {
          await reserved.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
            namespace,
            key,
          ]);
        } catch (err) {
          // Swallowed deliberately, and only here. A failed unlock must not
          // mask `fn`'s error, and it is not a correctness problem: the lock
          // dies with the session below. Losing the *connection* to a failed
          // unlock would be the real damage — a reserved connection that is
          // never released is permanently gone from the pool.
          logger.error(
            { event: `${log.event}.unlock-failed`, [log.subject]: key, err },
            "Advisory unlock failed; the lock will be released when this session ends"
          );
        }
      }
      reserved.release();
    }
  }
}
