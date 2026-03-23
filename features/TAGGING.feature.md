# Entity Tagging — Implementation Plan

Flat, org-scoped tags that can be assigned to `connector_entities` for organizational navigation. No hierarchy. Tags are purely metadata — no changes to column definitions, field mappings, or entity records.

---

## Step 1: Core Models

**Files:**
- `packages/core/src/models/entity-tag.model.ts` (new)
- `packages/core/src/models/entity-tag-assignment.model.ts` (new)
- `packages/core/src/models/index.ts` (update)

### Checklist

- [ ] Create `entity-tag.model.ts`
  - [ ] Define `EntityTagSchema` extending `CoreSchema` with fields: `organizationId`, `name` (min 1), `color` (nullable), `description` (nullable)
  - [ ] Export `EntityTag` type inferred from schema
  - [ ] Export `EntityTagModel` class extending `CoreModel<EntityTag>` with `get schema()`, `parse()`, `validate()`
  - [ ] Export `EntityTagModelFactory` class extending `ModelFactory<EntityTag, EntityTagModel>` with `create(createdBy)`
- [ ] Create `entity-tag-assignment.model.ts`
  - [ ] Define `EntityTagAssignmentSchema` extending `CoreSchema` with fields: `organizationId`, `connectorEntityId`, `entityTagId`
  - [ ] Export `EntityTagAssignment` type inferred from schema
  - [ ] Export `EntityTagAssignmentModel` class extending `CoreModel<EntityTagAssignment>` with `get schema()`, `parse()`, `validate()`
  - [ ] Export `EntityTagAssignmentModelFactory` class extending `ModelFactory<EntityTagAssignment, EntityTagAssignmentModel>` with `create(createdBy)`
- [ ] Update `models/index.ts`
  - [ ] Add `export * from "./entity-tag.model.js"`
  - [ ] Add `export * from "./entity-tag-assignment.model.js"`

### Verification

- [ ] `npm run type-check` passes from repo root

---

## Step 2: Database Tables

**Files:**
- `apps/api/src/db/schema/entity-tags.table.ts` (new)
- `apps/api/src/db/schema/entity-tag-assignments.table.ts` (new)
- `apps/api/src/db/schema/index.ts` (update)

### Checklist

- [ ] Create `entity-tags.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `name` — `text`, not null
  - [ ] Add `color` — `text`, nullable
  - [ ] Add `description` — `text`, nullable
  - [ ] Export as `entityTags`
- [ ] Create `entity-tag-assignments.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `connectorEntityId` — `text`, not null, FK → `connector_entities.id`
  - [ ] Add `entityTagId` — `text`, not null, FK → `entity_tags.id`
  - [ ] Add `unique("entity_tag_assignments_entity_tag_unique")` on `(connectorEntityId, entityTagId)`
  - [ ] Export as `entityTagAssignments`
- [ ] Update `schema/index.ts`
  - [ ] Add `export { entityTags } from "./entity-tags.table.js"`
  - [ ] Add `export { entityTagAssignments } from "./entity-tag-assignments.table.js"`
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
  - [ ] Import `entityTags` and `entityTagAssignments` from their table files
  - [ ] Add `EntityTagSelectSchema = createSelectSchema(entityTags)` and `EntityTagInsertSchema = createInsertSchema(entityTags)`
  - [ ] Export `EntityTagSelect` and `EntityTagInsert` types
  - [ ] Add `EntityTagAssignmentSelectSchema = createSelectSchema(entityTagAssignments)` and `EntityTagAssignmentInsertSchema = createInsertSchema(entityTagAssignments)`
  - [ ] Export `EntityTagAssignmentSelect` and `EntityTagAssignmentInsert` types
- [ ] Update `type-checks.ts`
  - [ ] Import `EntityTag` and `EntityTagAssignment` from `@portalai/core/models`
  - [ ] Import `EntityTagSelect`, `EntityTagAssignmentSelect` from `./zod.js`
  - [ ] Import `entityTags` and `entityTagAssignments` table types
  - [ ] Add bidirectional `IsAssignable` checks for `EntityTagSelect` ↔ `EntityTag`
  - [ ] Add `InferSelectModel` check for `entityTags` → `EntityTag`
  - [ ] Add bidirectional `IsAssignable` checks for `EntityTagAssignmentSelect` ↔ `EntityTagAssignment`
  - [ ] Add `InferSelectModel` check for `entityTagAssignments` → `EntityTagAssignment`

