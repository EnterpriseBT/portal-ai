# Cross-Entity Identity Resolution (Entity Groups) — Implementation Plan

Multiple entities from different connector instances represent the *same real-world objects* (e.g., a person appears as `employees`, `hubspot_users`, and `airtable_users`). Their column names differ, but a shared value exists in each (e.g., `employee_email`, `hubspot_email`). Entity groups let users declare this relationship and resolve matching records on demand.

**Decisions in effect:**
- Identity resolution is **on-demand** (queried at read time, not materialized on write)
- One link field per member (compound key matching deferred)
- Single entities can belong to multiple groups
- One member per group may be marked as `primary`; only one primary per group
- Hierarchical ordering of members deferred to a later feature

---

## Step 1: Core Models

**Files:**
- `packages/core/src/models/entity-group.model.ts` (new)
- `packages/core/src/models/entity-group-member.model.ts` (new)
- `packages/core/src/models/index.ts` (update)
- `packages/core/src/__tests__/models/entity-group.model.test.ts` (new)
- `packages/core/src/__tests__/models/entity-group-member.model.test.ts` (new)

### Checklist

- [x] Create `entity-group.model.ts`
  - [x] Define `EntityGroupSchema` extending `CoreSchema` with fields: `organizationId`, `name` (min 1), `description` (nullable)
  - [x] Export `EntityGroup` type inferred from schema
  - [x] Export `EntityGroupModel` class extending `CoreModel<EntityGroup>` with `get schema()`, `parse()`, `validate()`
  - [x] Export `EntityGroupModelFactory` class extending `ModelFactory<EntityGroup, EntityGroupModel>` with `create(createdBy)`
- [x] Create `entity-group-member.model.ts`
  - [x] Define `EntityGroupMemberSchema` extending `CoreSchema` with fields: `organizationId`, `entityGroupId`, `connectorEntityId`, `linkFieldMappingId`, `isPrimary` (boolean, default `false`)
  - [x] Export `EntityGroupMember` type inferred from schema
  - [x] Export `EntityGroupMemberModel` class extending `CoreModel<EntityGroupMember>` with `get schema()`, `parse()`, `validate()`
  - [x] Export `EntityGroupMemberModelFactory` class extending `ModelFactory<EntityGroupMember, EntityGroupMemberModel>` with `create(createdBy)`
- [x] Update `models/index.ts`
  - [x] Add `export * from "./entity-group.model.js"`
  - [x] Add `export * from "./entity-group-member.model.js"`
- [x] Write unit tests in `entity-group.model.test.ts`
  - [x] `EntityGroupSchema` accepts valid data with all fields
  - [x] `EntityGroupSchema` rejects empty `name`
  - [x] `EntityGroupSchema` accepts `description: null`
  - [x] `EntityGroupModelFactory.create()` produces a valid model instance
