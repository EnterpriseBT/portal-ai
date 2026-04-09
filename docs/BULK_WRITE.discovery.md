# Bulk Write — Entity Management Tool Pack

## Goal

Portal.ai's entity management tools (create, update, delete for records, column definitions, field mappings, and connector entities) currently operate on a single item per tool call. When the LLM needs to create 20 records or set up 10 field mappings, it must issue 20 or 10 sequential tool calls — each with its own validation round-trip, database query, and cache update. This is slow, token-expensive, and produces a noisy stream of individual mutation-result blocks in the UI.

Bulk write adds array support to all 12 entity management tools so the LLM can batch multiple items into a single tool call. The goals are:

1. **Reduce tool-call overhead** — one call with N items instead of N calls with 1 item. Fewer round-trips means faster end-to-end execution and lower token cost.
2. **Enable atomic multi-item operations** — all items succeed or none do. The current sequential pattern can leave the system in a half-written state if the LLM stops mid-sequence or a later call fails.
3. **Optimize shared work** — normalization, scope checks, capability assertions, and field-mapping lookups happen once per unique entity rather than once per item.
4. **Improve the user experience** — a single "Created 5 records" result block is cleaner than five individual blocks. The LLM can reason about the batch result with a `count` field instead of parsing N separate responses.
5. **Preserve simplicity** — no new tools are added. The existing 12 tools gain an `items` array wrapper. Single-item calls are just a one-element array.

## Existing State

The entity management tool pack currently consists of 12 single-item tools registered in `ToolService.buildAnalyticsTools()`:

| Domain | Create | Update | Delete |
|--------|--------|--------|--------|
| Entity Record | `entity_record_create` | `entity_record_update` | `entity_record_delete` |
| Column Definition | `column_definition_create` | `column_definition_update` | `column_definition_delete` |
| Field Mapping | `field_mapping_create` | `field_mapping_update` | `field_mapping_delete` |
| Connector Entity | `connector_entity_create` | `connector_entity_update` | `connector_entity_delete` |

### Per-call pattern (all 12 tools)

Each tool accepts a flat Zod object (e.g. `{ connectorEntityId, data }`) and follows the same flow:

1. **Validate** input via `this.validate(input)`.
2. **Assert scope** — `assertStationScope()` and `assertWriteCapability()` per `connectorEntityId` (entity record, field mapping, connector entity tools). Column definition tools skip this (organization-scoped).
3. **Normalize** — record create/update calls `NormalizationService.normalize()`, which loads field mappings from the DB on every call.
4. **Persist** — single `create`/`update`/`softDelete` or `upsertByKey`/`upsertByEntityAndNormalizedKey` call.
5. **Cache** — single `AnalyticsService.apply*()` call to update the AlaSQL in-memory store.
6. **Return** — a `MutationResultContentBlock` with `{ success, operation, entity, entityId, summary }`.

### What already supports bulk

- **Base repository** has `createMany`, `updateMany`, `softDeleteMany`, and `upsertMany` methods.
- **Entity records repository** has `upsertManyBySourceId` (single SQL statement for bulk upsert).
- **NormalizationService** has `normalizeWithMappings(mappings, data)` — accepts pre-fetched mappings, enabling a "fetch once, normalize many" pattern.
- **AlaSQL** natively supports array inserts via `SELECT * FROM ?` with a row array.

### What does not yet exist

- No `items` array wrapper on any tool input schema.
- No `NormalizationService.normalizeMany()` convenience method.
- No batch `AnalyticsService.apply*Many()` cache methods.
- `MutationResultContentBlockSchema` requires `entityId` (no `count` or `items` array for bulk results).
- `MutationResultBlock` component has no bulk-aware rendering.
- No within-batch or cross-existing deduplication logic for column definitions.

## Approach: `items` array wrapper on existing tools

Instead of adding new tools, wrap each tool's input schema with `{ items: [...] }`. The LLM always passes an array (even for single items), keeping the schema uniform and avoiding union-type confusion. Tool count stays at 12.

**Example (entity-record-create):**

```ts
// Current
{ connectorEntityId: "...", data: {...} }

// New
{ items: [{ connectorEntityId: "...", data: {...} }, ...] }
```

## Execution Strategy

Each tool follows a three-phase pattern:

1. **Validate all items** — run schema validation and pre-checks (station scope, write capability). Group by `connectorEntityId` to avoid redundant lookups. If any item fails, return all errors immediately with nothing written.

2. **Execute in a single transaction** — use `createMany`/`updateMany`/`softDeleteMany` for entity records (already on the base repository). For upsert-based tools (connector entities, column definitions, field mappings), loop within a transaction.

