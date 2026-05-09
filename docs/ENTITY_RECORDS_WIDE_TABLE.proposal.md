# Entity Records — Wide-Table Storage Proposal

This proposal locks in the architecture for moving entity-record analyzable
data out of `entity_records.normalized_data` (JSONB) into per-connector-
entity wide tables, and breaks the work into independently-shippable phases.
Subsequent `*.spec.md` and `*.plan.md` docs will detail each phase.

Background and rationale: see `ENTITY_RECORDS_WIDE_TABLE.audit.md` —
the audit covers the current state, the wide-table schema, the
reconciler design, and the per-route impact analysis. This proposal
focuses on **decisions, sequencing, and the Option-2 question for
the AI analytics path**.

## Decisions locked in

1. **Storage shape** — one wide Postgres table per `connector_entity`
   (`er__<connector_entity_id>`) with real, typed columns generated
   from `field_mappings` + `column_definitions`. `entity_records`
   keeps the transaction object only; `normalized_data` JSONB is
   removed.
2. **Reconciler** — a single service owns all DDL on the wide tables,
   driven by `field_mappings` as source of truth. Triggered on
   connector-entity create, field-mapping change, and app-boot drift
   check. Adds are metadata-only `ALTER TABLE`; removes and type
   changes are staged.
3. **Migration is a clean cut.** No production data exists today
   (project state, see memory `project_no_production_data_yet.md`).
   One PR, one deploy, destructive: drop the JSONB column, truncate,
   re-sync.
4. **API contract is invariant.** `EntityRecord.normalizedData`
   stays a `Record<string, unknown>` per
   `packages/core/src/models/entity-record.model.ts:23`. The wide-
   table response is rehydrated into the same JSONB-shaped object the
   UI already consumes. **Zero web-app changes are required for parity.**
5. **`data_query` tool: Option 2** — `sql_query` runs against
   Postgres directly. AlaSQL and the in-memory station load are
   removed entirely. Detailed below.
6. **Connector capability flags stay enforced exactly as today.**
   Capability gates (`assertWriteCapability`, `resolveEntityCapabilities`,
   the `[read, write]` flags rendered in the system prompt) are
   metadata-only operations against `connector_instances`,
   `connector_definitions`, and `connector_entities` — none of which
   change. The wide-table cutover preserves this surface verbatim;
   see *Capability preservation* below.
7. **Out of scope for v1** — schema-per-org partitioning, columnar
   mirror (Citus / DuckDB / ClickHouse), cross-org analytics views,
   eliminating the raw `data` JSONB.

## Phase breakdown

**Revision (2026-05-09): old Phase 2 + Phase 3 are merged into a single
phase 2.** Dropping `normalized_data` forces every JSONB read site to
change anyway, and a transitional rehydrator shim would just be code to
delete in the next phase. New numbering: Phase 1 (reconciler
foundation) → Phase 2 (storage cutover + REST read path rewrite) →
Phase 3 (LLM tool path / Postgres-direct, formerly Phase 4) → Phase 4
(steady-state polish, formerly Phase 5).

The original five-phase breakdown is preserved below for reference; the
phase docs in `ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md` and
`.plan.md` describe the merged Phase 2 in detail.

Phases 1 → 2 are sequential. Phase 3 (LLM tool path) is independent of
Phase 2 in spirit, but in practice will land after Phase 2 because the
read primitives Phase 3 needs are built in Phase 2. Phase 4 is
steady-state polish.

### Phase 1 — Reconciler foundation

Build the reconciler service with no production behaviour change.
Wide tables exist for live entities but are not yet read from or
written to by any feature path.

- New `wide_table_columns` metadata table (records column → field-
  mapping linkage, retired-at timestamps).
- `WideTableReconcilerService` — diff `field_mappings` against
  `information_schema.columns`; apply adds (metadata-only `ALTER
  TABLE ADD COLUMN`); stage removes; stage type changes.
- `WideTableStatementCache` — per-entity prepared INSERT/UPDATE/SELECT
  templates, invalidated on schema change.
