# Remove the org-wide default station — Plan

**This plan removes the default station test-first. Consumers go first (web, the admin CLI, then the API's internal writers) while the field still exists, so every slice compiles. Then the contract, model, capability and schema go in one slice. Content, CLAUDE.md and the regenerated spec close it out.**

Spec: `docs/REMOVE_DEFAULT_STATION.spec.md`. Discovery: `docs/REMOVE_DEFAULT_STATION.discovery.md`. Issue: #1114. It follows #1072 (favorites, merged), whose station-delete favorites sweep keeps relying on the station row lock this plan leaves in place.

There are six slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as a **commit on `feat/1114-remove-default-station`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly, per `feedback_use_npm_test_scripts`), passing `--testPathPattern` for the touched files:

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
cd packages/admin-cli && npm run test
```

Each slice:
1. write or adjust the failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. run `npm run lint && npm run type-check` in each touched package at the boundary;
5. move on to the next slice.

Sequencing rationale. Removing `defaultStationId` from core's `OrganizationSchema` breaks compilation everywhere it's still read. So every reader stops first, while the field still exists, and the field goes last:

- **Slice 1:** web stops reading or writing it. It's the biggest consumer and independent of the API.
- **Slice 2:** the admin CLI stops reading or writing it. It's independent.
- **Slice 3:** the API's internal writers stop: provisioning, station delete, reset and org delete. The PATCH contract still accepts the field.
- **Slice 4:** the contract, model, capability and Drizzle column definition go together, with the org router and `OrganizationUpdateService`. This is the only slice that changes a public contract.
- **Slice 5:** content and CLAUDE.md.
- **Slice 6:** swagger regeneration and a final sweep that nothing references the concept.

No migration: the `DROP COLUMN` is a follow-up PR (spec Key decision 1).

---

## Slice 1 — Web: no default anywhere

Remove every web surface and read of the default while core still has the field.

**Files**

- Edit: `apps/web/src/components/StationList.component.tsx`:
  - drop `isDefault`, `canSetDefault` and `onSetDefault`;
  - drop the "Set as default" action and the "Default" chip;
  - drop the `OrgData` wrapper in `StationListConnected`.
- Edit: `apps/web/src/views/Stations.view.tsx`: drop `DefaultStationMeta`, `onSetDefault`, the org read, `setDefault` and `handleSetDefault`.
- Edit: `apps/web/src/views/StationDetail.view.tsx`: drop the org read, `isDefaultStation`, the "Organization Default" row and the comment at 136.
- Edit: `apps/web/src/views/Dashboard.view.tsx`: drop the `DefaultStationMeta` import and render.
- Delete: `apps/web/src/components/DefaultStationMeta.component.tsx`, `src/__tests__/DefaultStationMeta.test.tsx`, and its `src/__tests__/durations.json` entry.
- Edit: `apps/web/src/components/CreatePortalDialog.component.tsx`: the picker starts empty; no `defaultStationId`, `orgDefaultStationId`, `OrgData` or render-time `setTimeout`.
- Edit: `apps/web/src/api/stations.api.ts`: drop `setDefault`.
- Edit: `apps/web/src/utils/delete-invalidation.util.ts`: `stationDeleteKeys()` drops `organizations.root` and the default bullet.
- Edit: `apps/web/src/utils/glossary-routes.util.ts`: drop "Default Station". It must go in the same slice as the glossary term or `glossary-routes`' test flags a missing term, so the core term removal lands here too (see the risk below).
- Edit: `apps/web/src/utils/audit-summary.util.ts`: comments only (legacy rendering).
- Edit tests:
  - `StationList.test.tsx`, `CreatePortalDialog.test.tsx`, `DashboardView.test.tsx`, `StationDetail.view.test.tsx`, the Stations view tests;
  - `api/stations.api.test.ts`, `delete-invalidation.util.test.ts`;
  - `OrgSwitcher.component.test.tsx` (the fixture field stays until slice 4 removes it from the model).

**Steps**

1. **Tests (spec web cases ≈12).**
   - Cards show no "Set as default" or "Default" chip, and the star and Delete remain, with no axe violations.
   - The New Portal picker starts empty, pressing Create with no pick shows "Station is required" and submits nothing (the form pattern), and submit sends the picked `stationId`, with no axe violations.
   - No "Default Station" or "Organization Default" text on the Dashboard, Stations or StationDetail.
   - `stations.api` has no `setDefault`, and `stationDeleteKeys()` excludes `organizations.root`.
   - `audit-summary` and `AuditLogActivity` still render legacy entries (unchanged, must pass).

   Run them and watch them fail.
2. **Implement** the removals. Green.
3. Lint and type-check in web. The guards must pass: component-axe, dialog-contract, action-gate, mutation-invalidate, permission-denied.

**Done when:** no web file outside `audit-summary.util.ts` and its tests reads `defaultStationId` or `station.default.set`, and the web suites pass.

**Risk:** the glossary route map and the core glossary term are coupled by a test. Remove the core term, its `relatedTerms` and FAQ 79's related term in this slice (rebuild core); slice 5 does the remaining FAQ wording.

---

## Slice 2 — Admin CLI: no `--default-station-id`

**Files**

- Edit: `packages/admin-cli/src/bin.ts`: drop the flag and the description wording.
- Edit: `src/commands/org.ts`: `validatePatch` takes name or timezone.
- Edit: `src/store.ts`: drop the station lookup, change detection and audit.
- Edit: `src/tables.ts`: drop the column mirror and comment.
- Edit tests: `src/__tests__/store.test.ts`, `commands.test.ts`, `tables-parity.test.ts`, and `helpers/test-db.ts` (drop `default_station_id` from the raw DDL).
- Edit: `COMMANDS.md` (the `org update` section) and `README.md:63`.

**Steps**

1. **Tests (spec admin-cli ≈3).** `org update --default-station-id x` exits 2; name and timezone patches are unchanged; the default cases are removed; table parity holds. Run them and watch them fail.
2. **Implement.** Green.
3. Lint, type-check and test in the admin CLI. Rebuild it (`npx portalai` runs `dist/`).

**Done when:** the admin-cli suites pass, and `org update --help` doesn't list the flag.

**Risk:** `tables-parity` compares the CLI's mirror with the API's Drizzle table. The API column definition is still there until slice 4, so check whether the parity test tolerates a mirror that's narrower than the table. If it doesn't, move the `tables.ts` change to slice 4.

---

## Slice 3 — API: stop writing the default internally

Provisioning, station delete, reset and org delete stop touching the column. The PATCH contract still accepts the field, so nothing public changes yet.

**Files**

- Edit: `apps/api/src/constants/provisioned-stations.constants.ts`: drop `isDefault`.
- Edit: `src/services/application.service.ts`: drop the default capture, the org update and the log field; fix the doc comments.
- Edit: `src/db/create-org.ts`: `stationId` is the system-created "Administrate" station's id.
- Edit: `src/routes/station.router.ts`: the DELETE drops the org clear, the cleared-name return and the default audit; keep `findByIdForUpdate`, with its comment updated.
- Edit: `src/services/reset.service.ts` and `src/services/organization-delete.service.ts`: drop the default nulling.
- Edit tests:
  - unit: `constants/provisioned-stations.constants.test.ts`, `services/application.provision.test.ts`;
  - integration: `services/application.service`, `provisioned-stations`, `demo-create`, `reset.service`, `organization-delete`, `routes/station.router`, and `utils/seed-populated-org.util.ts:100`.

**Steps**

1. **Tests (spec API integration: station delete ≈2, provisioning ≈3, reset and org delete ≈2 of the ≈3, create-org ≈1; API unit: provisioned stations and provision ≈2).**
   - A new org gets Administrate and Playground, and its `default_station_id` stays null.
   - A station delete writes no `org.update` audit and leaves the org row's `updated` unchanged, and the favorites sweep still holds.
   - Reset and org delete pass with a stale `default_station_id` set by SQL.
   - `create-org` prints Administrate's id.

   Run them and watch them fail.
2. **Implement.** Green.
3. Lint and type-check in the API. Re-run the existing org, station, provisioning, reset and org-delete suites.

**Done when:** no API code writes `default_station_id` outside the org PATCH, which slice 4 removes.

**Risk:** `OrganizationUpdateService.auditDefaultStationChange` still exists (the org router uses it) until slice 4. Only the station router's call goes here.

---

## Slice 4 — Contract, model, capability and column definition

The field leaves core and the API in one compile unit.

**Files**

- Edit, core: `models/organization.model.ts` (drop the field), `contracts/organization.contract.ts` (`{ name }` required, strict, no refine), `models/permission.model.ts` (drop `station.default.set`), `models/audit-log.model.ts` (the comment marks it legacy).
- Edit, core tests: `contracts/organization.contract.test.ts`, `models/permission.model.test.ts`.
- Edit, API:
  - `db/schema/organizations.table.ts` (drop the column definition; **do not run `db:generate`**);
  - `db/schema/type-checks.ts` (compiles as is);
  - `routes/organization.router.ts` (rename-only handler and `@openapi`);
  - `services/organization-update.service.ts` (rename-only `apply`; drop the options and `auditDefaultStationChange`);
  - `services/permission.service.ts` (drop `DERIVED_CAPABILITIES`, `DerivedCapability` and `isDerived`);
  - `__tests__/config/route-authorization.map.ts:582` (the `by:` text).
- Edit, API tests:
  - unit: `services/organization-update.service.test.ts`;
  - integration: `routes/organization.router`, `.rename`, `same-org-access.authorization`, `services/organization-update`, `permission-loadset`.
- Edit, web: `OrgSwitcher.component.test.tsx` and any typed org fixture still carrying the field (type-check flags them).

**Steps**

1. **Tests (spec core contract ≈4 + capability ≈1; API org router ≈5; organization-update and permission ≈3 + the unit ≈1).**
   - PATCH `{name}` works and audits as before.
   - PATCH with `defaultStationId` returns `400 ORGANIZATION_INVALID_PAYLOAD` with the key in `details.issues` (the message names it when a `name` is sent too), and `{}` returns 400.
   - The GET has no `defaultStationId` and no `station.default.set`.
   - The capability map is built from `set.can` for every action.

   Run them and watch them fail.
2. **Implement.** Rebuild core (`npm run build --workspace=packages/core`), then the API changes. Green.
3. Lint and type-check in core, the API and web. Run the full root `npm run build`, since a core model change ripples into web and site fixtures (`feedback_core_model_change_run_full_build`).

**Done when:** `grep -rn "defaultStationId\|default_station_id\|station.default.set"` over `src` trees finds only the audit-log comment, `audit-summary.util.ts` and its tests, and past migrations.

**Risk:** `drizzle-kit` sees the dropped definition as pending. Don't generate here; the follow-up PR does. `lint:migrations` is unaffected because no migration is added.

---

## Slice 5 — Content and CLAUDE.md

**Files**

- Edit: `packages/core/src/content/faq.util.ts`: lines 85 and 374 name Administrate without "default", and line 291 drops "a new default station".
- Edit: `faq.util.test.ts` (lines 384-400) and `glossary.util.test.ts` (lines 95 and 521-522; the term itself went in slice 1).
- Edit: `CLAUDE.md`: line 328 (station delete drops `organizations.root`) and line 343 (the derived-capability bullet is rewritten).

**Steps**

1. **Tests (spec content ≈3).** No "Default Station" anywhere in the glossary or FAQ, and the FAQ answers name Administrate without "default". Run them and watch them fail.
2. **Implement.** Green.
3. Lint and type-check in core. The permission-copy guards (API and web) pass.

**Done when:** the content suites and permission-copy guards pass.

**Risk:** none.

---

## Slice 6 — Regenerate swagger and sweep

**Files**

- `apps/api/swagger.json` is generated and git-ignored: run `npm run swagger:generate` in `apps/api` to confirm the output, and commit nothing for it.
- Edit: `apps/api/src/services/billing.service.ts:551` (the comment) and any stray comment the final grep finds.

**Steps**

1. **Tests.** The repo's swagger and OpenAPI guard tests (unit) pass against the regenerated file. A final `grep` over every package's `src`, `docs/` (durable) and `CLAUDE.md` finds no default-station reference outside the allowed set: the audit-log legacy comment, `audit-summary.util.ts` and its tests, past migrations, and this ticket's phase docs.
2. **Implement** the regeneration and comment fixes.
3. Lint and type-check across touched packages. Run the integration suites touched in slices 3–4 once more.

**Done when:** the generated spec mentions `defaultStationId` only as retired, and the sweep is clean.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Web removals, plus the glossary term and route entry | web units + guards |
| 2 | Admin CLI flag removal | admin-cli suites |
| 3 | API internal writers stop (provisioning, delete, reset, org delete, create-org) | API integration |
| 4 | Contract, model, capability and column definition; rename-only PATCH | core + API + full build |
| 5 | FAQ wording, CLAUDE.md | content + permission-copy guards |
| 6 | Swagger regeneration + sweep | swagger guard + grep |

## Cross-slice notes

- **The field goes last.** Slices 1–3 must not remove `defaultStationId` from the model, or the packages that still read it stop compiling. Slice 4 is where the type checker proves no reader is left.
- **No migration in this PR.** Never run `db:generate` on this branch; it would emit the `DROP COLUMN` the follow-up owns. File the follow-up ticket when this PR is up.
- **Rebuilds.** Core changes in slices 1 and 4–5 need `npm run build --workspace=packages/core` before API or web runs. The admin CLI is rebuilt in slice 2 for `npx portalai` checks. Restart the API dev server for live checks, since nodemon doesn't watch core.
- **Invalidation.** Only `stationDeleteKeys()` changes. No other mutation's keys reference the default.
- **Docs in sync.** The glossary term goes in slice 1, the FAQ in slice 5, CLAUDE.md in slice 5, the admin CLI docs in slice 2, and swagger in slice 6. No marketing-site, e2e or durable `docs/` references exist (per the survey).
- **The station delete keeps its row lock** (`findByIdForUpdate`) for #1072's favorites sweep. Only its comment changes.

## Next step

Implementation starts on `feat/1114-remove-default-station` with slice 1, tests first, one commit per slice, once this plan is confirmed.
