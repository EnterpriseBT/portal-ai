# Per-caller tool-authorization gate + RBAC-management toolpack — Discovery

**Issue:** [EnterpriseBT/portal-ai#629](https://github.com/EnterpriseBT/portal-ai/issues/629)

**Why this exists.** The agent's write tools are authorized **per station, wholesale** — `buildAnalyticsTools` drops all `isWriteGated` tools when the station has no write capability (`apps/api/src/services/tools.service.ts:758`), and **no tool calls `PermissionService`** (grep of `apps/api/src/tools` is empty). So the agent's authorization does not track the *caller's* RBAC: within a write-enabled station, the tool layer cannot tell a member who may edit their own records from one who may not, and there is no agent-operable way to administer RBAC. The engine to fix both shipped with #598/#620/#622 — `PermissionService.check(ctx, action, object)` (`permission.service.ts:126`), the `Policy/Role/GroupService` admin surfaces, typed 403 denials. This ticket wires that engine into the tool-execution layer via a build-time authorization wrapper (mirroring the cost gate), a coverage guard test, and an agent-operable **governance toolpack**. Split out of #599 so the tool-layer authorization pattern lands first, against already-shipped RBAC objects.

The **RBAC-management toolpack** is a companion to the entity-management toolpack — it performs RBAC administrative work (create/attach policies, manage roles, create groups, assign membership) from within a portal session, and, like every other agent action, it is itself permission-checked. The unifying principle: **the agent is a direct extension of the user.** It may do exactly what the user's roles, permission grants, and group memberships permit — no more — and any attempt beyond that surfaces the denial back to the user rather than failing silently or crashing. That makes the permission gate **ubiquitous**: it decides every write the agent attempts, whether a data-plane mutation or an RBAC-admin call.

## The current shape

### PermissionService.check + action resolution

| Piece | Location | Note |
|---|---|---|
| `check(ctx, action, object?)` | `permission.service.ts:126` | throws on deny; `ctx: PermissionContext = {userId, organizationId, roles}` (`:19`) — **needs the role set, not a bare userId** |
| non-throwing twin `can` | `permission-set.ts:107` | returns boolean — the wrapper wants this (typed refusal, not a throw) |
| throw site | `permission-set.ts:101` | `ApiError(403, denyCode, message)` — `INSUFFICIENT_ROLE` etc. (`:59`) |
| action resolution | `permission-set.ts:277` (`normalize`), `:49` (`ACTION_MAP`), `:300` (`resolve`) | `resource.<verb>` takes verb from the suffix + type/id/createdBy from the object; pure deny→allow→implicit-deny, fail-closed |
| action union | `permission.service.ts:34` | `resource.read\|write\|delete\|share` + privileged app actions; `CALLER_CAPABILITY_ACTIONS` at `permission.model.ts:105` |

### The tool-execution layer + the cost-gate wrapper (the injection point)

`ToolService.buildAnalyticsTools(organizationId, stationId, userId, portalId?)` (`tools.service.ts:393`) threads **only `userId` (a string)** to each tool's `.build(stationId, organizationId, userId)` — **no roles / `PermissionContext` is in scope today**. `wrapWithCostGate(...)` (`tools.service.ts:773`, defined `cost-gate.service.ts:327`) is the exact pattern to mirror: it iterates the built tools, captures `original = tool.execute`, and replaces it with an async wrapper that (a) runs `CostGateService.checkAdmission(...)` pre-flight (`:343`) → **returns a typed tool-result on deny, never throws**; (b) `await original(...)`; (c) commits the charge on success. The new authorization wrapper is the same decorate-the-`execute` loop, one layer out.

### ToolCapability — the write discriminator

`ToolCapabilitySchema` (`packages/core/src/models/tool-capability.model.ts:132`) carries `writes: string[]` (`:139`), `costHint` (`:96`), `resultKind` (`:73`), `alwaysAvailable` (`:152`); writing tools are refined to `computeShape map|mutate` + non-empty `locks[]` (`:178`). Capabilities are declared centrally, not inline — e.g. `field_mapping_create: entityWrite(["field_mappings"], ["connectorEntityId"])` (`builtin-toolpacks.ts:1354`; helper `:1167`). The write tool itself (`apps/api/src/tools/field-mapping-create.tool.ts:73`) already does station-level `assertWriteCapability` (`:104`) and stamps `createdBy = userId` (`:157`). **Note:** `writes[]` values are plural entity-kinds (`"field_mappings"`, `"entity_records"`, `"connector_entities"`) that don't 1:1 match `PERMISSION_RESOURCE_TYPES` (`permission.model.ts:36`) — a small mapping table is needed.

### The cost-gate coverage guard (the pattern to mirror)

`apps/api/src/__tests__/services/tools.service.test.ts:786` — *"wraps every built tool's execute with the cost gate"*: it builds tools with all packs enabled, spies `checkAdmission` to return a deny sentinel, then iterates **every** `Object.keys(tools)` and asserts each `execute` returns the sentinel (proving the wrap intercepted). The authorization-coverage guard mirrors this: enable every pack, assert every tool with `writes.length > 0` routes through `PermissionService`.

### Governance pack registration + entitlement

A builtin pack is a `BuiltinToolpackSpec` literal in `builtin-toolpacks.ts` (`:97`); its slug joins `BuiltinToolpackSlugSchema` (`:32`); capabilities live in the `CAPABILITIES` matrix (`:1180`) and `attachCapabilities` (`:1375`) **throws if any tool lacks an entry**; the pack joins the frozen `BUILTIN_TOOLPACKS` (`:1392`); assembly (instantiating the tools) is the hand-authored mirror in `tools.service.ts:639`. Entitlement: `EntitlementService.splitBuiltinPacks` (`entitlement.service.ts:62`) intersects configured packs with the tier's `builtinToolpacks` (`tier-catalog.ts:46`); `alwaysAvailable:true` tools (`tool-capabilities.ts:30`) bypass that entirely and are attached unconditionally (`tools.service.ts:472`).

### The RBAC-admin services the governance tools wrap

`PolicyService` / `RoleService` / `GroupService` (`{policy,role,group}.service.ts`; create/update/remove + membership) and `GrantService` (`grant.service.ts` share `:106` / revoke `:235`) all take `caller: PermissionContext` first, and **each already self-gates per caller** via a private `gate(caller)` — `EntitlementService.customRbacEntitled` + `PermissionService.check(caller, "member.role.assign")` — plus a boundary check and `AuditService.record` on every mutation. So the governance services enforce authorization *themselves*; the tool layer's only new job for them is threading the caller's full context in.

## The design space

### Decision 1 — Resolve the caller's full `PermissionSet` once, thread it into the tool layer

Tools get only `userId` today. The check needs a `PermissionContext = {userId, organizationId, roles}` — but **`roles` is only the input**: `PermissionService.loadSet(ctx)` (`permission.service.ts:72`) expands it into the complete `PermissionSet`, unioning **role-attached policies + the caller's direct `permission_grants` (#621) + every group they belong to** (it looks group memberships up from `userId` and gathers grants for *all* principals — user, roles, groups — via `permission_grants.repository.findByPrincipals`). So the checks reflect **all** permission sources, not roles alone — exactly what the UI's `capabilities`/list predicates compute. Roles are threaded because the request middleware already resolved them; groups and grants are derived inside `loadSet`.

| | A. Resolve once at build | B. Resolve per tool call |
|---|---|---|
| `loadSet` (groups + grants + roles) | one per session | one per tool invocation |
| Fits the seam | `buildAnalyticsTools` already has `userId` + `organizationId` | wrapper closure |

**Lean: A.** Resolve the caller's roles once at the `buildAnalyticsTools` boundary (via the existing effective-roles lookup), build the `PermissionContext`, call `loadSet` **once** to get the full `PermissionSet` (roles ∪ grants ∪ groups), and close the wrapper (and the RBAC-management tools) over it — one `loadSet` per session, reused across every tool call.

### Decision 2 — The authorization wrapper shape + ordering

**Lean:** a build-time wrapper mirroring `wrapWithCostGate` — iterate built tools, and for each whose `ToolCapability.writes[]` is non-empty, decorate `execute` with a pre-flight `permissionSet.can(action, object)` that **returns a typed refusal tool-result on deny** (use `can`, not `check`, so nothing throws — the agent relays the refusal). Order it **outside** the cost gate (authorization first: a denied caller never reaches cost admission or `execute`). A `writes[] → (verb, resourceType)` table maps the plural entity-kinds to `PERMISSION_RESOURCE_TYPES`.

### Decision 3 — Per-object checks (the full gate)

This is a **full implementation** of the RBAC permission gate, not a coarse pre-filter: the check is **per-object**, not per-type. Each write tool declares a small **authorization descriptor** — its verb (`write`/`delete`), its `resourceType`, and how to extract the **target object id** from the tool's validated args. For an update/delete the wrapper resolves that object's `createdBy` (reusing #622's `RbacObjectResolver` shape, `apps/api/src/services/rbac-object-resolver.ts`) and calls `check(ctx, "resource.<verb>", {type, resourceId, createdBy})`, so ownership conditions (`created_by_caller`) resolve exactly as they do in the UI. A **create** (no target id yet) checks the `write` permission on the type; the new row is owned by the caller.

**Decided: per-object.** The gate is authoritative at the tool boundary and matches the UI's per-object enforcement precisely — the agent is a direct extension of the user, so it can touch exactly the objects the user can. (The station-level `assertWriteCapability` and the service's own ownership checks remain as defense-in-depth, not the primary gate.)

**Per-object without a per-row tax (the performance shape).** Per-object correctness must not become N checks per row:

- The caller's **`PermissionSet` is resolved once per session** (Decision 1); every check is then a pure **in-memory** evaluation — no DB per check.
- The gate fires only on **write** tools (reads are already scoped by the session views / `visibilityPredicate`), and writes are occasional in a session — a handful of sub-millisecond checks, dwarfed by the LLM round-trips.
- **Single-object** tools (create / a record edit) do **one** `check` against the target's `createdBy`, which the tool already loads to perform the write — usually no extra query.
- **Bulk-write** tools do **not** loop N checks: the wrapper AND-s the existing `visibilityPredicate(resourceType)` (`permission-set.ts:223`, the same predicate the read path uses) into the tool's write `WHERE`, so the **database** enforces per-row ownership inside the *single* write statement — one predicate build, not N checks.

Net: one check per single-object invocation, one predicate per bulk invocation, one `loadSet` per session — never per row.

### Decision 4 — The permission gate is the ultimate decider; every denial surfaces

The RBAC-management tools call `Policy/Role/GroupService`, which **already** self-gate per caller (`member.role.assign` + boundary + audit) — so they are **not** additionally pre-flight-checked by the data-plane wrapper (no double-gate). But the principle is uniform: **any** action the agent attempts — a data-plane write (pre-flight-checked per object, Decision 3) or an RBAC-admin call (checked inside its service) — that the caller lacks permission for **surfaces the denial back to the user**. Concretely the authorization wrapper does two things: (a) the per-object pre-flight for tools carrying an authorization descriptor, and (b) **catches any `ApiError(403)` thrown during `execute`** (from a service's own gate) and converts it to the same typed refusal — so a denial from *either* layer reaches the agent as a relayable message, never an uncaught crash. RBAC-management tools rely on (b); everything with a descriptor also gets (a).

**Decided: the gate is authoritative, denials always surface.** The coverage guard asserts every write tool is authorization-covered — a pre-flight descriptor **or** a self-gating service — and that both paths surface a typed refusal on deny.

### Decision 5 — A normal builtin toolpack, like entity-management

**Decided:** the RBAC-management pack is an **ordinary builtin toolpack** — same shape as `entity_management`: an `rbac_management` slug in `BuiltinToolpackSlugSchema` (`:32`), a `BuiltinToolpackSpec` + `CAPABILITIES` entries, assembled through the normal pack path (`tools.service.ts:639`), station-enable-able, and **entitled through `tier-catalog.ts`** — *not* `alwaysAvailable`. Because RBAC administration is a security feature (not a monetization axis), its slug is added to **every** tier's `builtinToolpacks` (baseline-and-up), exactly as `entity_management` sits on `standard` (`:128`) — but through the standard entitlement mechanism, so an org/station can still enable/disable it like any other pack. No new always-available combination is introduced; the pack's tools are gated per caller by their services (Decision 4), which is what actually restricts *use* to admins.

## Tradeoff comparison

| | D1 ctx-once | D2 wrapper (auth-outside-cost) | D3 per-object gate | D4 gate authoritative + surface | D5 normal builtin pack |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| New surface | `PermissionContext` threaded to `buildAnalyticsTools` | authorization wrapper + guard test | per-tool authorization descriptor (verb + type + target-id extractor) + `RbacObjectResolver` reuse | catch-and-surface `ApiError(403)` → typed refusal | `rbac_management` slug + tier-catalog entitlement |

## Recommendation

1. Thread the caller's **`PermissionContext`** (`{userId, organizationId, roles}`) + a resolved `PermissionSet` into `buildAnalyticsTools`, resolved once per session.
2. Add a **build-time authorization wrapper** (outside the cost gate) that (a) runs a **per-object** pre-flight `check(ctx, "resource.<verb>", {type, resourceId, createdBy})` for every write tool carrying an authorization descriptor (verb + resourceType + target-id extractor; `RbacObjectResolver` resolves `createdBy`), and (b) catches any `ApiError(403)` thrown during `execute` — both returning a **typed refusal** tool-result (`TOOL_PERMISSION_DENIED`) the agent relays; **fail-closed** on a resolution error.
3. Add a **coverage guard test** asserting every write tool is authorization-covered (a pre-flight descriptor **or** a self-gating service) and that a deny surfaces the typed refusal.
4. Add the **`rbac_management` builtin toolpack** — a companion to `entity_management` exposing the shipped RBAC-admin operations (policy / role / group CRUD, policy attach·detach, grant share·revoke, member role/group assignment); each tool passes the caller's `PermissionContext` to its service and relies on the service's per-caller gate, whose denials surface via 2(b).
5. Entitle `rbac_management` through **`tier-catalog.ts`** (added to every tier's `builtinToolpacks`, baseline-and-up), like `entity_management` — not `alwaysAvailable`.

## Open questions

1. **Where do the caller's roles come from at build time?** **Lean:** resolve via the effective-roles lookup (`userRole.findEffectiveRoleNames`, already used by the org-context route) inside `buildAnalyticsTools`; the portal session knows the `userId` + `organizationId`.
2. **How each write tool declares its authorization descriptor.** Per-object checks need, per tool, the verb + resourceType + which validated arg carries the target object id, **and the tool's mode** — *single-object* (pre-flight `check` on the target) vs *bulk* (the wrapper hands the tool a `visibilityPredicate` to AND into its write `WHERE`, so per-row enforcement is one DB statement, not N checks). **Lean:** declare it as **data** alongside the `CAPABILITIES` matrix (parallel to how `writes[]`/`reads[]` are declared centrally in `builtin-toolpacks.ts`), so the wrapper reads a table — no per-tool code — and a create tool declares no target-id extractor (type-level `write` check). Note the `writes[]` entity-kinds don't 1:1 match `PERMISSION_RESOURCE_TYPES`, so the descriptor carries the resolved `resourceType` explicitly. A bulk tool that can't accept the predicate is a design smell the coverage guard can flag.
3. **RBAC-management tool scope.** Which RBAC-admin ops to expose? **Decided: mirror exactly what the UI enables the user to do** — the `AccessAuthoring` surfaces (policy / role / group CRUD + policy attach·detach + member role & group assignment) and the `ShareDialog` (grant share·revoke) — nothing the UI doesn't offer. This keeps the agent a true peer of the UI (same operations, same per-caller gate), and **no view management** (that surface doesn't exist until #599).
4. **Typed-refusal code + shape.** **Lean:** a new `TOOL_PERMISSION_DENIED` tool-result mirroring the cost gate's typed denials (`TOOL_USAGE_*`), carrying the denied action so the agent can relay a precise message.
5. **Fail policy on a check error.** The cost gate fails *open* (availability); an authorization gate must fail **closed**. **Lean:** deny (typed refusal) if the permission resolution errors — a security gate, unlike the cost gate.

## Enterprise-scale considerations

- **Concurrency & correctness** — the check is a read over a per-session `PermissionSet`; the wrapper is stateless per call. `N/A because` no check-then-act race (authorization precedes the mutation, and the service re-enforces under its own lock where needed).
- **Accuracy & auditability** — successful governance mutations already `AuditService.record` in the service; a *denied* agent tool call is a no-op surfaced to the agent. **Lean:** rely on the service audit for mutations; a denied call is log-only (not an `audit_log` row) — revisit if security wants denied-attempt trails.
- **Failure modes** — **fail-closed** at the authorization wrapper (deny on resolution error), in deliberate contrast to the cost gate's fail-open; a denied tool never charges (auth is outside the cost gate). **Lean: fail-closed.**
- **Scale & unbounded growth** — the flagged risk. Per-object checks are **not** per-row: one `loadSet` per session (Decision 1), an in-memory eval per single-object write, and a `visibilityPredicate`-scoped `WHERE` (DB-enforced) for bulk writes — see Decision 3's performance shape. The gate never touches the read path, and write-tool calls per session are few and sub-millisecond next to the LLM round-trips. **Lean: fine, by construction** — a bulk tool that iterated per-row checks would be the anti-pattern, which the predicate-scoping design forbids; measure only if a single tool is shown to write in a genuinely hot loop.
- **Multi-tenancy** — the `PermissionContext` carries `organizationId`; the check and the governance services are org-scoped. **Lean: fine.**
- **Contract stability** — the wrapper keys on `ToolCapability.writes[]`, so new tools plug in automatically; the `writes[]→resourceType` map is the one extension point; the governance pack is `alwaysAvailable` so tier changes never affect it. **Lean: shaped for growth.**
- **Data lifecycle** — `N/A because` this adds no stored state (a wrapper + a pack registration).

## What this doesn't decide

- **View-management** RBAC-management tools — arrive with #599 (the view object doesn't exist yet).
- **The role-gated navigation pattern** — separate ticket **#630**.
- **Denied-attempt auditing** — left to a security decision (OQ / enterprise-scale note).

## Next step

`docs/TOOL_AUTHORIZATION_GATE.spec.md` pins the contract: the `PermissionContext` threading into `buildAnalyticsTools`, the authorization-wrapper signature + ordering, the per-tool **authorization-descriptor** shape (verb + resourceType + target-id extractor) + `RbacObjectResolver` reuse, the `TOOL_PERMISSION_DENIED` result + the catch-and-surface of service 403s, the coverage guard, and the `rbac_management` pack (slug + `BuiltinToolpackSpec` + `CAPABILITIES` entries + `tier-catalog` entitlement + the tools' service calls). `docs/TOOL_AUTHORIZATION_GATE.plan.md` then slices it — roughly: (1) thread `PermissionContext` + the per-object authorization wrapper (pre-flight + catch-and-surface) + coverage guard; (2) the `rbac_management` pack + its tier-catalog entitlement + the tools' service calls; (3) doc-sync (the pack mirror in `builtin-toolpacks.ts`, `system.prompt.ts` guidance) — each behind a green suite.
