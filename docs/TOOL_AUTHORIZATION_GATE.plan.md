# Per-caller tool-authorization gate + RBAC-management toolpack — Plan

**Four TDD slices: the gate primitive standalone, then wired to `buildAnalyticsTools` with per-object descriptors + guards, then the `rbac_management` pack, then doc-sync.**

Spec: `docs/TOOL_AUTHORIZATION_GATE.spec.md`. Discovery: `docs/TOOL_AUTHORIZATION_GATE.discovery.md`. Issue: #629 (epic #578). Builds on the shipped RBAC engine (`PermissionService`/`PermissionSet`, #598/#620/#622), the cost-gate wrapper pattern (#169/#183), and `RbacObjectResolver` (#622).

4 slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `feat/629-tool-authorization-gate`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale** — Slice 1 is the leaf primitive (a pure wrapper + a resolver extension), unit-tested in isolation with no wiring. Slice 2 wires it into the tool builder and gives every existing write tool a descriptor, so the coverage guard + O(1) invariant go green against real tools. Slice 3 adds the new pack, which consumes slice 1's catch-403 for its surfacing. Slice 4 is doc-sync cleanup. No forward dependencies.

---

## Slice 1 — The permission-gate primitive (standalone)

The authorization wrapper + typed refusal + the data-plane resolver extension, fully tested in isolation before anything calls it.

**Files**

- New: `apps/api/src/services/permission-gate.service.ts` — `wrapWithPermissionGate(tools, permissionSet, ctx, authFor)`: create → `can("resource.write",{type})`; single/delete → resolve `createdBy` via `RbacObjectResolver` → `can("resource.<verb>",{type,id,createdBy})`; bulk → skip pre-flight (the tool self-scopes, slice 2); **all** wrap `execute` in try/catch → `ApiError(403)` becomes the typed refusal; fail-closed on a resolution error.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `TOOL_PERMISSION_DENIED`.
- Edit: `packages/core/src/models/tool-capability.model.ts` — `ToolAuthorization` type + `WRITE_KIND_TO_RESOURCE_TYPE` map.
- Edit: `apps/api/src/services/rbac-object-resolver.ts` — extend `OBJECT_FINDERS` with `field_mapping` + `entity_record`.

**Steps**

1. **Tests (spec: `permission-gate.service.test.ts` cases + resolver).** New `apps/api/src/__tests__/services/permission-gate.service.test.ts`: create allow/deny; single allow (owner) / deny (another's object, resolved `createdBy`); catch — a synthetic tool whose `execute` throws `ApiError(403)` returns the refusal (not a throw); fail-closed — a resolver error denies; the refusal shape is `{error:{code:TOOL_PERMISSION_DENIED,message}}`. Extend the `rbac-object-resolver` test: `field_mapping`/`entity_record` resolve `createdBy`, cross-org → `null`. Run; fail.
2. **Implement** the service + code + type + resolver finders. Green.
3. Lint + type-check (`apps/api`, `packages/core`).

**Done when:** the wrapper + resolver extension pass in isolation; nothing in `buildAnalyticsTools` references the wrapper yet.

**Risk:** none — pure additions, no call sites.

---

## Slice 2 — Wire the gate into `buildAnalyticsTools` + per-object descriptors + guards

Resolve the caller's `PermissionSet` once, gate every existing write tool per object, and pin the coverage + O(1) invariants.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — in `buildAnalyticsTools` (`:393`): resolve `roles` via `userRole.findEffectiveRoleNames`, build `PermissionContext`, `loadSet` **once** → `permissionSet`; pass it to bulk-write tools' `.build(...)`; call `wrapWithPermissionGate(...)` **before** `wrapWithCostGate` (`:773`).
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — a `TOOL_AUTHORIZATION` map: one descriptor per existing data-plane write tool (create/single/bulk).
- Edit: the bulk-write tools (`apps/api/src/tools/*`) whose descriptor is `bulk` — `.build()` accepts `permissionSet` and ANDs `visibilityPredicate(resourceType, {createdByCol, idCol})` into the write `WHERE`.

**Steps**

1. **Tests (spec: `tools.service.test.ts` coverage guard + O(1)).** Extend `apps/api/src/__tests__/services/tools.service.test.ts`: **coverage guard** — every built tool with non-empty `writes[]` has a `TOOL_AUTHORIZATION` entry and its `execute` routes through `wrapWithPermissionGate` (intercept `PermissionSet.can`); **O(1) invariant** — a bulk write tool issues O(1) permission queries regardless of row count (count DB round-trips; assert no per-row `resolveCreatedBy`). Run; fail.
2. **Implement** the wiring + descriptors + bulk predicate-scoping. Green.
3. Lint + type-check.

**Done when:** every existing write tool is per-object-gated; the coverage guard + O(1) test pass; the cost-gate guard still passes (authorization sits outside it).

**Risk:** the bulk predicate must AND into the *write* `WHERE` (not just reads) — the O(1) + a member-scoped bulk-write integration case are the detectors.

---

## Slice 3 — The `rbac_management` pack + tools + entitlement

The agent-operable RBAC-admin pack, mirroring the UI, entitled at baseline, its denials surfaced via slice 1's catch-403.

**Files**

- New: `apps/api/src/tools/rbac/*.tool.ts` — one `Tool` per UI-mirrored op (`policy_/role_/group_` CRUD, `policy_attach·detach`, `member_roles_set`, `member_groups_set`, `grant_share·revoke·list`), each `build(ctx: PermissionContext)` → the service call (no own check).
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — `rbac_management` slug + `BuiltinToolpackSpec` + `CAPABILITIES` entries (`writes[]`, `costHint:"free"`); extend the coverage guard's exempt rule (an `rbac_management` tool is service-gated, not descriptor-gated).
- Edit: `packages/core/src/registries/tier-catalog.ts` — add `rbac_management` to every tier's `builtinToolpacks`.
- Edit: `apps/api/src/services/tools.service.ts` — the `rbac_management` assembly block passing the full `PermissionContext`.

**Steps**

1. **Tests (spec: `builtin-toolpacks.test`, `tier-catalog.test`, integration).** `packages/core`: `rbac_management` slug + spec + `attachCapabilities` doesn't throw + on every tier. `apps/api` integration `.../rbac-tools.integration.test.ts`: a member calling `policy_create` without `member.role.assign` gets `TOOL_PERMISSION_DENIED` (via the service's 403 → catch-403); an admin succeeds and an `audit_log` row lands. Run; fail.
2. **Implement** the tools + registrations + entitlement + assembly + guard-exempt rule. Green.
3. Lint + type-check.

