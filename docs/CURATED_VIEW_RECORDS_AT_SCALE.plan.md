# Curated-view records at scale — Plan

**TDD-sequenced implementation of keyset paging, text-only trigram search, the cached total and the wide-table trigram index lifecycle for `GET /api/curated-views/:id/records`.**

Spec: `docs/CURATED_VIEW_RECORDS_AT_SCALE.spec.md`. Discovery: `docs/CURATED_VIEW_RECORDS_AT_SCALE.discovery.md`. Issue: #649 (epic #578). Builds on shipped #433 (keyset helpers, `KeysetCursorSchema`, `EntityRecordCountCache`), #599/#678 (the view records endpoint) and #804 (`gistIndexName`).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/649-curated-view-records-at-scale`**: one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

Sequencing rationale. Pure code comes first, then the endpoint, then the indexes, then the background convergence, then the UI:

- **Slice 1:** the keyset helpers gain a `tiebreaker`. They're pure SQL builders, and entity-records stays byte-identical.
- **Slice 2:** the view endpoint pages by keyset and caches its count. It uses slice 1. The offset path still works, so the web is untouched.
- **Slice 3:** the `pg_trgm` migration, `trgmIndexName`, and the reconciler building the index at column add. The indexes exist from here on, though nothing depends on them for correctness.
- **Slice 4:** text-only search and cast-free string filters. These are correct with or without slice 3's indexes, and sit after it so the measurement sees both together.
- **Slice 5:** the maintenance sweep, which converges existing tables. It needs slice 3's migration and naming.
- **Slice 6:** the web switches to keyset paging and gets the placeholder. It needs slice 2's `nextCursor`.

Close-out comes after slice 6. It isn't a slice, because it adds no tests: the measurement on the PR, then the doc sync.

---

## Slice 1 — Keyset helpers take a tiebreaker

`buildKeysetPredicate` and `buildOrderByClause` accept an optional `tiebreaker`. The default stays `entityRecords.id`.

**Files**

- Edit: `apps/api/src/db/repositories/entity-records.repository.ts:986-1032`. Add the `tiebreaker?: Column | SQL` option. Replace the hard-coded `entityRecords.id` and the `col === entityRecords.id` short-circuit with `col === tiebreaker`.
- Edit: `apps/api/src/__tests__/db/repositories/entity-records-order-by.test.ts`.

**Steps**

1. **Tests (spec: unit, order-by ×5).**
   - A custom tiebreaker appears in ORDER BY with the sort's direction.
   - The default is `entity_records.id`.
   - The short-circuit fires when `column` is the tiebreaker.
   - The predicate uses the custom tiebreaker in the NOT NULL, nullable and NULL-anchor forms.

   Run; fail.
2. **Implement** the option. Green. Also run `entity-records.keyset.integration.test.ts` and `keyset-cursor-stability.integration.test.ts` unchanged as the no-regression check.
3. Lint + type-check.

**Done when:** the 5 new cases and the existing keyset suites pass. No caller passes `tiebreaker` yet.

**Risk:** none. Default-preserving.

---

## Slice 2 — Keyset paging + cached total on the view endpoint

`queryCuratedViewRecords` takes `cursor`, fetches `limit+1`, mints `nextCursor`, and reads `total` through `EntityRecordCountCache` with `viewScope`. The route passes `cursor` through and returns `nextCursor`. Search is unchanged in this slice.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts:568-735`:
  - the effective-sort table from the spec (sort expr / nullable / tiebreaker)
  - the `"_sort_value"` framing column, stripped from returned rows
  - the keyset predicate and ORDER BY as `sql` fragments around the existing `sql.raw` body, with the cursor bound as parameters
  - `OFFSET` only without an anchor
  - the exported `readViewSortValue`
  - the cached count
- Edit: `apps/api/src/services/entity-record-count.cache.ts:47-67`: `CountCacheScope.viewScope`.
- Edit: `apps/api/src/routes/curated-view.router.ts:1010-1103`: pass `cursor` through, return `nextCursor`, and document both in `@openapi`.
- Edit: `packages/core/src/contracts/curated-view.contract.ts:203-235`: doc comments only (cursor honored, `nextCursor` returned).
- New: `apps/api/src/__tests__/services/portal-sql-view-records.util.test.ts`.
- Edit: `apps/api/src/__tests__/services/entity-record-count.cache.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`.

**Steps**

1. **Unit tests (spec: count-cache ×2, `readViewSortValue` ×5).**
   - `viewScope` changes the fingerprint.
   - An absent `viewScope` keeps the pinned pre-#649 hash. Compute it on `main` first and paste it in as a literal.
   - `readViewSortValue` for string, number, Date, null and object.

   Run; fail.
2. **Integration tests (spec: route, keyset and count cases).**
   - A keyset walk under `created`, a numeric column and a string column returns every row once and equals the offset walk.
   - A mismatched-sort cursor and a garbage cursor each serve page 1.
   - The last page carries `nextCursor: null`.
   - No `_sort_value` appears in `records`.
   - A DESC sort with NULLs puts NULLs last and breaks ties DESC.
   - The inverted last-page walk equals the forward tail.
   - A `'` in a string sort value round-trips.
   - Callers with different field grants get independent totals.
   - A record write refreshes the total.

   Run; fail.
