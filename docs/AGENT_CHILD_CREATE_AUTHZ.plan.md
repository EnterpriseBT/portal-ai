# Objects and parts — Plan

**This plan moves the branch from "child writes need parent write" (two layers) to objects and parts. Records and mappings are governed by their entity, entities by their connector for create and delete, and `entity_record` / `field_mapping` leave the vocabulary. It is TDD-sequenced.**

- Spec: `docs/AGENT_CHILD_CREATE_AUTHZ.spec.md`.
- Discovery: `docs/AGENT_CHILD_CREATE_AUTHZ.discovery.md`.
- Issue: #829.

It builds on the branch's slices `2035d853`…`f90c2569`. `TOOL_TARGET_NOT_FOUND`, `firstRefusal`, `valuesAtPath`-driven descriptor paths and the agreement-test scaffolding are kept and reshaped, not reverted.

There are six slices. Each sits behind a green test suite, leaves the repo compilable and lands as one commit on `fix/829-agent-child-create-authz`.

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. write failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. at the boundary, run `npm run lint && npm run type-check` from the root, and `npm run build` when core changed;
5. move to the next slice.

**Sequencing rationale.** Behaviour moves while the old types still exist, so every slice compiles. The vocabulary retires in slice 5, once nothing reads it; tsc then proves nothing does.
- **1** adds the tables and helpers everything else calls.
- **2** switches REST, capabilities and the web gates together, so the UI never disagrees with the server.
- **3** detaches curated views from `field_mapping` grants. It is the blocker for retiring that type.
- **4** moves the agent onto the same model.
- **5** deletes the dead vocabulary and data.
- **6** is prose.

---

## Slice 1 — Core tables and owner/container helpers

Adds `PART_OWNERS` and `OBJECT_CONTAINERS` beside `CHILD_RESOURCE_PARENTS`, which slice 4 removes. Gives `ParentAccessService` its owner/container API on lean queries (code-review finding 3) and `visibilityPredicate` a verb.

**Files**

- Edit: `packages/core/src/models/permission.model.ts`: add `PART_OWNERS`, `PartType`, `PART_TYPES`, `OBJECT_CONTAINERS`, `ContainedType` and `isContainedType`.
- Edit: `apps/api/src/services/parent-access.service.ts`:
  - finders become `db.select({id, organizationId, createdBy[, connectorInstanceId]})` with `deleted IS NULL`;
  - add `assertOwner`, `loadOwner`, `assertWritableContainer`, `loadWritableContainer`, `ownerIdOf`, `ownerCapabilities` and `writableContainerIds`;
  - the slice-2 methods stay, as thin wrappers, until slice 4.
- Edit: `apps/api/src/services/permission-set.ts`: `visibilityPredicate(type, cols, verb = "read")`.

**Steps**

1. **Write the failing tests:**
   - core `permission.model.test.ts`: the table shapes and `isContainedType` (spec core 1–2);
   - `parent-access.service.test.ts`: `assertOwner` read/write split, other org, container, `ownerCapabilities` with one query, lean select (spec api unit 1–5);
   - `permission-set.test.ts`: the write predicate.

   Run them; they fail.
2. Implement until green.
3. Lint, type-check and build.

**Done when:** the new helpers pass and nothing calls them yet. Existing suites are green.

**Risk:** the lean select must keep the soft-delete guard the repository read applied, so a test covers a deleted entity → 404.

---

## Slice 2 — Routes, capabilities and web gates

Records and mappings are authorized by their entity alone, on every REST route. Entity PATCH drops the instance check, part capabilities mirror the entity, and the web gates follow. This resolves code-review findings 1 and 2.

**Files**

- Edit: `routes/entity-record.router.ts`:
  - remove the record visibility predicate and the `can(read)`;
  - POST/PATCH/DELETE/import/revalidate/clear → `assertOwner(…, "write")`;
  - record-of-entity check kept.
- Edit: `routes/field-mapping.router.ts`:
  - list visibility via the entity subquery;
  - `loadReadableMapping` reads through the entity;
  - impact / bidirectional reads use the counterpart's entity;
  - POST/PATCH/DELETE → `loadOwner(…, "write")`.
- Edit: `routes/connector-entity.router.ts`:
  - PATCH drops `loadWritableParent`;
  - list honours `capability=write`.
