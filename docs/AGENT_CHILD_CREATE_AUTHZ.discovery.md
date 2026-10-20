# Objects and parts: entity permission governs its records and mappings — Discovery

**Issue:** [EnterpriseBT/portal-ai#829](https://github.com/EnterpriseBT/portal-ai/issues/829)

**Why this exists.** The agent's create tools skipped the parent check every REST create performs. A member who gets `404` on the owner's entity used `field_mapping_create` to add a mapping to it (adding a **column to the owner's wide table**) and `entity_record_create` to add a record. `connector_entity_create` had the same gap against connector instances, and `transform_entity_records` org-checked only its first write target.

**How the scope grew.**
- **2026-10-19 (user): read means read only.** A change to an object's contents needs explicit `write` on it, with no heuristics to soften that. The first implementation (commits `2035d853`…`f90c2569`) added parent write as a **second layer** on top of each child's own `entity_record` / `field_mapping` permission.
- **2026-10-20 (user): entity permission governs its records.** Review showed the two layers disagree with each other (finding 1: the UI hid a record create the API allowed). The per-record layer is the `created_by_caller` own-rows heuristic the user wants gone. The user asked for the cleanest, most composable model and chose **objects and parts**.

This ticket now replaces per-record and per-mapping permissions with that model, on REST, the agent, capabilities, curated views and the policy vocabulary alike.

## The model

1. **Permission objects** are the only things granted on: connector instance, entity, station, pin, curated view, portal, tag, group, column definition, toolpack. Each keeps its `createdBy`, policy statements and per-object `capabilities`.
2. **Parts have no permission of their own.** Records and field mappings are an entity's data and schema:
   - **read the entity** → read all its records and mappings, every column;
   - **write the entity** → create, edit and delete any record or mapping, plus import, revalidate and clear all.
   `createdBy` / `sourcePortalId` on a part remain provenance and authorize nothing.
3. **An object inside an object follows the directory rule.**
   - Creating an entity needs **write on its connector instance** plus the entity create rule.
   - Deleting it needs delete on the entity plus write on the connector.
   - Editing it (label, tags) needs only write on the entity.
4. **References need read.** The tag in an assignment, a group member's entity, a curated view's entity, a mapping's column definition. Group members and tag assignments are already parts of their group / entity, so they're unchanged.

## The current shape (on this branch)

### Built in slices 1–6, and what becomes of it

| Piece | Today | Under the model |
|---|---|---|
| `CHILD_RESOURCE_PARENTS` (`permission.model.ts:79–91`) | entity→instance, mapping/record→entity | splits into **`PART_OWNERS`** (record, mapping → entity; not permission types) and **`OBJECT_CONTAINERS`** (entity → instance) |
| `ParentAccessService` | parent write for all three | entity write for parts; instance write for entity create/delete |
| Gate `parentPaths` / `readPaths`, `TOOL_TARGET_NOT_FOUND` | child create/bulk | kept; part tools authorize as **entity** objects |
| `attachChildren` (`object-capabilities.service.ts:91–125`) | child own `can` ∧ parent write | a part's capabilities **are** its entity's; an entity's delete folds in instance write, its write doesn't |
| Entity PATCH (`connector-entity.router.ts:797`) | requires instance write | entity write only |
| Web `createRecord` (`entity-actions.util.ts:79`) | `create` rule ∧ entity write | entity `capabilities.write` |

### `entity_record` / `field_mapping` as permission types (survey)

- **Core:**
  - `PERMISSION_RESOURCE_TYPES` (`permission.model.ts:52–53`) and `DATA_RESOURCE_TYPES` (`:100–109`), which feed the MemberAccess seed and `RESOURCE_PERMISSION_TYPES` (`:235–273`);
  - `RESOURCE_CAPABILITIES` (`:347–348`);
  - derived caps `entity_record.revalidate` / `.clear` (`:164–170`);
  - `TOOL_AUTHORIZATION` record/mapping descriptors (`builtin-toolpacks.ts:1749–1858`);
  - policy authoring accepts any type (`rbac-authoring.contract.ts:28`).
- **API:**
  - `CREATE_RULES` (`permission.service.ts:125–126`) and `DERIVED_CAPABILITIES` (`:100–103`);
  - MemberAccess (`seed.service.ts:759–785`, 8 statements per org, ids `sysstmt:<org>:MemberAccess:…`);
  - routes:
    - records: `entity-record.router.ts:329, 580, 681, 842, 1034, 1243, 1426, 1590, 1728`;
    - mappings: `field-mapping.router.ts:63, 186, 464, 712, 1030, 1151`;
    - `visibilityPredicate("entity_record")` in `entity-group.router.ts:1053`, `entity-group-member.router.ts:860`, `field-mapping.router.ts:1354`;
  - `rbac-object-resolver.ts`, `permission-refusal.ts:39–40`.
- **Storage:**
  - `resource_type` is plain `text` with no CHECK (`0101`, `0105`); the Drizzle enum is TS-only, so retiring a type needs a **data** migration, no DDL;
  - rows: MemberAccess statements (seeded by `0102`, `0111`), any custom statements or grants, and every curated-view share's composed field grant.
- **Web:**
  - the policy editor's type list maps `PERMISSION_RESOURCE_TYPES` (`StatementEditor.component.tsx:71`), so it follows core;
  - `EntityDetail.view.tsx:674–677` (`canOnResource("entity_record","create")`, both derived caps);
  - `EntityRecordDetail.view.tsx:548` (revalidate);
  - `ColumnDefinitionDetail.view.tsx:74` (`canOnResource("field_mapping","create")`).
- **Docs:** CLAUDE.md `:266` (12 per-object types), `:268` (derived caps), `:491–492`; copilot mirror.

### Curated views use field-mapping permissions for column access (#599, #729)

- **Sharing a view** writes a second grant, `read field_mapping in_curated_view:<viewId>` (`grant.service.ts:162–180`). `loadSet` expands it to `read field_mapping:<id>` per projected mapping (`permission.service.ts:192–270`).
- **Column scoping:**
  - portal SQL's columns are projection ∩ `can(read field_mapping)` (`portal-sql.service.ts:394–398`);
  - the view payload scopes the same way (`curated-view-payload.service.ts:56–60`);
  - view create/update refuses an unreadable column with `403 CURATED_VIEW_FIELD_NOT_READABLE` (`curated-view.router.ts:216`).
- **Kill switch:** a class `deny read entity_record` empties every view (`portal-sql.service.ts:305–310`, `:438`).
- **Cleanup:** repos delete the composed grant on unshare and view delete (`permission-grants.repository.ts:159–220`, `curated-view-delete.service.ts:92`).

`field_mapping` can't leave the vocabulary until this has a replacement (Decision 2).

## The design space

### Decision 1 — Which entity verb a part write needs

- **A.** Every part write (create, edit, delete, import, revalidate, clear) needs entity **write**.
- **B.** Part deletes and clear need entity **delete**.

**Lean: A.** Deleting a record changes the entity's contents; entity `delete` means removing the entity itself. B would make a member with write but not delete unable to fix a bad row, and puts two verbs on one object's contents.

### Decision 2 — How a curated view conveys its columns

- **A. The view is the object; reading it reads its projection.**
  - A view reader sees the view's effective projection (minus hidden columns) and its rows. No per-column check.
  - A share writes only `read curated_view:V`. The composed field grant, the `in_curated_view` expansion and its repo helpers go.
  - Creating or editing a view needs read on its entity (already required since slice 3), which now covers every column, so `CURATED_VIEW_FIELD_NOT_READABLE` retires.
- **B. Keep `field_mapping` as a grant-only type** for `in_curated_view`, outside authoring.
- **C. Reading a view also needs entity read.**

| | A view = projection | B keep field grants | C entity read too |
|---|---|---|---|
| Parts left in the vocabulary | none | `field_mapping` lingers | none |
| Shared views still work for non-readers of the entity | yes | yes | **no**: breaks #599 sharing |
| Moving parts | fewer: one grant per share | today's expansion | fewer |

**Lean: A.** A view already is a scoped, shareable read of an entity; its definition decides the columns, and its own read grant decides who. That's the parts model applied to views. The class `deny read entity_record` kill switch retires with the type; its equivalent is a deny on `curated_view` or `entity`.

### Decision 3 — How tools on parts authorize

- **A.** Part tools authorize on **`entity`** objects.
  - Create and bulk descriptors name entity ids at `parentPaths` (renamed **`objectPaths`**) and check entity write.
  - Update and delete descriptors name part ids. The gate resolves each stored part's entity and checks entity write; the entity is never taken from input.
  - Transform's source keeps `readPaths`.
  - Entity tools:
    - create: instance write (`containerPaths`) plus the entity create rule;
    - update: entity write;
    - delete: entity delete plus instance write.
- **B.** Keep `resourceType: "entity_record"` on descriptors and map it to the entity inside the gate.

**Lean: A.** The descriptor should say what's checked. B keeps a retired type alive in core.

### Decision 4 — Capabilities and the web

- **Parts:** a record's or mapping's `capabilities` are its entity's `{read, write, delete: write}`, from one entity lookup per page.
- **Entities:** an entity's `write` is its own. Its `delete` is its own delete ∧ instance write.
- **Retired:** `resourcePermissions.entity_record/field_mapping`, both derived caps and their `CREATE_RULES` entries.
- **Web gates:**
  - Add record, import, revalidate and clear gate on the entity's `capabilities.write`. That resolves code-review finding 1 by construction.
  - The mapping dialog's entity picker asks the server for writable entities (`?capability=write` on the entity list). That resolves finding 2.
  - The column-definition page's Create mapping stays visible to page readers, and the picker's empty state reads "No entities you can edit".
- **Lean: as stated.**

### Decision 5 — Retiring stored rows

Forward migration:
1. Delete `permission_statements` and `permission_grants` rows whose `resource_type` is `entity_record` or `field_mapping`, including the `in_curated_view` grants.
2. Drop the seed's two `DATA_RESOURCE_TYPES` entries.

`in_curated_view` leaves core's `PERMISSION_CONDITIONS`. The DB CHECK still admits it; a widened constraint is harmless and avoids destructive DDL.

**Lean: delete.** A custom `deny` on these types also disappears, which **widens** access where an org authored one. The PR calls it out, and app-dev is counted before deploy.

## Recommendation

1. **Objects and parts as above.** Every part write needs entity write; reads need entity read. Entity create needs instance write plus the create rule, delete needs entity delete plus instance write, update needs entity write.
2. **Core:**
   - remove `entity_record` and `field_mapping` from `PERMISSION_RESOURCE_TYPES` / `DATA_RESOURCE_TYPES` / `RESOURCE_CAPABILITIES`;
   - remove both derived caps and `in_curated_view`;
   - add `PART_OWNERS` and `OBJECT_CONTAINERS`.
3. **API:**
   - `ParentAccessService` serves both tables;
   - record and mapping routes, including import, revalidate, clear and the bidirectional/impact reads, check the entity only;
   - list visibility comes from the entity;
   - `CREATE_RULES` / `DERIVED_CAPABILITIES` drop the retired entries;
   - entity PATCH drops the instance check.
4. **Curated views (Decision 2 A):** the projection is the column set; shares write one grant; `CURATED_VIEW_FIELD_NOT_READABLE` and the kill switch retire.
5. **Gate and descriptors (Decision 3 A).**
6. **Capabilities and web (Decision 4)**, plus code-review finding 3: parent lookups select only `id`, `organizationId` and `createdBy`, never decrypting credentials.
7. **Migration (Decision 5)** with a backfill test, and seed changes with a reset test.
8. **Guards:** every part type has a `PART_OWNERS` entry, and no descriptor or route names a retired type.
9. **Agreement:** REST ≡ tool ≡ capabilities, for records, mappings and entities × {entity or instance unreadable, read-only, writable}. The curated-view share agreement is updated.
10. **Docs:** CLAUDE.md's per-object list, derived caps, Authorization bullets and #599 view-sharing notes, plus the copilot mirror, tool descriptions and `system.prompt.ts`.

## Open questions

1. **Does a member reading a shared entity now see every record?** Yes, by design. Today MemberAccess reads only their own records and system records, even on an entity shared Read. Lean: accepted. Row scoping is a curated view's job; the smoke walks it.
2. **Can a member with write on a shared entity edit others' records?** Yes, by design: write on the object is the grant. Lean: accepted.
3. **Do retired custom statements exist on app-dev?** Lean: count them before deploy and list them in the PR. No prod release ships before the mock install.

## Enterprise-scale considerations

- **Concurrency & correctness:** each check reads before it writes, as today. The migration is a single `DELETE`, idempotent. Lean: no new locking.
- **Accuracy & auditability:** policy rows deleted by the migration are recorded by migration name. Lean: no audit table.
- **Failure modes:** fail closed throughout. A resolution error denies.
- **Scale:** one entity lookup per page or call, never per row. Records and mappings drop a per-row `can` and a visibility predicate, so it's cheaper.
- **Multi-tenancy:** the entity load is org-scoped. Transform targets are each org-checked.
- **Contract stability:**
  - `PART_OWNERS` is the extension point: a new part type declares its owner and inherits enforcement;
  - removing two resource types is a contract change to `resourcePermissions`, `capabilities` keys and policy authoring, with the web updated in the same PR.
- **Data lifecycle:** N/A.

## What this doesn't decide

- **#827** station reach.
- **Read-side scoping** of what the agent lists.
- **Field-mapping delete clearing a counterpart's back-reference** in another entity, from the security review's low note. Its write check moves to entity write on the deleted mapping's entity; the counterpart stays a follow-up.

## Next step

The spec is rewritten to pin `PART_OWNERS` / `OBJECT_CONTAINERS`, the route and gate checks, capabilities, the curated-view projection rule, the migration and the web gates. The plan reworks the branch in about six slices on top of the existing commits:
1. core vocabulary and tables
2. migration and seed
3. routes and capabilities
4. curated views
5. gate and descriptors
6. web and docs
