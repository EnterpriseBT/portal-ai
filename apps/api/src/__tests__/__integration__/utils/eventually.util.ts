/**
 * Poll `read` until `done` accepts its value, for work a request starts but
 * doesn't wait for (#1048). Most audit writes are `void AuditService.record`
 * after the commit, so the row can land a moment after the response.
 *
 * On timeout the last value is returned rather than thrown, so the caller's
 * own `expect` fails with its real message ("Expected length: 1").
 *
 * `done` is required: an empty row list is truthy, so a default of "truthy"
 * would return on the first read. Use `atLeast(n)` for rows.
 *
 * This waits for something to appear. It can't show that nothing does, or that
 * nothing more follows: a test about a row that must not be written (a no-op,
 * a dedupe, a refused repeat) still needs a settle wait before it counts.
 */
export async function eventually<T>(
  read: () => PromiseLike<T> | T,
  done: (value: T) => boolean,
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