### Verification

- [ ] `npm run type-check` passes from repo root — confirms core models are in sync with Drizzle tables
- [ ] `npm run build` passes from repo root

---

## Step 4: Repositories

**Files:**
- `apps/api/src/db/repositories/entity-tags.repository.ts` (new)
- `apps/api/src/db/repositories/entity-tag-assignments.repository.ts` (new)
- `apps/api/src/db/repositories/index.ts` (update)
- `apps/api/src/services/db.service.ts` (update)

### Checklist

- [ ] Create `entity-tags.repository.ts`
  - [ ] Extend `Repository<typeof entityTags, EntityTagSelect, EntityTagInsert>`
  - [ ] Implement `findByOrganizationId(organizationId, opts?)` — filters by org + not deleted, ordered by `name` ASC
  - [ ] Implement `findByName(organizationId, name)` — exact match within org, returns single row or undefined (used for duplicate name validation)
  - [ ] Export singleton `entityTagsRepo`
- [ ] Create `entity-tag-assignments.repository.ts`
  - [ ] Extend `Repository<typeof entityTagAssignments, EntityTagAssignmentSelect, EntityTagAssignmentInsert>`
  - [ ] Implement `findByConnectorEntityId(connectorEntityId)` — returns assignments with their tag details batch-loaded (join or two-query pattern matching existing repos)
  - [ ] Implement `findByEntityTagId(entityTagId)` — all assignments for a given tag
  - [ ] Implement `findByConnectorEntityIds(ids[])` — batch-loads assignments + tag details for a set of entity IDs; returns a `Map<connectorEntityId, EntityTagSelect[]>` for efficient assembly in list responses
  - [ ] Implement `findExisting(connectorEntityId, entityTagId)` — returns existing non-deleted assignment or undefined (used for duplicate detection before create)
  - [ ] Export singleton `entityTagAssignmentsRepo`
- [ ] Update `repositories/index.ts`
  - [ ] Add `export * from "./entity-tags.repository.js"`
  - [ ] Add `export * from "./entity-tag-assignments.repository.js"`
- [ ] Update `db.service.ts`
  - [ ] Import `entityTagsRepo` and `entityTagAssignmentsRepo`
  - [ ] Add `entityTags: entityTagsRepo` to `DbService.repository`
  - [ ] Add `entityTagAssignments: entityTagAssignmentsRepo` to `DbService.repository`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 5: API Contracts

**Files:**
- `packages/core/src/contracts/entity-tag.contract.ts` (new)
- `packages/core/src/contracts/entity-tag-assignment.contract.ts` (new)
- `packages/core/src/contracts/index.ts` (update)

### Checklist

- [ ] Create `entity-tag.contract.ts`
  - [ ] `EntityTagListRequestQuerySchema` — extends `PaginationRequestQuerySchema` with optional `search: z.string()` and `sortBy: z.enum(["name", "created"])`
  - [ ] `EntityTagListResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `entityTags: z.array(EntityTagSchema)`
  - [ ] `EntityTagWithAssignmentCountSchema` — `EntityTagSchema.extend({ assignmentCount: z.number().int().min(0) })` for enriched list views
  - [ ] `EntityTagGetResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] `EntityTagCreateRequestBodySchema` — `{ name: z.string().min(1), color: z.string().optional(), description: z.string().optional() }`
  - [ ] `EntityTagCreateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] `EntityTagUpdateRequestBodySchema` — all fields optional (`name?`, `color?`, `description?`), refine to require at least one field present
  - [ ] `EntityTagUpdateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] Export all schemas and their inferred types
