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

**Decided: B and C.** B first, and C added after code review.

- **B.** The list lives once: `stations.root`, `portals.root`, `portalResults.root`, `connectorInstances.root` (the delete unlinks the station's connectors, and a connector's delete dialog counts its stations) and `organizations.root`. `CLAUDE.md`'s list gains the last two.
- **C.** B only refreshes the session that ran the delete, and it doesn't wait for the organization before navigating. Another tab or another member with the organization cached, or a slow connection, still reaches the picker with an id whose station is gone. So the picker (`DefaultStationMeta`) and the dashboard card (`DefaultStationCardConnected`) treat `404 STATION_NOT_FOUND` on the default station as "no default", using the existing `isStationUnavailable` (`apps/web/src/utils/portal-station.util.ts`, #699). Any other failure still shows as an error. This also covers a default station the viewer can't read, which answers 404 like a missing one.

## Plan — one slice

**Files**
- Edit: `apps/web/src/utils/delete-invalidation.util.ts` — add `stationDeleteKeys()` with a comment saying why each key is in it.
- Edit: `apps/web/src/views/StationDetail.view.tsx`, `apps/web/src/views/Stations.view.tsx` — `invalidate: stationDeleteKeys()`.
- Edit: `apps/web/src/components/DefaultStationMeta.component.tsx`, `apps/web/src/components/DefaultStationCard.component.tsx` — a default station that is gone for the viewer renders as no default.
- Edit: `CLAUDE.md` — the station-delete line under "Mutation Cache Invalidation".

**Tests** (written first; `npm run test:unit -- --testPathPattern delete-invalidation` in `apps/web`)
- Edit: `apps/web/src/__tests__/delete-invalidation.util.test.ts` — `stationDeleteKeys()` contains the five roots; both views contain `invalidate: stationDeleteKeys()`.
- Edit: `apps/web/src/__tests__/StationDetail.view.test.tsx` — drives the page's delete and reads the organization off the call's `invalidate`.
- New: `apps/web/src/__tests__/DefaultStationMeta.test.tsx`, `apps/web/src/__tests__/DefaultStationCardConnected.test.tsx` — a 404 on the default station renders as no default; a 500 still shows an error.
- Then `npm run lint`, `npm run type-check`, `npm run format:check` in `apps/web`. `mutation-invalidate.guard.test.ts` must still pass.

## Smoke (manual, against your dev stack)

Use an org whose default station you can delete (a fresh `portalai org create` works; its default is Administrate).

1. Open the default station's page, choose More actions → Delete and confirm. You land on **Stations**. There is no "Station not found" text, and no "Default Station" line (the org has no default now).
2. Without reloading, open the **dashboard**. There is no default-station card and no error where it was.
3. Set another station as the default from the Stations page, then delete it **from its card** on that page. Once the list settles there is no "Station not found" text.
4. As a member, in an org whose default is a station not shared with them (the owner creates a station and sets it as the default): **Stations** and the **dashboard** show no "Default Station" line and no "Station not found". As the owner, the same pages name the station.
5. After step 1 the browser console shows one `404`, for `GET /api/stations/<deleted id>?include=…`: the station page's own query refetching as the page closes. There is none for the plain `GET /api/stations/<deleted id>` the picker makes. Step 3 still logs one picker `404` (see Out of scope).

## Out of scope

- **Another session's delete reaching an open page.** A page that is already open keeps showing a station another session deleted, in the list and as the default, until its queries refetch. That is how the cache works everywhere, not this bug; when the refetch comes, decision C stops it turning into "Station not found".
- **The Activity log** isn't refreshed by a station delete, though deleting the default writes an entry. The entry is written after the response, so a refresh in the delete's `invalidate` could still miss it.
- **Portal deletes** still spell their refresh list in three places. Same drift risk, separate change.
- **The two remaining console 404s.** The station page's own query refetches once between the delete and the navigation. On the Stations page, deleting the default from its card refetches the picker's station and the organization together, so the picker's request can 404 before the organization comes back without a default; no "Station not found" text was seen when sampled every 250 ms. Both are console noise, and the second was there before this fix.
