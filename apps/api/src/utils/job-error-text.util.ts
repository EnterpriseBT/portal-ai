/**
 * #719: the text a failed job records in `jobs.error` (and a connector
 * instance in `last_error_message`).
 *
 * Every org member may read every job (#692), and that string is copied on:
 * SSE events, `JobDetail`, the portal message a failed bulk transform posts,
 * the `sql_query` tool's error. So a database failure never records the
 * database's own text: Drizzle's wrapper message is the SQL statement and its
 * bound params, and the Postgres error's message and `detail` can quote row
 * values ("Key (source_id)=(…) already exists."). It records a fixed sentence
 * naming the SQLSTATE instead; the caller logs the full error.
 *
 * Every other failure keeps the root-cause text it always had: an upstream's
 * refusal ("other side closed | code: UND_ERR_SOCKET"), an auth or parse
 * error, the stall reason (#468).
 */

/** SQLSTATE → a category a reader can act on. Anything else is generic. */
const SQLSTATE_CATEGORIES: Record<string, string> = {
  "23505": "unique violation",
  "23503": "foreign key violation",
  "23502": "not-null violation",
  "23514": "check violation",
  "22P02": "invalid input",
  "22001": "value too long",
  "22021": "invalid input",
  "57014": "query cancelled",
  "40001": "serialization failure",
  "40P01": "deadlock",
  "53300": "too many connections",
};

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** A postgres.js error: wire fields (`severity`, `code`) on the instance. */
function pgErrorCode(err: Error): string | null {
  const e = err as Error & { severity?: unknown; code?: unknown };
  const isPg = err.name === "PostgresError" || e.severity != null;
  return isPg && typeof e.code === "string" && SQLSTATE.test(e.code)
    ? e.code
    : null;
}

/** The cause chain, outermost first (bounded, as the old formatter was). */
function causeChain(err: Error): Error[] {
  const chain: Error[] = [err];
  let cursor: Error = err;
  while (chain.length < 6) {
    const next = (cursor as { cause?: unknown }).cause;
    if (!(next instanceof Error)) break;
    chain.push(next);
    cursor = next;
  }
  return chain;
}

export function jobErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const chain = causeChain(err);

  // A database failure: name the SQLSTATE, keep nothing the database said.
  for (const e of chain) {
    const code = pgErrorCode(e);
    if (code) {
      const category = SQLSTATE_CATEGORIES[code] ?? "database error";
      return `Database error (${category}, SQLSTATE ${code}). See the server log.`;
    }
  }
  if (chain.some((e) => e.message.startsWith("Failed query:"))) {
    return "Database error. See the server log.";
  }

  // Anything else: the root cause's own text, as before #719.
  const root = chain[chain.length - 1] as Error & { code?: unknown };
  const parts: string[] = [];
  if (root.message) parts.push(root.message);
  if (typeof root.code === "string" && root.code)
    parts.push(`code: ${root.code}`);
  return parts.join(" | ");
}
