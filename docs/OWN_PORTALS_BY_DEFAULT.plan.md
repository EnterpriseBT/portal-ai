# Own portals by default — Plan

**This plan implements the engine rule from `docs/OWN_PORTALS_BY_DEFAULT.spec.md`: a wildcard allow covers a personal type (`portal`) only for the caller's own objects, while explicit statements and authoring keep working. TDD-sequenced in two slices.**

Spec: `docs/OWN_PORTALS_BY_DEFAULT.spec.md`. Discovery: `docs/OWN_PORTALS_BY_DEFAULT.discovery.md`. Issue: #1127. It should reach `main` before the Launcher epic (#1084): #1075's launcher already reads `mine=true`, and this makes the dashboard's Recent portals and the station page's Portals list own-only as well.

There are 2 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/1127-own-portals-by-default`**: one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <names>
cd apps/api && npm run test:unit -- --testPathPattern <names>
cd apps/api && npm run test:integration -- --testPathPattern <names>
```

Each slice: (1) write failing tests; (2) make the smallest change that turns them green; (3) run them; (4) `npm run lint && npm run type-check` (plus the root `npm run build`, since core changes); (5) move to the next slice.

**Sequencing rationale.**
- **Slice 1** is the rule itself. It's leaf logic in core and `PermissionSet`, so everything else is a consequence of it. The integration tests that assert today's owner and admin reach flip the moment the rule lands, so they're updated *in* this slice to keep the tree green.
- **Slice 2** adds the new end-to-end cases the rule makes possible (explicit grants, authoring, pins) and the copy. It depends only on slice 1.

---

## Slice 1 — the personal-type rule in the engine

Add `PERSONAL_RESOURCE_TYPES` and the access-versus-delegation rule in `PermissionSet`. Then update the existing tests whose owner and admin expectations the rule changes.

**Files**

- Edit:
  - `packages/core/src/models/permission.model.ts`: `PERSONAL_RESOURCE_TYPES` (and its barrel export).
  - `apps/api/src/services/permission-set.ts`:
    - `effectiveCondition`;
    - `matches` and `resolve` take a `mode` (`"access"` by default);
    - `assertStatementsWithinBoundary` resolves with `"delegation"`;
    - `visibilityPredicate` maps each allow to its effective condition.
- Tests:
  - `packages/core/src/__tests__/models/permission.model.test.ts`
  - `apps/api/src/__tests__/services/permission-set.test.ts`
  - `apps/api/src/__tests__/__integration__/routes/portal.router.authorization.integration.test.ts` (flipped cases)
  - `apps/api/src/__tests__/__integration__/routes/object-capabilities.agreement.integration.test.ts` (portal exception)

**Steps**

1. **Tests (spec cases 1–16; 17, 20 and 24 as flips).** Write these failing first:
   - **Core:** case 1, the constant is `["portal"]` and every entry is a data type.
   - **`permission-set.test.ts`:**
     - owner and admin allowed on their own portal and denied on another's (2–3);
     - owner `visibilityPredicate("portal")` is `createdBy = caller`, while `station` stays unrestricted (4);
     - explicit `allow read portal` (5) and an instance grant (6);
     - a wildcard `created_by_system` allow is unchanged (7);
     - a wildcard deny still denies (8);
     - an unknown creator is denied (9);
     - `canPerformAny` is true (10);
     - the switch-parity matrix row flips for others' portals (11);
     - the boundary cases (12–16): owner and admin may author `allow read portal`, `allow * portal` and `read portal:<other's>`, and a member may not.
   - **Integration:** rewrite "the owner's shows all" as "the owner's shows only its own" (17), and "owner posts into a member's portal" as a 404 (20). In the capability agreement test, the owner no longer gets capabilities on a member-created portal, and every other type is unchanged (24).

   Run them; they fail.
2. **Implement** the constant and the `PermissionSet` changes exactly as specified. Green.
3. Run the wider suites that exercise the engine and look for unexpected flips:
   - **Unit:** `permission`, `object-capabilities`, `policy`, `role`, `grant`.
   - **Integration:** `authorization`, `capabilit`, `rbac`, `policy`, `portal`, `read-access`.

   Any other change in owner or admin behaviour is a bug in the rule, not a test to update.
