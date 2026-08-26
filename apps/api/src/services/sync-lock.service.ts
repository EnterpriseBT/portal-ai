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

export type SyncLockOutcome<T> =
  | { acquired: true; value: T }
  | { acquired: false };

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
    // An advisory lock is session-scoped, so it must not be taken on a pooled
    // connection — the lock would be released back into the pool still held.
    const reserved = await reserveConnection();
    let held = false;

    try {
      const rows = (await reserved.unsafe(
        `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
        [SYNC_LOCK_NAMESPACE, connectorInstanceId]
      )) as unknown as Array<{ locked: boolean }>;
      held = rows[0]?.locked === true;

      if (!held) {
        logger.warn(
          { event: "sync-lock.refused", connectorInstanceId },
          "Another live session holds this instance's sync lock — skipping this pass rather than reaping under a foreign owner"
        );
        return { acquired: false };
      }

      // `try`, never the blocking `pg_advisory_lock`: a pass that would block
      // is a pass that should abort. Blocking would hold a worker slot for the
      // duration of someone else's sync, for a run whose work is redundant.
      return { acquired: true, value: await fn() };
    } finally {
      if (held) {
        try {
          await reserved.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
            SYNC_LOCK_NAMESPACE,
            connectorInstanceId,
          ]);
        } catch (err) {
          // Swallowed deliberately, and only here. A failed unlock must not
          // mask `fn`'s error, and it is not a correctness problem: the lock
          // dies with the session below. Losing the *connection* to a failed
          // unlock would be the real damage — a reserved connection that is
          // never released is permanently gone from the pool.
          logger.error(
            { event: "sync-lock.unlock-failed", connectorInstanceId, err },
            "Advisory unlock failed; the lock will be released when this session ends"
          );
        }
      }
      reserved.release();
    }
  }
}
