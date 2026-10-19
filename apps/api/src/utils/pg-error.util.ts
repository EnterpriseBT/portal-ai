/**
 * Unwrap the Postgres error `code` / `message` from a driver error, whether it
 * arrives raw or wrapped by Drizzle's `DrizzleQueryError`.
 *
 * Drizzle wraps every driver error: the wrapper's own `.code` is `undefined`
 * and its `.message` is the formatted `"Failed query: …"` string, while the
 * real pg error (with the `SQLSTATE` code) lives on `.cause`. Reading `.code`
 * off the wrapper therefore silently misses every code — which is how a
 * `57014` tile timeout escaped as `500 UNKNOWN` (#449). Two services needed
 * this unwrap and one re-derived it wrong, so it lives here once.
 */
export interface PgErrorInfo {
  code?: string;
  message?: string;
}

export function unwrapPgError(err: unknown): PgErrorInfo {
  const cause = (err as { cause?: unknown } | undefined)?.cause;
  const inner = (cause ?? err) as
    | { code?: unknown; message?: unknown }
    | undefined;
  const code = typeof inner?.code === "string" ? inner.code : undefined;
  const message =
    typeof inner?.message === "string" ? inner.message : undefined;
  return { code, message };
}

/**
 * SQLSTATE class 22, a data exception: a bound value the target type can't
 * take (`22P02` bad text, `22007` bad datetime, `22008`/`22003` out of range).
 * A keyset cursor is client-supplied, so a forged one can carry a value its
 * sort column's type rejects; the keyset routes read this as "the cursor
 * doesn't fit" and serve the first page (#649).
 */
export function isPgDataException(err: unknown): boolean {
  return unwrapPgError(err).code?.startsWith("22") ?? false;
}
