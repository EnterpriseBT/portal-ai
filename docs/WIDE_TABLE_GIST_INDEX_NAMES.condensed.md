# Wide-table GIST index names fit 63 bytes — Condensed design (#804)

**Issue:** [EnterpriseBT/portal-ai#804](https://github.com/EnterpriseBT/portal-ai/issues/804) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `gistIndexName` builds `er__<entityId>__<columnName>_gist`. Postgres truncates identifiers to 63 bytes, and the 42-byte `er__<uuid>__` prefix leaves 21 bytes of the column name; the `_gist` suffix is cut first. Two geometry columns sharing their first 21 characters (e.g. `c_parcel_boundary_polygon_a` / `_b`) get the same index name, and the second `CREATE INDEX IF NOT EXISTS` silently does nothing, so that column's spatial predicates fall back to sequential scans. (The issue's example pair, `c_location_boundary_a` / `_b`, is exactly 21 characters, so it doesn't collide.) The convert path makes it worse. Converting a geometry column back to jsonb runs `DROP INDEX IF EXISTS` on the same truncated name, so it can drop the *other* column's index. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `gistIndexName` | `apps/api/src/services/wide-table-reconciler.service.ts:342` | `er__${id}__${col}_gist`, unbounded |
| Add path | `wide-table-reconciler.service.ts:~555` (`applyAdds`) | `CREATE INDEX IF NOT EXISTS` after `ADD COLUMN` of a geometry type |
| Convert json→geometry | `wide-table-reconciler.service.ts:~400` (`convertGeometryColumnType`) | `CREATE INDEX IF NOT EXISTS` by name |
| Convert geometry→json | `wide-table-reconciler.service.ts:~411` | `DROP INDEX IF EXISTS` by name, which can hit the sibling's index |
| Wide-table name | `apps/api/src/db/repositories/wide-table.repository.ts:215` | `er__<uuid>`, always 40 bytes |
| Column-name precedent | `sanitizeColumnName`, `wide-table-reconciler.service.ts:124` | #801 already clips column names to `PG_IDENTIFIER_MAX_BYTES` |
| Tests that match by suffix | `wide-table-geometry.integration.test.ts:205`, `column-definition.router.integration.test.ts:1532` | `indexname LIKE '%_gist'` |

## Decision — name shape

- **A. A hash of the column, keeping the prefix and suffix:** `er__<entityId>__<md5(columnName)[0:16]>_gist` is 4 + 36 + 2 + 16 + 5 = **63 bytes, always**. `\di er__<entityId>*` still lists an entity's indexes, and the `_gist` suffix still matches the existing tests. The column name isn't readable in the index name, but `\d er__<id>` shows which column each index covers.
- B. A clipped column name plus a hash: readable, but variable-length clipping is one more thing to get wrong for a name nobody reads.
- C. `er_gist_<md5(entityId:col)>`: loses the per-entity prefix.

**Chosen: A.** It's a fixed width that can't overflow, and the hash is easy to reproduce in SQL (`substr(md5(col), 1, 16)`) for the backfill. 64 bits of hash within one entity's handful of geometry columns won't collide in practice.

## Decision — dropping on geometry→json

The drop looks up the column's **single-column** GIST indexes in the catalog (`pg_index` ⋈ `pg_am` = `gist`, `indnatts = 1`, `indkey[0]` = the column), resolving the table with `to_regclass` exactly as the `ALTER` does, instead of trusting a computed name. That drops the right index whichever naming scheme created it, and never touches a sibling column's index. A multi-column index also serves other columns, so it is left alone, and the `ALTER` then refuses. If a legacy-named index stayed on the column, the `ALTER … TYPE jsonb` would fail, because jsonb has no default GIST opclass.

## Decision — repairing existing installs

A forward data migration finds every **live** geometry column that has **no** single-column GIST index. Live means a `wide_table_columns` row that isn't retired or deleted, for a connector entity that isn't deleted, matched to `pg_attribute` by `left(column_name, 63)`. Retired columns and the tables of deleted entities (waiting on `entity_data_delete`) are skipped, since nothing queries them. It creates the missing index under the new name (a `DO` block driven by the catalog, `format('%I')`). Indexes that already exist under a truncated name stay: they work, and `IF NOT EXISTS` is keyed on the name, which can't collide with the new 63-byte names. The migration is expand-only (no `DROP`), so `lint:migrations` passes. A non-concurrent `CREATE INDEX` inside the migration transaction blocks writes to that one table while the index builds. That's acceptable because it only runs for live collision victims, which are rare and need the index anyway.

`gistIndexName` hashes the *stored* column name (the first 63 bytes). A column created before #801 can have a longer catalog name, and the reconciler and the migration must agree on its index name.

## Plan — 1 slice

**Files**
- edit `apps/api/src/services/wide-table-reconciler.service.ts`: `gistIndexName` → `er__${id}__${md5(col).slice(0,16)}_gist` (`node:crypto`). The geometry→json branch drops by catalog lookup (new private `dropGistIndexesOnColumn(table, col, tx)`).
- new `apps/api/drizzle/0123_backfill-wide-table-gist-indexes.sql` + journal entry + `0123_snapshot.json` (`npm run db:generate -- --custom --name backfill-wide-table-gist-indexes`). This also repairs the snapshot chain. `0116_snapshot.json` was a byte-for-byte copy of 0115's (same `id`), so `db:generate` refused to run, and 0117–0122 landed without snapshots. 0116 gets its own id, and 0123's snapshot captures the current schema, so a plain `db:generate` reports no changes again.

**Tests**
- unit `src/__tests__/services/wide-table-reconciler.gist-name.test.ts`: the name is ≤ 63 bytes for a 58-byte key column. Two columns sharing a long prefix get distinct names. The name is stable for the same input, starts with `er__<entityId>__` and ends `_gist`.
- integration `wide-table-geometry.integration.test.ts`: two geometry columns sharing a > 16-character prefix, then **two** GIST indexes. Converting one to jsonb leaves the other's index in place.
- integration `wide-table-geometry.integration.test.ts` (`migration 0123` block, run against the reconciler-built fixture): indexes the bare column, leaves a legacy-named index, skips a retired column and a deleted entity, no-op on a second run. A pre-#801 long-name column gets the same index name from 0123 as from `gistIndexName`, and converts cleanly. Converting never drops a multi-column index.
- Run: `npm run test:unit -- --testPathPattern wide-table-reconciler`, `npm run test:integration -- --testPathPattern "wide-table-geometry|column-definition.router"`, plus `npm run lint:migrations`.

## Smoke (manual, against your dev stack)

1. `npm run db:migrate` (from `apps/api`), and confirm the migration applies cleanly on your existing local data.
2. In the app, create or pick an entity and add two field mappings to column definitions of type geometry, with keys `parcel_boundary_polygon_a` and `parcel_boundary_polygon_b`. Sync or import a row so the wide table reconciles.
3. `psql`: `\di er__<entityId>*` lists **two** `…_gist` indexes, each 63 characters long. `\d er__<entityId>` shows one on `c_parcel_boundary_polygon_a` and one on `c_parcel_boundary_polygon_b`.
4. Change `parcel_boundary_polygon_b`'s column definition type to JSON (geometry→json conversion). `\d er__<entityId>`: `c_parcel_boundary_polygon_a`'s GIST index is still there, and `c_parcel_boundary_polygon_b` has none.
5. Convert it back to geometry, and two GIST indexes are listed again.

## Out of scope

- Renaming existing truncated-name indexes to the new scheme. They work, and renaming them is churn with no effect.
- Other generated identifiers. Column names were #801, and the wide-table name is fixed at 40 bytes.
