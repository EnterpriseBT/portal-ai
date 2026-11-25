# Drop organizations.default_station_id — Condensed design (#1118)

**Issue:** [EnterpriseBT/portal-ai#1118](https://github.com/EnterpriseBT/portal-ai/issues/1118) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #1114 (PR #1117, 8c438b41) removed the default station from every reader and writer but left the column in place for one release. That's the expand half of expand/contract: `db:upgrade` migrates before new ECS tasks replace old ones, and old tasks select the column by name. This is the contract half: drop the column, and drop the test scaffolding that kept proving nothing read it. Packages: `apps/api` (migration, tests), plus one admin-cli test helper.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The column | `apps/api/drizzle/0024_add_stations_portals_tools.sql:100` | Plain `text`: no FK, no index (checked in `meta/0142_snapshot.json`) |
| Drizzle definition | `apps/api/src/db/schema/organizations.table.ts` | Already gone (#1114), so `db:generate` emits the `DROP COLUMN` from the 0142 snapshot diff |
| Migration guard | `scripts/check-migrations.mjs` | Destructive DDL in a new migration needs `-- destructive-ok: <reason>` |
| Fixture that sets the column | `__tests__/__integration__/utils/seed-populated-org.util.ts:98-102` | Raw-SQL `UPDATE … SET default_station_id` |
| Tests that read or set it | `station.router.integration.test.ts:1568-1596`, `application.service.integration.test.ts:281-283`, `provisioned-stations.integration.test.ts:160-162`, `reset.service.integration.test.ts:296,329-334` | "Left alone" / "stays NULL" assertions |
| admin-cli | `packages/admin-cli/src/__tests__/helpers/test-db.ts:24` (DDL), `store.test.ts:232-243` ("leaves a stale default_station_id alone") | pglite schema mirror |

The camelCase `defaultStationId` references stay. They're tests that the strict org PATCH refuses the retired key (core contract test, org rename and same-org authorization suites) and comments recording #1114. They test the request contract, not the column.

## Decision — drop now, merge after #1114 is live in prod

- **Generated, one statement.** `npm run db:generate -- --name drop-org-default-station` → `0143_drop-org-default-station.sql` with `ALTER TABLE "organizations" DROP COLUMN "default_station_id";` and `-- destructive-ok: column unread since #1114 (PR #1117)` on the line above. Commit the `.sql`, `meta/_journal.json` and `meta/0143_snapshot.json` together. No `IF EXISTS`: the column exists on every install that ran 0024.
- **Release gate, which is the risk.** Prod is on v1.2.3 (2026-11-08), which doesn't include #1114. This PR merges to `main` only after a prod release carrying #1114 **without** this migration is live. If both land in one release, the migration drops the column while old prod tasks still select it, and every org read fails until the rollout ends. app-dev is fine once 8c438b41 has deployed (in progress at the time of writing).
- **Residency installs.** The Helm `pre-upgrade` hook migrates before pods roll, so the same rule applies to a customer upgrade. The release notes for the version carrying this migration say: upgrade through the #1114 release first, or expect org reads on old pods to fail until the rollout completes.
- **Rollback.** Forward-only. Reverting the code after this ships needs no column, since nothing reads it. Restoring the column would be a new forward migration, and none is planned.

## Plan — 1 slice

**Files**
- New: `apps/api/drizzle/0143_drop-org-default-station.sql`, `meta/0143_snapshot.json`; edit `meta/_journal.json`.
- Edit: `seed-populated-org.util.ts` (drop the `UPDATE`); `station.router.integration.test.ts` (the station-delete test no longer seeds or reads the column; the delete and audit assertions stay); `application.service.integration.test.ts`, `provisioned-stations.integration.test.ts` (drop the NULL checks); `reset.service.integration.test.ts` (drop the control-org column check, reword the case-6 comment).
- Edit: `packages/admin-cli/src/__tests__/helpers/test-db.ts` (drop the column from the DDL); `store.test.ts` (drop the "stale value" test).

**Tests** (npm scripts only)
- `cd apps/api && npm run db:migrate` applies 0143 locally, where e2e-fixture's row still holds a value.
- `npm run lint:migrations` (root) passes with the reason.
- `cd apps/api && npm run test:integration -- --testPathPattern "station.router|application.service|provisioned-stations|reset.service|organization-delete"`; the integration CI run migrates a fresh database through 0143.
- `cd packages/admin-cli && npm run test`.
- `git grep -n default_station_id -- ':!apps/api/drizzle'` is empty.

## Smoke (manual, against your dev stack)

1. Before migrating: `SELECT default_station_id FROM organizations WHERE default_station_id IS NOT NULL LIMIT 3;` shows rows with values (e2e-fixture has one).
2. `cd apps/api && npm run db:migrate`: it applies `0143_drop-org-default-station` with no error. `\d organizations` no longer lists `default_station_id`.
3. Restart the API. Sign in, then load the Dashboard, Stations, a station's detail page and Settings → Organization: each renders, with no 5xx in the API log.
4. Settings → Organization: rename the org and back. Both save.
5. Delete a throwaway station from `/stations`: it disappears with no error.
6. `npx portalai org create --env local --owner-email qa@portalsai.io --name "Smoke 1118" --json` returns `{organizationId, stationId}` (Administrate). Then `npx portalai org reset <id> --env local --yes` and `npx portalai org delete <id> --env local --yes` both exit 0.
7. Settings → Activity still renders past "Default station …" entries; those are audit metadata, not the column.

## Out of scope

- The `defaultStationId` refusal tests and the legacy Activity rendering (`audit-summary.util.ts`). Both stay: one guards the request contract, the other renders history.
- Anything else about the default station; #1114 did that.
