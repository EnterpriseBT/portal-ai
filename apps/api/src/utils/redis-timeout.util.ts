/**
 * Bounds a Redis command so it **rejects** instead of hanging.
 *
 * This exists because `redis.util.ts` sets `maxRetriesPerRequest: null`
 * (BullMQ requires it). The side effect is that a command issued while Redis
 * is unreachable is *queued* by ioredis's offline queue rather than rejected
 * — the promise never settles, so it reaches no `catch` block and the
 * caller's fail-open never runs. Found while smoke-walking #311:
 * `/api/public/site-config` hung past 45s during a Redis outage instead of
 * allowing the request. A hang is worse than the 500 the fail-open was
 * written to avoid, and on that anonymous route it was reachable with no
 * credential.
 *
 * Every caller that treats Redis as optional must route through this.
 * Rejection is precisely what those callers already handle as "degrade".
 *
 * It lives in its own module rather than in `redis.util.ts` on purpose:
 * tests mock the *client factory* wholesale, and a mocked module would take
 * this safety logic down with it — leaving the hang-vs-reject behaviour
 * unexercised in exactly the tests written to pin it.
 */

/**
 * Ceiling for a single Redis round-trip. A healthy command is sub-
 * millisecond; anything approaching this is an outage, not load.
 * Deliberately short — the cost of giving up early is one degraded
 * operation, and the cost of waiting is a held connection.
 */
export const REDIS_OP_TIMEOUT_MS = 1_000;

/** Reject if `operation` hasn't settled within `REDIS_OP_TIMEOUT_MS`. */
export async function withRedisTimeout<T>(
  operation: Promise<T>,
  label: string
): Promise<T> {
  // Observe the abandoned command so a late failure can't surface as an
  // unhandled rejection (which would take the process down).
  void operation.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Redis ${label} timed out after ${REDIS_OP_TIMEOUT_MS}ms`
              )
            ),
          REDIS_OP_TIMEOUT_MS
        );
        // Don't hold the event loop open on shutdown.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
