# Child writes require write on the parent — Discovery

**Issue:** [EnterpriseBT/portal-ai#829](https://github.com/EnterpriseBT/portal-ai/issues/829)

**Why this exists.** The agent's create tools skip the parent check that every REST create performs.

- **The bug.** A member who gets `404` on the owner's entity used `field_mapping_create` to add a mapping to it. Through the reconcile, that added a **column to the owner's wide table**. The member also used `entity_record_create` to add a record.
- **Related gaps.** `connector_entity_create` has the same gap against connector instances. `transform_entity_records` org-checks only its first write target.

Fixing that exposed the rule underneath. Even REST only requires **read** on the parent to create a child, and child updates and deletes check the parent for nothing more than read, or not at all. Adding a mapping changes the entity's schema; adding a record changes its data. Under that rule, a grant of read on an entity lets its holder modify it.

**Decision (user, 2026-10-19):** read means read only.
- Any change to an object's children is a write to that object, and it needs `write` on the parent, granted explicitly.
- RBAC doesn't add heuristics to soften that; a policy grants what it grants.

This ticket makes **every** child write require write on its parent, on REST and the agent alike. It also makes the capabilities the UI renders from tell the truth about it.

## The current shape

Note: `assertWriteCapability` (`apps/api/src/utils/resolve-capabilities.util.ts:49`) is the connector's `enabledCapabilityFlags.write` feature flag, not an RBAC check. It stays as is.

### REST child writes

| Route | Location | Parent check today | Child check |
|---|---|---|---|
| Field mapping create | `field-mapping.router.ts:429` | read on the entity (`:452–468`) | `check(write,{field_mapping,createdBy:caller})` `:472` |
| Field mapping update / delete | `:696` / `:1137` | **none** | `loadForVerb` write/delete `:717` / `:1148` |
| Record create | `entity-record.router.ts:814` | read (`resolveEntityOrThrow` `:116–148`, again `:831`) | `check(write,{entity_record,createdBy})` `:841` |
| Record PATCH / DELETE | `:1373` / `:1549` | read (`resolveEntityOrThrow`) | `loadForVerb` `:1414` / `:1569` |
| Record import / revalidate / clear | `:1014` / `:1224` / `:1692` | read | class-level write/delete on `entity_record` (owner/admin in practice); already stronger, unchanged |
| Entity create | `connector-entity.router.ts:565` | read on the instance (`:591`) | `check(write,{entity,createdBy})` `:608` |
| Entity PATCH / DELETE | `:765` / `:1067` | **none** | `loadForVerb` `:789` / `:1080` |
| Group members | `entity-group-member.router.ts:63–87`, `:290/504/658` | **write** on the group (`assertGroupWritable`) | the member's entity is only org-checked (`:291–306`), not read-checked |
| Tag assignments | `entity-tag-assignment.router.ts:59–80`, `:284/445` | **write** on the entity (`assertEntityWritable`) | the tag needs read (`:291`) |
| Curated-view station attach / detach | `curated-view.router.ts:861–879`, `:917/981` | **write** on the station | — |
| Curated view create | `curated-view.router.ts:544–557` | class-level `write curated_view` | the referenced entity is only org-checked, not read-checked |

Group members, tag assignments and station attachments already follow the parent-write rule. They're the precedent, and their helpers (`assertGroupWritable`, `assertEntityWritable`, `loadWritableStation`) are the shape to generalize.

### Agent tools and the permission gate

| Piece | Location | Note |
|---|---|---|
| `wrapWithPermissionGate` | `apps/api/src/services/permission-gate.service.ts:83–170` | fail-closed `:149`; denial `:43–47` |
| `mode: "create"` | `:102–108` | `can(write,{type,createdBy:caller})`; never reads the input, so **no parent at all** |
| `mode: "batch"` | `:128–146` | each item's own `createdBy` via `RbacObjectResolver.resolveCreatedBy` (`rbac-object-resolver.ts:63–80`); no parent |
| `mode: "bulk"` | `:109–116` | class-level |
| Descriptors | `TOOL_AUTHORIZATION`, `builtin-toolpacks.ts:1746–1865` | creates (`:1747`, `:1770`, `:1804`) are `create`; record/entity/mapping update and delete tools are `batch` (`idField` `entityRecordId` / `connectorEntityId` / `fieldMappingId`) |
| Schema | `ToolAuthorizationSchema`, `tool-capability.model.ts:354–374` | `itemsArg` / `idField` allowed only on batch |
| Tools | `entity-record-create.tool.ts:89–90`, `field-mapping-create.tool.ts:125–126`, `field-mapping-update.tool.ts:129–130`, `connector-entity-create.tool.ts:91–141` | station scope + feature flag only |
| `transform_entity_records` | `transform-entity-records.tool.ts:307–329`, `:395` | org-checks the source and `writes[0]`; other targets reach `wideTableStatementCache.get` unchecked |

### Capabilities and create rules

- `ObjectCapabilitiesService.for` (`object-capabilities.service.ts:44–57`) computes a row's `read`/`write`/`delete` from `set.can(verb,{type,id,createdBy})` on the row alone. It's attached for mappings (`field-mapping.router.ts:235,333`), records (`entity-record.router.ts:505,698`) and entities (`connector-entity.router.ts:249,377`).
- `CREATE_RULES` (`permission.service.ts:119–136`) marks entity, entity_record, field_mapping and connector_instance `owned`. `canCreate` (`:317–329`) is type-level only, surfaced as `resourcePermissions[type].create` (`:367`). No per-parent "can add children" signal exists.

### Web affordances

| Affordance | Location | Gated on |
|---|---|---|
| Add record | `utils/entity-actions.util.ts:76–78`, `views/EntityDetail.view.tsx:675` | `canOnResource("entity_record","create")`, type-level |
| Create field mapping (column definition page) | `views/ColumnDefinitionDetail.view.tsx:73–75` | `canOnResource("field_mapping","create")` |
| New entity (connector page) | `views/ConnectorInstance.view.tsx:377`, `utils/connector-instance-actions.util.ts:57` | `canOnResource("entity","create")` |
| Record / mapping row Edit and Delete | `entity-actions.util.ts:120–140`, `:151–165` | the child's own `capabilities` + the feature flag |

Each of these would show an enabled action the new rule refuses, so they change with it.

### The default member policy

`MemberAccess` (`seed.service.ts:747–800`) grants read, write and delete on `created_by_caller`, plus read on `created_by_system`, for every data type (`permission.model.ts:79–88`). Owner and admin have `* *`. The Sandbox instance (`application.service.ts:688–689`) and demo-seed entities (`demo-seed.service.ts:60`) are system-owned.

Under the new rule, a default member:
- **can** add entities, records and mappings under connectors and entities they created;
- **can't** add entities to the system Sandbox, or records and mappings to system or demo entities. They can still read them, and still create their own connectors.

That is the intended consequence of "write must be explicitly permitted", not something to code around. An org that wants members writing into Sandbox grants it in a policy.

### Tests that pin current behaviour

- `object-capabilities.agreement.integration.test.ts` **breaks.** Its fixtures put member-owned children under **system** parents (`:191–192`, `:224`, `:247`) and expect them to be `ALL` (`:571–574`). The expectation flips to read-only, and a new fixture covers member-owned children under a member-owned parent.
- `agent-create-existing-key.integration.test.ts:278` (#825) **breaks.** A member creates an entity on the **owner's** instance. The test moves to the member's own instance, with a new case asserting the owner's instance refuses.
- `permission-gate.service.test.ts:40` asserts the create check's shape. It changes to include the parent.
- `create-capability.agreement.integration.test.ts` (`:59–60`, `:269–277`) and `creates-and-children.authorization.integration.test.ts:384–417` build parents the caller owns, so they should hold.
- `field-mapping.router.integration.test.ts:2567` uses the member's own entity, so it holds.

## The design space

### Decision 1 — The rule

Every create, update or delete of a child requires `write` on its parent, in addition to the child's own rule:

| Child | Parent |
|---|---|
| field mapping, entity record | entity |
| connector entity | connector instance |
| group member | group |
| tag assignment | entity |

- **The parent is unreadable:** it answers as absent (`404`, "unreadable == absent").
- **The parent is readable but not writable:** `403 PERMISSION_DENIED`, naming the parent permission.
- **Objects a child merely references** need read, not write: the tag in an assignment, the member's entity in a group, the entity a curated view projects, a column definition. Referencing an object doesn't modify it.

**Decided** (user). The open design is only where the check lives.

### Decision 2 — One parent map, three consumers

- **A. A single `PARENT_OF` table** (core or api), keyed by child type: `{ parentType, parentIdOf(row|input) }`.
  - One helper, `ParentAccessService.assertParentWritable(set, org, childType, parentId)`, implements the 404/403 split.
  - The REST routes replace their own parent reads with it.
  - `ObjectCapabilitiesService` uses it: a child's write/delete is false unless the parent is writable.
  - The permission gate's create and batch modes resolve the parent through the same table.
- **B. Per-route and per-tool checks,** like today's `assertGroupWritable` / `assertEntityWritable`.

| | A one table | B per site |
|---|---|---|
| A new child type can skip the parent | no: a guard requires a `PARENT_OF` entry per child type and a parent on every create/child batch descriptor | yes, which is #829's failure |
| REST, gate and capabilities agree | by construction, plus an agreement test | by discipline |
| Churn | the three existing helpers fold in | none |

**Lean: A.** #829 happened because the parent rule lived in each route and the gate never learned it. One table, read by every enforcement point and by capabilities, is the only shape where they can't drift apart again.

### Decision 3 — How the UI learns it

- **A.** A child's capabilities include the parent's write, which fixes row Edit/Delete. The "add child" buttons gate on the **parent row's** `capabilities.write` (already on every entity and instance payload) AND the type's `canOnResource(type,"create")`.
- **B.** A new derived per-parent capability (`capabilities.addChildren`).

**Lean: A.** The parent's `write` already means exactly "may modify this", which is now the rule; B would be a second name for the same fact. The column-definition page's Create mapping, which picks an entity in its dialog, filters the entity picker to `capabilities.write`.

### Decision 4 — Agent denial shape

| Parent state | Agent result |
|---|---|
| unreadable | `TOOL_TARGET_NOT_FOUND`, a new typed result for the whole call. Mirrors the 404; doesn't confirm the parent exists |
| readable but not writable | `TOOL_PERMISSION_DENIED`, naming the parent permission ("needs write on entity …") |

All-or-nothing, as batch mode is today.

**Lean: as stated.** It carries the REST split to the tool result.

## Tradeoff comparison

|  | D1 parent write | D2 one table | D3 parent capabilities | D4 split denial |
|---|---|---|---|---|
| Spread to spec | yes | yes | yes | yes |
| Contract change | REST: read-only parents now 403 | descriptor gains `parent` | child `capabilities` narrow | new tool code `TOOL_TARGET_NOT_FOUND` |
| User-visible | members lose writes into system/demo parents (by design) | none | buttons gate honestly | the agent relays a clear refusal |

## Recommendation

1. **The rule:** a child create/update/delete requires `write` on its parent. An unreadable parent gives 404 / `TOOL_TARGET_NOT_FOUND`. A readable but unwritable parent gives 403 `PERMISSION_DENIED` / `TOOL_PERMISSION_DENIED`. Referenced objects need read.
2. **`PARENT_OF` and `ParentAccessService.assertParentWritable`** are the single implementation. `assertGroupWritable`, `assertEntityWritable` and the routes' own parent reads move onto it.
3. **REST:**
   - field-mapping create/update/delete, record create/PATCH/DELETE and entity create/PATCH/DELETE call the helper;
   - group-member POST read-checks the member's entity;
   - curated-view create read-checks its entity;
   - import, revalidate and clear keep their class-level check, which already implies parent write for the grants that pass it.
4. **`ObjectCapabilitiesService`:** for a child type, `write`/`delete` = the child's own `can` AND the parent's `write`, batch-loading the parents per page.
5. **Permission gate:** `ToolAuthorizationSchema` gains `parent: { type, itemsArg, idField }`, required on `create` descriptors. Child-type `batch` descriptors resolve the parent through `PARENT_OF`. Both modes call `assertParentWritable` per distinct parent before the child's own check.
6. **`transform_entity_records`:** every target in `writes` is org-checked and write-checked, as the parent of the records it writes, not just `writes[0]`.
7. **Web:**
   - Add record, New entity and Create field mapping gate on the parent row's `capabilities.write` plus the type's create.
   - The mapping dialog's entity picker lists only writable entities.
   - Row Edit/Delete follow the child's (now narrower) capabilities.
8. **Guards:**
   - every child type has a `PARENT_OF` entry;
   - every create descriptor and child-type batch descriptor has a resolvable parent.
9. **Agreement test:** REST ≡ tool ≡ capabilities, for each child type × {parent unreadable, read-only, writable}.
10. **Docs:**
    - CLAUDE.md's Authorization bullets ("a create checks read on its parent", "a child row … the parent must be in the org and readable") change to parent **write**, with the copilot mirror.
    - The child tools' descriptions and `system.prompt.ts` say a child write needs write on the parent.
    - The stale comment at `builtin-toolpacks.ts:1840–1841` is corrected.
11. **Tests:** those under "Tests that pin current behaviour" are updated as described there.

## Open questions

1. **Should the default member policy gain write on system-provisioned parents** (Sandbox, demo entities) so members keep adding to them? Lean: **no.** That's the implicit write ruled out. Members create their own connectors, and an admin grants Sandbox write in a policy if the org wants it. The spec records it as a deliberate behaviour change, and the smoke walks a member losing it.
2. **Does an entity's PATCH/DELETE also need write on its connector instance?** Lean: **yes.** It's a child write like the others, and one rule beats an exception for the top-level child.
3. **Is the transform cross-target gap writable cross-org today?** Lean: it's fixed regardless (Recommendation 6). The spec records whether a later stage would have refused; if not, the PR calls it out as a cross-tenant fix.
4. **Does batch-loading parents for `capabilities` cost much on large pages?** Lean: no. A record page shares one entity, so one lookup. Mappings on a column-definition page span a handful of entities, so one `IN` query.

## Enterprise-scale considerations

- **Concurrency & correctness:** the parent check is a read before the write, as today's read check is. A revoked permission takes effect on the next request. Lean: no new locking.
- **Accuracy & auditability:** N/A. No new record of truth; the RBAC audit already covers grant changes.
- **Failure modes:** Lean: **fail closed.** Any error resolving a parent denies. That matches the gate's existing behaviour (`permission-gate.service.ts:149`) and the routes' 404/500.
- **Scale & unbounded growth:** one parent lookup per distinct parent per call or page, never per item. Batches cap at 100.
- **Multi-tenancy:** the parent load is org-scoped, so another org's parent is absent. The transform fix closes the only unscoped target path found.
- **Contract stability:** `PARENT_OF` is the extension point. A new child type (e.g. #645's agent-created views) declares its parent and inherits REST, gate and capability enforcement at once, and the guard enforces it.
- **Data lifecycle:** N/A.

## What this doesn't decide

- **#827's station reach.** Which station may target an entity is separate from RBAC, and follows this ticket.
- **Seeded member policy changes.** Open question 1 leans no; any carve-out is an org's policy decision, not code.
- **Read-side scoping** of what the agent lists.

## Next step

`docs/AGENT_CHILD_CREATE_AUTHZ.spec.md` pins:
- `PARENT_OF`, `assertParentWritable`, and each route's new order and codes
- the capabilities change
- the descriptor `parent` field and gate modes, and `TOOL_TARGET_NOT_FOUND`
- the transform fix and the web gates
- the guards and the agreement matrix

`docs/AGENT_CHILD_CREATE_AUTHZ.plan.md` slices it into about six TDD commits:
1. `PARENT_OF` + the helper + the guard
2. REST routes
3. capabilities
4. gate + descriptors + the #825 test
5. transform
6. web gates + docs
