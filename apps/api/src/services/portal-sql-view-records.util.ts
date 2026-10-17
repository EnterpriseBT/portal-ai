/**
 * Keyset cursor value for the curated-view records table (#649).
 *
 * The table's rows come from raw SQL, so the sort value arrives as the driver
 * returns it: `text` as a string, `numeric` as a string, `timestamptz` as a
 * `Date`. A cursor carries a string, number or null, so a `Date` becomes ISO
 * (Postgres reads it back as a `timestamptz` literal).
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
