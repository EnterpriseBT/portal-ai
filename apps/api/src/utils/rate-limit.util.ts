/**
 * Cross-instance fixed-window rate counter (#169 cost gate — the per-minute
 * rate half; the per-period quota lives in Postgres via `UsageService`).
 *
 * A wall-clock-minute window keyed in Redis. Fail-open is the caller's job
 * (the gate treats a Redis error as "allow" — the Postgres quota still caps
 * spend), and every caller implements that as a `try/catch`.
 *
 * **Why the timeout race below exists.** `redis.util.ts` sets
 * `maxRetriesPerRequest: null` because BullMQ requires it. A side effect is
 * that a command issued while Redis is unreachable is *queued* by ioredis's
 * offline queue rather than rejected — the promise never settles, so it
 * reaches no `catch` block and the caller's fail-open never runs. Found while
 * smoke-walking #311: `/api/public/site-config` hung past 45s during a Redis
 * outage instead of allowing the request. A hang is worse than the 500 the
 * fail-open was written to avoid, and on that anonymous route it is reachable
 * with no credential.
 *
 * So every Redis call here is bounded and **rejects** on timeout. Rejection
 * is precisely what the four call sites already treat as "allow", so their
 * documented posture becomes true without changing any of them.
 */

import { getRedisClient } from "./redis.util.js";
import { withRedisTimeout, REDIS_OP_TIMEOUT_MS } from "./redis-timeout.util.js";

const WINDOW_TTL_SECONDS = 120; // covers the current minute + boundary slack

/**
 * Re-exported so this module's existing callers and tests keep one name for
 * the bound. The helper itself lives in `redis-timeout.util.ts`.
 */
export { REDIS_OP_TIMEOUT_MS };

/**
 * Increment the counter for `key` in the current wall-clock-minute window and
 * return the new count. The first increment of a window sets its TTL.
 *
 * Throws if Redis errors **or** fails to answer within
 * `REDIS_OP_TIMEOUT_MS`. Callers treat either as "allow".
 *
 * @param key  a caller-scoped key, e.g. `"${organizationId}:${costClass}"`
 * @param now  epoch ms (injectable for deterministic tests)
 */
export async function incrementRateWindow(
  key: string,
  now: number = Date.now()
): Promise<number> {
  const redis = getRedisClient();
  const windowKey = `usage:rate:${key}:${Math.floor(now / 60_000)}`;
  const count = await withRedisTimeout(redis.incr(windowKey), "INCR");
  if (count === 1) {
    await withRedisTimeout(
      redis.expire(windowKey, WINDOW_TTL_SECONDS),
      "EXPIRE"
    );
  }
  return count;
}
