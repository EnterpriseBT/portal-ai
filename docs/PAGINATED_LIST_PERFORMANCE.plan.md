# Paginated list performance — Plan

**Implements the spec's contract TDD-first: the index and tiebreaker that make the default sort streamable, the narrowed list item, keyset cursors, and the cached exact total.**

Spec: `docs/PAGINATED_LIST_PERFORMANCE.spec.md`. Discovery: `docs/PAGINATED_LIST_PERFORMANCE.discovery.md`. Issue: #433.

6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/paginated-list-performance`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 lands the index first so every later measurement is against the fixed plan shape, and so the index has a regression guard before anything depends on it. Slice 2 is the correctness fix and is a **precondition for keyset** — a cursor can't seek past a position it can't uniquely identify — so it precedes slice 4. Slice 3 is independent of both and narrows the payload while the read path is still simple. Slice 4 is server-side keyset, testable end-to-end with no frontend. Slice 5 consumes slice 4 from the UI. Slice 6 is the independent latency work plus doc-sync. **Slices 1–3 are independently mergeable and carry the page-1 win**; if the branch has to split, it splits after slice 3.

---

## Slice 1 — Index + regression guard

Adds the composite partial index that turns the default sort from a spilling hash join into a nested loop, and a test that fails if it is ever dropped.

**Files**

- New: `apps/api/drizzle/00XX_entity-records-created-sort-index.sql` — hand-edited to `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, migration marked non-transactional.
- New: `apps/api/src/__tests__/__integration__/db/entity-records-indexes.integration.test.ts`.
- Edit: `apps/api/src/db/schema/entity-records.table.ts:62-75` — matching `index(...)` entry so Drizzle and the DB stay in step.

**Steps**

1. **Tests.** Assert `pg_indexes` contains `entity_records_entity_created_id_idx` on `entity_records`, and that its `indexdef` carries all three columns in order plus the `WHERE deleted IS NULL` predicate. Run; fail.
2. **Implement** the schema entry, generate the migration (`npm run db:generate -- --name entity-records-created-sort-index`), hand-edit to `CONCURRENTLY`, apply. Green.
3. Lint + type-check.

**Done when:** the index exists and is asserted; no query yet references it explicitly — the planner picks it up for free.

**Risk:** `CONCURRENTLY` cannot run inside a transaction block; the generated migration must be marked non-transactional or it fails on apply. A failed concurrent build leaves an `INVALID` index — `DROP INDEX` and re-run. Index-only, so no data risk.

---

## Slice 2 — ORDER BY tiebreaker + conditional `NULLS LAST`

The correctness fix: paginating over a tied sort key currently repeats and skips rows. Both repositories gain a unique trailing `id`, and `NULLS LAST` becomes conditional on nullability.

**Files**