- [x] Write unit tests in `entity-group-member.model.test.ts`
  - [x] `EntityGroupMemberSchema` accepts valid data with all fields
  - [x] `EntityGroupMemberSchema` defaults `isPrimary` to `false`
  - [x] `EntityGroupMemberSchema` accepts `isPrimary: true`
  - [x] `EntityGroupMemberModelFactory.create()` produces a valid model instance

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run test -- --testPathPattern="entity-group"` passes from `packages/core/`

---

## Step 2: Database Tables

**Files:**
- `apps/api/src/db/schema/entity-groups.table.ts` (new)
- `apps/api/src/db/schema/entity-group-members.table.ts` (new)
- `apps/api/src/db/schema/index.ts` (update)

### Checklist

- [x] Create `entity-groups.table.ts`
  - [x] Spread `baseColumns`
  - [x] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [x] Add `name` — `text`, not null
  - [x] Add `description` — `text`, nullable
  - [x] Export as `entityGroups`
- [x] Create `entity-group-members.table.ts`
  - [x] Spread `baseColumns`
  - [x] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [x] Add `entityGroupId` — `text`, not null, FK → `entity_groups.id`
  - [x] Add `connectorEntityId` — `text`, not null, FK → `connector_entities.id`
  - [x] Add `linkFieldMappingId` — `text`, not null, FK → `field_mappings.id`
  - [x] Add `isPrimary` — `boolean`, not null, default `false`
  - [x] Add `unique("entity_group_members_group_entity_unique")` on `(entityGroupId, connectorEntityId)` — one membership per entity per group
  - [x] Export as `entityGroupMembers`
- [x] Update `schema/index.ts`
  - [x] Add `export { entityGroups } from "./entity-groups.table.js"`
  - [x] Add `export { entityGroupMembers } from "./entity-group-members.table.js"`
- [x] Run `npm run db:generate` from `apps/api/` and confirm migration file is created
- [x] Run `npm run db:migrate` from `apps/api/` and confirm migration applies cleanly

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root

---

## Step 3: Drizzle-Zod Schemas & Type-Checks

**Files:**
- `apps/api/src/db/schema/zod.ts` (update)
- `apps/api/src/db/schema/type-checks.ts` (update)

### Checklist

- [x] Update `zod.ts`
  - [x] Import `entityGroups` and `entityGroupMembers` from their table files
  - [x] Add `EntityGroupSelectSchema = createSelectSchema(entityGroups)` and `EntityGroupInsertSchema = createInsertSchema(entityGroups)`
  - [x] Export `EntityGroupSelect` and `EntityGroupInsert` types
  - [x] Add `EntityGroupMemberSelectSchema = createSelectSchema(entityGroupMembers)` and `EntityGroupMemberInsertSchema = createInsertSchema(entityGroupMembers)`
  - [x] Export `EntityGroupMemberSelect` and `EntityGroupMemberInsert` types
- [x] Update `type-checks.ts`
  - [x] Import `EntityGroup` and `EntityGroupMember` from `@portalai/core/models`
  - [x] Import `EntityGroupSelect`, `EntityGroupMemberSelect` from `./zod.js`
  - [x] Import `entityGroups` and `entityGroupMembers` table types
  - [x] Add bidirectional `IsAssignable` checks for `EntityGroupSelect` ↔ `EntityGroup`
  - [x] Add `InferSelectModel` check for `entityGroups` → `EntityGroup`
  - [x] Add bidirectional `IsAssignable` checks for `EntityGroupMemberSelect` ↔ `EntityGroupMember`
  - [x] Add `InferSelectModel` check for `entityGroupMembers` → `EntityGroupMember`

### Verification

- [x] `npm run type-check` passes from repo root — confirms core models are in sync with Drizzle tables
- [x] `npm run build` passes from repo root

---

## Step 4: Repositories

**Files:**
- `apps/api/src/db/repositories/entity-groups.repository.ts` (new)
- `apps/api/src/db/repositories/entity-group-members.repository.ts` (new)
- `apps/api/src/db/repositories/index.ts` (update)
- `apps/api/src/services/db.service.ts` (update)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-groups.repository.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-group-members.repository.integration.test.ts` (new)

### Checklist

- [x] Create `entity-groups.repository.ts`
  - [x] Extend `Repository<typeof entityGroups, EntityGroupSelect, EntityGroupInsert>`
  - [x] Implement `findByOrganizationId(organizationId, opts?)` — filters by org + not deleted, ordered by `name` ASC
  - [x] Implement `findByName(organizationId, name)` — exact match within org, returns single row or undefined (used for duplicate name validation)
  - [x] Implement `findByConnectorEntityId(connectorEntityId)` — returns all groups that the given entity belongs to (join through `entityGroupMembers`); used when viewing an entity record to discover its group memberships
  - [x] Export singleton `entityGroupsRepo`
