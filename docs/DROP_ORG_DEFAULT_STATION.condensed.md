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

- **Generated, one statement.** `npm run db:generate -- --name drop-org-default-station` → `0143_drop-org-default-station.sql` with `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "default_station_id";` and `-- destructive-ok: column unread since #1114 (PR #1117)` on the line above. Commit the `.sql`, `meta/_journal.json` and `meta/0143_snapshot.json` together. `IF EXISTS` (code review): a dev database synced with `db:push` after #1114 has already lost the column, and a failing 0143 would block every later migration there.
- **Release gate, which is the risk.** Prod is on v1.2.3 (2026-11-08), which doesn't include #1114. This PR merges to `main` only after a prod release carrying #1114 **without** this migration is live. If both land in one release, the migration drops the column while old prod tasks still select it, and every org read fails until the rollout ends. app-dev is fine once 8c438b41 has deployed (in progress at the time of writing).
- **Residency installs.** The Helm `pre-upgrade` hook migrates before pods roll, so the same rule applies to a customer upgrade. `deploy/helm/portalai/README.md` (Notes & caveats) carries this durably: upgrade through the #1114 release first. Skipping it fails org reads on old pods during the rollout, and an `--atomic` rollback lands the old image on a schema without the column. `docs/PROD_DEPLOY.runbook.md` step 1 now checks for such an ordering before every release.
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
- `git grep -n default_station_id -- ':!apps/api/drizzle' ':!docs'` finds only the Helm README's upgrade note (phase docs describe the column, so `docs/` is excluded).

## Smoke (manual, against your dev stack)

**Preflight.** `git checkout chore/1118-drop-org-default-station && git pull --ff-only`, then `npm run dev` (API :3001, web :3000), signed in as the e2e owner in `e2e-fixture`. No core rebuild is needed: no app code changed. `$DB` is `apps/api/.env`'s `DATABASE_URL`.

**Reset (to re-walk on a database that already ran 0143).** Recreate the column with values and forget 0143. The column has no FK, so any text works: `psql "$DB" -c "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_station_id text; UPDATE organizations SET default_station_id = 'st-legacy'; DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795569956037;"` (1795569956037 is 0143's journal `when`).

1. Before migrating, `psql "$DB" -Atc "SELECT count(*) FROM organizations WHERE default_station_id IS NOT NULL"` is above 0.
2. `cd apps/api && npm run db:migrate` logs `Migrations completed` with no error. `psql "$DB" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='organizations' AND column_name='default_station_id'"` is `0`. — backend
3. Run `npm run db:migrate` again: it completes and does nothing. Then, with `0143` forgotten but the column already gone (just the `DELETE` from Reset), migrate once more: `IF EXISTS` makes it a no-op, with no "column does not exist" error. — backend
4. `npm run lint:migrations` (repo root) passes, and 0143 counts as acknowledged destructive DDL. — backend
5. With no restart needed, load the Dashboard, Stations, a station's detail page and Settings → Organization. Each renders, with no 5xx in the API log or the network panel.
6. Settings → Organization: rename the org to "e2e-fixture smoke" and back. Both save, and Activity lists both renames.
7. On `/stations`, create "Smoke 1118" and delete it with its card's Delete button: the card disappears and no error shows.
8. Settings → Activity still renders past `Default station …` entries; they're audit metadata, not the column.
9. `npx portalai org create --env local --owner-email qa@portalsai.io --name "Smoke 1118" --json` returns `{"organizationId":…,"stationId":…}`, where `stationId` is that org's Administrate. Then `npx portalai org reset <id> --env local --yes` and `npx portalai org delete <id> --env local --yes` both exit 0. — backend
10. `git grep -n default_station_id -- ':!apps/api/drizzle' ':!docs'` prints only the Helm README's upgrade note (`deploy/helm/portalai/README.md`), which is documentation. No code or test names the column. — backend
11. The release gate: the PR's merge-gate row "prod release carrying #1114 (without this migration) is live" is checked only once GitHub → Releases shows a published release whose notes include #1117 but not #1119, and its `deploy-prod` run (including `verify-login`) is green. — manual

## Out of scope

- The `defaultStationId` refusal tests and the legacy Activity rendering (`audit-summary.util.ts`). Both stay: one guards the request contract, the other renders history.
- Anything else about the default station; #1114 did that.