**Done when:** the pack is entitled at baseline, its tools self-gate + surface denials, and the coverage guard is green with the pack present.

**Risk:** double-gating — the tools must **not** add their own `check` (the service already does); the integration deny case proves the single service gate surfaces correctly.

---

## Slice 4 — Doc-sync

Bring the agent/tool doc surfaces in line with the new pack + refusal (per `CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts` hand-authored mirror (if the pack's modal copy is separate) + `apps/api/src/prompts/system.prompt.ts` — the `rbac_management` tools + that any tool may return `TOOL_PERMISSION_DENIED`, which the agent relays.

**Steps**

1. **Tests (spec: pinning tests).** Update `system.prompt.test.ts` / `builtin-toolpacks.test.ts` pins to include the new pack + guidance. Run; fail.
2. **Implement** the prose/mirror. Green.
3. Lint + type-check.

**Done when:** the pinning tests pass with the new surfaces; no drift between the pack, its mirror, and the prompt.

**Risk:** none — copy + pinned tests.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | gate primitive + `TOOL_PERMISSION_DENIED` + resolver extension | `permission-gate.service.test` + resolver test |
| 2 | wired into `buildAnalyticsTools` + descriptors + bulk predicate | coverage guard + O(1) invariant |
| 3 | `rbac_management` pack + tools + entitlement | registry tests + rbac-tools integration |
| 4 | doc-sync (mirror + `system.prompt`) | pinning tests |

## Cross-slice notes

- **`PermissionContext` threading** touches `buildAnalyticsTools` in slice 2 and the RBAC tools in slice 3 — both take the full context (roles resolved once), never a bare `userId`.
- **The coverage guard evolves, green at each boundary:** slice 2 asserts every data-plane write tool has a descriptor; slice 3 extends the exempt rule for the service-gated `rbac_management` tools. Neither references a symbol from a later slice.
- **Bulk correctness** is the one real risk — the O(1) test (slice 2) forbids per-row checks and the member-scoped bulk-write integration case proves the DB-side predicate.
- **Doc-sync (slice 4)** is mandatory in this PR, not a follow-up — the tool contract (`.tool.ts` descriptions + `builtin-toolpacks` mirror + `system.prompt`) is a documented surface.
- **No DB migration**; the tier-catalog edit (slice 3) reaches existing envs via `portalops tier apply` — a deploy-time step, not part of the PR.

## Next step

Implementation begins on `feat/629-tool-authorization-gate`, slice 1 first (tests-first, one commit per slice), only after discovery + spec + plan are reviewed and confirmed.
