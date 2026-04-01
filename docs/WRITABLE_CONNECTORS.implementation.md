# Writable Connectors — Implementation Plan

Based on [WRITABLE_CONNECTORS.discovery.md](./WRITABLE_CONNECTORS.discovery.md).

Permission model follows [DYNAMIC_SESSIONS.discovery.md](./DYNAMIC_SESSIONS.discovery.md): connector definitions declare a `capabilityFlags` ceiling (`sync`, `query`, `write`), and each connector instance narrows those via `enabledCapabilityFlags`. The `resolveCapabilities()` function merges both to determine effective permissions. Write mutations in this feature check `resolveCapabilities(definition, instance).write` before proceeding.

---

## Phase 0: Schema & Permission Foundation

Adds instance-level capability overrides and new API error codes. Everything downstream depends on this.

### Checklist

- [x] **0.1** Add `enabledCapabilityFlags` JSONB column to `connector_instances` table
  - File: `apps/api/src/db/schema/connector-instances.table.ts`
  - Add `enabledCapabilityFlags: jsonb("enabled_capability_flags").$type<EnabledCapabilityFlags>()`
  - Nullable — `null` means the instance inherits all definition capabilities (backwards compatible)
- [x] **0.2** Define the `EnabledCapabilityFlags` interface
  - File: `apps/api/src/db/schema/connector-instances.table.ts` or a shared types file
  - `{ read?: boolean; write?: boolean }`
- [x] **0.3** Update `ConnectorInstanceSchema` Zod model
  - File: `packages/core/src/models/connector-instance.model.ts`
  - Add `enabledCapabilityFlags: z.object({ read: z.boolean().optional(), write: z.boolean().optional() }).nullable()`
- [x] **0.4** Update drizzle-zod schemas in `apps/api/src/db/schema/zod.ts`
  - Regenerate `createSelectSchema` / `createInsertSchema` for connector instances
- [x] **0.5** Update type guards in `apps/api/src/db/schema/type-checks.ts`
  - Add bidirectional `IsAssignable` checks for the updated connector instance types
- [x] **0.6** Generate and apply migration
  - Run `npm run db:generate` then `npm run db:migrate` from `apps/api/`
- [x] **0.7** Implement `resolveCapabilities()` utility
  - File: `apps/api/src/utils/resolve-capabilities.util.ts` (new)
  - Accepts a `ConnectorDefinition` and `ConnectorInstance`, returns `{ read: boolean; write: boolean }`
  - Logic: definition's `capabilityFlags` is the ceiling; instance's `enabledCapabilityFlags` narrows it
  - If `enabledCapabilityFlags` is `null`, inherit all definition capabilities
  - If the definition doesn't support `write`, the instance can never enable it
- [x] **0.8** Implement `assertWriteCapability()` helper
  - File: `apps/api/src/utils/resolve-capabilities.util.ts`
  - Accepts a connector entity ID, resolves to connector instance + definition, calls `resolveCapabilities()`
  - If `write` is `false`, throws `ApiError` with `422 CONNECTOR_INSTANCE_WRITE_DISABLED`
  - Reusable across all write-guarded endpoints (entity delete, record delete, record update, etc.)
- [x] **0.9** Add new API error codes to `ApiCode` enum
  - File: `apps/api/src/constants/api-codes.constants.ts`
  - Add: `COLUMN_DEFINITION_HAS_DEPENDENCIES`, `COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED`, `COLUMN_DEFINITION_KEY_IMMUTABLE`, `CONNECTOR_INSTANCE_WRITE_DISABLED`, `ENTITY_HAS_EXTERNAL_REFERENCES`, `ENTITY_RECORD_DELETE_FAILED`, `ENTITY_GROUP_MEMBER_DELETE_FAILED`
  - Skip codes that already exist in the enum
- [x] **0.10** Define the column definition type transition allowlist as a constant
  - File: `apps/api/src/constants/column-definition-transitions.constants.ts` (new)
  - Export `ALLOWED_TYPE_TRANSITIONS: Record<string, string[]>` per the discovery doc table

### Tests

