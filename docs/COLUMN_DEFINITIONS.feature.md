# Column Definitions Architecture

## Overview

Column definitions provide a **shared, organization-level catalog** of normalized fields (e.g. "Name", "Email", "Phone") that any connector instance can map its source data into. This decouples the internal data model from connector-specific field names and enables reuse across connectors and entities.

## Core Concepts

| Concept | Scope | Storage | Purpose |
|---------|-------|---------|---------|
| **ColumnDefinition** | Organization | `column_definitions` table | Shared field catalog — defines key, label, type, constraints |
| **ConnectorEntity** | Connector Instance | `connector_entities` table | A distinct data object exposed by a connector (e.g. "Contacts", "Deals") |
| **FieldMapping** | Connector Entity | `field_mappings` table | Maps a source field name to a column definition for a given entity |

## Relationship Diagram

```
organizations
  │
  ├──► column_definitions        (org-level shared catalog)
  │      id, organization_id, key, label, type, required,
  │      default_value, format, enum_values, description,
  │      ref_column_definition_id, ref_entity_key
  │
  └──► connector_instances
         │
         └──► connector_entities         (what the connector exposes)
                │  id, connector_instance_id, key, label
                │
                └──► field_mappings              (per-entity source→column binding)
                       id, connector_entity_id, column_definition_id,
                       source_field, is_primary_key
```

## Schema Designs

### ColumnDefinition (Zod — `packages/core`)

```ts
export const ColumnDataType = z.enum([
  "string", "number", "boolean", "date", "datetime",
  "enum", "json", "array", "reference", "currency",
]);

export const ColumnDefinitionSchema = CoreSchema.extend({
  organizationId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: ColumnDataType,
  required: z.boolean().default(false),
  defaultValue: z.string().nullable(),
  format: z.string().nullable(),
  enumValues: z.array(z.string()).optional(),
  description: z.string().optional(),

  // Reference fields (when type is "reference")
  refColumnDefinitionId: z.string().optional(), // FK → column_definitions.id (the target column)
  refEntityKey: z.string().optional(),          // advisory — target entity key for UI display
});
```

### ConnectorEntity (Zod — `packages/core`)

```ts
export const ConnectorEntitySchema = CoreSchema.extend({
  connectorInstanceId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
});
```

### FieldMapping (Zod — `packages/core`)

```ts
export const FieldMappingSchema = CoreSchema.extend({
  connectorEntityId: z.string(),
  columnDefinitionId: z.string(),
  sourceField: z.string(),
  isPrimaryKey: z.boolean().default(false),
});
```

### Drizzle Tables (`apps/api`)

All three tables use `baseColumns` for audit fields (id, created, createdBy, updated, deleted, etc.) and enforce foreign keys:

- `column_definitions.organization_id` → `organizations.id`
- `column_definitions.ref_column_definition_id` → `column_definitions.id` (self-referencing, nullable)
- `connector_entities.connector_instance_id` → `connector_instances.id`
- `field_mappings.connector_entity_id` → `connector_entities.id`
- `field_mappings.column_definition_id` → `column_definitions.id`

Unique constraints:
- `column_definitions`: unique on `(organization_id, key)`
- `connector_entities`: unique on `(connector_instance_id, key)`
- `field_mappings`: unique on `(connector_entity_id, column_definition_id)`

## Example: CRM Connector