- Edit: `routes/entity-group.router.ts:1053`, `routes/entity-group-member.router.ts:860`: records are restricted to readable member entities.
- Edit: `packages/core/src/contracts/…` (entity list query): add `capability`.
- Edit: `services/object-capabilities.service.ts`: `attachParts` and `attachContained` replace `attachChildren`; the six call sites move over.
- Edit: `__tests__/config/route-authorization.map.ts` notes, and the OpenAPI blocks.
- Edit (web):
  - `utils/entity-actions.util.ts`, `views/EntityDetail.view.tsx`, `views/EntityRecordDetail.view.tsx`: gates on the entity's `capabilities.write`; stop reading `entity_record.*` derived caps and `canOnResource("entity_record", …)`;
  - `views/ColumnDefinitionDetail.view.tsx`, `api/connector-entities.api.ts`, `api/types.ts`: the picker uses `capability=write`, `filterItem` / `ConnectorEntityRow` are removed, and Create mapping no longer reads `canOnResource("field_mapping", …)`.

**Steps**

1. **Write the failing tests:**
   - unit: `object-capabilities.service.test.ts` (spec api unit cases);
   - integration: rework `child-write-parent.agreement` into `parts-and-containers.agreement`. Cover the REST and capabilities columns: records/mappings × entity state with a part someone else created, import/revalidate/clear, entity create/delete/update × instance state;
   - `object-capabilities.agreement` expectations;
   - route-test expectation updates: `connector-entity.router` PATCH under a read-only instance → 200, `field-mapping.router`, `creates-and-children`, `same-org-access`, `entity-group.router`;
   - web: `entity-actions.util.test.ts`, `ColumnDefinitionDetailView.test.tsx`.

   Run them; they fail.
2. Implement until green, then run the full api integration suite once at the boundary.
3. Lint and type-check.

**Done when:** REST and capabilities agree under the new model, and the web reads only entity capabilities for part actions. The agent-tool column of the agreement test still reflects the old gate and moves in slice 4. Its cases are written there, not here, so no test crosses a boundary red.

**Risk:**
- The mapping list subquery must keep `(scope, created, id)` ordering and the org filter.
- The group identity-resolution read is a join, so its integration test is the check.

---

## Slice 3 — Curated views convey their projection

A view's columns are its projection. A share writes one grant, and nothing reads `field_mapping` grants or `entity_record` denies any more.

**Files**

- Edit: `services/portal-sql.service.ts`:
  - `resolveOneViewColumns` returns the projection minus hidden columns;
  - both kill switches go.
- Edit: `services/curated-view-payload.service.ts`: remove `scopeFieldMappingIds`; callers use the projection.
- Edit: `routes/curated-view.router.ts`: remove the per-column read check and the use of `CURATED_VIEW_FIELD_NOT_READABLE`.
- Edit: `constants/api-codes.constants.ts`: remove that code (and anything in web that references it).
- Edit: `services/grant.service.ts`: no composed field grant, and no explicit cleanup of it.
- Edit: `services/permission.service.ts`: `loadSet` loses the `in_curated_view` expansion.
- Edit: `db/repositories/permission-grants.repository.ts`, `services/curated-view-delete.service.ts`: remove the field-grant helpers and their call.

**Steps**

1. **Write the failing tests:**
   - `grant.router` integration: a share writes exactly one row;
   - `portal-sql.service` integration: a shared view's reader without entity read sees every projected column;
   - `curated-view.router` integration: create with entity read projects any column; delete the `FIELD_NOT_READABLE` cases;
   - delete `rbac-fk-expansion.integration.test.ts` and the field-grant cases in `curated-view-delete.service.integration.test.ts`, plus `permission-loadset` expansion cases.

   Run them; they fail.
2. Implement until green.
3. Lint and type-check.

**Done when:** no source outside core's model reads `field_mapping` grants or `in_curated_view`.

**Risk:** existing composed grants in the DB still exist until slice 5's migration. They're harmless: nothing expands them any more.

---

## Slice 4 — Permission gate and descriptors

The agent authorizes parts on their entity and entities on their container, through `parts` mode and `containerPaths`. `bulk` mode, `parentPaths` and `CHILD_RESOURCE_PARENTS` are removed.

**Files**

