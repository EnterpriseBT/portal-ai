# Rename an organization from Settings — Plan

**TDD-sequenced implementation of org rename: the strict PATCH contract and `org.update` audit action, the `write org` permission end to end, the locked update service with the best-effort Stripe sync, the PATCH rewrite, the Settings dialog, and the Activity summary + FAQ.**

Spec: `docs/ORG_RENAME.spec.md`. Discovery: `docs/ORG_RENAME.discovery.md`. Issue: #907. Builds on shipped #690 (`station.default.set` and the org PATCH's station path), #711 (`permissionDenied` phrases) and #801 (`nameField`).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/907-org-rename` / PR #937**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package through the npm scripts (never jest directly, `feedback_use_npm_test_scripts`), scoped to the touched files (`feedback_test_only_touched_files_locally`):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice. Slices 2 and 6 change core, so they end with the **full root** `npm run build && npm run type-check` ([[feedback_core_model_change_run_full_build]]), and core is rebuilt before any API/web run that reads its `dist`.

Sequencing rationale:

- **Slice 1:** the contract and audit action are pure core additions that nothing consumes yet, so they can't break anything.
- **Slice 2:** the capability goes in with its API plumbing in **one** slice, not split by package. `capabilityMap` calls `set.can(action)` over `CALLER_CAPABILITY_ACTIONS`, so adding `org.write` to core without `PermissionAction`/`ACTION_MAP` in the API fails the API's type-check, and `CapabilityMap` is exhaustive, so every typed fixture in core, api and web must gain the key in the same commit.
- **Slice 3:** the Stripe method and `OrganizationUpdateService` are unit-testable before any route calls them.
- **Slice 4:** the PATCH rewrite composes 1–3, and its integration tests prove the contract end to end.
- **Slice 5:** the web needs the live PATCH (4) and the `org.write` capability (2).
- **Slice 6:** the Activity summary and the FAQ are read-side and copy. They depend only on the audit action (1) and describe shipped behaviour (5).

No migration: `write` and `org.update` widen text enums with no CHECK ([[project_rbac_vocabulary_no_migration]]).

---

## Slice 1 — Core: update contract + `org.update` audit action

The strict request schema and the response schema, and the new audit action. Nothing references them yet.

**Files**

- Edit: `packages/core/src/contracts/organization.contract.ts`: `OrganizationUpdateRequestSchema` (strict, refine on `{}`), `OrganizationUpdateResponseSchema`, and their types.
- Edit: `packages/core/src/models/audit-log.model.ts`: `"org.update"` in `AUDIT_ACTIONS`, after `"org.delete"`, with its comment.
- Edit: `packages/core/src/__tests__/contracts/organization.contract.test.ts`, `packages/core/src/__tests__/models/audit-log.model.test.ts`.

**Steps**

1. **Tests (spec Core: contract 6 cases, audit 1 case).** Name-only, station-only, null station and both are valid; `{}` fails with the refine message; an unknown key, a blank name and a 121-character name are rejected; the name is trimmed; `org.update` parses. Run; fail.
2. **Implement** the schemas and the enum entry. Green. `strict-request-bodies.test.ts` and `name-length.guard.test.ts` pick the schema up with no change. Run them to confirm.
3. Lint + type-check (core).

**Done when:** the 7 cases and both guard tests pass; no consumer references the new schemas.

**Risk:** none. `AUDIT_ACTIONS` widening may surface an exhaustive `switch`/`Record` over actions in api or web; if type-check finds one, it's fixed here.

---

## Slice 2 — The `write org` permission and the `org.write` capability, end to end

`org` gains the `write` verb, `org.write` joins the caller capabilities, and the API evaluates and phrases it. No route checks it yet, and no UI reads it.

**Files**

- Edit: `packages/core/src/models/permission.model.ts`: `RESOURCE_CAPABILITIES.org.verbs` → `["write", "delete"]` (and its comment); `"org.write"` in `CALLER_CAPABILITY_ACTIONS` after `"org.delete"`, with its doc comment.
- Edit: `apps/api/src/services/permission-set.ts`: `ACTION_MAP["org.write"]`.
- Edit: `apps/api/src/services/permission.service.ts`: `PermissionAction` gains `"org.write"`.
- Edit: `apps/api/src/services/permission-refusal.ts`: `ACTION_PHRASES["org.write"] = "edit the organization"`.
- Edit (tests): `packages/core/src/__tests__/models/permission.model.test.ts`, `apps/api/src/__tests__/services/permission-refusal.test.ts`, `apps/api/src/__tests__/services/permission-set.test.ts`.
- Edit (fixtures, gain `"org.write"`): every typed `CapabilityMap` fixture. Found by `grep -rln '"org.delete"'` plus type-check: in api `permission-loadset`, `permission-maps` and `organization.router` integration tests; in web `SettingsBilling`, `SubscriptionBilling.component`, `useCapabilities`, `SettingsDangerZone` tests, and any shared web capability fixture.