- [x] Create `entity-group-members.repository.ts`
  - [x] Extend `Repository<typeof entityGroupMembers, EntityGroupMemberSelect, EntityGroupMemberInsert>`
  - [x] Implement `findByEntityGroupId(entityGroupId)` — returns all members for a group with their `connectorEntity` label and `fieldMapping` details joined (two-query pattern)
  - [x] Implement `findByConnectorEntityId(connectorEntityId)` — returns all group memberships for an entity
  - [x] Implement `findExisting(entityGroupId, connectorEntityId)` — returns existing non-deleted member or undefined (duplicate detection)
  - [x] Implement `findPrimary(entityGroupId)` — returns the member with `isPrimary = true`, or undefined if none set
  - [x] Implement `clearPrimary(entityGroupId, client?)` — sets `isPrimary = false` on all members of the group (used in transaction before setting a new primary)
  - [x] Export singleton `entityGroupMembersRepo`
- [x] Update `repositories/index.ts`
  - [x] Add `export * from "./entity-groups.repository.js"`
  - [x] Add `export * from "./entity-group-members.repository.js"`
- [x] Update `db.service.ts`
  - [x] Import `entityGroupsRepo` and `entityGroupMembersRepo`
  - [x] Add `entityGroups: entityGroupsRepo` to `DbService.repository`
  - [x] Add `entityGroupMembers: entityGroupMembersRepo` to `DbService.repository`
- [x] Write integration tests in `entity-groups.repository.integration.test.ts`
  - [x] `findByOrganizationId` returns groups scoped to org, excludes soft-deleted
  - [x] `findByName` returns correct row on match, undefined on miss
  - [x] `findByConnectorEntityId` returns groups the entity belongs to
  - [x] `create` inserts and returns full row
  - [x] `update` modifies fields correctly
  - [x] `softDelete` sets `deleted` and excludes row from subsequent reads
- [x] Write integration tests in `entity-group-members.repository.integration.test.ts`
  - [x] `findByEntityGroupId` returns enriched members with entity labels and field mapping details
  - [x] `findByConnectorEntityId` returns all group memberships for an entity
  - [x] `findExisting` detects existing member, returns undefined for non-existent
  - [x] `findPrimary` returns the primary member, undefined when none set
  - [x] `clearPrimary` sets `isPrimary = false` on all members of a group
  - [x] Unique constraint prevents duplicate `(entityGroupId, connectorEntityId)` at DB level
- [x] Run `npm run test -- --testPathPattern="entity-group"` from `apps/api/` and confirm all repository tests pass

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root

---

## Step 5: API Contracts

**Files:**
- `packages/core/src/contracts/entity-group.contract.ts` (new)
- `packages/core/src/contracts/entity-group-member.contract.ts` (new)
- `packages/core/src/contracts/index.ts` (update)
- `packages/core/src/__tests__/contracts/entity-group.contract.test.ts` (new)
- `packages/core/src/__tests__/contracts/entity-group-member.contract.test.ts` (new)

### Checklist

