# Bulk Write — Entity Management Tool Pack

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
