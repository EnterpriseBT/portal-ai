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

- [ ] Create `entity-groups.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `name` — `text`, not null
  - [ ] Add `description` — `text`, nullable
  - [ ] Export as `entityGroups`
- [ ] Create `entity-group-members.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `entityGroupId` — `text`, not null, FK → `entity_groups.id`
  - [ ] Add `connectorEntityId` — `text`, not null, FK → `connector_entities.id`
  - [ ] Add `linkFieldMappingId` — `text`, not null, FK → `field_mappings.id`
  - [ ] Add `isPrimary` — `boolean`, not null, default `false`
  - [ ] Add `unique("entity_group_members_group_entity_unique")` on `(entityGroupId, connectorEntityId)` — one membership per entity per group
  - [ ] Export as `entityGroupMembers`
- [ ] Update `schema/index.ts`
  - [ ] Add `export { entityGroups } from "./entity-groups.table.js"`
  - [ ] Add `export { entityGroupMembers } from "./entity-group-members.table.js"`
- [ ] Run `npm run db:generate` from `apps/api/` and confirm migration file is created
- [ ] Run `npm run db:migrate` from `apps/api/` and confirm migration applies cleanly

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 3: Drizzle-Zod Schemas & Type-Checks

**Files:**
- `apps/api/src/db/schema/zod.ts` (update)
- `apps/api/src/db/schema/type-checks.ts` (update)

### Checklist

- [ ] Update `zod.ts`
  - [ ] Import `entityGroups` and `entityGroupMembers` from their table files
  - [ ] Add `EntityGroupSelectSchema = createSelectSchema(entityGroups)` and `EntityGroupInsertSchema = createInsertSchema(entityGroups)`
  - [ ] Export `EntityGroupSelect` and `EntityGroupInsert` types
  - [ ] Add `EntityGroupMemberSelectSchema = createSelectSchema(entityGroupMembers)` and `EntityGroupMemberInsertSchema = createInsertSchema(entityGroupMembers)`
  - [ ] Export `EntityGroupMemberSelect` and `EntityGroupMemberInsert` types
- [ ] Update `type-checks.ts`
  - [ ] Import `EntityGroup` and `EntityGroupMember` from `@portalai/core/models`
  - [ ] Import `EntityGroupSelect`, `EntityGroupMemberSelect` from `./zod.js`
  - [ ] Import `entityGroups` and `entityGroupMembers` table types
  - [ ] Add bidirectional `IsAssignable` checks for `EntityGroupSelect` ↔ `EntityGroup`
  - [ ] Add `InferSelectModel` check for `entityGroups` → `EntityGroup`
  - [ ] Add bidirectional `IsAssignable` checks for `EntityGroupMemberSelect` ↔ `EntityGroupMember`
  - [ ] Add `InferSelectModel` check for `entityGroupMembers` → `EntityGroupMember`

### Verification

- [ ] `npm run type-check` passes from repo root — confirms core models are in sync with Drizzle tables
- [ ] `npm run build` passes from repo root

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

- [ ] Create `entity-groups.repository.ts`
  - [ ] Extend `Repository<typeof entityGroups, EntityGroupSelect, EntityGroupInsert>`
  - [ ] Implement `findByOrganizationId(organizationId, opts?)` — filters by org + not deleted, ordered by `name` ASC
  - [ ] Implement `findByName(organizationId, name)` — exact match within org, returns single row or undefined (used for duplicate name validation)
  - [ ] Implement `findByConnectorEntityId(connectorEntityId)` — returns all groups that the given entity belongs to (join through `entityGroupMembers`); used when viewing an entity record to discover its group memberships
  - [ ] Export singleton `entityGroupsRepo`
- [ ] Create `entity-group-members.repository.ts`
  - [ ] Extend `Repository<typeof entityGroupMembers, EntityGroupMemberSelect, EntityGroupMemberInsert>`
  - [ ] Implement `findByEntityGroupId(entityGroupId)` — returns all members for a group with their `connectorEntity` label and `fieldMapping` details joined (two-query pattern)
  - [ ] Implement `findByConnectorEntityId(connectorEntityId)` — returns all group memberships for an entity
  - [ ] Implement `findExisting(entityGroupId, connectorEntityId)` — returns existing non-deleted member or undefined (duplicate detection)
  - [ ] Implement `findPrimary(entityGroupId)` — returns the member with `isPrimary = true`, or undefined if none set
  - [ ] Implement `clearPrimary(entityGroupId, client?)` — sets `isPrimary = false` on all members of the group (used in transaction before setting a new primary)
  - [ ] Export singleton `entityGroupMembersRepo`