- `WideTableRepository` — generic typed access to any `er__<id>`
  table.
- Reconciler triggers wired to: connector-entity create, field-mapping
  insert/update/soft-delete, app boot.
- Per-entity advisory lock that sync writes will hold (Phase 2) so
  reconciler DDL serializes cleanly with future writes.
- Tests: unit tests against an isolated entity; integration tests
  that exercise the diff/apply loop.

Deliverable: reconciler in production creating empty wide tables for
every existing connector entity. No reads or writes against them yet.

### Phase 2 — Storage cutover + REST read path rewrite *(merged 2026-05-09)*

Sync writes start writing to wide tables. JSONB column drops in the
same migration. Every server-side read site that today references
`entity_records.normalized_data` is rewritten against typed wide-table
columns. Single deploy.

See `ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md` and `.plan.md` for the
authoritative scope. The bullets below describe the original "Phase 2
storage cutover" only — the merged read-path work is detailed in the
spec.



- Sync write path (`connector-sync.*`) upserts `entity_records` and
  `er__<entity_id>` in one transaction. The transaction-table upsert
  no longer touches `normalized_data`.
- Drizzle migration `entity_records_drop_normalized_data`:
  `DROP INDEX entity_records_normalized_data_gin; ALTER TABLE
  entity_records DROP COLUMN normalized_data; TRUNCATE entity_records
  CASCADE;`
- Re-sync trigger: one-shot script (or admin action) that fires sync
  on every live connector instance after deploy.
- `EntityRecordsRepository` slims down — no more JSONB read paths in
  the transaction repository; analyzable reads move to
  `WideTableRepository`.

Deliverable: live records flow through the new path end-to-end.
Reads (REST + LLM) still go through old paths until Phase 3 / 4.

### Phase 3 (was Phase 4) — `data_query` tool to Postgres-direct

*(Renumbered 2026-05-09: old Phase 3 was merged into Phase 2.)*

The original "Phase 3 — REST read path rewrite" content below is
preserved for context — it describes work that now lands as part of
the merged Phase 2.

#### Original Phase 3 — REST read path rewrite *(now part of Phase 2)*

Rewrite the `entity-record.router.ts` list / get / patch / create /
import endpoints against the wide table. Response shape unchanged.

- `parseAndBuildFilterSQL` (`utils/filter-sql.util.ts`) — operator
  builders drop `jsonbText` / regex-cast plumbing; each `field`
  resolves to a typed column on the wide table.
- `buildJsonbSortExpression` collapses to a direct column reference;
  `SORTABLE_COLUMN_TYPES` becomes obsolete.
- Search rewrites from `jsonb_each_text` `EXISTS` to `OR`-joined
  `ILIKE` across text columns (or `concat_ws` ILIKE), generated per
  entity from `field_mappings`.
- Response rehydrator: `to_jsonb(w.*) - <metadata cols>` to project
  the wide row back into a `normalizedData` object. Single place a
  JSONB value is constructed; happens at serialization.
- Single-record paths use the same rehydration on read; writes use
  generated typed UPSERT statements built from `field_mappings`.

Deliverable: the web app continues to behave identically — list
filtering, sorting, search, pagination, column projection, edit, and
create all preserved. No frontend changes. Existing
`assertWriteCapability` gate calls survive untouched at every
write-route site (see *Capability preservation*).

#### Original Phase 4 — `data_query` tool to Postgres-direct *(now Phase 3)*

Migrate the LLM analytics path off AlaSQL.

- `AnalyticsService.sqlQuery` executes against Postgres directly.
- Per-session view aliasing: `entity.key` → `er__<entity_id>` via
  generated temp views or a query rewriter. View set is built from
  `resolveEntityCapabilities(stationId)` (read-capability-scoped) and
  projects `_record_id` and `_connector_entity_id` synthetic columns
  so mutation tools called downstream pass the right id into the
  existing `assertWriteCapability` gate (see *Capability
  preservation*).