- Edit: `apps/api/src/db/repositories/entity-records.repository.ts:538-550` — `buildOrderByClause` gains `nullable?: boolean`, emits `NULLS LAST` only when true, always appends the `id` tiebreaker.
- Edit: `apps/api/src/db/repositories/base.repository.ts:152-165` — trailing `id` tiebreaker whenever `opts.orderBy` is supplied; no duplicate clause when already ordering by `id`.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts`, `base.repository.integration.test.ts`.

**Steps**

1. **Tests (spec Layer 2, tiebreaker + `NULLS LAST` cases).** Two rows sharing a `created` value paginate deterministically across two pages — no repeat, no gap. `NULLS LAST` absent for a `NOT NULL` sort column, present for a nullable one. `base.repository.findMany` appends the tiebreaker; ordering by `id` alone doesn't duplicate it. Run; fail.
2. **Implement** both clause builders. Green.
3. Lint + type-check, then run the **full** `apps/api` integration suite — this changes ordering for all 12 list routers.

**Done when:** tied rows paginate deterministically in both repositories; no other suite regressed.

**Risk:** the highest cross-suite risk in the plan. Any existing test asserting an exact row order among ties will flip — that is the fix working, not a regression, but each such assertion must be read and re-based deliberately rather than mass-updated. Note the `base.repository` `NULLS LAST` branch is unreachable from every current caller (spec Key decision 5), so **no behavior change is expected from that half** — only from the tiebreaker.

---

## Slice 3 — Narrowed list item

Drops the raw `data` JSONB from the list projection. It is the sole reason the hash side is 1101 bytes wide and spills to 64 batches, and no list consumer reads it.

**Files**

- Edit: `packages/core/src/models/entity-record.model.ts` — `EntityRecordListItemSchema = EntityRecordSchema.omit({ data: true })`.
- Edit: `packages/core/src/contracts/entity-record.contract.ts:57` — list payload uses the narrowed item.
- New: `packages/core/src/__tests__/contracts/pagination.contract.test.ts` — the list-item half of spec Layer 1.
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts:429` — remove `data` from the SELECT; return type narrows to `EntityRecordListItem[]`. `findHydratedById` (`:478`) untouched.
- Edit: `apps/api/src/config/swagger.config.ts:1186`, `:1254` — register `EntityRecordListItem`, point the list response `items.$ref` at it.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts`.

**Steps**

1. **Tests (spec Layer 1 + Layer 2 projection cases).** `EntityRecordListItemSchema` rejects nothing `EntityRecordSchema` accepts minus `data`; `EntityRecordSchema` still requires `data`. `findHydratedMany` results have no `data` key; `findHydratedById` still does. Run; fail.
2. **Implement** the schema, the projection change, and the swagger component. Green.
3. Lint + type-check — `type-check` is the tool that finds any unsurveyed consumer, which is why this is a narrowed schema rather than an optional field.

**Done when:** list responses carry no `data`; the record detail view still shows the raw payload; the OpenAPI document reflects the narrower list item.

**Risk:** low. If an unsurveyed consumer surfaces, restoring the column in the projection is a one-line revert.

---

## Slice 4 — Cursor contract + keyset seeking (server)

Adds the additive `cursor` contract and keyset seeking to the entity-record read path. Server-side only and fully testable without the frontend.

**Files**

- Edit: `packages/core/src/contracts/pagination.contract.ts:6`, `:27` — `cursor`, `nextCursor`, `KeysetCursorSchema`, `encodeCursor` / `decodeCursor`.
- Edit: `packages/core/src/__tests__/contracts/pagination.contract.test.ts` — the cursor half of spec Layer 1.
- Edit: `apps/api/src/db/repositories/base.repository.ts:66` — `keyset` on `ListOptions`.
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts` — `buildKeysetPredicate`, `findHydratedMany` honours `opts.keyset` and suppresses `OFFSET`.
- Edit: `apps/api/src/routes/entity-record.router.ts:128` — decode/validate cursor, mint `nextCursor`, **and write the missing `@openapi` block** (see cross-slice notes).
- Edit: `apps/api/src/config/swagger.config.ts:367-385`, `:677` — `cursorParam` alongside `limitParam`/`offsetParam`; `nextCursor` on the paginated response (optional, `required` unchanged).
- New: `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts`.

**Steps**

1. **Tests (spec Layer 1 cursor cases, Layer 2 keyset cases, Layer 4).** `encodeCursor`/`decodeCursor` round-trip string, number and `null`; `decodeCursor` returns `null` for malformed input, never throws. Keyset walk over a **non-nullable** column returns every row exactly once. Keyset walk over a **nullable** column (mixed NULL/non-NULL fixture) returns every row exactly once crossing the NULL boundary, `asc` and `desc`. Keyset and offset return identical sequences for the same sort. Route: `nextCursor` present on a full page and `null` on the last; following it yields no overlap; a cursor from a different `sortBy`, and a corrupted cursor, both serve page 1 with status 200 and no error code. Run; fail.
2. **Implement** the contract helpers, the predicate, the repository wiring, and the route handling. Green.
3. Lint + type-check.

**Done when:** the API serves keyset pagination end-to-end; `offset` still works unchanged; the list route is documented in the OpenAPI spec.

**Risk:** **the concentration of subtle-bug risk in this plan** — the nullable keyset predicate. Row-value comparison is wrong across a NULL boundary, so the predicate is written out explicitly (spec Surface) and the exactly-once walk over a mixed-NULL fixture is the regression case. Get this green before slice 5 consumes it.

---

## Slice 5 — `usePagination` keyset mode + debounced search

The UI half: opt-in cursor mode for the entity table, and a debounce that fixes the per-keystroke query storm for **all 15** consumers.

**Files**

- Edit: `apps/web/src/components/PaginationToolbar.component.tsx:143`, `:159`, `:183`, `:246` — `mode`, `searchDebounceMs`, `cursor`/`setNextCursor`, cursor stack, `currentPage` counter, inverted last page, debounced `setSearch`.
- Edit: `apps/web/src/views/EntityDetail.view.tsx:205` — opts into `mode: "keyset"`.
- Edit: `apps/web/src/components/EntityRecordDataTable.component.tsx:73` — passes `cursor` through and reports `nextCursor` back.
- Edit: `apps/web/src/__tests__/PaginationToolbar.test.tsx`.

**Steps**

1. **Tests (spec Layer 5).** Default `mode: "offset"` still emits `offset` and never `cursor` — the regression guard for the other 14 consumers. Keyset mode emits `cursor`, omits `offset`. Next pushes the cursor stack, Prev pops it, First clears it and resets `currentPage`. Changing search/filter/sort/limit resets stack and page. Last requests the inverted sort with no cursor and sets `currentPage` to `totalPages`. `setSearch` updates the input immediately but debounces `queryParams` — rapid keystrokes produce one param change. Run; fail.
2. **Implement** the hook changes and the two consumer wire-ups. Green.
3. Lint + type-check, then run the **full** `apps/web` suite — the debounce touches every consumer.