```json
// column_definitions (org-level, shared)
[
  { "key": "id",            "label": "ID",            "type": "string" },
  { "key": "name",          "label": "Name",          "type": "string", "required": true },
  { "key": "email",         "label": "Email",         "type": "string", "required": true, "format": "email" },
  { "key": "phone",         "label": "Phone",         "type": "string", "format": "E.164" },
  { "key": "account_owner", "label": "Account Owner", "type": "reference",
    "refColumnDefinitionId": "<id-column-def-uuid>", "refEntityKey": "users" }
]

// connector_entities (on a CRM connector instance)
[
  { "key": "accounts", "label": "Accounts" },
  { "key": "users",    "label": "Users" }
]

// field_mappings (accounts entity)
[
  { "columnKey": "name",          "sourceField": "account_name" },
  { "columnKey": "account_owner", "sourceField": "owner_id" }
]

// field_mappings (users entity)
[
  { "columnKey": "id",    "sourceField": "user_id", "isPrimaryKey": true },
  { "columnKey": "name",  "sourceField": "display_name" },
  { "columnKey": "email", "sourceField": "email_address" }
]
```

In this example, `account_owner` is a reference column pointing to the `id` column definition. The `refEntityKey: "users"` is advisory — it tells the UI that "Account Owner" resolves to a record in the "users" entity. The actual FK (`refColumnDefinitionId`) points to the shared `id` column definition, so any entity that maps an `id` primary key can be the target.

## Example: CSV Upload

```json
// connector_entities (single entity)
[
  { "key": "records", "label": "Records" }
]

// field_mappings
[
  { "columnKey": "name",  "sourceField": "Name" },
  { "columnKey": "email", "sourceField": "Email Address" }
]
```

CSV parse options (delimiter, encoding, etc.) remain in `connector_instances.config` jsonb since they are connector-specific settings, not structural field mappings.

## Design Decisions

### Why separate tables over inline jsonb

1. **Cross-connector queries** — "which connectors map to column `email`?" is a simple join, not a jsonb traversal.
2. **Referential integrity** — FKs prevent mappings from referencing deleted columns or entities.
3. **Granular audit** — each mapping has its own `created/updated/deleted` timestamps and user attribution.
4. **Concurrent edits** — row-level locks prevent last-write-wins conflicts on the whole config blob.
5. **Schema evolution** — adding fields to mappings is a standard migration, not an app-level jsonb backfill.

### Why reference metadata lives on ColumnDefinition, not FieldMapping

References are a property of *what the data means*, not *where it comes from*. "Account Owner" is conceptually a reference to a User regardless of which connector provides it. Placing `refColumnDefinitionId` and `refEntityKey` on the column definition means:

- The relationship is defined once and shared across all connectors that map to it.
- Cross-entity joins and lookups can be resolved from column definitions alone, without scanning field mappings.
- `refEntityKey` is advisory (for UI display) — the FK to `column_definitions.id` is the source of truth.

### Why shared column definitions at org level

- Columns like "Name" and "Email" are universal concepts — defining them once avoids drift.
- Enables cross-connector reporting and deduplication.
- Column metadata (type, format, constraints) stays consistent regardless of source.

---

## Implementation Checklist

### 1. Zod Models (`packages/core/src/models/`) ✅

- [x] Create `column-definition.model.ts` — `ColumnDefinitionSchema`, `ColumnDefinitionModel`, `ColumnDefinitionModelFactory`
- [x] Create `connector-entity.model.ts` — `ConnectorEntitySchema`, `ConnectorEntityModel`, `ConnectorEntityModelFactory`
- [x] Create `field-mapping.model.ts` — `FieldMappingSchema`, `FieldMappingModel`, `FieldMappingModelFactory`
- [x] Export all three from `packages/core/src/models/index.ts`
- [x] Write unit tests for each model:
  - Schema validation (valid data passes, invalid data rejected)
  - `ColumnDataType` enum coverage (all types accepted, unknown types rejected)
  - Reference field validation (`refColumnDefinitionId` and `refEntityKey` required when `type: "reference"`, optional otherwise)
  - `key` regex enforcement (rejects uppercase, spaces, leading digits)
  - Factory `create()` produces valid models with audit fields

### 2. Drizzle Tables (`apps/api/src/db/schema/`) ✅