- [x] **0.T1** Unit test: `resolveCapabilities()` — definition with `write: true`, instance `null` → `{ read: true, write: true }`
- [x] **0.T2** Unit test: `resolveCapabilities()` — definition with `write: true`, instance `{ write: false }` → `{ read: true, write: false }`
- [x] **0.T3** Unit test: `resolveCapabilities()` — definition with `write: false`, instance `{ write: true }` → `{ read: true, write: false }` (cannot exceed ceiling)
- [x] **0.T4** Unit test: `resolveCapabilities()` — definition with `query: false`, instance `null` → `{ read: false, write: false }`

### Verification

- [x] `npm run db:generate && npm run db:migrate` succeeds from `apps/api/`
- [x] `npm run type-check` passes (confirms Zod <> Drizzle alignment)
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes

---

## Phase 1: Column Definition Guardrails (API)

Implements Rules 1-4 from the discovery doc: dependency-blocked delete, immutable `key`, restricted type changes, and enum value warnings.

### Checklist

- [x] **1.1** Add `findByColumnDefinitionId` and `findByRefColumnDefinitionId` methods to field mappings repository (if not already present)
  - File: `apps/api/src/db/repositories/field-mappings.repository.ts`
  - These query non-deleted field mappings referencing a given column definition via `columnDefinitionId` or `refColumnDefinitionId`
- [x] **1.2** Implement Rule 1 — block `DELETE /api/column-definitions/:id` when field mappings reference it
  - File: `apps/api/src/routes/column-definition.router.ts`
  - Before soft-deleting, query field mappings by `columnDefinitionId` and `refColumnDefinitionId`
  - If any exist, return `422 COLUMN_DEFINITION_HAS_DEPENDENCIES` with dependency list
  - If none, proceed with `softDelete`
- [x] **1.3** Implement Rule 2 — reject `key` in `PATCH /api/column-definitions/:id`
  - File: `apps/api/src/routes/column-definition.router.ts`
  - If request body contains `key`, return `422 COLUMN_DEFINITION_KEY_IMMUTABLE`
- [x] **1.4** Implement Rule 3 — validate type transitions in `PATCH /api/column-definitions/:id`
  - File: `apps/api/src/routes/column-definition.router.ts`
  - If request body contains `type`, check current type -> requested type against `ALLOWED_TYPE_TRANSITIONS`
  - Block all transitions to/from `reference` and `reference-array`
  - If blocked, return `422 COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED`
- [x] **1.5** Implement Rule 4 — warn on enum value removal in `PATCH /api/column-definitions/:id`
  - File: `apps/api/src/routes/column-definition.router.ts`
  - If `enumValues` is in request body for an `enum`-type column, compare old vs new arrays
  - If values were removed, include `warnings` array in response body
- [x] **1.6** Implement `GET /api/column-definitions/:id/impact` endpoint
  - File: `apps/api/src/routes/column-definition.router.ts`
  - Return `{ fieldMappings, refFieldMappings, entityRecords }` counts
  - Follow the existing pattern from `GET /api/connector-instances/:id/impact`
- [x] **1.7** Add/update `@openapi` JSDoc annotations for all new and modified endpoints
  - `DELETE /api/column-definitions/:id` — document 200, 404, and 422 (`COLUMN_DEFINITION_HAS_DEPENDENCIES`) responses
  - `PATCH /api/column-definitions/:id` — document 422 codes (`COLUMN_DEFINITION_KEY_IMMUTABLE`, `COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED`), `warnings` array in 200 response
  - `GET /api/column-definitions/:id/impact` — document response schema with `fieldMappings`, `refFieldMappings`, `entityRecords` counts
  - Follow the existing `@openapi` JSDoc pattern in `apps/api/src/routes/*.ts` (parsed by `swagger-jsdoc`)

### Tests