- `validateSql` rewritten for Postgres: block `pg_*` catalog access,
  `COPY`, `LISTEN/NOTIFY`, all writes; scope reads to the org via
  `SET LOCAL search_path` or wrapping CTE.
- **Context-bloat mitigations** (detailed below) — server-side row
  cap, cell-size cap, total-payload cap, schema-aware system-prompt
  guidance.
- Delete `loadStation`'s AlaSQL writes, the `apply*` mutation surface
  (`apps/api/src/services/analytics.service.ts:554-908`), and the
  `stationDatabases` map.
- Port math methods (`describeColumn`, `correlate`, `regression`,
  `forecast`, `decompose`, `changepoint`, `trend`,
  `technicalIndicator`, `aggregate`, `cluster`, `outliers`,
  `hypothesisTest`, `logisticRegression`, financial methods) onto a
  shared `fetchProjectedRows` helper that pulls from Postgres.
- `system.prompt.ts` updates: keep schema dump (it already drives
  this), add LIMIT / projection guidance, drop the
  `_record_id` / `_connector_entity_id` / metadata-table notes that
  no longer apply (or rewrite them for the new shape).

Deliverable: portal sessions cold-start near-instantly; SQL runs
against Postgres with proper plans and statistics; no per-process
RAM ceiling on dataset size.

### Phase 4 (was Phase 5) — Steady-state polish

*(Renumbered 2026-05-09.)*

Pure follow-up; no user-visible feature change.

- Reconciler maintenance job that drops retired columns past the
  retention window.
- Type-change backfill stager (add-new → backfill → swap → retire).
- Operational runbook for reconciler drift, advisory-lock contention,
  re-sync recovery.
- Optional: schema-per-org namespace partitioning (defer until table
  count or per-tenant ops ergonomics demands it).

## Capability preservation

Today every write to an entity record — whether from the REST UI or
from a portal-session tool call — passes through
`assertWriteCapability(connectorEntityId)`
(`apps/api/src/utils/resolve-capabilities.util.ts:47`). That helper:

1. Resolves `connectorEntityId` → `connector_entities.connectorInstanceId`.
2. Resolves `connectorInstanceId` → `connector_instances.enabledCapabilityFlags`.
3. Throws `CONNECTOR_INSTANCE_WRITE_DISABLED` (422) if the instance does
   not have `write: true`.

None of those tables move. None of their column shapes change. So
the helper itself is unchanged after the migration; the **rule that
"only records belonging to an entity associated with a write-enabled
connector instance can have writes performed on them" is preserved
verbatim, in the same code path, with the same error code.**

The three places we need to be deliberate:

### REST UI path (Phase 3)

`entity-record.router.ts` already calls `assertWriteCapability` on
every POST / PATCH / DELETE / import / clear / revalidate route via
its existing helper. Phase 3 keeps every one of those gate calls in
place — only the SQL the route emits behind the gate changes (typed
INSERT/UPDATE against `er__<entity_id>` instead of JSONB upserts
against `entity_records`). The gate runs *before* any wide-table
statement is built, so a write-disabled entity never reaches the
storage layer.

No new code. No new paths. The Phase 3 spec just enumerates the
existing gate sites and asserts they survive the rewrite.

### Portal-session tool path (Phase 4)

The mutation tools (`entity_record_create`, `entity_record_update`,
`entity_record_delete`, `field_mapping_*`, `connector_entity_*`)
already call `assertWriteCapability` before doing anything. The
wide-table change moves the underlying SQL but does not move the
gate. Phase 4 keeps those calls intact.

The interesting Phase-4-specific concern is the **`sql_query` tool**,
because the LLM gets to write arbitrary SQL there. Three guardrails
together preserve the rule:

1. **`validateSql` is read-only by construction.** `sql_query`
   blocks every DML and DDL verb (`INSERT`, `UPDATE`, `DELETE`,
   `MERGE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP`, `COPY`, `CALL`,
   etc.) plus catalog access and function calls that can have side
   effects. The LLM cannot perform writes through `sql_query` —
   period — regardless of capability. So the only way an LLM
   actually writes a record is through a mutation tool, which
   already calls `assertWriteCapability`. Belt-and-suspenders.