**Steps**

1. **Tests (spec Core: permission 2 cases; API unit: refusal phrase 1 case).** `CAPABILITY_PAIRS` gains `org.write ↔ write org`; `org`'s verbs include `write`; `permissionDenied("org.write", …)` reads "You don't have permission to edit the organization."; `permission-set.test.ts` asserts an owner `* *` set `can("org.write")` and a default member set can't. Run; fail.
2. **Implement** the four source edits. Rebuild core. Green.
3. **Sweep fixtures** until the full root `npm run build && npm run type-check` passes, then run the touched web and api unit suites plus `permission-maps` and `permission-loadset` integration (their full capability-map assertions gain the key).
4. Lint.

**Done when:** the capability map for an owner/admin carries `org.write: true` and a member `false`; full root build and type-check are green.

**Risk:** fixture churn across three packages; a partial web fixture mock (`[[project_web_partial_module_mocks]]`) that only fails in CI. The full root build is the gate, not a per-package type-check.

---

## Slice 3 — API: `StripeService.updateCustomerName` + `OrganizationUpdateService`

The locked update and the post-commit Stripe sync, as services with no route caller yet.

**Files**

- Edit: `apps/api/src/services/stripe.service.ts`: `updateCustomerName(customerId, name)`.
- New: `apps/api/src/services/organization-update.service.ts`: `apply` (one transaction: `SELECT … FOR UPDATE`, update only the present fields plus `updated`/`updatedBy`, `RETURNING`; 404 `ORGANIZATION_NOT_FOUND` for a missing or deleted org) and `syncStripeCustomerName` (no-op without a customer or config; warns and resolves on failure).
- Edit: `apps/api/src/__tests__/services/stripe.service.test.ts`.
- New: `apps/api/src/__tests__/services/organization-update.service.test.ts`.
- New: `apps/api/src/__tests__/__integration__/services/organization-update.service.integration.test.ts`, for `apply` against the real DB.

**Steps**

1. **Tests (spec API unit: Stripe 1 case, sync 3 cases).** `updateCustomerName` calls `customers.update(id, { name })`; sync with no customer → no call, Stripe not configured → no call, Stripe throws → `warn` logged and the promise resolves. Plus `apply` against the DB: a name-only patch leaves `defaultStationId` untouched and returns `previousName`; a station-only patch leaves the name; a deleted org → 404. Run; fail.
2. **Implement** both services. Green.
3. Lint + type-check (api).

**Done when:** the unit and `apply` integration cases pass; nothing routes to the service yet.

**Risk:** the `FOR UPDATE` read must run on the transaction's client, not the pool, or it locks nothing. The concurrency case in slice 4 is what proves it.

---

## Slice 4 — API: the `PATCH /api/organization/:id` rewrite

The route parses strictly, checks each present field's permission, writes through the service, then audits and syncs Stripe after commit.

**Files**

- Edit: `apps/api/src/routes/organization.router.ts`: the six steps in the spec's PATCH section; the `@openapi` block.
- Edit: `apps/api/src/config/swagger.config.ts`: register `OrganizationUpdateRequest` and `OrganizationUpdateResponse`.
- Edit: `apps/api/src/__tests__/config/route-authorization.map.ts`: the PATCH entry's `by`.
- Edit: `apps/api/src/__tests__/__integration__/routes/organization.router.integration.test.ts`, `apps/api/src/__tests__/__integration__/routes/same-org-access.authorization.integration.test.ts`.

**Steps**

1. **Tests (spec API integration, 16 cases + the agreement case).** Name-only as owner and admin → 200 with the station unchanged; member → 403 naming "edit the organization", row unchanged; member with a custom `write org` policy → 200; station-only as #690; both fields need both permissions; `{}`, unknown key, blank and 121-character names → `400 ORGANIZATION_INVALID_PAYLOAD`; another org's id → 404 before validation; one `org.update` audit row with `{field, from, to}` and the actor, none for an unchanged name; Stripe called once with a customer, 200 when it rejects; two concurrent renames each record the `from` they replaced. Agreement: `org.write` false → 403, true → 200. Run; fail.
2. **Implement** the route rewrite, OpenAPI and route-map entry. Green.
3. Run the route-map, OpenAPI and `invalid-request-code` guard tests (they should pass unchanged), then lint + type-check (api).

**Done when:** all PATCH cases pass; the `defaultStationId ?? null` clobber is gone; the guards are green.