3. **Implement.** Green.
4. Lint + type-check. The core contract changed, so rebuild core (`npm run build` at root before type-checking web; memory `feedback_core_model_change_run_full_build`).

**Done when:** the 7 unit and 10 integration cases pass. The existing curated-view router cases still pass under offset, and an offset-only client is unaffected.

**Risk:**
- **Postgres row types.** `numeric` comes back from Postgres as a string and `timestamptz` per the driver, so the round-trip cases are the guard.
- **Count staleness on a grant change.** A grant change that leaves the readable set intact (row-level) doesn't change the key. View row filters are per view, not per user, so that's correct today. Re-check if per-user row filters ever arrive.

---

## Slice 3 — `pg_trgm` + trigram index at column add

**Files**

- New: `apps/api/drizzle/0126_enable-pg-trgm.sql` (custom migration via `drizzle-kit generate --custom`), plus `meta/_journal.json` and the `0126` snapshot, **committed together** (memory `project_drizzle_journal_must_be_committed`).
- Edit: `apps/api/src/services/wide-table-reconciler.service.ts`:
  - export `trgmIndexName` beside `gistIndexName` (`:178-197`)
  - add a `text` branch in `applyAdds` (`:617-628`) that runs `CREATE INDEX IF NOT EXISTS … USING GIN (<col> gin_trgm_ops)`
- Edit: `apps/api/src/__tests__/services/wide-table-reconciler.gist-name.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/services/wide-table-reconciler.service.integration.test.ts`.

**Steps**

1. **Tests (spec: name ×3, reconciler ×3).**
   - `trgmIndexName` is 63 bytes.
   - Long-prefix columns get distinct names.
   - It has the same hash as `gistIndexName` and a `_trgm` suffix.
   - A string/enum/reference add creates a valid GIN `_trgm` index.
   - A number add creates none.
   - Re-reconcile is idempotent.

   Run; fail.