- [x] **1.T1** Integration test: `DELETE /api/column-definitions/:id` returns 422 when field mappings reference it via `columnDefinitionId`
- [x] **1.T2** Integration test: `DELETE /api/column-definitions/:id` returns 422 when field mappings reference it via `refColumnDefinitionId`
- [x] **1.T3** Integration test: `DELETE /api/column-definitions/:id` succeeds when no field mappings reference it
- [x] **1.T4** Integration test: `DELETE /api/column-definitions/:id` returns 404 for non-existent column
- [x] **1.T5** Integration test: `DELETE /api/column-definitions/:id` returns 404 for already-deleted column
- [x] **1.T6** Integration test: `PATCH /api/column-definitions/:id` with `key` in body returns 422 `COLUMN_DEFINITION_KEY_IMMUTABLE`
- [x] **1.T7** Integration test: `PATCH /api/column-definitions/:id` with allowed type transition succeeds (e.g., `string` -> `enum`)
- [x] **1.T8** Integration test: `PATCH /api/column-definitions/:id` with blocked type transition returns 422 (e.g., `string` -> `boolean`)
- [x] **1.T9** Integration test: `PATCH /api/column-definitions/:id` with transition to/from `reference` returns 422
- [x] **1.T10** Integration test: `PATCH /api/column-definitions/:id` removing enum values returns 200 with `warnings` array
- [x] **1.T11** Integration test: `PATCH /api/column-definitions/:id` adding enum values returns 200 without warnings
- [x] **1.T12** Integration test: `GET /api/column-definitions/:id/impact` returns correct counts
- [x] **1.T13** Integration test: `GET /api/column-definitions/:id/impact` returns 404 for non-existent column

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green

---

## Phase 2: Field Mapping & Entity Group Member Delete (API)

Implements Rule 5 (field mapping delete cascades to entity group members) and entity group member direct delete.

### Checklist

- [x] **2.1** Add `findByLinkFieldMappingId` method to entity group members repository
  - File: `apps/api/src/db/repositories/entity-group-members.repository.ts`
  - Returns non-deleted entity group members whose `linkFieldMappingId` matches a given field mapping ID
- [x] **2.2** Implement Rule 5 — cascade `DELETE /api/field-mappings/:id` to entity group members
  - File: `apps/api/src/routes/field-mapping.router.ts`
  - Wrap in a transaction: soft-delete the field mapping, then soft-delete any entity group members where `linkFieldMappingId` matches
  - Return `{ id, cascaded: { entityGroupMembers: <count> } }`
- [x] **2.3** Implement `GET /api/field-mappings/:id/impact` endpoint
  - File: `apps/api/src/routes/field-mapping.router.ts`
  - Return `{ entityGroupMembers }` count
- [x] **2.4** Verify entity group member `DELETE /api/entity-groups/:groupId/members/:memberId` works as direct soft-delete
  - File: `apps/api/src/routes/entity-group-member.router.ts`
  - This endpoint already exists — confirm it uses soft-delete and returns the deleted member
- [x] **2.5** Add/update `@openapi` JSDoc annotations for all new and modified endpoints
  - `DELETE /api/field-mappings/:id` — document 200 response with `cascaded.entityGroupMembers` count, and 404 response
  - `GET /api/field-mappings/:id/impact` — document response schema with `entityGroupMembers` count
  - Follow the existing `@openapi` JSDoc pattern in `apps/api/src/routes/*.ts`

### Tests

- [x] **2.T1** Integration test: `DELETE /api/field-mappings/:id` soft-deletes the field mapping and cascades to entity group members using it as `linkFieldMappingId`
- [x] **2.T2** Integration test: `DELETE /api/field-mappings/:id` returns correct `cascaded.entityGroupMembers` count
- [x] **2.T3** Integration test: `DELETE /api/field-mappings/:id` with no dependent group members succeeds with `cascaded.entityGroupMembers: 0`
- [x] **2.T4** Integration test: `DELETE /api/field-mappings/:id` returns 404 for non-existent mapping
- [x] **2.T5** Integration test: `GET /api/field-mappings/:id/impact` returns correct `entityGroupMembers` count
- [x] **2.T6** Integration test: `DELETE /api/entity-groups/:groupId/members/:memberId` soft-deletes the member
- [x] **2.T7** Integration test: deleted field mapping no longer appears in `GET /api/field-mappings` list

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green

---

## Phase 3: Entity Record Delete with Write Capability Check (API)

Implements Rule 6: entity record deletion guarded by the connector instance's resolved `write` capability.

### Checklist

- [x] **3.1** Implement `DELETE /api/connector-entities/:connectorEntityId/records/:id` endpoint
  - File: `apps/api/src/routes/entity-record.router.ts`
  - Call `assertWriteCapability(connectorEntityId)` — resolves entity -> instance -> definition, checks `resolveCapabilities().write`
  - If `write` is `false`, returns `422 CONNECTOR_INSTANCE_WRITE_DISABLED`
  - If writable, soft-delete the record
