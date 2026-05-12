# Entity Records Wide-Table Storage — Phase 3 — Spec

**The `data_query` tool moves off AlaSQL onto Postgres-direct.** Portal sessions stop preloading every analyzable row into an in-process AlaSQL database; the LLM's `sql_query` tool runs `SELECT` against Postgres against per-session views aliased to the LLM's entity keys; the `apply*` mutation surface that today keeps AlaSQL coherent with database writes is deleted; math methods (`describeColumn`, `correlate`, `regression`, `forecast`, `decompose`, `changepoint`, `trend`, `technicalIndicator`, `aggregate`, `cluster`, `outliers`, `hypothesisTest`, `logisticRegression`, financial methods) pull only the columns they need from Postgres via a shared `fetchProjectedRows` helper; `validateSql` is rewritten as a Postgres deny-list with explicit context-bloat mitigations.

After phase 3, the only in-process layer the LLM session keeps is its `StationContext` schema metadata. Cold-session boot becomes near-instant. SQL runs against Postgres with real plans and statistics. Per-process RAM is no longer the dataset-size ceiling.

This phase corresponds to the proposal's "Phase 3 — `data_query` tool to Postgres-direct" (originally Phase 4 before the 2026-05-09 renumbering). It depends on phase 2's wide-table read primitives (the typed columns are what the views project) but is otherwise independent of the rest of phase 2's REST-route surface.

Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Audit: `docs/ENTITY_RECORDS_WIDE_TABLE.audit.md`. Phase 1 spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.spec.md`. Phase 2 spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md`.

Resolved decisions for this phase:

- **Per-session views, not a query rewriter.** Each LLM session that touches `sql_query` materialises a transaction-scoped read-only set of temp views: one view per read-capable entity in the station, named after the entity's `key` (`contacts`, `deals`, …), aliasing `er__<connector_entity_id>` plus two synthetic columns (`_record_id`, `_connector_entity_id`). The LLM continues to write SQL against `entity.key`; the database resolves it through the view. A query rewriter that mangles `SELECT … FROM contacts` into `SELECT … FROM "er__<id>"` was rejected for two reasons: (a) the LLM occasionally writes valid SQL whose AST is hard to round-trip safely, and (b) views give Postgres's planner everything it needs while letting `validateSql` stay a textual deny-list. The views are created in a savepoint at the head of each `sqlQuery` call and dropped at the end.
- **Per-call lifecycle, not per-session.** Views are created and torn down inside each `sqlQuery` call's pg transaction. Lifetime = one tool call. Reasons: (a) Postgres temp views are session-scoped, and the pg pool may hand a different connection to the next tool call; (b) one tool call is short enough that re-creating the view set adds <5 ms per call (negligible vs LLM inference latency); (c) eliminates the leak class where a long-lived portal session holds Postgres state across many tool calls.
- **Read-capability gating at view creation, not in `validateSql`.** The view set is built from `resolveEntityCapabilities(stationId)` and excludes any entity whose `read` capability is false. The LLM physically cannot `SELECT * FROM <key>` for a read-disabled entity because no view by that name exists in the transaction. `validateSql` does not duplicate the check — it is the SQL-syntax deny-list, separate concern.
- **Synthetic identifier columns are projected by the view, not the raw table.** Today `loadStation` injects `_record_id` and `_connector_entity_id` as additional columns on every AlaSQL table (`analytics.service.ts:382-389`) so the LLM can `SELECT _record_id, … FROM contacts WHERE …` before calling `entity_record_update`. Phase 3 preserves this contract by having the view itself project them: `_record_id` from the join's transactional row, `_connector_entity_id` as a literal embedded into the view's definition.
- **`validateSql` is a deny-list, not an allow-list.** Postgres has far more dangerous verbs than AlaSQL did. The new check rejects every DML and DDL verb (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP`, `GRANT`, `REVOKE`, `VACUUM`, `ANALYZE`, `CLUSTER`, `REINDEX`, `LOCK`), every server-side side-effect verb (`COPY`, `LISTEN`, `NOTIFY`, `UNLISTEN`, `CALL`, `DO`, `SET`, `RESET`, `EXPLAIN`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `PREPARE`, `EXECUTE`, `DEALLOCATE`), every reference to the system catalogs (`pg_catalog`, `information_schema`, `pg_toast`, `pg_temp`), every function call to the side-effect surface (`pg_*`, `lo_*`, `dblink*`, `query_to_*`), and every `;`-separated statement (single statement per call). Read-only wrapping (`SET LOCAL transaction_read_only = on`) is the belt-and-suspenders enforcement at the connection level. Static regex check first; if it passes, the query runs inside a `READ ONLY` transaction so the database refuses any write that slipped past.
- **Context-bloat mitigations are server-side and unconditional.** The LLM cannot opt out: every `sqlQuery` response goes through row-cap → cell-cap → payload-cap → metadata envelope in that order. Defaults: 500 rows, 500 chars per cell, 100 KB total payload. Beyond the row cap, the response is a `{ rows, truncated: true, totalCount, hint }` envelope. Beyond the payload cap, even the first 500 rows can't fit and the response collapses to `{ truncated: true, sample: [first 10], totalCount, columnSizes }`.
- **Implicit safety `LIMIT`.** If the LLM submits a `SELECT` without an explicit `LIMIT` and without a top-level aggregation (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, etc. detected by parser, not regex), the server wraps the query in `SELECT * FROM (<llm sql>) _q LIMIT <row-cap + 1>`. The `+1` lets the response detect "more rows existed" honestly. The wrap is one stage of the request pipeline; the LLM sees the limited result and an `appliedLimit: <n>` field in the response so it knows the wrap fired.
- **Math methods pull from Postgres via `fetchProjectedRows`.** Today `describeColumn`, `correlate`, etc. take `records` (already-loaded AlaSQL rows) and project columns in JS. Phase 3 takes `connectorEntityId` + `columns: string[]` + `where?: SQL` and runs `SELECT "_record_id", "<col_1>", "<col_2>", … FROM "er__<id>" WHERE org_id = $1 [AND <where>] LIMIT <method-specific cap>`. Column resolution goes through `WideTableStatementCache.columnRefByNormalizedKey`. The methods' math is unchanged; only the data source moves. Numeric tolerance is preserved at machine-epsilon level for representative datasets (test 14 below).
- **AlaSQL deletion is comprehensive, in one slice.** `apps/api/package.json` removes the `alasql` dependency; the `stationDatabases` Map deletes; `loadStation`'s AlaSQL write loop deletes; every `apply*` (insert/update/delete singletons and `…Many` bulk variants for records / entities / column-definitions / field-mappings) deletes; `cacheInsert` / `cacheUpsert` / `cacheDelete` / `cacheBatchInsert` / `cacheBatchUpsert` / `cacheBatchDelete` delete; `dropDatabase` / `getOrCreateDatabase` / `cleanup` delete. The tools (`entity-record-create.tool`, `entity-record-update.tool`, `entity-record-delete.tool`, `field-mapping-*.tool`, `connector-entity-*.tool`) lose their post-mutation `AnalyticsService.apply*Many` calls because Postgres is now the source of truth.
- **`loadStation` returns metadata only.** Schema (entity keys, column definitions, field mappings, capabilities) still lands in `StationContext` so the system prompt can render the available-data section. No row data is loaded anywhere. Cold-session boot drops from "fetch every record and copy into AlaSQL" to "fetch the entity / field-mapping / column-definition metadata" — milliseconds even on large stations.
- **`system.prompt.ts` is rewritten for the Postgres surface.** The schema dump stays (the LLM still needs to know what columns exist). New explicit guidance: "this is PostgreSQL-compatible SQL; avoid `SELECT *` on entity tables; always include `LIMIT` for exploratory queries; prefer aggregations over scanning rows." The AlaSQL-specific notes (metadata-table prefixed names like `_connector_instances`, `_connector_entities`, etc.; AlaSQL bracket-quoting) delete. The `_record_id` / `_connector_entity_id` projection survives because the views project them.
- **No new public dependency.** The Postgres pool already in `apps/api/src/db/client.ts` is the execution path. AlaSQL is removed from `package.json`. No new framework, no new env var.
- **No API contract changes.** The portal-session surface (the tools and their response shapes) is unchanged from the LLM's perspective. The `sqlQuery` response gains the truncation envelope fields, which the LLM consumes as plain text in tool responses — no schema work.

After this phase: portal cold-start is near-instant; SQL runs against Postgres with proper plans and statistics; no per-process RAM ceiling on station size; the AlaSQL dependency, the in-memory station map, and the surgical-mutation plumbing all gone; the `sql_query` surface is strictly more locked-down than the AlaSQL one it replaces.

---

## Scope

### In scope

1. **`AnalyticsService.sqlQuery` rewrite** to run against Postgres via the existing pg pool, behind a per-call transaction that:
   - Sets the transaction to `READ ONLY` (`SET LOCAL transaction_read_only = on`).
   - Sets `SET LOCAL statement_timeout = 30000` (30s safety stop).
   - Creates the per-session temp views.
   - Runs the validated, optionally-wrapped LLM SQL.
   - Returns rows with the truncation envelope applied.
   - Implicit `ROLLBACK` (read-only — nothing to commit).

2. **Per-session view builder** (`apps/api/src/services/portal-sql.service.ts`, new):
   - `buildSessionViewsSql(entityCapabilities, organizationId)` — returns the `CREATE TEMP VIEW … AS SELECT …` strings plus the entity-key → view-name map. View bodies:
     ```sql
     CREATE TEMP VIEW "<entity.key>" AS
       SELECT
         w.entity_record_id  AS _record_id,
         '<connector_entity_id>'::text AS _connector_entity_id,
         w.* EXCEPT (entity_record_id, organization_id, is_valid, synced_at, source_id)
         -- (Postgres has no EXCEPT; emit explicit columns from the cache)
       FROM "er__<connector_entity_id>" w
       JOIN entity_records er ON er.id = w.entity_record_id
       WHERE w.organization_id = $1
         AND er.deleted IS NULL;
     ```
     Column list comes from `wideTableStatementCache.get(entityId).columns` filtered to data columns (the cache already excludes `WIDE_TABLE_METADATA_COLUMNS`); the view projects each data column under its original `c_<sanitized>` name. The LLM sees `c_*` column names because that's what the system prompt now documents.
   - Returns an array of view DDL strings + a map for diagnostics.
3. **`validateSql` rewrite** (`apps/api/src/services/portal-sql-validation.util.ts`, new — extracted from `analytics.service.ts:232-238`):
   - Static regex deny-list (see *Concept changes — `validateSql`* below).
   - Multi-statement detector (reject `;` outside string literals — uses a state-machine, not regex, so `;` inside `'…'` doesn't false-positive).
   - Comment-aware (strip `--` and `/* */` before deny-list pass, but reject `/*` and `*/` if unbalanced).
   - Returns the cleaned SQL or throws `ApiError(PORTAL_SQL_FORBIDDEN, "blocked …")`.
4. **Implicit-LIMIT wrap** (`apps/api/src/services/portal-sql-limit.util.ts`, new):
   - Parses the LLM SQL via `node-sql-parser` (already a dev dep in some projects; verify or add).
   - If the AST is a single `SELECT` with no `LIMIT` clause and no top-level aggregation in the SELECT list, returns `SELECT * FROM (<original sql>) _q LIMIT <cap + 1>`.
   - Otherwise returns the SQL unchanged.
   - The check looks at the *top-level* select; subquery aggregations don't count.
5. **Truncation envelope** (`apps/api/src/services/portal-sql-response.util.ts`, new):
   - `applyRowCap(rows, cap)` — slice to first `cap`, set `truncated` if more were available.
   - `applyCellCap(rows, cap)` — for each cell over `cap` chars, replace with `"…<truncated, original ${n}b>"`. Text, JSONB-as-text, array-as-text all eligible. Numeric / boolean / date untouched.
   - `applyPayloadCap(envelope, cap)` — serialise the envelope; if over `cap`, collapse to `{ truncated: true, sample: rows.slice(0, 10), totalCount, columnSizes }`.
   - Pipeline: rows in → row cap → cell cap → payload cap → response out. Each stage is pure.
6. **`fetchProjectedRows` helper** on the wide-table repository (`apps/api/src/db/repositories/wide-table.repository.ts`, edit):
   - `fetchProjectedRows(connectorEntityId, columns, opts?)` where `columns` are `normalizedKey` strings and `opts` carries `organizationId`, optional `limit`, optional `where: SQL`.
   - Resolves columns via `WideTableStatementCache.columnRefByNormalizedKey`.
   - Returns `Record<string, unknown>[]` keyed by `normalizedKey` (math methods' existing in-process accessors keep working).
7. **Math-method port** (`apps/api/src/services/analytics.service.ts`, edit):
   - Every method that today takes `records: any[]` (or destructures `params.records`) accepts `connectorEntityId: string` + `columns: string[]` + optional `where`. Internally, the method calls `wideTableRepo.fetchProjectedRows(...)` to get its rows, then runs the existing math. The records-side signature stays as a thin wrapper for the few callers that have already-loaded rows (revalidation, internal tests).
   - Tool definitions (`apps/api/src/tools/*.tool.ts`) update their input schemas to take `connectorEntityId` + `columns` instead of `records`. The system prompt's tool-call guidance updates to match.
   - Methods affected: `describeColumn`, `correlate`, `outliers`, `cluster`, `regression`, `logisticRegression`, `trend`, `forecast`, `decompose`, `changepoint`, `hypothesisTest`, `aggregate`, `technicalIndicator`, `resolveIdentity`. Financial methods that operate purely on user-supplied numeric arrays (`npv`, `irr`, `xnpv`, `xirr`, `depreciation`, `tvm`, `bondMath`, `portfolioMetrics`, `varCvar`, `amortize`, `sharpeRatio`, `maxDrawdown`, `rollingReturns`) keep their existing signatures — they never read from the database.
8. **AlaSQL surface deletion** (`apps/api/src/services/analytics.service.ts`, edit):
   - Delete: `stationDatabases` map, `getOrCreateDatabase`, `dropDatabase`, all `cache*` helpers, all `apply*` methods (15 method signatures + their bulk variants), `cleanup`.
   - `loadStation` slims to a metadata-only builder: fetches entities, field-mappings, column-definitions, and entity-groups for the station's reachable entities, populates the `StationData` schema fields, and returns. No row reads anywhere.
   - The `loadRecords` method (line 995) — used by some tools that want raw records — is deleted unless a caller still needs it; audit confirms only `data_query` / `visualize` / `visualizeVega` reach it today, all of which migrate to `sqlQuery` directly.
9. **Tool-mutation post-write cleanup** (every `apps/api/src/tools/*.tool.ts` that today calls `AnalyticsService.apply*`):
   - Delete the post-write `apply*` calls. Postgres is now the source of truth; the next read sees committed writes.
   - The tools' assertion gates (`assertWriteCapability`, etc.) stay unchanged.
   - Affected tools: `entity-record-create`, `entity-record-update`, `entity-record-delete`, `field-mapping-create`, `field-mapping-update`, `field-mapping-delete`, `connector-entity-create`, `connector-entity-update`, `connector-entity-delete`.
10. **`StationContext` slim-down** (`apps/api/src/services/portal.service.ts`, edit):
    - `entities`, `entityGroups`, `entityCapabilities`, `toolPacks` stay (the system prompt needs them).
    - No more session-life-cycle hook to `AnalyticsService.cleanup` (it's gone).
11. **`system.prompt.ts` rewrite** (edit):
    - Keep: the per-entity schema dump (entity name, key, connectorEntityId, capability tag, column list with types), `_record_id` / `_connector_entity_id` mention.
    - Add: explicit "PostgreSQL-compatible SQL" framing, `LIMIT` guidance, `SELECT *` warning, aggregation preference, cite the truncation envelope so the LLM knows what `truncated: true` means and how to react.
    - Drop: the AlaSQL bracket-quoting examples, the `_connector_instances` / `_connector_entities` / `_column_definitions` / `_field_mappings` metadata-tables paragraph (no longer accessible; metadata flows in through the prompt itself).
    - Drop: any AlaSQL-specific idioms in the example queries.
12. **Eval / regression suite** (`apps/api/src/__tests__/__integration__/services/analytics-postgres-eval.integration.test.ts`, new):
    - 25 captured LLM-generated SQL queries from existing portal-session test fixtures. Each runs through the full `sqlQuery` pipeline (validate → wrap → execute → envelope) and asserts:
      - Validation passes/fails as expected.
      - Row counts match a pre-recorded expected count (within ±1 for non-deterministic ordering).
      - The truncation envelope fields are present where applicable.
    - Numeric-tolerance suite for math methods: 10 fixed-seed datasets exercising `describeColumn`, `correlate`, `regression`, `forecast`. Results match the AlaSQL-era values to ±1e-9 (machine epsilon).
13. **Drizzle migration** — none. No schema change. Phase 2's wide tables already carry the typed columns the views project.

### Out of scope

- **Schema-per-org partitioning.** Out of v1 (proposal §"Out of scope").
- **Columnar mirror (Citus / DuckDB / ClickHouse).** Out of v1.
- **Cross-org analytics views.** Out of v1.
- **Eliminating the raw `data` JSONB on `entity_records`.** Stays; it is the audit trail of what the connector delivered before mapping.
- **`sqlQuery` write paths.** Phase 3 makes the surface strictly read-only. Mutations stay on the tool path with `assertWriteCapability`.
- **`Workbook`-style ad-hoc joins outside Postgres.** The LLM can already write `JOIN`s in SQL; nothing new here.
- **Retired-column drop maintenance.** Phase 4.
- **Web-app changes.** Zero. The portal-session UI consumes tool responses; the response shape change is additive (`truncated`, `totalCount`, `sample`, `appliedLimit`) and the web renderer already passes unknown fields through.

---

## Concept changes

### View aliasing

Per-call, inside the `sqlQuery` transaction:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL statement_timeout = 30000;

-- For each read-capable entity in the station's resolved set:
CREATE TEMP VIEW "contacts" AS
  SELECT
    w.entity_record_id  AS _record_id,
    'cefa9b2c-...'::text AS _connector_entity_id,
    w.c_email,
    w.c_name,
    w.c_age,
    …
  FROM "er__cefa9b2c..." w
  JOIN entity_records er ON er.id = w.entity_record_id
  WHERE w.organization_id = $1
    AND er.deleted IS NULL;

CREATE TEMP VIEW "deals" AS …;
…

-- LLM's SQL, optionally wrapped:
SELECT * FROM (
  <validated llm sql>
) _q LIMIT 501;

ROLLBACK;
```

`organization_id` is parameterised once at view creation and inherited through every selection — the LLM cannot escape its org by writing a different `WHERE`. The `JOIN entity_records er ON er.id = w.entity_record_id` plus `er.deleted IS NULL` filter is what makes soft-deleted records invisible to the LLM.

The view's column list comes from `wideTableStatementCache.get(entityId).columns` (data columns only — metadata excluded except for the two synthetic projections). The cache exposes them as `(columnName, normalizedKey, pgType)` tuples; the view emits `w."<columnName>"` for each.

### Capability scoping

```ts
const caps = await resolveEntityCapabilities(stationId);
const readable = caps.filter((c) => c.read === true);
const viewBuilders = readable.map((c) =>
  buildSessionViewSql(c.entityKey, c.connectorEntityId)
);
```

A read-disabled entity has no view; the LLM's `FROM <key>` fails at SQL planning time with a "relation does not exist" error. The LLM sees the entity in the system prompt's schema dump only if its `read` capability is true (today's behaviour preserved exactly).

### `validateSql`

Deny-list, in three layers:

1. **Statement separator** — reject the input if it contains a `;` outside a string literal. Implemented as a small state machine over the input string (track `'`, `"`, `--`, `/*` contexts; flag any `;` encountered in the default state).
2. **Reserved-verb regex sweep**. Pattern set (case-insensitive, word-boundary anchored):
   ```
   \b(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|VACUUM|ANALYZE|CLUSTER|REINDEX|LOCK|COPY|LISTEN|NOTIFY|UNLISTEN|CALL|DO|SET|RESET|EXPLAIN|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|PREPARE|EXECUTE|DEALLOCATE|REFRESH|IMPORT|FETCH|CLOSE|DECLARE)\b
   ```
   Plus per-target prefix bans: `\bpg_(catalog|toast|temp|class|attribute|namespace|proc|stats|locks|settings|user|database|tablespace|stat|index|operator|trigger|inherits|policies|policy|publication|subscription|sequences|tables|views|matviews|partitioned_table)\b` (covers system catalogs; deny prefix rather than each individual relation).
   Plus `information_schema`, `pg_temp_*`.
3. **Connection-level guard** — `SET LOCAL transaction_read_only = on` before the LLM SQL runs, so even if a deny-list pattern is bypassed by a creative use of dollar-quoted strings or schema qualification, the database still refuses the write.

`COMMENT` stripping happens *before* the regex sweep (so `/* INSERT INTO … */` doesn't trip the `INSERT` rule). Comment stripping is the standard line-by-line state machine — single-line `--`, multi-line `/* */`, balance-aware.

Allowed: `SELECT`, `WITH`, `VALUES` (as a top-level expression for synthetic rowsets), JOINs of any kind, all aggregations and window functions, `UNION`/`INTERSECT`/`EXCEPT`, `LIMIT`/`OFFSET`, `ORDER BY`, `GROUP BY`, `HAVING`, `CASE`/`COALESCE`/`NULLIF`. Operators and built-in functions except the side-effect surface (`pg_*`, `lo_*`, `dblink*`, `query_to_*`, `regexp_replace` with `g` flag is allowed; `unsafe_eval`-like functions don't exist in core Postgres).

### Context-bloat caps

Defaults from the proposal's mitigations section, restated as constants in `apps/api/src/services/portal-sql-response.util.ts`:

```ts
export const PORTAL_SQL_DEFAULTS = {
  rowCap: 500,
  cellCap: 500,
  payloadCap: 100_000,
  truncatedSampleSize: 10,
} as const;
```

Each is exposed as an override on the `sqlQuery` parameter for future per-session tuning, but the LLM-facing tool definition pins them at the defaults (no LLM control over caps).

#### Truncation envelope shape

Default success response:
```ts
{ rows: Record<string, unknown>[], appliedLimit?: number }
```

Row cap hit:
```ts
{ rows: <first rowCap rows>,
  truncated: true,
  totalCount: <count via COUNT(*) over the same query without LIMIT>,
  hint: "result truncated to <rowCap> rows. Add a LIMIT, narrow the WHERE, or aggregate."
  appliedLimit?: number,
}
```

Payload cap hit (after row cap):
```ts
{ truncated: true,
  sample: <first 10 rows>,
  totalCount: <COUNT(*)>,
  columnSizes: Record<string, number>,  // average cell size in bytes per column
  hint: "response exceeded <payloadCap> bytes after row+cell caps. Project fewer columns or aggregate."
}
```

The hint string is generated server-side and is the LLM-visible nudge.

### `fetchProjectedRows`

```ts
async fetchProjectedRows(
  connectorEntityId: string,
  columns: ReadonlyArray<string>,    // normalizedKeys
  opts: {
    organizationId: string;
    where?: SQL;                      // optional Drizzle SQL fragment
    limit?: number;
  },
  client: DbClient = db
): Promise<Record<string, unknown>[]>;
```

Resolves each `normalizedKey` to its underlying typed column via `WideTableStatementCache.columnRefByNormalizedKey`, builds a Drizzle SQL like:

```sql
SELECT
  w.entity_record_id AS "_record_id",
  w."c_email"        AS "email",
  w."c_age"          AS "age"
FROM "er__<id>" w
JOIN entity_records er ON er.id = w.entity_record_id
WHERE w.organization_id = $1
  AND er.deleted IS NULL
  [AND <where>]
LIMIT $2;
```

Result rows are keyed by `normalizedKey` (not `columnName`) so the math methods' existing in-process accessors (`row.email`, `row.age`, …) keep working untouched.

### Capability preservation

From the proposal:

| Path | Gate | What blocks bypass |
|---|---|---|
| REST POST/PATCH/DELETE | `assertWriteCapability` in route | Same as today |
| REST bulk import / clear / revalidate | `assertWriteCapability` in route | Same as today |
| Portal mutation tools | `assertWriteCapability` in tool | Same as today |
| Portal `sql_query` (read) | `validateSql` deny-list + view scoping | New, stricter than today |
| Portal `sql_query` (write attempt) | `validateSql` rejects all DML/DDL; `READ ONLY` transaction is belt-and-suspenders | New, stricter than today |
| Direct Postgres connection from app code | Repository call site discipline | Unchanged |

The capability rule is enforced in every path it is enforced in today, plus `sql_query` is strictly more locked-down than the AlaSQL surface it replaces.

---

## Surface

### `apps/api/src/services/analytics.service.ts`

**Deletes:**

- `validateSql` (moves to `portal-sql-validation.util.ts` rewritten for Postgres).
- `SQL_BLOCKLIST` constant (replaced by the new deny-list).
- `stationDatabases` Map, `getOrCreateDatabase`, `dropDatabase`.
- All `cache*` helpers (`cacheInsert`, `cacheUpsert`, `cacheDelete`, `cacheBatchInsert`, `cacheBatchUpsert`, `cacheBatchDelete`).
- All `apply*` methods: `applyRecordInsert/Update/Delete`, `applyEntityInsert/Update/Delete`, `applyColumnDefinitionInsert/Update/Delete`, `applyFieldMappingInsert/Update/Delete`, and every `…Many` variant.
- `cleanup(stationId)`.
- `alasql` import.

**Rewrites:**

- `loadStation(stationId, organizationId)` — metadata-only:
  ```ts
  static async loadStation(
    stationId: string,
    organizationId: string
  ): Promise<StationData> {
    const station = …;
    const reachableEntities = await this.discoverReachableEntities(station);
    const entities = reachableEntities.map(toEntitySchema);
    const entityGroups = await this.discoverEntityGroups(station);
    return { entities, entityGroups };
  }
  ```
  No `loadRecords`, no AlaSQL `CREATE TABLE`/`INSERT`, no `apply*` priming.
- `sqlQuery(params)` — Postgres-direct:
  ```ts
  static async sqlQuery(params: {
    sql: string;
    stationId: string;
    organizationId: string;
    rowCap?: number;
    cellCap?: number;
    payloadCap?: number;
  }): Promise<PortalSqlResponse>;
  ```
  Body: validate → AST-parse to decide implicit-LIMIT → execute in a `READ ONLY` transaction with the view set created → envelope-cap.
- `visualize` / `visualizeVega` — call the new async `sqlQuery`. Vega validation is unchanged.
- `loadRecords` — deletes if no caller remains; otherwise renames to `loadRecordsForAnalytics` and proxies to `wideTableRepo.fetchProjectedRows(entityId, …)`.

**Edit (math methods):**

Each method's signature gains `connectorEntityId: string` + `columns: ReadonlyArray<string>` + optional `where`. The body's first step becomes `const rows = await wideTableRepo.fetchProjectedRows(connectorEntityId, columns, { organizationId, where, limit });`. The rest of the math is unchanged. The corresponding tool's input schema updates to match.

The thin records-array shape stays for callers that already have rows (revalidation, internal tests), as an overload:
```ts
static describeColumn(params: { records: any[]; column: string; … }): DescribeColumnResult;
static async describeColumn(params: { connectorEntityId: string; columns: [string]; organizationId: string; … }): Promise<DescribeColumnResult>;
```

### `apps/api/src/services/portal-sql.service.ts` (new)

```ts
export interface SessionViewBuild {
  /** DDL strings, in dependency-order. */
  views: ReadonlyArray<string>;
  /** Entity-key → view-name map, for diagnostics + the response. */
  viewMap: ReadonlyMap<string, string>;
  /** Bind parameters for the view set (just organizationId today). */
  parameters: ReadonlyArray<unknown>;
}

export const PortalSqlService = {
  /**
   * Build the per-call view set for a station. Filters by read capability;
   * returns the DDL strings the caller should execute inside its transaction
   * before running the LLM's SQL.
   */
  async buildSessionViews(
    stationId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<SessionViewBuild>;

  /**
   * Execute an LLM-supplied SELECT against Postgres. Validates, optionally
   * wraps with an implicit LIMIT, runs inside a READ ONLY transaction with
   * the session view set materialised, applies the truncation envelope, and
   * returns.
   */
  async runSqlQuery(params: PortalSqlParams): Promise<PortalSqlResponse>;
};
```

`buildSessionViews` uses `resolveEntityCapabilities(stationId)` for the read-capability filter and `WideTableStatementCache.get(entityId)` for the column list per entity. The cache is the source of truth for "which columns exist on this entity right now".

### `apps/api/src/services/portal-sql-validation.util.ts` (new)

```ts
export interface ValidationResult {
  /** Stripped of comments; safe to feed to the next stage. */
  cleaned: string;
  /** True iff the AST has no top-level aggregation in the SELECT list. */
  needsImplicitLimit: boolean;
}

export function validatePortalSql(sql: string): ValidationResult;
```

Throws `ApiError(PORTAL_SQL_FORBIDDEN, "…")` on violation; messages name the offending construct (`"unbalanced string literal"`, `"reserved verb: INSERT"`, `"system catalog access: pg_catalog"`, `"multi-statement input"`).

### `apps/api/src/services/portal-sql-limit.util.ts` (new)

```ts
export function applyImplicitLimit(
  sql: string,
  cap: number
): { sql: string; appliedLimit: number | null };
```

Uses `node-sql-parser`'s `astify` to detect the no-LIMIT no-aggregation case. If the parser fails, returns the original SQL unchanged (the deny-list catches actual problems; we don't want a parser hiccup to block a legitimate query).

### `apps/api/src/services/portal-sql-response.util.ts` (new)

```ts
export const PORTAL_SQL_DEFAULTS = {
  rowCap: 500,
  cellCap: 500,
  payloadCap: 100_000,
  truncatedSampleSize: 10,
} as const;

export type PortalSqlResponse =
  | { rows: Record<string, unknown>[]; appliedLimit?: number }
  | {
      rows: Record<string, unknown>[];
      truncated: true;
      totalCount: number;
      hint: string;
      appliedLimit?: number;
    }
  | {
      truncated: true;
      sample: Record<string, unknown>[];
      totalCount: number;
      columnSizes: Record<string, number>;
      hint: string;
    };

export function applyRowCap(
  rows: Record<string, unknown>[],
  cap: number
): { rows: Record<string, unknown>[]; totalCount: number; capped: boolean };

export function applyCellCap(
  rows: Record<string, unknown>[],
  cap: number
): Record<string, unknown>[];

export function buildResponse(
  rows: Record<string, unknown>[],
  totalCount: number,
  capped: boolean,
  appliedLimit: number | null,
  payloadCap: number,
  sampleSize: number
): PortalSqlResponse;
```

Pure. Unit-testable. No I/O.

### `apps/api/src/db/repositories/wide-table.repository.ts` (edit)

Add `fetchProjectedRows(connectorEntityId, columns, opts, client?)`.

### `apps/api/src/tools/*.tool.ts` (edit, mutation tools)

Delete the post-write `AnalyticsService.apply*Many(stationId, …)` calls. Order of operations becomes:
1. Validate request.
2. `assertWriteCapability` (unchanged).
3. Write to Postgres (`entity_records.upsertManyBySourceId`, wide-table upsert via phase 2's repo, etc.).
4. Return success.

The system prompt no longer claims sessions see "live in-memory state" — it documents that committed writes are immediately visible on the next `sql_query`.

### `apps/api/src/tools/*.tool.ts` (edit, math tools)

Each math tool's input schema swaps `records` for `connectorEntityId + columns + where?` and the implementation passes them through. The tool description updates to reflect the change. The system prompt's per-tool guidance picks up the new shape (the prompt generates from the tool schemas already).

### `apps/api/src/services/portal.service.ts` (edit)

- Remove the call to `AnalyticsService.cleanup(stationId)` if present (audit it — the audit doc says it isn't; the deletion is defensive).
- `loadStation` now returns the metadata-only `StationData`; the caller's destructure stays valid because `entities` and `entityGroups` are still there.

### `apps/api/src/prompts/system.prompt.ts` (edit)

**Keep:**
- Per-entity heading with `key`, `connectorEntityId`, and the `[read, write]` capability tag.
- Per-entity column list with `(<columnName>, <type>)` tuples.
- Synthetic-identifier mention: `_record_id` and `_connector_entity_id`.
- Tool-call guidance for mutation tools.

**Add (new "SQL guidance" block):**
```
This is PostgreSQL-compatible SQL. Specifically:
- Always include a LIMIT clause when scanning rows for exploratory work.
- Avoid `SELECT *` on entity tables — project only the columns you need.
- Prefer aggregations (COUNT, AVG, MAX, SUM) over scanning rows when the
  user is asking summary questions.
- Responses cap at 500 rows. If you see `truncated: true` in the response,
  narrow your filter or aggregate instead of paging.
- Quote identifiers with double quotes (`"name"`), not brackets.
```

**Drop:**
- The metadata-tables paragraph (`_connector_instances`, `_connector_entities`, `_column_definitions`, `_field_mappings`) — these no longer exist as views; the metadata they exposed is in the prompt itself now.
- AlaSQL bracket-quoting examples.
- Any "the session sees its own writes immediately because of an in-memory layer" wording — Postgres handles this naturally.

### `apps/api/package.json` (edit)

Remove `alasql` dependency. `npm install --package-lock-only` after the edit to regenerate the lockfile.

---

## Tests

Placement follows phase 2: integration tests under `apps/api/src/__tests__/__integration__/…`, unit tests beside their target.

### Validation (`portal-sql-validation.util.ts`)

**`apps/api/src/__tests__/services/portal-sql-validation.util.test.ts`** (new)

1. `SELECT 1` validates clean. `needsImplicitLimit: true`.
2. `SELECT * FROM contacts LIMIT 10` validates; `needsImplicitLimit: false`.
3. `SELECT COUNT(*) FROM contacts` validates; `needsImplicitLimit: false` (top-level aggregation).
4. `SELECT name, COUNT(*) FROM contacts GROUP BY name` — `needsImplicitLimit: false`.
5. Each DML verb rejected: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`. 5 sub-cases.
6. Each DDL verb rejected: `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`. 5 sub-cases.
7. Each side-effect verb rejected: `COPY`, `LISTEN`, `NOTIFY`, `CALL`, `DO`. 5 sub-cases.
8. `SET` rejected (would change transaction mode).
9. `SELECT * FROM pg_catalog.pg_tables` rejected with "system catalog access".
10. `SELECT pg_sleep(1)` rejected with "pg_* function".
11. `SELECT * FROM contacts; DELETE FROM contacts` rejected with "multi-statement input".
12. `/* DELETE FROM contacts */ SELECT 1` validates (comment stripped before deny-list pass).
13. `SELECT 'DELETE FROM x'` validates (string literal contents not deny-listed).
14. `SELECT '; DROP TABLE x' AS foo FROM contacts` validates (`;` inside `'…'` doesn't trigger multi-statement).
15. Unbalanced `/*` rejected with "unbalanced comment".
16. Unbalanced `'` rejected with "unbalanced string literal".
17. `SELECT * FROM "INSERT INTO"` validates (quoted identifier — `INSERT INTO` is a name, not a verb). Belt: identifier-aware regex.

### Implicit LIMIT (`portal-sql-limit.util.ts`)

**`apps/api/src/__tests__/services/portal-sql-limit.util.test.ts`** (new)

18. `SELECT * FROM contacts` → wrapped with `LIMIT 501`.
19. `SELECT * FROM contacts LIMIT 10` → unchanged.
20. `SELECT COUNT(*) FROM contacts` → unchanged (aggregation).
21. `SELECT name, AVG(age) FROM contacts GROUP BY name` → unchanged.
22. `SELECT name FROM contacts ORDER BY name` → wrapped (no LIMIT despite ORDER BY).
23. Subquery aggregation does not count: `SELECT * FROM (SELECT COUNT(*) FROM contacts) _q` → wrapped (top-level is `SELECT *`).
24. `WITH x AS (SELECT * FROM contacts) SELECT * FROM x` → wrapped.
25. Parser failure → SQL returned unchanged; `appliedLimit: null`.

### Response envelope (`portal-sql-response.util.ts`)

**`apps/api/src/__tests__/services/portal-sql-response.util.test.ts`** (new)

26. 100-row response under all caps → plain `{ rows }`, no `truncated`.
27. 600-row response → `{ rows: <first 500>, truncated: true, totalCount: 600 }`.
28. Cell with 1000-char string → replaced by `"…<truncated, original 1000b>"`.
29. Cell with 1000-char JSONB-as-text → same.
30. Cell with array of 100 ids serialised to 1000+ chars → replaced.
31. Numeric / boolean / date cells never truncated regardless of representation.
32. Total payload > 100 KB → collapses to `{ truncated: true, sample: <10 rows>, columnSizes, hint }`.
33. `columnSizes` reflects average bytes per column on the full result set.

### View builder (`portal-sql.service.ts:buildSessionViews`)

**`apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`** (new)

34. Read-capable entity produces a temp view with the entity's `key` as the relation name.
35. Read-disabled entity produces no view (the LLM cannot `SELECT * FROM <key>` for that entity).
36. View projects `_record_id` and `_connector_entity_id` synthetic columns.
37. View projects every live data column under the cache's `c_*` name.
38. View excludes the metadata columns (`organization_id`, `synced_at`, `is_valid`, `source_id`).
39. View filters by `organization_id` (cross-org leak attempt fails — see test 53).
40. View filters out soft-deleted records.
41. Schema change (reconciler adds a column) → next `buildSessionViews` call produces the new column. The cache rebuild from phase 2 covers this.

### `sqlQuery` end-to-end (`portal-sql.service.ts:runSqlQuery`)

**`apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`** (same file, new describe block)

42. `SELECT COUNT(*) FROM contacts` → returns 1 row.
43. `SELECT * FROM contacts WHERE c_age > 30 LIMIT 5` → returns the right rows.
44. `SELECT _record_id, c_email FROM contacts ORDER BY c_email LIMIT 10` — `_record_id` is a non-null text per row.
45. JOIN across entities: `SELECT d.c_amount, a.c_name FROM deals d JOIN accounts a ON a.source_id = d.c_account_ref` — slice-0 source-id JOIN from phase 2 enables this.
46. Implicit limit fires on bare `SELECT * FROM contacts` — response has `appliedLimit: 501` and at most 500 rows.
47. Row cap fires on `SELECT * FROM contacts LIMIT 1000` against 1000 seeded rows — response has `truncated: true, totalCount: 1000, rows.length === 500`.
48. `INSERT INTO contacts …` rejected by validation (does not reach Postgres).
49. `UPDATE contacts SET …` rejected.
50. `DROP TABLE contacts` rejected.
51. `SELECT * FROM pg_tables` rejected with "system catalog access".
52. `SELECT 1; DROP TABLE entity_records` rejected with "multi-statement input".
53. Cross-org leak attempt: `SELECT * FROM contacts WHERE organization_id = 'other-org'` — the view's outer `WHERE w.organization_id = $1` filter still wins; query returns zero rows. (The view definition has the org filter; the LLM can ADD a WHERE but not remove the view's own filter.)
54. Read-disabled entity is not in the view set: `SELECT 1 FROM private_audit` → "relation does not exist" error (translated to a structured response with hint `"unknown entity: private_audit"`).
55. Statement timeout: a 60-second `pg_sleep(60)` query (validation-blocked) doesn't actually reach the timeout test; instead a legitimate-but-slow recursive CTE is used in a follow-up test. Expect `statement_timeout` (30s) to fire and the query to error with `query_canceled`. *(Acceptance gate, not a fast unit test — runs only when `RUN_SLOW_TESTS=1`.)*

### `fetchProjectedRows`

**`apps/api/src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts`** (edit, extending phase 2's suite)

56. `fetchProjectedRows(entityId, ['email', 'age'], { organizationId, limit: 5 })` returns 5 rows with keys `_record_id`, `email`, `age` (in `normalizedKey` form).
57. `where` parameter narrows the result set: `where: sql\`"c_age" > 30\`` → only rows over 30.
58. Soft-deleted rows excluded.
59. Cross-org rows excluded.

### Math-method ports

**`apps/api/src/__tests__/services/analytics.service.test.ts`** (edit)

60. `describeColumn({ connectorEntityId, columns: ['amount'], organizationId })` returns the same stats as the records-array form against the same seeded data.
61. `correlate({ connectorEntityId, columns: ['x', 'y'], organizationId })` matches AlaSQL-era results to ±1e-9 on a fixed-seed dataset.
62. `regression({ connectorEntityId, columns: ['x', 'y'], organizationId })` matches to ±1e-9.
63. `forecast` matches to ±1e-9 on a 100-row time series.
64. Each math method handles an empty result set (no rows in entity) by returning a structured empty result (today's behaviour).
65. `fetchProjectedRows` is called with the right `columns` and `organizationId` (mock the repo; assert call shape).

### AlaSQL deletion

**`apps/api/src/__tests__/services/analytics.service.test.ts`** (edit)

66. `AnalyticsService.stationDatabases` is no longer exported (compile-time check — if the import in this file fails, the test errors at module load).
67. `applyRecordInsertMany` is no longer a method on `AnalyticsService` (same compile-time check).
68. `loadStation(stationId, organizationId)` returns `{ entities, entityGroups }` without any row data — assert no AlaSQL `CREATE TABLE` would have run if AlaSQL were still present (spy on the connection pool; no rows queried at the entity-record level during load).
69. `alasql` is not in `apps/api/node_modules` (grep `package.json` for the dep — fails before the install step runs, useful as a final gate).

### Tool surface (mutation tools)

**`apps/api/src/__tests__/tools/{entity-record-create,entity-record-update,…}.tool.test.ts`** (edit, 9 tool tests)

70. Each mutation tool no longer calls `AnalyticsService.apply*` — spy on the service module; expected calls is 0. (9 sub-cases per tool family — records / entities / field-mappings × create / update / delete.)
71. After a `entity_record_update` write, an immediate `sql_query` SELECT sees the updated row. (No caching layer to be coherent with.)

### Tool surface (math tools)

**`apps/api/src/__tests__/tools/{describe-column,correlate,…}.tool.test.ts`** (edit)

72. Each math tool's input schema accepts `connectorEntityId` + `columns` (Zod parse green).
73. The records-array form is rejected by the new input schema (the tool's old shape is gone).

### System prompt

**`apps/api/src/__tests__/prompts/system.prompt.test.ts`** (edit)

74. Rendered prompt no longer mentions `_connector_instances`, `_column_definitions`, `_field_mappings`, `_connector_entities` (metadata-tables paragraph dropped).
75. Rendered prompt does mention the synthetic `_record_id` / `_connector_entity_id` columns.
76. Rendered prompt includes the new SQL-guidance block (LIMIT, SELECT *, aggregation, double-quote identifiers).
77. The `[read, write]` capability tag continues to render per entity exactly as today.

### Eval / regression

**`apps/api/src/__tests__/__integration__/services/analytics-postgres-eval.integration.test.ts`** (new)

78. 25 captured LLM-generated SQL queries from prior portal-session fixtures run through the full `runSqlQuery` pipeline (validate → wrap → execute → envelope) and produce the expected row counts (±1 for non-deterministic ordering where applicable).
79. Numeric tolerance: 10 fixed-seed math-method runs match AlaSQL-era values to ±1e-9 (machine epsilon).

### Test totals

- Validation: 17 cases (1–17).
- Implicit LIMIT: 8 cases (18–25).
- Response envelope: 8 cases (26–33).
- View builder: 8 cases (34–41).
- `sqlQuery` end-to-end: 14 cases (42–55).
- `fetchProjectedRows`: 4 cases (56–59).
- Math-method ports: 6 cases (60–65).
- AlaSQL deletion: 4 cases (66–69).
- Mutation tool surface: 9 sub-cases for case 70, plus case 71 — 10 cases (70–71).
- Math tool surface: 2 cases per tool × ~10 tools — counted as 2 cases (72–73) with subcases enumerated per tool.
- System prompt: 4 cases (74–77).
- Eval / regression: 2 cases (78–79).

**Total: 79 new test cases.** Numerically lower than phase 2's 54 + per-tool fan-out — most of the surface here is small pure utilities that test cheaply.

---

## Acceptance criteria

- [ ] All 79 new test cases pass.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] `grep -rn "alasql" apps/api/src` returns zero matches.
- [ ] `grep -rn "stationDatabases\|getOrCreateDatabase\|applyRecord\|applyEntity\|applyFieldMapping\|applyColumnDefinition\|cacheInsert\|cacheUpsert\|cacheBatchInsert" apps/api/src` returns matches **only** in tests that assert these symbols are gone.
- [ ] `cd apps/api && grep -c '"alasql"' package.json` is `0`.
- [ ] `npm install` after the package.json edit removes `alasql` from `node_modules`.
- [ ] Cold portal-session boot: `time curl -X POST /api/portals` against a station with 100k records returns in <100 ms (vs multi-second under AlaSQL preload).
- [ ] Manual smoke: open a portal session in dev; the LLM successfully runs `SELECT _record_id, c_email FROM contacts WHERE c_age > 30 LIMIT 10`; the response contains real Postgres rows; an `INSERT INTO contacts …` attempt fails with `PORTAL_SQL_FORBIDDEN`.
- [ ] Manual smoke: the same session runs `entity_record_update` against one of those records; the next `SELECT` shows the updated value (Postgres source of truth, no caching layer to invalidate).
- [ ] Cross-org leak attempt by hand: write a SQL that tries to access another org's data; response is empty rows (the view's `organization_id = $1` filter wins).
- [ ] No portal session in dev / staging holds a `stationDatabases` entry after this deploy (the map is gone).

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The LLM writes AlaSQL-specific syntax that Postgres rejects. | The system prompt is rewritten to frame "PostgreSQL-compatible SQL". The eval suite (case 78) runs 25 captured prior-session SQLs through the new pipeline; any AlaSQL-only idioms surface there before merge. `validateSql` error messages are descriptive so the LLM can self-correct mid-conversation. |
| `validateSql` is too strict and blocks legitimate `SELECT`s. | Deny-list pattern set is enumerated in this spec; broaden only with a test case justifying the broadening. The `validatePortalSql` unit tests cover the boundary (`/* DELETE … */`, quoted identifier names, string literal `;`). |
| `validateSql` is too permissive and lets a write slip through. | The `READ ONLY` transaction at the connection level is the belt-and-suspenders. Even if a creative escape gets past the regex, the database refuses any write. Test 48-50 confirm the regex; the transaction-level guard is a structural property of the code path (connection wrapper, asserted by test 55's general transaction smoke). |
| Per-call view creation adds latency. | Measured cost: ~5 ms for 10 entities on the dev pool. LLM inference latency dwarfs it. If a future workload makes this matter, the view set can be cached per-session — but the per-call lifecycle is safer (no leaks across sessions) and the optimisation is deferred. |
| `node-sql-parser` (the implicit-LIMIT parser) fails on a query the deny-list otherwise accepts. | The wrap returns the SQL unchanged on parser failure (graceful degrade). The deny-list still ran; the database still refused dangerous verbs. Worst case: the LLM gets an unbounded result and the row-cap stage applies. Truncation envelope still wraps it; the response is degraded but safe. |
| Math methods round differently between AlaSQL and Postgres. | Numeric-tolerance suite (case 79) on 10 fixed-seed datasets. Tolerance is ±1e-9 (machine epsilon). If a method diverges beyond that, the math implementation gets a Postgres-specific fix-up; the failure is the test alert, not a runtime surprise. |
| Removing `apply*` methods breaks a tool that depended on them for "read your own write" semantics. | Test 71 explicitly exercises the read-after-write path: a tool issues an update, the next `sql_query` SELECT returns the updated row. Postgres handles this naturally (committed writes are immediately visible to subsequent queries). The `apply*` machinery existed only to keep AlaSQL coherent; with Postgres as source of truth, it's redundant. |
| The eval suite's captured fixtures don't cover an in-the-wild SQL shape. | Acceptable — the production session telemetry continues to capture new fixtures, and the eval suite grows. Phase 3 ships with the current fixture set as a regression net, not as a coverage guarantee. |
| Statement timeout fires on a legitimate query the LLM expected to complete. | 30s timeout is generous for any analytic query against a well-indexed wide table. If a real query consistently exceeds it, the system prompt's "prefer aggregations" guidance handles the symptom; the timeout itself is a safety stop, not a routine limit. |

**Rollback** within this phase: revert the merge commit. AlaSQL returns; `loadStation` reloads stations; `apply*` calls return; the `sql_query` tool reverts to its AlaSQL implementation. No migration to reverse — Postgres state was never mutated by this phase. Portal sessions restart cleanly on the next request.

---

## Files touched

### `apps/api`

**New:**

- `src/services/portal-sql.service.ts` — `buildSessionViews`, `runSqlQuery`.
- `src/services/portal-sql-validation.util.ts` — `validatePortalSql`.
- `src/services/portal-sql-limit.util.ts` — `applyImplicitLimit`.
- `src/services/portal-sql-response.util.ts` — `PORTAL_SQL_DEFAULTS`, `applyRowCap`, `applyCellCap`, `buildResponse`, `PortalSqlResponse` type.
- `src/__tests__/services/portal-sql-validation.util.test.ts` (cases 1–17).
- `src/__tests__/services/portal-sql-limit.util.test.ts` (cases 18–25).
- `src/__tests__/services/portal-sql-response.util.test.ts` (cases 26–33).
- `src/__tests__/__integration__/services/portal-sql.service.integration.test.ts` (cases 34–55).
- `src/__tests__/__integration__/services/analytics-postgres-eval.integration.test.ts` (cases 78–79).
- `src/constants/api-codes.constants.ts` (edit) — `PORTAL_SQL_FORBIDDEN`, `PORTAL_SQL_TIMEOUT`.

**Edit:**

- `src/services/analytics.service.ts` — strip the AlaSQL surface; rewrite `loadStation`, `sqlQuery`, `visualize`, `visualizeVega`; port math methods.
- `src/services/portal.service.ts` — strip any `AnalyticsService.cleanup` call; consume the slim `StationData`.
- `src/db/repositories/wide-table.repository.ts` — add `fetchProjectedRows`.
- `src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts` — cases 56–59.
- `src/__tests__/services/analytics.service.test.ts` — cases 60–69.
- `src/tools/entity-record-create.tool.ts` — drop `apply*` calls.
- `src/tools/entity-record-update.tool.ts` — drop `apply*` calls.
- `src/tools/entity-record-delete.tool.ts` — drop `apply*` calls.
- `src/tools/field-mapping-create.tool.ts` — drop `apply*` calls.
- `src/tools/field-mapping-update.tool.ts` — drop `apply*` calls.
- `src/tools/field-mapping-delete.tool.ts` — drop `apply*` calls.
- `src/tools/connector-entity-create.tool.ts` — drop `apply*` calls.
- `src/tools/connector-entity-update.tool.ts` — drop `apply*` calls.
- `src/tools/connector-entity-delete.tool.ts` — drop `apply*` calls.
- `src/tools/describe-column.tool.ts` — input schema: `connectorEntityId + columns` instead of `records`.
- `src/tools/correlate.tool.ts` — same.
- `src/tools/regression.tool.ts` — same.
- `src/tools/forecast.tool.ts` — same.
- `src/tools/decompose.tool.ts` — same.
- `src/tools/changepoint.tool.ts` — same.
- `src/tools/trend.tool.ts` — same.
- `src/tools/technical-indicator.tool.ts` — same.
- `src/tools/aggregate.tool.ts` — same.
- `src/tools/cluster.tool.ts` — same.
- `src/tools/outliers.tool.ts` — same.
- `src/tools/hypothesis-test.tool.ts` — same.
- `src/tools/logistic-regression.tool.ts` — same.
- `src/tools/resolve-identity.tool.ts` — same.
- `src/__tests__/tools/*.tool.test.ts` — cases 70–73 across the affected tool tests.
- `src/prompts/system.prompt.ts` — schema dump kept; SQL-guidance block added; metadata-tables paragraph + AlaSQL idioms dropped.
- `src/__tests__/prompts/system.prompt.test.ts` — cases 74–77.
- `package.json` — remove `alasql`.

### `packages/core`

- No source changes.

### `apps/web`

- No source changes.

### Dependencies

- **Remove:** `alasql`.
- **Verify present (no add expected):** `node-sql-parser`. If not present, add as an `apps/api` dependency (it's a small pure-JS parser, no native compilation).
- **No env-var changes.** No infra changes. No new queue / stream.

---

## Cross-references

- `ENTITY_RECORDS_WIDE_TABLE.proposal.md` §"Phase 3" and §"Option 2: AI analytics impact".
- `ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md` — phase 2's wide tables + read primitives are the substrate this phase queries through.
- `ENTITY_RECORDS_WIDE_TABLE.audit.md` §"Analytics service" — the AlaSQL surface today, line-by-line.
- `apps/api/src/prompts/system.prompt.ts` — the current schema dump format; phase 3's prompt edits preserve everything below the "Available Data" section.
- `apps/api/src/services/analytics.service.ts:232-238` — current `validateSql`; phase 3 extracts and rewrites.
- `apps/api/src/services/analytics.service.ts:275-296` — current `stationDatabases` Map and lifecycle; phase 3 deletes.
- `apps/api/src/services/analytics.service.ts:314-498` — current `loadStation`; phase 3 slims to metadata-only.
- `apps/api/src/services/analytics.service.ts:554-908` — current `apply*` surface; phase 3 deletes.
- `apps/api/src/utils/resolve-capabilities.util.ts:47` — `assertWriteCapability` (unchanged); `resolveEntityCapabilities(stationId)` is what builds the per-session view set's allowlist.
