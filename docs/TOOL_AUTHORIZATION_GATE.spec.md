# Per-caller tool-authorization gate + RBAC-management toolpack — Spec

Pins the contract for [#629](https://github.com/EnterpriseBT/portal-ai/issues/629), from `docs/TOOL_AUTHORIZATION_GATE.discovery.md`. A per-caller, **per-object** authorization gate on every write the agent attempts (surfacing a typed refusal, fail-closed) + an `rbac_management` builtin toolpack (companion to `entity_management`) that mirrors the UI's RBAC surfaces.

## Key decisions (flag for review)

1. **One `PermissionSet` per session.** `buildAnalyticsTools` resolves the caller's `PermissionContext` and calls `loadSet` **once**; the resulting set already unions **roles ∪ direct grants ∪ group memberships** (`loadSet`, `permission.service.ts:72`). Threaded to the wrapper + the RBAC tools.
2. **Per-object, O(1).** Single-object writes → one in-memory `can` check on the target's `createdBy`; **bulk** writes → the tool ANDs `visibilityPredicate` into its write `WHERE` (DB-enforced per-row, one statement). Never a per-row check.
3. **The gate is authoritative; every denial surfaces.** A pre-flight `can` (descriptor-carrying tools) **and** a catch of any `ApiError(403)` thrown in `execute` both return the same `TOOL_PERMISSION_DENIED` typed tool-result. Fail-**closed** on resolution error (unlike the cost gate's fail-open).
4. **RBAC-management is a normal builtin pack** (`rbac_management`), tier-entitled at baseline like `entity_management` — not `alwaysAvailable`. Its tools are per-caller-gated by their own services (no double pre-flight).
5. **Scope mirrors the UI** — `AccessAuthoring` (policy/role/group CRUD + attach + member role·group assignment) + `ShareDialog` (grant share·revoke). No view management (#599).

## Scope

### In scope
- Thread `PermissionContext` + one resolved `PermissionSet` into `buildAnalyticsTools`.
- A `wrapWithPermissionGate` wrapper (per-object pre-flight + catch-403 → typed refusal), outside the cost gate.
- A `ToolAuthorization` descriptor per write tool + the `writes[]`-kind → `PermissionResourceType` mapping.
- Extend `RbacObjectResolver.OBJECT_FINDERS` to the data-plane types (`field_mapping`, `entity_record`).
- `TOOL_PERMISSION_DENIED` ApiCode.
- The `rbac_management` pack (slug, spec, CAPABILITIES, tools, tier entitlement).
- Coverage guard test (incl. the O(1)/predicate invariant).

### Out of scope
- View-management tools (#599); role-gated navigation (#630).
- Instance-level checks on *reads* (the session views already scope reads).
- New RBAC operations beyond what the UI exposes.

## Surface

### `apps/api/src/services/permission-gate.service.ts` (new)

```ts
/** A write tool's authorization descriptor (data). Declared per tool alongside
 *  CAPABILITIES; absent = the tool is not a data-plane write (read/pure tools). */
export interface ToolAuthorization {
  verb: "write" | "delete";
  resourceType: PermissionResourceType;   // permission.model.ts:36 — the resolved type
  mode: "create" | "single" | "bulk";
  /** single/delete only: the validated-input key carrying the target object id. */
  targetIdArg?: string;
}

/** Decorate every write tool's execute (in place), mirroring wrapWithCostGate.
 *  - create → can("resource.write", {type})            (new row is caller-owned)
 *  - single/delete → resolve the target's createdBy (RbacObjectResolver) →
 *                    can("resource.<verb>", {type, id, createdBy})
 *  - bulk → NO per-row pre-flight; the tool self-scopes via visibilityPredicate
 *           (built with the PermissionSet), verified by the guard.
 *  Every wrapped execute also try/catches ApiError(403) → the typed refusal.
 *  Deny ⇒ return { error: { code: TOOL_PERMISSION_DENIED, message } } (a tool
 *  result the agent relays). Fail-closed: a resolution error denies. */
export function wrapWithPermissionGate(
  tools: Record<string, GateableTool>,               // cost-gate.service.ts:304
  permissionSet: PermissionSet,                      // permission-set.ts
  ctx: { organizationId: string; userId: string },
  authFor: (toolName: string) => ToolAuthorization | undefined
): void;
```

- Ordering: applied **before** (outside) `wrapWithCostGate` in `buildAnalyticsTools`, so a denied call never reaches cost admission or `execute`.
- The typed refusal reuses the `Denial.result` shape (`cost-gate.service.ts:99`): `{ error: { code: ApiCode.TOOL_PERMISSION_DENIED, message } }`.

### `apps/api/src/services/tools.service.ts` — thread the context + wire the gate

- `buildAnalyticsTools(organizationId, stationId, userId, portalId?)` (`:393`): resolve the caller's roles via `userRole.findEffectiveRoleNames(userId, organizationId)`, build `ctx: PermissionContext`, call `PermissionService.loadSet(ctx)` **once** → `permissionSet`. Pass `permissionSet` to bulk-write tools' `.build(...)` and to `wrapWithPermissionGate(tools, permissionSet, {organizationId, userId}, toolAuthorizationFor)` — invoked **before** `wrapWithCostGate` (`:773`).
- Add the `rbac_management` assembly block (mirroring the `entity_management` block at `:639`): `if (effective.has("rbac_management")) { tools.policy_create = new PolicyCreateTool().build(ctx); … }`. These tools receive the full `PermissionContext` (not just `userId`) so they call the RBAC services.
- The station-level `isWriteGated` drop (`:758`) stays as defense-in-depth.

### `packages/core/src/models/tool-capability.model.ts` — the writes[]-kind → type map

```ts
/** writes[]/reads[] entity-kinds are plural table names; the gate needs the
 *  singular PERMISSION_RESOURCE_TYPE. */
export const WRITE_KIND_TO_RESOURCE_TYPE: Record<string, PermissionResourceType> = {
  field_mappings: "field_mapping",
  entity_records: "entity_record",
  connector_entities: "entity",
  connector_instances: "connector_instance",
};
```

### `packages/core/src/registries/builtin-toolpacks.ts` — descriptors + the pack

- `BuiltinToolpackSlugSchema` (`:32`): add `"rbac_management"`.
- A `TOOL_AUTHORIZATION: Record<string, ToolAuthorization>` map (parallel to `CAPABILITIES`, `:1180`): one entry per data-plane write tool (`field_mapping_create` → `{verb:"write", resourceType:"field_mapping", mode:"create"}`, an update/delete → `mode:"single", targetIdArg:"…"`, a bulk tool → `mode:"bulk"`). The gate's `authFor` reads this map.
- `BuiltinToolpackSpec` for `rbac_management` (`:97`) + its tools in `CAPABILITIES` (each `writes[]` set, `costHint:"free"`) — `attachCapabilities` (`:1375`) throws if any lacks an entry — + add to `BUILTIN_TOOLPACKS` (`:1392`). Mirror in the hand-authored `builtin-toolpacks` modal source per CLAUDE.md's tool-doc rule.

### `packages/core/src/registries/tier-catalog.ts` — entitlement

- Add `"rbac_management"` to **every** tier's `builtinToolpacks` (`:46`; `standard` `:128` … `enterprise`) — baseline-and-up, like `entity_management`. Reaches existing envs via `portalops tier apply`; `SeedService.seedTiers` bootstraps `standard`.

### `apps/api/src/services/rbac-object-resolver.ts` — data-plane finders

Extend `OBJECT_FINDERS` (currently station/pin/portal/connector_instance/entity, `:20`) with the data-plane write types the gate resolves:

```ts
field_mapping: (id) => DbService.repository.fieldMappings.findById(id),
entity_record: (id) => DbService.repository.entityRecords.findById(id),
```

(both rows carry `organizationId` + `createdBy` via `baseColumns`; `resolveCreatedBy` already org-scopes + returns `null` fail-closed.)

### `apps/api/src/tools/rbac/*.tool.ts` (new) — the RBAC-management tools

One `Tool` subclass per UI-mirrored operation, each `build(ctx: PermissionContext)` returning an AI-SDK tool whose `execute` calls the shipped service with `ctx` and returns its result — **no** own permission check (the service self-gates; a thrown 403 surfaces via the wrapper's catch): `policy_{create,update,delete,list}`, `role_{create,update,delete,list}`, `group_{create,update,delete,list}`, `policy_{attach,detach}`, `member_roles_set`, `member_groups_set`, `grant_{share,revoke,list}` → `PolicyService`/`RoleService`/`GroupService`/`GrantService` (`{policy,role,group,grant}.service.ts`). Exact op list = the UI's `AccessAuthoring` + `ShareDialog` surfaces.

### `apps/api/src/constants/api-codes.constants.ts`

- Add `TOOL_PERMISSION_DENIED = "TOOL_PERMISSION_DENIED"` (format `<DOMAIN>_<FAILURE>`), alongside `TOOL_USAGE_*`.

### `apps/api/src/prompts/system.prompt.ts`

- Note the `rbac_management` tools + that any tool may return `TOOL_PERMISSION_DENIED`, which the agent relays to the user (per the tool-doc-sync rule).

## Migration / Seed

**No DB migration** — no schema change. The tier-catalog edit is code; existing envs converge via `portalops tier apply --env <e>`, and `SeedService.seedTiers` bootstraps `standard` on a fresh DB. No backfill.

## TDD test plan

### `apps/api` unit — `apps/api/src/__tests__/services/permission-gate.service.test.ts` (new)
- `create` → `can("resource.write",{type})`; allow passes through, deny returns `TOOL_PERMISSION_DENIED`.
- `single` → resolves `createdBy`, checks per object; a member denied on another's object gets the refusal; owner of the object passes.
- catch: a tool whose `execute` throws `ApiError(403)` returns the typed refusal (not a throw).
- fail-closed: a resolver error → deny.
- ordering: authorization runs before cost admission (a denied call never calls `checkAdmission`).

### `apps/api` unit — `apps/api/src/__tests__/services/tools.service.test.ts` (extend `:786`)
- **Coverage guard:** every built tool with a non-empty `writes[]` is either (a) covered by `TOOL_AUTHORIZATION` + pre-flight-wrapped, or (b) an `rbac_management` tool routing to a self-gating service — asserted by intercepting `PermissionSet.can` / the service gate.
- **O(1) invariant:** a bulk write tool issues O(1) permission queries regardless of row count — spy DB round-trips (per the cost-gate guard's counting technique); assert no per-row `resolveCreatedBy`.
- `rbac_management` present only when entitled + enabled; its tools carry `costHint:"free"`.

### `packages/core` unit — `registries` tests
- `builtin-toolpacks.test.ts`: `rbac_management` slug + spec + every tool has a `CAPABILITIES` entry (`attachCapabilities` doesn't throw); the `TOOL_AUTHORIZATION` map covers every data-plane write tool.
- `tier-catalog.test.ts`: `rbac_management` on every tier's `builtinToolpacks`.

### `apps/api` integration — `apps/api/src/__tests__/__integration__/...rbac-tools.integration.test.ts` (new)
- End-to-end: a member calling a `policy_create` tool without `member.role.assign` gets the surfaced refusal; an admin succeeds and an `audit_log` row is written (service audits).
- A data-plane write tool: a member writes their own record (allow) but not another's (refusal).

**Totals ≈ 22 cases.** Run `cd apps/api && npm run test:unit` / `test:integration`, `cd packages/core && npm run test:unit`.

## Acceptance criteria

- A member cannot mutate via the agent what they cannot in the UI: a write tool the caller lacks permission for returns `TOOL_PERMISSION_DENIED` and performs no write; the agent relays it.
- Denials surface from **both** paths — a pre-flight `can` and a service-thrown 403 — as the same typed refusal.
- A **bulk-write tool issues O(1) permission queries regardless of row count** (test-enforced); per-row permission checks are absent.
- The `rbac_management` pack is entitled at baseline (like `entity_management`); its tools succeed only for a caller the service gate admits, and every mutation is audited.
- A new write tool that skips the authorization descriptor/wrapper fails the coverage guard.
- A denied call is never charged (authorization precedes cost admission).

## Risks & rollback

- **Fail policy:** the gate is **fail-closed** — a resolution error denies (contrast the cost gate's fail-open). A bug that over-denies degrades the agent to read-only for writes (safe); an under-deny would be a security hole, which the coverage guard + per-object tests target. Rollback: the wrapper is one call in `buildAnalyticsTools`; removing it reverts to today's station-level gating (no schema to unwind).
- **Bulk correctness** hinges on each bulk tool ANDing `visibilityPredicate`; the O(1) + per-object integration tests are the detector.

## Files touched

**New:** `services/permission-gate.service.ts`, `tools/rbac/*.tool.ts`, `__tests__/services/permission-gate.service.test.ts`, `__tests__/__integration__/.../rbac-tools.integration.test.ts`.
**Edit:** `services/tools.service.ts`, `services/rbac-object-resolver.ts`, `constants/api-codes.constants.ts`, `prompts/system.prompt.ts`, `packages/core/src/models/tool-capability.model.ts`, `registries/builtin-toolpacks.ts`, `registries/tier-catalog.ts`, the `builtin-toolpacks`/`tier-catalog`/`system.prompt`/`tools.service` tests.

## Next step

`docs/TOOL_AUTHORIZATION_GATE.plan.md` slices this into ~4 TDD commits on this branch: (1) thread `PermissionContext` + `loadSet` + `wrapWithPermissionGate` (create/single) + `TOOL_PERMISSION_DENIED` + the coverage guard; (2) the `RbacObjectResolver` extension + the bulk `visibilityPredicate` path + the O(1) invariant test; (3) the `rbac_management` pack + tools + tier entitlement; (4) doc-sync (mirror + `system.prompt`) — each behind a green suite.