- [x] **3.2** Update existing `DELETE /api/connector-entities/:connectorEntityId/records` (bulk clear) with write capability check
  - File: `apps/api/src/routes/entity-record.router.ts`
  - Add the same `assertWriteCapability()` guard before bulk soft-delete
- [x] **3.3** Add/update `@openapi` JSDoc annotations for all new and modified endpoints
  - `DELETE .../records/:id` — document 200, 404, and 422 (`CONNECTOR_INSTANCE_WRITE_DISABLED`) responses
  - `DELETE .../records` (bulk) — update existing annotation to include 422 (`CONNECTOR_INSTANCE_WRITE_DISABLED`) response
  - Follow the existing `@openapi` JSDoc pattern in `apps/api/src/routes/*.ts`

### Tests

- [x] **3.T1** Integration test: `DELETE .../records/:id` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when instance has `write` disabled
- [x] **3.T2** Integration test: `DELETE .../records/:id` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when definition doesn't support `write` (even if instance tries to enable it)
- [x] **3.T3** Integration test: `DELETE .../records/:id` soft-deletes record when `write` capability is resolved to `true`
- [x] **3.T4** Integration test: `DELETE .../records/:id` returns 404 for non-existent record
- [x] **3.T5** Integration test: bulk `DELETE .../records` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when `write` is disabled
- [x] **3.T6** Integration test: bulk `DELETE .../records` succeeds when `write` capability is enabled
- [x] **3.T7** Integration test: deleted record no longer appears in `GET .../records` list
- [x] **3.T8** Integration test: `DELETE .../records/:id` succeeds when `enabledCapabilityFlags` is `null` (inherits definition's `write: true`)

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green

---

## Phase 4: Entity & Entity Group Delete with Guards (API)

Implements Rule 7: entity deletion with write capability check, cross-entity reference check, and cascade; entity group deletion with cascade.

### Checklist

- [x] **4.1** Add `findByRefEntityKey` method to field mappings repository
  - File: `apps/api/src/db/repositories/field-mappings.repository.ts`
  - Returns non-deleted field mappings from *other* entities where `refEntityKey` matches a given entity key
  - Must exclude field mappings belonging to the entity being deleted (same `connectorEntityId`)
- [x] **4.2** Add `countByRefEntityKey` method to field mappings repository
  - For the impact endpoint — count of external reference field mappings
- [x] **4.3** Implement `DELETE /api/connector-entities/:id` endpoint
  - File: `apps/api/src/routes/connector-entity.router.ts`
  - **Check 1:** Call `assertWriteCapability(connectorEntityId)` — if `write` is `false`, return `422 CONNECTOR_INSTANCE_WRITE_DISABLED`
  - **Check 2:** Query field mappings where `refEntityKey` matches this entity's key (excluding self); if any exist, return `422 ENTITY_HAS_EXTERNAL_REFERENCES` with dependency list
  - **Cascade (in transaction):** soft-delete entity records, field mappings, entity tag assignments, entity group members, then the entity itself
  - Follow the existing pattern from `DELETE /api/connector-instances/:id`
- [x] **4.4** Implement `GET /api/connector-entities/:id/impact` endpoint
  - File: `apps/api/src/routes/connector-entity.router.ts`
  - Return `{ entityRecords, fieldMappings, entityTagAssignments, entityGroupMembers, refFieldMappings }`
- [x] **4.5** Implement `DELETE /api/entity-groups/:id` cascade (if not already cascading)
  - File: `apps/api/src/routes/entity-group.router.ts`
  - Wrap in transaction: soft-delete all entity group members, then soft-delete the group
- [x] **4.6** Implement `GET /api/entity-groups/:id/impact` endpoint
  - File: `apps/api/src/routes/entity-group.router.ts`
  - Return `{ entityGroupMembers }` count
- [x] **4.7** Add/update `@openapi` JSDoc annotations for all new and modified endpoints
  - `DELETE /api/connector-entities/:id` — document 200 with cascade counts, 404, 422 (`CONNECTOR_INSTANCE_WRITE_DISABLED`, `ENTITY_HAS_EXTERNAL_REFERENCES`) responses
  - `GET /api/connector-entities/:id/impact` — document response schema with all count fields
  - `DELETE /api/entity-groups/:id` — document 200 with cascade counts, 404 responses
  - `GET /api/entity-groups/:id/impact` — document response schema with `entityGroupMembers` count
  - Follow the existing `@openapi` JSDoc pattern in `apps/api/src/routes/*.ts`

### Tests

- [x] **4.T1** Integration test: `DELETE /api/connector-entities/:id` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when instance lacks write capability
- [x] **4.T2** Integration test: `DELETE /api/connector-entities/:id` returns 422 `ENTITY_HAS_EXTERNAL_REFERENCES` when other entities' field mappings reference it via `refEntityKey`
- [x] **4.T3** Integration test: `DELETE /api/connector-entities/:id` succeeds and cascades soft-delete to records, field mappings, tag assignments, and group members
- [x] **4.T4** Integration test: verify each cascaded child table has `deleted` timestamp set (query with `includeDeleted`)
- [x] **4.T5** Integration test: `DELETE /api/connector-entities/:id` returns 404 for non-existent entity
- [x] **4.T6** Integration test: deleted entity no longer appears in `GET /api/connector-entities` list
- [x] **4.T7** Integration test: `GET /api/connector-entities/:id/impact` returns correct counts including `refFieldMappings`
- [x] **4.T8** Integration test: `DELETE /api/entity-groups/:id` cascades soft-delete to all group members
- [x] **4.T9** Integration test: `GET /api/entity-groups/:id/impact` returns correct `entityGroupMembers` count
- [x] **4.T10** Integration test: `DELETE /api/entity-groups/:id` returns 404 for non-existent group

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green

---

## Phase 5: Entity Record & Entity Update (API)

Implements update endpoints for entity records and entities, guarded by write capability.

### Checklist

- [x] **5.1** Implement `PATCH /api/connector-entities/:connectorEntityId/records/:id` endpoint
  - File: `apps/api/src/routes/entity-record.router.ts`
  - Call `assertWriteCapability(connectorEntityId)`; if `write` is `false`, return `422 CONNECTOR_INSTANCE_WRITE_DISABLED`
  - Accept updates to `data` and/or `normalizedData` fields
  - Validate payload structure before updating
- [x] **5.2** Implement `PATCH /api/connector-entities/:id` endpoint
  - File: `apps/api/src/routes/connector-entity.router.ts`
  - Call `assertWriteCapability(id)`; if `write` is `false`, return `422 CONNECTOR_INSTANCE_WRITE_DISABLED`
  - Accept updates to mutable entity fields (e.g., `label`, `description`)
- [x] **5.3** Add/update `@openapi` JSDoc annotations for all new and modified endpoints
  - `PATCH .../records/:id` — document request body, 200, 404, and 422 (`CONNECTOR_INSTANCE_WRITE_DISABLED`) responses
  - `PATCH /api/connector-entities/:id` — document request body, 200, 404, and 422 (`CONNECTOR_INSTANCE_WRITE_DISABLED`) responses
  - Follow the existing `@openapi` JSDoc pattern in `apps/api/src/routes/*.ts`

### Tests

- [x] **5.T1** Integration test: `PATCH .../records/:id` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when write is disabled
- [x] **5.T2** Integration test: `PATCH .../records/:id` updates record when write is enabled
- [x] **5.T3** Integration test: `PATCH .../records/:id` returns 404 for non-existent record
- [x] **5.T4** Integration test: `PATCH /api/connector-entities/:id` returns 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` when write is disabled
- [x] **5.T5** Integration test: `PATCH /api/connector-entities/:id` updates entity when write is enabled
- [x] **5.T6** Integration test: `PATCH /api/connector-entities/:id` returns 404 for non-existent entity

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green

---

## Phase 6: Frontend — Delete Dialogs & Impact Checks

Adds delete UI for all entities with impact pre-flight checks where applicable.

### Checklist

- [x] **6.1** Add query key entries for new impact endpoints
  - File: `apps/web/src/api/keys.ts`
  - Add `impact()` keys under `columnDefinitions`, `connectorEntities`, `fieldMappings`, `entityGroups`
- [x] **6.2** Add API client functions for new endpoints
  - Files: `apps/web/src/api/column-definitions.api.ts`, `connector-entities.api.ts`, `field-mappings.api.ts`, `entity-groups.api.ts`, `entity-records.api.ts`
  - Add `delete`, `impact`, and `update` hooks following existing `sdk` patterns
- [x] **6.3** Create `DeleteColumnDefinitionDialog` component
  - File: `apps/web/src/components/DeleteColumnDefinitionDialog.component.tsx`
  - Shows impact summary (field mappings, ref field mappings, entity records)
  - When `fieldMappings + refFieldMappings > 0`, show blocked state with dependency explanation instead of a confirm button
  - Accept `serverError` prop; render `FormAlert`
- [x] **6.4** Create `DeleteConnectorEntityDialog` component
  - File: `apps/web/src/components/DeleteConnectorEntityDialog.component.tsx`
  - Shows impact summary (records, field mappings, tag assignments, group members, ref field mappings)
  - When `refFieldMappings > 0`, show blocked state with external reference explanation
  - Accept `serverError` prop; render `FormAlert`
- [x] **6.5** Create `DeleteFieldMappingDialog` component
  - File: `apps/web/src/components/DeleteFieldMappingDialog.component.tsx`
  - Shows impact summary (entity group members that will be cascaded)
  - Warn user about cascade before confirming
  - Accept `serverError` prop; render `FormAlert`
- [x] **6.6** Create `DeleteEntityGroupDialog` component (or update existing inline dialog)
  - File: `apps/web/src/components/DeleteEntityGroupDialog.component.tsx`
  - Shows impact summary (group members)
  - Accept `serverError` prop; render `FormAlert`
- [x] **6.7** Create `DeleteEntityRecordDialog` component
  - File: `apps/web/src/components/DeleteEntityRecordDialog.component.tsx`
  - Simple confirmation (no impact — records have no dependents)
  - Accept `serverError` prop; render `FormAlert`
- [x] **6.8** Wire delete dialogs into views
  - `ColumnDefinitionDetail.view.tsx` — add delete button + `DeleteColumnDefinitionDialog`
  - `EntityDetail.view.tsx` — add delete button + `DeleteConnectorEntityDialog`
  - `EntityRecordDetail.view.tsx` — add delete button + `DeleteEntityRecordDialog`
  - `EntityGroupDetail.view.tsx` — replace inline dialog with `DeleteEntityGroupDialog`
  - Field mapping delete — determine appropriate view (entity detail or field mapping list) and wire
- [x] **6.9** Implement mutation `onSuccess` cache invalidation for each delete
  - Column definition delete -> `columnDefinitions.root`
  - Connector entity delete -> `connectorEntities.root`, `entityRecords.root`, `fieldMappings.root`, `entityGroups.root`
  - Field mapping delete -> `fieldMappings.root`, `entityGroups.root`
  - Entity group delete -> `entityGroups.root`
  - Entity record delete -> `entityRecords.root`
  - Entity group member delete -> `entityGroups.root`
- [x] **6.10** Handle `CONNECTOR_INSTANCE_WRITE_DISABLED` in entity and record views
  - When delete/update mutation returns this code, display via `FormAlert`
  - Disable delete/edit buttons in the UI when the resolved capabilities for the parent connector instance do not include `write: true`
  - Resolve capabilities by fetching the connector instance (via `include=connectorInstance`) and its definition

### Tests

- [x] **6.T1** `DeleteColumnDefinitionDialog` — renders title and content when `open={true}`
- [x] **6.T2** `DeleteColumnDefinitionDialog` — does not render when `open={false}`
- [x] **6.T3** `DeleteColumnDefinitionDialog` — shows blocked state when impact has `fieldMappings > 0`
- [x] **6.T4** `DeleteColumnDefinitionDialog` — calls `onConfirm` when no dependencies
- [x] **6.T5** `DeleteColumnDefinitionDialog` — shows loading state when `isPending={true}`
- [x] **6.T6** `DeleteColumnDefinitionDialog` — renders `FormAlert` when `serverError` provided
- [x] **6.T7** `DeleteConnectorEntityDialog` — renders impact summary with counts
- [x] **6.T8** `DeleteConnectorEntityDialog` — shows blocked state when `refFieldMappings > 0`
- [x] **6.T9** `DeleteConnectorEntityDialog` — calls `onConfirm` when no blocking dependencies
- [x] **6.T10** `DeleteConnectorEntityDialog` — renders `FormAlert` when `serverError` provided
- [x] **6.T11** `DeleteFieldMappingDialog` — shows cascade warning with group member count
- [x] **6.T12** `DeleteFieldMappingDialog` — calls `onConfirm` on confirm click
- [x] **6.T13** `DeleteEntityGroupDialog` — shows impact summary with member count
- [x] **6.T14** `DeleteEntityRecordDialog` — simple confirmation renders correctly
- [x] **6.T15** All dialogs — supports Enter key submission (form submit event)
- [x] **6.T16** All dialogs — calls `onClose` on Cancel click
- [x] **6.T17** Verify cache invalidation: spy on `queryClient.invalidateQueries` in mutation `onSuccess` for each delete

### Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes — all new and existing tests green
- [x] `npm run storybook` — each new dialog has a story and renders correctly

---

## Phase 7: Frontend — Update UI for Column Definitions, Entities, and Records

Adds edit/update forms for mutable fields with validation guardrails from the discovery doc.

### Checklist

- [ ] **7.1** Create or update column definition edit form
  - Mutable fields: `label`, `description`, `required`, `defaultValue`, `format`, `enumValues`
  - `key` field rendered as read-only / disabled
  - `type` field restricted to allowed transitions (gray out blocked options)
  - Show warnings inline when enum values are removed (from API response `warnings` array)
  - Validate with Zod schema via `validateWithSchema`
- [x] **7.2** Create or update connector entity edit form
  - Mutable fields as applicable (e.g., `label`, `description`)
  - Disable edit when resolved capabilities do not include `write: true`
- [x] **7.3** Create or update entity record edit form
  - Allow editing `data` and/or `normalizedData`
  - Disable edit when resolved capabilities do not include `write: true`
- [x] **7.4** Create or update field mapping edit form
  - Allow reassigning `columnDefinitionId` (for resolving column definition dependencies before delete)
- [ ] **7.5** Create or update entity group edit form
  - Allow editing group metadata (e.g., `name`, `description`)
- [ ] **7.6** Wire `onSuccess` cache invalidation for each update mutation
  - Follow existing invalidation patterns from Phase 6
- [ ] **7.7** Default `enabledCapabilityFlags` from definition on connector instance creation
  - File: `apps/api/src/routes/upload.router.ts` (confirm handler)
  - When the confirm handler creates the connector instance, set `enabledCapabilityFlags` by copying the definition's `capabilityFlags` (`{ read: query, write, sync }` where `read` is always `true`)
  - This ensures every new instance starts with explicit flags rather than relying on `null` fallback
- [ ] **7.8** Expand connector instance PATCH endpoint to accept `enabledCapabilityFlags`
  - File: `apps/api/src/routes/connector-instance.router.ts`
  - Extend `ConnectorInstancePatchBodySchema` to accept optional `enabledCapabilityFlags`:
    ```
    enabledCapabilityFlags: z.object({
      read: z.boolean().optional(),
      write: z.boolean().optional(),
    }).nullable().optional()
    ```
  - Update the PATCH handler to persist `enabledCapabilityFlags` when provided
  - Validate that the instance cannot enable a flag the definition doesn't support (e.g., reject `write: true` when `definition.capabilityFlags.write` is falsy)
- [ ] **7.9** Add capability flag editing to connector instance detail page
  - File: `apps/web/src/views/ConnectorInstance.view.tsx`
  - Fetch the connector definition to read its `capabilityFlags` ceiling
  - Display a "Permissions" section with three checkboxes:
    - **Read** — always checked, always disabled (read is a baseline requirement)
    - **Write** — editable checkbox; disabled + greyed out when `definition.capabilityFlags.write` is falsy; tooltip on disabled: "This connector type does not support writes"
    - **Sync** — editable checkbox; disabled + greyed out when `definition.capabilityFlags.sync` is falsy; tooltip on disabled: "This connector type does not support sync"
  - Checked state reflects current `instance.enabledCapabilityFlags` values
  - On change, PATCH the connector instance with updated `enabledCapabilityFlags`
  - File: `apps/web/src/api/connector-instances.api.ts`
  - Expand `rename` to a general `update` mutation, or add a separate `updateCapabilities` mutation

### Tests

- [ ] **7.T1** Column definition edit form — `key` field is disabled/read-only
- [ ] **7.T2** Column definition edit form — blocked type transitions are not selectable
- [ ] **7.T3** Column definition edit form — displays warnings when enum values removed
- [ ] **7.T4** Column definition edit form — validates via Zod schema; shows field-level errors
- [ ] **7.T5** Column definition edit form — `aria-invalid` set on invalid fields
- [ ] **7.T6** Entity / record edit forms — disabled when resolved capabilities lack `write`
- [ ] **7.T7** Entity / record edit forms — validates and submits correctly when writable
- [ ] **7.T8** Field mapping edit form — reassigning column definition updates correctly
- [ ] **7.T9** All edit forms — `FormAlert` renders on `serverError`
- [ ] **7.T10** All edit forms — calls `onClose` on Cancel
- [ ] **7.T11** Connector instance detail — read checkbox is always checked and disabled
- [ ] **7.T12** Connector instance detail — write checkbox is disabled when definition `capabilityFlags.write` is falsy
- [ ] **7.T13** Connector instance detail — sync checkbox is disabled when definition `capabilityFlags.sync` is falsy
- [ ] **7.T14** Connector instance detail — toggling write PATCHes `enabledCapabilityFlags`
- [ ] **7.T15** Connector instance creation — `enabledCapabilityFlags` defaults from definition's `capabilityFlags`

### Verification

- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes — all new and existing tests green
- [ ] `npm run storybook` — each new/updated form has a story and renders correctly

---

## Phase 8: End-to-End Validation & Cleanup

Final sweep to confirm everything works together and documentation is up to date.

### Checklist

- [ ] **8.1** Run full test suite from repo root: `npm run test`
- [ ] **8.2** Run full type check: `npm run type-check`
- [ ] **8.3** Run full build: `npm run build`
- [ ] **8.4** Run full lint: `npm run lint`
- [ ] **8.5** Manual smoke test — column definition lifecycle:
  - Create column definition -> create field mapping referencing it -> attempt delete (expect 422) -> delete field mapping -> delete column definition (expect 200)
- [ ] **8.6** Manual smoke test — type change guardrails:
  - Create `string` column -> PATCH to `enum` (expect 200) -> PATCH to `boolean` (expect 422)
- [ ] **8.7** Manual smoke test — write capability guard:
  - Create connector definition with `capabilityFlags.write: true` -> create instance with `enabledCapabilityFlags: { write: false }` -> create entity + records -> attempt record delete (expect 422 `CONNECTOR_INSTANCE_WRITE_DISABLED`) -> attempt entity delete (expect 422)
  - Update instance to `enabledCapabilityFlags: { write: true }` -> retry deletes (expect 200)
- [ ] **8.8** Manual smoke test — definition ceiling enforcement:
  - Create connector definition with `capabilityFlags.write: false` -> create instance with `enabledCapabilityFlags: { write: true }` -> attempt record delete (expect 422 — definition ceiling overrides instance override)
- [ ] **8.9** Manual smoke test — cross-entity reference guard:
  - Create Entity A and Entity B -> create reference field mapping on A pointing to B via `refEntityKey` -> attempt delete B (expect 422) -> delete the field mapping on A -> delete B (expect 200)
- [ ] **8.10** Manual smoke test — field mapping cascade:
  - Create field mapping -> use as `linkFieldMappingId` on entity group member -> delete field mapping -> verify group member is also soft-deleted
- [ ] **8.11** Manual smoke test — null `enabledCapabilityFlags` (backwards compatibility):
  - Create instance with `enabledCapabilityFlags: null` on a definition with `write: true` -> verify all write operations succeed (inherits definition capabilities)
- [ ] **8.12** Verify Swagger/OpenAPI completeness for all new and modified endpoints
  - Run `npm run build` from `apps/api/` and open http://localhost:3001/api-docs to visually confirm all new endpoints appear
  - Verify each new endpoint has: summary, description, tags, parameters, request body (if applicable), and all response codes (200, 404, 422 with error code names)
  - Verify the raw spec at http://localhost:3001/api-docs/spec includes all new `@openapi` annotations
  - If any endpoints are missing or incomplete, fix the `@openapi` JSDoc in the corresponding route file — `swagger-jsdoc` parses `apps/api/src/routes/*.ts` (configured in `apps/api/src/config/swagger.config.ts`)
- [ ] **8.13** Mark `WRITABLE_CONNECTORS.discovery.md` as implemented or archive

### Verification

- [ ] All automated checks pass: `npm run test && npm run type-check && npm run build && npm run lint`
- [ ] All manual smoke tests pass
- [ ] No regressions in existing connector instance delete flow
