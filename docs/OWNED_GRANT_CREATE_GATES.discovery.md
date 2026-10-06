# Create gates that agree with the create routes — Discovery

**Issue:** [EnterpriseBT/portal-ai#708](https://github.com/EnterpriseBT/portal-ai/issues/708) · Bug · child of epic #684 · branch `fix/708-owned-grant-create-gates` (from `epic/per-object-action-affordances`)

**Why this exists.** The web gates every Create on `useCapabilities().canOnResource(type, "write")`, which reads `resourcePermissions`. The server computes that with `PermissionSet.canPerformAny`, which is true for *any* matching allow, whatever its condition or instance scope. The create routes are stricter, in two different ways:
- **Class creates:** tag, column definition, entity group, toolpack and curated view run a bare class check (`{ type }`) that only an unconditional grant satisfies.
- **Owned creates:** connector instance, entity, field mapping, record and pin check `{ type, createdBy: userId }`, which an instance-scoped or `created_by_system`-only grant doesn't satisfy.

So the client can say yes while the route says no.

#708 was filed for the three custom-RBAC cases on tags, column definitions and entity groups. The survey found the same mismatch already firing **under the seeded policies**:
- `MemberAccess` grants every member `write curated_view created_by_caller`.
- The curated-view create route excludes exactly that grant (`curated-view.router.ts:395-399`, by design per #599).
- So every plain member sees an enabled **Create View** that always returns 403. It arrived with #688's reference adoption, so it's in the epic, not yet on `main`.

This ticket is the create-side counterpart of #689's derived record capabilities: **one server-computed "may create" answer per type, using the route's own check.**

## The current shape

### Where the client and the server diverge

| Piece | Location | Note |
|---|---|---|
| `canPerformAny(verb, type)` | `apps/api/src/services/permission-set.ts:122-137` | Any allow of that verb and type counts. It ignores `condition` and `resourceId`. Only an unconditional class deny suppresses it. |
| `can` / `matches` | `permission-set.ts:108`, `:385-397` | Requires `resourceId` null or equal to the target's, and the condition satisfied (`created_by_caller` ⇒ `createdBy === ctx.userId`). |
| `resourcePermissions` | `apps/api/src/services/permission.service.ts:297-306` | `{read, write, delete}` per type, all from `canPerformAny`. |
| `ResourcePermissionMapSchema` | `packages/core/src/models/permission.model.ts:242-250` | `z.record(type, {read, write, delete})`. |
| `canOnResource` | `apps/web/src/utils/use-capabilities.util.ts:41-44, 66` | `verb: keyof ResourceVerbs`. |
| Derived caller capabilities | `permission.service.ts:80-95, 260-267`; `CALLER_CAPABILITY_ACTIONS` at `permission.model.ts:130-149` | #690 `station.default.set`; #689 `entity_record.revalidate` / `.clear`. |

### Every create gate, and its route's check

| Web gate | Type | Route check | Agrees with `canPerformAny`? |
|---|---|---|---|
| `Tags.view.tsx:168` | tag | class: `entity-tag.router.ts:359` | **No**: an owned-only grant |
| `ColumnDefinitionList.view.tsx:183` | column_definition | class: `column-definition.router.ts:428` | **No**: an owned-only grant |
| `EntityGroups.view.tsx:356` | entity_group | class: `entity-group.router.ts:426` | **No**: an owned-only grant |
| `Toolpacks.view.tsx:413` | toolpack | class: `toolpacks.router.ts:373` | **No**: an owned-only grant (not in the issue) |
| `CuratedViews.view.tsx:186` | curated_view | class: `curated-view.router.ts:399` | **No**: the **seeded** member grant |
| `Connector.view.tsx:84` | connector_instance | owned: `connector-instance.router.ts:770-773` | Not for instance-only, `created_by_system`-only, or a conditional deny |
| `Entities.view.tsx:261`, `ConnectorInstance.view.tsx:354` | entity | owned: `connector-entity.router.ts:572` | Same |
| `ColumnDefinitionDetail.view.tsx:71` | field_mapping | owned: `field-mapping.router.ts:448-451` | Not for `created_by_system`-only or a conditional deny |
| `EntityDetail.view.tsx:658` | entity_record | owned: `entity-record.router.ts:781-784` | Same |
| `PortalMessage.component.tsx:341` | pin | owned: `portal-results.router.ts:135-138` | Not for instance-only, `created_by_system`-only, or a conditional deny |

- No action is gated on `canOnResource(…, "delete")`.
- Station and portal creates aren't gated on `canOnResource`.
- Every gate also uses `canOnResource(type, "read")` for the plausible-primary state. That is an honest visibility signal and stays as it is.

### Authoring and tests

- **Authoring an owned-only grant:** possible on all four admin-managed types. `objectCapability` sets `ownership: true` (`permission.model.ts:299-309, 324-328`), `validateStatement` allows a condition on a class statement (`:405-432`), and the editor offers the Ownership select (`StatementEditor.component.tsx:176, 293-312`).
- **Instance-scoped grants:** authorable only on `INSTANCE_SEARCHABLE_TYPES` (`permission.model.ts:286-297`).
- **Agreement-test precedent:** `same-org-access.authorization.integration.test.ts:380-439` (#690, #689) compares the `organization/current` capability with the route's status.
- **Custom-policy seeding precedent:** `permission-loadset.integration.test.ts:340-397` (group, custom policy, statements, attachment, user–group).
- **Exact-map assertions that change with the contract:**
  - `permission-loadset.integration.test.ts:204-234`
  - `organization.router.integration.test.ts:147-159`
  - `organization.contract.test.ts:17-27`
  - `permission.model.test.ts:511-529`
  - `permission-maps.integration.test.ts:62-91`

## The design space

### Decision 1: how the client learns "may create"

**A. A derived caller capability per type** (`tag.create`, `column_definition.create`, …), as #690 and #689 did.
- Exact, and already a pattern here.
- Needs ten new keys, each added by hand to `CALLER_CAPABILITY_ACTIONS` and the exact-map tests.
- The owned creates would also need per-type entries carrying the caller's id.

**B. A `create` verb on `resourcePermissions[type]`.**
- The server computes it from a single per-type **create rule** table: `class` ⇒ `set.can("resource.write", { type })`, `owned` ⇒ `set.can("resource.write", { type, createdBy: ctx.userId })`.
- The web gates read `canOnResource(type, "create")`.
- One table covers every type, including ones added later, and the create answer sits beside read/write/delete, where the gates already look.

**C. Fix `canPerformAny`** so it honours conditions and instances.
- Not possible: `resourcePermissions.read` is meant to be the honest "will a list show anything" signal (`permission.service.ts` documents this), so it **must** count owned and system grants. A create answer is a different question.

| | A: derived per type | B: `create` verb | C: change canPerformAny |
|---|---|---|---|
| Mirrors the route exactly | Yes | Yes, via the rule table | No: breaks the read signal |
| Covers owned creates (f–j) | Needs ten entries | Yes, the same table | n/a |
| Contract change | Ten capability keys | One field per type | None, but wrong |
| Next new type | New key + tests | One table row | n/a |
| Where gates look | `can(...)` | `canOnResource(type, "create")`, as now | n/a |

**Lean: B.** It's the same idea as A (the route's own check, computed server-side) as a single rule table instead of ten hand-kept keys. It also fixes the owned-create rows that A would need per-type special cases for.

### Decision 2: where the create rule lives

**A. A table in `permission.service.ts`**, next to `DERIVED_CAPABILITIES`.
**B. Declared on `RESOURCE_CAPABILITIES` in core**, so the model owns it.
**C. Exported by each router** and collected.

| | A: service table | B: core model | C: per router |
|---|---|---|---|
| Next to the routes' checks | Close (same package) | Far (core) | Closest |
| Guardable | Yes: an agreement test per type | Yes | Hard: scattered |
| Couples core to route policy | No | Yes | No |

**Lean: A**, pinned by an integration test that drives each type's real create route, so the table can't drift from the routes (Decision 4).

### Decision 3: scope

**A.** Only the issue's three types.
**B.** Every class create: the issue's three, plus toolpack and the seeded curated-view bug.
**C.** B plus the owned creates (connector instance, entity, field mapping, record, pin).

**Lean: C.** With Decision 1B, the owned rows cost one table entry each, and leaving them out leaves known mismatches (instance-only grants, `created_by_system`-only grants, conditional denies) on the surfaces #684 promised to make honest.

### Decision 4: how agreement is proven

**A.** Unit tests on the rule table.
**B.** One parameterized integration test over the types × callers, comparing `organization/current`'s `create` with the real create route's 2xx/403.
- Callers: seeded member, owner, a custom owned-only grant, and an instance-only grant where authorable.

**Lean: B.** It's the #690/#689 precedent widened, and it's the only form that catches the table drifting from a route.

## Tradeoff comparison

| | D1 `create` verb | D2 service table | D3 all ten types | D4 integration matrix |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. Add `create: boolean` to each type in `ResourcePermissionMapSchema`. The `read`/`write`/`delete` meanings don't change.
2. Add a `CREATE_RULES: Record<ResourcePermissionType, "class" | "owned">` table in `permission.service.ts`. `permissionMaps` computes `create` as `set.can("resource.write", { type })` for `class` and `set.can("resource.write", { type, createdBy: ctx.userId })` for `owned`.
3. Every create gate in `apps/web` reads `canOnResource(type, "create")` for `allowed`, and keeps `canOnResource(type, "read")` for the plausible-primary state.
4. A parameterized integration test proves `create` agrees with each type's real create route, for these callers:
   - a seeded member;
   - the owner;
   - a custom `created_by_caller`-only grant;
   - an instance-only grant, where authorable.
5. The seeded curated-view case is a regression test: a plain member gets no enabled Create View.
6. Update the exact-map tests and the CLAUDE.md "Action Affordances" section: a create reads `canOnResource(type, "create")`, never `"write"`.

## Open questions

1. **Should types with no create route get `create`?** `connector_definition` and `job` are created by the system, not a user route. Lean: the table covers every `ResourcePermissionType`, with an explicit `none` rule that yields `false`, so the map stays total.
2. **The Connect flows.** The Sheets/Excel authorize callbacks and file-upload commit create connector instances without the owned-create check the generic `POST /api/connector-instances` runs (route-authorization map, around lines 603-655). So `create` on connector_instance can be stricter than what those flows enforce. Lean: gate Connect on `create` (the stricter, documented rule), and file the server inconsistency separately if spec confirms those flows don't check connector-instance create. That's a server authorization question, not a #708 UI fix.
3. **Is `canOnResource(type, "write")` still used anywhere for a create after this?** Lean: no. Add the `action-gate.guard` style check: fail CI when `canOnResource(…, "write")` feeds an `allowed:` gate. Spec should decide whether the guard scans for that pattern or the gates move behind a helper.
4. **Does #708's ticket need amending?** The seeded curated-view case changes the impact from "custom RBAC only" to "every member", and the scope grew from three types to ten. Lean: yes. Amend the issue's Repro and Impact per `/ticket`'s amendment procedure before spec.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. A read-only computation per request. The route stays the boundary.
- **Accuracy & auditability:** N/A. No new record of truth. The agreement test is the correctness proof.
- **Failure modes:** Lean: fail closed. `create` defaults to `false` when the map is unknown, as `canOnResource` already does (`?? false`), and the route still refuses.
- **Scale & unbounded growth:** N/A. Ten `can` calls per `organization/current`, on a set already loaded once there.
- **Multi-tenancy:** N/A beyond the existing rule: the set is loaded for the caller's org, and the route checks are org-scoped first.
- **Contract stability:** Lean: `create` is additive on an existing map, and the rule table is the extension point. A new type or a tier-gated create adds a row, not new call sites. This is the main reason to prefer D1B over per-type capability keys.
- **Data lifecycle:** N/A.

## What this doesn't decide

- **Changing any route's authorization**, including the Connect-flow inconsistency (OQ2). That's server policy, filed separately if confirmed.
- **Instance-scoped *create* grants** ("may create under connector X"). The routes don't model them today, and `create` reports what the routes do.
- **Per-object write/delete:** untouched. #688's row `capabilities` already mirror the mutation routes.
- **Station and portal creates:** not gated on `canOnResource` today. Spec checks whether either should be.

## Next step

Amend #708 (OQ4), then `/spec 708` fixes the contract (`create` on `ResourcePermissionMap`, the rule table, the gate convention) and `/plan 708` slices it:
1. **Contract + table + agreement matrix** (TDD from the integration test).
2. **Web gates move to `create`**, plus the guard.
3. **Docs**: CLAUDE.md, its mirror, and the help or glossary entries if any.
