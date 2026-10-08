# By-id permission checks must pass `createdBy` — Condensed design (#731)

**Issue:** [EnterpriseBT/portal-ai#731](https://github.com/EnterpriseBT/portal-ai/issues/731) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `PermissionSet.matches` passes a conditional statement (`created_by_caller` / `created_by_system`) only when `norm.createdBy` equals the caller or the system id. A by-id check that leaves out `createdBy` therefore fails closed for every member, while owners and admins pass through `* *`, so nobody notices. #729 was this bug, and the #730 review found a second one (`assertFieldsReadable`). This ticket audits the call sites and makes a new omission fail CI. Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Condition match | `apps/api/src/services/permission-set.ts` `matches()` | an absent `createdBy` never matches a condition, so the check fails closed |
| Object type | `apps/api/src/services/permission.service.ts:62` `PermissionObject` | `{ type; id?; createdBy? }`: nothing ties `createdBy` to `id` |
| Shared by-id loaders | `ObjectAccessService.readableInOrg` / `.object` / `.loadForVerb` | always pass `row.createdBy`; 25 route sites go through them |
| Ownerless type | `OWNERSHIPLESS_RESOURCE_TYPES = ["page"]` (`packages/core/src/models/permission.model.ts:234`) | `can("resource.view", { type: "page", id })` (`permission.service.ts:343`) correctly has no creator |
| Casts | `permission-gate.service.ts:79,108,117` `{…} as PermissionObject` | the casts are redundant, and a cast would hide an omission from the compiler |

**Audit (AST scan of all 134 `can`/`check`/`isDenied`/`assertWithinBoundary`/`loadForVerb` calls in `apps/api/src`, plus a trial of the type change below):** no live by-id check leaves out the `createdBy` key. 54 literals pass it, 17 are class-level, 1 is the `page` check, and the 61 variable/helper calls resolve to `ObjectAccessService.object`, `PortalAccessService.object`/`ConnectorInstanceAccessService` (same `row.createdBy` shape), or class-level actions. A missing key isn't the only failure shape, though. The #729 sites pass `createdBy: map.get(id)`, which is `string | undefined`, so a literal-key scan alone can't hold. The type trial flags exactly three such sites. All three are #730's fixes, where `undefined` is meant to fail closed. A view's projection is always a subset of its entity's mappings, so it never comes from stored view state. It comes from input or deletion:

- `routes/curated-view.router.ts:122` (`assertFieldsReadable`): a client-submitted `fieldMappingIds` entry that isn't on the entity, which is rejected input.
- `services/curated-view-payload.service.ts:59` and `services/portal-sql.service.ts:388`: a mapping whose creator reads `null` (deleted since it was cached or joined).

## Decision — enforce it in the type, with `null` as the explicit opt-out

Options: (a) a source-scan guard test for literals without `createdBy`, which misses variables and `map.get()` values (the exact #729 shape); (b) a dev/test-time assertion in `can`, which only covers the paths a test runs and has to tell "deliberately unknown" apart from "forgot"; (c) **make `PermissionObject` a union in which a by-id object must carry `createdBy: string | null`**.

**Decided: (c), plus a small guard test.**

```ts
export type PermissionObject =
  | { type: string; id?: undefined; createdBy?: string }      // class-level
  | { type: "page"; id: string; createdBy?: undefined }       // ownerless instance
  | { type: string; id: string; createdBy: string | null };   // by-id: creator required
```

- `tsc` now rejects every by-id object without a creator, including variables, helpers and `string | undefined` values. `type-check` already gates every PR (Static Checks), so this meets "CI fails on a new omission" with nothing new to maintain.
- **`createdBy: null` is the recorded allowlist.** It means "the creator is unknown or irrelevant, so only unconditional, instance or FK-expanded grants can match". It's written at the call site where a reviewer sees it, which beats a list kept in a test file. `normalize` maps `null` to `undefined`, so the engine's semantics stay exactly as they are (out of scope per the ticket). The three #730 sites become `?? null`.
- **Guard test** `apps/api/src/__tests__/permission-object.guard.test.ts` closes the two ways past (c). It parses `apps/api/src` with the TypeScript AST, so casts spread over several lines are caught, and grep's trouble with `permission-set.ts`'s NUL sentinels doesn't apply. (1) **Casts:** it flags any `as PermissionObject` / `<PermissionObject>`, and any cast on an argument of `can`/`check`/`isDenied`/`assertWithinBoundary` (`as never`, `as any`, …), except the action's `as PermissionAction`. (2) **A silent `?? null`:** the compiler can't tell "creator unknown" from "creator not looked up", so any `createdBy: … ?? null` must carry a comment citing an issue (`// #729: …`) on its line or the line above. The three existing casts in `permission-gate.service.ts` are deleted, so the guard has no allowlist (code review on #735).
- No runtime assertion. The compile-time check already covers every site, and (b) would add a throw on hot paths that only fires under test.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/permission.service.ts`: change `PermissionObject` to the union, with JSDoc explaining `null` and citing #729/#731.
- Edit: `apps/api/src/services/permission-set.ts`: `normalize` maps `createdBy ?? undefined`. `isDenied` (`{ ...object, type }`) and `assertWithinBoundary` get narrowed to fit the union (they currently fail the trial on `null` / spread widening).
- Edit: `routes/curated-view.router.ts:122`, `services/curated-view-payload.service.ts:59`, `services/portal-sql.service.ts:388`: `?? null`.
- Edit: `services/permission-gate.service.ts`: drop the three `as PermissionObject` casts.
- Edit tests that build id-only objects: `__tests__/services/permission-set.test.ts` (`page()` helper and any id-only fixtures) and `__tests__/__integration__/services/rbac-fk-expansion.integration.test.ts:185` (`canRead` becomes `createdBy: null`, which is right: it tests FK-expanded instance grants).
- New: `apps/api/src/__tests__/permission-object.guard.test.ts`.

**Tests**
- New unit cases in `permission-set.test.ts`: (1) `createdBy: null` on an owned type fails a member's `created_by_caller` / `created_by_system` statement and passes an instance grant on that id; (2) `null` behaves exactly like the old omitted key under deny-wins.
- Guard self-test: embedded fixtures for each cast form and for an unexplained `?? null` are flagged, while a commented `?? null`, a typed annotation and unrelated `as never` pass. Then the real tree is scanned and must be clean.
- `npm run type-check`, `npm run lint`, `npm run test:unit -- --testPathPattern 'permission|curated-view|portal-sql'`; the `rbac-fk-expansion` integration test via `npm run test:integration -- --testPathPattern rbac-fk-expansion`.

## Smoke (manual, against your dev stack)

1. On this branch, delete `createdBy` from `ObjectAccessService.object` → `npm run type-check` in `apps/api` fails, naming that line. Revert.
2. Add `{ type: "station", id: "x" } as PermissionObject` anywhere in `apps/api/src` → `npm run test:unit -- --testPathPattern permission-object.guard` fails. Revert.
3. As the e2e **member** (`e2e:use member`), open a curated view whose columns are system-created → the columns render (the #729 regression stays fixed after the `?? null` change).

## Out of scope

- Changing condition semantics, e.g. making a missing creator throw instead of fail closed (excluded by the ticket).
- `apps/web` `capabilities` consumption. It reads server-computed booleans, so the omission can't happen there.
- Narrowing `type: string` to `PermissionResourceType` throughout. It's worthwhile but a separate, broader typing change.
