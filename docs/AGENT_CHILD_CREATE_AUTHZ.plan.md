# Child writes require write on the parent — Plan

**TDD-sequenced implementation of the parent-write rule: the core `CHILD_RESOURCE_PARENTS` table and descriptor fields, `ParentAccessService`, the REST routes with their capabilities, the agent permission gate, the web gates, and the doc surfaces.**

Spec: `docs/AGENT_CHILD_CREATE_AUTHZ.spec.md`. Discovery: `docs/AGENT_CHILD_CREATE_AUTHZ.discovery.md`. Issue: #829. Builds on shipped #825 (create tools never touch an existing row) and #713 (`ObjectAccessService.loadForVerb`).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/829-agent-child-create-authz`** (PR #830): one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

Core changes ripple into web and site fixtures, so run the root `npm run build` before pushing slice 1.

Sequencing rationale:
- **Slice 1:** core only: the table, the descriptor fields and the guard. The descriptors gain `parentPaths` now, but nothing reads them yet.
- **Slice 2:** `ParentAccessService`, unit-tested in isolation. No route calls it yet.
- **Slice 3:** the REST routes and child capabilities land **together**. `object-capabilities.agreement` holds capabilities equal to the REST outcome, so splitting them would leave one boundary red. This is the slice where default members lose writes under system-owned parents.
- **Slice 4:** the permission gate. It consumes slice 1's `parentPaths` and slice 2's `firstRefusal`, and adds the tool column to slice 3's agreement matrix. Transform and the #825 test are fixed here.
- **Slice 5:** the web gates read the capabilities that are now correct from slice 3.
- **Slice 6:** docs: tool descriptions and mirrors, the system prompt, CLAUDE.md and the copilot mirror.

No migration and no seed change.

---

## Slice 1 — Core: `CHILD_RESOURCE_PARENTS`, descriptor fields, guard

This slice delivers the single table and the descriptor contract that the gate reads in slice 4.

**Files**

- Edit: `packages/core/src/models/permission.model.ts`: add `CHILD_RESOURCE_PARENTS`, `ChildResourceType` and `isChildResourceType`.
- Edit: `packages/core/src/models/tool-capability.model.ts`:
  - add `ToolAuthorizationSchema` fields `parentPaths` and `readPaths`;
  - extend the refine.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts`:
  - add the five `TOOL_AUTHORIZATION` additions from the spec table;
  - replace the stale `:1840–1841` comment.
- Edit: `packages/core/src/__tests__/models/tool-capability.model.test.ts`.
- Edit: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`.

**Steps**

1. **Tests (spec core: 4 + 3).**
   - Schema:
     - create on a child type without `parentPaths` → reject;
     - `parentPaths` on batch → reject;
     - `readPaths` off bulk → reject;
     - create on a non-child type → accept.
   - Guard:
     - every child-type create/bulk descriptor has `parentPaths`;
     - every batch child type resolves through the table;
     - transform's `readPaths` names the source.

   Run them; they fail.
2. **Implement** the table, the fields with the refine, and the descriptor entries. They turn green.
3. Lint and type-check, then the root `npm run build`.

**Done when:** the 7 core cases pass and the existing `TOOL_AUTHORIZATION` parse still succeeds. The api still compiles because nothing reads the new fields yet.

**Risk:** the refine rejects an existing descriptor I missed. The guard enumerates every descriptor, so it shows up here rather than at runtime.

---

## Slice 2 — `ParentAccessService`

This slice delivers the one helper that routes, capabilities and the gate share.

**Files**

- New: `apps/api/src/services/parent-access.service.ts`, with:
  - `loadWritableParent`
  - `assertWritableParent` (over `ObjectAccessService.loadForVerb`)
  - `writableParentIds`
  - `firstRefusal`
  - the per-parent-type not-found codes
- New: `apps/api/src/__tests__/services/parent-access.service.test.ts`.

**Steps**

1. **Tests (spec api unit, parent-access: 7).**
   - writable → returns the row;
   - other org → 404 with the parent's code;
   - unreadable → 404;
   - read-only → 403 `PERMISSION_DENIED`;
   - `writableParentIds` filters a mixed set;
   - `firstRefusal` prefers not_found over denied;
   - `firstRefusal` dedupes ids into one query.

   Run them; they fail.
2. **Implement** the service. Each batch method does a single `findMany(id IN …)`. It turns green.
3. Lint and type-check.

**Done when:** the 7 cases pass. No caller exists yet.

**Risk:** none. It's pure composition over existing loaders.

---

## Slice 3 — REST routes and child capabilities

This slice enforces parent write on every REST child write and folds the parent into the child rows' `capabilities`. The behaviour change for default members (Sandbox and demo become read-only) lands here.

**Files**