- [x] Create `entity-group.contract.ts`
  - [x] `EntityGroupListRequestQuerySchema` — extends `PaginationRequestQuerySchema` with optional `search: z.string()` and `sortBy: z.enum(["name", "created"])`
  - [x] `EntityGroupListResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `entityGroups: z.array(EntityGroupSchema)`
  - [x] `EntityGroupWithMembersSchema` — `EntityGroupSchema.extend({ members: z.array(EntityGroupMemberWithDetailsSchema) })` where `EntityGroupMemberWithDetailsSchema` enriches `EntityGroupMemberSchema` with `connectorEntityLabel: z.string()` and `linkFieldMappingSourceField: z.string()`
  - [x] `EntityGroupGetResponsePayloadSchema` — `{ entityGroup: EntityGroupWithMembersSchema }`
  - [x] `EntityGroupCreateRequestBodySchema` — `{ name: z.string().min(1), description: z.string().optional() }`
  - [x] `EntityGroupCreateResponsePayloadSchema` — `{ entityGroup: EntityGroupSchema }`
  - [x] `EntityGroupUpdateRequestBodySchema` — all fields optional (`name?`, `description?`), refine to require at least one field present
  - [x] `EntityGroupUpdateResponsePayloadSchema` — `{ entityGroup: EntityGroupSchema }`
  - [x] Export all schemas and their inferred types
- [x] Create `entity-group-member.contract.ts`
  - [x] `EntityGroupMemberCreateRequestBodySchema` — `{ connectorEntityId: z.string(), linkFieldMappingId: z.string(), isPrimary: z.boolean().optional().default(false) }`
  - [x] `EntityGroupMemberCreateResponsePayloadSchema` — `{ entityGroupMember: EntityGroupMemberSchema }`
  - [x] `EntityGroupMemberUpdateRequestBodySchema` — `{ linkFieldMappingId: z.string().optional(), isPrimary: z.boolean().optional() }`, refine to require at least one field
  - [x] `EntityGroupMemberUpdateResponsePayloadSchema` — `{ entityGroupMember: EntityGroupMemberSchema }`
  - [x] `EntityGroupMemberOverlapRequestQuerySchema` — `{ targetConnectorEntityId: z.string(), targetLinkFieldMappingId: z.string() }` — used to preview overlap % before adding a new member
  - [x] `EntityGroupMemberOverlapResponsePayloadSchema` — `{ overlapPercentage: z.number().min(0).max(100), sourceRecordCount: z.number(), targetRecordCount: z.number(), matchingRecordCount: z.number() }`
  - [x] `EntityGroupResolveRequestQuerySchema` — `{ linkValue: z.string() }` — the identity value to resolve across group members
  - [x] `EntityGroupResolveResponsePayloadSchema` — `{ results: z.array(z.object({ connectorEntityId: z.string(), connectorEntityLabel: z.string(), isPrimary: z.boolean(), records: z.array(EntityRecordSchema) })) }`
  - [x] Export all schemas and their inferred types
- [x] Update `contracts/index.ts`
  - [x] Add `export * from "./entity-group.contract.js"`
  - [x] Add `export * from "./entity-group-member.contract.js"`
- [x] Write unit tests in `entity-group.contract.test.ts`
  - [x] `EntityGroupCreateRequestBodySchema` accepts valid input, rejects empty name
  - [x] `EntityGroupUpdateRequestBodySchema` rejects empty object (at least one field required)
  - [x] `EntityGroupListRequestQuerySchema` accepts valid pagination + search params
- [x] Write unit tests in `entity-group-member.contract.test.ts`
  - [x] `EntityGroupMemberCreateRequestBodySchema` accepts valid input, defaults `isPrimary` to `false`
  - [x] `EntityGroupMemberUpdateRequestBodySchema` rejects empty object (at least one field required)
  - [x] `EntityGroupMemberOverlapResponsePayloadSchema` validates percentage bounds (0–100)
  - [x] `EntityGroupResolveResponsePayloadSchema` accepts valid resolve response with nested records
- [x] Run `npm run test -- --testPathPattern="entity-group"` from `packages/core/` and confirm all contract tests pass

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from `packages/core/`

---

## Step 6: API Error Codes

**Files:**
- `apps/api/src/constants/api-codes.constants.ts` (update)

### Checklist

- [x] Add Entity Group codes:
  - [x] `ENTITY_GROUP_NOT_FOUND`
  - [x] `ENTITY_GROUP_FETCH_FAILED`
  - [x] `ENTITY_GROUP_INVALID_PAYLOAD`
  - [x] `ENTITY_GROUP_CREATE_FAILED`
  - [x] `ENTITY_GROUP_UPDATE_FAILED`
  - [x] `ENTITY_GROUP_DELETE_FAILED`
  - [x] `ENTITY_GROUP_DUPLICATE_NAME`
  - [x] `ENTITY_GROUP_USER_NOT_FOUND`
- [x] Add Entity Group Member codes:
  - [x] `ENTITY_GROUP_MEMBER_NOT_FOUND`
  - [x] `ENTITY_GROUP_MEMBER_FETCH_FAILED`
  - [x] `ENTITY_GROUP_MEMBER_CREATE_FAILED`
  - [x] `ENTITY_GROUP_MEMBER_UPDATE_FAILED`
  - [x] `ENTITY_GROUP_MEMBER_DELETE_FAILED`
  - [x] `ENTITY_GROUP_MEMBER_ALREADY_EXISTS`
  - [x] `ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID`
  - [x] `ENTITY_GROUP_MEMBER_PRIMARY_CONFLICT`

### Verification

- [x] `npm run type-check` passes from repo root

---

## Step 7: API Routes

**Files:**
- `apps/api/src/routes/entity-group.router.ts` (new)
- `apps/api/src/routes/entity-group-member.router.ts` (new)
- `apps/api/src/routes/protected.router.ts` (update)
- `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/routes/entity-group-member.router.integration.test.ts` (new)

### Checklist

- [x] Create `entity-group.router.ts`
  - [x] `GET /` — list groups scoped to org; support `search` (ilike on `name`), `limit`, `offset`, `sortBy` (name/created), `sortOrder`; use `EntityGroupListRequestQuerySchema` to parse query
  - [x] `GET /:id` — fetch single group by ID with members (joined with connector entity labels and field mapping source fields); 404 with `ENTITY_GROUP_NOT_FOUND` if missing
  - [x] `POST /` — create group; validate with `EntityGroupCreateRequestBodySchema`; call `findByName` to detect duplicate name within org, return 409 with `ENTITY_GROUP_DUPLICATE_NAME` if found; use `EntityGroupModelFactory` to build the record
  - [x] `PATCH /:id` — update group; validate with `EntityGroupUpdateRequestBodySchema`; if `name` is changing, re-run `findByName` duplicate check; 404 if group not found
  - [x] `DELETE /:id` — soft-delete group; also soft-delete all its members by calling `entityGroupMembersRepo.softDeleteMany` filtered by `entityGroupId`; wrap both in a `DbService.transaction`; 404 if group not found
  - [x] Add OpenAPI JSDoc comments for all routes
- [x] Create `entity-group-member.router.ts` — nested under `entity-group.router.ts` at `/:entityGroupId/members`
  - [x] `GET /` — list members for the group; returns members with connector entity labels and link field details
  - [x] `POST /` — add a member to the group; validate with `EntityGroupMemberCreateRequestBodySchema`; verify the connector entity exists and belongs to the same org; verify the link field mapping exists and belongs to the connector entity; call `findExisting` to detect duplicate, return 409 with `ENTITY_GROUP_MEMBER_ALREADY_EXISTS` if found; if `isPrimary` is true, wrap in a transaction that calls `clearPrimary` then creates the member; use `EntityGroupMemberModelFactory` to build the record
  - [x] `PATCH /:memberId` — update a member; validate with `EntityGroupMemberUpdateRequestBodySchema`; if `isPrimary` is changing to `true`, wrap in a transaction that calls `clearPrimary` then updates; if `linkFieldMappingId` is changing, verify the new field mapping belongs to the member's connector entity; 404 if member not found
  - [x] `DELETE /:memberId` — soft-delete the member; 404 if member not found
  - [x] `GET /overlap` — preview overlap between an existing group member's link field and a candidate member's link field *before* adding it; accepts `targetConnectorEntityId` and `targetLinkFieldMappingId` as query params; for each existing member in the group, queries both entities' `normalizedData` to count distinct link field values, then computes the intersection count and percentage; returns `EntityGroupMemberOverlapResponsePayload`
  - [x] Add OpenAPI JSDoc comments for all routes
- [x] Add identity resolution endpoint to `entity-group.router.ts`
  - [x] `GET /:id/resolve` — on-demand identity resolution; accepts `linkValue` query param; for each member in the group, looks up their `linkFieldMappingId` → column definition key, then queries `entity_records.normalized_data` where `normalizedData[key] = linkValue`; returns `EntityGroupResolveResponsePayload` with matched records grouped by member entity
- [x] Update `protected.router.ts`
  - [x] Import `entityGroupRouter`
  - [x] Add `protectedRouter.use("/entity-groups", entityGroupRouter)`
- [x] Write integration tests in `entity-group.router.integration.test.ts`
  - [x] `GET /api/entity-groups` returns paginated list scoped to org
  - [x] `GET /api/entity-groups` with `search` filters by name
  - [x] `GET /api/entity-groups/:id` returns 200 with members for valid ID, 404 for unknown
  - [x] `POST /api/entity-groups` creates group, returns 201
  - [x] `POST /api/entity-groups` returns 409 on duplicate name within org
  - [x] `PATCH /api/entity-groups/:id` updates fields, returns 200
  - [x] `PATCH /api/entity-groups/:id` returns 409 if new name conflicts with existing group
  - [x] `DELETE /api/entity-groups/:id` soft-deletes group and its members, returns 200
  - [x] `DELETE /api/entity-groups/:id` returns 404 for unknown ID
  - [x] `GET /api/entity-groups/:id/resolve?linkValue=test@example.com` returns matching records from each member entity
  - [x] `GET /api/entity-groups/:id/resolve` returns empty results array when no records match
- [x] Write integration tests in `entity-group-member.router.integration.test.ts`
  - [x] `GET /api/entity-groups/:id/members` returns members with enriched details
  - [x] `POST /api/entity-groups/:id/members` adds a member, returns 201
  - [x] `POST /api/entity-groups/:id/members` returns 409 if entity already a member
  - [x] `POST /api/entity-groups/:id/members` returns 400 if link field mapping does not belong to the connector entity
  - [x] `POST /api/entity-groups/:id/members` with `isPrimary: true` clears any existing primary and sets the new member as primary
  - [x] `PATCH /api/entity-groups/:id/members/:memberId` updates `isPrimary` correctly with transactional primary swap
  - [x] `PATCH /api/entity-groups/:id/members/:memberId` updates `linkFieldMappingId` and validates ownership
  - [x] `DELETE /api/entity-groups/:id/members/:memberId` removes member, returns 200
  - [x] `GET /api/entity-groups/:id/members/overlap?targetConnectorEntityId=...&targetLinkFieldMappingId=...` returns overlap statistics
- [x] Run `npm run test -- --testPathPattern="entity-group"` from `apps/api/` and confirm all route tests pass

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (pre-existing lint error in `useInfiniteFilterOptions.ts` unrelated to this change)
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root
- [ ] Manually verify routes are visible in Swagger UI at `http://localhost:3001/api-docs`

