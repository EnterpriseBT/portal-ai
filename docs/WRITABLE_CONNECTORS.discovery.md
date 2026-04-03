# Writable Connectors — Discovery

## Overview

Add the ability to **update and delete** the following objects via the API and frontend:

| Object | Create | Read | Update | Delete |
|--------|--------|------|--------|--------|
| Entities (connector_entities) | exists | exists | **new** | **new** |
| Entity Records (entity_records) | exists | exists | **new** | **new** |
| Entity Groups (entity_groups) | exists | exists | **new** | **new** |
| Entity Group Members (entity_group_members) | exists | exists | **new** | **new** |
| Column Definitions (column_definitions) | exists | exists | **new** | **new** |
| Field Mappings (field_mappings) | exists | exists | **new** | **new** |

This document focuses on the **data integrity challenges** that arise when these objects become mutable — particularly column definitions, which sit at the center of the data model and are referenced by field mappings, entity records (via `normalizedData` JSONB keys), entity group members (via `linkFieldMappingId`), and portal results. Entities have potential to be referenced by other entities via `refEntityKey`.

---

## Dependency Graph

```
column_definitions (org-level shared catalog)
 │
 ├──► field_mappings (N:1 — many mappings can reference one column definition)
 │     │
 │     ├──► entity_group_members.linkFieldMappingId (1:1 — a group member's identity key)
 │     │
 │     └──► entity_records.normalizedData (implicit — JSONB keys are column definition keys)
 │
 └──► field_mappings.refColumnDefinitionId (reference target — another column definition)

entity_groups
 └──► entity_group_members (1:N — group contains members)
       ├──► connectorEntityId → connector_entities
       └──► linkFieldMappingId → field_mappings
```