- [ ] Create `entity-tag-assignment.contract.ts`
  - [ ] `EntityTagAssignmentCreateRequestBodySchema` — `{ entityTagId: z.string() }`
  - [ ] `EntityTagAssignmentCreateResponsePayloadSchema` — `{ entityTagAssignment: EntityTagAssignmentSchema }`
  - [ ] `EntityTagAssignmentListResponsePayloadSchema` — `{ tags: z.array(EntityTagSchema) }` (returns the tag objects, not raw assignments)
  - [ ] `ConnectorEntityWithTagsSchema` — `ConnectorEntitySchema.extend({ tags: z.array(EntityTagSchema) })`
  - [ ] `ConnectorEntityListWithTagsResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `connectorEntities: z.array(ConnectorEntityWithTagsSchema)`
  - [ ] Export all schemas and their inferred types
- [ ] Update `contracts/index.ts`
  - [ ] Add `export * from "./entity-tag.contract.js"`
  - [ ] Add `export * from "./entity-tag-assignment.contract.js"`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 6: API Error Codes

**Files:**
- `apps/api/src/constants/api-codes.constants.ts` (update)

### Checklist

- [ ] Add Entity Tag codes:
  - [ ] `ENTITY_TAG_NOT_FOUND`
  - [ ] `ENTITY_TAG_FETCH_FAILED`
  - [ ] `ENTITY_TAG_INVALID_PAYLOAD`
  - [ ] `ENTITY_TAG_CREATE_FAILED`
  - [ ] `ENTITY_TAG_UPDATE_FAILED`
  - [ ] `ENTITY_TAG_DELETE_FAILED`
  - [ ] `ENTITY_TAG_DUPLICATE_NAME`
  - [ ] `ENTITY_TAG_USER_NOT_FOUND`
- [ ] Add Entity Tag Assignment codes:
  - [ ] `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`
  - [ ] `ENTITY_TAG_ASSIGNMENT_FETCH_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_CREATE_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_DELETE_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`

### Verification

- [ ] `npm run type-check` passes from repo root

---

## Step 7: API Routes

**Files:**
- `apps/api/src/routes/entity-tag.router.ts` (new)
- `apps/api/src/routes/entity-tag-assignment.router.ts` (new)
- `apps/api/src/routes/connector-entity.router.ts` (update)
- `apps/api/src/routes/protected.router.ts` (update)

### Checklist

- [ ] Create `entity-tag.router.ts`
  - [ ] `GET /` — list tags scoped to org; support `search` (ilike on `name`), `limit`, `offset`, `sortBy` (name/created), `sortOrder`; use `EntityTagListRequestQuerySchema` to parse query
  - [ ] `GET /:id` — fetch single tag by ID; 404 with `ENTITY_TAG_NOT_FOUND` if missing
  - [ ] `POST /` — create tag; validate with `EntityTagCreateRequestBodySchema`; call `findByName` to detect duplicate name within org, return 409 with `ENTITY_TAG_DUPLICATE_NAME` if found; use `EntityTagModelFactory` to build the record
  - [ ] `PATCH /:id` — update tag; validate with `EntityTagUpdateRequestBodySchema`; if `name` is changing, re-run `findByName` duplicate check; 404 if tag not found
  - [ ] `DELETE /:id` — soft-delete tag; also soft-delete all its assignments by calling `entityTagAssignmentsRepo.softDeleteMany` filtered by `entityTagId`; wrap both in a `DbService.transaction`; 404 if tag not found
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Create `entity-tag-assignment.router.ts`
  - [ ] `GET /` — list tags assigned to `:connectorEntityId`; returns `EntityTagAssignmentListResponsePayload`
  - [ ] `POST /` — assign a tag to `:connectorEntityId`; validate `EntityTagAssignmentCreateRequestBodySchema`; verify the tag exists and belongs to the same org; call `findExisting` to detect duplicate, return 409 with `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` if found; use `EntityTagAssignmentModelFactory` to build the record
  - [ ] `DELETE /:assignmentId` — soft-delete the assignment; 404 if assignment not found
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Update `connector-entity.router.ts`
  - [ ] Import and mount: `connectorEntityRouter.use("/:connectorEntityId/tags", entityTagAssignmentRouter)`
  - [ ] Update `include` query param enum to add `"tags"` as a valid value
  - [ ] In the `GET /` handler, add a branch for `include === "tags"` that calls a `findManyWithTags` method (batch-loads via `entityTagAssignmentsRepo.findByConnectorEntityIds`) and returns `ConnectorEntityListWithTagsResponsePayload`
- [ ] Update `protected.router.ts`
  - [ ] Import `entityTagRouter`
  - [ ] Add `protectedRouter.use("/entity-tags", entityTagRouter)`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] Manually verify routes are visible in Swagger UI at `http://localhost:3001/api-docs`

