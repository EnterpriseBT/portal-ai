# Entity records search — Condensed design (#821)

**Issue:** [EnterpriseBT/portal-ai#821](https://github.com/EnterpriseBT/portal-ai/issues/821) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The entity records table's search is wrong and slow. A `%` or `_` acts as a LIKE wildcard (`%` matches every row), and the predicate is an `ILIKE` over one `concat_ws` of every text-shaped column, which no index can serve, so every search sequentially scans the wide table. #649 fixed both for curated views: per-column `ILIKE` over the text columns, which the trigram indexes now built on every text column serve (206–313 ms → 0.2–0.4 ms on 400K rows), with `\ % _` escaped. This applies the same shape to `GET /api/connector-entities/:id/records`. Mainly `apps/api`, plus a one-line placeholder in `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Search predicate | `apps/api/src/routes/entity-record.router.ts:268` | `sql.raw(stmt.searchableConcatSql("w")) ILIKE ${"%" + search + "%"}`: bound, so injection-safe, but unescaped |
| Concat builder | `apps/api/src/services/wide-table-statement.cache.ts:408` (`searchableConcatSql`), `:191` (`searchableFragment`) | `concat_ws(' ', …)` over pgTypes `text`, `text[]` (`array_to_string`), `jsonb` (`::text`); `''` when none. Only caller is the router |
| Type → pgType | `wide-table-reconciler.service.ts:68` (`pgTypeForColumnDefinitionType`) | string/enum/reference → `text`; reference-array → `text[]`; array/json → `jsonb` |
| Trigram indexes | `wide-table-reconciler.service.ts:650` + the `wide-table-search-index-sweep` processor | GIN `gin_trgm_ops` on every live `text` column only |
| View search (the precedent) | `apps/api/src/services/portal-sql.service.ts:680–702` | `w."c_x" ILIKE '%…%'` per text column, OR'd; `FALSE` with none; escapes `[\\%_]` |
| LIKE escape helper | `apps/api/src/utils/filter-sql.util.ts:392` (`escapeLike`, private) | Paired with `ESCAPE '\'` on the string filters |
| Count | same route, `:391–402` | Shares `where`; the count cache fingerprints `search`, so no cache change |
| Entity table search box | `apps/web/src/views/EntityDetail.view.tsx:313` (`usePagination`) | Default placeholder; the view table passes `searchPlaceholder: "Search text columns"` (`curated-view-table.util.ts:149`) |

The entity route has no per-field read gating (unlike views), so the searchable set is every live text column; that's unchanged.

## Decision — text-only search, per-column, escaped

- **A. Keep `text[]` / `jsonb` in the OR.** One unindexed branch makes the planner scan the table anyway, so the fix buys nothing on any entity with an array or json column.
- **B. Add expression trigram indexes on `array_to_string(col)` / `col::text`.** A new index kind for the reconciler and the sweep, with immutability questions about those expressions. That's a new pattern for a condensed bug.
- **C. Text columns only** (string/enum/reference), as views do.

**Decision: C.** It matches #649, so the entity table and its views agree on what search covers, and every branch is indexed. Array, json and reference-array values stay reachable through the typed filters. The search box reads "Search text columns", as on views, so the narrower scope is stated where it's used.

Shape: `(w."c_a" ILIKE $1 ESCAPE '\' OR w."c_b" ILIKE $1 ESCAPE '\' …)`, where the term is bound and `escapeLike`d and there's no cast. With no text column the predicate is `FALSE`, so the search matches nothing; it isn't silently ignored. `escapeLike` moves out of `filter-sql.util.ts` into an exported spot both files use. `searchableConcatSql` / `searchableFragment` are deleted (no remaining caller, no alias kept), and the statement cache exposes nothing new: the router filters `stmt.columns` by `pgType === "text"`.

## Plan — one slice

**Files**
- Edit: `apps/api/src/routes/entity-record.router.ts`: build the per-column OR, escape the term, and update the `search` `@openapi` description ("…across the entity's text columns (string, enum, reference); `%` and `_` match literally").
- Edit: `apps/api/src/utils/filter-sql.util.ts`: export `escapeLike`.
- Edit: `apps/api/src/services/wide-table-statement.cache.ts`: remove `searchableConcatSql`, `searchableFragment` and `SEARCHABLE_PG_TYPES`.
- Edit: `apps/web/src/views/EntityDetail.view.tsx`: `searchPlaceholder: "Search text columns"`.

**Tests** (`npm run test:integration` / `npm run test:unit` from `apps/api` and `apps/web`)
- `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`, new `#821` cases:
  - `%` and `_` match only cells that contain them literally
  - `\` and `'` match literally, with no 500
  - a value only in a jsonb / text[] column doesn't match
  - an entity with no text column returns 0 rows and total 0
  - search composes with filters and the keyset walk (no repeats; total = rows)
- `apps/api/src/__tests__/__integration__/services/wide-table-statement.cache.integration.test.ts`: drop cases 14–16 (`searchableConcatSql`).
- The `filter-sql.util` unit tests keep passing on the exported helper. The web toolbar placeholder is covered by its existing `searchPlaceholder` test.

## Smoke (manual, against your dev stack)

1. Entity table on Smoke Contacts: search `%`, then `_`. Each returns `(1)`, Okafor 7 (city `100%_off`), not all 34 rows.
2. Search `rri` returns Morrison 0/10/20/30 `(4)`. Search `2025` (a datetime year) returns `(0)`.
3. Search `O'Brien` and `\`: a 200 with no alert, and only literal matches.
4. Placeholder reads "Search text columns".
5. Index use: `EXPLAIN` the route's search query with `SET enable_seqscan = off` (34 rows prefer a seq scan, as in the #649 smoke). The plan shows a `BitmapOr` of `…_trgm` index scans.
6. On a large demo entity (`portalai demo seed --rows`), a search answers in roughly view-search time, not a full scan. Record the timing.

## Out of scope

- Searching array / json / reference-array cells (decision C). If wanted, that's expression trigram indexes in the reconciler and the sweep, as its own ticket.
- Per-field read gating on the entity route's search. The route has none today, and this doesn't change who can read what.
