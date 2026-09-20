# RBAC IAM engine + system policies — Plan

**TDD-sequenced build of the engine foundation: schema → system-policy seed/backfill → the `PermissionSet` engine (dormant, proven switch-equivalent) → the guard cutover that retires the switch.**

Spec: `docs/RBAC_IAM_ENGINE.spec.md`. Discovery: `docs/RBAC_IAM_ENGINE.discovery.md` (the whole-engine record). Issue: #598 (epic #578). Builds on shipped **#576** (`permission.service.ts` seam). This is the **behavior-preserving foundation** the other RBAC children (#620 multi-role, #621 grants+sharing, #622 custom authoring) build on.

Four slices, each behind a green suite and each leaving the repo compilable. Commits on `feat/598-rbac-iam-engine` (PR #619). Tests via npm scripts (`feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
```

Each slice: (1) failing tests; (2) smallest change to green; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next.

Sequencing rationale — **blast radius grows last, and the cutover is de-risked before it happens:**
- **Slice 1** — the 4 tables + models + repos. Pure schema; the switch is untouched.
- **Slice 2** — seed + backfill the system policies for new **and** existing orgs. Data lands but nothing consumes it; the switch still governs.
- **Slice 3** — the `PermissionSet` engine, **dormant**: fully tested, and proven to reproduce the switch (parity), but not wired to any guard. This slice is the proof that slice 4 is safe.
- **Slice 4** — the cutover: attach the set in middleware, migrate the `check` call sites, **delete the switch**. Behind slice 3's parity proof + the existing guard tests.

No frontend, no API endpoint, no new `ApiCode`/`AUDIT_ACTIONS` (those are #621/#622).

---

## Slice 1 — Schema: 4 tables + models + repos

The dual-schema layers for `permission_policies` / `permission_statements` / `policy_attachments` / `roles`. No behavior; the switch is untouched.

**Files**

- New: `packages/core/src/models/permission.model.ts` — `PermissionStatementSchema` + `PolicySchema`/`RoleSchema` (+ Model/Factory); export from `models/index.ts`.
- New: `apps/api/src/db/schema/{permission-policies,permission-statements,policy-attachments,roles}.table.ts` (`baseColumns` + org FK; entity-tags template); register in `db/schema/index.ts`, drizzle-zod in `zod.ts`, `IsAssignable` guards in `type-checks.ts`.
- New: repositories for each in `db/repositories/` + register on `DbService.repository`.
- New: `db/generate` migration `add_rbac_engine` (the 4 `CREATE TABLE`s + indexes/CHECKs).
- New tests: `packages/core` model tests; an `apps/api` integration round-trip per repo.

**Steps**

1. **Tests (spec cases 1–2).** `PermissionStatementSchema` parses allow/deny + rejects unknown verb/resourceType/condition; `Policy`/`Role` round-trip via factory; a repo insert/find round-trip + soft-delete exclusion. Run; fail.
2. **Implement** the models, tables, dual-schema layers, repos, migration. Green.
3. Lint + type-check; **commit the migration + `meta/_journal.json` + snapshot together** (`project_drizzle_journal_must_be_committed`).

**Done when:** cases 1–2 pass; tables migrate on a fresh DB; `type-check` clean (dual-schema guards compile). Nothing consumes the tables yet.

**Risk:** low. Watch the dual-schema `type-checks.ts` assertions (a field-type mismatch fails `type-check`).

---

## Slice 2 — System policies: seed (new orgs) + backfill (existing orgs)

Seed the three immutable system policies/roles + attachments per org, both provisioning paths. Data lands; the switch still governs.

**Files**

- Edit: `apps/api/src/services/seed.service.ts` — `seedRbacSystemPolicies(organizationId, db)` (statements per D6; mirrors `seedSystemColumnDefinitions:571`).
- Edit: `apps/api/src/services/application.service.ts:585` — call it from `provisionOrganizationWorkspace` (also reached by ResetService).
- New: `apps/api/drizzle/NNNN_backfill-rbac-system-policies.sql` — cross-join `organizations`, insert roles/policies/statements/attachments, `ON CONFLICT` restating the partial-unique predicate (`0080` template).
- New/extend tests: `apps/api` integration for seed + backfill.

**Steps**

1. **Tests (spec cases 10–11).** After `seedRbacSystemPolicies`, an org has 3 roles + 3 policies + their statements + role→policy attachments; a second call doesn't duplicate (idempotent). **Backfill:** seed a pre-migration org row, run the migration, assert the 3 policies exist for it. Run; fail.
2. **Implement** the seed fn + the provisioning call + the backfill SQL. Green.
3. Lint + type-check; commit migration + journal + snapshot together.

**Done when:** cases 10–11 pass; a fresh provision seeds the policies; an existing org is backfilled. The backfill-coverage guard (`seed-backfill-coverage.test.ts`) stays green (system policies are a global-shaped seed, but assert the guard doesn't regress).

**Risk:** the backfill is the #316/#414 failure mode — test 11 (pre-migration org → backfilled) is the guard. No behavior change yet (nothing reads the policies).

---

## Slice 3 — The `PermissionSet` engine (dormant, proven switch-equivalent)

`loadSet` + `PermissionSet` (`check`/`can`/`visibilityPredicate` + condition eval), fully tested and **proven to reproduce the switch** — but wired to no guard. The de-risking slice.

**Files**

- New: `apps/api/src/services/permission-set.ts` — the `PermissionSet` class.
- Edit: `apps/api/src/services/permission.service.ts` — add `static async loadSet(ctx)`; **keep the existing `resolveEffect` switch + `check`/`visibilityPredicate` intact** (deleted in slice 4).
- New/extend tests: `apps/api` unit + integration.

**Steps**

1. **Tests (spec cases 3–9, 12).** deny>allow (3); ownership condition `created_by_caller`/`created_by_system` (4); explicit deny overrides ownership (5); `can`==`check` (6); `visibilityPredicate` shapes incl. fail-closed matches-nothing (7); **switch-parity (8) — a fixed `(role, action) → expected effect` table** (the documented owner/admin/member semantics, *not* a call into `resolveEffect`, so it survives that function's deletion) asserted against `PermissionSet`; `loadSet` gathers system-policy-via-role + a direct user attachment (9); a `loadSet` failure yields an empty set that denies (12). Run; fail.
2. **Implement** `loadSet` + `PermissionSet` (normalize dotted action + object.type → canonical `(verb, resourceType, resourceId, createdBy)`; evaluate deny→allow→implicit; translate `condition` to a `createdBy` compare / SQL). Green.
3. Lint + type-check.

**Done when:** cases 3–9, 12 pass; **parity (8) is green** — the engine reproduces the switch from the seeded policies. The switch still governs live requests; the engine is unreferenced by routes.

**Risk:** the parity table is the contract for slice 4 — if any `(role, action)` diverges, **fix the seeded statements (slice 2) or the resolver, do not proceed to cutover.** `visibilityPredicate` is tested here but stays unwired (that's #621).

---

## Slice 4 — Cutover: attach in middleware, migrate call sites, delete the switch

Route guards resolve through the engine; the hardcoded switch is removed. Behind slice 3's parity proof.

**Files**

- Edit: `apps/api/src/middleware/metadata.middleware.ts:90,127` — `req.application.permissions = await PermissionService.loadSet(ctx)`; on failure attach an empty set (fail-closed). Extend the `Request`/`application` type.
- Edit: `apps/api/src/routes/organization.router.ts` (`:304,428,1436`), `services/billing.service.ts` (`:226,320`), `services/seat.service.ts` (`:65,145,155,187,212,235,397`) — `PermissionService.check(ctx,…)` → `req.application.permissions.check(…)` (or pass the set into the service).
- Edit: `apps/api/src/services/permission.service.ts` — **delete `resolveEffect` + the static `check`/`visibilityPredicate`(ctx-based)** now that nothing calls them.
- Extend tests: route integration (13) + the migrated guards' existing suites.

**Steps**

1. **Tests (spec case 13 + regressions).** Through the migrated path: owner can org.delete + billing.manage; admin denied both; member denied member.role.assign — identical to pre-#598. Assert a repo grep `PermissionService.check(` returns zero after the cutover (or an equivalent guard). Run; fail (until wired).
2. **Implement** the middleware attach + the call-site migration; then delete the switch. Green — including every existing guard test (billing/org/seat) unchanged.
3. Lint + type-check; a full `apps/api` suite run (the cutover touches shared middleware).

**Done when:** case 13 + all existing guard suites pass through the engine; the switch is gone; `PermissionService.check(` has no callers. `visibilityPredicate`/object checks remain built-but-unwired (#621).

**Risk:** highest — shared middleware + ~10 guard sites. Mitigated by slice 3's parity proof, the existing guard suites as the live gate, and fail-closed load. If a guard suite regresses, the parity table (8) localizes it.

---

## Sequence summary

| Slice | Lands | Spec cases | Gate |
|---|---|---|---|
| 1 | 4 tables + models + repos + migration | 1–2 | fresh migrate; dual-schema type-check |
| 2 | system policies seed + backfill | 10–11 | pre-migration org backfilled |
| 3 | `PermissionSet` engine (dormant) | 3–9, 12 | **switch-parity green** |
| 4 | middleware attach + call-site migration + delete switch | 13 + regressions | existing guard suites via engine; zero `PermissionService.check(` callers |

≈ **13 cases**, backend-only. Commits on `feat/598-rbac-iam-engine`; PR #619 grows commit-by-commit.

## Cross-slice notes

- **Drizzle discipline:** slices 1 + 2 each generate a migration — commit the `.sql` + `meta/_journal.json` + `<n>_snapshot.json` together, or CI's fresh DB fails (`project_drizzle_journal_must_be_committed`). After a branch switch, rebuild `@portalai/core` before type-check (`project_stale_core_dist_after_branch_switch`).
- **The switch lives until slice 4.** Slices 1–3 leave `resolveEffect` intact and governing; only slice 4 deletes it. This is what keeps every intermediate commit green + behavior-preserving.
- **Parity is the contract, not a call.** The slice-3 parity table encodes the #576 semantics as fixed expectations so it survives the switch's deletion — it's the single artifact proving the cutover is safe.
- **`visibilityPredicate` stays unwired.** Built + tested in slice 3, wired into station/pin routes in **#621** (with grants) so member visibility doesn't tighten before the grant mechanism exists.
- **Doc-sync:** the authorization model changes, but the durable docs describing it (`apps/api/README.md`, `CLAUDE.md`) reference the *seam*, not the switch internals — re-check for a `resolveEffect`/switch mention and update in this PR if any (per `CLAUDE.md` → "Keeping Documentation in Sync"). No user-facing/help copy changes (backend-only).

## Next step

Implement slice 1 on `feat/598-rbac-iam-engine` — the 4 tables + models + repos, tests-first — only after discovery/spec/plan are confirmed. Re-read the spec's *Surface* (exact table columns + `PermissionSet` signatures) before coding; lift, don't reinvent.