- [ ] Update `repositories/index.ts`
  - [ ] Add `export * from "./entity-groups.repository.js"`
  - [ ] Add `export * from "./entity-group-members.repository.js"`
- [ ] Update `db.service.ts`
  - [ ] Import `entityGroupsRepo` and `entityGroupMembersRepo`
  - [ ] Add `entityGroups: entityGroupsRepo` to `DbService.repository`
  - [ ] Add `entityGroupMembers: entityGroupMembersRepo` to `DbService.repository`
- [ ] Write integration tests in `entity-groups.repository.integration.test.ts`
  - [ ] `findByOrganizationId` returns groups scoped to org, excludes soft-deleted
  - [ ] `findByName` returns correct row on match, undefined on miss
  - [ ] `findByConnectorEntityId` returns groups the entity belongs to
  - [ ] `create` inserts and returns full row
  - [ ] `update` modifies fields correctly
  - [ ] `softDelete` sets `deleted` and excludes row from subsequent reads
- [ ] Write integration tests in `entity-group-members.repository.integration.test.ts`
  - [ ] `findByEntityGroupId` returns enriched members with entity labels and field mapping details
  - [ ] `findByConnectorEntityId` returns all group memberships for an entity
  - [ ] `findExisting` detects existing member, returns undefined for non-existent
  - [ ] `findPrimary` returns the primary member, undefined when none set
  - [ ] `clearPrimary` sets `isPrimary = false` on all members of a group
  - [ ] Unique constraint prevents duplicate `(entityGroupId, connectorEntityId)` at DB level
- [ ] Run `npm run test -- --testPathPattern="entity-group"` from `apps/api/` and confirm all repository tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root

---

## Step 5: API Contracts

**Files:**
- `packages/core/src/contracts/entity-group.contract.ts` (new)
- `packages/core/src/contracts/entity-group-member.contract.ts` (new)
- `packages/core/src/contracts/index.ts` (update)
- `packages/core/src/__tests__/contracts/entity-group.contract.test.ts` (new)
- `packages/core/src/__tests__/contracts/entity-group-member.contract.test.ts` (new)

### Checklist