---

## Step 8: Frontend — Entity Groups list view

**Files:**
- `apps/web/src/api/entity-groups.api.ts` (new)
- `apps/web/src/api/keys.ts` (update)
- `apps/web/src/views/EntityGroups.view.tsx` (new)
- `apps/web/src/routes/_authorized/entity-groups/index.tsx` (new)
- `apps/web/src/routes/_authorized/entity-groups/$entityGroupId.tsx` (new)
- `apps/web/src/components/Navigation.component.tsx` (update)
- `apps/web/src/__tests__/EntityGroupsView.test.tsx` (new)

### Checklist

- [x] Create `entity-groups.api.ts`
  - [x] `fetchEntityGroups(params)` — `GET /api/entity-groups` with pagination/search
  - [x] `fetchEntityGroup(id)` — `GET /api/entity-groups/:id` (returns group with members)
  - [x] `createEntityGroup(body)` — `POST /api/entity-groups`
  - [x] `updateEntityGroup(id, body)` — `PATCH /api/entity-groups/:id`
  - [x] `deleteEntityGroup(id)` — `DELETE /api/entity-groups/:id`
  - [x] `addEntityGroupMember(groupId, body)` — `POST /api/entity-groups/:id/members`
  - [x] `updateEntityGroupMember(groupId, memberId, body)` — `PATCH /api/entity-groups/:id/members/:memberId`
  - [x] `removeEntityGroupMember(groupId, memberId)` — `DELETE /api/entity-groups/:id/members/:memberId`
  - [x] `fetchMemberOverlap(groupId, params)` — `GET /api/entity-groups/:id/members/overlap`
  - [x] `resolveEntityGroup(groupId, linkValue)` — `GET /api/entity-groups/:id/resolve`
