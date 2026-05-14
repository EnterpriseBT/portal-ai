# Entity Records — Wide-Table Storage Audit

## Goal

Today every connector record is stored as one wide row in
`entity_records` containing both transactional fields (`source_id`,
`checksum`, `synced_at`, `is_valid`, raw `data`, base columns) and the
post-mapping `normalized_data` JSONB. Portal-session analytics query
`normalized_data`. JSONB + a single GIN index works at small scale but
breaks down for the access patterns LLM tools actually drive: typed
range filters (`amount > 50000`), order-by on numerics or dates,
selective filters that need real column statistics, and cross-record
aggregations.

This document audits a switch to **per-connector-entity wide tables**:
real, typed Postgres columns generated from `field_mappings`. It covers
the storage shape, the reconciler that owns DDL, and the downstream
impact on the in-memory `data_query` tool path
(`AnalyticsService.loadStation` →  AlaSQL → `sql_query`).

### Constraints

Portal.ai has no critical production data to protect at this stage —
all connector data can be wiped and re-synced from source. The
*initial* cutover is therefore destructive and single-step: drop the
JSONB column, truncate `entity_records`, deploy the new path, let
connectors re-sync. The reconciler's careful steady-state behaviour
(staged column retirement, type-change backfill) is for *post-launch*
operation once users have data they care about; it doesn't apply to
the initial migration.

## Current state

### Storage

`entity_records` (`apps/api/src/db/schema/entity-records.table.ts:36`) packs:

- Transactional fields: `id`, `organization_id`, `connector_entity_id`,
  `source_id`, `checksum`, `synced_at`, `origin`,  `validation_errors`,
  `is_valid`, base columns.
- Raw payload: `data jsonb`.
- Analyzable payload: `normalized_data jsonb`.

Indexes: a partial unique on `(connector_entity_id, source_id)` for the
sync upsert, a GIN on `normalized_data`, plus secondary B-trees on
`(connector_entity_id, synced_at)` and `(connector_entity_id, is_valid)`.

The connector entity's *desired* normalized schema is fully declared
elsewhere:

- `field_mappings`
  (`apps/api/src/db/schema/field-mappings.table.ts:22`) ties a
  `connector_entity_id` to a `column_definition_id` plus a
  `normalized_key`.
- `column_definitions`
  (`apps/api/src/db/schema/column-definitions.table.ts`) declares the
  type of each normalized field (`string`, `number`, `boolean`,
  `date`, `datetime`, `enum`, `json`, `array`, `reference`,
  `reference-array`).

So Postgres already knows the *shape* of `normalized_data` per entity —
it just doesn't store it as such.

### Read path during portal sessions

The `sql_query` tool (`apps/api/src/tools/sql-query.tool.ts`) does
**not** query Postgres at session time. Instead, on station load,
`AnalyticsService.loadStation`
(`apps/api/src/services/analytics.service.ts:314`) materializes every
record for every entity into an in-process AlaSQL database:

```
for each connector entity:
  rows = entityRecords.findByConnectorEntityId(entity.id)
       .map(r => ({ _record_id, _connector_entity_id, ...r.normalizedData }))
  CREATE TABLE [entity.key]
  INSERT INTO [entity.key] SELECT * FROM ?  -- AlaSQL bulk
```

Plus four metadata tables: `_connector_instances`, `_connector_entities`,
`_column_definitions`, `_field_mappings`. Surgical mutations
(`applyRecordInsert/Update/Delete` and the `*Many` batch variants,
lines 554–853) keep AlaSQL in sync with database writes during a live
session.

`AnalyticsService.sqlQuery` (line 1025) then runs the LLM-emitted SQL
against the AlaSQL database for that station.

This works because JSONB containment is fine for moderate row counts
and the in-memory copy hides every JSONB-parse cost from the query.
It scales poorly because the *load* now reads every record's JSONB
into Node memory at session start, and the per-process working set is
bounded by RAM.

### Why this no longer scales