2. **Per-session view aliasing is read-capability-scoped.** The
   `entity.key` → `er__<entity_id>` view map is built from the
   station's reachable entities, exactly as today's
   `loadStation` builds AlaSQL tables. Phase 4 derives the view set
   from `resolveEntityCapabilities(stationId)` and skips any entity
   with `read: false`. The LLM cannot select from an entity it has
   no read capability for. (Today this is implicit because such
   entities are simply never loaded into AlaSQL; Phase 4 makes it
   explicit.)
3. **Synthetic identifier columns stay projected.** Today the
   AlaSQL load projects `_record_id` and `_connector_entity_id` onto
   every entity table (`analytics.service.ts:382-389`), and the
   system prompt teaches the LLM to `SELECT _record_id,
   _connector_entity_id, ... FROM [table] WHERE ...` before issuing
   any `entity_record_update` / `entity_record_delete`. Phase 4
   preserves this in the view layer:

   ```sql
   CREATE TEMP VIEW contacts AS
   SELECT
     w.entity_record_id   AS _record_id,
     'cefa9b2c'           AS _connector_entity_id,  -- literal entity id
     w.*
   FROM er__cefa9b2c w
   WHERE w.organization_id = $org_id
     AND EXISTS (SELECT 1 FROM entity_records er
                 WHERE er.id = w.entity_record_id
                   AND er.deleted IS NULL);
   ```

   The LLM keeps using the same query patterns. The
   `_connector_entity_id` it pulls back is exactly what
   `assertWriteCapability` wants when the LLM then calls a mutation
   tool, so the gate runs against the right entity every time.

### System-prompt rendering (Phase 4)

`buildSystemPrompt` already annotates each entity heading with
`[read, write]` or `[read]` based on `entityCapabilities`
(`apps/api/src/prompts/system.prompt.ts:33-38`). Phase 4 keeps this
exactly. The LLM continues to see, per entity:

```
### Contacts (`contacts`) [connectorEntityId: …] [read, write]
```

…and adapts its behaviour (the prompt's existing guidance steers it
away from mutation tools on `[read]`-only entities). No prompt
changes for capabilities; the section that *does* change in Phase 4
is the metadata-tables paragraph — which references AlaSQL-internal
table names (`_connector_instances`, `_connector_entities`,
`_column_definitions`, `_field_mappings`) and needs rewriting either
to point at real Postgres tables or to drop in favour of an
expanded "Available Data" schema dump. Capability rendering is
untouched.

### Where the rule cannot be bypassed

After Phase 4 ships:

| Path | Gate | What blocks bypass |
|---|---|---|
| REST POST/PATCH/DELETE | `assertWriteCapability` in route | Same as today |
| REST bulk import / clear / revalidate | `assertWriteCapability` in route | Same as today |
| Portal mutation tools | `assertWriteCapability` in tool | Same as today |
| Portal `sql_query` (read) | `validateSql` deny-list + view scoping | New, stricter than today |
| Portal `sql_query` (write attempt) | `validateSql` rejects all DML/DDL | New, stricter than today |
| Direct Postgres connection from app code | Repository call site discipline | Same as today (unchanged risk surface) |

Net effect: **the capability rule is enforced in every path it is
enforced in today, plus `sql_query` is strictly more locked down
than the AlaSQL surface it replaces.**

## Option 2: AI analytics impact

Going Postgres-direct for `sql_query` removes the in-memory layer
entirely. The end-to-end story for the LLM changes meaningfully.

### Efficiency wins

- **Cold-session boot is near-instant.** Today, `loadStation` reads
  every record's JSONB and copies it row-by-row into AlaSQL before
  the first tool call can run. With Option 2, the LLM gets its first
  query response without any preload. For a station with 100k
  records across a few entities, this is the difference between
  multi-second startup and millisecond startup.
