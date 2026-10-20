# Objects and parts — Spec

This spec pins the contract for [#829](https://github.com/EnterpriseBT/portal-ai/issues/829) as amended on 2026-10-20.
- Entity records and field mappings are **parts** of their entity, and the entity's permission governs them.
- Entities are **contained** in a connector instance; creating or deleting one needs write on the instance.
- `entity_record` and `field_mapping` leave the permission vocabulary.

Discovery: `docs/AGENT_CHILD_CREATE_AUTHZ.discovery.md` (confirmed 2026-10-20).

## Key decisions (confirmed)

1. **Parts have no permission of their own.**
   - Read on the entity reads every record and mapping in it, every column.
   - Write on the entity lets you create, edit and delete any part, and covers import, revalidate, clear, bulk geocode and bulk transform.
   - There is no create rule for parts. A part's `createdBy` / `sourcePortalId` are provenance only.
2. **Directory rule for entities.**
   - Create: `write` on the instance, plus the entity create rule (owned).
   - Delete: `delete` on the entity, plus `write` on the instance.
   - Update: `write` on the entity only.
3. **404/403 split**, as `ObjectAccessService.loadForVerb` already does it:
   - a missing, other-org or unreadable entity or instance → 404 with that object's not-found code;
   - a readable one without the verb → 403 `PERMISSION_DENIED`.
   - The agent gets `TOOL_TARGET_NOT_FOUND` / `TOOL_PERMISSION_DENIED`.
4. **A curated view conveys its projection.**
   - Reading a view reads its effective projection (minus hidden columns) and its rows.
   - A share writes only `read curated_view:V`.
   - Defining a view needs read on its entity, which covers every column.
5. **Stored rows retire.**
   - A data migration deletes every `permission_statements` / `permission_grants` row whose `resource_type` is `entity_record` or `field_mapping`, or whose `condition` is `in_curated_view`.
   - Retiring a type needs no DDL: `resource_type` is unconstrained `text`. The `condition` CHECK keeps admitting `in_curated_view`, and the `condition_param` column stays (always null).
6. **The owning object always comes from the stored row** for an existing part or entity. Only creates and bulk tools take ids from input, and those ids are checked.
7. **Fail closed** everywhere.

## Scope

### In scope

- **Core:** the vocabulary, `PART_OWNERS` / `OBJECT_CONTAINERS`, the tool descriptor schema and `TOOL_AUTHORIZATION`, and the contracts (the entity list `capability` query).
- **Data:** the migration and the seed.
- **API — records and mappings:**
  - every record and mapping route;
  - the routes that read records through another object (entity-group identity resolution, group members, mapping bidirectional validation and impact).
- **API — entities:** entity PATCH.
- **API — plumbing:**
  - `ParentAccessService`, `ObjectCapabilitiesService`, the permission gate and `RbacObjectResolver`;
  - `CREATE_RULES` / `DERIVED_CAPABILITIES`;
  - `permission-refusal.ts`.
- **Curated views:**
  - grant composition and its cleanup;
  - the `loadSet` expansion;
  - portal SQL and the view payload's column scoping;
  - the view create/update column check.
- **Web:**
  - entity detail, record detail and column-definition gates;
  - the writable-entity picker.
  - The policy editor follows core.
- **Code-review findings:**
  - 1 is resolved by key decision 1;
  - 2 by the server-side `capability=write` filter;
  - 3 by lean parent queries.
- **Docs:**
  - CLAUDE.md and the copilot mirror;
  - tool descriptions, their core mirrors and `system.prompt.ts`;
  - OpenAPI;
  - `route-authorization.map.ts` notes.

### Out of scope

- #827 station reach, and read-side scoping of agent listings.
- Field-mapping delete clearing a counterpart mapping's back-reference in another entity (the low note from the security review). The deleted mapping's own entity is write-checked.
- Dropping `condition_param`, or narrowing the `condition` CHECK. Both are destructive DDL that buys nothing.

## Surface

### Core: `packages/core/src/models/permission.model.ts`

- `PERMISSION_RESOURCE_TYPES` and `DATA_RESOURCE_TYPES` lose `entity_record` and `field_mapping`. `PermissionResourceTypeSchema`, `RESOURCE_PERMISSION_TYPES`, `ResourcePermissionMapSchema` and the policy-authoring contract follow automatically.
- `RESOURCE_CAPABILITIES` loses both entries.
- `CALLER_CAPABILITY_ACTIONS` loses `entity_record.revalidate` and `entity_record.clear`.
- `PERMISSION_CONDITIONS` loses `in_curated_view`. The statement and grant models keep `conditionParam` (always `null`, documented as retired).
- `CHILD_RESOURCE_PARENTS`, `ChildResourceType` and `isChildResourceType` are replaced by:

```ts
/** #829: parts have no permission of their own; their owner's governs them. */
export const PART_OWNERS = {
  entity_record: { ownerType: "entity", ownerKey: "connectorEntityId" },
  field_mapping: { ownerType: "entity", ownerKey: "connectorEntityId" },
} as const satisfies Record<string, { ownerType: PermissionResourceType; ownerKey: string }>;
export type PartType = keyof typeof PART_OWNERS;
export const PART_TYPES = Object.keys(PART_OWNERS) as PartType[];

/** #829: creating or deleting a contained object needs write on its container. */
export const OBJECT_CONTAINERS = {
  entity: { containerType: "connector_instance", containerKey: "connectorInstanceId" },
} as const satisfies Partial<Record<PermissionResourceType, { containerType: PermissionResourceType; containerKey: string }>>;
export type ContainedType = keyof typeof OBJECT_CONTAINERS;
export const isContainedType = (t: string): t is ContainedType =>
  Object.prototype.hasOwnProperty.call(OBJECT_CONTAINERS, t);
```

### Core: `ToolAuthorizationSchema` (`tool-capability.model.ts`)

- `mode` becomes `"create" | "single" | "batch" | "parts"`. `bulk` is removed; only geocode and transform used it.
- Fields:

```ts
/** create on a contained type: input paths naming the container ids. */
containerPaths: z.array(z.string()).min(1).optional(),
/** parts: input paths naming owner (entity) ids. */
objectPaths: z.array(z.string()).min(1).optional(),
/** parts: the part type whose ids targetIdArg / itemsArg+idField name. */
partType: z.enum(PART_TYPES).optional(),
/** parts: input paths naming entities the tool only reads. */
readPaths: z.array(z.string()).min(1).optional(),
```

- `parentPaths` is removed.
- Refines:
  - `parts` ⇒ `resourceType === "entity"`, `verb === "write"`, and either `objectPaths` or `partType` with `targetIdArg` or `itemsArg`+`idField`, not both;
  - `containerPaths` iff `mode === "create" && isContainedType(resourceType)`;
  - `objectPaths` / `partType` / `readPaths` only on `parts`.
- `WRITE_KIND_TO_RESOURCE_TYPE` (unreferenced outside its own file) is removed.

`TOOL_AUTHORIZATION` (`builtin-toolpacks.ts`):

| Tool | Descriptor |
|---|---|
| `entity_record_create`, `field_mapping_create` | `parts`, `objectPaths: ["items[].connectorEntityId"]` |
| `entity_record_update` / `_delete` | `parts`, `partType: "entity_record"`, today's `itemsArg` / `idField` |
| `field_mapping_update` / `_delete` | `parts`, `partType: "field_mapping"`, today's `itemsArg` / `idField` |
| `bulk_geocode_records` | `parts`, `objectPaths: ["connectorEntityId"]` |
| `transform_entity_records` | `parts`, `objectPaths: ["expression.writes[].targetConnectorEntityId"]`, `readPaths: ["sourceConnectorEntityId"]` |
| `connector_entity_create` | `create`, `resourceType: "entity"`, `containerPaths: ["items[].connectorInstanceId"]` |
| `connector_entity_update` | `batch` entity `write` (unchanged) |
| `connector_entity_delete` | `batch` entity `delete` (unchanged; the gate adds the container check) |

All `parts` descriptors carry `resourceType: "entity"` and `verb: "write"`. Locks are unchanged.

### Core: contracts

`ConnectorEntityListRequestQuerySchema` gains `capability: z.enum(["write"]).optional()`. When given, the list holds only entities the caller may write.

### Migration: `npm run db:generate -- --custom --name retire-part-permissions`

```sql
-- #829: records and field mappings are parts of their entity; their permission
-- rows (seeded MemberAccess, custom policies, grants and the curated-view
-- composed field grants) no longer mean anything.
DELETE FROM "permission_grants"
  WHERE "resource_type" IN ('entity_record', 'field_mapping') OR "condition" = 'in_curated_view';
DELETE FROM "permission_statements"
  WHERE "resource_type" IN ('entity_record', 'field_mapping') OR "condition" = 'in_curated_view';
```

- The `.sql`, `meta/_journal.json` and the snapshot are committed together.
- It's DML only, so `lint:migrations` doesn't flag it.
- It must run before the new code reads these tables: drizzle-zod's narrowed enum would otherwise reject the rows. `db:upgrade` runs migrations first.

### Seed

`SeedService`'s MemberAccess spreads `DATA_RESOURCE_TYPES`, so it loses its 8 part statements automatically. Nothing else in the seed names the types.

### API: `ParentAccessService` (`services/parent-access.service.ts`)

Keyed by the two core tables. Lookups select only `id`, `organizationId`, `createdBy` (and the container key for an entity) with `deleted IS NULL`, through `db.select`, never a repository read that decrypts connector credentials.

```ts
/** 404 (owner's code) unless the entity is in org + readable; 403 unless `verb`. */
static assertOwner(set, org, entity: OwnerRow | null | undefined, verb: "read" | "write"): OwnerRow;
static loadOwner(set, org, entityId: string, verb: "read" | "write"): Promise<OwnerRow>;
/** The same for a contained type's container (entity → instance), verb write. */
static assertWritableContainer(set, org, type: ContainedType, container: OwnerRow | null | undefined): OwnerRow;
static loadWritableContainer(set, org, type: ContainedType, containerId: string): Promise<OwnerRow>;
/** A part's owner id from its stored row. */
static ownerIdOf(partType: PartType, row: Record<string, unknown>): string | null;
/** Capabilities of each owner id, from one query: {read, write, delete}. Absent ids are NONE. */
static ownerCapabilities(set, org, ownerType: "entity", ids: string[]): Promise<Map<string, ObjectCapabilities>>;
/** Container ids among `ids` the caller may write (one query). */
static writableContainerIds(set, org, type: ContainedType, ids: string[]): Promise<Set<string>>;
/** For the gate: unchanged from slice 2 (not_found outranks denied). */
static firstRefusal(set, org, type, ids, verb): Promise<ParentRefusal | null>;
```

Not-found codes: `entity` → `CONNECTOR_ENTITY_NOT_FOUND`; `connector_instance` → `CONNECTOR_INSTANCE_NOT_FOUND`.

### API: `PermissionSet.visibilityPredicate`

It gains an optional third argument, `verb: "read" | "write" = "read"`, with identical semantics per verb. The entity list's `capability=write` ANDs the read and write predicates.

### API: routes

**Records** (`entity-record.router.ts`, mounted at `/api/connector-entities/:connectorEntityId/records`). `resolveEntityOrThrow` already 404s an unreadable entity.

| Route | Check after the entity load |
|---|---|
| `GET /`, `GET /count`, `GET /:recordId` | none further. The `visibilityPredicate("entity_record")` at `:329` / `:580` and the `can(read entity_record)` at `:681` are removed, and a record not of this entity stays 404 |
| `POST /` | `assertOwner(…, "write")`. The owned `entity_record` check at `:842` is removed |
| `PATCH` / `DELETE /:recordId` | `assertOwner(…, "write")`; the record must belong to the entity (404 `ENTITY_RECORD_NOT_FOUND`). The record `loadForVerb` at `:1426` / `:1590` is removed |
| `POST /import`, `POST /revalidate`, `DELETE /` (clear) | `assertOwner(…, "write")`, replacing the class checks at `:1034` / `:1243` / `:1728` |

**Field mappings** (`field-mapping.router.ts`):

| Route | Check |
|---|---|
| `GET /` | visibility from the entity: `connectorEntityId IN (SELECT id FROM connector_entities WHERE org AND <entity read predicate>)`, replacing `visibilityPredicate("field_mapping")` at `:186` |
| `GET /:id`, `GET /:id/impact`, `GET /:id/validate-bidirectional` | `loadReadableMapping` loads the mapping org-scoped, then `assertOwner(…, "read")` on its entity (404 `FIELD_MAPPING_NOT_FOUND` when either is unreadable). The impact counterpart (`:1030`) and the bidirectional record read (`:1354`) check their entity's read the same way |
| `POST /` | `loadOwner(…, connectorEntityId, "write")`. The owned `field_mapping` check at `:464` is removed |
| `PATCH` / `DELETE /:id` | load the mapping org-scoped (404 unless its entity is readable), then `loadOwner(…, mapping.connectorEntityId, "write")`, replacing `loadForVerb` on the mapping |

**Entities** (`connector-entity.router.ts`):

| Route | Check |
|---|---|
| `GET /` | `capability=write` → `and(visibility(read), visibility(write))` |
| `PATCH /:id` | `loadForVerb(entity, "write")` only. The instance check at `:797` is removed |
| `POST /`, `DELETE /:id` | unchanged: instance write, plus owned create or entity delete |

**Records read through other objects:**
- `entity-group.router.ts:1053` and `entity-group-member.router.ts:860`: the record visibility predicate is replaced by restricting to member entities the caller can read (`visibilityPredicate("entity")` on the joined entity).
- `curated-view.router.ts`: see Curated views.

OpenAPI `403`/`404` descriptions for these routes name write (or read) on the entity. `route-authorization.map.ts` notes follow.

### API: permission service

- `CREATE_RULES` loses `entity_record` and `field_mapping`; it's a `Record` over the narrowed type.
- `DERIVED_CAPABILITIES` loses both entries.
- `loadSet` loses the `in_curated_view` expansion (`:192–270`).
- `permission-refusal.ts` `TYPE_LABELS` loses both.
- `RbacObjectResolver` loses its part finders and gains `resolvePartOwner(org, partType, id): Promise<string | null>`, which loads the part org-scoped and returns its owner id.

### API: capabilities (`object-capabilities.service.ts`)

- `for` / `attach` take `Exclude<PermissionResourceType, ContainedType>`.
- `attachContained(set, org, "entity", rows)`:
  - `read` and `write` are the row's own;
  - `delete` is the row's own delete ∧ container writable (one `writableContainerIds` per page).
- `attachParts(set, org, partType, rows)`:
  - each row's capabilities are `{ read, write, delete: write }` of its owner, from one `ownerCapabilities` per page;
  - absent or unreadable owners give `NONE`.
- Call sites:
  - entities: `connector-entity.router.ts:250, 380` (`attachContained`);
  - mappings: `field-mapping.router.ts:239, 339` (`attachParts`);
  - records: `entity-record.router.ts:509, 704` (`attachParts`).

### API: permission gate (`permission-gate.service.ts`)

All checks sit inside the existing `try`; it stays fail-closed.

| Mode | Check |
|---|---|
| `parts` | 1. Owner ids are `objectPaths` values plus `resolvePartOwner` of each part id; any unresolvable part → denied. 2. No ids at all → denied. 3. `readPaths` → `firstRefusal(entity, ids, "read")`. 4. Owners → `firstRefusal(entity, ids, "write")` |
| `create` | `containerPaths` (required for a contained type; empty → denied) → `firstRefusal(container, ids, "write")`, then the owned create check |
| `single` / `batch` | the per-object check as today. When `verb === "delete"` on a contained type, the stored rows' container ids → `firstRefusal(container, ids, "write")` |

- Results are as slice 4 had them: `not_found` → `TOOL_TARGET_NOT_FOUND` "Entity e-1 was not found."; `denied` → `TOOL_PERMISSION_DENIED` "You don't have permission to edit entity e-1."
- The fallback message reads "…to write this entity".

### Curated views

- **`grant.service.ts:162–180`:** a curated-view share composes nothing extra. The re-share and revoke paths stop deleting the composed grant (`:197`, `:313`).
- **Repository:** `permission-grants.repository.ts` loses `hardDeleteInCuratedViewFieldGrant` and `hardDeleteFieldGrantsByCuratedViews`. `curated-view-delete.service.ts:92` drops the call.
- **Portal SQL:**
  - `resolveOneViewColumns` returns the effective projection minus `VIEW_HIDDEN_COLUMNS`, with no `can`;
  - both `isDenied("read", "entity_record")` kill switches (`:305–310`, `:438`) are removed;
  - a view is readable iff `can(read curated_view)`.
- **Payload:** `CuratedViewPayloadService.scopeFieldMappingIds` is removed; payloads carry the full projection.
- **View create/update (`curated-view.router.ts:216`):** the per-column read check is removed (entity read is already required). `ApiCode.CURATED_VIEW_FIELD_NOT_READABLE` is removed.
- `wideTableStatementCache` columns stop needing `fieldMappingCreatedBy` for authorization. The field stays if anything else reads it.

### Web (`apps/web/src`)

- **`entity-actions.util.ts`:** `RecordPermissions` is removed. `createRecord`, `clearRecords` and `revalidate` gate on the entity's `capabilities.write`. `entityRecordActionGates` and `fieldMappingRowGates` are unchanged: they read the part's capabilities, which are now the entity's.
- **`EntityDetail.view.tsx:674–677`:** the `canOnResource("entity_record", "create")` and the two derived caps are removed.
- **`EntityRecordDetail.view.tsx:548`:** `canRevalidate={record.capabilities.write}`.
- **`ColumnDefinitionDetail.view.tsx`:**
  - Create field mapping no longer reads `canOnResource("field_mapping", "create")`; it's allowed for page readers;
  - the dialog's entity picker searches with `defaultParams: { capability: "write" }`, with no-options text "No entities you can edit";
  - `SearchHookOptions.filterItem` and `ConnectorEntityRow` from slice 5 are removed.
- **Policy editor:** follows core with no change. A test pins that the two types are absent.

### Docs

- **CLAUDE.md:**
  - "12 per-object types" becomes 10 objects, plus records and mappings carrying their entity's capabilities;
  - the derived-capability bullet drops the two record caps;
  - the Authorization bullets state objects and parts, the directory rule and `PART_OWNERS` / `OBJECT_CONTAINERS`, replacing the #829 "child write needs parent write" bullet;
  - the curated-view sharing note says a share conveys the projection.
- **Copilot mirror:** the same changes.
- **Tool descriptions:**
  - record and mapping tools: "Needs write permission on the entity.";
  - entity update: "Needs write permission on the entity." (no connector);
  - entity create/delete: "…and write permission on its connector.";
  - both sides of each mirror are updated.
- **`system.prompt.ts`:** the paragraph is reworded accordingly.

## TDD test plan

Run per package with `npm run test:unit`, and `npm run test:integration` for api. Never raw jest.

### core

- `__tests__/models/permission.model.test.ts`:
  - the two types and `in_curated_view` are absent;
  - `PART_OWNERS` / `OBJECT_CONTAINERS` shape;
  - `isContainedType`.
  (3)
- `__tests__/models/tool-capability.model.test.ts`, replacing slice 1's cases:
  - `parts` without targets → reject;
  - `parts` with both target forms → reject;
  - `parts` on a non-entity type → reject;
  - `containerPaths` missing on an entity create → reject;
  - `containerPaths` off create → reject;
  - `readPaths` off parts → reject;
  - `bulk` → reject.
  (7)
- `__tests__/registries/builtin-toolpacks.test.ts`:
  - every record/mapping tool is `parts`;
  - every `partType` is in `PART_OWNERS`;
  - transform reads its source.
  (3)
- `__tests__/contracts/organization.contract.test.ts` / `grant.contract.test.ts`: fixtures updated.

### api unit

- `parent-access.service.test.ts`, reworked:
  - `assertOwner` read/write splits;
  - other org → 404;
  - the container check;
  - `ownerCapabilities` for a mixed set in one query;
  - lean select (never `connectorInstances.findById`);
  - `firstRefusal` ordering.
  (8)
- `permission-gate.service.test.ts`:
  - parts by `objectPaths`: unreadable / read-only / writable / empty;
  - parts by part id: owner taken from the row, not the input; unresolvable part → denied;
  - `readPaths` unreadable → not found;
  - entity create container read-only → denied;
  - entity delete container read-only → denied;
  - entity update ignores the container;
  - throw → denied.
  (12)
- `object-capabilities.service.test.ts`:
  - `attachParts` mirrors the owner, with delete = write;
  - an unreadable owner → `NONE`;
  - `attachContained` delete folds the container while write doesn't;
  - one query per page.
  (4)
- `permission-set.test.ts`: `visibilityPredicate` with `verb: "write"`. (2)
- `permission-create.service.test.ts`, `permission-refusal.test.ts`: the retired entries are removed.

### api integration

- **`routes/child-write-parent.agreement.integration.test.ts`**, renamed `parts-and-containers.agreement.integration.test.ts`:
  - **Records and mappings** × entity {unreadable, read-only, writable}:
    - REST list/GET, create, update and delete of a part **someone else created**: 404 / 403 / success;
    - the agent tool;
    - `capabilities` equal to the entity's.
  - **Import, revalidate and clear** on a read-only entity → 403.
  - **Entities** × instance {unreadable, read-only, writable}:
    - create: 404 / 403 / 201;
    - delete: 404 / 403 / 200;
    - update succeeds with entity write under a read-only instance;
    - the agent tools agree.
  - **Transform:** another-org target → not found; read-only target → denied; nothing enqueued.
  (≈12 `it`s)
- **`object-capabilities.agreement.integration.test.ts`:** record and mapping rows mirror their entity; entity delete folds the instance. (2)
- **`retire-part-permissions.migration.integration.test.ts`** (new):
  - insert statements and grants on both types, plus an `in_curated_view` grant and unrelated rows;
  - apply the migration SQL;
  - the part rows are gone and the unrelated rows remain.
  (2)
- **Curated views:**
  - **`grant.router`:** a share writes one grant.
  - **`portal-sql.service`:** a shared view's columns are its projection for a reader who can't read the entity.
  - **`curated-view.router`:** a view create with entity read succeeds for any column; the `FIELD_NOT_READABLE` cases are removed.
  - **Deletions:** `rbac-fk-expansion` is deleted; the field-grant cases in `curated-view-delete.service` are removed.
  (4)
- **Fixture and expectation updates:**
  - `permission-loadset`, `member-data-delete-backfill`, `reset.service`: MemberAccess has no part statements;
  - `field-mapping.router`, `connector-entity.router` (PATCH under a read-only instance now 200), `creates-and-children`, `same-org-access`, `create-capability.agreement`, `rbac-object-search`, `entity-group.router`, `organization.router`: expectations updated for the removed types and caps;
  - `agent-create-existing-key`: unchanged.

### web

- **`entity-actions.util.test.ts`:** createRecord, clear and revalidate follow the entity's `write`. (3)
- **`ColumnDefinitionDetailView.test.tsx`:** the picker requests `capability=write` and shows "No entities you can edit". (2)
- **`AccessAuthoring.test.tsx`:** the resource-type list omits the two types. (1)
- **Retired:** slice 5's `filterItem` test.

**Totals ≈ 75 cases** (new or changed).

## Acceptance criteria

- [ ] **Reads.** A user who can read an entity sees every record and mapping in it, including other users'. A user who can't gets 404 on REST, and the agent's tools refuse with `TOOL_TARGET_NOT_FOUND`.
- [ ] **Writes.** A user who can write an entity can create, edit and delete any record or mapping in it, import, revalidate and clear, and run geocode and transform on it, over REST and through the agent. With read only, each is `403 PERMISSION_DENIED` / `TOOL_PERMISSION_DENIED` and nothing is written.
- [ ] **Entities.**
  - Creating an entity needs write on its connector. Deleting it needs delete on the entity plus write on the connector.
  - Renaming or tagging it needs only write on the entity.
  - An unreadable connector → 404 `CONNECTOR_INSTANCE_NOT_FOUND`.
- [ ] **Capabilities.**
  - A record's or mapping's `capabilities` equal its entity's, with delete = write.
  - An entity's `delete` folds in the connector's write; its `write` doesn't.
  - Add record, import, revalidate and clear show exactly when the entity is writable.
- [ ] **Policy vocabulary.**
  - The policy editor no longer offers records or field mappings.
  - After `db:upgrade`, no `permission_statements` / `permission_grants` row names them, or `in_curated_view`.
  - MemberAccess has no part statements.
- [ ] **Curated views.**
  - Sharing a view lets the recipient read its projected columns and rows without entity read.
  - A view's columns are its projection.
  - Creating a view needs entity read.
- [ ] **Mapping picker.** It lists only entities the caller can write, across pages, with the empty state "No entities you can edit".
- [ ] **No decryption.** Parent and owner lookups never decrypt connector credentials.
- [ ] **Default members** can't write under the Sandbox connector or demo entities, and can write under their own.

## Risks & rollback

- **Widened reads and writes by design.**
  - A member with read on a shared entity now sees every row in it.
  - A member with write can change anyone's rows.
  - Row-level restriction is a curated view's job.
  - Called out in the PR.
- **Deleted custom statements.** A custom **deny** on records or mappings disappears with the migration, which widens access in an org that authored one. The PR lists the app-dev count; prod has no release before the mock install.
- **Rollback.** Reverting the code doesn't restore the deleted policy rows; the seed or backfill would have to recreate MemberAccess's part statements. Accepted: the rows are meaningless under the new model, and a revert is unlikely after merge.
- **Missed path.** A route or tool still naming a retired type fails tsc: the core enum narrows `PermissionResourceType`, and `set.can`/`check` are typed on it. The agreement matrix covers behaviour.
- **Fail closed.** A transient error refuses the write. That's safe.

## Files touched

- **core:**
  - `models/permission.model.ts`, `models/tool-capability.model.ts`, `registries/builtin-toolpacks.ts`;
  - `contracts/connector-entity.contract.ts` (list query);
  - tests as above.
- **api:**
  - **migration:** `drizzle/01xx_retire-part-permissions.sql` + meta;
  - **services:** `parent-access.service.ts`, `object-capabilities.service.ts`, `permission-gate.service.ts`, `rbac-object-resolver.ts`, `permission.service.ts`, `permission-set.ts`, `permission-refusal.ts`, `grant.service.ts`, `curated-view-delete.service.ts`, `curated-view-payload.service.ts`, `portal-sql.service.ts`;
  - **repository:** `permission-grants.repository.ts`;
  - **routes:** `entity-record.router.ts`, `field-mapping.router.ts`, `connector-entity.router.ts`, `entity-group.router.ts`, `entity-group-member.router.ts`, `curated-view.router.ts`;
  - **constants:** `api-codes.constants.ts`;
  - **tools:** the eleven `.tool.ts` descriptions;
  - **prompts:** `system.prompt.ts`;
  - **config:** `route-authorization.map.ts`;
  - tests as above.
- **web:**
  - `utils/entity-actions.util.ts`;
  - `views/EntityDetail.view.tsx`, `views/EntityRecordDetail.view.tsx`, `views/ColumnDefinitionDetail.view.tsx`;
  - `api/connector-entities.api.ts`, `api/types.ts`;
  - tests as above.
- **docs:** `CLAUDE.md`, `.github/copilot-instructions.md`.

## Next step

`docs/AGENT_CHILD_CREATE_AUTHZ.plan.md` reworks the branch in six TDD commits on top of the existing ones. Behaviour moves first, while the old types still compile; the vocabulary retires last, once nothing reads it:
1. Core tables and `ParentAccessService` (lean lookups, owner/container API), plus `visibilityPredicate` by verb.
2. Routes, capabilities and web gates.
3. Curated views.
4. Permission gate and descriptors.
5. Retire the vocabulary: core types, create rules, derived caps, migration and seed.
6. Docs.
