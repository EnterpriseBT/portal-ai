# Organization delete from Settings — Plan

**TDD-sequenced implementation of owner-initiated org deletion: contracts + error codes, the full-cascade `OrganizationDeleteService` (tombstone hybrid), the guarded `DELETE /api/organization/:id` route, the type-to-confirm dialog, and the Settings Danger zone with logout-on-success.**

Spec: `docs/ORG_DELETE.spec.md`. Discovery: `docs/ORG_DELETE.discovery.md`. Issue: #197. Builds on shipped machinery only (`ResetService` as the cascade template, `wideTableReconcilerService.dropTable`, `JobsService.cancel`, `S3Service.deleteObject`) — no cross-ticket dependency.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/org-delete`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — leaf contracts first, then the destructive core proven in isolation, then the HTTP guard layer over it, then pure UI, then the wiring that makes it user-reachable:

- **Slice 1** — contracts + `ApiCode`s + the org job finder: every later slice imports these; zero behavior.
- **Slice 2** — `OrganizationDeleteService` (job sweep + cascade + S3): the feature's risk lives here; proven against a fully-populated fixture org + control org before any route can reach it.
- **Slice 3** — the `DELETE` route: guards (current-org, owner, confirmation) composed over the already-proven service; swagger registration rides along.
- **Slice 4** — `DeleteOrganizationDialog` (pure UI) + `sdk.organizations.delete()`: testable with props alone, no view changes yet.
- **Slice 5** — Settings Danger zone + logout-on-success + FAQ: the last wire-up; doc-sync lands in the same PR.

No migration (spec → "Migration / Seed: none").

---

## Slice 1 — Contracts, error codes, org job finder

Pure surface: the types and codes everything else imports, plus the repository/lock-service lookup the sweep needs. No behavior change.

**Files**

- Edit: `packages/core/src/contracts/organization.contract.ts` — `OrganizationDeleteRequestSchema` / `OrganizationDeleteResponseSchema` + types (spec → Contracts).
- Edit: `packages/core/src/contracts/index.ts` — re-exports.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `ORGANIZATION_NOT_OWNER`, `ORGANIZATION_CONFIRMATION_MISMATCH`, `ORGANIZATION_DELETE_FAILED` (Organization section).
- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `findRunningForOrganization(organizationId)` (sibling of `findRunningForConnectorInstance:78`, same `NON_TERMINAL_JOB_STATUSES` filter).
- Edit: `apps/api/src/services/job-lock.service.ts` — `findRunningForOrganization` mapping through `toSummary:40`.
- New/extend: core contract test (spec cases 1–2).

**Steps**

1. **Tests (spec cases 1–2).** `OrganizationDeleteRequestSchema` accepts `{ confirmationName: "Acme" }`, rejects `{}`/empty string; response schema round-trips `{ id }`. Run; fail.
2. **Implement** the two schemas + re-exports, the three `ApiCode`s, and both finders (the finders' behavior is exercised by slice 2's case 9 — this slice only needs them to compile and type-check). Green.
3. Lint + type-check.

**Done when:** cases 1–2 pass; the codes and finders exist; nothing references them yet.

**Risk:** none — additive surface.

---

## Slice 2 — `OrganizationDeleteService` (job sweep + cascade + S3 cleanup)

The destructive core, proven in isolation before any HTTP surface exists. This is the largest slice and the one worth the most review attention.

**Files**

- New: `apps/api/src/services/organization-delete.service.ts` — `deleteOrganization(organizationId, actorUserId)` per spec (phase 1 job sweep, phase 2 transaction, phase 3 S3).
- New: `apps/api/src/__tests__/__integration__/services/organization-delete.service.integration.test.ts` — spec cases 3–11 against the fully-populated fixture org + control org.

**Steps**