4. Root `npm run build`, then lint and type-check.

**Done when:** cases 1–16, 17, 20 and 24 pass; the wider engine and authorization suites pass unchanged apart from those three flips; build, lint and type-check are clean.

**Risk:** the narrowing leaking to other types. The switch-parity matrix (11) and the capability agreement test (24) are the guards. Watch `visibilityPredicate`: the allows must be mapped before the "unconditional class-level allow" check, or an owner's `* *` would still return "see all".

---

## Slice 2 — explicit grants, authoring, pins and copy

Prove the explicit-grant path and the authoring boundary end to end, cover the remaining portal routes and pins, and update the stale comments and Help.

**Files**

- Tests:
  - `apps/api/src/__tests__/__integration__/routes/portal.router.authorization.integration.test.ts` (cases 18, 19, 21, 22, 23)
  - `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` (25)
  - `apps/api/src/__tests__/__integration__/routes/policy.router.integration.test.ts` (26)
  - `packages/core/src/__tests__/content/glossary.util.test.ts` (27, run with the permission-copy guard)
- Edit (copy):
  - comments in `apps/api/src/services/portal-access.service.ts:5-7`, `apps/api/src/routes/portal.router.ts:258-259`, `apps/api/src/routes/portal-events.router.ts:153-158`, `apps/web/src/views/Portal.view.tsx:57` and `apps/api/src/services/permission-set.ts:291`;
  - the Help glossary's "Portal" entry in `packages/core/src/content/glossary.util.ts`.

**Steps**

1. **Tests (spec cases 18, 19, 21–27).** Write these first:
   - the admin's list is own-only (18);
   - an owner's GET (19) and delete (21) of a member's portal are 404;
   - a custom `allow read portal` policy (or a direct grant) on the admin lists and reads the member's portal, while a post without write stays refused (22);
   - the member is unchanged (23);
   - an owner pinning from a member's portal is 404, while a pin the member shared stays readable by its own rules (25);
   - an admin's custom policy with `allow read portal` is 201 (26);
   - the glossary entry and the copy guard pass (27).

   Run them. Most should already pass after slice 1, which is the point: they pin the contract end to end. Fix any that don't by correcting the rule, not the test.
2. **Copy:** update the five comments and add the Portal glossary sentence from the spec.
3. Root `npm run build`, then lint and type-check. Run the core content tests (`glossary`, `help`, `permission-copy`) and the API portal and policy integration suites.

**Done when:** cases 18–27 pass; no comment still says owners and admins reach every portal; Help's Portal entry says portals are private unless access is granted.

**Risk:** case 22's direct-grant variant depends on how a direct grant is attached in tests (the policy-attachment helpers in the RBAC integration tests). Reuse their fixtures rather than hand-writing rows.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `PERSONAL_RESOURCE_TYPES`; `PermissionSet` access/delegation rule; the flipped owner/admin tests | Cases 1–17, 20, 24; engine and authorization suites unchanged otherwise |
| 2 | End-to-end explicit-grant, authoring, pin and route cases; comments; Help line | Cases 18–27 |

## Cross-slice notes

- **No migration and no seed change.** `rbac-seed.integration.test.ts` must keep passing untouched. If it doesn't, the change has strayed into data.
- **Core rebuild.** The API reads core's built output, so run the root `npm run build` after the core constant lands, before the API suites.
- **The dev API server** (nodemon) doesn't watch core. After a core rebuild, touch an API source file to restart it before a manual walk.
- **Docs in sync:** the Help glossary line (slice 2). No FAQ, troubleshooting or durable doc states the old behaviour (the survey checked). The release notes for the next prod release must say that owners and admins now see only their own portals unless granted, and that a custom `* *` policy no longer covers others' portals.
- **The Launcher epic:** `mine=true` (#1075) stays useful after this, for callers whose explicit grants show them others' portals.

## Next step

Implementation begins on this branch with slice 1, tests first, once discovery, spec and plan are confirmed.