- **Row width.** Sync writes pay for the full JSONB on every upsert
  even when nothing analyzable changed. Vacuum and TOAST overhead
  scale with `normalized_data` size, not record count.
- **Query plans.** GIN containment is the only option for typed-ish
  filters; numeric comparisons, range queries, ordering, and
  aggregations all fall back to a sequential scan + JSONB parse.
- **Statistics.** Postgres has no per-key cardinality estimate for
  fields inside a JSONB, so the planner can't choose between scans
  and index lookups well — particularly painful as record counts grow.
- **Session boot.** `loadStation` is `O(records × fields)` of JSONB
  parse + spread into AlaSQL on every cold start. With 25–50 fields
  per entity and large record counts, this dominates session latency.
- **Memory.** AlaSQL holds the entire dataset in V8 heap. Per-process
  RAM puts a hard ceiling on the size of analytic dataset a station
  can support, regardless of what Postgres could otherwise serve.

## Proposed architecture

### Schema

**`entity_records`** keeps the transaction object and only that.
`normalized_data` is dropped; everything else stays. The table remains
the durable record of "this row exists, came from this source, last
synced at this time, passed/failed validation". Sync upserts, watermark
reaping, and integrity invariants are unchanged.

**One wide table per `connector_entity`**, named
`er__<connector_entity_id>` (or `org_<org_id>.er__<entity_id>` once
schema-per-org partitioning is adopted — see *Open questions*). Real
columns mirror that entity's `field_mappings`, typed by the referenced
`column_definitions.type`:

```sql
CREATE TABLE er__cefa9b2c (
  entity_record_id  text PRIMARY KEY
                       REFERENCES entity_records(id) ON DELETE CASCADE,
  organization_id   text NOT NULL,
  synced_at         bigint NOT NULL,
  is_valid          boolean NOT NULL,
  -- one column per field_mapping, named after normalized_key:
  amount            numeric,
  close_date        timestamptz,
  stage             text,
  account_ref       text,
  ...
);

CREATE INDEX ON er__cefa9b2c (organization_id, stage)
  WHERE stage IS NOT NULL;
CREATE INDEX ON er__cefa9b2c (organization_id, close_date);
-- index only what's actually filtered/sorted, not every column
```

Type mapping (`column_definitions.type` → Postgres):

| Column type       | Postgres type   |
|-------------------|------------------|
| `string`, `enum`  | `text`           |
| `number`          | `numeric`        |
| `boolean`         | `boolean`        |
| `date`            | `date`           |
| `datetime`        | `timestamptz`    |
| `reference`       | `text` (FK-shaped, not enforced) |
| `reference-array` | `text[]`         |
| `array`, `json`   | `jsonb`          |

`organization_id`, `synced_at`, `is_valid` are denormalized into the
wide table so portal queries can filter without joining
`entity_records`. `entity_record_id` is the join key when the caller
needs the transaction row too (validation_errors, raw `data`).

### Cross-entity reads

When portal tools need "all records across all entities in my station",
the query layer either fans out (one query per wide table, union in
process) or generates a `UNION ALL` view per station. Both are cheap;
neither needs JSONB.

### Reference fields

`reference` columns store **the target row's `source_id`** (the
identifier the source connector emitted), as `text`. `reference-array`
columns store `text[]` of the same. We do not translate to
`entity_records.id` at write time and we do not add real foreign keys
— references can dangle (target hasn't synced yet) or cross instances
(target lives in a different connector in the same org).

This matches the existing JSONB behaviour exactly: today's
`normalizedData[ref_field]` is the source-id string, not the target
row's `id` (verified at `coercion.util.ts:184` where `coerceReference`
is `String(value)` with no lookup, and at `field-mapping.router.ts:1095+`
where the bidirectional-consistency check compares source-ids on both
sides). The earlier draft of this audit said "store the target
`entity_record_id`" — that was aspirational. The wide-table cutover
keeps the source-id contract.

