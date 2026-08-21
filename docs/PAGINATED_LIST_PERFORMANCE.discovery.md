# Paginated list performance — Discovery

**Issue:** [EnterpriseBT/portal-ai#433](https://github.com/EnterpriseBT/portal-ai/issues/433)

**Why this exists.** The entity record table takes 20+ seconds to serve a single 10-row page at 283K records on app-dev, and 39s to serve the last page. The table is server-paginated, so page cost should be independent of dataset size — it isn't, because nothing in the read path can stream: no index supports the UI's default sort, so Postgres hash-joins every matching row against the whole wide table and spills to disk before discarding all but ten. Measured plans are in the issue.

The defect is not local to the entity-record route. `created` is the default `sortBy` for **every** paginated list in the app (`apps/web/src/components/PaginationToolbar.component.tsx:189`) and **no table in the schema indexes it**. Every list endpoint full-sorts today; it is only visible on `entity_records` because that is the only large table. The same is true of the per-page exact `count(*)` (12 routers share the shape) and the undebounced search box (15 views share the hook).

This is the discovery that fixes the shared read path so paginated lists stay cheap as tables grow, and lands the index and projection work on the two tables that will actually grow — `entity_records` (494K rows / 725 MB) and the per-entity wide tables `er__<id>` (283K / 191 MB), the only app-dev tables above 5K rows.

## The current shape

### The entity-record read path

| Piece | Location | Note |
|---|---|---|
| List route | `apps/api/src/routes/entity-record.router.ts:128` | Parses query, resolves columns, builds WHERE/ORDER BY, then `Promise.all([findHydratedMany, countHydrated])` at `:237` |
| Column resolution | `apps/api/src/routes/entity-record.router.ts:70-83` | N+1 — one `columnDefinitionsRepo.findById` per column definition, per request |
| Hydrated read | `apps/api/src/db/repositories/entity-records.repository.ts:388` | Hand-built SQL; joins `er__<id>` on `entity_record_id`, projects `jsonb_build_object` over typed columns |
| Raw payload in projection | `apps/api/src/db/repositories/entity-records.repository.ts:429` | Selects `entity_records.data` — the pre-mapping JSONB — for every listed row |
| Count | `apps/api/src/db/repositories/entity-records.repository.ts:451` | `countHydrated` repeats the wide-table JOIN because `where` may reference the `w` alias |
| ORDER BY construction | `apps/api/src/db/repositories/entity-records.repository.ts:538-550` | Appends `NULLS LAST` unconditionally, on both the `Column` and raw-SQL paths |
| Sort on a data column | `apps/api/src/utils/filter-sql.util.ts:125-132` | `buildSortExpression` resolves a `normalizedKey` to `w."c_*"` |
| Search | `apps/api/src/services/wide-table-statement.cache.ts:79`, `:185-199` | `concat_ws` over text/jsonb columns, wrapped in `ILIKE '%term%'` — unindexable by construction |

### Indexes that exist, and the one that doesn't

`entity_records` (`apps/api/src/db/schema/entity-records.table.ts:62-75`) carries `(connector_entity_id, source_id) WHERE deleted IS NULL`, `(connector_entity_id, synced_at)` and `(connector_entity_id, is_valid)`. There is **no index involving `created`** — on this or any other table.

The wide tables get only what the reconciler creates (`apps/api/src/services/wide-table-reconciler.service.ts:185-208`, `:531-537`): a PK on `entity_record_id`, an `organization_id` index, a `source_id` unique index, and GiST for geometry columns. No index on any `c_*` data column, so sorting or filtering by a data column is a full sort for every wide table.

### The shared list machinery

`Repository.findMany` / `Repository.count` (`apps/api/src/db/repositories/base.repository.ts:152-180`) is the generic path. Its `orderBy` handling appends `NULLS LAST` **only on the raw-SQL branch** (`:159-163`); the `Column` branch uses Drizzle's plain `asc()`/`desc()`. Narrower live exposure than the entity-records copy, same latent trap.

Twelve routers repeat `Promise.all([findMany(where, opts), count(where)])`: `entity-record`, `connector-entity`, `connector-instance`, `connector-definition`, `column-definition`, `entity-group`, `entity-tag`, `field-mapping`, `portal`, `portal-results`, `station`, `jobs`.

### The frontend pagination hook

`usePagination` (`apps/web/src/components/PaginationToolbar.component.tsx:183`) is consumed by 15 views/components. Relevant behavior:

| Piece | Location | Note |
|---|---|---|
| Defaults | `:189-190` | `sortBy = "created"`, `sortOrder = "asc"` — the unindexed sort, everywhere |
| Search | `:246`, `:556` | `setSearch` fires straight off `onChange` — no debounce, one query per keystroke |
| `totalPages` | `:300` | Derived from the exact `total`; drives `goToLast` (`:312`), and the Next/Last disabled state (`:918`, `:926`) |
| Controls | `:899-928` | **First / Prev / Next / Last only — there is no page-number input** |
| Display | `:896` | `{currentPage} of {totalPages} ({total})` |

The entity view persists its pagination state to localStorage (`apps/web/src/views/EntityDetail.view.tsx:205-210`), so a user's `sortBy` survives reloads.

### What the table actually consumes

`apps/web/src/views/EntityDetail.view.tsx:425-428` builds each row from `r.normalizedData` and `r.isValid` — nothing else. `sdk.entityRecords.list` has exactly one consumer (`apps/web/src/components/EntityRecordDataTable.component.tsx:73`). The `data` JSONB is read, detoasted, hashed, spilled, serialized and discarded.

Column headers are sortable when the column type allows (`apps/web/src/components/EntityRecordDataTable.component.tsx:108`, `:121`), so a user can sort by any typed data column.

### Environment

`portalai-dev` is `db.t4g.micro` (1 GB RAM, 2 burstable vCPU) on 20 GB gp2, PG 17.9: `work_mem=4MB`, `shared_buffers=184648kB`, `max_parallel_workers_per_gather=2`, against a 725 MB `entity_records`. API pool `max: 10` (`apps/api/src/db/client.ts:16`) on a 512 MB ECS task.

## The design space

### Decision 1 — What index makes the default sort streamable

**A. Partial composite on the scope + sort key.** `(connector_entity_id, created) WHERE deleted IS NULL`. Mirrors the existing `entity_records_entity_source_unique` shape, and the measured 86ms plan is exactly what this produces (index scan on the outer, PK lookup on the wide table).

**B. A, plus `id` as a trailing tiebreaker.** `(connector_entity_id, created, id)`.

**C. Index every column the API will sort by.** Add `created` here, plus per-`c_*` indexes in the reconciler.

| | A | B | C |
|---|---|---|---|
| Fixes the default sort | Yes | Yes | Yes |
| Deterministic page boundaries | Only while the sort key is unique | Yes, always | Only for indexed columns |
| Write cost | One index | One index | One index per sortable column, per wide table |
| Reconciler change | No | No | Yes — and unbounded index count |

**Lean: B.** The tiebreaker is not optional, and the reason is a correctness bug hiding under the perf bug — see Decision 2. C is a trap: wide tables have arbitrary column counts, and indexing each one multiplies sync write cost for a sort a user may never issue.

### Decision 2 — The tiebreaker, and the correctness bug it fixes

`ORDER BY <key>` with no tiebreaker gives Postgres no defined order among ties, and paginating over an undefined order means **rows can repeat on one page and vanish from another**. This is live today, not theoretical. Measured on the app-dev dataset (283,000 rows):

| Sortable key | Distinct values | Average tie group |
|---|---|---|
| `synced_at` (API-sortable, `entity-record.router.ts:62-66`) | **1** | 283,000 — a total tie |
| `c_geometry_type` | **1** | 283,000 — a total tie |
| `c_own_type` | 3 | ~94,333 |
| `c_city` | 19 | ~14,894 (plus 3,914 NULLs) |
| `created` (the UI default) | 283,000 | 1 — unique, by luck |

Every one of those `c_*` columns is sortable from the table header (`EntityRecordDataTable.component.tsx:108`, gated by `SORTABLE_COLUMN_TYPES` = `string`/`number`/`date`/`datetime`). Sorting by `own_type` and paging means each page boundary falls at an arbitrary point inside a ~94K-row tie group. The reason nobody has reported it is that `created` — the only key the UI offers in its sort dropdown — is accidentally unique on this dataset.

A stable tiebreaker is also a **precondition for keyset pagination** (Decision 5): a cursor that cannot uniquely identify its position cannot seek past it.

**A. Append `id` to every ORDER BY** in the entity-record path, and to `base.repository.findMany` when an `orderBy` is supplied.
**B. Append `id` only in the entity-record path.**
**C. Leave it; treat as a separate ticket.**

**Lean: A.** The fix is one clause in two places and it is the difference between correct and incorrect pagination on every list. Doing it here is cheaper than a second ticket, and Decision 1B's index already carries `id` so the entity-record path pays nothing for it. Worth calling out in the spec's acceptance criteria explicitly, because it is a behavior change reviewers should see named rather than buried in a perf PR.

### Decision 3 — How `data` leaves the list projection

`EntityRecordSchema` (`packages/core/src/models/entity-record.model.ts:22`) declares `data` required, and the list payload is `z.array(EntityRecordSchema)` (`packages/core/src/contracts/entity-record.contract.ts:59`). The router currently casts (`entity-record.router.ts:260`), so nothing validates it at runtime — but the contract is what should change.

**A. A narrower list-item schema.** `EntityRecordListItemSchema = EntityRecordSchema.omit({ data: true })`, and the list payload uses it. Honest contract; the type checker finds every consumer.
**B. Make `data` optional on `EntityRecordSchema`.** One-line change, but weakens the model everywhere including the detail path where `data` is genuinely always present.
**C. Keep the projection, add `columns` narrowing.** The route already supports a `columns` param that narrows the *normalized* projection (`:216-231`); the frontend could pass it. Doesn't touch `data` at all, so the hash side stays 1101 bytes wide.

| | A | B | C |
|---|---|---|---|
| Removes the disk spill | Yes | Yes | No |
| Contract stays honest | Yes | No — detail path loses a guarantee | Yes |
| Consumers found by tsc | Yes | No | N/A |

**Lean: A.** The spill is the second-largest cost and `data` is the sole reason for it. B trades a real guarantee for a line of work; C doesn't address the finding.

### Decision 4 — Count strategy

**Decided with the user: exact, but computed once per filter rather than once per page.** Count when `offset === 0`, cache per `(scope, filter)` key, invalidate on write. `total`, `totalPages`, `goToLast` and the `N of M (total)` display all keep working unchanged; there is no contract change and no UI copy change.

Rejected: a planner estimate above a row threshold (makes the displayed total approximate and `goToLast` imprecise, and needs a `~` affordance in the toolbar), and dropping `total` for a `limit+1` has-more probe (cheapest, but removes the total display and jump-to-last across all 15 consumers).

Open sub-question — **where the cache lives.** In-process `Map` is per-ECS-task and would diverge between tasks; Redis is already a dependency (`apps/api/src/queues/`) and is the multi-instance-correct home. **Lean: Redis, short TTL, keyed by `(connectorEntityId, serialized filter)`.** See Enterprise-scale → Concurrency.

### Decision 5 — Deep offsets: keyset cursors

`goToLast` is a single button (`:312`, `:923-928`) that jumps to `offset = (totalPages - 1) * limit` — 282,990 on this dataset, the 39s measurement. The worst offset in the table is one click away, not a rare deep-paging edge case.

**The index does not fix this, which is the measurement that settles the decision.** A keyset seek and an OFFSET jump were compared at the same depth (~90% through the sort order), both ordering by `source_id` — a column that *already* has a composite index:

```
KEYSET  (source_id, id) > (anchor)  LIMIT 10
  Nested Loop → Index Scan using entity_records_entity_source_unique (rows=11)
                Index Scan using er__…_pkey on w (loops=11)
  Execution Time: 21.823 ms

OFFSET  LIMIT 10 OFFSET 254700
  Parallel Hash Join → Parallel Seq Scan on w + Parallel Seq Scan on entity_records
    Buckets: 131072  Batches: 8 (originally 1)      <-- spills
    Sort Method: external merge  Disk: 6704kB
  Execution Time: 24,457.736 ms
```

**1,120x.** Note what the OFFSET plan does: even with a usable index on the sort key, the planner abandons it once the offset is large and falls back to a seq-scan hash join with a disk-spilling external merge. Adding the Decision 1 index makes page 1 fast; it does **not** make deep pages fast. Offset pagination is structurally unable to be cheap at depth.

**A. Accept it.** ~283K nested-loop lookups on the last page, or the seq-scan fallback above.
**B. Serve only the last page by inverting the sort** — flip `sortOrder`, take page 1, reverse the rows. Fixes the one-click worst case and nothing else; sequential `Next` stays linear.
**C. Keyset cursors.** An opaque cursor carries `(sortKeyValue, id)`; the query seeks with a row-value predicate instead of counting rows to skip.

| | A | B | C |
|---|---|---|---|
| Last page | 24s+ | 86ms | 21ms |
| Page 5,000 | 24s+ | 24s+ | 21ms |
| Sequential Next | Linear in offset | Linear in offset | Constant |
| Contract change | None | None | Yes — additive `cursor` |
| Needs a stable tiebreaker | — | Yes | Yes (Decision 2) |

**Decision: C.** Chosen over the earlier lean toward B on the grounds that keyset is the structurally robust answer rather than a patch on the one offset the UI happens to expose — and the measurement above supports it: B leaves every page except the first and last on the 24s path.

Three properties make C cheaper here than it looks:

1. **The toolbar has no page-number input** (`:899-928` — First / Prev / Next / Last only). Arbitrary page jumps are the one thing keyset cannot serve, and the UI never offers them. A cursor can serve the entire existing control set.
2. **`cursor` is additive to the contract.** `offset` stays valid, so the other 11 list routers and the remaining 14 `usePagination` consumers are untouched until they need it. `usePagination` gains an opt-in mode rather than a rewrite.
3. **Last page reuses B's mechanism.** With an exact total (Decision 4), `goToLast` inverts `sortOrder`, takes the first page and reverses — so C subsumes B rather than competing with it, and `Prev` walks a bounded stack of visited cursors.

What still has to be designed: `currentPage` is derived from `offset` today (`:299`), so keyset mode needs it as a counter (incremented on Next, decremented on Prev, reset on First and on any filter/sort change, set to `totalPages` on Last). `totalPages` and the `N of M (total)` display continue to come from the cached exact total, unchanged.

### Decision 6 — Does this stay one branch?

**A. One branch.** The shared machinery and the entity-record work ship together.
**B. Split** — machinery in one PR, entity-record index/projection in a second.

**Lean: A.** The missing `created` index and the "no table indexes the default sort" convention are one finding, and the tiebreaker (Decision 2) has to land with the index that carries it. The plan slices these so each commit is reviewable alone.

**Caveat, recorded because the premise moved.** This lean was formed when Decision 5 was the surgical inverted-last-page fix. Choosing 5C (keyset) enlarges the branch materially — a contract addition, a new predicate with real edge cases, and a `usePagination` mode. The branch stays one PR, but the split line is now explicit: **slices 1–3 (index, tiebreaker, projection) are self-contained and carry the page-1 win; slices 4–5 (cursor, keyset UI) are the keyset work.** If review or context pressure forces a split, it happens there — and slices 1–3 are independently mergeable and independently measurable, so nothing is stranded.

## Tradeoff comparison

|  | 1B index | 2A tiebreaker | 3A list schema | 4 cached count | 5C keyset | 6A one branch |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | No |
| Contract change | No | No | Yes — `packages/core` | No | Yes — additive `cursor` | — |
| Touches shared machinery | No | Yes — `base.repository` | No | Yes — 12 routers | Yes — `usePagination`, opt-in | — |
| Migration needed | Yes — `CREATE INDEX CONCURRENTLY` | No | No | No | No | — |
| Measured payoff | 14,635ms → 86ms | correctness, not speed | removes the 64-batch spill | removes ~3.5s/page floor | 24,457ms → 21ms at depth | — |
| Depends on | — | — | — | — | 1B + 2A | — |

## Recommendation

1. Add `entity_records (connector_entity_id, created, id) WHERE deleted IS NULL` via `CREATE INDEX CONCURRENTLY` in its own migration, so the default sort is an index scan and the join becomes a nested loop.
2. Append `id` as a trailing tiebreaker to every ORDER BY in the entity-record read path and in `base.repository.findMany` whenever an `orderBy` is supplied, and state it in the spec's acceptance criteria as a correctness fix.
3. Emit `NULLS LAST` only for genuinely nullable sort columns, in both `entity-records.repository.ts:538-550` and `base.repository.ts:159-163`.
4. Introduce `EntityRecordListItemSchema` (`EntityRecordSchema.omit({ data: true })`), drop `data` from `findHydratedMany`'s projection, and keep it in `findHydratedById`.
5. Compute the list total only on the first page of a result set, cached in Redis under `(connectorEntityId, serialized filter)` with a short TTL and invalidation on write; keep the response contract and toolbar display unchanged.
6. Add an **additive** `cursor` to the shared pagination request contract and implement keyset seeking in the entity-record read path, leaving `offset` valid for every other list. `usePagination` gains an opt-in keyset mode that tracks a cursor stack and a `currentPage` counter; `goToLast` inverts `sortOrder`, takes the first page and reverses it.
7. Debounce `setSearch` in `usePagination` (~300ms), which fixes every one of the 15 consuming views.
8. Batch `resolveColumns` into a single `WHERE id IN (…)`.
9. Record two conventions in `CLAUDE.md`: a table expected to grow needs an index on `(scope, created, id) WHERE deleted IS NULL` (because `created` is the universal default sort and nothing indexes it), and any `ORDER BY` feeding a paginated list carries a unique trailing tiebreaker.

## Open questions

1. **Does the count cache need invalidation beyond writes through this API?** Connector sync writes records via the worker, not the list route. **Lean: invalidate on the sync job's terminal event as well as on route-level writes**, and pick a TTL short enough (~60s) that a missed invalidation self-heals rather than showing a stale total indefinitely.
2. **Should `synced_at` stay a sortable key at all?** It has one distinct value per sync batch, so sorting by it is nearly meaningless even once it is deterministic. **Lean: keep it** — it is meaningful across multiple syncs, and Decision 2's tiebreaker makes it correct. Removing an API-sortable key is a contract change that doesn't belong in a perf fix.
3. **How far does the `NULLS LAST` fix reach in the generic path?** `base.repository.ts`'s `Column` branch never emitted it, so only routers passing a SQL expression as `orderBy` are affected. **Lean: audit those callers in the spec** rather than assuming the blast radius; the entity-record path is the only one known to pass raw SQL today.
4. **How does the keyset predicate handle a nullable sort column?** `c_city` has 3,914 NULLs, so this is not hypothetical. Row-value comparison (`(col, id) > (val, id)`) does not do what you want across a NULL boundary: with `NULLS LAST` ascending, seeking forward has to mean "still in the non-null region and past the anchor, **or** anywhere in the null region", and once inside the null region it collapses to `col IS NULL AND id > anchorId`. **Lean: emit the null-aware predicate explicitly rather than leaning on row-value comparison**, and make a nullable-column keyset walk a required test case — this is the single most likely place for a subtle skipped-row bug. Note this is also where recommendation 3's conditional `NULLS LAST` genuinely applies: for `c_city` the clause is correct and necessary, not a pessimization.
5. **What is in the cursor, and what happens when it goes stale?** It has to carry the sort key value and the tiebreaker `id`, and it has to be validated against the request's current `sortBy`/`sortOrder` — a cursor minted under one sort is meaningless under another. **Lean: opaque base64 JSON of `{ sortBy, sortOrder, value, id }`, and fail open to the first page** when it doesn't parse or doesn't match the current sort, matching the "fail open, never throw" rule `CLAUDE.md` already sets for addressable views. Sort keys are limited to `string`/`number`/`date`/`datetime` (`SORTABLE_COLUMN_TYPES`, geometry excluded), so the encoded value stays a scalar.
6. **Do the wide tables need any data-column index?** Decision 1C rejects indexing them all. **Lean: none in this ticket.** With keyset, sorting by a data column still needs a sort of the candidate set — correct (with the tiebreaker) but not fast. Revisit only with a real report of a user sorting a large table by a data column; the honest note for the spec is that recommendation 6 makes `created`-ordered paging flat, not every column's.
7. **Is the `db.t4g.micro` sizing in scope?** **Lean: no.** It amplifies every finding here, but the query fixes are what make instance size stop mattering, and bundling an infra change into a query-correctness PR obscures both. File separately if it still hurts after the smoke.

## Enterprise-scale considerations

- **Concurrency & correctness.** The count cache is check-then-act across multiple ECS tasks, which is exactly why it belongs in Redis rather than an in-process `Map` — two tasks must not report different totals for the same table. Decision 2's tiebreaker is itself a correctness fix: undefined sort order under OFFSET means rows repeat and vanish, which for a data-inspection surface is a trust problem, not a cosmetic one. **Lean: Redis-backed count, short TTL, and the tiebreaker treated as an acceptance criterion rather than an implementation detail.**
- **Accuracy & auditability.** The total is a display value, not a record of truth — no ledger semantics needed. The one accuracy commitment worth keeping is that it stays *exact* (Decision 4) rather than becoming an estimate a user might quote. **Lean: exact-and-cached, never approximate.**
- **Failure modes.** Fail-open on the count cache: a Redis miss or outage falls back to computing the count, which is the current behavior — slow, not wrong. Nothing here is safety- or cost-gating, so fail-open carries no risk. **Lean: fail-open with a fallback to the live count.**
- **Scale & unbounded growth.** This is the dimension the ticket exists for, and Decision 5C is the answer rather than a mitigation: page cost becomes a function of `limit` and nothing else, at any depth. The measurement that justifies it is that OFFSET abandons even a usable index at depth (24,457ms with an indexed sort key), so no amount of indexing makes offset pagination flat. **Lean: the spec's acceptance criteria assert page cost is flat across first, middle and last pages — not just that page 1 got faster.** Residual unbounded surface: `ILIKE '%term%'` search still scans, which debouncing manages but does not fix (out of scope, named below).
- **Multi-tenancy.** Every list is already org- and scope-filtered, and the new index leads with `connector_entity_id`, so it keeps per-tenant reads on their own index range. The noisy-neighbor exposure is real and is what the pool of 10 makes acute: one user's 20s query starves other orgs' requests. Fixing the query is the mitigation. **Lean: no per-tenant limit needed once page cost is flat; revisit if a shared-pool stall recurs.**
- **Contract stability.** Decision 4 keeps `total` in the payload, and Decision 5C adds `cursor` **alongside** `offset` rather than replacing it — so every existing list caller keeps working and adopts keyset when it needs to. The only narrowing is the list item losing `data` (Decision 3A), which the type checker surfaces at every call site. **Lean: `cursor` additive and opt-in per consumer; resist a flag-day migration of all 12 routers, which would turn a perf fix into a contract rewrite.**
- **Data lifecycle.** N/A because nothing here introduces a window, period, or retention rule — the count cache TTL is a technical freshness knob, not a business period, and is explicitly allowed to be stale for seconds.

## What this doesn't decide

- **Migrating the other 11 list routers to cursors.** Decision 5C is additive and opt-in; only the entity-record list adopts it here. The rest keep `offset`, which is correct and cheap while their tables are small.
- **Arbitrary page jumps.** Keyset cannot serve "go to page 5,000", and the toolbar has never offered it. If a page-number input is ever wanted, it needs its own design (offset fallback for that one control, or an approximate seek) — not a silent regression discovered later.
- **Making search indexable.** `ILIKE '%term%'` over a `concat_ws` of every text column cannot use a btree, and `pg_trgm` is not installed (only `postgis` is — `apps/api/drizzle/0076_enable-postgis.sql`). A trigram or tsvector search is a real feature with its own tradeoffs; debouncing (recommendation 7) removes the per-keystroke pile-up, which is the acute problem. Out of scope here.
- **Wide-table data-column indexes.** Open question 4 — no index, revisit on a real report.
- **RDS instance sizing.** Open question 5 — separate ticket if it still hurts after the smoke.
- **The other 11 routers' own indexes.** Recommendation 9 records the convention; actually adding `(scope, created, id)` indexes to tables that are currently small would be speculative. They get the machinery fixes (2, 3, 7) for free.

## Next step

Write `docs/PAGINATED_LIST_PERFORMANCE.spec.md` (contract — the narrowed list item, the ORDER BY tiebreaker, the additive `cursor` and its encoding/staleness rules, the null-aware keyset predicate, the count-cache key and invalidation) and `.plan.md` (slices).

Expected slicing, ordered so each commit is independently measurable:

1. Migration + `(connector_entity_id, created, id) WHERE deleted IS NULL` index — measurable alone against app-dev (14,635ms → 86ms on page 1).
2. ORDER BY tiebreaker in both repositories, plus conditional `NULLS LAST`. Correctness slice; the keyset work depends on it.
3. `EntityRecordListItemSchema` + drop `data` from the list projection.
4. Additive `cursor` in the contract and keyset seeking in the entity-record read path, including the null-aware predicate and its nullable-column tests.
5. `usePagination` keyset mode — cursor stack, `currentPage` counter, inverted last page — plus the search debounce.
6. Count cache; then `resolveColumns` batching and the `CLAUDE.md` conventions.

Slices 1–3 carry the bulk of the page-1 win and are safe to merge even if 4–5 need another pass; slices 4–5 are what make cost flat at depth, and slice 4 is where the subtle-bug risk concentrates (open questions 4 and 5).
