import { DbService } from "./db.service.js";
import { getRedisClient } from "../utils/redis.util.js";
import { withRedisTimeout } from "../utils/redis-timeout.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { PortalMessageSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "portal-turn-guard" });

/**
 * Lock lifetime — sized to the longest a turn can run (`stepCountIs(10)` ×
 * `maxRetries: 3` in `PortalService.streamResponse`). It is a *backstop*, not
 * the primary release: the fresh path releases in a `finally` the moment its
 * turn ends. The TTL only matters when a holder dies without releasing (ECS
 * task killed mid-turn), and it caps how long a reconnect will wait.
 */
export const TURN_LOCK_TTL_MS = 180_000;

/** Poll cadence + ceiling for {@link PortalTurnGuardService.waitForAnswer}. */
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = Math.ceil(TURN_LOCK_TTL_MS / POLL_INTERVAL_MS);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cross-instance idempotency for a single portal turn (#504).
 *
 * The SSE `/stream` endpoint is stateless per connection, and an `EventSource`
 * that drops mid-turn auto-reconnects by design (`SseUtil` even sends
 * `retry: 0`). Before this guard, the reconnect re-invoked `streamResponse`
 * and fired a **duplicate Anthropic call** for the same turn — a silent
 * double-spend outside the #498 send ceiling (which gates the POST, not the
 * reconnect). This guard marks a turn in-flight so the reconnect replays the
 * persisted answer instead of re-generating.
 *
 * FAIL-OPEN by contract: any Redis error/timeout on the lock logs a warn and
 * proceeds to generate — i.e. today's behavior. An un-charged safety guard
 * never blocks a turn on Redis health; the worst degraded case is the
 * pre-existing duplicate, never a dropped turn. Mirrors
 * {@link AgentTurnCeilingService}'s posture.
 */
export class PortalTurnGuardService {
  /** Redis key for the turn identified by its pending (unanswered) user row. */
  static turnLockKey(portalId: string, pendingUserMessageId: string): string {
    return `portal-turn:${portalId}:${pendingUserMessageId}`;
  }

  /**
   * Try to claim the turn. Returns `true` if this caller now owns it (proceed
   * to generate), `false` if another connection already holds it (the caller
   * should wait + replay instead). Fails **open** (`true`) on any Redis
   * trouble — the guard degrades to the pre-#504 behavior, never blocks.
   */
  static async acquireTurnLock(key: string): Promise<boolean> {
    try {
      const res = await withRedisTimeout(
        getRedisClient().set(key, "1", "PX", TURN_LOCK_TTL_MS, "NX"),
        "SET portal-turn NX"
      );
      return res === "OK";
    } catch (err) {
      logger.warn(
        { err, key },
        "portal-turn lock unavailable; failing open (proceeding to generate)"
      );
      return true;
    }
  }

  /**
   * Release a turn lock held by this caller. Best-effort: a failure is fine —
   * the TTL reaps the key. Never throws.
   */
  static async releaseTurnLock(key: string): Promise<void> {
    try {
      await withRedisTimeout(getRedisClient().del(key), "DEL portal-turn");
    } catch (err) {
      logger.warn(
        { err, key },
        "portal-turn lock release failed; TTL will reap it"
      );
    }
  }

  /**
   * Wait, bounded, for the in-flight turn to persist its assistant answer, and
   * return it. Polls the portal's messages until the newest row is an
   * `assistant` message (the only row that can appear on a pending turn — a
   * new user row can't, the POST is gated and the input is locked while
   * streaming). Returns `null` if no answer lands within the poll ceiling
   * (≈ the lock TTL), which the caller surfaces as a "still answering" notice.
   *
   * `opts` is injectable so tests drive it deterministically without real
   * timers.
   */
  static async waitForAnswer(
    portalId: string,
    opts: { intervalMs?: number; maxAttempts?: number } = {}
  ): Promise<PortalMessageSelect | null> {
    const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
    const maxAttempts = opts.maxAttempts ?? MAX_POLL_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const messages =
        await DbService.repository.portalMessages.findByPortal(portalId);
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") return last;
      await sleep(intervalMs);
    }
    return null;
  }
}
