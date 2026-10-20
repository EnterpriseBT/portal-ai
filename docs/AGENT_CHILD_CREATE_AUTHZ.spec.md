# Child writes require write on the parent — Spec

This spec pins the contract for [#829](https://github.com/EnterpriseBT/portal-ai/issues/829): every create, update or delete of a child requires explicit `write` on its parent. The rule holds on REST routes and agent tools, and it shows in the `capabilities` the UI renders from. Discovery: `docs/AGENT_CHILD_CREATE_AUTHZ.discovery.md`.

## Key decisions (flag for review)

1. **Read means read only.** A child write needs `resource.write` on its parent, granted explicitly; there are no heuristics or carve-outs. The seeded `MemberAccess` policy is **unchanged**, so a default member can no longer write children under system-owned parents (the Sandbox connector, demo entities).
2. **The 404/403 split** is the one `ObjectAccessService.loadForVerb` already implements:
   - unreadable, absent or other-org parent → 404 with the parent's not-found code;
   - readable but not writable → 403 `PERMISSION_DENIED`.

   The agent gets the same split as `TOOL_TARGET_NOT_FOUND` / `TOOL_PERMISSION_DENIED`.
3. **One table, `CHILD_RESOURCE_PARENTS` in core**, is read by the routes, the permission gate, the capability computation and a guard test. The child's parent id always comes from the **stored row** for an existing child. Only creates take it from input.
4. **Referenced objects need read, not write:** a group member's entity, a curated view's entity, a transform's source entity.
5. **Fail closed** everywhere: any error resolving a parent denies.
6. **Capabilities fold the parent in:** a child row's `write`/`delete` is false unless its parent is writable. The UI's "add" buttons gate on the parent row's `capabilities.write`.

## Scope

### In scope
- Child pairs:

  | Child | Parent |
  |---|---|
  | `field_mapping`, `entity_record` | `entity` |
  | `entity` | `connector_instance` |

  This covers every REST route and agent tool that creates, updates or deletes them, including bulk geocode and bulk transform.
- Group members and tag assignments, which already require parent write, move onto the shared helper. Group-member POST and curated-view create gain a read check on the entity they reference.
- `ObjectCapabilitiesService` for the three child types, and the six routes that attach it.
- The web gates for Add record, New entity, Create field mapping, and the mapping dialog's entity picker.
- CLAUDE.md and copilot mirror; the tool descriptions, their `builtin-toolpacks.ts` mirrors, and `system.prompt.ts`.

### Out of scope
- Seed or policy changes (Key decision 1).
- #827 station reach.
- Read-side listing scope.
- Record import, revalidate and clear. They keep their class-level checks, which already require an unconditional `entity_record` grant. That isn't parent write, and is recorded in Risks.

## Surface

### Core: `packages/core/src/models/permission.model.ts`

```ts
/** #829: a child write requires write on its parent. The key on the child row
 *  (and on a create's input item) that holds the parent's id. */
export const CHILD_RESOURCE_PARENTS = {
  entity:        { parentType: "connector_instance", parentKey: "connectorInstanceId" },
  field_mapping: { parentType: "entity",             parentKey: "connectorEntityId" },
  entity_record: { parentType: "entity",             parentKey: "connectorEntityId" },
} as const satisfies Record<string, { parentType: PermissionResourceType; parentKey: string }>;
export type ChildResourceType = keyof typeof CHILD_RESOURCE_PARENTS;
export const isChildResourceType = (t: string): t is ChildResourceType => t in CHILD_RESOURCE_PARENTS;
```

### Core: `ToolAuthorizationSchema` (`packages/core/src/models/tool-capability.model.ts:354`)

Add two fields. Paths use the lock gate's dotted syntax, where `[]` fans out over an array (`valuesAtPath`, `apps/api/src/services/lock-gate.service.ts:98`).

```ts
/** #829: input paths naming the parent ids, for `create` and `bulk` on a child type.
 *  `batch`/`single` never declare it: the parent comes from the stored row. */
parentPaths: z.array(z.string()).min(1).optional(),
/** #829: input paths naming entities the tool only reads (each must be readable). */
readPaths: z.array(z.string()).min(1).optional(),
```

The refine is extended so that:
- `parentPaths` is required iff `mode ∈ {create, bulk}` and `isChildResourceType(resourceType)`;
- `parentPaths` is forbidden on `single`/`batch`;
- `readPaths` is allowed only on `bulk`.

`TOOL_AUTHORIZATION` (`builtin-toolpacks.ts:1746`) gains:

| Tool | `parentPaths` | `readPaths` |
|---|---|---|
| `entity_record_create`, `field_mapping_create` | `["items[].connectorEntityId"]` | — |
| `connector_entity_create` | `["items[].connectorInstanceId"]` | — |
| `bulk_geocode_records` | `["connectorEntityId"]` | — |
| `transform_entity_records` | `["expression.writes[].targetConnectorEntityId"]` | `["sourceConnectorEntityId"]` |

The comment at `:1840–1841` ("the gate does not pre-flight them") is replaced. Bulk is pre-flighted for class-level write **and** parent write.

### API: `apps/api/src/services/parent-access.service.ts` (new)

```ts
export class ParentAccessService {
  /** Load the parent of a child type org-scoped; 404 (the parent's not-found code)
   *  unless readable, 403 PERMISSION_DENIED unless writable. Returns the row. */
  static async loadWritableParent(set: PermissionSet, organizationId: string,
    childType: ChildResourceType, parentId: string): Promise<OwnedParentRow>;
  /** The same check, for an already loaded parent row (routes that hold it). */
  static assertWritableParent(set, organizationId, childType, parent: OwnedParentRow | null | undefined): OwnedParentRow;
  /** Ids among `parentIds` the caller may write: in org, readable, writable.
   *  One `findMany(id IN …)` for the batch. Used by capabilities and the gate. */
  static async writableParentIds(set, organizationId, childType, parentIds: string[]): Promise<Set<string>>;
  /** For the gate: the first id that is not readable (→ not found), else the first
   *  not writable (→ denied), else null. Distinct ids, one query. */
  static async firstRefusal(set, organizationId, parentType: PermissionResourceType,
    ids: string[], verb: "read" | "write"): Promise<{ id: string; reason: "not_found" | "denied" } | null>;
}
```

- **Not-found codes by parent type:** `entity` → `CONNECTOR_ENTITY_NOT_FOUND` "Connector entity not found"; `connector_instance` → `CONNECTOR_INSTANCE_NOT_FOUND` "Connector instance not found".
- **Implementation:** `assertWritableParent` is `ObjectAccessService.loadForVerb(set, org, parentType, row, "write", notFound)`.
- **Helpers that fold in:**
  - `assertEntityWritable` (`entity-tag-assignment.router.ts:59`) calls `ParentAccessService`.
  - `assertGroupWritable` (`entity-group-member.router.ts:63`) keeps its own `entity_group` type, which isn't in the table. It's left as is: it already uses `readableInOrg` + `check(write)`, the same split.

### API: REST routes (order: org load → parent write → child rule → feature flag)

| Route | Change |
|---|---|
| `POST /api/field-mappings` (`field-mapping.router.ts:429`) | the entity's `can(read)` at `:452–468` becomes `assertWritableParent(…"field_mapping", entity)` |
| `PATCH` / `DELETE /api/field-mappings/:id` (`:696`, `:1137`) | after `loadForVerb` on the mapping, `loadWritableParent(…"field_mapping", mapping.connectorEntityId)` |
| `POST /api/connector-entities/:entityId/records` (`entity-record.router.ts:814`) | after `resolveEntityOrThrow`, `assertWritableParent(…"entity_record", entity)`; the duplicate read at `:831` is removed |
| `PATCH` / `DELETE …/records/:recordId` (`:1373`, `:1549`) | the same, before `loadForVerb` on the record |
| `POST /api/connector-entities` (`connector-entity.router.ts:565`) | the instance's `readableInOrg` at `:591` becomes `assertWritableParent(…"entity", instance)` |
| `PATCH` / `DELETE /api/connector-entities/:id` (`:765`, `:1067`) | after `loadForVerb` on the entity, `loadWritableParent(…"entity", entity.connectorInstanceId)` |
| `POST /api/entity-groups/:id/members` (`entity-group-member.router.ts:290`) | the member's entity must be readable (`readableInOrg`, else 404 `CONNECTOR_ENTITY_NOT_FOUND`), not just org-checked (`:291–306`) |
| `POST /api/curated-views` (`curated-view.router.ts:544`) | the projected entity must be readable (else 404 `CONNECTOR_ENTITY_NOT_FOUND`) |

- **`route-authorization.map.ts`** entries are unchanged in shape. Their notes cite parent write.
- **OpenAPI:** each changed route's `403` description gains "or no write permission on the parent entity / connector".

### API: capabilities (`apps/api/src/services/object-capabilities.service.ts`)

- `for` and `attach` narrow their `type` to `Exclude<PermissionResourceType, ChildResourceType>`, so tsc refuses a child type.
- New method:

  ```ts
  /** #829: a child's capabilities; write/delete also require the parent writable. */
  static async attachChildren<T extends OwnedRow & Record<string, unknown>>(
    set: PermissionSet, organizationId: string, type: ChildResourceType, rows: T[]
  ): Promise<Array<T & { capabilities: ObjectCapabilities }>>;
  ```

  It does one `writableParentIds` call over the distinct `row[parentKey]`. `read` is unchanged; `write = can(write, row) && parentWritable`, and likewise `delete`.
- Call sites become `await attachChildren(...)`, with a by-id route wrapping one row: `field-mapping.router.ts:235,333`, `entity-record.router.ts:505,698`, `connector-entity.router.ts:249,377`.

### API: permission gate (`apps/api/src/services/permission-gate.service.ts`)

- New ApiCode `TOOL_TARGET_NOT_FOUND = "TOOL_TARGET_NOT_FOUND"` (`constants/api-codes.constants.ts`, beside `TOOL_PERMISSION_DENIED` at `:836`) and `targetNotFound(message)`, with the `permissionDenied` shape.
- Order inside the existing `try` (still fail-closed):

  | Mode | Check |
  |---|---|
  | `create` | Collect `parentPaths` values. Empty → denied. `firstRefusal(parentType, ids, "write")`, then the type-level `can(write,{type,createdBy:caller})` |
  | `bulk` | `readPaths` → `firstRefusal(entity, ids, "read")`; `parentPaths` → `firstRefusal(parentType, ids, "write")`; then the class-level check |
  | `batch` / `single` on a child type | Resolve each child row once (`RbacObjectResolver.resolveRow`, new: returns `{ createdBy, parentId? }` with `parentId = row[parentKey]` for child types, `null` when absent or another org). An unresolvable child → denied, unchanged. Then `firstRefusal(parentType, distinct parentIds, "write")`, then the per-child `can` as today |

- **Results:**
  - `not_found` → `targetNotFound("<Parent label> <id> was not found.")`, using `TYPE_LABELS` from `permission-refusal.ts` ("Entity …", "Connector …");
  - `denied` → `permissionDenied("You don't have permission to edit <parent label> <id>.")`.

  The whole call is refused and nothing runs.
- `RbacObjectResolver.resolveCreatedBy` stays as a thin wrapper over `resolveRow`.

### API: `transform_entity_records`

Nothing changes in the tool itself. The gate's `parentPaths` / `readPaths` now org-check, read-check or write-check every target and the source before the tool runs. The `writes[0]`-only org check at `transform-entity-records.tool.ts:307–329` stays as defence in depth, with a comment pointing at the gate.

### Web (`apps/web/src`)

- **`entityDetailActionGates`** (`utils/entity-actions.util.ts:76`): `createRecord.allowed = recordPermissions.create && capabilities.write`. Here `capabilities` is the entity's own, which now also folds in its connector.
- **`connectorInstanceActionGates`** (`utils/connector-instance-actions.util.ts:57`): `createEntity.allowed = canCreateEntity && capabilities.write`.
- **`ColumnDefinitionDetail.view.tsx:160`:** `sdk.connectorEntities.search()` gains a `filterItem` option on `SearchHookOptions` (`api/connector-entities.api.ts:134`). The mapping dialog's picker passes `filterItem: (e) => e.capabilities.write`. The ref-key picker (`:162`) is a reference, so it stays unfiltered.
- Row Edit/Delete for records and mappings are unchanged; they read the now-narrower child `capabilities`.

### Docs

- **CLAUDE.md Authorization bullets.** "A create checks read on its parent plus the type's create rule" becomes "…**write** on its parent…". "A child row … the parent must be in the org and readable" becomes "…readable, and a write to the child requires write on the parent". The section also names `CHILD_RESOURCE_PARENTS` + `ParentAccessService`. Same change in `.github/copilot-instructions.md`.
- **Tool descriptions** (the `.tool.ts` + `builtin-toolpacks.ts` mirrors) for the six create/update/delete child tools, geocode and transform: "Requires write permission on the parent entity (connector, for entities)."
- **`system.prompt.ts`:** relay `TOOL_TARGET_NOT_FOUND` as "not found" and `TOOL_PERMISSION_DENIED` as missing access; never retry.

## Migration

None. No schema change.

## Seed

None (Key decision 1).

## TDD test plan

Run from each package: `npm run test:unit`, `npm run test:integration` (api). Never raw jest.

### core (`packages/core`)

`src/__tests__/models/tool-capability.model.test.ts`:
- `create` on a child type without `parentPaths` is rejected;
- `parentPaths` on `batch` is rejected;
- `readPaths` off `bulk` is rejected;
- `create` on a non-child type is accepted without `parentPaths`.

(4)

`src/__tests__/registries/builtin-toolpacks.test.ts`, guard:
- every `create`/`bulk` descriptor on a child type has `parentPaths`;
- every `batch` descriptor's `resourceType` that is a child type resolves through `CHILD_RESOURCE_PARENTS`;
- transform declares the source in `readPaths`.

(3)

### api unit

**`src/__tests__/services/parent-access.service.test.ts`** (new):
- writable → row;
- other org → 404 with the parent code;
- unreadable → 404;
- read-only → 403 `PERMISSION_DENIED`;
- `writableParentIds` filters a mixed set;
- `firstRefusal` prefers not_found over denied;
- `firstRefusal` dedupes ids.

(7)

**`src/__tests__/services/permission-gate.service.test.ts`**:
- create:
  - parent unreadable → `TOOL_TARGET_NOT_FOUND` and `execute` not called;
  - parent read-only → `TOOL_PERMISSION_DENIED`;
  - writable parent + owned create → runs;
  - an empty items list → denied;
  - two items, one bad parent → whole call refused;
- batch:
  - child readable/writable but parent read-only → denied;
  - parent from the row, not the input (input names a writable entity, row's parent isn't) → denied;
- bulk:
  - target read-only → denied;
  - source unreadable → not found;
  - all good → runs;
- the existing create-shape case (`:40`) is updated;
- a resolution throw → denied (fail-closed).

(12)

**`src/__tests__/services/object-capabilities.service.test.ts`** (new or extended):
- child owned, parent writable → `ALL`;
- child owned, parent read-only → `{read:true, write:false, delete:false}`;
- one parent query per page.

(3)

### api integration

**`src/__tests__/__integration__/authorization/child-write-parent.agreement.integration.test.ts`** (new). A member and an owner; for each child type (mapping, record, entity) × parent {unreadable, read-only (system-owned), writable (member-owned)}:
- **REST create** status: 404 / 403 / 201|200;
- **REST update + delete** of a member-owned child under that parent: 404 / 403 / 200;
- **the agent tool** (built via `ToolService.buildAnalyticsTools`): `TOOL_TARGET_NOT_FOUND` / `TOOL_PERMISSION_DENIED` / success, with the row count unchanged in the refused cases;
- **GET `capabilities`** on the child agree with the REST outcome.

(3 types × 3 states × 4 surfaces ≈ 36 assertions in 9 `it`s)

**Transform:**
- a second write target in another org → `TOOL_TARGET_NOT_FOUND`, nothing enqueued;
- a second target read-only → denied.

(2)

**Group member and curated view:**
- POST with an unreadable entity → 404 for each.

(2)

**Updated:**
- `object-capabilities.agreement.integration.test.ts`: member children under system parents expect read-only; a member-parent fixture expects `ALL`. (2)
- `agent-create-existing-key.integration.test.ts:278`: the new-key create targets the member's own instance; plus a case for the owner's instance → `TOOL_PERMISSION_DENIED`. (2)

### web (`apps/web`)

- `src/__tests__/entity-actions.util.test.ts`: createRecord hidden when the entity isn't writable even with type create. (1)
- `src/__tests__/connector-instance-actions.util.test.ts`: the createEntity equivalent. (1)
- `src/__tests__/ColumnDefinitionDetailView.test.tsx`: the picker omits an entity with `capabilities.write: false`. (1)

**Totals ≈ 50 cases.**

## Acceptance criteria

- [ ] A member with only read on an entity gets `403 PERMISSION_DENIED` from REST when creating, updating or deleting a mapping or record under it, and `TOOL_PERMISSION_DENIED` from the agent. Nothing is written, and no wide-table column is added.
- [ ] A member who can't read the entity gets `404 CONNECTOR_ENTITY_NOT_FOUND` from REST and `TOOL_TARGET_NOT_FOUND` from the agent, with no existence leak.
- [ ] The same holds for entities under a connector instance (`CONNECTOR_INSTANCE_NOT_FOUND`).
- [ ] With write on the parent (owned, or granted by a policy), every one of those operations succeeds as before.
- [ ] `transform_entity_records` refuses when **any** write target is unwritable or out of org, or the source unreadable, before a job is enqueued.
- [ ] Bulk geocode refuses on a read-only entity.
- [ ] Child rows' `capabilities.write`/`delete` are false under a read-only parent. Add record, New entity and Create field mapping don't offer themselves without parent write. The mapping picker lists only writable entities.
- [ ] Group-member add and curated-view create return 404 for an entity the caller can't read.
- [ ] As a default member, the Sandbox connector and demo entities are read-only: no Add record, no New entity, and REST and agent writes refuse.
- [ ] Guards fail CI on a child-type create/bulk descriptor without `parentPaths`, and tsc fails on `ObjectCapabilitiesService.for` with a child type.

## Risks & rollback

- **Behaviour change for members** (Key decision 1): the Sandbox and demo data become read-only for default members. This is intended, and called out in the PR. An org restores it by granting write in a policy. Rollback is a revert; there's no schema change.
- **Missed write path:** a child write that doesn't go through these routes or tools. Mitigated by the guards and the agreement matrix. The known remaining paths are system flows (layout-plan commit, sync, reconcile, demo seed), authorized by their own job/route checks. Import/revalidate/clear need class-level grants; an unconditional `entity_record` grant without entity write still passes them (an owner/admin in practice).
- **Fail-closed cost:** a transient DB error resolving a parent refuses the write. That's safe, and the caller retries.
- **Capabilities query cost:** one extra `IN` query per list page.

## Files touched

- **core:**
  - `packages/core/src/models/permission.model.ts`
  - `models/tool-capability.model.ts`
  - `registries/builtin-toolpacks.ts`
  - tests `__tests__/models/tool-capability.model.test.ts`, `__tests__/registries/builtin-toolpacks.test.ts`
- **api:**
  - new `services/parent-access.service.ts`
  - `services/permission-gate.service.ts`, `services/rbac-object-resolver.ts`, `services/object-capabilities.service.ts`
  - `constants/api-codes.constants.ts`
  - routes `field-mapping.router.ts`, `entity-record.router.ts`, `connector-entity.router.ts`, `entity-tag-assignment.router.ts`, `entity-group-member.router.ts`, `curated-view.router.ts`
  - `tools/transform-entity-records.tool.ts` (comment), the eight child-tool `.tool.ts` descriptions
  - `prompts/system.prompt.ts`
  - `__tests__/config/route-authorization.map.ts` (notes)
  - tests listed above
- **web:**
  - `utils/entity-actions.util.ts`, `utils/connector-instance-actions.util.ts`
  - `views/EntityDetail.view.tsx`, `views/ConnectorInstance.view.tsx`, `views/ColumnDefinitionDetail.view.tsx`
  - `api/connector-entities.api.ts`
  - tests listed above
- **docs:** `CLAUDE.md`, `.github/copilot-instructions.md`.

## Next step

`docs/AGENT_CHILD_CREATE_AUTHZ.plan.md` slices this into about six TDD commits on `fix/829-agent-child-create-authz`:
1. core table + descriptor schema + guard
2. `ParentAccessService` + REST routes + group-member/curated-view read checks
3. child capabilities
4. permission gate + resolver + `TOOL_TARGET_NOT_FOUND` + the #825 test (transform covered here)
5. web gates + picker
6. docs, tool descriptions and prompt
