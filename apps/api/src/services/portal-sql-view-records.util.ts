/**
 * Keyset cursor value for the curated-view records table (#649).
 *
 * The table's rows come from raw SQL, so the sort value arrives as the driver
 * returns it. Drizzle's postgres-js driver returns `text`, `numeric`, `date`
 * and `timestamptz` all as their stored text, so the cursor round-trips the
 * exact value (a `timestamptz` keeps its microseconds). A `Date` is only
 * handled in case a driver parses one; `toISOString` would round it to
 * milliseconds.
 *
 * Returns `null` for anything else. The caller then mints no cursor and the
 * client stays on offset paging. It must never fall back to `{ value: null }`:
 * that anchors in the NULL region and skips every remaining non-null row.
 */
export function readViewSortValue(
  raw: unknown
): { value: string | number | null } | null {
  if (raw === null) return { value: null };
  if (typeof raw === "string" || typeof raw === "number") return { value: raw };
  if (raw instanceof Date) return { value: raw.toISOString() };
  return null;
}