**Risk:** Stripe must be mocked at the `StripeService` boundary in integration (no live call), and the audit/Stripe calls are `void`, so the tests wait for them (poll the audit row) rather than assuming they've landed when the response returns.

---

## Slice 5 — Web: SDK, `RenameOrganizationDialog`, Settings wiring

The Rename button on Settings → Organization and its dialog.

**Files**

- Edit: `apps/web/src/api/organizations.api.ts`: `update(orgId)` with `onPermissionDenied`.
- Edit: `apps/web/src/api/stations.api.ts`: `setDefault`'s response type → `OrganizationUpdateResponse`.
- New: `apps/web/src/components/RenameOrganizationDialog.component.tsx` (pure UI) and `apps/web/src/stories/RenameOrganizationDialog.component.stories.tsx`.
- Edit: `apps/web/src/views/Settings.view.tsx`: `renameMutation`, the `GatedButton`, dialog wiring with `reset()` on open and close.
- New: `apps/web/src/__tests__/RenameOrganizationDialog.test.tsx`.
- Edit: `apps/web/src/__tests__/SettingsView.test.tsx`.

**Steps**

1. **Tests (spec Web: dialog 15 cases, Settings 4 cases).** The full Dialog & Form Test Checklist with real Enter presses (no `fireEvent.submit`, R5), plus unchanged-name closes without `onSubmit` and a 121-character paste shows the limit error untruncated; Settings shows Rename with `org.write` true and hides it when false, a successful submit invalidates `organizations.root`, and a 403 shows in the dialog's FormAlert. Run; fail.
2. **Implement** the SDK entry, dialog, story and Settings wiring. Green.
3. Run the dialog-contract, action-gate, permission-denied-invalidation and toast guards; lint + type-check (web).

**Done when:** the 19 cases and the guards pass; a rename updates the header and switcher through the `organizations.root` invalidation.

**Risk:** the Settings snapshot changes for fixtures with `org.write: true`; update it only for the new button.

---

## Slice 6 — Activity summary + FAQ

The Activity tab reads a rename as a sentence, and Help documents the capability.

**Files**

- New: `apps/web/src/utils/audit-summary.util.ts` and `apps/web/src/__tests__/audit-summary.util.test.ts`.
- Edit: `apps/web/src/components/AuditLogActivity.component.tsx` and `apps/web/src/__tests__/AuditLogActivity.test.tsx`.
- Edit: `packages/core/src/content/faq.util.ts`: "How do I rename my organization?" before the delete entry.

**Steps**

1. **Tests (spec Web: summary 3 cases, Activity 1 case).** A name rename → `Renamed from "X" to "Y"`; a non-`name` field → null; another action → null; an `org.update` row renders the summary. Run; fail.
2. **Implement** the helper, the Action column's second line and the FAQ entry. Green; `faq.util.test.ts` and the permission-copy guards (the FAQ says "permission to edit the organization", not a role) pass.
3. Full root `npm run build && npm run type-check` (core content changed; the marketing site renders the FAQ), then lint.

**Done when:** all four cases, the FAQ test and the copy guards pass.

**Risk:** none beyond the copy guard.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Core update contract + `org.update` | contract/audit tests, strict + name-length guards |
| 2 | `write org` / `org.write` across core, api, web fixtures | permission + refusal tests, full root build |
| 3 | `updateCustomerName` + `OrganizationUpdateService` | api unit + `apply` integration |
| 4 | PATCH rewrite, OpenAPI, route map | 17 integration cases, route/OpenAPI guards |
| 5 | SDK, dialog, Settings Rename | 19 web cases, dialog/action-gate guards |
| 6 | Activity summary + FAQ | 4 web cases, FAQ + copy guards, full root build |

## Cross-slice notes

- **Core `dist`.** Slices 1, 2 and 6 change core; rebuild it before running api/web suites against it ([[project_stale_core_dist_after_branch_switch]]), and touch an api src file before any live probe ([[project_api_dev_server_stale_core]]).
- **Fixtures.** Slice 2 is the only slice that touches `CapabilityMap` fixtures; later slices add `org.write` to new fixtures they create.
- **Doc sync (same PR).** The FAQ is slice 6. `docs/` durable references don't describe the org PATCH; check `apps/api/README.md` and `packages/admin-cli/COMMANDS.md` for any claim that rename is CLI-only, and fix it in slice 6 if found. The glossary has no org-rename term, so it needs no change.
- **Follow-ups stay out.** Default-station auditing (#935) and the CLI's audit + Stripe gap (#936) are separate tickets; no slice touches the CLI.

## Next step

Once discovery, spec and plan are confirmed, implementation starts on `feat/907-org-rename` with slice 1, tests first, one commit per slice.