- [x] Create `column-definitions.table.ts` — with FK to `organizations`, self-referencing FK for `ref_column_definition_id`, unique on `(organization_id, key)`
- [x] Create `connector-entities.table.ts` — with FK to `connector_instances`, unique on `(connector_instance_id, key)`
- [x] Create `field-mappings.table.ts` — with FKs to `connector_entities` and `column_definitions`, unique on `(connector_entity_id, column_definition_id)`
- [x] Update `zod.ts` — add `createSelectSchema` / `createInsertSchema` for all three tables
- [x] Update `type-checks.ts` — add bidirectional `IsAssignable` checks for all three tables
- [x] Export tables from schema index (no schema index file exists — tables are imported directly)

### 3. Migrations ✅

- [x] Run `npm run db:generate` to generate migration SQL
- [x] Run `npm run db:migrate` to apply
- [x] Verify migration is reversible (`db:rollback` or manual down script)

### 4. Repositories (`apps/api/src/db/repositories/`) ✅

- [x] Create `column-definitions.repository.ts` — `findByOrganizationId`, `findByKey(orgId, key)`, `upsertByKey`
- [x] Create `connector-entities.repository.ts` — `findByConnectorInstanceId`, `findByKey(instanceId, key)`
- [x] Create `field-mappings.repository.ts` — `findByConnectorEntityId`, `findByColumnDefinitionId`, `upsertByEntityAndColumn`
- [x] Export from repository index
- [x] Write integration tests for each repository:
  - CRUD lifecycle (create → read → update → soft delete)
  - Unique constraint enforcement (duplicate `org_id + key` rejected)
  - FK constraint enforcement (invalid `organization_id`, `connector_instance_id`, `column_definition_id` rejected)
  - Self-referencing FK on column definitions (reference column points to valid column def)
  - Soft-delete filtering (deleted rows excluded from reads)
  - `findByOrganizationId` / `findByConnectorInstanceId` / `findByConnectorEntityId` return correct scoped results
  - `upsertByKey` / `upsertByEntityAndColumn` insert on first call, update on second
  - `findByColumnDefinitionId` returns all field mappings across entities for a given column

### 5. API Contracts (`packages/core/src/contracts/`) ✅

- [x] Create `column-definition.contract.ts` — list/create/update request/response schemas
- [x] Create `connector-entity.contract.ts` — list/create request/response schemas
- [x] Create `field-mapping.contract.ts` — list/create/update request/response schemas
- [x] Write unit tests for each contract:
  - Request schema validation (required fields, pagination defaults, sort options)
  - Response schema shape matches expected structure

### 6. API Routes (`apps/api/src/routes/`) ✅

- [x] Create `column-definition.router.ts` — CRUD endpoints scoped to organization
- [x] Create `connector-entity.router.ts` — CRUD endpoints scoped to connector instance
- [x] Create `field-mapping.router.ts` — CRUD endpoints scoped to connector entity
- [x] Register routes in main router
- [x] Add error codes to `ApiCode` enum
- [x] Write integration tests for each router:
  - Happy path for each endpoint (list, get, create, update, delete)
  - 404 for missing resources
  - 400/422 for invalid request bodies
  - Scoping enforcement (can't access org A's column definitions from org B)
  - Reference integrity in responses (creating a field mapping with invalid `columnDefinitionId` returns error)
  - Pagination and sorting on list endpoints

### 7. Deprecation

- [x] Evaluate deprecating `CSVColumnSchema` in favor of `ColumnDefinitionSchema` + `FieldMappingSchema`
- [x] Migrate any existing CSV column references to the new structure
- [x] Update or remove tests referencing deprecated schemas

### 8. Verification

- [x] Run `npm run type-check` — confirm all bidirectional type assertions pass
- [x] Run `npm run test` — confirm all existing and new tests pass
- [x] Run `npm run lint` — confirm no lint errors introduced (4 pre-existing errors in `apps/web` unrelated to column definitions)
- [x] Run `npm run build` — confirm monorepo builds cleanly