- Edit: `apps/api/src/routes/field-mapping.router.ts`: POST (`:429`), PATCH (`:696`), DELETE (`:1137`), and the `attachChildren` call sites (`:235`, `:333`).
- Edit: `apps/api/src/routes/entity-record.router.ts`: POST (`:814`, removing the duplicate read at `:831`), PATCH (`:1373`), DELETE (`:1549`), and the call sites (`:505`, `:698`).
- Edit: `apps/api/src/routes/connector-entity.router.ts`: POST (`:565`), PATCH (`:765`), DELETE (`:1067`), and the call sites (`:249`, `:377`).
- Edit: `apps/api/src/routes/entity-tag-assignment.router.ts`: `assertEntityWritable` delegates to `ParentAccessService`.
- Edit: `apps/api/src/routes/entity-group-member.router.ts`: the POST read-checks the member's entity.
- Edit: `apps/api/src/routes/curated-view.router.ts`: create read-checks its entity.
- Edit: `apps/api/src/services/object-capabilities.service.ts`:
  - narrow `for`/`attach` to non-child types;
  - add `attachChildren`.
- Edit: the OpenAPI `403` descriptions on the changed routes, and the `route-authorization.map.ts` notes.
- New: `apps/api/src/__tests__/__integration__/authorization/child-write-parent.agreement.integration.test.ts`, with the REST create, REST update/delete and GET capabilities columns.
- Edit:
  - `apps/api/src/__tests__/services/object-capabilities.service.test.ts`;
  - `__integration__/…/object-capabilities.agreement.integration.test.ts`;
  - group-member and curated-view integration tests (one case each).

**Steps**

1. **Tests.**
   - Capabilities unit (3).
   - The agreement matrix: 3 types × {unreadable, read-only system-owned, writable member-owned} × {create, update + delete, capabilities} = 9 `it`s.
   - Group-member and curated-view 404 (2).
   - The updated object-capabilities agreement (2):
     - member children under system parents → read-only;
     - a member-parent fixture → `ALL`.

   Run them; they fail.
2. **Implement.**
   - The routes, in the order org load → parent write → child rule → feature flag.
   - `attachChildren`.
   - The type narrowing, which makes tsc point at every call site.

   It turns green.
3. Run the **full** api integration suite. Other suites may hold fixtures where a member writes under a system-owned parent; fix each fixture to give the member a writable parent, and never loosen the rule.
4. Lint and type-check.

**Done when:**
- REST and capabilities agree across the matrix;
- tsc refuses `ObjectCapabilitiesService.for` with a child type;
- the full api integration suite is green.

**Risk:**
- This is the largest slice and the one most likely to turn unrelated fixtures red.
- Splitting it would break the agreement test at the boundary, so it stays one commit.
- The full-suite run in step 3 is the guard.

---

## Slice 4 — Permission gate: parent checks for agent tools

This slice makes the agent tools refuse exactly where REST does, which closes the original #829 bypass and the transform multi-target gap.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `TOOL_TARGET_NOT_FOUND`.
- Edit: `apps/api/src/services/permission-gate.service.ts`:
  - add `targetNotFound()`;
  - add the create, bulk and batch/single checks from the spec table, inside the existing fail-closed `try`.
- Edit: `apps/api/src/services/rbac-object-resolver.ts`:
  - add `resolveRow` → `{ createdBy, parentId }`;
  - `resolveCreatedBy` wraps it.
- Edit: `apps/api/src/tools/transform-entity-records.tool.ts`: change only the comment at `:307–329`, pointing at the gate.
- Edit:
  - `apps/api/src/__tests__/services/permission-gate.service.test.ts`, including the existing create-shape case at `:40`;
  - `child-write-parent.agreement.integration.test.ts`, adding the tool column;
  - `__integration__/tools/agent-create-existing-key.integration.test.ts`:
    - at `:278`, the new-key create uses a member-owned instance;
    - add a case for the owner's instance → `TOOL_PERMISSION_DENIED`.
- New: transform cases, in the existing transform integration suite or a new file beside the agreement test.

**Steps**

1. **Tests.**
   - Gate unit (12):
     - create: not found, denied, runs, empty items, one bad item of two;
     - batch: parent read-only, and the parent taken from the row rather than the input;
     - bulk: target read-only, source unreadable, all good;
     - the updated `:40` case;
     - a resolution throw → denied.
   - Agreement tool column: `TOOL_TARGET_NOT_FOUND` / `TOOL_PERMISSION_DENIED` / success, with the row counts unchanged on refusal.
   - Transform (2): an other-org second target → not found with nothing enqueued; a read-only second target → denied.
   - #825 (2).

   Run them; they fail.
2. **Implement** the code, the resolver and the gate branches. It turns green.
3. Run the full api integration suite again, since tool fixtures may hit the same system-parent pattern as slice 3. Then lint and type-check.

**Done when:**
- the agreement matrix holds on all four surfaces;
- transform refuses on any bad target before enqueue;
- the #825 suite is green.