To support cross-entity JOINs without a three-hop path through
`entity_records.source_id`, every wide table denormalises
`source_id text NOT NULL UNIQUE` as a fifth metadata column alongside
`entity_record_id` / `organization_id` / `synced_at` / `is_valid`. A
"deals with their account names" query collapses from three hops to
one:

```sql
SELECT d.c_amount, a.c_name AS account_name
FROM "er__<deals_id>"   d
JOIN "er__<accounts_id>" a ON a.source_id = d.c_account_ref
WHERE …;
```

The denormalisation is owned by the reconciler (DDL) and the sync
write path (value comes from `entity_records.source_id`). It indexes
naturally and keeps cross-entity JOINs cheap.

## The reconciler

A schema reconciler owns every DDL statement that touches the wide
tables. It is the single point at which the desired schema (declared
in `field_mappings` + `column_definitions`) becomes the actual schema
(observed in `information_schema.columns`).

### Triggers

The reconciler runs on three triggers:

1. **Connector-entity create / soft-delete.** Create the
   `er__<id>` table on entity creation; `DROP TABLE` on hard-delete (or
   `ALTER TABLE ... RENAME` to a tombstone for soft-delete + retention).
2. **Field-mapping change.** Insert, update, or soft-delete in
   `field_mappings` re-runs the reconciler for that entity.
3. **App boot drift check.** On startup, scan all live connector
   entities and verify the wide-table column set matches the declared
   field mappings. Repair any drift before serving traffic.

### Diff & apply

Reconciliation for one connector entity is:

```
desired  = field_mappings(entityId)
            .filter(notSoftDeleted)
            .map(fm => column(fm.normalizedKey, columnTypeFor(fm)))
actual   = information_schema.columns
            .where(table_name = `er__${entityId}`)
            .filter(not in {entity_record_id, organization_id,
                            synced_at, is_valid})

adds     = desired - actual          → ALTER TABLE ADD COLUMN
removes  = actual - desired          → mark retired, drop later
type-changes = actual ∩ desired with type mismatch
                                     → staged add-new + backfill + swap
```

### Adds — cheap

`ALTER TABLE ... ADD COLUMN <name> <type> NULL` (no default) is a
metadata-only operation in modern Postgres. No table rewrite, no
exclusive lock of consequence. Sync writes resume against the wider
schema on the next batch.

### Removes — staged, never destructive on the hot path

A field-mapping soft-delete does **not** immediately drop the column.
The reconciler:

1. Marks the column as retired in a `wide_table_columns` metadata
   table (column name, retired-at timestamp).
2. Stops including the column in generated INSERT statements.
3. A separate maintenance job (cron, manual) runs `ALTER TABLE ...
   DROP COLUMN` for retired columns past a retention window.

This decouples user-driven mapping edits from heavy DDL and gives a
recovery window if a mapping is removed in error.

### Type changes — staged with backfill

Changing `column_definitions.type` for an in-use column is rare but
must be safe:

1. Reconciler adds a sibling column `<name>__v2` with the new type.
2. Background job casts and copies values into the new column.
3. Reconciler swaps reads (regenerated INSERT/SELECT templates point
   at `__v2`).
4. Maintenance job retires the old column.

Renames follow the same add-new → backfill → swap → retire pattern.

### Generated DML

Sync writes do **not** hand-write SQL per entity. The reconciler
maintains a per-entity prepared-statement template, invalidated when
the schema changes:

```sql
INSERT INTO er__cefa9b2c (entity_record_id, organization_id,
                           synced_at, is_valid, amount, close_date, ...)
VALUES ($1, $2, $3, $4, $5, $6, ...)
ON CONFLICT (entity_record_id) DO UPDATE SET
  synced_at = EXCLUDED.synced_at,
  is_valid  = EXCLUDED.is_valid,
  amount    = EXCLUDED.amount,
  close_date = EXCLUDED.close_date,
  ...;
```

The bulk path is one multi-row `INSERT ... VALUES (...), (...), ... ON
CONFLICT` per batch, same shape as today's `upsertManyBySourceId`.

### Failure modes