- [x] Update `keys.ts` with query keys for all entity group endpoints
- [x] Create `EntityGroups.view.tsx`
  - [x] Container component with `useAuthFetch` and `usePagination`
  - [x] Pure `EntityGroupsViewUI` component
  - [x] Table with columns: Name, Description, Member Count, Created
  - [x] Search bar in `PaginationToolbar`
  - [x] "Create Group" button opening a dialog with name + description fields
  - [x] Row click navigates to group detail page
- [x] Create route files for TanStack Router
- [x] Update navigation to include "Entity Groups" link
- [x] Write tests in `EntityGroupsView.test.tsx`
  - [x] Renders group list table with name, description, member count columns
  - [x] Search filters groups by name
  - [x] Create dialog opens and submits correctly
  - [x] Row click navigates to detail view
- [x] Run `npm run test -- --testPathPattern="EntityGroupsView"` from `apps/web/` and confirm all tests pass

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (pre-existing lint error in `@portalai/core` unrelated to these changes)
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from `apps/web/`

---

## Step 9: Frontend — Entity Group detail view

**Files:**
- `apps/web/src/views/EntityGroupDetail.view.tsx` (new)
- `apps/web/src/__tests__/EntityGroupDetailView.test.tsx` (new)

### Checklist

- [x] Create `EntityGroupDetail.view.tsx`
  - [x] Container component fetches group with members via `fetchEntityGroup(id)`
  - [x] Pure `EntityGroupDetailViewUI` component
  - [x] **Header section**: Group name (editable inline), description, edit/delete actions
  - [x] **Members table**: Columns — Entity Label, Connector Instance, Link Field, Primary (star icon), Actions (remove)
    - [x] Primary member row displays a filled star icon; non-primary shows an outline star that can be clicked to promote
    - [x] Clicking the star triggers `updateEntityGroupMember(groupId, memberId, { isPrimary: true })` — the API handles clearing the previous primary
  - [x] **Add Member panel**: A form section below the members table with:
    - [x] `SearchableSelect` for connector entity (async search across org entities)
    - [x] `SearchableSelect` for link field mapping (filtered to field mappings of the selected connector entity; disabled until entity is selected)
    - [x] `isPrimary` checkbox
    - [x] **Overlap preview**: Once both entity and link field are selected, automatically call `GET /api/entity-groups/:id/members/overlap` and display the result:
      - [x] Show overlap percentage as a prominent number (e.g., "72% overlap")
      - [x] Show counts: "145 of 200 source records match 145 of 300 target records"
      - [x] **Yellow highlight** (MUI `warning` color) if overlap is below 50%
      - [x] **Red highlight** (MUI `error` color) if overlap is below 5%
      - [x] Overlap check runs against each existing member in the group individually
    - [x] "Add Member" button — disabled until entity and link field are selected; submits `POST /api/entity-groups/:id/members`
