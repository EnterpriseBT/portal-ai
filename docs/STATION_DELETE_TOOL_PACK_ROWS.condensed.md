# Station delete leaves tool pack rows live — Condensed design (#1064)

**Issue:** [EnterpriseBT/portal-ai#1064](https://github.com/EnterpriseBT/portal-ai/issues/1064) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `DELETE /api/stations/:id` soft-deletes the station with its view and connector attachments (#674), but not its tool pack rows. Every pack row outlives its station: 36 live `station_toolpacks` rows sit under deleted stations in a local DB, against 0 for `station_views` / `station_instances`. Readers scoped by station skip them. Readers keyed on the pack don't: `DELETE /api/toolpacks/:id` reports deleted stations in `affectedStationIds`. And the rows never get the `deleted` stamp a retention purge keys on (#442). The fix is `apps/api` only: the delete detaches packs, and a data migration retires the rows already left behind.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Station delete transaction | `apps/api/src/routes/station.router.ts:1091-1104` | `stationViews.softDeleteByStation`, `stationInstances.softDeleteByStation`, then `stations.softDelete`; no pack call |
| Detach-by-station helper (the model) | `apps/api/src/db/repositories/station-views.repository.ts:139` | `updateWhere(eq(stationId), { deleted, deletedBy })`, returns a count |
| Pack repository | `apps/api/src/db/repositories/station-toolpacks.repository.ts:41` | No `softDeleteByStation` |
| Pack delete cascade | `apps/api/src/routes/toolpacks.router.ts` (`DELETE /:id`) | Selects every live row for the pack, including rows under deleted stations |
| Latest migration | `apps/api/drizzle/0134_system-principal.sql` | The next one is 0135 |
| Data-migration test pattern | `apps/api/src/__tests__/__integration__/db/scrub-raw-db-job-errors.integration.test.ts` | Reads the `.sql`, runs it by statement breakpoint, asserts rows |

The station route is the only path that deletes a station (`stations.softDelete` has one caller).

## Decision — how the backfill stamps the rows it retires

- **A. Copy the station's own `deleted` / `deleted_by`.** The rows read as having died with their station, at the same time and by the same person, which is what the fixed delete writes from now on. No principal is invented, so `lint:migrations`' principal rule doesn't come into play.
- **B. `now()` and `portalai_system_id()`.** This records a repair rather than the original event, and misdates the deletion.

**Chosen: A.** It matches what the fixed route writes, keeps the audit trail true, and needs no `-- principal-literal-ok`. The migration is an `UPDATE … FROM stations` limited to live pack rows under deleted stations, so it is idempotent and a no-op on a clean database. No DDL, so no `destructive-ok`.

## Plan — 1 slice

**Files**
- Edit `apps/api/src/db/repositories/station-toolpacks.repository.ts`: add `softDeleteByStation(stationId, deletedBy, client)`, shaped like `stationViews`'.
- Edit `apps/api/src/routes/station.router.ts`: call it in the delete transaction beside the view and connector detaches; widen the #674 comment to name packs.
- New `apps/api/drizzle/0135_retire-deleted-station-toolpacks.sql` (`npm run db:generate -- --custom --name retire-deleted-station-toolpacks`), committed with `meta/_journal.json` and the `0135` snapshot.

**Tests** (`npm run test:integration -- --testPathPattern <file>` from `apps/api`)
- `src/__tests__/__integration__/routes/station.router.integration.test.ts`, `DELETE`: a station with two packs deleted → no live `station_toolpacks` row for it, each stamped with the caller as `deleted_by`. A pack row of another station is untouched.
- New `src/__tests__/__integration__/db/retire-deleted-station-toolpacks.integration.test.ts`:
  - A live pack row under a deleted station takes the station's `deleted` / `deleted_by`.
  - A row under a live station and an already-deleted row are untouched.
  - Running it twice changes nothing more.
- `npm run lint:migrations` passes.

## Smoke (manual, against your dev stack)

1. `npm run db:migrate` from `apps/api`, then `select count(*) from station_toolpacks x join stations s on s.id = x.station_id where s.deleted is not null and x.deleted is null` → 0. It was 36 before.
2. One of the retired rows: its `deleted` / `deleted_by` equal its station's.
3. Create a station with Data Query and Statistics in the app, then delete it from the station page → the same query stays 0, and its two rows carry your user id as `deleted_by`.
4. Attach a custom pack to a live station, delete a different station that had the same pack, then delete the pack (Tool Packs → Delete) → `affectedStationIds` in the response lists only the live station.
5. A live station's packs are unchanged by all of the above (station page lists the same packs).

## Out of scope

- Purging soft-deleted `station_toolpacks` rows: retention is #442's pattern and no table-specific purge exists for attachments.
- Filtering `DELETE /api/toolpacks/:id`'s lookup to live stations: with the delete fixed and the backfill run, no live pack row sits under a deleted station.
- #1063 (custom pack names and plan treatment).
