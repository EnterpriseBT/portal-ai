/**
 * Bounds any promise so it **rejects** instead of hanging past `ms`.
 *
 * The generic form of `withRedisTimeout` (`redis-timeout.util.ts`): the
 * readiness probe (#566) needs the same guarantee against both the DB and
 * Redis clients — a probe that hangs is worse than one that fails, since a
 * hung `/api/health/ready` keeps a pod in a limbo Kubernetes can't act on.
 *
 * Like the Redis variant, it observes the abandoned operation's rejection so
 * a late failure after the timeout cannot surface as an unhandled rejection
 * (which would take the process down).
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  void operation.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        );
        // Don't hold the event loop open on shutdown.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