- **Real query plans, real statistics.** Postgres's planner picks
  index scans, hash joins, and bitmap aggregations based on actual
  per-column histograms. AlaSQL is a JS-engine SQL implementation
  with limited plan choice; for any non-trivial query, Postgres is
  faster *and* more predictable.
- **No memory ceiling on dataset size.** AlaSQL holds the entire
  station's data in V8 heap. Stations large enough to exceed Node
  RAM today simply cannot run analytics. With Option 2, dataset
  size is bounded by Postgres, which is bounded by disk — i.e. not
  bounded for any realistic workload.
- **Surgical-mutation plumbing is gone.** `applyRecordInsert/Update/
  Delete` etc. (300+ lines) exist only to keep AlaSQL coherent with
  database writes during a session. Postgres is the source of truth;
  reads see committed writes immediately. Less code, fewer bugs.
- **Math methods get faster too.** `correlate`, `regression`,
  `forecast` etc. today fetch rows out of AlaSQL with `SELECT * FROM
  [table]`. Moving the underlying source to Postgres lets them push
  filters and projections into the database — pull only the columns
  and rows the method actually needs, not the whole entity.

### Efficiency costs to watch

- **Per-call latency adds a Postgres round-trip.** AlaSQL sub-
  millisecond → Postgres ~1-10ms (local). Negligible per call;
  matters only if the LLM runs hundreds of tiny queries per turn.
  In practice it does not — the bottleneck is the LLM's own
  inference latency.
- **No snapshot read isolation across a session.** Today AlaSQL
  freezes the dataset at session start; the LLM sees the same view
  for the whole conversation. With Postgres-direct, sessions see
  committed writes immediately. This is generally desirable
  (especially for entity-management tool use) but is a semantic
  change — call it out in the spec.
- **`validateSql` surface expands.** AlaSQL's allowlist was small.
  Postgres has many more dangerous verbs and surfaces (catalog
  introspection, COPY, advisory locks, sequence manipulation,
  function execution). The new allowlist needs to be deny-list-style
  for safety: assume nothing is allowed except SELECT against the
  org's data, with a strict regex / parser pre-filter and a wrapping
  read-only transaction.

## Context-window bloat — scenarios and mitigations

Today the LLM is *implicitly* protected from oversized results: AlaSQL
runs in-process, so a `SELECT * FROM huge_table` is bounded by
whatever was loaded into RAM at session start. Going Postgres-direct
removes that ceiling. Without explicit mitigations, the LLM can
trivially blow its context window with a single tool call.

### Scenarios that bloat context

1. **`SELECT *` on a wide table.** With 25-50 typed columns, a single
   row serialised to JSON is easily 1-3 KB. `SELECT * FROM contacts
   LIMIT 200` is 200-600 KB of context for one tool call. Repeat that
   3-4 times in a session and the context window is gone.
2. **Unbounded queries.** The LLM omits `LIMIT` and asks `SELECT *
   FROM deals`. With wide tables holding millions of rows, Postgres
   happily streams them all back. AlaSQL today returned what was in
   RAM (still a lot, but RAM-bounded); Postgres returns whatever's on
   disk.
3. **Wide joins.** `JOIN` between two 50-column entities produces
   100-column result rows, doubling per-row size. Cartesian-shaped
   mistakes (forgotten join condition) amplify catastrophically.
4. **High-cardinality `GROUP BY`.** `SELECT customer_id, COUNT(*)
   FROM orders GROUP BY customer_id` on 1M customers returns 1M
   rows of summary, which is the same problem as case 2 wearing a
   different hat.
5. **Long text / JSONB cells.** Description fields, raw payloads,
   `array` / `json` typed columns, `reference-array` lists with
   thousands of IDs — any single cell can already be tens of KB
   even before row count multiplies it.
6. **Chained queries.** Even if every individual query stays within
   bounds, the LLM may run 20+ in a session. Each one's result stays
   in conversation history. Context is cumulative.