- [ ] Create `entity-group.contract.ts`
  - [ ] `EntityGroupListRequestQuerySchema` — extends `PaginationRequestQuerySchema` with optional `search: z.string()` and `sortBy: z.enum(["name", "created"])`
  - [ ] `EntityGroupListResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `entityGroups: z.array(EntityGroupSchema)`
  - [ ] `EntityGroupWithMembersSchema` — `EntityGroupSchema.extend({ members: z.array(EntityGroupMemberWithDetailsSchema) })` where `EntityGroupMemberWithDetailsSchema` enriches `EntityGroupMemberSchema` with `connectorEntityLabel: z.string()` and `linkFieldMappingSourceField: z.string()`
  - [ ] `EntityGroupGetResponsePayloadSchema` — `{ entityGroup: EntityGroupWithMembersSchema }`
  - [ ] `EntityGroupCreateRequestBodySchema` — `{ name: z.string().min(1), description: z.string().optional() }`
  - [ ] `EntityGroupCreateResponsePayloadSchema` — `{ entityGroup: EntityGroupSchema }`
  - [ ] `EntityGroupUpdateRequestBodySchema` — all fields optional (`name?`, `description?`), refine to require at least one field present
  - [ ] `EntityGroupUpdateResponsePayloadSchema` — `{ entityGroup: EntityGroupSchema }`
  - [ ] Export all schemas and their inferred types
- [ ] Create `entity-group-member.contract.ts`
  - [ ] `EntityGroupMemberCreateRequestBodySchema` — `{ connectorEntityId: z.string(), linkFieldMappingId: z.string(), isPrimary: z.boolean().optional().default(false) }`
  - [ ] `EntityGroupMemberCreateResponsePayloadSchema` — `{ entityGroupMember: EntityGroupMemberSchema }`
  - [ ] `EntityGroupMemberUpdateRequestBodySchema` — `{ linkFieldMappingId: z.string().optional(), isPrimary: z.boolean().optional() }`, refine to require at least one field
  - [ ] `EntityGroupMemberUpdateResponsePayloadSchema` — `{ entityGroupMember: EntityGroupMemberSchema }`
  - [ ] `EntityGroupMemberOverlapRequestQuerySchema` — `{ targetConnectorEntityId: z.string(), targetLinkFieldMappingId: z.string() }` — used to preview overlap % before adding a new member
  - [ ] `EntityGroupMemberOverlapResponsePayloadSchema` — `{ overlapPercentage: z.number().min(0).max(100), sourceRecordCount: z.number(), targetRecordCount: z.number(), matchingRecordCount: z.number() }`
  - [ ] `EntityGroupResolveRequestQuerySchema` — `{ linkValue: z.string() }` — the identity value to resolve across group members
  - [ ] `EntityGroupResolveResponsePayloadSchema` — `{ results: z.array(z.object({ connectorEntityId: z.string(), connectorEntityLabel: z.string(), isPrimary: z.boolean(), records: z.array(EntityRecordSchema) })) }`
  - [ ] Export all schemas and their inferred types
- [ ] Update `contracts/index.ts`
  - [ ] Add `export * from "./entity-group.contract.js"`
  - [ ] Add `export * from "./entity-group-member.contract.js"`
- [ ] Write unit tests in `entity-group.contract.test.ts`
  - [ ] `EntityGroupCreateRequestBodySchema` accepts valid input, rejects empty name
  - [ ] `EntityGroupUpdateRequestBodySchema` rejects empty object (at least one field required)
  - [ ] `EntityGroupListRequestQuerySchema` accepts valid pagination + search params
- [ ] Write unit tests in `entity-group-member.contract.test.ts`
  - [ ] `EntityGroupMemberCreateRequestBodySchema` accepts valid input, defaults `isPrimary` to `false`
  - [ ] `EntityGroupMemberUpdateRequestBodySchema` rejects empty object (at least one field required)
  - [ ] `EntityGroupMemberOverlapResponsePayloadSchema` validates percentage bounds (0–100)
  - [ ] `EntityGroupResolveResponsePayloadSchema` accepts valid resolve response with nested records
- [ ] Run `npm run test -- --testPathPattern="entity-group"` from `packages/core/` and confirm all contract tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from `packages/core/`

---

## Step 6: API Error Codes

**Files:**
- `apps/api/src/constants/api-codes.constants.ts` (update)

### Checklist

- [ ] Add Entity Group codes:
  - [ ] `ENTITY_GROUP_NOT_FOUND`
  - [ ] `ENTITY_GROUP_FETCH_FAILED`
  - [ ] `ENTITY_GROUP_INVALID_PAYLOAD`
  - [ ] `ENTITY_GROUP_CREATE_FAILED`
  - [ ] `ENTITY_GROUP_UPDATE_FAILED`
  - [ ] `ENTITY_GROUP_DELETE_FAILED`
  - [ ] `ENTITY_GROUP_DUPLICATE_NAME`
  - [ ] `ENTITY_GROUP_USER_NOT_FOUND`
- [ ] Add Entity Group Member codes:
  - [ ] `ENTITY_GROUP_MEMBER_NOT_FOUND`
  - [ ] `ENTITY_GROUP_MEMBER_FETCH_FAILED`
  - [ ] `ENTITY_GROUP_MEMBER_CREATE_FAILED`
  - [ ] `ENTITY_GROUP_MEMBER_UPDATE_FAILED`
  - [ ] `ENTITY_GROUP_MEMBER_DELETE_FAILED`
  - [ ] `ENTITY_GROUP_MEMBER_ALREADY_EXISTS`
  - [ ] `ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID`
  - [ ] `ENTITY_GROUP_MEMBER_PRIMARY_CONFLICT`

### Verification

- [ ] `npm run type-check` passes from repo root

---

## Step 7: API Routes

**Files:**
- `apps/api/src/routes/entity-group.router.ts` (new)
- `apps/api/src/routes/entity-group-member.router.ts` (new)
- `apps/api/src/routes/protected.router.ts` (update)
- `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/routes/entity-group-member.router.integration.test.ts` (new)

### Checklist

- [ ] Create `entity-group.router.ts`
  - [ ] `GET /` — list groups scoped to org; support `search` (ilike on `name`), `limit`, `offset`, `sortBy` (name/created), `sortOrder`; use `EntityGroupListRequestQuerySchema` to parse query
  - [ ] `GET /:id` — fetch single group by ID with members (joined with connector entity labels and field mapping source fields); 404 with `ENTITY_GROUP_NOT_FOUND` if missing
  - [ ] `POST /` — create group; validate with `EntityGroupCreateRequestBodySchema`; call `findByName` to detect duplicate name within org, return 409 with `ENTITY_GROUP_DUPLICATE_NAME` if found; use `EntityGroupModelFactory` to build the record
  - [ ] `PATCH /:id` — update group; validate with `EntityGroupUpdateRequestBodySchema`; if `name` is changing, re-run `findByName` duplicate check; 404 if group not found
  - [ ] `DELETE /:id` — soft-delete group; also soft-delete all its members by calling `entityGroupMembersRepo.softDeleteMany` filtered by `entityGroupId`; wrap both in a `DbService.transaction`; 404 if group not found
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Create `entity-group-member.router.ts` — nested under `entity-group.router.ts` at `/:entityGroupId/members`
  - [ ] `GET /` — list members for the group; returns members with connector entity labels and link field details
  - [ ] `POST /` — add a member to the group; validate with `EntityGroupMemberCreateRequestBodySchema`; verify the connector entity exists and belongs to the same org; verify the link field mapping exists and belongs to the connector entity; call `findExisting` to detect duplicate, return 409 with `ENTITY_GROUP_MEMBER_ALREADY_EXISTS` if found; if `isPrimary` is true, wrap in a transaction that calls `clearPrimary` then creates the member; use `EntityGroupMemberModelFactory` to build the record
  - [ ] `PATCH /:memberId` — update a member; validate with `EntityGroupMemberUpdateRequestBodySchema`; if `isPrimary` is changing to `true`, wrap in a transaction that calls `clearPrimary` then updates; if `linkFieldMappingId` is changing, verify the new field mapping belongs to the member's connector entity; 404 if member not found
  - [ ] `DELETE /:memberId` — soft-delete the member; 404 if member not found
  - [ ] `GET /overlap` — preview overlap between an existing group member's link field and a candidate member's link field *before* adding it; accepts `targetConnectorEntityId` and `targetLinkFieldMappingId` as query params; for each existing member in the group, queries both entities' `normalizedData` to count distinct link field values, then computes the intersection count and percentage; returns `EntityGroupMemberOverlapResponsePayload`
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Add identity resolution endpoint to `entity-group.router.ts`
  - [ ] `GET /:id/resolve` — on-demand identity resolution; accepts `linkValue` query param; for each member in the group, looks up their `linkFieldMappingId` → column definition key, then queries `entity_records.normalized_data` where `normalizedData[key] = linkValue`; returns `EntityGroupResolveResponsePayload` with matched records grouped by member entity
- [ ] Update `protected.router.ts`
  - [ ] Import `entityGroupRouter`
  - [ ] Add `protectedRouter.use("/entity-groups", entityGroupRouter)`
- [ ] Write integration tests in `entity-group.router.integration.test.ts`
  - [ ] `GET /api/entity-groups` returns paginated list scoped to org
  - [ ] `GET /api/entity-groups` with `search` filters by name
  - [ ] `GET /api/entity-groups/:id` returns 200 with members for valid ID, 404 for unknown
  - [ ] `POST /api/entity-groups` creates group, returns 201
  - [ ] `POST /api/entity-groups` returns 409 on duplicate name within org
  - [ ] `PATCH /api/entity-groups/:id` updates fields, returns 200
  - [ ] `PATCH /api/entity-groups/:id` returns 409 if new name conflicts with existing group
  - [ ] `DELETE /api/entity-groups/:id` soft-deletes group and its members, returns 200
  - [ ] `DELETE /api/entity-groups/:id` returns 404 for unknown ID
  - [ ] `GET /api/entity-groups/:id/resolve?linkValue=test@example.com` returns matching records from each member entity
  - [ ] `GET /api/entity-groups/:id/resolve` returns empty results array when no records match
- [ ] Write integration tests in `entity-group-member.router.integration.test.ts`
  - [ ] `GET /api/entity-groups/:id/members` returns members with enriched details
  - [ ] `POST /api/entity-groups/:id/members` adds a member, returns 201
  - [ ] `POST /api/entity-groups/:id/members` returns 409 if entity already a member
  - [ ] `POST /api/entity-groups/:id/members` returns 400 if link field mapping does not belong to the connector entity
  - [ ] `POST /api/entity-groups/:id/members` with `isPrimary: true` clears any existing primary and sets the new member as primary
  - [ ] `PATCH /api/entity-groups/:id/members/:memberId` updates `isPrimary` correctly with transactional primary swap
  - [ ] `PATCH /api/entity-groups/:id/members/:memberId` updates `linkFieldMappingId` and validates ownership
  - [ ] `DELETE /api/entity-groups/:id/members/:memberId` removes member, returns 200
  - [ ] `GET /api/entity-groups/:id/members/overlap?targetConnectorEntityId=...&targetLinkFieldMappingId=...` returns overlap statistics
- [ ] Run `npm run test -- --testPathPattern="entity-group"` from `apps/api/` and confirm all route tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root
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

- [ ] Create `entity-groups.api.ts`
  - [ ] `fetchEntityGroups(params)` — `GET /api/entity-groups` with pagination/search
  - [ ] `fetchEntityGroup(id)` — `GET /api/entity-groups/:id` (returns group with members)
  - [ ] `createEntityGroup(body)` — `POST /api/entity-groups`
  - [ ] `updateEntityGroup(id, body)` — `PATCH /api/entity-groups/:id`
  - [ ] `deleteEntityGroup(id)` — `DELETE /api/entity-groups/:id`
  - [ ] `addEntityGroupMember(groupId, body)` — `POST /api/entity-groups/:id/members`
  - [ ] `updateEntityGroupMember(groupId, memberId, body)` — `PATCH /api/entity-groups/:id/members/:memberId`
  - [ ] `removeEntityGroupMember(groupId, memberId)` — `DELETE /api/entity-groups/:id/members/:memberId`
  - [ ] `fetchMemberOverlap(groupId, params)` — `GET /api/entity-groups/:id/members/overlap`
  - [ ] `resolveEntityGroup(groupId, linkValue)` — `GET /api/entity-groups/:id/resolve`
- [ ] Update `keys.ts` with query keys for all entity group endpoints
- [ ] Create `EntityGroups.view.tsx`
  - [ ] Container component with `useAuthFetch` and `usePagination`
  - [ ] Pure `EntityGroupsViewUI` component
  - [ ] Table with columns: Name, Description, Member Count, Created
  - [ ] Search bar in `PaginationToolbar`
  - [ ] "Create Group" button opening a dialog with name + description fields
  - [ ] Row click navigates to group detail page
- [ ] Create route files for TanStack Router
- [ ] Update navigation to include "Entity Groups" link
- [ ] Write tests in `EntityGroupsView.test.tsx`
  - [ ] Renders group list table with name, description, member count columns
  - [ ] Search filters groups by name
  - [ ] Create dialog opens and submits correctly
  - [ ] Row click navigates to detail view
- [ ] Run `npm run test -- --testPathPattern="EntityGroupsView"` from `apps/web/` and confirm all tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from `apps/web/`

---

## Step 9: Frontend — Entity Group detail view

**Files:**
- `apps/web/src/views/EntityGroupDetail.view.tsx` (new)
- `apps/web/src/__tests__/EntityGroupDetailView.test.tsx` (new)

### Checklist

- [ ] Create `EntityGroupDetail.view.tsx`
  - [ ] Container component fetches group with members via `fetchEntityGroup(id)`
  - [ ] Pure `EntityGroupDetailViewUI` component
  - [ ] **Header section**: Group name (editable inline), description, edit/delete actions
  - [ ] **Members table**: Columns — Entity Label, Connector Instance, Link Field, Primary (star icon), Actions (remove)
    - [ ] Primary member row displays a filled star icon; non-primary shows an outline star that can be clicked to promote
    - [ ] Clicking the star triggers `updateEntityGroupMember(groupId, memberId, { isPrimary: true })` — the API handles clearing the previous primary
  - [ ] **Add Member panel**: A form section below the members table with:
    - [ ] `SearchableSelect` for connector entity (async search across org entities)
    - [ ] `SearchableSelect` for link field mapping (filtered to field mappings of the selected connector entity; disabled until entity is selected)
    - [ ] `isPrimary` checkbox
    - [ ] **Overlap preview**: Once both entity and link field are selected, automatically call `GET /api/entity-groups/:id/members/overlap` and display the result:
      - [ ] Show overlap percentage as a prominent number (e.g., "72% overlap")
      - [ ] Show counts: "145 of 200 source records match 145 of 300 target records"
      - [ ] **Yellow highlight** (MUI `warning` color) if overlap is below 50%
      - [ ] **Red highlight** (MUI `error` color) if overlap is below 5%
      - [ ] Overlap check runs against each existing member in the group individually
    - [ ] "Add Member" button — disabled until entity and link field are selected; submits `POST /api/entity-groups/:id/members`
- [ ] Write tests in `EntityGroupDetailView.test.tsx`
  - [ ] Renders group header with name and description
  - [ ] Members table displays entity labels, link fields, and primary indicators
  - [ ] Clicking star icon on non-primary member triggers primary update
  - [ ] Add member form: selecting entity populates link field dropdown
  - [ ] Overlap preview displays correct percentage and highlight colors:
    - [ ] `>= 50%` — default styling (no highlight)
    - [ ] `< 50%` and `>= 5%` — yellow/warning highlight
    - [ ] `< 5%` — red/error highlight
  - [ ] Add member button disabled until entity and link field selected
  - [ ] Remove member triggers delete confirmation and API call
- [ ] Run `npm run test -- --testPathPattern="EntityGroupDetailView"` from `apps/web/` and confirm all tests pass

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from `apps/web/`

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