- [x] Write tests in `EntityGroupDetailView.test.tsx`
  - [x] Renders group header with name and description
  - [x] Members table displays entity labels, link fields, and primary indicators
  - [x] Clicking star icon on non-primary member triggers primary update
  - [x] Add member form: selecting entity populates link field dropdown
  - [x] Overlap preview displays correct percentage and highlight colors:
    - [x] `>= 50%` — default styling (no highlight)
    - [x] `< 50%` and `>= 5%` — yellow/warning highlight
    - [x] `< 5%` — red/error highlight
  - [x] Add member button disabled until entity and link field selected
  - [x] Remove member triggers delete confirmation and API call
- [x] Run `npm run test -- --testPathPattern="EntityGroupDetailView"` from `apps/web/` and confirm all tests pass

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from `apps/web/`

---

## Step 10: Frontend — Identity resolution in Entity Record Detail

**Files:**
- `apps/web/src/views/EntityRecordDetail.view.tsx` (update — or the existing entity record detail view)
- `apps/web/src/__tests__/EntityRecordDetailView.test.tsx` (update)

### Checklist

- [ ] In the entity record detail view, add a "Related Records" section:
  - [ ] On load, fetch the entity's group memberships via `entityGroupsRepo.findByConnectorEntityId`
  - [ ] For each group the entity belongs to, display a collapsible panel titled with the group name
  - [ ] Inside each panel, add a "Resolve Identity" button (on-demand, not automatic)
  - [ ] When clicked, read the current record's `normalizedData` value for the member's link field, then call `GET /api/entity-groups/:id/resolve?linkValue=<value>`
  - [ ] Display results grouped by member entity: entity label, record count, expandable record list
  - [ ] Primary member entity is visually distinguished (bold label, star icon)
  - [ ] If no groups exist for the entity, the section is hidden entirely
