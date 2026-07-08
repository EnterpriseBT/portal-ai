/**
 * Cross-instance fixed-window rate counter (#169 cost gate — the per-minute
 * rate half; the per-period quota lives in Postgres via `UsageService`).
 *
 * A wall-clock-minute window keyed in Redis. Fail-open is the caller's job
 * (the gate treats a Redis error as "allow" — the Postgres quota still caps
 * spend).
 */

import { getRedisClient } from "./redis.util.js";

const WINDOW_TTL_SECONDS = 120; // covers the current minute + boundary slack

/**
 * Increment the counter for `key` in the current wall-clock-minute window and
 * return the new count. The first increment of a window sets its TTL.
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
  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, WINDOW_TTL_SECONDS);
  }
  return count;
}