---

## Step 8: API Tests

**Files:**
- `apps/api/src/__tests__/__integration__/routes/entity-tag.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/routes/entity-tag-assignment.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tags.repository.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tag-assignments.repository.integration.test.ts` (new)

### Checklist

- [ ] `entity-tags.repository.integration.test.ts`
  - [ ] `findByOrganizationId` returns tags scoped to org, excludes soft-deleted
  - [ ] `findByName` returns correct row on match, undefined on miss
  - [ ] `create` inserts and returns full row
  - [ ] `update` modifies fields correctly
  - [ ] `softDelete` sets `deleted` and excludes row from subsequent reads
- [ ] `entity-tag-assignments.repository.integration.test.ts`
  - [ ] `findByConnectorEntityId` returns enriched assignments with tag details
  - [ ] `findByConnectorEntityIds` batch-loads correctly for multiple entity IDs
  - [ ] `findExisting` detects existing assignment, returns undefined for non-existent
  - [ ] Unique constraint prevents duplicate `(connectorEntityId, entityTagId)` at DB level
- [ ] `entity-tag.router.integration.test.ts`
  - [ ] `GET /api/entity-tags` returns paginated list scoped to org
  - [ ] `GET /api/entity-tags` with `search` filters by name
  - [ ] `GET /api/entity-tags/:id` returns 200 for valid ID, 404 for unknown
  - [ ] `POST /api/entity-tags` creates tag, returns 201
  - [ ] `POST /api/entity-tags` returns 409 on duplicate name within org
  - [ ] `PATCH /api/entity-tags/:id` updates fields, returns 200
  - [ ] `PATCH /api/entity-tags/:id` returns 409 if new name conflicts with existing tag
  - [ ] `DELETE /api/entity-tags/:id` soft-deletes tag and its assignments, returns 200
  - [ ] `DELETE /api/entity-tags/:id` returns 404 for unknown ID
- [ ] `entity-tag-assignment.router.integration.test.ts`
  - [ ] `GET /api/connector-entities/:id/tags` returns assigned tags
  - [ ] `POST /api/connector-entities/:id/tags` assigns a tag, returns 201
  - [ ] `POST /api/connector-entities/:id/tags` returns 409 if already assigned
  - [ ] `DELETE /api/connector-entities/:id/tags/:assignmentId` removes assignment, returns 200
  - [ ] `GET /api/connector-entities?include=tags` returns entities with tags array populated

### Verification

- [ ] `npm run test` passes from repo root

---

## Step 9: Frontend

**Files:**
- `apps/web/src/routes/settings/tags.tsx` (new)
- Tag-related components and hooks per workflow/feature conventions

### Checklist

- [ ] Add `GET /api/entity-tags` and assignment endpoints to the web API client / TanStack Query hooks
- [ ] Connector Entities list view
  - [ ] Pass `include=tags` query param when fetching entities
  - [ ] Render assigned tags as MUI `Chip` components in each row
  - [ ] Add a tag multi-select filter above the list; applying it re-fetches with selected `tagId` query params (API filters to entities that have any/all selected tags)
- [ ] Entity detail view
  - [ ] Display assigned tags as chips in the metadata section
  - [ ] Add inline tag assignment: searchable select populated from `GET /api/entity-tags`
  - [ ] Clicking chip X calls `DELETE` on the assignment
- [ ] Settings — Tags management page (`/settings/tags`)
  - [ ] Create route file `apps/web/src/routes/settings/tags.tsx`
  - [ ] Add "Tags" link to the settings sidebar nav
  - [ ] Render a table listing all org tags: name, color swatch, assignment count, edit and delete actions
  - [ ] "New tag" opens a modal/drawer with name, color picker, and description fields
  - [ ] Edit action opens the same modal pre-populated
  - [ ] Delete action shows a confirmation dialog warning that assignments will also be removed

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root

---

## Final Verification

Run all checks from the repo root in order:

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`
