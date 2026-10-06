# Create gates that agree with the create routes — Spec

This spec pins how the web learns whether the caller may create an object of a type. The answer is a server-computed `create` on `resourcePermissions[type]`. One per-type rule table produces it by running each create route's own check, and every create gate reads it. Discovery: `docs/OWNED_GRANT_CREATE_GATES.discovery.md`. Issue: [#708](https://github.com/EnterpriseBT/portal-ai/issues/708) (child of epic #684).

## Key decisions (flag for review)

1. **`create` is a fourth field on each `resourcePermissions[type]` entry** (discovery D1-B). `read`, `write` and `delete` keep their meaning: `canPerformAny`, the honest "does any grant exist" signal. They are not action gates. `create` is the only create gate.
2. **One rule table, `CREATE_RULES`, in `permission.service.ts`** (D2-A). It assigns each type `class`, `owned` or `none`, and `create` is computed from the rule with `set.can`. That is the same predicate the routes run, so conditions, instance scope and denies are all honoured.
3. **All 14 resource types are covered** (D3-C, OQ1). The ten user-creatable types get `class` or `owned`. `connector_definition` and `job` get `none` and are always `false`, so the map stays total and `create` is required in the schema.
4. **Fail closed.** The web's `canOnResource` already returns `false` for an absent map or type (`?? false`), and the routes still enforce.
5. **The guard bans `canOnResource(<type>, "write" | "delete")` in `apps/web` source** (OQ3). Every current use is a create, which moves to `"create"`. Per-object write and delete come from row `capabilities` (#688).
6. **Connect gates on `connector_instance` `create`**, which mirrors the generic `POST /api/connector-instances` (OQ2). The Sheets, Excel and file-upload connect flows don't run that check on the server. That is tracked as **#710**, not fixed here.
7. **`write` and `delete` stay in the contract**, now with no web consumer. Removing them would be a wider contract cut with no caller to justify it, and the guard keeps them out of gates.

## Scope

### In scope

- `create` on `ResourcePermissionMapSchema` (core).
- The `CREATE_RULES` table and `create` computation in `PermissionService.permissionMaps` (api).
- Moving all ten web create gates from `"write"` to `"create"`, and `ResourceVerbs` gaining `create`.
- Extending the action-gate guard.
- The agreement integration matrix, and updating the tests that assert the map's exact shape.
- CLAUDE.md's Action Affordances section and its `.github/copilot-instructions.md` mirror.

### Out of scope

- Any route's authorization. The connect-flow gap is #710.
- Instance-scoped *create* grants ("may create under connector X"). The routes don't model them, and `create` reports what the routes do.
- Parent readability on owned creates (portal → station, entity → connector instance, field mapping and record → entity). That is per-page context, and the pages already require the parent to be readable to render.
- Removing `write` and `delete` from `ResourcePermissionMap` (Key decision 7).
- The `customToolpacks` entitlement on toolpack Register. #691's upsell already covers it, after the permission.

## Surface

### `ResourcePermissionMapSchema` (`packages/core/src/models/permission.model.ts:242-250`)

```ts
export const ResourcePermissionMapSchema = z.record(
  ResourcePermissionTypeSchema,
  z.object({
    read: z.boolean(),
    write: z.boolean(),
    delete: z.boolean(),
    /** #708: the caller may create one, by the type's create route's own
     *  check (`CREATE_RULES`). The only create gate; read/write/delete are
     *  `canPerformAny` signals, never action gates. */
    create: z.boolean(),
  })
);
```

- `OrganizationGetResponseSchema.resourcePermissions` (`organization.contract.ts:31`) stays `.optional()`.
- The OpenAPI component `OrganizationGetResponse` (`swagger.config.ts:350`) derives from it, so there's no hand edit.

### `CreateRule` + `CREATE_RULES` (`apps/api/src/services/permission.service.ts`, beside `DERIVED_CAPABILITIES`)

```ts
/** How a type's create route authorizes (#708):
 *  - `class`: `{ type }`, an unconditional grant (owner/admin by default);
 *  - `owned`: `{ type, createdBy: ctx.userId }`, the caller's own;
 *  - `none`: no user create route (system-created). */
type CreateRule = "class" | "owned" | "none";

const CREATE_RULES: Record<ResourcePermissionType, CreateRule> = {
  station: "owned",            // POST /api/stations
  pin: "owned",                // POST /api/portal-results
  curated_view: "class",       // POST /api/curated-views (#599)
  portal: "owned",             // POST /api/portals
  entity: "owned",             // POST /api/connector-entities
  entity_record: "owned",      // POST /api/connector-entities/{id}/records
  field_mapping: "owned",      // POST /api/field-mappings
  connector_instance: "owned", // POST /api/connector-instances (#710: other connect flows)
  connector_definition: "none",
  entity_group: "class",       // POST /api/entity-groups
  tag: "class",                // POST /api/entity-tags
  column_definition: "class",  // POST /api/column-definitions
  job: "none",
  toolpack: "class",           // POST /api/toolpacks
};
```

Each entry carries a comment naming its route, so a reviewer can check it against `route-authorization.map.ts`. A new resource type fails type-check until it has a rule, because the `Record` is exhaustive.

### `PermissionService.canCreate` + `permissionMaps` (`permission.service.ts:280-306`)

```ts
/** #708: the create route's check for `type`, per `CREATE_RULES`. */
static canCreate(
  ctx: PermissionContext,
  set: PermissionSet,
  type: ResourcePermissionType
): boolean {
  switch (CREATE_RULES[type]) {
    case "class": return set.can("resource.write", { type });
    case "owned": return set.can("resource.write", { type, createdBy: ctx.userId });
    case "none": return false;
  }
}
```

`permissionMaps` adds `create: PermissionService.canCreate(ctx, set, type)` to each entry, using the `set` it already loads once. The `read`, `write` and `delete` lines are unchanged.

### Web: `ResourceVerbs` (`apps/web/src/utils/use-capabilities.util.ts:11-15`)

Adds `create: boolean`, with the same doc note as the schema. `canOnResource(type, "create")` reads it with `?? false` (fail closed).

### Web create gates: `"write"` → `"create"`

| File:line | Expression after |
|---|---|
| `views/Tags.view.tsx:168` | `allowed: canOnResource("tag", "create")` |
| `views/ColumnDefinitionList.view.tsx:183` | `allowed: canOnResource("column_definition", "create")` |
| `views/EntityGroups.view.tsx:356` | `allowed: canOnResource("entity_group", "create")` |
| `views/Toolpacks.view.tsx:413` | `allowed: canOnResource("toolpack", "create")` |
| `views/CuratedViews.view.tsx:186` | `allowed: canOnResource("curated_view", "create")` |
| `views/Connector.view.tsx:84` | `canCreateInstances = canOnResource("connector_instance", "create")` |
| `views/Entities.view.tsx:261` | `allowed: canOnResource("entity", "create")` |
| `views/ConnectorInstance.view.tsx:354` | `canCreateEntity: canOnResource("entity", "create")` |
| `views/ColumnDefinitionDetail.view.tsx:71` | `allowed: canOnResource("field_mapping", "create")` |
| `views/EntityDetail.view.tsx:658` | `create: canOnResource("entity_record", "create")` |
| `components/PortalMessage.component.tsx:341` | `canPin={canOnResource("pin", "create")}` |

- Every plausible-primary `canOnResource(type, "read")` stays as it is.
- The doc comments that cite `"write"` for a create are updated: `connector-instance-actions.util.ts:12`, `entity-actions.util.ts:9` and `PortalMessage.component.tsx:108`.

### Guard (`apps/web/src/__tests__/action-gate.guard.test.ts`)

A new `describe`: **"a create gate reads `create`, never `write`/`delete` (#708)"**.
- It scans the same file set as the existing guard (`.ts`/`.tsx` under `apps/web/src`, excluding `__tests__` and `stories`).
- It fails on any **code** match of `canOnResource\(\s*"[a-z_]+",\s*"(write|delete)"\s*\)`. Comments are stripped before matching, so a doc comment can't trip it.
- There is no known-violations list: the set is empty after this ticket.
- The failure message names the file:line and says "use `canOnResource(type, "create")` for a create; per-object write/delete come from the row's `capabilities`."

### Docs

- **CLAUDE.md** → "Action Affordances & Permissions (apps/web)": replace "A class-level `canOnResource` gates only a create" with a create reading `canOnResource(type, "create")`, computed by the create route's own check (`CREATE_RULES`). Add that `read`/`write`/`delete` on `resourcePermissions` are any-grant signals and never gates (the guard enforces it).
- **`.github/copilot-instructions.md`:** the same sentence in its condensed paragraph.

## Migration

None: no schema change.

## Seed

None. `create` is computed from the existing seeded policies.

## TDD test plan

Run with the package scripts:
- `cd packages/core && npm run test:unit`
- `cd apps/api && npm run test:unit && npm run test:integration`
- `cd apps/web && npm run test:unit`

### Layer 1: core

1. `ResourcePermissionMapSchema` requires `create`; an entry without it fails to parse (`packages/core/src/__tests__/models/permission.model.test.ts`).
2. `OrganizationGetResponseSchema` parses a payload whose `resourcePermissions` entries carry `create` (`organization.contract.test.ts`).

### Layer 2: api unit (`apps/api/src/__tests__/services/permission-create.service.test.ts`, new)

These evaluate over the seeded system policies, using `object-capabilities.service.test.ts`'s `setFor` pattern plus hand-built statements:

3. **owner:** `create` is true for all 12 creatable types and false for `connector_definition` and `job`.
4. **seeded member:** `create` is true for the 7 `owned` types and false for the 5 `class` types. **`curated_view` is false** (the seeded bug).
5. **custom `write tag created_by_caller`:** `tag.create` is false (class rule), though `tag.write` (`canPerformAny`) is true.
6. **custom instance-only `write connector_instance:<id>`:** `connector_instance.create` is false (an owned create carries no id).
7. **`created_by_system`-only `write pin`:** `pin.create` is false.
8. **allow `write entity created_by_caller` with deny `write entity created_by_caller`:** `entity.create` is false.
9. **`none` types:** false even under `* *`.

### Layer 3: api integration agreement matrix (`apps/api/src/__tests__/__integration__/routes/create-capability.agreement.integration.test.ts`, new)

- **Callers:**
  - **owner;**
  - **seeded member;**
  - **custom owned-only:** a custom group policy granting `write <type> created_by_caller` on all ten creatable types, seeded per `permission-loadset.integration.test.ts:340-397`;
  - **instance-only:** `write connector_instance:<id>`, `write pin:<id>`, `write station:<id>`.
- **Method:** for each caller × creatable type, `GET /api/organization/current` → `resourcePermissions[type].create`, then call that type's real create route with a minimal valid body and readable parents.
- **Assertion:** `create === true` ⇔ the route answers 2xx (or any status except 403/404 on authorization). `create === false` ⇔ 403.
- Cases 10–13: one `it.each` per caller over the ten types (≈ 34 rows).
- **14:** regression. As the seeded member, `curated_view.create` is false and `POST /api/curated-views` returns 403.

### Layer 4: api exact-map updates

15. `permission-maps.integration.test.ts:62-91`: the member and owner expectations gain `create`. The member gets `connector_instance.create: true`, `station.create: true`, `job.create: false` and `entity_group.create: false`.

### Layer 5: web

16. `useCapabilities.test.tsx`: `canOnResource(type, "create")` reads the map, and is false when the map or type is absent.
17. `CuratedViewsView.test.tsx`: with `curated_view: {read: true, write: true, create: false}` (the seeded member), Create View is `aria-disabled` with the grant hint, not enabled.
18. `TagsView`, `ColumnDefinitionListView`, `EntityGroupsView`, `Toolpacks.view`, `EntitiesView`, `ColumnDefinitionDetailView`, `EntityDetailView`, `PortalMessage` and `Connector`: fixtures move to `create`. A `write: true, create: false` case hides or disables the Create (one case each, ≈ 9).
19. `action-gate.guard.test.ts`: the new rule passes on the tree, and its matcher flags a fixture string `canOnResource("tag", "write")` and ignores the same string in a comment.

**Totals ≈ 60 cases** (≈ 34 of them in the integration matrix).

## Acceptance criteria

- As a plain member under the seeded policies, **Views** shows Create View disabled with "Ask … to create views", not enabled.
- As the owner, every Create in the app is enabled.
- With a custom owned-only grant on tag, column definition, entity group or toolpack, that page's Create isn't enabled.
- With an instance-only or `created_by_system`-only grant on a type, its Create isn't enabled, and its route refuses the create.
- For every creatable type and every tested caller, `resourcePermissions[type].create` is true exactly when that type's create route doesn't refuse with 403.
- No file in `apps/web/src` gates an action on `canOnResource(…, "write" | "delete")`, and CI's guard fails if one is added.
- CLAUDE.md and its mirror state the `create` convention.

## Risks & rollback

- **A rule row that disagrees with its route** (e.g. a route later changed from class to owned). The integration matrix fails on it. That's the reason it drives real routes, not the table.
- **A web fixture or consumer that builds `resourcePermissions` by hand without `create`.** TypeScript catches the typed ones. Untyped test fixtures read `create` as `undefined`, so `canOnResource` is false: fail closed, never a wrongly enabled action.
- **Fail mode: closed.** A missing `create` hides or disables a Create, it never enables one, and the routes stay the boundary. The cost is UX (a hidden Create), never safety.
- **Rollback:** revert the PR. `create` is additive. Reverting restores `"write"` gates, which were the pre-#708 behaviour.

## Files touched

- **Edit:**
  - `packages/core/src/models/permission.model.ts`
  - `apps/api/src/services/permission.service.ts`
  - `apps/web/src/utils/use-capabilities.util.ts`
  - the 11 gate sites in the table above
  - the three doc comments (`connector-instance-actions.util.ts`, `entity-actions.util.ts`, `PortalMessage.component.tsx`)
  - `apps/web/src/__tests__/action-gate.guard.test.ts`
  - `CLAUDE.md`, `.github/copilot-instructions.md`
- **New:**
  - `apps/api/src/__tests__/services/permission-create.service.test.ts`
  - `apps/api/src/__tests__/__integration__/routes/create-capability.agreement.integration.test.ts`
- **Test edits:** `permission.model.test.ts`, `organization.contract.test.ts`, `permission-maps.integration.test.ts`, `useCapabilities.test.tsx`, and the web view and component tests in Layer 5.

## Next step

`/plan 708` (`docs/OWNED_GRANT_CREATE_GATES.plan.md`, on this branch) slices this into three TDD commits:
1. **Contract and server:** the core schema, `CREATE_RULES` / `canCreate`, the unit cases and the agreement matrix.
2. **Web:** the gates move to `create`, the guard rule and the fixture updates.
3. **Docs:** CLAUDE.md and its mirror.
