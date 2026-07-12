# Org switcher UI — Plan

**TDD-sequenced implementation of the header org switcher: backend endpoints (contracts + service + authz-gated routes), then the SDK surface, then the `OrgSwitcher` component.**

Spec: `docs/ORG_SWITCHER.spec.md`. Discovery: `docs/ORG_SWITCHER.discovery.md`. Issue: #201. Builds on shipped #190 (`portalai member switch`) and #200 (`getCurrentOrganization` NULLS LAST) — no schema change.

Three slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/org-switcher` / PR #204** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
cd packages/core && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** — the backend contract + endpoints are the foundation the SDK and UI consume; nothing downstream can be tested against a real shape until these exist. Contracts live in `packages/core` (imported by both api and web), so they land here first.
- **Slice 2** — the SDK is a thin, independently-testable layer over slice 1's endpoints; it unblocks the component without dragging UI concerns into the API work.
- **Slice 3** — the component is pure presentation + wiring over slice 2's SDK; it's last because it depends on both, and its pure-UI test needs no backend.

---

## Slice 1 — Backend: contracts, authz-gated endpoints, service

Contracts in `@portalai/core`, the `MEMBERSHIP_NOT_FOUND` code, two service methods, two routes with `@openapi` + swagger registration.

**Files**

- New: `packages/core/src/contracts/user-membership.contract.ts` (`UserMembershipSchema`, `UserMembershipsGetResponseSchema`, `OrganizationSwitchRequestSchema` + types).
- Edit: `packages/core/src/contracts/index.ts` (re-export).
- Edit: `apps/api/src/constants/api-codes.constants.ts` (`MEMBERSHIP_NOT_FOUND`).
- Edit: `apps/api/src/services/application.service.ts` (`listUserMemberships`, `switchOrganization`).
- Edit: `apps/api/src/routes/organization.router.ts` (`GET /memberships`, `POST /switch`).
- Edit: `apps/api/src/config/swagger.config.ts` (register the two new schemas + `OrganizationGetResponse` if absent).

**Steps**

1. **Tests (spec: apps/api service ≈6 + endpoints ≈4).** Service unit: `listUserMemberships` excludes soft-deleted membership/org and flags the max-`last_login` row `isCurrent`; `switchOrganization` bumps `last_login` + returns the target; **switch into a non-member org → `MEMBERSHIP_NOT_FOUND`**; switch into a soft-deleted membership → same. Integration (real DB): `GET /memberships` returns `{ organization, isCurrent }[]`; `POST /switch` flips current (a follow-up `GET /current` reflects it); non-member → `403`; unauthenticated → `401`. Run; fail.
2. **Implement** the contracts, code, service methods (`exists()` gate + `updateWhere` bump), routes with `@openapi`, swagger registration. Green.
3. Lint + type-check (`apps/api` + `packages/core`); integration DB reset-if-needed (see cross-slice notes).

**Done when:** ≈10 cases pass; `/api-docs` renders both endpoints; the authz `403` is enforced. Nothing in web references these yet.

**Risk:** the integration test DB in this sandbox needs a fresh-migrate reset (drizzle tracking survives the harness truncate) — see cross-slice notes; not a code risk.

---

## Slice 2 — SDK: memberships query + switch mutation

`sdk.organizations.memberships()` + `.switch()` and the query key, over slice 1's endpoints.

**Files**

- Edit: `apps/web/src/api/keys.ts` (`organizations.memberships()`).
- Edit: `apps/web/src/api/organizations.api.ts` (`memberships` via `useAuthQuery`, `switch` via `useAuthMutation`).

**Steps**

1. **Tests (spec: apps/web SDK/invalidation ≈1).** Assert `switch()`'s `onSuccess` triggers a broad `queryClient.invalidateQueries()` (no key) via `jest.spyOn(queryClient, "invalidateQueries")` using the test-util `queryClient` injection. (If the SDK object shape is best asserted through the component in slice 3, keep the invalidation-spy test here and note it.) Run; fail.
2. **Implement** the two SDK endpoints + key. The broad invalidation lives in the `switch()` consumer's `onSuccess`; if the SDK endpoint itself owns a default `onSuccess`, place it there. Green.
3. Lint + type-check (`apps/web`).

**Done when:** the SDK exposes `memberships()`/`switch()` keyed correctly; the invalidation contract is asserted. No component yet.

**Risk:** deciding where `onSuccess` invalidation lives (SDK default vs. component). Resolve in favor of the component owning it (mirrors the mutation-cache-invalidation convention) — adjust the slice-2 test to assert the spy from the component in slice 3 if cleaner; keep slice 2 to the endpoint wiring then.

---

## Slice 3 — Frontend: the `OrgSwitcher` component in the header

Container + pure UI, embedded in `HeaderMenu`, hidden below 2 memberships, broad invalidation on switch.

**Files**

- New: `apps/web/src/components/OrgSwitcher.component.tsx` (`OrgSwitcher` container + `OrgSwitcherUI`).
- New: `apps/web/src/__tests__/OrgSwitcher.test.tsx`.
- Edit: `apps/web/src/components/HeaderMenu.component.tsx` (render `<OrgSwitcher />` + `<Divider />` in the menu children).

**Steps**

1. **Tests (spec: apps/web `OrgSwitcher` ≈4 + the invalidation case if moved here).** Render `OrgSwitcherUI`: renders nothing with <2 memberships; one `MenuItem` per org with the current one checked; clicking a non-current org calls `onSwitch(id)`; items disabled while `isSwitching`. Container-level: `onSwitch` → `switch()` mutation → `onSuccess` broad `invalidateQueries()` (spy). Run; fail.
2. **Implement** `OrgSwitcherUI` (props-only, MUI `MenuItem`/`ListItemIcon`/`ListItemText`, checkmark on current) and the `OrgSwitcher` container (`sdk.organizations.memberships()` + `.switch()`, broad invalidation `onSuccess`); wire `<OrgSwitcher/>` into `HeaderMenu`. Green.
3. Lint + type-check (`apps/web`); full `apps/web` unit suite (HeaderMenu edit must not regress).

**Done when:** ≈15 total cases pass across the feature; a ≥2-org user sees the switcher, a 1-org user sees no change; switching refetches org-scoped data.

**Risk:** `HeaderMenu` renders inside a real `<Menu>`; keep `OrgSwitcherUI` pure so its test needs no menu/router context (Component File Policy). The container's SDK use is covered by the invalidation spy, not a full integration render.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | contracts + `MEMBERSHIP_NOT_FOUND` + service + 2 endpoints + swagger | ≈10 cases; `403` authz enforced; `/api-docs` renders |
| 2 | SDK `memberships()` + `switch()` + key | invalidation contract asserted; type-check clean |
| 3 | `OrgSwitcher` in `HeaderMenu` + broad invalidation | ≈15 total; hidden <2 orgs; org-scoped refetch on switch |

## Cross-slice notes

- **`isCurrent` is computed, not stored** — `listUserMemberships` must flag whichever row `getCurrentOrganization` picks (max `last_login`, NULLS LAST), so the checkmark can never disagree with what the app resolves. Single source of truth spans slices 1 and 3.
- **Broad invalidation ownership** — the `switch()` `onSuccess` calls `queryClient.invalidateQueries()` with no key (all data is org-scoped). Per the Mutation-Cache-Invalidation convention the consumer owns invalidation, so it lives in the slice-3 container; slice 2 just wires the endpoint. Whichever slice owns it also owns the spy test — don't assert it twice.
- **Integration test DB (sandbox)** — the persistent `postgres_test` DB drifts: the harness's `public`-only TRUNCATE empties seeded tables (e.g. `tiers`) while drizzle's migration tracking survives, so `migrate()` no-ops and org-creating tests hit FK errors. Reset with `DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE;` before the slice-1 integration run so migrations re-run fresh (mirrors CI). Not a product concern.
- **Doc-sync** — new endpoints get `@openapi` blocks (the doc surface). No glossary/README/CLAUDE.md convention changes. If the header UI gains a user-visible concept ("switch organization"), consider a `glossary.util.ts`/`getting-started.util.ts` touch — check during slice 3 per `CLAUDE.md` → "Keeping Documentation in Sync".

## Next step
Implementation begins on `feat/org-switcher` — slice 1 first, tests-red-then-green, one commit per slice; PR #204 grows commit-by-commit and closes #201 on merge.