- **DDL fails mid-reconciliation.** Wrap each entity's reconciliation
  in a transaction; partial state can't leak. On retry, the diff is
  recomputed from the current `information_schema`.
- **Reconciler is behind a sync write.** The generated INSERT will
  reference a column that doesn't exist yet → fail loudly. Sync
  acquires a per-entity advisory lock that the reconciler also holds
  while applying DDL, serializing the two.
- **Boot drift.** App refuses traffic for an entity whose wide table
  doesn't match its `field_mappings` until reconciliation succeeds.

### Code surface

New files (sketched):

```
apps/api/src/services/wide-table-reconciler.service.ts
apps/api/src/services/wide-table-statement.cache.ts
apps/api/src/db/schema/wide-table-columns.table.ts        -- metadata
apps/api/src/db/repositories/wide-table.repository.ts     -- generic
                                                            insert/select
                                                            for any er__<id>
```

Touched files:

```
apps/api/src/db/schema/entity-records.table.ts            -- drop normalized_data
apps/api/src/db/repositories/entity-records.repository.ts -- thin transaction-only
apps/api/src/services/connector-sync.*                    -- write path delegates
                                                            to wide-table.repository
apps/api/src/services/field-mapping.service.ts            -- emit reconciler triggers
```

## Impact on the `data_query` / in-memory path

The current `loadStation` →  AlaSQL approach exists *because* JSONB
queries against Postgres are too slow for portal sessions. Wide tables
remove that constraint, which changes what the in-memory layer is for
and how it gets populated. There are three viable end-states; the doc
recommends the second.

### Option 1 — Keep AlaSQL, change only the loader

Smallest blast radius. `loadStation` reads from the wide table instead
of `entity_records.normalized_data`:

```diff
- const entityRecords = await repo.entityRecords.findByConnectorEntityId(entity.id);
- const rows = entityRecords
-   .map(r => r.normalizedData ? { _record_id: r.id, _connector_entity_id: entity.id, ...r.normalizedData } : null)
-   .filter(Boolean);
+ const rows = await wideTableRepo.findByEntityId(entity.id);
+ // rows already have typed columns; add synthetic _record_id / _connector_entity_id
```

The AlaSQL `CREATE TABLE` calls
(`apps/api/src/services/analytics.service.ts:394`) and surgical
mutations (`applyRecordInsert`, `applyRecordUpdate`, `applyRecordDelete`
and their batch variants, lines 554–853) keep working unchanged — they
still receive a flat row object; that row just comes from the wide
table now instead of being spread out of JSONB.

Pros: no behavioral change for the LLM. Cons: AlaSQL's RAM ceiling
remains; `loadStation`'s `O(records × fields)` cost is now a Postgres
SELECT instead of a JSONB parse, but it's still moving every row into
Node memory.

### Option 2 — `data_query` runs against Postgres directly (recommended)

Once wide tables exist with proper indexes, the underlying reason for
AlaSQL goes away. `sqlQuery` becomes:

```ts
static async sqlQuery({ sql, stationId }) {
  validateSql(sql);                                      // existing allowlist
  const { schemas, viewMap } = await sessionViews(stationId);
  const rewritten = rewriteEntityRefs(sql, viewMap);     // [contacts] → er__abc12...
  return await db.execute(rewritten);
}
```

The LLM's SQL still references entities by their `key` (e.g.
`SELECT * FROM contacts`); a per-session view map (or a temporary
`CREATE TEMP VIEW contacts AS SELECT * FROM er__<id>` per station)
resolves the alias.

Pros:

- Zero in-memory ceiling. Datasets bounded only by Postgres.
- Cold session boot becomes near-instant — no per-record Node copy.
- Surgical-mutation plumbing
  (`applyRecord*`, `applyEntity*`, `applyFieldMapping*`,
  `applyColumnDefinition*`, lines 554–908) deletes entirely; Postgres
  is the source of truth for in-flight reads.
- Aggregations, joins across entities, and typed range filters use
  the planner instead of an in-process SQL engine.

Cons:

