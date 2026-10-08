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
- **Guard test** `apps/api/src/__tests__/permission-object.guard.test.ts` closes the two ways past (c). It parses `apps/api/src` with the TypeScript AST, so casts spread over several lines are caught, and grep's trouble with `permission-set.ts`'s NUL sentinels doesn't apply. (1) **Casts:** it flags any `as PermissionObject` / `<PermissionObject>`, and any cast on an argument of `can`/`check`/`isDenied`/`assertWithinBoundary` (`as never`, `as any`, …), except the action's `as PermissionAction`. (2) **A forced or defaulted creator:** the compiler can't tell "creator unknown" from "creator not looked up", and it doesn't see through `m.get(id)!`, `m.get(id) as string`, `?? ""` or `|| null`. So in a file that uses the permission engine, a by-id object's `createdBy:` written with `!`, a cast, `??` or `||` must carry a comment citing an issue (`// #729: …`) on its line or in the `//` block directly above. Scoping to files that use the permission engine is a heuristic: elsewhere a by-id `createdBy` is a row's audit stamp (`prior?.createdBy ?? userId`), not an ownership claim. The `!` at `toolpacks.router.ts:212` is the one existing site, and it now says why (adversarial walk on #735). The three existing casts in `permission-gate.service.ts` are deleted, so the guard has no allowlist (code review on #735).
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

## Adversarial

Probes for how #731 breaks. It changed which creator value every by-id check passes (`undefined` became `null`), and it relies on the compiler plus a guard to stop a new omission. So the probes ask two questions: did any live check start allowing or refusing differently, and can a contributor still slip past the guard? **Branch under test:** `chore/731-guard-createdby-on-owned-checks` (PR [#735](https://github.com/EnterpriseBT/portal-ai/pull/735)). API probes use `curl` against `:3001` with the `access_token` from `packages/e2e/.auth/<role>.storageState.json`, in the `e2e-fixture` org. Undo any grant or row a probe creates before moving on.

### §1 Boundary & limit inputs: N/A. The change adds no size, limit or pagination surface.
### §2 Malformed & injection input: N/A. No new input is parsed. Malformed `fieldMappingIds` are covered by §5 and §6.
### §3 Concurrency & races: N/A. No new writer. The checks are pure functions over a set loaded once per request.

### §4 Auth & permission boundaries
- [ ] As the **member**, `GET /api/stations/<own station id>` and `PATCH` its name, where the station was created by the member. Expected safe result: 200 both times. The member's `created_by_caller` rules still match a real creator; `null` didn't replace it on the shared loader path (`ObjectAccessService.object`). — backend
- [ ] As the **member**, `GET` and `PATCH` a station the **owner** created. Expected safe result: `GET` returns 404 and `PATCH` returns 404, with no write (#713: an object you can't read looks absent). — backend
- [ ] The owner shares a view with the member at **read** level (`POST /api/grants`). As the member, `GET` the view, then `PATCH` it. Expected safe result: `GET` returns 200, and `PATCH` returns 403 `PERMISSION_DENIED` with the row unchanged. A per-object grant still matches with a known creator, and read doesn't grow into write. Revoke the grant afterwards. — backend
- [ ] As the **member**, `GET /api/column-definitions` and then `PATCH` a system-created column definition by id. Expected safe result: the list includes the system rows (`created_by_system` read still matches). The `PATCH` returns 404 or 403 with no write, because system rows are read-only for a member. — backend

### §5 Multi-tenant isolation
- [ ] As the **owner** of `e2e-fixture`, `POST /api/curated-views` on one of the org's entities, with `fieldMappingIds` containing a mapping id from **another org**. Expected safe result: refused (403 `CURATED_VIEW_FIELD_NOT_READABLE`), and no view is created. The foreign id isn't among the entity's mappings, so its creator is `null`, which passes no ownership rule. Note that the owner's unconditional grant matches `null` too, so record which response comes back. Anything other than a refusal is a finding. — backend

### §6 State & lifecycle abuse
- [ ] As the **member**, `POST /api/curated-views` with a `fieldMappingIds` entry from a **different entity in the same org**. Expected safe result: 403 `CURATED_VIEW_FIELD_NOT_READABLE`, with nothing created. This is the `assertFieldsReadable` path (`?? null`). — backend
- [ ] Owner: create a projected view on "Smoke Polygons" with 2 of its 3 mappings and share it with the member at read level. Then soft-delete one projected mapping (`DELETE /api/field-mappings/:id`). As the member, `GET` the view and `GET …/records`. Expected safe result: 200 both times with no 500. The deleted mapping's column is absent, and the remaining column renders. Afterwards restore the mapping and remove the view and grant. — backend

### §7 Misuse sequences: a contributor trying to get past the guard
Each probe adds one line to a scratch copy of `apps/api/src/services/object-access.service.ts`, then runs `npm run type-check` and `npm run test:unit -- --testPathPattern permission-object.guard` in `apps/api`, then reverts. The expected safe result is that **one of the two fails**. A probe where both pass is a gap: record it in Findings with a disposition, fixed in this PR or waived with a reason.
- [ ] `set.can("resource.read", { type: "station", id: row.id })`: a missing key. Expect type-check to fail. — backend
- [ ] `set.can("resource.read", { type: "station", id: row.id, createdBy: m.get(row.id) })` with `m: Map<string,string>`. Expect type-check to fail. — backend
- [ ] `… createdBy: m.get(row.id) ?? null })` with no comment. Expect the guard to fail. — backend
- [ ] `… createdBy: m.get(row.id)! })`: a non-null assertion. Record whether either check fails. — backend
- [ ] `… createdBy: m.get(row.id) as string })`: a cast inside the object, not on the argument. Record whether either check fails. — backend
- [ ] `… createdBy: m.get(row.id) ?? "" })` or `… || null`: a different fallback. Record whether either check fails. — backend
- [ ] `type PO = PermissionObject;` then `set.can(a, { type: "station", id: row.id } as PO)`: an aliased cast. Record whether either check fails. The code review already called this one unlikely; waiving it with that reason is fine. — backend

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/view/mapping ids):