2. **Implement.** Run `npm run db:migrate` locally (memory `project_dev_seeds_not_migrates`), then green.
3. Run `npm run lint:migrations` (the migration isn't destructive, so it passes untagged), then lint + type-check.

**Done when:** the 6 cases pass on a freshly migrated DB, and `lint:migrations` passes.

**Risk:** CI's fresh DB must ship `pg_trgm` (contrib). It does in `imresamu/postgis:17-3.5`, but confirm on the first CI run.

---

## Slice 4 — Text-only search + cast-free string filters

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts:669-677`:
  - `textColumns` via `pgTypeForColumnDefinitionType`
  - per-column `ILIKE` without `::text`
  - `FALSE` when there are no text columns
- Edit: `apps/api/src/utils/filter-sql.util.ts:236-277`: the `castToText` parameter on `buildTypedStringCondition`, which the dispatcher passes as `dataType === "json"`.
- Edit: `apps/api/src/__tests__/utils/filter-sql.util.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`.
- Edit: the `@openapi` description on the route: search matches text columns only.

**Steps**

1. **Tests (spec: filter-sql ×5, route search ×2).**
   - String `contains`/`starts_with`/`ends_with`/`not_contains` emit no `::text`, and `json` keeps it.
   - Search matches a text column but never a number/date cell or a hidden column.
   - A view with no text columns returns 0 rows and `total: 0`.

   Run; fail.
2. **Implement.** Green. Re-run the existing filter and search cases, including the entity-records filter suites, since `filter-sql.util.ts` is shared.
3. Lint + type-check.

**Done when:** the 7 cases and every existing filter/search suite pass.

**Risk:** an existing curated-view test may search on a number cell. If so, it's an intended behavior change: update it, and note it in the commit body.

---

## Slice 5 — Search-index sweep

**Files**

- New: `apps/api/src/queues/processors/wide-table-search-index-sweep.processor.ts`, with the summary shape and behavior from the spec.
- Edit: `apps/api/src/queues/maintenance.queue.ts`: `WIDE_TABLE_SEARCH_INDEX_SWEEP_JOB`, and the `"45 * * * *"` scheduler in `registerMaintenanceSchedulers`.
- Edit: `apps/api/src/queues/maintenance.worker.ts`: dispatch.
- Edit: `apps/api/src/environment.ts` and `apps/api/.env.example`: `WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS`, default 25. `env-example-parity.test.ts` holds them together.
- New: `apps/api/src/__tests__/__integration__/queues/wide-table-search-index-sweep.integration.test.ts`.
- Edit: `apps/api/src/__tests__/queues/maintenance.worker.test.ts`.

**Steps**

1. **Tests (spec: sweep ×7, worker ×1).**
   - Builds a missing index on a populated table.
   - Rebuilds an `INVALID` index.
   - Drops the index on a retired column.
   - Skips a dropped table.
   - Skips a soft-deleted entity.
   - `maxBuilds` caps the run and reports `deferred`.
   - A second run is a no-op.
   - The worker dispatches the job name.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the 8 cases pass, and the env-parity test passes.

**Risk:**
- **Making an `INVALID` index.** Make it naturally rather than by editing `pg_index`, which needs superuser: run a `CREATE UNIQUE INDEX CONCURRENTLY <the _trgm name> ON … (<col>)` over duplicate values. It fails and leaves an INVALID index under that name.
- **Transactions.** `CONCURRENTLY` can't run inside a transaction, so the sweep's tests must not run under a wrapping test transaction, and the processor must use a checked-out client in autocommit.

---

## Slice 6 — Web keyset paging + search placeholder

**Files**

- Edit: `apps/web/src/utils/curated-view-table.util.ts:44-100`: `mode: "keyset"`, and drop the `#649` comment.
- Edit: `apps/web/src/views/CuratedViewDetail.view.tsx`: `SyncNextCursor` + `transformPage` (the `EntityDetail.view.tsx:515-538` pattern), drop `handleSort`'s manual offset reset, and pass `searchPlaceholder="Search text columns"`.
- Edit: `apps/web/src/components/PaginationToolbar.component.tsx`: `searchPlaceholder?: string`, default `"Search..."`.
- Edit:
  - `apps/web/src/__tests__/curated-view-table.util.test.tsx`
  - `apps/web/src/__tests__/CuratedViewDetailView.test.tsx`
  - `apps/web/src/__tests__/PaginationToolbar.test.tsx`
  - `apps/web/src/stories/CuratedViewDetail.view.stories.tsx`, if its fixtures need `nextCursor`

**Steps**

1. **Tests (spec: web ×6).**
   - After Next, `queryParams` carries `cursor`, not `offset`.
   - A sort change resets the cursor stack.
   - Next sends the response's `nextCursor`, and Prev returns to the previous page.
   - The placeholder text is right.
   - `searchPlaceholder` renders, with the default otherwise.

   Run; fail.
2. **Implement.** Green.
3. Lint + type-check, then a full root `npm run build` (core + web typed fixtures).

**Done when:** the 6 cases pass and the build is green.

**Risk:** the persisted `pagination:curated-view:<viewId>` state may hold an `offset` from before the switch. Keyset mode ignores it, so the first load lands on page 1. That's acceptable; there's nothing to migrate.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `tiebreaker` on the keyset helpers | 5 unit + existing keyset suites |
| 2 | View keyset + `nextCursor` + cached total | 7 unit + 10 integration |
| 3 | `pg_trgm` migration, `trgmIndexName`, index at add | 6 cases + `lint:migrations` |
| 4 | Text-only search, cast-free string filters | 7 cases + existing filter suites |
| 5 | Maintenance sweep + scheduler + env knob | 8 cases + env parity |
| 6 | Web keyset + placeholder | 6 web cases + root build |
| — | Close-out: measurement + doc sync | recorded on the PR |

≈ 49 new cases, matching the spec's ≈ 50. One integration case that only checked fresh-DB migration was folded into slice 3's reconciler test.

## Cross-slice notes

- **Measurement (close-out).** Run it against a ~400K-row `er__` table: a local copy of an app-dev-shaped entity, or the e2e generator scaled up. The local container suspends (memory `project_local_env_unsuitable_for_long_jobs`), so build the indexes with the sweep run by hand rather than waiting on the scheduler. Record the spec's `EXPLAIN (ANALYZE, BUFFERS)` set on the PR, before and after. A column sort or range filter over 1s → file the btree follow-up under epic #578.
- **Doc sync (close-out, same PR):**
  - `deploy/helm/portalai/README.md:18-20` gains `pg_trgm` beside the PostGIS requirement.
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md` only if it lists required extensions (check; no egress change).
  - `packages/core/src/content/faq.util.ts` / `glossary.util.ts` if either describes view search.
  - The OpenAPI descriptions land with slices 2 and 4.
- **Shared file.** `portal-sql.service.ts` is edited in slices 2 and 4, at disjoint regions (sort/paging/count vs search). Keep them so the slice-4 diff stays reviewable.
- **Follow-ups to file at close-out:**
  - the entity-records search rewrite + LIKE escaping (discovery Q3)
  - the btree ticket, only if the measurement trips

## Next step

Implementation begins on this branch with slice 1, tests first, one commit per slice. The draft PR (`Closes #649`) opens with the first implementation commit.
