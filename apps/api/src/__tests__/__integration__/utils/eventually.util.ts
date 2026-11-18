/**
 * Poll `read` until `done` accepts its value, for work a request starts but
 * doesn't wait for (#1048). Most audit writes are `void AuditService.record`
 * after the commit, so the row can land a moment after the response.
 *
 * On timeout the last value is returned rather than thrown, so the caller's
 * own `expect` fails with its real message ("Expected length: 1").
 *
 * This waits for something to appear. It can't show that nothing does: a test
 * asserting "no new row" still needs a settle wait.
 */
export async function eventually<T>(
  read: () => PromiseLike<T> | T,
  done: (value: T) => boolean = Boolean,
  timeoutMs = 5_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** `done` for a row read: at least `count` rows have landed. */
export const atLeast =
  (count: number) =>
  (rows: readonly unknown[]): boolean =>
    rows.length >= count;