- Edit: `packages/core/src/models/tool-capability.model.ts`:
  - modes and fields as in the spec;
  - the refines;
  - `WRITE_KIND_TO_RESOURCE_TYPE` is removed.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts`: `TOOL_AUTHORIZATION` per the spec table.
- Edit: `packages/core/src/models/permission.model.ts`: remove `CHILD_RESOURCE_PARENTS`, `ChildResourceType` and `isChildResourceType`.
- Edit: `apps/api/src/services/permission-gate.service.ts`: `parts`, `create` with container, and `delete` with container on a contained type.
- Edit: `apps/api/src/services/rbac-object-resolver.ts`: add `resolvePartOwner`; `resolveRow` drops `parentId` for parts.
- Edit: `apps/api/src/services/parent-access.service.ts`: remove the slice-2-era wrappers.

**Steps**

1. **Write the failing tests:**
   - core `tool-capability.model.test.ts` (7 cases) and `builtin-toolpacks.test.ts` guards (3);
   - api `permission-gate.service.test.ts` (12);
   - the agent-tool column of `parts-and-containers.agreement`: records/mappings × entity state with a part someone else created; entity create/update/delete × instance state; transform another-org and read-only targets with nothing enqueued.

   Run them; they fail.
2. Implement until green.
3. Lint, type-check and build.

**Done when:** REST, tools and capabilities agree in every agreement row, and no source references `CHILD_RESOURCE_PARENTS` or `bulk` mode.

**Risk:** the `agent-create-existing-key` (#825) cases must still hold. They use the member's own instance (slice 4 of the old plan), so they should.

---

## Slice 5 — Retire the vocabulary

`entity_record` and `field_mapping` leave core. Their create rules, derived capabilities and labels go, the migration deletes their rows, and MemberAccess loses its part statements.

**Files**

- Edit: `packages/core/src/models/permission.model.ts`:
  - `PERMISSION_RESOURCE_TYPES`, `DATA_RESOURCE_TYPES`, `RESOURCE_CAPABILITIES`, `CALLER_CAPABILITY_ACTIONS` and `PERMISSION_CONDITIONS` lose the retired entries;
  - `conditionParam` is documented as retired.
- Edit: `apps/api/src/services/permission.service.ts`: `CREATE_RULES`, `DERIVED_CAPABILITIES`.
- Edit: `apps/api/src/services/permission-refusal.ts`: `TYPE_LABELS`.
- Edit: anything tsc flags after the narrowing (expected: comments only).
- New: `apps/api/drizzle/01xx_retire-part-permissions.sql` + `meta/_journal.json` + snapshot, generated with `npm run db:generate -- --custom --name retire-part-permissions`.
- Seed: no code change. MemberAccess spreads the narrowed `DATA_RESOURCE_TYPES`.

**Steps**

1. **Write the failing tests:**
   - core `permission.model.test.ts`: the retired entries are absent;
   - new `retire-part-permissions.migration.integration.test.ts`: the rows are deleted and unrelated rows kept;
   - `reset.service` / `member-data-delete-backfill` / `permission-loadset`: MemberAccess has no part statements;
   - `create-capability.agreement`, `organization.router`, `rbac-object-search`: the retired types are absent from `resourcePermissions` and `capabilities`;
   - web `AccessAuthoring.test.tsx`: the type list omits both;
   - `organization.contract` / `grant.contract` fixtures.

   Run them; they fail.
2. Implement until green. Apply the migration locally with `npm run db:migrate` (a dev stack seeds but doesn't migrate).
3. Run the full root `npm run build`, lint, type-check and the full api integration suite once.

**Done when:** a repo-wide search for the two type literals finds only the migration, its test and history comments, and a fresh DB has no part permission rows.

**Risk:**
- The migration must be journaled (memory: commit the drizzle journal with the migration).
- Before deploy, count the app-dev rows a custom policy holds and list them in the PR.

---

## Slice 6 — Docs, tool descriptions and prompt

**Files**

- Edit: `CLAUDE.md` and `.github/copilot-instructions.md`, per the spec's Docs section.
- Edit: the eleven `.tool.ts` descriptions and their `builtin-toolpacks.ts` mirrors.
- Edit: `prompts/system.prompt.ts`.

**Steps**

1. **Write the failing tests:** `system.prompt.test.ts` and `builtin-toolpacks.test.ts` description pins. Run them; they fail.
2. Edit the prose until green.
3. Lint.

**Done when:** no doc surface describes per-record or per-mapping permission, or the old two-layer rule.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | tables, lean owner/container helpers, predicate by verb | core + api unit |
| 2 | REST + capabilities + web gates | api integration (full once), web unit |
| 3 | curated views by projection | api integration |
| 4 | gate + descriptors | core + api unit, agreement integration |
| 5 | vocabulary retired, migration | root build, full api integration |
| 6 | docs | unit pins |

## Cross-slice notes

- **The old agreement file** (`child-write-parent.agreement`) is renamed in slice 2 and grows its tool column in slice 4.
- **The local repro leftovers** (mapping `10ac0f86…`, record `0d5e4503…`, the `member_added` column on `er__727e1eeb…`) are cleaned up before the walks.
- **The review chain reruns in full afterwards:** code review, security, a refreshed smoke and adversarial doc, and the walks.
- **The PR body is rewritten:** summary, the behaviour changes (widened reads/writes on shared entities, Sandbox read-only for members, deleted custom statements) and `Closes #829`.

## Next step

Implementation starts with slice 1 once this plan is confirmed.