**Key insight:** Column definitions are the most sensitive object to mutate because they have both explicit FK references (field mappings) and **implicit references** (entity record `normalizedData` JSONB keys use the column definition's `key` as property names).

---

## Integrity Problem: Column Definition Mutations

### Problem 1: Deleting a Column Definition with Existing Field Mappings

If a column definition is deleted while field mappings still reference it via `columnDefinitionId`, the system enters an inconsistent state:

- Field mappings point to a non-existent (or soft-deleted) column definition
- Entity records retain `normalizedData` keys that no longer resolve to a catalog entry
- Portal results may reference column names that no longer have type metadata
- Entity group members whose `linkFieldMappingId` points to a mapping for that column lose their identity resolution key

### Problem 2: Renaming a Column Definition Key

The `key` field (e.g., `"email"` → `"primary_email"`) is used as the property name in every `entity_records.normalizedData` JSONB object. Changing it creates a split:

- **Existing records** have `{ "email": "jane@ex.com" }`
- **New records** (synced after the rename) would have `{ "primary_email": "jane@ex.com" }`
- Queries, sorts, and filters break because they look up a single key in the GIN-indexed JSONB
- Portal results that previously rendered `"email"` columns become stale

### Problem 3: Changing a Column Definition Type

Changing `type` (e.g., `"string"` → `"boolean"`) affects:

- **Sorting logic** — `buildJsonbSortExpression` in `entity-record.router.ts` uses type-aware casting. A `string` column sorted lexicographically becomes a `boolean` column sorted by true/false — existing string values like `"yes"` would fail the cast
- **Validation** — downstream consumers expect values matching the declared type
- **Reference fields** — changing from `"reference"` to `"string"` orphans the `refColumnDefinitionId` and `refEntityKey` on associated field mappings
- **SORTABLE_COLUMN_TYPES** — the column may enter or leave the sortable set, breaking saved sort preferences

### Problem 4: Changing Enum Values

For `type: "enum"` columns, narrowing the `enumValues` array (removing options) means existing records may contain values that are no longer valid. Adding values is safe.

---

## Proposed Approach: Option A — Strict Guardrails with Blocked Destructive Mutations

This approach prioritizes **data integrity over flexibility**. Dangerous mutations are blocked at the API level with clear error messages, and users must explicitly resolve dependencies before proceeding.

### Rule 1: Column Definitions Cannot Be Deleted If Referenced by Field Mappings

**Enforcement:** Before soft-deleting a column definition, query `field_mappings` for any non-deleted rows where `columnDefinitionId = target.id` OR `refColumnDefinitionId = target.id`. If any exist, reject the delete with a `422` and return the count and list of dependent field mappings.

```
DELETE /api/column-definitions/:id

→ 422 COLUMN_DEFINITION_HAS_DEPENDENCIES
{
  "message": "Cannot delete column definition — 4 field mappings reference it.",
  "code": "COLUMN_DEFINITION_HAS_DEPENDENCIES",
  "dependencies": {
    "fieldMappings": [
      { "id": "fm_1", "connectorEntityId": "ce_1", "sourceField": "email_address" },
      { "id": "fm_2", "connectorEntityId": "ce_2", "sourceField": "Email" },
      ...
    ]
  }
}
```

**User workflow:** To delete a column definition, the user must first delete or reassign all field mappings that reference it. This is explicit and prevents orphaned data.

**Also applies to `refColumnDefinitionId`:** Field mappings for `reference` and `reference-array` columns store a `refColumnDefinitionId` pointing to the target column definition. These references must also be checked and cleared before the target column definition can be deleted.

### Rule 2: Column Definition `key` Is Immutable

**Enforcement:** The `PATCH /api/column-definitions/:id` endpoint must reject any request that includes a `key` field. The key is set at creation and never changes.

**Rationale:** The `key` is embedded in every `entity_records.normalizedData` JSONB object across potentially thousands of records. Renaming it would require a data migration (updating every JSONB document), and any records synced between the rename and the migration would use the old key. The complexity and risk of a live JSONB key rename far outweigh the benefit.

**User workflow:** To change a column's key, the user creates a new column definition with the desired key, remaps field mappings to it, re-syncs entity records, and then deletes the old column definition (which is now unreferenced).

**Mutable fields:** `label`, `description`, `required`, `defaultValue`, `format`, `enumValues` are safe to update because they are metadata — they do not appear as keys in stored data.

### Rule 3: Column Definition `type` Changes Are Restricted

**Enforcement:** Type changes are only allowed between compatible types. The API validates the requested type transition against an allowlist:

| From | Allowed To | Rationale |
|------|-----------|-----------|
| `string` | `enum` | Narrowing — existing string values may match enum options |
| `enum` | `string` | Widening — all enum values are valid strings |
| `date` | `datetime` | Widening — dates are valid datetimes (midnight) |
| `datetime` | `date` | Narrowing — time component is dropped |
| `number` | `currency` | Semantic — same underlying numeric representation |
| `currency` | `number` | Semantic — same underlying numeric representation |
| All other transitions | **blocked** | Type mismatch would corrupt query/sort/filter behavior |

Blocked transitions return:

```
PATCH /api/column-definitions/:id  { "type": "boolean" }

→ 422 COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED
{
  "message": "Cannot change type from 'string' to 'boolean'. Allowed transitions from 'string': enum.",
  "code": "COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED"
}
```

**Special case — `reference` / `reference-array`:** Changing to or from reference types is always blocked because it would orphan or require `refColumnDefinitionId` and `refEntityKey` values on associated field mappings.

### Rule 4: Enum Value Removal Requires Validation

**Enforcement:** When updating `enumValues` on an `enum`-type column definition, if the new array is a strict subset of the old array (values were removed), the API issues a **warning** but allows the update. The response includes a `warnings` array:

```json
{
  "data": { ... },
  "warnings": [
    "Removed enum values: 'inactive', 'pending'. Existing records with these values will retain them but they will no longer appear in filter/selection UIs."
  ]
}
```

This is a soft guardrail — the data remains valid at the storage layer (JSONB doesn't enforce enums), but the UI should gray out or flag records with stale enum values.

### Rule 5: Field Mapping Deletion Cascades to Entity Group Members

**Enforcement:** When a field mapping is deleted, any `entity_group_members` row whose `linkFieldMappingId` references that mapping must also be soft-deleted in the same transaction. This prevents entity groups from having members with broken identity keys.

```
DELETE /api/field-mappings/:id

→ 200
{
  "id": "fm_1",
  "cascaded": {
    "entityGroupMembers": 1
  }
}
```

The frontend should display a warning before deleting a field mapping that is used as a group link field.

### Rule 6: Entity Record Deletion Is Straightforward (with Permission Check)

Entity records have no downstream FK dependents. Deleting individual records or bulk-clearing records for an entity is a simple soft-delete with no integrity concerns beyond the standard audit trail.

**However**, before deleting entity records the API must verify that the parent connector entity's connector instance has the `write` capability. This is determined by resolving the instance's `enabledCapabilityFlags` against its connector definition's `capabilityFlags` ceiling (see `DYNAMIC_SESSIONS.discovery.md` for the `resolveCapabilities()` function). If the resolved capabilities do not include `write: true`, the delete must be blocked:

```
DELETE /api/entity-records/:id

→ 422 CONNECTOR_INSTANCE_WRITE_DISABLED
{
  "message": "Cannot delete records — the connector instance does not have write capability enabled.",
  "code": "CONNECTOR_INSTANCE_WRITE_DISABLED"
}
```

**Rationale:** A connector instance without write capability represents data flowing in from an external source that should not be modified locally. Deleting records locally would either be undone on the next sync (re-creating the deleted records) or cause silent data divergence if soft-deleted records are skipped during sync. Blocking the operation prevents user confusion and keeps the local dataset consistent with the external source.

### Rule 7: Entity and Entity Group Deletion Follows Existing Cascade Patterns

These follow the same pattern established in `DELETE_CONNECTORS.feature.md`.

**Permission check:** Before deleting a connector entity, the API must resolve the connector instance's capabilities via `resolveCapabilities()` (see `DYNAMIC_SESSIONS.discovery.md`). If the resolved capabilities do not include `write: true`, the delete must be blocked with `422 CONNECTOR_INSTANCE_WRITE_DISABLED`. The same rationale from Rule 6 applies — deleting an entity from a non-writable connector would be undone on next sync or cause data divergence.

**Cross-entity reference check:** Before deleting a connector entity, query `field_mappings` for any non-deleted rows from *other* entities where `refEntityKey` matches the target entity's key. These are reference-type field mappings on other entities that point to this entity as a relationship target. If any exist, reject the delete with a `422`:

```
DELETE /api/connector-entities/:id

→ 422 ENTITY_HAS_EXTERNAL_REFERENCES
{
  "message": "Cannot delete entity — 2 field mappings from other entities reference it.",
  "code": "ENTITY_HAS_EXTERNAL_REFERENCES",
  "dependencies": {
    "refFieldMappings": [
      { "id": "fm_5", "connectorEntityId": "ce_3", "sourceField": "company_ref" },
      { "id": "fm_8", "connectorEntityId": "ce_7", "sourceField": "parent_org" }
    ]
  }
}
```

**User workflow:** To delete the entity, the user must first delete or reassign the field mappings on other entities that reference it. This mirrors the approach from Rule 1 (column definitions with dependent field mappings).

**Entity deletion cascade (once checks pass):**
```
connector_entity (soft-delete)
 ├── entity_records (soft-delete all)
 ├── field_mappings (soft-delete all)
 ├── entity_tag_assignments (soft-delete all)
 └── entity_group_members (soft-delete all)
```

**Entity group deletion cascade:**
```
entity_group (soft-delete)
 └── entity_group_members (soft-delete all)
```

**Entity group member deletion:** Direct soft-delete, no cascade needed.

---

## Pre-Flight Impact Endpoints

Following the pattern from `DELETE_CONNECTORS.feature.md`, each deletable object should expose an impact check endpoint:

### `GET /api/column-definitions/:id/impact`

```typescript
interface ColumnDefinitionImpact {
  fieldMappings: number;       // field_mappings where columnDefinitionId = id
  refFieldMappings: number;    // field_mappings where refColumnDefinitionId = id
  entityRecords: number;       // entity_records across all entities that have a field mapping to this column
}
```

This powers a delete dialog that explains why deletion is blocked (if `fieldMappings + refFieldMappings > 0`) or shows the data impact if deletion is allowed.

### `GET /api/field-mappings/:id/impact`

```typescript
interface FieldMappingImpact {
  entityGroupMembers: number;  // entity_group_members where linkFieldMappingId = id
}
```

### `GET /api/connector-entities/:id/impact`

```typescript
interface ConnectorEntityImpact {
  entityRecords: number;
  fieldMappings: number;
  entityTagAssignments: number;
  entityGroupMembers: number;
  refFieldMappings: number;    // field_mappings from OTHER entities where refEntityKey = this entity's key
}
```

### `GET /api/entity-groups/:id/impact`

```typescript
interface EntityGroupImpact {
  entityGroupMembers: number;
}
```

---

## API Error Codes

| Code | Trigger |
|------|---------|
| `COLUMN_DEFINITION_HAS_DEPENDENCIES` | Delete blocked — field mappings reference this column |
| `COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED` | Type transition not in allowlist |
| `COLUMN_DEFINITION_KEY_IMMUTABLE` | PATCH body includes `key` field |
| `FIELD_MAPPING_DELETE_FAILED` | Transaction error during field mapping deletion |
| `ENTITY_HAS_EXTERNAL_REFERENCES` | Delete blocked — field mappings from other entities reference this entity via `refEntityKey` |
| `ENTITY_DELETE_FAILED` | Transaction error during entity cascade delete |
| `ENTITY_GROUP_DELETE_FAILED` | Transaction error during entity group cascade delete |
| `CONNECTOR_INSTANCE_WRITE_DISABLED` | Mutation blocked — connector instance does not have `write` capability enabled (resolved via `enabledCapabilityFlags` against definition ceiling) |
| `ENTITY_RECORD_DELETE_FAILED` | Transaction error during entity record deletion |
| `ENTITY_GROUP_MEMBER_DELETE_FAILED` | Transaction error during group member deletion |

---

## Summary of Guardrails

| Mutation | Guardrail | Enforcement |
|----------|-----------|-------------|
| Delete column definition | Block if any field mappings reference it (via `columnDefinitionId` or `refColumnDefinitionId`) | API 422 |
| Rename column key | `key` is immutable after creation | API 422 |
| Change column type | Only compatible type transitions allowed | API 422 with allowlist |
| Remove enum values | Allowed with warning — stale values persist in records | API 200 + warnings |
| Delete field mapping | Cascade soft-delete to entity group members using it as link field | API transaction |
| Delete entity | Block if connector instance lacks `write` capability or if field mappings from other entities reference it via `refEntityKey`; cascade soft-delete to records, field mappings, tag assignments, group members | API 422 or transaction |
| Delete entity group | Cascade soft-delete to group members | API transaction |
| Delete entity group member | Direct soft-delete | No cascade needed |
| Delete entity record | Block if connector instance lacks `write` capability | API 422; otherwise direct soft-delete |
| Update entity record | Direct update to `data` and/or `normalizedData` | Standard validation |

---

## Why Option A (Strict Guardrails)

The alternative approaches considered and rejected:

**Option B — Cascading deletes with automatic cleanup:** When a column definition is deleted, automatically delete all referencing field mappings, rewrite `normalizedData` JSONB to remove the key, and cascade further to entity group members. Rejected because:
- Rewriting JSONB across potentially thousands of entity records is expensive and error-prone
- Silent data loss (field mappings disappearing) violates the principle of least surprise
- If a sync runs mid-cascade, it may re-create the field mapping, causing a race condition

**Option C — Soft references with graceful degradation:** Allow deletion and let the system gracefully handle dangling references (skip missing columns in queries, show "unknown column" in UI). Rejected because:
- Accumulates technical debt — orphaned references are hard to audit and clean up
- Query behavior becomes unpredictable when column metadata is missing
- Type-aware sorting and filtering breaks silently rather than loudly

**Option A is preferred** because it makes the dependency graph explicit to the user, prevents data corruption, and keeps the system in a consistently valid state. The trade-off is that users must manually resolve dependencies before destructive operations — but the pre-flight impact endpoints and UI dialogs make this workflow straightforward.
