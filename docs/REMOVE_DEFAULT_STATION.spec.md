# Remove the org-wide default station — Spec

This pins the removal of the org-wide default station from core, the API, web, the admin CLI and Help. Discovery: `docs/REMOVE_DEFAULT_STATION.discovery.md`. Issue: [#1114](https://github.com/EnterpriseBT/portal-ai/issues/1114).

## Key decisions (flag for review)

1. **Expand/contract.** This PR removes every reader and writer and the Drizzle column definition. `organizations.default_station_id` stays in the database, unread, for one release, so old API tasks keep working while a deploy rolls out. A follow-up PR drops it (`-- destructive-ok`). The ticket was amended to match.
2. **`PATCH /api/organization/:id` becomes rename-only.** `name` is required, the either/or refine goes, and `.strict()` makes a `defaultStationId` key `400 ORGANIZATION_INVALID_PAYLOAD` naming it.
3. **The derived-capability mechanism goes with its only entry.** `station.default.set` leaves `CALLER_CAPABILITY_ACTIONS`, and `DERIVED_CAPABILITIES`, `isDerived` and its branch leave `permission.service.ts`.
4. **Past Activity stays readable.** `org.update` entries with `{ field: "defaultStationId", … }` keep rendering through `audit-summary.util.ts`, documented as legacy. Nothing writes new ones.
5. **The New Portal picker starts empty.** No preselection, and no new `stationId` prop, since no station page opens the dialog (StationDetail creates portals directly).
6. **`portalai org create --json` keeps `{ organizationId, stationId }`.** `stationId` is now Administrate's id, looked up explicitly.
7. **A station delete no longer touches the org.** There's no clear, no org-row lock and no audit entry, and `stationDeleteKeys()` drops `organizations.root`.

## Scope

### In scope
- Core: the organization model and PATCH contract, the capability list, and the audit-model comment.
- API:
  - the org router, `OrganizationUpdateService`, the station-delete path and permission service;
  - provisioning and `create-org`, and reset and org delete;
  - the Drizzle column definition and type checks;
  - the route map text and the regenerated swagger.
- Web: station cards, the Stations view, StationDetail, `DefaultStationMeta`, the Dashboard, `CreatePortalDialog`, the SDK, delete invalidation and glossary routes.
- Admin CLI: `org update`, the store, tables, `COMMANDS.md` and `README.md`.
- Content: the glossary, FAQ, and two CLAUDE.md lines.

### Out of scope
- The `DROP COLUMN` migration (the follow-up PR).
- Dashboard replacement content.
- Smart picker preselection.
- Changes to Administrate or Playground beyond the default marker.

## Surface

### Core — `packages/core/src/models/organization.model.ts`
Remove `defaultStationId` (line 16) from `OrganizationSchema`. GET and PATCH organization payloads no longer carry it.

### Core — `packages/core/src/contracts/organization.contract.ts:101-114`
```ts
/** Request body for PATCH /api/organization/:id (#907): rename. Needs `org.write`. */
export const OrganizationUpdateRequestSchema = z
  .object({ name: organizationNameField() })
  .strict();
```
The `.refine` and its message go.

### Core — `packages/core/src/models/permission.model.ts:160-173`
Remove `"station.default.set"` and its comment from `CALLER_CAPABILITY_ACTIONS`. The org GET's `capabilities` map loses that key.

### Core — `packages/core/src/models/audit-log.model.ts:27-29`
The comment keeps describing `{ field: "defaultStationId", from, to, fromName, toName }`, marked as **legacy entries only (#1114)**. The action enum is unchanged.

### API — `apps/api/src/db/schema/organizations.table.ts:27`
Remove `defaultStationId: text("default_station_id")`, and keep the bidirectional checks in `type-checks.ts:175,179` compiling with model and table in step. **No migration is generated in this PR.** `npm run db:generate` would emit a `DROP COLUMN`, and that's the follow-up's job. `lint:migrations` is unaffected.

### API — `apps/api/src/routes/organization.router.ts:140-316`
- **The handler:**
  - parses `OrganizationUpdateRequestSchema` and checks `org.write`;
  - calls `OrganizationUpdateService.apply(orgId, { name }, userId)` with no options;
  - audits a changed name exactly as today (#907/#936).
- **Removed:** the destructure of `defaultStationId`, the class `write station` check (236-240), `assertStation` and `beforeWrite` (247-280), and the default audit (302-316).
- **Docs:** the `@openapi` block describes a rename body (`name` required), and the 400 example names an unknown key.

### API — `apps/api/src/services/organization-update.service.ts`
```ts
export interface OrganizationUpdatePatch { name: string }
export interface OrganizationUpdateResult { organization: Organization; previousName: string }
static async apply(orgId: string, patch: OrganizationUpdatePatch, userId: string): Promise<OrganizationUpdateResult>
```
Remove `OrganizationUpdateOptions`/`beforeWrite`, the previous-default lookup (46-50, 81-101) and `auditDefaultStationChange` (105-130). The row lock, the unchanged-value no-op and `404 ORGANIZATION_NOT_FOUND` stay.

### API — `apps/api/src/routes/station.router.ts:1205-1290` (DELETE)
Remove the org `updateWhere` clear (1217-1227), the cleared-name return (1271) and the post-commit `auditDefaultStationChange` (1278-1288). `findByIdForUpdate` (1211-1215) stays: it locks the station row that #1072's favorites sweep relies on. Its comment now says so instead of naming #935.

### API — `apps/api/src/services/permission.service.ts:92-131, 226-228`
Remove `DERIVED_CAPABILITIES`, `DerivedCapability` and `isDerived`. The capability builder maps every `CALLER_CAPABILITY_ACTIONS` entry through `set.can(action)`.

### API — provisioning
- `constants/provisioned-stations.constants.ts`: remove `isDefault` from `ProvisionedStation` and both entries.
- `services/application.service.ts:965-1021`:
  - remove `defaultStationId`, `if (provisioned.isDefault)` and the org update (1009-1013);
  - log `stationIds` only;
  - doc comments at 518, 881-883 and 904 stop calling Administrate "the default".
- `db/create-org.ts:35-41`: after provisioning, read the org's live station named `PROVISIONED_STATIONS[0].name` ("Administrate") with `createdBy = SystemUtilities.id.system`, and print `{ organizationId, stationId: <that id> | null }`.

### API — reset and org delete
- `services/reset.service.ts:215-219, 293`: remove the default-nulling update.
- `services/organization-delete.service.ts:232-236`: remove the "break the cycle" update. There's no FK, so nothing depends on it.

### API — docs and guards
- `__tests__/config/route-authorization.map.ts:582`: the PATCH `by:` reads "org scope + `org.write` (rename)".
- `apps/api/swagger.json`: regenerated with `npm run swagger:generate`.

### Web — `apps/web/src/components/StationList.component.tsx`
- `StationCardUI` loses `isDefault`, `canSetDefault` and `onSetDefault`, the "Set as default" action and the "Default" chip row.
- `StationListUI` loses `defaultStationId`, `canSetDefault` and `onSetDefault`.
- `StationListConnected` loses `onSetDefault` and the `OrgData` wrapper (its only use was the default and the capability).
- Cards keep their favorite star, Delete, tool packs and tags.

### Web — views and components
- **`views/Stations.view.tsx`:**
  - remove the `DefaultStationMeta` header child;
  - remove `onSetDefault` from `StationsViewUIProps`;
  - remove the `sdk.organizations.current()` read, `sdk.stations.setDefault` and `handleSetDefault`.
- **`views/StationDetail.view.tsx`:** remove `sdk.organizations.current()` (94-96), `isDefaultStation` (103), the "Organization Default" metadata row (311-314) and the comment at 136.
- **`components/DefaultStationMeta.component.tsx`:** deleted, along with its test and its uses in `views/Dashboard.view.tsx:18,58` and `Stations.view.tsx`.
- **`components/CreatePortalDialog.component.tsx`:**
  - `StationPicker` loses `defaultStationId`, and its selection is `selected` only;
  - the dialog loses `orgDefaultStationId`, the `OrgData` wrapper and the render-time `setTimeout`;
  - it submits `stationId` only. Create with no pick shows "Station is required" on the field and submits nothing (the Form & Dialog Pattern's validate-on-submit).
- **`api/stations.api.ts:54-62`:** remove `setDefault`.
- **`utils/delete-invalidation.util.ts`:** `stationDeleteKeys()` drops `queryKeys.organizations.root`, and the comment drops the default bullet.
- **`utils/glossary-routes.util.ts:55`:** remove the "Default Station" entry.
- **`utils/audit-summary.util.ts`:** unchanged code. Comments mark `defaultStationSummary` as rendering legacy entries (#1114).

### Admin CLI — `packages/admin-cli`
- `src/bin.ts:171-186`: `org update` loses `--default-station-id`, and its description says "patch name/timezone". Passing the flag is a commander usage error (exit 2).
- `src/commands/org.ts:63-76`: `validatePatch` requires `name` or `timezone`, and the error message changes to match.
- `src/store.ts`:
  - the patch type is `Pick<…, "name" | "timezone">`;
  - remove the station lookup and `ADMIN_NOT_FOUND` path (206-231), the default change detection (241-247) and its audit entry (260-268).
- `src/tables.ts:30`: remove the column mirror.
- `COMMANDS.md:50-56` and `README.md:63`: `org create` returns Administrate's id as `stationId`, and the default-station bullets go.

### Content — `packages/core/src/content`
- **`glossary.util.ts`:** remove the "Default Station" term (555-562) and the `relatedTerms` entries at 277 (Station), 406 (Pinned Result) and 471 (Organization).
- **`faq.util.ts`:**
  - line 79: remove the "Default Station" related term;
  - lines 85 and 374: "A new organization's Administrate station…" (no "default");
  - line 291: remove "a new default station" from the Activity list.

### CLAUDE.md
- **Line 328:** "Station delete → …" drops `organizations.root` and its parenthetical.
- **Line 343:** the derived-capability bullet is rewritten: an action whose route checks an unconditional class grant reads that grant with `can(<action>)` from the caller's capabilities, and record actions follow the entity's `capabilities.write` (#829). There is no `DERIVED_CAPABILITIES` example.

## Migration
None in this PR (Key decision 1). The follow-up PR runs `npm run db:generate -- --name drop-org-default-station`, with `-- destructive-ok: column unread since #1114`.

## Seed
None.

## TDD test plan

Run per package: `cd packages/core && npm run test:unit`, `cd apps/api && npm run test:unit && npm run test:integration`, `cd apps/web && npm run test:unit`, `cd packages/admin-cli && npm run test` (each with `--testPathPattern` locally).

### Core
- **`__tests__/contracts/organization.contract.test.ts`:** `{name}` passes; `{}` fails; `{defaultStationId}` fails as an unknown key; `{name, defaultStationId}` fails as an unknown key. ≈ 4
- **`__tests__/models/permission.model.test.ts:540`:** `CALLER_CAPABILITY_ACTIONS` doesn't include `station.default.set`. ≈ 1
- **`__tests__/content/glossary.util.test.ts`, `faq.util.test.ts`:** no "Default Station" term or reference; the FAQ answers name Administrate without "default". ≈ 3

### API integration
- **`routes/organization.router.integration.test.ts` and `.rename.integration.test.ts`:**
  - rename works and audits as before;
  - a `defaultStationId` body is `400 ORGANIZATION_INVALID_PAYLOAD` naming it, with nothing written;
  - `{}` is a 400;
  - the GET has no `defaultStationId` and no `station.default.set` capability.

  The old default cases are removed. ≈ 5
- **`routes/station.router.integration.test.ts`:** deleting a station writes no `org.update` audit entry and doesn't touch the org row's `updated`. The favorites sweep still holds. ≈ 2
- **`services/application.service`, `provisioned-stations`, `demo-create`:** a new org gets Administrate and Playground; nothing reads `default_station_id`. ≈ 3
- **`services/organization-update`, `reset.service`, `organization-delete`, `permission-loadset`, `same-org-access`:** default expectations are removed. Reset and delete pass with the column holding a stale value (set by SQL), which proves nothing reads it. ≈ 3
- **`db/create-org` (or `application.provision`):** `stationId` is Administrate's id. ≈ 1

### API unit
- **`services/organization-update.service.test.ts`:** rename-only patch. **`constants/provisioned-stations.constants.test.ts`:** no `isDefault`, and Administrate comes first. **`services/application.provision.test.ts`:** no default write. ≈ 4

### Web unit
- **`StationList.test.tsx`:** no "Set as default" or "Default" chip; the star and Delete remain; axe passes. ≈ 3
- **`CreatePortalDialog.test.tsx`:** the picker starts empty; Create with no pick shows "Station is required" and doesn't submit; submit sends the picked `stationId`; axe passes. ≈ 4
- **`DashboardView.test.tsx`, `StationDetail.view.test.tsx`, `Stations` view tests:** no "Default Station" or "Organization Default" text. ≈ 3
- **`api/stations.api.test.ts`:** no `setDefault`. **`delete-invalidation.util.test.ts`:** no `organizations.root`. ≈ 2
- **`audit-summary.util.test.ts`, `AuditLogActivity.test.tsx`:** legacy entries still render (unchanged; must pass). ≈ 0 new
- **`DefaultStationMeta.test.tsx`:** deleted, and its `durations.json` entry removed. `OrgSwitcher.component.test.tsx` loses the fixture field.

### Admin CLI
- **`store.test.ts`, `commands.test.ts`:**
  - `org update --default-station-id x` is a usage error (exit 2);
  - name and timezone patches are unchanged;
  - default-station cases are removed.

  `tables-parity.test.ts` passes without the column mirror (`helpers/test-db.ts` drops `default_station_id`). ≈ 3

**Totals ≈ 41 cases (most are edits or removals of existing tests).**

## Acceptance criteria
- [ ] No web surface offers, shows or names a default station: station cards, StationDetail, the Dashboard, the Stations header, the New Portal dialog and Help.
- [ ] The New Portal dialog opens with no station selected, Create can't submit until one is picked (it says "Station is required"), and the portal is created on the picked station.
- [ ] `PATCH /api/organization/:id` with `defaultStationId` answers `400 ORGANIZATION_INVALID_PAYLOAD` naming it, and `GET /api/organization/current` carries no `defaultStationId` and no `station.default.set`.
- [ ] A new org gets Administrate and Playground, and `portalai org create --json` returns `{ organizationId, stationId: <Administrate> }`.
- [ ] Deleting any station works and writes no default-change audit entry.
- [ ] Settings → Activity still renders past default-station changes.
- [ ] `portalai org update --default-station-id …` exits 2.
- [ ] No code reads or writes `default_station_id` or `station.default.set`, outside past migrations, the audit-log reader and its tests. The column remains in the database.

## Risks & rollback
- **Rolling deploy.** Old tasks still read the column, which is still present, so the rollout is safe. New tasks never select it.
- **Stale clients.** A cached web build sending `defaultStationId` gets a clear 400, and there's no silent data loss. The SPA is redeployed with the API.
- **Rollback.** Revert the PR. The column was never dropped, so the old code works unchanged, with values as of the deploy (station deletes no longer cleared them in the meantime, which the old code tolerates: a dangling id already rendered nothing).

## Files touched
- **Core:** `models/organization.model.ts`, `contracts/organization.contract.ts`, `models/permission.model.ts`, `models/audit-log.model.ts`, `content/glossary.util.ts`, `content/faq.util.ts`, and their tests.
- **API:**
  - `db/schema/organizations.table.ts`, `db/schema/type-checks.ts`;
  - `routes/organization.router.ts`, `routes/station.router.ts`;
  - `services/organization-update.service.ts`, `services/permission.service.ts`, `services/application.service.ts`, `services/reset.service.ts`, `services/organization-delete.service.ts`;
  - `constants/provisioned-stations.constants.ts`, `db/create-org.ts`;
  - `__tests__/config/route-authorization.map.ts`, `swagger.json`;
  - the tests listed above.
- **Web:**
  - `components/StationList.component.tsx`, `components/CreatePortalDialog.component.tsx`, `components/DefaultStationMeta.component.tsx` (delete);
  - `views/Stations.view.tsx`, `views/StationDetail.view.tsx`, `views/Dashboard.view.tsx`;
  - `api/stations.api.ts`, `utils/delete-invalidation.util.ts`, `utils/glossary-routes.util.ts`, `utils/audit-summary.util.ts` (comments);
  - the tests listed above and `src/__tests__/durations.json`.
- **Admin CLI:** `src/bin.ts`, `src/commands/org.ts`, `src/store.ts`, `src/tables.ts`, `src/__tests__/*`, `COMMANDS.md`, `README.md`.
- **Repo:** `CLAUDE.md` (lines 328, 343).

## Next step
`docs/REMOVE_DEFAULT_STATION.plan.md` sequences this into about five slices on `feat/1114-remove-default-station`:
1. core plus the API (contract, capability, router, services, provisioning, schema), which must move together for type-check;
2. web;
3. the admin CLI;
4. content and CLAUDE.md;
5. the swagger regeneration and a final sweep that nothing references `defaultStationId`.