7. **Entity-management hallucinations.** The LLM sometimes selects
   too liberally to "have all the context" before mutating. With no
   ceiling, this becomes a significantly worse problem.

### Mitigations (all server-side, all in Phase 4)

- **Hard row cap** — default 500 rows per `sql_query` response,
  configurable per session. Beyond the cap, truncate and return a
  metadata envelope: `{ rows: [...], truncated: true,
  totalCount: N, hint: "add a LIMIT or aggregation" }`. The LLM
  sees the truncation explicitly and can react.
- **Cell-size cap** — truncate any single cell value over ~500 chars
  with an explicit ellipsis marker (`"...<truncated, original 12kb>"`).
  Applies to text columns, `json` / `array` cells, and
  `reference-array` lists.
- **Total payload cap** — hard 100 KB envelope per response. If
  exceeded after row + cell caps, return aggregate metadata only
  (`{ truncated: true, sample: [first 10 rows], totalCount, columnSizes }`).
- **Implicit safety LIMIT** — if the LLM submits a `SELECT` without
  `LIMIT` *and* without an aggregation, wrap in `LIMIT <row-cap+1>`.
  The +1 lets the response detect "more rows existed" honestly.
- **Schema-aware system-prompt guidance** — the prompt already
  enumerates each entity's columns and types
  (`apps/api/src/prompts/system.prompt.ts:28-52`). Add explicit
  guidance: "Avoid `SELECT *` on entity tables; project only the
  columns you need. Always include a `LIMIT` for exploratory queries.
  Prefer aggregations (`COUNT`, `AVG`, `MAX`) over scanning rows when
  the user asks summary questions."
- **Aggregation-encouragement metadata** — when `sql_query` truncates,
  the response hint can include suggested aggregations the LLM can
  reach for ("you saw 500 of 1.2M rows; try `SELECT stage,
  COUNT(*) FROM deals GROUP BY stage`"). Cheap to generate, makes
  the truncation actionable.
- **Per-method projection helpers** — math methods (`describeColumn`,
  `correlate`, etc.) take an explicit `columns` argument and pull
  only those. They never run `SELECT *`. Today they often do.

These mitigations together make Option 2 *safer* than the AlaSQL
status quo, not riskier — today there is no truncation, no cell cap,
no payload cap; nothing prevents a malformed query from filling the
context window other than RAM exhaustion at load time. The new path
makes context-economy explicit.

### Open question — does the LLM lose anything?

One scenario where AlaSQL helped: the LLM occasionally writes SQL
that exploits AlaSQL-specific syntax (e.g. `INTO` returning shapes,
column-quoting style with brackets, JSONB-style `->>` operators that
AlaSQL accepts). The Postgres surface is stricter on some of these.
The system prompt should explicitly orient the LLM to "this is
PostgreSQL-compatible SQL" and the `validateSql` errors should be
informative when the LLM strays. Phase 4 ships with eval / regression
tests using captured session transcripts to flush out these cases
before launch.

## Risks

- **Reconciler bug corrupts a wide-table schema.** Mitigated by
  transactional DDL, advisory lock with sync, and boot drift check
  refusing traffic on mismatch. Worst case: re-sync from source.
- **Sync write fails after `entity_records` upsert but before wide-
  table upsert.** Mitigated by single transaction wrapping both. If
  one half fails, both roll back.
- **`validateSql` regex / parser is too permissive or too strict.**
  Mitigated by capturing real LLM-generated SQL from existing test
  fixtures and expanding the suite. Phase 4 ships with explicit
  regression eval before merge.
- **Math-method port introduces subtle numeric differences.** Today's
  AlaSQL → JS pipeline rounds differently than Postgres → JS would.
  Mitigated by snapshot tests on representative datasets.

## Cross-references

- `ENTITY_RECORDS_WIDE_TABLE.audit.md` — current state, schema
  detail, reconciler design, per-route impact, file/line citations.
- Forthcoming: `ENTITY_RECORDS_WIDE_TABLE_PHASE_<N>.spec.md` and
  `.plan.md` for each phase.