1. **Fixture first.** Build the populated-org helper: station (+ toolpack link + instance link, set as `defaultStationId`), portal (+ messages + pinned result), connector instance (+ entity + field mappings + records + layout plan), a real `er__*` table via `wideTableReconcilerService`, column definitions, groups/tags (+ members/assignments), org toolpack, api-endpoint config, file-upload row, usage rows, a second member, `pending` + `completed` jobs — and an identically-shaped **control org**.
2. **Tests (spec cases 3–11).** Zero rows per content table for the deleted org (loop-assert); `er__*` gone (`pg_tables`) + its `wide_table_columns` rows gone; `usage` untouched; org row soft-deleted with `deletedBy = actor`; all memberships (owner included) soft-deleted; control org fully intact; `pending` job cancelled + delete proceeds, mocked `active` job → 409 `ENTITY_LOCKED_BY_JOB` with `runningJobs` **and nothing deleted**; `defaultStationId` nulled before stations (fixture uses it — no FK error); `S3Service.deleteObject` called per collected `s3Key` post-commit, a rejecting mock doesn't fail the delete. Run; fail.
3. **Implement phase 1** — `JobLockService.findRunningForOrganization`; cancel each non-`active` non-terminal job via `JobsService.cancel` (catch + ignore `JOB_ALREADY_TERMINAL` races); re-fetch; any `active` → throw the 409 before the transaction opens.
4. **Implement phase 2** — one `DbService.transaction` following `ResetService.resetOrganization`'s order (`reset.service.ts:53-192`) extended per spec: collect live `connectorEntityIds` + all `fileUploads.s3Key`s; reset's deletes; `connectorInstanceLayoutPlans` (instance-ids subquery) + `apiEndpointConfigs`; `dropTable(entityId, tx)` per entity + `wideTableColumns` org sweep; `connectorEntities` → `connectorInstances` → `entityGroups`/`entityTags`/`columnDefinitions`; `organizationToolpacks` + `fileUploads`; `jobs`; soft-delete all `organizationUsers`, soft-delete the `organizations` row. `usage` untouched.
5. **Implement phase 3** — post-commit best-effort `S3Service.deleteObject` loop, `warn`-log skips.
6. Green; lint + type-check.

**Done when:** cases 3–11 pass; the service is complete but unreachable via HTTP.

**Risk:** the fixture is the hard part — it must touch every table or the loop-assert proves less than it claims. Reuse existing integration-test factories where they exist rather than hand-rolling. Watch FK order around `connector_instance_layout_plans` (must precede `connectorInstances`) and the `defaultStationId` null-before-stations step.

---

## Slice 3 — `DELETE /api/organization/:id` route + swagger

The guard layer over the proven service: current-org scoping, owner check, server-verified confirmation.

**Files**

- Edit: `apps/api/src/routes/organization.router.ts` — the `DELETE /:id` handler (guard order per spec: current-org 404 → body 400 → fetch 404 → owner 403 → confirmation 400 → service → `{ id }`) + `@openapi` block.
- Edit: `apps/api/src/config/swagger.config.ts` — register `OrganizationDeleteRequest` / `OrganizationDeleteResponse` components (`z.toJSONSchema` from the contracts).
- Edit: `apps/api/src/__tests__/__integration__/routes/organization.router.integration.test.ts` — spec cases 12–17.

**Steps**

1. **Tests (spec cases 12–17).** 401 no token; 404 non-current org id; 403 `ORGANIZATION_NOT_OWNER` for a non-owner member; 400 missing body / 400 `ORGANIZATION_CONFIRMATION_MISMATCH` on wrong name (case-sensitive, whitespace-trimmed match passes); 200 `{ id }` then `GET /current` → 404 and repeat DELETE → 404; 409 with `details.runningJobs` under an `active` job. Run; fail.
2. **Implement** the handler (mounted with `getApplicationMetadata`, mirroring `PATCH /:id` at `organization.router.ts:94-157`) + the swagger components + `@openapi` block.
3. Green; lint + type-check.

**Done when:** cases 12–17 pass; the endpoint is live and fully guarded; Swagger UI shows the route.

**Risk:** the 403-vs-404 ordering — a non-member probing another org's id must get 404 (current-org guard) *before* any owner logic runs, so org existence isn't leaked. The guard order in the spec encodes this; case 13 pins it.

---

## Slice 4 — `DeleteOrganizationDialog` (pure UI) + SDK method

The type-to-confirm dialog, testable entirely through props, plus the mutation hook it will be wired to.

**Files**

- New: `apps/web/src/components/DeleteOrganizationDialog.component.tsx` — pure UI per spec (Modal-form mechanics mirroring `DeletePortalDialog.component.tsx`, type-to-confirm `TextField` with `useDialogAutoFocus`, trim-match gate, `data-testid="confirm-delete-organization"`, aria-invalid after blur).
- Edit: `apps/web/src/api/organizations.api.ts` — `delete: (id) => useAuthMutation<OrganizationDeleteResponse, OrganizationDeleteRequest>({ url, method: "DELETE" })` (exemplar: `connector-instances.api.ts:156-160`).
- New: `apps/web/src/__tests__/DeleteOrganizationDialog.test.tsx` — spec cases 18–24.