- Read isolation across a portal session is no longer "snapshot at
  load time" — sessions see committed writes immediately. Likely
  desirable, but it is a semantic change.
- SQL allowlist (`validateSql`,
  `apps/api/src/services/analytics.service.ts:232`) needs review:
  AlaSQL's surface and Postgres's surface are different. Specifically
  block `pg_*` catalog access, `COPY`, `LISTEN/NOTIFY`, and writes;
  scope every session to the org's schema namespace via `SET LOCAL
  search_path` or a wrapping CTE.
- Vega/visualize paths (`visualize`, `visualizeVega`,
  `analytics.service.ts:1044`+) depend only on `sqlQuery` returning
  rows; they stay unchanged.
- All other analytics methods (`describeColumn`, `correlate`,
  `regression`, `forecast`, etc.) currently pull rows out of AlaSQL
  too. They migrate to a shared "load rows for this entity + filter"
  helper that hits Postgres. A bounded number of call sites — the
  analytics service is the only consumer.

### Option 3 — Hybrid: Postgres for `sql_query`, AlaSQL only for math methods

Run `sql_query` against Postgres directly (Option 2 surface), keep an
on-demand AlaSQL hot cache for the statistics/regression/forecast
methods that already operate on small projected row sets. Lets the
math methods stay synchronous and pure-JS without round-tripping for
every call.

Pros: keeps the heavy analytics methods fast against small slices.
Cons: two read paths to maintain, two cache-invalidation stories. Only
worth doing if Option 2's per-call latency proves unacceptable for the
math methods, which is unlikely on small projected datasets.

### Recommendation

Option 2. Wide tables are the entire point of the change; keeping a
parallel in-memory copy of them is duplicative and re-imports the
scaling ceiling that motivated the work. Migrate `sql_query` to
Postgres-direct in the same phase as the storage cutover, and delete
the AlaSQL plumbing once all analytics methods are ported.

## Impact on the web UI

### Invariant: the API contract does not change

Every UI surface that reads or writes records does so through
`@portalai/core/contracts` types — `EntityRecord`, `ResolvedColumn`,
`EntityRecordListRequestQuery`, `EntityRecordListResponsePayload`,
`EntityRecordPatchRequestBody`, `EntityRecordCreateRequestBody`. The
record shape returned by the API includes
`normalizedData: Record<string, unknown>`
(`packages/core/src/models/entity-record.model.ts:23`). This contract
**stays exactly the same** after the migration. The wide table is an
internal storage detail; the response is rehydrated into the same
`normalizedData` JSONB object the UI already consumes.

That means **no frontend file changes are required** for parity. The
following surfaces continue to work as-is:

| Surface | Reads | Writes |
|---|---|---|
| `Entities.view.tsx` | list (entity counts) | — |
| `EntityDetail.view.tsx` | list + filter + sort + search + pagination + columns projection | clear, revalidate |
| `EntityRecordDetail.view.tsx` | get one + related records | edit, delete |
| `EntityRecordDataTable.component.tsx` | per-cell render via `record.normalizedData[col.normalizedKey]` | row actions |
| `EntityRecordFieldValue.component.tsx` | value rendering by column type | — |
| `EditEntityRecordDialog.component.tsx` | seed from `record.normalizedData` | PATCH `normalizedData` |
| `CreateEntityRecordDialog.component.tsx` | — | POST `normalizedData` |
| `AdvancedFilterBuilder.component.tsx` | `FilterExpression` keyed by `normalizedKey` | — |

`EntityDetail.view.tsx:200-244` — pagination state (`sortBy`, `sortOrder`,
`filters`, `advancedFilters`) is persisted to `localStorage` and sent
as query params. Filter expressions are keyed by `normalizedKey`,
exactly the same identifier that names the wide-table column. So a
persisted filter from before the migration that references e.g. the
`amount` field continues to resolve — the field name didn't move, just
its storage location.

### What changes behind the API

The list endpoint
(`apps/api/src/routes/entity-record.router.ts:144`) keeps its query
schema and response shape; the SQL it builds is rewritten to target
the wide table:

- **Search** (`router.ts:175-183`) — today:
  `EXISTS (SELECT 1 FROM jsonb_each_text(normalized_data) WHERE value ILIKE …)`.
  After: a generated `OR`-joined `ILIKE` across the wide table's text-
  typed columns (or `concat_ws(' ', col_a::text, col_b::text, …) ILIKE`
  if simpler), built once per entity from `field_mappings` and cached
  alongside the prepared statement.
- **Filters** (`utils/filter-sql.util.ts`) — today every operator is
  built around a `jsonbText` expression
  (`normalized_data->>'key'` plus type-aware casts and regex guards
  for numeric / date). After: each `field` in a `FilterExpression`
  resolves directly to a typed column on the wide table; operators
  drop their casts and regex guards entirely. The filter-error
  surface (`ENTITY_RECORD_INVALID_FILTER`) and the
  `parseAndBuildFilterSQL` boundary stay the same — only the
  expression-builder helpers (`buildNumericCondition`,
  `buildDateCondition`, `buildBooleanCondition`,
  `buildEnumCondition`, `buildArrayCondition`,
  `buildStringCondition`) change.
- **Sorting** (`router.ts:65-82, 202-213`) —
  `buildJsonbSortExpression` (with its numeric regex guard and
  CASE-cast) collapses into a direct column reference. The
  `SORTABLE_COLUMNS` map for transactional fields (`created`,
  `syncedAt`, `sourceId`) stays on `entity_records`; sortable
  normalized fields resolve to wide-table columns. `SORTABLE_COLUMN_TYPES`
  no longer needs to gate sort eligibility — every typed column is
  natively sortable.
- **`columns` projection** (`router.ts:233-250`) — today filters keys
  out of the post-hoc `normalizedData` JSONB. After: the SELECT only
  pulls the requested columns from the wide table; the rehydrator
  builds a `normalizedData` object containing exactly those keys.
- **Response rehydration** — the new repository method joins
  `entity_records` to `er__<entity_id>` and projects the wide-table
  row back into the JSONB object the contract expects:

  ```sql
  SELECT
    er.*,
    to_jsonb(w.*) - 'entity_record_id' - 'organization_id'
                 - 'synced_at' - 'is_valid'  AS normalized_data
  FROM entity_records er
  JOIN er__<entity_id> w ON w.entity_record_id = er.id
  WHERE …;
  ```

  This is the only place a JSONB-shaped value is constructed; it
  happens at serialization time, not in storage. Cost is negligible
  compared to today's cost of *parsing* JSONB on every row.

### Single-record paths

`GET .../records/:recordId`,
`PATCH .../records/:recordId`,
`POST .../records`, `POST .../records/import`, and
`POST .../records/revalidate` all use the same rehydration pattern on
the read side. On the write side, `normalizedData` from the request
body is fanned out to typed wide-table columns by a generated INSERT
or UPDATE statement built from `field_mappings`. Validation against
`column_definitions.type` already happens at the contract layer;
unknown keys (not in `field_mappings`) get rejected at write time the
same way they're rejected today by validation.

### Test surface

Frontend tests don't touch storage, so they're unaffected:

- `EntityRecordDataTable.test.tsx`, `EntityRecordDetailView.test.tsx`,
  `EntityDetailView.test.tsx`, `EntityRecordMetadata.test.tsx`,
  `EditEntityRecordDialog.test.tsx`, `CreateEntityRecordDialog.test.tsx`
  drive the components through props and mocked SDK responses with the
  same `EntityRecord` shape. No changes.
- `advanced-filter-builder.util.test.ts`, `advanced-filter-e2e.test.ts`
  exercise the FilterExpression builder against `ResolvedColumn`. No
  changes.

API integration tests against the list endpoint (filters / sort /
search / column projection) become the primary regression net for the
backend rewrite. They already exist and assert on response shape,
which is invariant — they should pass against the new SQL without
modification, modulo whatever sort-stability or null-ordering
differences emerge from moving off JSONB casts.

### Storybook

All stories render the `*UI` (pure-UI) components from props. They
already mock `EntityRecord` shapes directly. No changes.

## Migration

No production data to preserve, so this is a clean cut, not a phased
rollout. Single PR, single deploy:

1. **Build the reconciler** + the generic wide-table repository
   (`wide-table.repository.ts`) + the prepared-statement cache.
2. **Rewrite the sync write path** to upsert into `entity_records`
   (transaction) and `er__<entity_id>` (analyzable) in one
   transaction. The transaction-table upsert no longer touches
   `normalized_data`.
3. **Cut `sql_query`** to Postgres-direct (Option 2). Delete
   `AnalyticsService.loadStation`'s AlaSQL writes, the
   `applyRecord*` / `applyEntity*` / `applyFieldMapping*` /
   `applyColumnDefinition*` mutation surface (lines 554–908), and the
   `stationDatabases` map. Rewrite `validateSql` for Postgres (block
   `pg_*` catalog access, `COPY`, `LISTEN/NOTIFY`, all writes; scope
   reads to the org's data via `SET LOCAL search_path` or wrapping
   CTE). Port the math methods (`describeColumn`, `correlate`,
   `regression`, `forecast`, etc.) onto a shared "fetch projected rows
   from Postgres" helper.
4. **One drizzle migration** named `entity_records_drop_normalized_data`:

   ```sql
   DROP INDEX entity_records_normalized_data_gin;
   ALTER TABLE entity_records DROP COLUMN normalized_data;
   TRUNCATE entity_records CASCADE;
   ```

   Truncate is fine because the analyzable copy doesn't exist yet on
   the new path and connectors re-sync from source. Cascade catches
   any FK consumers of `entity_records.id` we missed.
5. **Re-sync.** Trigger a sync on every live connector instance after
   deploy (one-shot script or admin action). Re-syncs populate both
   the transaction row and the wide-table row through the new write
   path. The reconciler creates each `er__<entity_id>` table on first
   write (or eagerly during deploy from existing `connector_entities`
   rows — recommended, so the first sync isn't blocked on DDL).

Things we do **not** do because there's no data to protect:
dual-write, backfill from JSONB, feature-flagged reads, staged
column-by-column rollout, or a parallel "old path" runtime.

Things we *still* do, because they protect future data: wrap the
reconciler's DDL in transactions, hold a per-entity advisory lock
between reconciler and sync writes, and keep the boot drift check.
These are post-launch safety nets that don't cost anything at
migration time.

## Out of scope

- **Schema-per-org partitioning** (`org_<id>.er__<entity_id>`). Mention
  only — useful when single-namespace table count exceeds Postgres
  comfort (~10k). Single-schema (`public.er__<id>`) is fine to start.
- **Columnar mirror.** Citus columnar / DuckDB / ClickHouse mirroring
  for the largest entities. Wide tables already feed cleanly into
  CDC-driven columnar replication when needed; no decision required
  now.
- **Cross-org analytics views.** Not a v1 requirement.
- **Eliminating the raw `data` JSONB.** Stays. It's the audit trail
  of what the connector actually delivered before mapping.

## Open questions

- **Single-schema vs. schema-per-org from day one.** Schema-per-org
  pays off above ~10k tables but adds reconciler routing and connection
  `search_path` discipline. Recommendation: start single-schema; the
  reconciler is the abstraction that makes the future switch a
  one-time refactor.
- **Wide-table naming.** `er__<connector_entity_id>` is unambiguous but
  opaque in `psql`. Alternative: `er__<org_slug>__<entity_key>` —
  human-readable but requires regenerating on rename.
- **Generated columns for derived fields.** `column_definitions` could
  later add computed fields; Postgres `GENERATED` columns map cleanly,
  but the reconciler needs to know which fields are stored vs. derived.
  Defer until a use case appears.
- **`array` and `reference-array` indexing.** GIN on `text[]` works,
  but adds back some of the JSONB-era cost. Worth profiling once real
  workloads land.