- [ ] Write / update tests in `EntityRecordDetailView.test.tsx`
  - [ ] Identity resolution section renders when entity has group memberships
  - [ ] Section hidden when entity has no group memberships
  - [ ] "Resolve Identity" button triggers API call and displays grouped results
  - [ ] Primary member entity shown with star icon and bold label
  - [ ] Empty resolve results display "No matching records found" message
- [ ] Run `npm run test -- --testPathPattern="EntityRecordDetailView"` from `apps/web/` and confirm all tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from `apps/web/`

---

## Validations

### At group creation / update

| Condition | Behavior |
|-----------|----------|
| `name` is empty or whitespace-only | API returns 400 — `ENTITY_GROUP_INVALID_PAYLOAD` |
| `name` matches an existing group name within the org | API returns 409 — `ENTITY_GROUP_DUPLICATE_NAME` |

### At member creation / update

| Condition | Behavior |
|-----------|----------|
| `connectorEntityId` does not exist or belongs to a different org | API returns 400 — `ENTITY_GROUP_MEMBER_CREATE_FAILED` |
| `linkFieldMappingId` does not exist or does not belong to the specified connector entity | API returns 400 — `ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID` |
| Entity is already a member of the group | API returns 409 — `ENTITY_GROUP_MEMBER_ALREADY_EXISTS` |
| `isPrimary: true` and another member is already primary | API clears existing primary in a transaction — no error (idempotent swap) |

### At overlap preview time (advisory only, never blocks)

| Condition | UI Treatment |
|-----------|-------------|
| Overlap >= 50% | Default display — no highlight |
| Overlap < 50% and >= 5% | Yellow/warning highlight on the percentage |
| Overlap < 5% | Red/error highlight on the percentage |
| One or both entities have 0 records | Show "0% overlap — no records available" with a muted/info style |

### At identity resolution time

| Condition | Behavior |
|-----------|----------|
| `linkValue` is empty | API returns 400 |
| No records match in any member entity | Returns `{ results: [] }` with empty records arrays — UI shows "No matching records found" |
| Link field mapping was deleted after member was added | Skip that member in results; log a warning server-side |

---

## Deferred (out of scope for this iteration)

- Hierarchical ordering of members within a group
- Compound key matching (multiple link fields per member)
- Materialized identity resolution (write-time match tables for faster reads)
- Merged/unified record view across group members
- Bulk identity resolution (resolve all records in an entity at once)
- Group-level data quality metrics dashboard

---

## Final Verification

Run all checks from the repo root in order:

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`
