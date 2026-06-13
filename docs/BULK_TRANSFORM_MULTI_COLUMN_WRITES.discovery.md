# bulk_transform multi-column writes — Discovery

**Issue:** [EnterpriseBT/portal-ai#99](https://github.com/EnterpriseBT/portal-ai/issues/99)

**Why this exists.** `bulk_transform_entity_records` today takes `expression.tool.targetColumn: string` — one wide-column on a single target. The agent has to enqueue N jobs to land N derived columns from one underlying computation ("compute NEO diameter midpoint in km, m, and miles" = three jobs today, three full source-table scans, three per-record tool calls). The narrow shape also blocks cross-entity writes (one job writes derived data into a side entity) and source-column passthrough (no way to copy a source value into a target column without a recomputation). This is the generalization that opens those flows.

This is the contract change that turns `expression.tool.targetColumn` + `expression.sql.value`'s implicit alias-as-column into an explicit `writes[]` mapping. The decisions below are about which dimensions to generalize on, how to model the agent-facing shape, and how the SQL has to change to land per-record values across N columns spanning K target tables.

## The current shape

### Tool surface (`bulk_transform_entity_records`)

| Concern | Site |
|---|---|
| Input Zod schema (`ExpressionSchema` discriminated union) | `apps/api/src/tools/bulk-transform-entity-records.tool.ts:25-72` |
| Tool-kind `targetColumn` field declaration | `apps/api/src/tools/bulk-transform-entity-records.tool.ts:61-70` |
| SQL-alias pre-flight (Step 2b) | `apps/api/src/tools/bulk-transform-entity-records.tool.ts:286-334` |
| Tool-kind `targetColumn` pre-flight (Step 3a) | `apps/api/src/tools/bulk-transform-entity-records.tool.ts:344-370` |
| Cost-acknowledgement gate | `apps/api/src/tools/bulk-transform-entity-records.tool.ts:407-456` |

### Core schemas

| Concern | Site |
|---|---|
| `BulkTransformExpressionSchema` (discriminated union) | `packages/core/src/models/job.model.ts:242-262` |
| `targetColumn: z.string()` required in tool variant | `packages/core/src/models/job.model.ts:257` |
| `BulkTransformMetadataSchema` (job-row payload) | `packages/core/src/models/job.model.ts:264-289` |
| `BulkTransformResultSchema.droppedKeys` | `packages/core/src/models/job.model.ts:292-318` |

### Processor + dispatcher

| Concern | Site |
|---|---|
| `runToolDispatchLoop` shapes successes into `{ [targetColumn]: val }` | `apps/api/src/queues/processors/bulk-transform.processor.ts:282-296` |
| Calls `upsertSuccesses` with the shaped batch | `apps/api/src/queues/processors/bulk-transform.processor.ts:298-304` |
| Accumulates `droppedKeys` defence-in-depth | `apps/api/src/queues/processors/bulk-transform.processor.ts:309-318` |
| Dispatcher's `successes[].value` (opaque per-record output) | `apps/api/src/queues/processors/bulk-transform-tool.dispatcher.ts` |

### Wide-table upsert SQL

| Concern | Site |
|---|---|
| `BulkTransformService.upsertSuccesses` CTE pattern (`input_rows` → `upserted_records` → wide INSERT) | `apps/api/src/services/bulk-transform.service.ts:286-460` |
| Defence-in-depth column filter against `wideTableStatementCache` | `apps/api/src/services/bulk-transform.service.ts:342-374` |
| SQL-kind `runBatch` (alias-as-column expansion) | `apps/api/src/services/bulk-transform.service.ts:131-246` |

### Locking

| Concern | Site |
|---|---|
| `JobLockService.assertConnectorEntityUnlocked` | `apps/api/src/services/job-lock.service.ts:120-154` |
| Lock query filters on `metadata->>'targetConnectorEntityId'` | `apps/api/src/db/repositories/jobs.repository.ts:136-150` |

### Field-mapping → wide-column resolution

`WideTableStatementCache` (`apps/api/src/services/wide-table-statement.cache.ts:1-80`) is the per-entity authority for live wide-columns. `station-context.tool.ts:159-200` projects each entity's columns including `wideColumnName` so the agent picks names the pre-flight will accept. `WideTableReconciler` is the single DDL path; not touched by this work.

### Existing tests

| Test | Site |
|---|---|
| Unit — tool pre-flight | `apps/api/src/__tests__/tools/bulk-transform-entity-records.tool.test.ts` |
| Processor — control flow | `apps/api/src/__tests__/queues/processors/bulk-transform.processor.test.ts` |
| Dispatcher — concurrency + failures | `apps/api/src/__tests__/queues/processors/bulk-transform-tool.dispatcher.test.ts` |
| Integration — §4 smoke C | `apps/api/src/__tests__/__integration__/queues/bulk-transform-smoke-c.integration.test.ts` |

## The design space

### Decision 1 — `valueFrom` kind enumeration

Issue proposes five kinds: `tool_result`, `tool_path`, `sql_alias`, `source_column`, `constant`. Each adds a small amount to the agent's mental model and the pre-flight surface. Cutting some is possible if usage doesn't justify the surface.

| | A — all 5 | B — three core | C — four (drop `constant`) |
|---|---|---|---|
| Kinds | `tool_result`, `tool_path`, `sql_alias`, `source_column`, `constant` | `tool_result`, `tool_path`, `sql_alias` | drop only `constant` |
| Surface size | Largest — 5 discriminator branches | Smallest — 3 | 4 |
| Agent prompt | Needs five examples | Three examples | Four |
| `source_column` cost | Useful for "stamp record's source ID into a derived column without recomputation" — composable with no other kind | Missing | Present |
| `constant` cost | Useful for "tag every record with `created_via: 'bulk_transform'`" — niche but cheap | Missing | Missing |

**Lean: A — ship all five.** Each kind is a single Zod variant + a small handler in the value-shaping step; the surface cost is dwarfed by saving the agent from awkward compositions. `source_column` and `constant` look niche today but cost almost nothing.

### Decision 2 — Cross-entity writes in one job

Today the job has a single `targetConnectorEntityId`. Under `writes[]`, each entry may target a different entity. Implementation choices:

| | A — single-job, per-batch fan-out | B — single-job, single SQL statement | C — disallow cross-entity for v1 |
|---|---|---|---|
| SQL shape | Group `writes` by `targetConnectorEntityId`; run one CTE per group within the batch transaction | One CTE that writes to multiple wide tables in one statement | Reject at pre-flight |
| Per-batch work | K UPSERTs (K = unique target ids), one transaction | One giant UPSERT, weird across tables | Forces multi-job pattern |
| Failure isolation | A failing UPSERT for target B doesn't roll back target A's writes — unless wrapped in a single transaction | All-or-nothing in one statement | N/A |
| Future flexibility | Easy to extend (per-target failure surfacing) | Hard to extend; SQL gets dense | Closes door |

**Lean: A — per-target UPSERT, wrap in a single transaction.** PG can't do a single multi-table UPSERT cleanly; option B requires either UNION ALL gymnastics or a function. Option A keeps each target's CTE-style flow intact, with a single transaction for atomicity across targets in the batch.

### Decision 3 — `targetConnectorEntityId` on metadata vs derived from writes

Today the job metadata carries a single `targetConnectorEntityId`. With per-write targets, this field becomes redundant.

| | A — keep + require it matches `writes[]` | B — remove, derive lock set from `writes[].targetConnectorEntityId` |
|---|---|---|
| Redundancy | Duplicate; must validate it matches at least one write | None |
| Migration | One field to remove on the way out anyway | Clean cut |
| Lock query | Stays on `metadata->>'targetConnectorEntityId'` (one entity) | Has to scan `metadata->'writes'` or read a denormalized `targetConnectorEntityIds[]` array |

**Lean: B — remove it.** Per project memory `feedback_no_compat_aliases` + `project_no_production_data_yet`, no shim. To keep the lock query simple, denormalize the union into `metadata.targetConnectorEntityIds: string[]` at enqueue time; the query then uses a PG array-overlap (`?|`) test against that field.

### Decision 4 — SQL branch under `writes[]`

The SQL path today uses `expression.value`'s `AS alias` projections as the implicit target-column map. Under generalization, this magic disappears.

| | A — SQL keeps implicit alias-as-column; `writes[]` tool-only | B — SQL also requires explicit `writes[]` with `{ kind: "sql_alias", alias }` | C — Both — explicit `writes[]` overrides, implicit fallback |
|---|---|---|---|
| Magic level | High (in SQL) | Zero | Variable |
| Symmetry tool ↔ SQL | None | Full | Partial |
| Agent prompt | Two stories | One | Two |

**Lean: B — explicit on both sides.** The issue calls this out directly. The SQL projection's `AS aliases` become reference names that `writes[]` selects from; an `AS alias` that no write picks up is silently discarded (or rejected at pre-flight; see Open Question 1).

### Decision 5 — `tool_path` resolution semantics

A `valueFrom: { kind: "tool_path", path: "diameter.km.avg" }` reads a sub-value out of the tool's per-record output. Tool outputs are arbitrary serializable JS values bounded only by the tool's declared output schema — primitives, objects, arrays, or nested mixes. The path syntax has to reach into any of those.

| | A — simple dot segments | B — Lodash-style (`a.b[0].c`) | C — JSONPath / JMESPath |
|---|---|---|---|
| Parse complexity | Trivial | Hand-written ~20 LOC | Pulls in `jsonpath-plus` (~30 KB) |
| Array indexing | No | Yes, single element | Yes + filters + slices |
| Returns one value | Yes | Yes (deterministic single get) | No — `$.users[*].name` returns an array |
| Fits today's tools | Only when the output is strictly object-of-objects | Yes — covers primitives, objects, top-level arrays, nested arrays | Yes, with extra surface we don't need |

**Lean: B — Lodash-style.** Tool outputs are not constrained to object shapes (an output schema declared as `z.array(z.number())` returns a plain array; `z.number()` returns a bare number — the path `""` or absent path then means "the whole value"). Array indexing is table stakes, not a follow-up. JSONPath's query semantics return arrays, which doesn't match the one-value-per-write contract — we want a single deterministic get, which is exactly what Lodash's `_.get(obj, path)` is. Implementation is ~20 LOC of path tokenization (split on `.` and `[N]`); no dep needed.

### Decision 6 — Per-record write atomicity

Five writes for one source record; write 2 throws (type coercion, foreign key failure, etc.). Do writes 1, 3, 4, 5 still commit for that record?

| | A — all-or-nothing per record | B — partial commit; track per-write failures |
|---|---|---|
| User mental model | "Apply these N columns to this row." Matches SQL UPSERT semantics. | "Apply each independently." Surprising. |
| Implementation | Single UPSERT statement per target per record (or per batch with grouped values) | Per-write statements; per-write failure accumulation |
| Failure surfacing | One partial-failure entry per record | N per-write failures per record |

**Lean: A — all-or-nothing per record per target.** Cross-target is also all-or-nothing in the batch transaction (Decision 2's transaction wrapper). The dispatcher's existing partial-failure pattern stays: one entry per `sourceKey`.

## Tradeoff comparison

|  | D1 — five kinds | D2 — per-target UPSERT in txn | D3 — derive lock set from writes | D4 — explicit writes on SQL | D5 — Lodash-style path | D6 — atomic per record |
|---|---|---|---|---|---|---|
| Forces schema churn | Yes | No | Yes (remove `targetConnectorEntityId`) | Yes (SQL alias references) | No | No |
| Spreads to spec | Yes — Zod variants | Yes — SQL flow | Yes — lock query | Yes — SQL contract | No | Yes — failure shape |
| Risk if wrong | Low — kinds are independent | Medium — cross-target txn behavior | Low — JSON denorm easy | Low — explicit is conservative | Low — extensible | Low — matches SQL norms |

## Recommendation

1. Replace `expression.tool.targetColumn` with `writes: Array<{ targetConnectorEntityId, column, valueFrom }>` where `valueFrom` is a discriminated union of `tool_result | tool_path | sql_alias | source_column | constant`.
2. The same `writes[]` shape governs the SQL branch — aliases declared in `expression.value` are referenced by `{ kind: "sql_alias", alias }`, never implicitly mapped.
3. Drop `metadata.targetConnectorEntityId`; denormalize the union of `writes[].targetConnectorEntityId` into `metadata.targetConnectorEntityIds: string[]` at enqueue time so the lock query stays a simple array-overlap.
4. `JobLockService.assertConnectorEntityUnlocked` and `findRunningByTargetEntityId` change to take an array and use `?|` against `metadata->'targetConnectorEntityIds'`.
5. The processor groups `writes` by `targetConnectorEntityId` per batch and runs one CTE-style UPSERT per target; wrap all per-target UPSERTs for the batch in a single transaction.
6. Per-record per-target writes are atomic — a failing write surfaces the whole record-target pair as a partial failure; other targets in the same batch are unaffected.
7. `tool_path` uses Lodash-style path syntax (`a.b[0].c`) — tool outputs are arbitrary serializable values (primitives, objects, arrays, or nested mixes), so array indexing is required, not optional. Empty/absent path resolves to the whole tool result.
8. Pre-flight loads each `targetConnectorEntityId`'s columns from `wideTableStatementCache` once, then validates every `writes[].column` against the matching target's column set; rejects unknown columns with the existing `BULK_JOB_EXPRESSION_INVALID` code (extend the message to name the bad write).

## Open questions

1. **SQL aliases that no write references — silent drop or pre-flight reject?** An `AS unused_alias` in the projection burns compute and signals a bug. **Lean: pre-flight reject.** The error message names the unreferenced alias; cheap diagnostic, no runtime cost.

2. **Constant kind type validation against the target column's PG type.** `valueFrom: { kind: "constant", value: "hello" }` written into a `bigint` column will fail at INSERT. Validate at pre-flight against `pgType`? **Lean: yes, but lenient — accept the constant if it casts.** PG's text-to-type rules are well-defined; the pre-flight runs the same coercion the INSERT will run.

3. **Locking conflict when one of N writes targets a busy entity.** All-or-nothing — reject the whole job at enqueue. **Lean: yes, current behavior generalized.** The `ENTITY_LOCKED_BY_JOB` response names every locked entity in the set, not just the first one.

4. **`source_column` resolution — does the value come from the raw source row or the projected SQL row?** For tool-kind, source row only (no SQL projection step). For SQL-kind, both are available. **Lean: always source row.** Symmetric semantics; SQL aliases live in `sql_alias`, source values live in `source_column`.

5. **Result shape — per-write success/failure or per-record per-target?** When write 2 in target B fails for record `p-3`, the partial failure entry should name the target + column. **Lean: extend the partial-failure entry with `{ targetConnectorEntityId, column }`.** Single record can produce multiple partial-failure entries (one per failing target).

## What this doesn't decide

- **The other four primitives** (`bulk_query`, `bulk_aggregate`, `bulk_delete`, `bulk_apply`) from the GENERALIZATION discovery — each has its own ticket (#100–#102). This work is `bulk_transform` only.
- **Backfill or migration of existing `targetColumn`-shaped jobs.** Per `project_no_production_data_yet`: clean cut, no shim. Existing fixtures + integration tests are updated in lock-step with the schema change.
- **Tool-output streaming.** Tools today return one value per record. Stream-of-values tools are a separate generalization captured under `bulk_apply`.
- **Dropping the `BULK_TRANSFORM_DROPPED_RECORDS` defense-in-depth.** Stays; pre-flight catches unknown columns now, this is the fallback when something slips (e.g., a wide-column gets dropped between pre-flight and execution).

## Next step

Write `docs/BULK_TRANSFORM_MULTI_COLUMN_WRITES.spec.md` (contract — Zod shapes, lock-query SQL, partial-failure entry shape) and `.plan.md` (slices). The plan target: contract changes + pre-flight first (no behavior change yet, one passing write reproducing the §4 smoke), then processor shaping + per-target UPSERT, then locking-set generalization, then the multi-write smoke walk. Each slice green-testable on its own.
