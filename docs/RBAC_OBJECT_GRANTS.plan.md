# RBAC object grants + sharing — Plan

**TDD-sequenced implementation of #621: the `permission_grants` layer, the grants API + boundary + seed/backfill, the station/pin enforcement wiring, and the `ShareDialog` — each slice behind a green suite.**

Spec: `docs/RBAC_OBJECT_GRANTS.spec.md`. Discovery: `docs/RBAC_OBJECT_GRANTS.discovery.md`. Issue: #621 (epic #578). Builds on the shipped #598 engine (`PermissionSet`/`loadSet`) + #620 multi-role (`ctx.roles`), both on `main`.

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/621-rbac-object-grants`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale** —
- **S1** stands up the grant data + resolver union with **nothing enforcing it yet** (additive, no behavior change) — the safe foundation.
- **S2** ships the API to author grants **and the seed/backfill of member own-object `delete`/`share`** — which must land *before* S3 wires enforcement, or existing-org members lock out of their own station/pin.
- **S3** wires `visibilityPredicate` + write/delete checks into station/pin (the visibility-tightening slice) — depends on S1 (grants in the set) + S2 (member self-access seeded).
- **S4** is the FE, depending on S2's API + S3's `canShare`.

---

## Slice 1 — `permission_grants` + resolver union (engine sees grants, un-wired)

The grant table/model/repo and the `loadSet` union, so a grant statement participates in resolution — but no route enforces anything yet.

**Files**

- New: `packages/core/src/models/permission.model.ts` (`PermissionGrantSchema` + Model/Factory + `SHAREABLE_RESOURCE_TYPES`), `packages/core/src/contracts/grant.contract.ts`, `apps/api/src/db/schema/permission-grants.table.ts`, `apps/api/src/db/repositories/permission-grants.repository.ts`, `apps/api/drizzle/<n>_add_permission_grants.sql` (+ journal + snapshot).
- Edit: `db/schema/{index,zod}.ts`, `db/schema/type-checks.ts`, `repositories/index.ts`, `services/db.service.ts` (register `permissionGrants`); `services/permission-set.ts` (widen ctor param to `EffectiveStatement`); `services/permission.service.ts` (`loadSet` grant union).

**Steps**

1. **Tests (spec cases: core `PermissionGrantSchema`/`grant.contract` + api-unit `visibilityPredicate`-with-grant + api-integration loadSet-union & repo).** Core: grant schema round-trip + bad principalType/verb reject; `ShareGrantRequest`/`GrantView` shapes. Unit: a `PermissionSet` built with a grant allow surfaces the instance via `visibilityPredicate`; a grant `deny` subtracts it. Integration: `loadSet` unions grants for a user principal **and** a role principal; repo `findByPrincipals`/`findByResource`. Run; fail.
2. **Implement** the model/contract/table/repo + six registration points + `db:generate` migration; `loadSet` appends `permissionGrants.findByPrincipals(...)` to the statements passed to `PermissionSet`; widen the ctor type so a grant row satisfies it. Green.
3. Lint + type-check (+ commit the drizzle journal + snapshot — `project_drizzle_journal_must_be_committed`).

**Done when:** grants resolve through the engine in tests; no route reads or writes them yet; dual-schema type-checks pass.

**Risk:** the drizzle journal/snapshot must be committed or CI's fresh DB skips the migration. Widening the ctor type must not change existing statement resolution (parity).

---

## Slice 2 — grants API + boundary + seed/backfill + audit + lifecycle revoke

Everything to **author** a grant safely, plus the member own-object `delete`/`share` seed the wiring will need.

**Files**

- New: `apps/api/src/routes/grant.router.ts`, `apps/api/drizzle/<n>_backfill-member-share-delete-grants.sql` (+ journal, no snapshot — data migration).
- Edit: `services/permission-set.ts` (`assertWithinBoundary`); `constants/api-codes.constants.ts` (`RBAC_GRANT_EXCEEDS_BOUNDARY`, `RBAC_GRANTEE_NOT_MEMBER`); `config/swagger.config.ts` (register grant schemas); `app.ts`/router mount; `services/seed.service.ts` (`MemberAccess` += `delete`/`share` on `SHAREABLE_RESOURCE_TYPES` `created_by_caller`); `packages/core/src/models/audit-log.model.ts` (`grant.create`/`grant.revoke`); `services/seat.service.ts` (`removeMember` → revoke the member's grants in the lock); `services/organization-delete.service.ts` (cascade grant hard-delete).

**Steps**

1. **Tests (spec cases: api-unit `assertWithinBoundary`; api-integration grants API + backfill-coverage + `removeMember` revoke; core audit-action).** Unit: `assertWithinBoundary` passes when allows ⊆ granter `can`, throws `RBAC_GRANT_EXCEEDS_BOUNDARY` on the first miss, deny always passes. Integration: POST share read/read-write (rows + `grant.create` audit); boundary rejection; `RBAC_GRANTEE_NOT_MEMBER`; share-authority (plain grantee 403, owner/admin/creator ok); team → `role:member`; GET grouping; DELETE revokes all verb rows + `grant.revoke`; `removeMember` revokes the member's grants; backfill-coverage (new MemberAccess statements inserted for a pre-existing org + present on a freshly provisioned org). Run; fail.
2. **Implement** `assertWithinBoundary`, the three endpoints (`@openapi` + registered schemas), the ApiCodes, the seed additions + backfill SQL, the audit actions, and the two lifecycle revocations. Green — **no station/pin behavior changes yet** (enforcement is S3).
3. Lint + type-check.

**Done when:** a share can be created/listed/revoked with boundary + grantee + share-authority enforced and audited; member removal revokes grants; existing + new orgs carry member own-object `delete`/`share`. Station/pin routes still un-enforced.

**Risk:** the backfill is the member-lockout guard for S3 — it must land here. Update any test asserting `MemberAccess`'s exact statement set (switch-parity asserts `read`/`write` results, unaffected; a count assertion would need the +4).

---

## Slice 3 — station/pin object enforcement wiring + `canShare`

Wire the engine into the two route families, tightening visibility *with* the grant mechanism now in place. **Split into two commits for review surface** — **3a: `station.router.ts`** (+ the `EffectiveStatement`/load-set-once wiring pattern + `canShare` on station detail), then **3b: `portal-results.router.ts`** (the identical pin wiring, following 3a's pattern). Each is independently green; the split is purely reviewability.

**Files**

- Edit: `apps/api/src/routes/station.router.ts` (list `visibilityPredicate("station")`; POST/PATCH `resource.write`; DELETE `resource.delete`; detail `canShare`; DELETE cascade grants); `apps/api/src/routes/portal-results.router.ts` (same for `"pin"`); the station + pinned-result **detail response contracts** (`canShare: boolean`).

**Steps**

1. **Tests (spec cases: station/portal-results wiring integration).** A member sees own + system + shared station/pin, not another member's; a `read` grantee reads but `resource.write`/`resource.delete` 403; a `read-write` grantee writes; an explicit **deny** grant overrides a write-capable role; a member deletes + shares their **own** station/pin but not one shared to them; `hardDelete` cascades the object's grants; `canShare` true for owner/admin/creator, false otherwise. Run; fail.
2. **Implement** the load-set-once-per-request wiring (predicate AND'd into `where`; `check` on mutations; `canShare` in detail; grant cascade in DELETE). Green.
3. Lint + type-check.

**Done when:** station/pin list + mutations are object-enforced; own/system/shared/other visibility is correct per role; `canShare` rides the detail responses.

**Risk:** the visibility-tightening slice — a missed predicate site over-restricts or leaks. Assert all four visibility classes per role. Load the set once (no per-row probe, #440).

---

## Slice 4 — `ShareDialog` + `grants` SDK + capability-gated entry points

The user-facing sharing flow.

**Files**

- New: `apps/web/src/api/grants.api.ts`, `apps/web/src/components/ShareDialog.component.tsx` (+ a principal picker — async-select fed by `sdk.members.list()` + a "the team" sentinel).
- Edit: `apps/web/src/api/{keys,sdk}.ts` (`queryKeys.grants` + `sdk.grants`); `views/StationDetail.view.tsx` + `views/PinnedResultDetail.view.tsx` (Share entry in `secondaryActions`, rendered when `canShare`; mount `ShareDialog`).

**Steps**

1. **Tests (spec cases: web `ShareDialog` + gating).** `ShareDialog` renders the grantee picker + read/read-write select, submits `ShareGrantRequest` via `sdk.grants.share`, renders `FormAlert` on `serverError`, lists current grants + revoke (invalidates `queryKeys.grants` + the object's query); the Share `secondaryActions` entry renders only when `canShare`. Dialog & Form Test Checklist. Run; fail.
2. **Implement** the SDK domain (via `useAuthMutation`/`useAuthQuery`, `sdk.*` only — `feedback_sdk_helpers_for_api`), the dialog + picker, and the gated entry points. Green.
3. Lint + type-check; `apps/web` + `apps/api` suites (shared contract touched).

**Done when:** an owner/admin/creator can share a station/pin read or read-write from its detail view, see who it's shared with, and revoke; the entry is hidden when `!canShare`.

**Risk:** no `AsyncSearchableSelect` exists — build the async principal-select (or extend the `SearchableSelect` family); keep it a pure UI component per the Component File Policy.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `permission_grants` + model/contract/repo + `loadSet` union | grants resolve in the engine; nothing enforced |
| 2 | `assertWithinBoundary` + `/api/grants` + seed/backfill + audit + revoke | share authored safely; member own-object `delete`/`share` seeded |
| 3 | station/pin `visibilityPredicate` + write/delete checks + `canShare` | object-enforced; own/system/shared/other visibility correct |
| 4 | `ShareDialog` + `grants` SDK + gated entry points | share/revoke from the UI |

## Cross-slice notes

- **Migration ordering:** S1's create-table migration and S2's data backfill are separate; both need committed journal entries (S1 also a snapshot). The backfill (S2) is the prerequisite for S3's wiring — do not reorder.
- **Seed vs. parity:** S2's `MemberAccess` additions don't change `read`/`write` resolution, so the #598 switch-parity test is unaffected; only a raw statement-count assertion (if any) needs the +4.
- **`EffectiveStatement` type** spans S1→S3 (the widened `PermissionSet` param + `assertWithinBoundary` argument).
- **Doc sync (same PR):** no user-facing help/glossary/tool surfaces change; the durable `docs/` set is untouched (the grants engine is internal). The smoke doc (`/smoke 621`) is authored after implementation.
- **Load-set-once:** S3 reuses one `PermissionService.loadSet` per request for predicate + checks — never a per-row probe.

## Next step

Implementation begins on `feat/621-rbac-object-grants`, slice 1 first, tests-first, one commit per slice — only after discovery + spec + plan are confirmed.
