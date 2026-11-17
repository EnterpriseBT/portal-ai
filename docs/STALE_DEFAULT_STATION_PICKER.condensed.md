# Stale default-station picker after a delete — Condensed design (#1041)

**Issue:** [EnterpriseBT/portal-ai#1041](https://github.com/EnterpriseBT/portal-ai/issues/1041) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Deleting an organization's default station from the station's own page leaves the Stations page showing "Station not found" under "Default Station" until a reload. The server clears the default correctly; the web app doesn't refresh the organization, so it keeps asking for a station that is gone. `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Server clears the default | `apps/api/src/routes/station.router.ts:926-932` | Same request as the delete. Correct. |
| Delete from the Stations page | `apps/web/src/views/Stations.view.tsx:159-170` | Refreshes `stations`, `portals`, `portalResults` **and `organizations`** |
| Delete from the station's page | `apps/web/src/views/StationDetail.view.tsx:122-129` | Refreshes `stations`, `portals`, `portalResults`. **No `organizations`.** Then navigates to `/stations` |
| The picker | `apps/web/src/components/DefaultStationMeta.component.tsx:22,50-59` | Reads the cached org's `defaultStationId` and fetches that station; a 404 renders as "Station not found" |
| The dashboard card | `apps/web/src/components/DefaultStationCard.component.tsx:167-180` | Same pattern: cached org id, then a station fetch |
| Shared delete key lists | `apps/web/src/utils/delete-invalidation.util.ts` | Exists for connector and entity deletes (#802), with a test that the views call it. Nothing for stations |
| The documented list | `CLAUDE.md:311` | "Station delete → `stations.root`, `portals.root`, `portalResults.root`". No organization |

The ticket guessed at a refetch-ordering race. The cause is simpler: the two delete call sites carry hand-copied key lists that drifted, and the station page's copy never refreshes the organization. After its delete the app navigates to `/stations` with the old `defaultStationId` still cached, so the picker's fetch 404s and stays that way. The two 404s the ticket recorded are the station page's own query refetching (with `include`) and the picker's (without).

## Decision — where the missing refresh goes

- **A. Add `organizations.root` to the station page's list.** One line. Leaves two hand-copied lists, which is how this happened.
- **B. One `stationDeleteKeys()` in `delete-invalidation.util.ts`, used by both views.** Same pattern as the connector and entity deletes, with the same source-level test that each view calls it.
- **C. Have the picker and the dashboard card treat a 404 as "no default".** Hides a stale id instead of refreshing it.

**Decided: B.** The list lives once: `stations.root`, `portals.root`, `portalResults.root`, `organizations.root`. `CLAUDE.md`'s list gains the organization. C is not part of the fix; see Out of scope.

## Plan — one slice

**Files**
- Edit: `apps/web/src/utils/delete-invalidation.util.ts` — add `stationDeleteKeys()` with a comment saying why the organization is in it (its default may have been this station).
- Edit: `apps/web/src/views/StationDetail.view.tsx`, `apps/web/src/views/Stations.view.tsx` — `invalidate: stationDeleteKeys()`.
- Edit: `CLAUDE.md` — the station-delete line under "Mutation Cache Invalidation".

**Tests** (written first; `npm run test:unit -- --testPathPattern delete-invalidation` in `apps/web`)
- Edit: `apps/web/src/__tests__/delete-invalidation.util.test.ts` — `stationDeleteKeys()` contains the four roots; both views contain `invalidate: stationDeleteKeys()`.
- Then `npm run lint`, `npm run type-check`, `npm run format:check` in `apps/web`. `mutation-invalidate.guard.test.ts` must still pass.

## Smoke (manual, against your dev stack)

Use an org whose default station you can delete (a fresh `portalai org create` works; its default is Administrate).

1. Open the default station's page, choose More actions → Delete and confirm. You land on **Stations**. There is no "Station not found" text, and no "Default Station" line (the org has no default now).
2. Without reloading, open the **dashboard**. There is no default-station card and no error where it was.
3. Set another station as the default from the Stations page, then delete it **from its card** on that page. Once the list settles there is no "Station not found" text.
4. After step 1 the browser console shows one `404`, for `GET /api/stations/<deleted id>?include=…`: the station page's own query refetching as the page closes. There is none for the plain `GET /api/stations/<deleted id>` the picker makes. Step 3 still logs one picker `404` (see Out of scope).

## Out of scope

- **A default station the viewer can't read.** The picker and the dashboard card fetch whatever id the org carries, and an unreadable station answers 404 like a missing one, so a member would see the same text if the default were a station not shared with them. Different cause, not reproduced; worth its own ticket if it happens.
- **The two remaining console 404s.** The station page's own query refetches once between the delete and the navigation. On the Stations page, deleting the default from its card refetches the picker's station and the organization together, so the picker's request can 404 before the organization comes back without a default; no "Station not found" text was seen when sampled every 250 ms. Both are console noise, and the second was there before this fix.