3. **Batch-update AlaSQL cache** — add `applyRecordInsertMany`, `applyRecordDeleteMany`, etc. to `AnalyticsService`. A single `INSERT INTO ... SELECT * FROM ?` with the full array is cheaper than N individual inserts.

## Error Handling: All-or-Nothing

Validation failures → return per-item errors, nothing written. DB failure → transaction rolls back entirely. No partial success ambiguity.

```ts
// Success
{ success: true, operation: "created", entity: "record", count: 5,
  items: [{ entityId: "abc", summary: {...} }, ...] }

// Validation failure
{ success: false, error: "2 of 5 items failed validation",
  failures: [{ index: 1, error: "Record not found" }, ...] }
```

## Normalization Optimization

Add `NormalizationService.normalizeMany(connectorEntityId, dataItems[])` — loads field mappings once and normalizes all items. Group by `connectorEntityId` for mixed-entity batches.

## Pre-check Optimization

Many tools call `assertStationScope(stationId, connectorEntityId)` and `assertWriteCapability(connectorEntityId)` per item. For bulk operations:

- Group items by `connectorEntityId`
- Call `assertStationScope` and `assertWriteCapability` once per unique `connectorEntityId`
- Cache the results to avoid N redundant DB lookups

This is especially important for entity-record-create where 50 records might all target the same connector entity.

## AlaSQL Cache Batch Methods

New methods on `AnalyticsService`:

- `applyRecordInsertMany(stationId, entityKey, rows[])` — single `INSERT INTO ... SELECT * FROM ?` with array of rows
- `applyRecordUpdateMany(stationId, entityKey, items[])` — delete all by IDs, then batch insert
- `applyRecordDeleteMany(stationId, entityKey, recordIds[])` — single `DELETE FROM ... WHERE _record_id IN @(?)`
- Similar batch methods for entities, column definitions, and field mappings

AlaSQL supports inserting multiple rows in a single `SELECT * FROM ?` call by passing an array, so the existing `cacheInsert` pattern extends naturally.

## Mutation Result Display

Extend `MutationResultContentBlockSchema` with optional `count` and `items` fields. The `MutationResultBlock` component renders "**Created** 5 records in Customers" for bulk, falls back to the current single-item display when `count` is 1 or absent.

```ts
export const MutationResultContentBlockSchema = z.object({
  type: z.literal("mutation-result"),
  operation: z.enum(["created", "updated", "deleted"]),
  entity: z.string(),
  entityId: z.string().optional(),       // optional for bulk (no single ID)
  count: z.number().int().optional(),     // how many items were affected
  summary: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    entityId: z.string(),
    summary: z.record(z.string(), z.unknown()).optional(),
  })).optional(),                         // per-item details for bulk
});
```

## Implementation Sequence

| Phase | What | Files |
|-------|------|-------|
| 1 | Infrastructure: `normalizeMany`, batch AlaSQL methods, schema extension | `normalization.service.ts`, `analytics.service.ts`, `portal.contract.ts` |
| 2 | Entity record tools (highest bulk value, has `createMany`) | `entity-record-*.tool.ts` |
| 3 | Column definition tools (simplest, no station scope) | `column-definition-*.tool.ts` |
| 4 | Field mapping tools | `field-mapping-*.tool.ts` |
| 5 | Connector entity tools (most complex, cascade deletes) | `connector-entity-*.tool.ts` |
| 6 | Frontend bulk display | `MutationResultBlock.tsx`, `resolveDisplayBlock` |
| 7 | Tests: single-item regression + multi-item + validation failure | All 12 test files |

## Column Definition Reuse

When creating column definitions and field mappings, the system should **prioritize using existing column definitions** rather than creating new ones. A new column definition should only be created when no suitable existing definition matches. This avoids unnecessary duplication and keeps the schema clean.

- Before creating a column definition, query existing definitions for the same connector entity and check if one already matches by `normalizedKey` (or label/type).
- Only create a new column definition if no existing one satisfies the requirement.
- Field mappings should reference existing column definitions wherever possible.
- This applies to both single and bulk operations — bulk column-definition-create should deduplicate against existing definitions before inserting.

## Guardrails

- Max array size `.max(100)` on the schema to prevent runaway bulk calls
- Tool descriptions updated to mention bulk capability and the max
- Per-item summaries kept minimal to limit token cost in tool results

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM sends very large arrays (100+ items) | Add a max array size in the schema (e.g., `.max(100)`) and document in description |
| Token cost of large `items` arrays in tool results | Keep per-item summaries minimal; use `count` for the LLM to reason about without seeing every ID |
| Transaction timeout on large bulk operations | Set reasonable max (50–100 items) and batch DB calls within the transaction |
| AlaSQL performance with large batch inserts | AlaSQL handles array inserts natively; single INSERT with array is faster than N individual INSERTs |