**Done when:** the entity table pages by cursor; `totalPages` and the `N of M (total)` display are visually unchanged; every other paginated view behaves exactly as before.

**Risk:** the debounce breaks any existing test that types into search and asserts a param change synchronously. Those need fake timers rather than a changed assertion — the behavior is correct, the test's timing model is stale. Expect churn in `PaginationToolbar.test.tsx` and any view test that drives search.

---

## Slice 6 — Count cache, `resolveColumns` batching, conventions

Removes the ~3.5s per-page count floor and the per-request N+1, and records the conventions that stop the next large table repeating this.

**Files**

- New: `apps/api/src/services/entity-record-count.cache.ts`, `apps/api/src/__tests__/services/entity-record-count.cache.test.ts`.
- Edit: `apps/api/src/routes/entity-record.router.ts` — count resolution order, invalidation on the six write routes (`:462`, `:581`, `:713`, `:839`, `:1015`, `:1142`), `resolveColumns` (`:70-83`) batched to one `inArray` query.
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts:451` — `countHydrated` drops the wide-table JOIN when the `where` doesn't reference `w`.
- Edit: `apps/api/src/services/layout-plan-commit.service.ts`, `apps/api/src/queues/processors/revalidation.processor.ts`, `bulk-transform.processor.ts`, `bulk-geocode.processor.ts` — invalidation.
- Edit: `CLAUDE.md` + `.github/copilot-instructions.md` — indexing and tiebreaker conventions.

**Steps**

1. **Tests (spec Layer 3 + the caching cases in Layer 4).** Fingerprint includes `search`/`filters`/`isValid` and excludes `sortBy`/`sortOrder`/`limit`/`offset`/`cursor`. `get` returns `null` on miss **and** on a Redis error (fail open, not a throw); `set` failure is swallowed and logged; `invalidate` drops every key for the entity. Route: `total` identical across pages and not recomputed on page 2; a create/delete invalidates it. `countHydrated` drops the JOIN when unneeded. Run; fail.
2. **Implement**, deriving the invalidation set from actual `entityRecordsRepo` / `wideTableRepo` call sites rather than trusting the spec's table. Green.
3. Lint + type-check.

**Done when:** paging a large entity issues no repeat count; a stale total self-heals within the 60s TTL; the conventions are written down.

**Risk:** a missed writer leaves a stale total for up to the TTL — degraded display, never wrong rows. Deliberately fail-open: no safety or cost gate rides on this cache.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | `(connector_entity_id, created, id)` partial index + guard | `pg_indexes` assertion green |
| 2 | ORDER BY tiebreaker; conditional `NULLS LAST` | tied rows paginate deterministically; full api integration suite green |
| 3 | `EntityRecordListItemSchema`; `data` out of the list projection | list has no `data`, detail still does; `type-check` clean |
| 4 | `cursor` contract, keyset predicate, route + `@openapi` | exactly-once walk over nullable and non-nullable columns |
| 5 | `usePagination` keyset mode + debounce | offset consumers unchanged; one request per typed term |
| 6 | Count cache, `resolveColumns` batching, conventions | no repeat count while paging; fail-open on Redis |

## Cross-slice notes

- **Migration ordering.** Slice 1's index is additive and index-only — safe to apply before or after the code deploy, and `CONCURRENTLY` keeps writes unblocked during the ~283K-row build on app-dev.
- **Slice 2 gates slice 4.** The tiebreaker is a precondition for keyset, not merely adjacent to it. Do not reorder.
- **`EntityRecordListItem` spans slices 3 and 4.** Slice 3 introduces the type; slice 4's route changes return it. Keep slice 3's repository return type narrowed so slice 4 doesn't have to widen and re-narrow.
- **Doc-sync (`CLAUDE.md` → "Keeping Documentation in Sync").** Three surfaces move with the code, in the same PR: the OpenAPI components (slice 3's `EntityRecordListItem`, slice 4's `cursorParam` + `nextCursor`), the list route's `@openapi` block (slice 4), and the `CLAUDE.md` conventions (slice 6).
- **Pre-existing gap, deliberately scoped.** `entity-record.router.ts` carries **4 `@openapi` blocks for 9 routes** — the list (`:128`), count (`:289`), get-by-id (`:335`), and two POSTs (`:581`, `:713`) have none. Slice 4 writes the **list** route's block because this PR changes that route's contract and leaving it undocumented would be a bug in this change. The other four are pre-existing and **stay out of scope** — worth their own ticket rather than quietly quadrupling this PR.
- **Measurement is the smoke, not CI.** No test asserts latency. Slice 1's guard proves the index exists; the acceptance criteria's timing targets are verified manually against app-dev in `/smoke`.

## Next step

Once discovery, spec and plan are reviewed and confirmed, implementation begins on this branch — slice 1 first, tests before code, one commit per slice.