**Steps**

1. **Tests (spec cases 18–24).** Renders open / not closed; button disabled → enabled on exact match (incl. surrounding-whitespace match); `onConfirm(trimmedName)` on click **and** Enter submit, never while non-matching; input clears on reopen; pending disables both buttons + progress label; `FormAlert` with/without `serverError`; `aria-invalid` after blur on non-match. Run; fail.
2. **Implement** the dialog + the SDK method (the SDK addition is compile-only here; its behavior is exercised in slice 5's case 26). Green.
3. Lint + type-check.

**Done when:** cases 18–24 pass; the dialog exists but no view renders it.

**Risk:** none beyond dialog-test fiddliness — the house checklist (`CLAUDE.md` → Dialog & Form Test Checklist) is the template; `DeletePortalDialog.test.tsx` is the style exemplar.

---

## Slice 5 — Settings Danger zone + logout-on-success + FAQ

The final wire-up that makes the feature user-reachable, plus the doc-sync surface.

**Files**

- Edit: `apps/web/src/views/Settings.view.tsx` — Danger-zone `PageSection` after "Subscription & Usage" (`:179-211`), dialog state, `sdk.organizations.delete(organization.id)` mutation, `onSuccess` → Auth0 logout (`auth.api.ts:27-36`, invoked as in `HeaderMenu.component.tsx:90-93`), `serverError={toServerError(...)}`.
- Edit: `apps/web/src/utils/faq.util.ts` — "How do I delete my organization?" Q&A.
- Edit/extend: Settings view test (spec cases 25–26), `jest.unstable_mockModule` SDK mocks per `cache-invalidation.test.tsx` style.

**Steps**

1. **Tests (spec cases 25–26).** Organization tab renders the Danger zone and opens the dialog; a successful mutation triggers the logout callback (mocked `sdk.organizations.delete` + mocked auth). Run; fail.
2. **Implement** the view wiring + the FAQ entry.
3. Green; lint + type-check at the repo root (`npm run lint && npm run type-check`) — final boundary.

**Done when:** cases 25–26 pass; the full path (Settings → dialog → DELETE → logout) exists; FAQ describes it.

**Risk:** logout must fire only on mutation success — a server 4xx/5xx keeps the dialog open with `FormAlert` showing the typed error (the 409 `runningJobs` message included). Case 26 plus the dialog's serverError cases (23) cover both sides.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | contracts + `ApiCode`s + org job finder | 1–2 | core unit |
| 2 | `OrganizationDeleteService` (sweep + cascade + S3) | 3–11 | api integration |
| 3 | `DELETE /:id` route + guards + swagger | 12–17 | api integration |
| 4 | `DeleteOrganizationDialog` + `sdk.organizations.delete` | 18–24 | web unit |
| 5 | Settings Danger zone + logout + FAQ | 25–26 | web unit |

Total ≈ **26 cases**, no migration. Commits on `feat/org-delete`; the PR grows commit-by-commit.

---

## Cross-slice notes

- **No migration, no seed** — every column involved already exists; the tombstone reuses `baseColumns` soft-delete.
- **Tombstone semantics span slices 2–3:** the org row's soft-delete is what makes the repeat-DELETE-404 (case 16) and `GET /current` 404 work for free — the repository's `deleted IS NULL` filter is the mechanism, don't special-case it in the route.
- **Fixture maintenance note (from spec risks):** slice 2's loop-assert over the org-scoped table list is the guard against future cascade gaps — when a new `organizationId` table lands, extending the fixture (and the cascade) is part of that future PR. The test file should carry a comment saying exactly that.
- **`ENTITY_LOCKED_BY_JOB` reuse:** no new 409 renderer — the deny carries the same `details.runningJobs: RunningJobSummary[]` shape as connector-instance locks, and the dialog surfaces it through the existing `FormAlert` path.
- **Doc-sync surfaces** (`CLAUDE.md` → Keeping Documentation in Sync): FAQ (slice 5) is the only structured-help surface touched — org deletion is a new user-facing capability. No glossary/getting-started/tool-contract impact. The smoke checklist is `/smoke`'s phase, not a plan slice.
- **The dialog is a pure UI component** (Component File Policy): local input state is UI state; the view owns the mutation and logout. Storybook story optional but cheap — add alongside slice 4 if desired.

---

## Next step

Implementation starts on this branch once discovery + spec + plan are confirmed: slice 1 first, tests-first, one commit per slice (`feat(core,api): org-delete contracts + codes + job finder (#197)` and onward).
