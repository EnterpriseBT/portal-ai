# Paginated list performance — Spec

Pins the contract for making server-paginated lists cost `O(limit)` instead of `O(table)`: the index and ORDER BY tiebreaker that make the default sort streamable, the narrowed list item that stops shipping the raw payload, keyset cursors for depth, and a cached exact total.

**Issue:** [EnterpriseBT/portal-ai#433](https://github.com/EnterpriseBT/portal-ai/issues/433) · **Discovery:** [`PAGINATED_LIST_PERFORMANCE.discovery.md`](./PAGINATED_LIST_PERFORMANCE.discovery.md)

## Key decisions (flag for review)

1. **The ORDER BY tiebreaker is a correctness fix, not a perf one.** `synced_at` and `c_geometry_type` each have exactly **1 distinct value across 283,000 rows**; `c_own_type` has 3. Paginating over them today can repeat and skip rows. Every paginated `ORDER BY` gains a unique trailing `id`.
2. **`cursor` is additive.** `offset` remains valid on every list. Only the entity-record list implements keyset; the other 11 routers are untouched.
3. **The count stays exact, never an estimate** — it is cached, not approximated, so `total` / `totalPages` / `goToLast` and the `N of M (total)` display are unchanged.
4. **Count cache lives in Redis, not in-process** — multiple ECS tasks must not report different totals for the same table. Fail-open: a Redis miss or outage falls back to computing the count.
5. **Audit result (discovery open question 3):** every router types `SORTABLE_COLUMNS: Record<string, Column>`, so **no caller reaches `base.repository.ts`'s raw-SQL `NULLS LAST` branch**. That fix is latent-trap hygiene with no behavior change. The tiebreaker added to the same method **is** a live change for all 12 list routers.
6. **Wide-table data columns get no new indexes.** Sorting by `c_city` remains a sort of the candidate set. This spec makes `created`-ordered paging flat, not every column's.

## Scope

### In scope

- `entity_records` index on `(connector_entity_id, created, id) WHERE deleted IS NULL` + migration.
- Trailing `id` tiebreaker on every paginated ORDER BY, in `entity-records.repository.ts` and `base.repository.ts`.
- Conditional `NULLS LAST` (emit only for nullable sort columns) in both repositories.
- `EntityRecordListItemSchema` — the list payload drops `data`.
- Additive `cursor` on `PaginationRequestQuerySchema`; keyset seeking in the entity-record list path, including the null-aware predicate.
- Redis-cached exact total, computed on the first page of a result set.
- `usePagination` — opt-in keyset mode (cursor stack, `currentPage` counter, inverted last page) and a debounced search.
- `resolveColumns` batched into one query.
- `CLAUDE.md` + `.github/copilot-instructions.md` convention entries.

### Out of scope

- Migrating the other 11 list routers to cursors (they keep `offset`; additive by design).
- Arbitrary page-number jumps — the toolbar has never offered them, and keyset cannot serve them.
- Making `ILIKE '%term%'` search indexable (`pg_trgm` is not installed; only `postgis` is). Debounce manages the pile-up; it does not fix the scan.
- Per-`c_*` wide-table indexes.
- RDS instance sizing (`db.t4g.micro`) — separate ticket if it still hurts after the smoke.

## Surface

### `PaginationRequestQuerySchema` (`packages/core/src/contracts/pagination.contract.ts:6`)

Adds one optional field. `offset` keeps its `.default(0)`, so every existing caller is unaffected.

```ts
export const PaginationRequestQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional().default(20)
    .transform((v) => Math.min(v, 100)),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.string().optional().default("created"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
  /** Opaque keyset cursor. When present and valid, takes precedence over `offset`. */
  cursor: z.string().optional(),
});
```

`PaginatedResponsePayloadSchema` (`:27`) gains the cursor for the next page — `null` when the result set is exhausted:

```ts
export const PaginatedResponsePayloadSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  nextCursor: z.string().nullable().optional(),
});
```

### Cursor encoding (`packages/core/src/contracts/pagination.contract.ts`, new)

Base64url of a JSON object. Opaque to clients — the shape is an implementation detail, pinned here only so tests can assert round-trips.

```ts
export const KeysetCursorSchema = z.object({
  /** Sort key the cursor was minted under. A mismatch invalidates it. */
  sortBy: z.string(),
  sortOrder: z.enum(["asc", "desc"]),
  /** Sort-key value at the anchor row. `null` encodes a NULL sort value. */
  value: z.union([z.string(), z.number(), z.null()]),
  /** Tiebreaker — the anchor row's `id`. */
  id: z.string(),
});
export type KeysetCursor = z.infer<typeof KeysetCursorSchema>;

export function encodeCursor(cursor: KeysetCursor): string;
/** Returns `null` for malformed input — never throws. */
export function decodeCursor(raw: string): KeysetCursor | null;
```

**Staleness rule (fail open, never throw).** A cursor is *ignored* — the request serves the first page — when it fails to decode, or when its `sortBy`/`sortOrder` differ from the request's. This matches the "fail open, never throw" rule `CLAUDE.md` sets for addressable views. **No new `ApiCode`** is added; an unusable cursor is not an error.

### `EntityRecordListItemSchema` (`packages/core/src/models/entity-record.model.ts`)

`data` (`:22`) is the raw pre-mapping payload. It is the sole reason the list query's hash side is 1101 bytes wide and spills to 64 batches, and no list consumer reads it.

```ts
/** List projection — omits the raw `data` payload. Detail reads use `EntityRecordSchema`. */
export const EntityRecordListItemSchema = EntityRecordSchema.omit({ data: true });
export type EntityRecordListItem = z.infer<typeof EntityRecordListItemSchema>;
```

`EntityRecordListResponsePayloadSchema` (`packages/core/src/contracts/entity-record.contract.ts:57`) changes `records: z.array(EntityRecordSchema)` → `z.array(EntityRecordListItemSchema)`. `EntityRecordSchema` itself is **unchanged** — the detail path keeps its `data` guarantee.

### `ListOptions` (`apps/api/src/db/repositories/base.repository.ts:66`)

```ts
export interface ListOptions {
  search?: string;
  include?: string[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  organizationId?: string;
  orderBy?: { column: Column | SQL; direction?: "asc" | "desc" };
  /** Keyset anchor. When set, `offset` is ignored. */
  keyset?: { column: Column | SQL; value: string | number | null; id: string; nullable: boolean };
}
```

### ORDER BY construction — tiebreaker + conditional `NULLS LAST`

Two implementations, same rules.

**`apps/api/src/db/repositories/entity-records.repository.ts:538` (`buildOrderByClause`)** currently emits `NULLS LAST` unconditionally on both branches. New contract:

- `NULLS LAST` is emitted **only** when the sort column is nullable. `entity_records.created`, `.synced_at`, `.source_id` are `NOT NULL`; wide-table `c_*` columns are nullable.
- The clause always ends with `, "entity_records".id <direction>` as a unique tiebreaker.

```ts
function buildOrderByClause(opts: {
  column: Column | SQL;
  direction?: "asc" | "desc";
  nullable?: boolean;   // default false — omit NULLS LAST
}): SQL;
```

**`apps/api/src/db/repositories/base.repository.ts:152-165`** — the `Column` branch already emits no nulls clause (Drizzle `asc()`/`desc()`), which is index-compatible; the raw-SQL branch's `NULLS LAST` is unreachable from every current caller (Key decision 5). Both branches gain the trailing `id` tiebreaker whenever `opts.orderBy` is supplied. Ordering by `id` alone stays un-duplicated.

### Keyset predicate (`apps/api/src/db/repositories/entity-records.repository.ts`)

`buildKeysetPredicate(col, value, id, direction, nullable): SQL`.

For a **non-nullable** column, ascending, this is a plain row-value seek:

```sql
(<col>, "entity_records".id) > (<value>, <id>)
```

For a **nullable** column with `NULLS LAST` ascending, row-value comparison is wrong across the NULL boundary. The predicate is explicit:

```sql
-- anchor value is NOT NULL: remaining non-null rows past the anchor, then the whole NULL region
(<col> > <value>) OR (<col> = <value> AND "entity_records".id > <id>) OR (<col> IS NULL)
-- anchor value IS NULL: already inside the NULL region, tiebreaker only
(<col> IS NULL AND "entity_records".id > <id>)
```

Descending mirrors it with `<` and the NULL region leading. `c_city` (3,914 NULLs of 283,000) is the fixture this is tested against.

### `findHydratedMany` (`apps/api/src/db/repositories/entity-records.repository.ts:388`)

```ts
async findHydratedMany(
  connectorEntityId: string,
  opts: ListOptions & { where?: SQL; normalizedDataProjection?: SQL } = {},
  client: DbClient = db
): Promise<EntityRecordListItem[]>
```

Changes: `"entity_records".data` is **removed** from the SELECT list (`:429`); the return type narrows to `EntityRecordListItem[]`; `opts.keyset` appends the keyset predicate to the WHERE and suppresses `OFFSET`. `findHydratedById` (`:478`) is **unchanged** and still projects `data`.

### `EntityRecordCountCache` (`apps/api/src/services/entity-record-count.cache.ts`, new)

Redis-backed (`getRedisClient` from `apps/api/src/utils/redis.util.ts`), mirroring the fixed-window counter precedent in `apps/api/src/utils/rate-limit.util.ts`.

```ts
export class EntityRecordCountCache {
  /** Key: `erc:<connectorEntityId>:<sha256 of the serialized filter set>` */
  static key(connectorEntityId: string, filterFingerprint: string): string;
  /** Cached total, or null on miss / Redis error (fail open). */
  static get(connectorEntityId: string, filterFingerprint: string): Promise<number | null>;
  /** TTL 60s. Best-effort — a write failure is logged, never thrown. */
  static set(connectorEntityId: string, filterFingerprint: string, total: number): Promise<void>;
  /** Drops every cached total for the entity. Best-effort. */
  static invalidate(connectorEntityId: string): Promise<void>;
}
```

The fingerprint covers `search`, `filters`, `isValid` — everything that changes the result-set size. `sortBy`, `sortOrder`, `limit`, `offset` and `cursor` are **excluded**: they reorder or window the set without resizing it.

**Invalidation** on every path that changes an entity's row count *or* its `is_valid` distribution (`isValid` is in the fingerprint). Verified write paths:

| Path | Location |
|---|---|
| Create / import / bulk / update / delete routes | `entity-record.router.ts:462`, `:581`, `:713`, `:839`, `:1015`, `:1142` |
| Layout-plan commit | `apps/api/src/services/layout-plan-commit.service.ts` |
| Revalidation (changes `is_valid`, not row count) | `apps/api/src/queues/processors/revalidation.processor.ts` |
| Bulk transform | `apps/api/src/queues/processors/bulk-transform.processor.ts` |
| Bulk geocode | `apps/api/src/queues/processors/bulk-geocode.processor.ts` |

Slice 6 re-derives this set from `entityRecordsRepo` / `wideTableRepo` call sites rather than trusting this table, since a missed writer degrades to a stale total for up to the TTL. The 60s TTL is the backstop.

### List route (`apps/api/src/routes/entity-record.router.ts:128`)

- Reads `cursor` from the validated query; decodes it, discards it on a `sortBy`/`sortOrder` mismatch, otherwise passes `opts.keyset`.
- The total is resolved as: **cache hit** → use it; **miss and this is the first page** (no `cursor` and `offset === 0`) → run `countHydrated`, store it; **miss and not the first page** → run `countHydrated` (correctness beats the saving on an uncached deep page).
- Response carries `nextCursor`: minted from the last returned row when `records.length === limit`, else `null`.
- `resolveColumns` (`:70-83`) replaces its per-id `findById` loop with a single `columnDefinitionsRepo.findMany(inArray(columnDefinitions.id, colDefIds))`.
- `SORTABLE_COLUMNS` (`:62`) is unchanged.

`countHydrated` (`:451`) keeps the wide-table JOIN only when the `where` references the `w` alias; otherwise it counts `entity_records` alone.

### `usePagination` (`apps/web/src/components/PaginationToolbar.component.tsx:183`)

`UsePaginationConfig` (`:143`) gains:

```ts
  /** Opt-in keyset mode. Default "offset" — every other consumer is unchanged. */
  mode?: "offset" | "keyset";
  /** Search debounce in ms. Default 300. */
  searchDebounceMs?: number;
```

`UsePaginationReturn` (`:159`) gains `cursor: string | null` and `setNextCursor: (cursor: string | null) => void`. In keyset mode:

- `queryParams` emits `cursor` instead of `offset`.
- A cursor stack backs `Prev`; `First` clears it. `currentPage` becomes a counter (increment on Next, decrement on Prev, `1` on First and on any search/filter/sort/limit change, `totalPages` on Last).
- `Last` sets an `inverted` flag: the request flips `sortOrder`, sends no cursor, and the view reverses the returned rows. Rows on a partial last page are `total % limit || limit`.
- `totalPages` (`:300`) and the `{currentPage} of {totalPages} ({total})` display (`:896`) are **unchanged** — both still read the exact `total`.

`setSearch` (`:246`) debounces the query-param update by `searchDebounceMs`; the input stays controlled and updates immediately, and `resetOffset()` still fires. This applies to **all 15 consumers**, not just keyset mode.

`EntityDetail.view.tsx` (`:205`) passes `mode: "keyset"`; its persisted `PaginationPersistedState` is unchanged (cursors are never persisted).

### Error codes

**None added.** An unusable cursor fails open to the first page; a Redis outage falls back to a live count.

## Migration

One migration, index only — no schema change:

```bash
cd apps/api && npm run db:generate -- --name entity-records-created-sort-index
```

The generated SQL is hand-edited to `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and the migration marked non-transactional, since `CONCURRENTLY` cannot run inside a transaction block:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "entity_records_entity_created_id_idx"
  ON "entity_records" ("connector_entity_id", "created", "id")
  WHERE deleted IS NULL;
```

The matching `index(...)` entry is added to `apps/api/src/db/schema/entity-records.table.ts:62-75` so the Drizzle schema and the DB stay in step.

**Ordering:** index-only and additive; safe to apply before or after the code deploy. `CONCURRENTLY` keeps writes unblocked during the ~283K-row build on app-dev.

## Seed

No seed change. No per-organization rows are added, so the `SYSTEM_COLUMN_DEFINITIONS` backfill rule (`CLAUDE.md` → "Adding a system column definition") does not apply.

## TDD test plan

Run via `npm run test:unit` / `npm run test:integration` from each package — never raw jest (missing `NODE_OPTIONS` breaks ESM).

### Layer 1 — `@portalai/core` contracts (`packages/core/src/__tests__/contracts/pagination.contract.test.ts`, new)

- `cursor` is optional; omitting it leaves `offset` defaulting to `0`.
- `encodeCursor` → `decodeCursor` round-trips string, number and `null` values.
- `decodeCursor` returns `null` for malformed base64, valid base64 of non-JSON, and JSON failing `KeysetCursorSchema` — never throws.
- `EntityRecordListItemSchema` rejects nothing that `EntityRecordSchema` accepts minus `data`; `EntityRecordSchema` still requires `data`.

**≈ 9 cases**

### Layer 2 — repositories (integration, `apps/api/src/__tests__/__integration__/db/repositories/`)

`entity-records.repository.integration.test.ts` (extend):

- `findHydratedMany` result objects have no `data` key; `findHydratedById` still does.
- ORDER BY emits the `id` tiebreaker; two rows sharing a `created` value paginate deterministically across two pages with no repeat and no gap.
- `NULLS LAST` is absent for a `NOT NULL` sort column and present for a nullable one.
- Keyset walk over a **non-nullable** column returns every row exactly once across the full table.
- Keyset walk over a **nullable** column (`c_city`-shaped fixture, mixed NULL/non-NULL) returns every row exactly once, crossing the NULL boundary in both `asc` and `desc` — the regression case for open question 4.
- Keyset and offset pagination return identical row sequences for the same sort.
- `countHydrated` drops the wide-table JOIN when the `where` doesn't reference `w`.

`base.repository.integration.test.ts` (extend):

- `findMany` with `orderBy` appends the `id` tiebreaker; ties paginate deterministically.
- Ordering by `id` alone does not duplicate the clause.

**≈ 14 cases**

### Layer 3 — count cache (`apps/api/src/__tests__/services/entity-record-count.cache.test.ts`, new)

- Key includes the filter fingerprint; `sortBy` / `sortOrder` / `limit` / `offset` / `cursor` do not change it; `search` / `filters` / `isValid` do.
- `get` returns `null` on miss.
- `get` returns `null` (not a throw) when Redis errors — fail open.
- `set` failure is swallowed and logged.
- `invalidate` drops every key for the entity.

**≈ 8 cases**

### Layer 4 — list route (integration, `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`, new)

- Page 1 without a cursor returns `nextCursor`; the last page returns `nextCursor: null`.
- Following `nextCursor` yields the next page with no overlap.
- A cursor minted under `sortBy=created` is ignored when the request sends `sortBy=sourceId` — serves page 1, status 200, no error code.
- A malformed cursor serves page 1, status 200.
- `total` is identical across pages, and the second page does not recompute it (cache hit).
- A create/delete invalidates the cached total.
- Response records carry no `data` key.

**≈ 12 cases**

### Layer 5 — web (`apps/web/src/__tests__/PaginationToolbar.test.tsx`, extend)

- Default `mode: "offset"` — `queryParams` still emits `offset`, never `cursor` (the regression guard for the other 14 consumers).
- Keyset mode emits `cursor` and omits `offset`.
- Next pushes onto the cursor stack; Prev pops it; First clears it and resets `currentPage` to 1.
- Changing search / filter / sort / limit resets the stack and `currentPage`.
- Last requests the inverted sort with no cursor and sets `currentPage` to `totalPages`.
- `setSearch` updates the input immediately but debounces `queryParams`; rapid keystrokes produce one param change.

**≈ 11 cases**

### Layer 6 — migration

No dedicated test. The index is asserted indirectly by the Layer 2 keyset/tiebreaker cases, which fail on correctness (not timing) if the ORDER BY contract is wrong. Timing is verified in the smoke, against app-dev.

**Totals ≈ 54 cases**

## Acceptance criteria

- [ ] Page 1 of a 283K-record entity returns in **under 1s** (measured 14,635ms today).
- [ ] The **last** page costs the same order as the first — no page is more than ~2x another (measured 39.1s vs 20.5s today).
- [ ] Walking every page of a 283K-record entity, sorted by a column with heavy ties (`own_type`, 3 distinct values), returns each record **exactly once** — no repeats, no gaps.
- [ ] The same walk over a nullable column (`city`, 3,914 NULLs) returns each record exactly once, in both sort directions.
- [ ] The list response contains no `data` key; the record detail view still shows the raw payload.
- [ ] `total` displayed in the toolbar is exact and unchanged in meaning; `goToLast` still lands on the final page.
- [ ] Typing a 6-character search term issues **one** list request, not six.
- [ ] A cursor from a different sort, or a corrupted cursor, shows page 1 rather than an error.
- [ ] Every other paginated view (connectors, jobs, tags, …) behaves exactly as before — same params, same results.
- [ ] `npm run build`, `npm run type-check`, `npm run lint` and `npm run test` pass.

## Risks & rollback

| Risk | Detection | Mitigation / rollback |
|---|---|---|
| **Keyset predicate skips or repeats rows at a NULL boundary** — the highest-risk item in this spec | Layer 2 full-walk tests assert exactly-once over a mixed NULL fixture, both directions | Predicate is confined to `buildKeysetPredicate`; reverting `mode: "keyset"` in `EntityDetail.view.tsx` falls back to offset with no server change |
| Cached total goes stale after a sync writes rows | 60s TTL bounds it; smoke checks the count after an import | Fail-open by design — a stale total misreports `totalPages` briefly, never wrong rows. `invalidate` on the sync terminal event is the primary path, TTL the backstop |
| Redis unavailable | Count falls back to a live query | **Fail-open, deliberate** — degrades to today's latency, never to an error. No safety or cost gate rides on this cache |
| Tiebreaker changes result order for existing clients | Layer 2 + Layer 4 tests pin ordering | The change *is* the fix — previous order was undefined among ties. Named in acceptance criteria so it isn't mistaken for a regression |
| `CREATE INDEX CONCURRENTLY` fails mid-build, leaving an invalid index | `\d entity_records` shows `INVALID` | `DROP INDEX` and re-run; `IF NOT EXISTS` makes the migration re-runnable. No data risk — index-only |
| Dropping `data` breaks an unsurveyed consumer | `type-check` fails at every call site (the reason for a narrowed schema over an optional field) | Restore the column in the projection; the schema change is one line |

## Files touched

**New**
- `apps/api/drizzle/00XX_entity-records-created-sort-index.sql`
- `apps/api/src/services/entity-record-count.cache.ts`
- `apps/api/src/__tests__/services/entity-record-count.cache.test.ts`
- `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`
- `packages/core/src/__tests__/contracts/pagination.contract.test.ts`

**Edited**
- `packages/core/src/contracts/pagination.contract.ts` — `cursor`, `nextCursor`, `KeysetCursorSchema`, `encodeCursor` / `decodeCursor`
- `packages/core/src/models/entity-record.model.ts` — `EntityRecordListItemSchema`
- `packages/core/src/contracts/entity-record.contract.ts:57` — list payload uses the narrowed item
- `apps/api/src/db/schema/entity-records.table.ts:62-75` — index entry
- `apps/api/src/db/repositories/entity-records.repository.ts` — `buildOrderByClause`, `buildKeysetPredicate`, `findHydratedMany`, `countHydrated`
- `apps/api/src/db/repositories/base.repository.ts:152-180` — tiebreaker, conditional `NULLS LAST`, `keyset` in `ListOptions`
- `apps/api/src/routes/entity-record.router.ts` — cursor handling, count cache, `resolveColumns` batching, invalidation on writes
- `apps/api/src/services/layout-plan-commit.service.ts`, `apps/api/src/queues/processors/revalidation.processor.ts`, `bulk-transform.processor.ts`, `bulk-geocode.processor.ts` — count-cache invalidation
- `apps/web/src/components/PaginationToolbar.component.tsx` — keyset mode, cursor stack, debounce
- `apps/web/src/views/EntityDetail.view.tsx` — opts into keyset mode
- `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts`, `base.repository.integration.test.ts`, `apps/web/src/__tests__/PaginationToolbar.test.tsx`
- `CLAUDE.md` + `.github/copilot-instructions.md` — indexing and tiebreaker conventions

## Next step

`docs/PAGINATED_LIST_PERFORMANCE.plan.md` carves this into **6 TDD slices**, each a testable commit on this branch: (1) migration + index, (2) tiebreaker + conditional `NULLS LAST` in both repositories, (3) `EntityRecordListItemSchema` + projection narrowing, (4) cursor contract + keyset predicate + route wiring, (5) `usePagination` keyset mode + debounce, (6) count cache + `resolveColumns` batching + convention docs. Slices 1–3 carry the page-1 win and are independently mergeable; slice 4 is where the subtle-bug risk concentrates and takes the heaviest test load.