**Risk:**
- `system.prompt.test.ts` might pin the gate's codes. If so, the test update rides here and the prose moves in slice 6.

---

## Slice 5 — Web gates and mapping picker

This slice stops Add record, New entity and Create field mapping from offering themselves without parent write.

**Files**

- Edit: `apps/web/src/utils/entity-actions.util.ts` (`:76`): `createRecord.allowed &&= capabilities.write`.
- Edit: `apps/web/src/utils/connector-instance-actions.util.ts` (`:57`): `createEntity.allowed &&= capabilities.write`.
- Edit: `apps/web/src/api/connector-entities.api.ts` (`:134`): add a `filterItem` option to `SearchHookOptions`.
- Edit: `apps/web/src/views/ColumnDefinitionDetail.view.tsx` (`:160`): the mapping picker passes `filterItem: e => e.capabilities.write`. The ref-key picker at `:162` stays as is.
- Edit: `EntityDetail.view.tsx` and `ConnectorInstance.view.tsx`, only if the gate inputs need threading.
- Edit:
  - `apps/web/src/__tests__/entity-actions.util.test.ts`;
  - `connector-instance-actions.util.test.ts`;
  - `ColumnDefinitionDetailView.test.tsx`.

**Steps**

1. **Tests (spec web: 3).**
   - createRecord hidden on a non-writable entity even with the type create rule;
   - createEntity likewise;
   - the picker omits a `capabilities.write: false` entity.

   Run them; they fail.
2. **Implement.** It turns green. `action-gate.guard.test.ts` must stay green: the gate goes through `decideActionGate`, never `disabled={…}`.
3. Lint and type-check.

**Done when:** the 3 cases pass and the web guards are green.

**Risk:** a client-side `filterItem` can make a search page look short. That's accepted per the spec; the server still refuses.

---

## Slice 6 — Docs, tool descriptions, prompt

The documented contract now matches the enforced rule.

**Files**

- Edit the eight child-tool `.tool.ts` descriptions and their mirrors in `packages/core/src/registries/builtin-toolpacks.ts`:
  - `connector_entity_create` / `_update` / `_delete`
  - `field_mapping_create` / `_update` / `_delete`
  - `entity_record_create` / `_update` / `_delete`
  - `bulk_geocode_records`
  - `transform_entity_records`
- Edit: `apps/api/src/prompts/system.prompt.ts`: relay `TOOL_TARGET_NOT_FOUND` as "not found" and `TOOL_PERMISSION_DENIED` as missing access, with no retry.
- Edit: `CLAUDE.md` Authorization bullets (read → write on the parent; name `CHILD_RESOURCE_PARENTS` + `ParentAccessService`), and `.github/copilot-instructions.md`.

**Steps**

1. **Tests.**
   - `builtin-toolpacks.test.ts` keeps each mirror equal to its tool description, and `system.prompt.test.ts` pins the new guidance line.
   - Both fail after the tool-side edit.
2. **Implement** the mirrors and the prompt. They turn green. `permission-copy.guard.test.ts` must stay green: the copy names permissions, never roles.
3. Lint and type-check.

**Done when:** the description, mirror and prompt pins are green, and CLAUDE.md and copilot say "write on the parent".

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Core table, descriptor fields, guard | core unit (7), root build |
| 2 | `ParentAccessService` | api unit (7) |
| 3 | REST routes + child capabilities + referenced-entity reads | agreement REST/capabilities columns, full api integration |
| 4 | Permission gate, `TOOL_TARGET_NOT_FOUND`, transform, #825 | gate unit (12), agreement tool column, full api integration |
| 5 | Web gates + picker | web unit (3), web guards |
| 6 | Tool descriptions, prompt, CLAUDE.md | mirror/prompt pins, copy guard |

## Cross-slice notes

- **The behaviour change is in slice 3** (REST) and **slice 4** (agent). From slice 3 on, a local smoke as the default member sees Sandbox as read-only. That's the intent, and the PR body says so.
- **Fixtures:** slices 3 and 4 run the full api integration suite, not just the touched files. Here the change is a rule, so its blast radius is any test fixture where a member writes under a system-owned parent. This is an exception to "run only touched files".
- **`CHILD_RESOURCE_PARENTS`** is the only place the child→parent mapping lives. Routes, `attachChildren`, `resolveRow` and the guard all read it. Nothing re-spells `connectorEntityId`/`connectorInstanceId` as a parent key.
- **Doc sync:** OpenAPI 403 text and route-map notes ride with slice 3 (the routes they describe); everything prose-facing is slice 6.
- **Local leftovers** from the #829 repro (mapping `10ac0f86…`, record `0d5e4503…`, and the probe entities) are cleaned before the smoke walk, not in a slice.

## Next step

Implementation starts on `fix/829-agent-child-create-authz` with slice 1, tests first, one commit per slice, once this plan is confirmed.
