# Dashboard favorite stations — Discovery

**Issue:** [EnterpriseBT/portal-ai#1080](https://github.com/EnterpriseBT/portal-ai/issues/1080) · Feature · child of the dashboard redesign epic (#1085), branch `feat/1080-dashboard-favorite-stations` off `epic/dashboard-redesign`.

**Why this exists.** Favorites (#1072) record which stations each user cares about, and the workbench (#1078) left a "Favorite stations" slot for them. #1123 built the cards in Storybook: a title linking to the station, a "Last portal 3h ago" line and a Launch action. This ticket wires them. Two pieces are missing underneath:
- **Last portal time:** no endpoint says when the caller last used a portal in a station, so the card's activity line has no source.
- **Favorites-only link:** the Stations list can't be opened with its Favorites filter on, so the section's "see all" can't land on the caller's favorites.

The ticket started as `condensed`. Sizing moved to `full` at discovery, once the activity line was decided as a new API include (core contract, API, OpenAPI). **This is the dashboard section that turns each user's starred stations into one-click starting points.**

## The current shape

### The cards (#1123, pure UI, mounted nowhere)

| Piece | Location | Note |
|---|---|---|
| `FavoriteStationsUI` | `apps/web/src/components/FavoriteStations.component.tsx` | `CardList` of cards, three across from `md`; teaching `EmptyState` ("No favorite stations yet") with no favorites |
| `FavoriteStationCardUI` | `apps/web/src/components/FavoriteStationCard.component.tsx` | `DetailCard` with `href` to the station, `h3` title, "Last portal …" / "No portals yet" from `lastActivity: number \| null`, Launch with `launchGate` and `launching` |
| Card actions' names | `packages/core/src/ui/ActionsSuite.tsx:9-35` | `ActionSuiteItem` has no per-item label; `describedBy` (the card's title) is how a card's actions name their object (#794) |
| Workbench slot | `apps/web/src/components/DashboardWorkbench.component.tsx:67-74` | `stations` slot renders the "Favorite stations" section, see-all "All stations" → `/stations` |
| Dashboard container | `apps/web/src/views/Dashboard.view.tsx:113-121` | passes start box, health check, Recent portals and Pinned Results; no `stations` yet |

### Launching

| Piece | Location | Note |
|---|---|---|
| `usePortalLauncher` | `apps/web/src/utils/use-portal-launcher.util.ts` | one shared create for the header, chooser, start box and palette; `launch(stationId)` toasts a failure through `serverErrorMessage`; `gate` from `useCreateGate("portal", …)`; `pending` is the shared create's |
| Launcher context | `usePortalLauncherContext()` (used by `DashboardStartBox`) | the shell's one launcher instance |

### Favorites and staleness

| Piece | Location | Note |
|---|---|---|
| `favorite=true` on station lists | `apps/api/src/services/station-query.service.ts:93-95` | `FavoriteService.onlyFavorites` filter |
| `isFavorite` on rows | `apps/api/src/routes/station.router.ts:448-450` | `FavoriteService.attach` in the router, "so the agent's tool output doesn't change" (`station_list` shares the service) |
| Star refresh | `apps/web/src/utils/favorite-invalidation.util.ts:11-17` | a station star refreshes `[stations, "list"]` and its `get`: starring elsewhere already updates any station list |
| Opening a portal | `apps/web/src/views/Portal.view.tsx:56-80` | PATCHes `lastOpened`, then invalidates `portals.root` only |
| Query freshness | `apps/web/src/client.ts:77-79` | `staleTime` 60s: a list not invalidated keeps its data for a minute |

### The station list and portals (API)

| Piece | Location | Note |
|---|---|---|
| `GET /api/stations` | `apps/api/src/routes/station.router.ts:401-460` (OpenAPI `:347-399`) | `include` parsed into a set (`:426-431`); `tags` is the only include |
| `StationQueryService.listForCaller` | `apps/api/src/services/station-query.service.ts:57-155` | org, search, `visibilityPredicate`, tags, favorites; batch-loads toolpacks and (optionally) tags per page |
| Row contract | `packages/core/src/contracts/station.contract.ts:53-74` | `StationWithToolpacksSchema` extends `StationSchema` with optional include-driven fields and `FavoriteRowFields` |
| Swagger `Station` | `apps/api/src/config/swagger.config.ts:2063-2125` | hand-written; already lacks `tags` and `isFavorite` |
| `portals` table | `apps/api/src/db/schema/portals.table.ts:10-20` | `organizationId`, `stationId`, nullable `lastOpened`, base columns; **no indexes** |
| "My portals" | `apps/api/src/routes/portal.router.ts:312-350` | `mine=true` is `created_by = caller`; #1127 visibility adds nothing for one's own portals |
| Per-caller row precedent | `apps/api/src/services/favorite.service.ts:125-136` | one lookup for the page, rows mapped in order |

## The design space

### Decision 1 — Where the per-caller "last portal" is computed

- **A. An option on `StationQueryService.listForCaller`.** The service batch-loads it like tags. But the service also feeds the agent's `station_list` tool, which then needs a guard so it never asks.
- **B. A router attach step after the listing, like `isFavorite`.** A new `PortalActivityService.attachLastPortal(ctx, rows)` does one grouped read for the page, run only when `include` has `lastPortal`. The agent's tool can't reach it.

| | A (service option) | B (router attach) |
|---|---|---|
| Agent output unchanged | needs a guard | by construction |
| Precedent | tags | `isFavorite` (#1072) |
| Testable "agent doesn't get it" | yes, with care | as `favorite-lists.integration.test.ts:286-316` does |

**Lean: B.** It's a per-caller field like `isFavorite`, so it attaches where `isFavorite` does, and the shared listing stays as it is.

### Decision 2 — What "last portal" means

- **A. `MAX(last_opened)`** over the caller's own live portals in the station.
- **B. `MAX(COALESCE(last_opened, created))`**: a portal created but never opened still counts from its creation.

`lastOpened` starts null and is set when the portal page opens (`Portal.view.tsx`); migration 0037 backfilled it from `created`. A launch that fails to open its page (Back pressed mid-start) leaves `null`.

**Lean: B.** It's the caller's last use of the station either way, and it matches the 0037 backfill.

### Decision 3 — Index for the read

The read is `WHERE organization_id = ? AND created_by = ? AND station_id = ANY(…) AND deleted IS NULL GROUP BY station_id`. It's bounded to one page (at most 6 stations here), but the `portals` table has no index at all, and portals accumulate per user.

- **A. No index**, measured later.
- **B. A partial index `(organization_id, created_by, station_id) WHERE deleted IS NULL`.** It also serves `mine=true`.

**Lean: B.** CLAUDE.md's rule for tables that grow is scope columns first, partial on the soft-delete guard. It's one forward-only, expand-only migration. `last_opened` stays out of the key: the aggregate reads it from the matching rows.

### Decision 4 — The see-all link's Favorites filter

- **A. A read-once `?favorite=true` on `/stations`.** The route's `validateSearch` accepts it, and the view seeds `usePagination`'s `initialValue` with the Favorites filter on. Toggling the filter afterwards doesn't rewrite the URL: the Settings shape in CLAUDE.md, since the one inbound link is this section.
- **B. Two-way URL state** for the filter (the Help shape).

**Lean: A.** One inbound link, and the toolbar already owns the filter's state. #1081 (pins) can reuse the same param on `/portal-results`.

### Decision 5 — Launch, pending and the name

Launch calls the shell launcher's `launch(stationId)`, so it shares the one create (one request across every path) and its failure toast. The card's `launchGate` is the launcher's `gate`. `launching` is true for the card whose station the current create targets, tracked by the section, since the launcher's `pending` is shared. The name stays #1123's: the button reads "Launch", described by the card's title ("Launch, Finance Close"), the #794 card convention.

**Lean: as described.** See Open question 1 on the name.

## Tradeoff comparison

| | D1 router attach | D2 coalesce | D3 index | D4 read-once param | D5 shared launcher |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (migration) | Yes | Yes |
| New pattern | No (`isFavorite`) | No | No | No (`?create=`) | No |

## Recommendation

1. `GET /api/stations` takes `include=lastPortal`. Each row then carries `lastPortalAt: number | null`: the latest `COALESCE(last_opened, created)` among the caller's own live portals in that station, null when there are none.
2. It's attached in the router after the listing, by a new `PortalActivityService.attachLastPortal(ctx, rows)` over a new `PortalsRepository.lastActivityByStation(organizationId, userId, stationIds)` grouped read. `station_list` never carries it.
3. Core adds `lastPortalAt: z.number().nullable().optional()` to `StationWithToolpacksSchema`. Swagger's `Station` component documents it, plus the `isFavorite` and `tags` it already lacks, and the list route's `include` documents `lastPortal`.
4. A migration adds `portals_org_creator_station_idx` on `(organization_id, created_by, station_id) WHERE deleted IS NULL`.
5. A `FavoriteStations` container fills the workbench's `stations` slot. It runs `sdk.stations.list({ favorite: "true", include: "lastPortal", sortBy: "name", sortOrder: "asc", limit: 6, offset: 0 })` and renders `FavoriteStationsUI`, with the workbench's shared loading and error states.
6. Launch calls the shell launcher's `launch(stationId)`, gated by the launcher's `gate`, with `launching` on the card whose station is being started.
7. The section's see-all becomes "Favorite stations" → `/stations?favorite=true`. The Stations route accepts `favorite` read-once and opens with the Favorites filter on.
8. Opening a portal also refreshes the station lists (`[stations, "list"]`), so a card's "Last portal" moves when you come back.
9. Docs: the Getting Started or FAQ copy that names the dashboard picks up the favorite stations section, and the ACR's date and evaluation note get updated.

## Open questions

1. **Launch's accessible name.** The PRD says Launch "names its station ('Launch portal in {name}')". #1123's card names it through the description, which reads "Launch, Finance Close", the same as every card action (#794). Adding a per-action label to core's `ActionSuiteItem` would be a new core prop for one caller. Lean: keep the description, and record that it satisfies "names its station".
2. **The empty state's link.** The PRD asks for "Star a station to launch from here", linking to the Stations list. #1123's empty state says "Star a station on the Stations page to launch it from here in one click", and its only link is `emptyListHelp("favorites")`'s FAQ entry, "How do favorites work?" (`apps/web/src/utils/empty-list-help.util.ts:87-90`). Nothing links to Stations. Lean: keep the copy and add a "Go to Stations" link to `/stations` beside the FAQ link, as a change to #1123's component and its stories (per the PRD).
3. **The cap.** "A handful": Lean: 6, two rows of three on a wide screen, one row of two on a tablet.
4. **Starred stations the caller can no longer read.** `favorite=true` already filters through `visibilityPredicate`, so they drop out. Lean: no extra work; add an integration test for it.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A beyond the shared create. Launch reuses the launcher's single-flight create, and the start box's hold (#1079) doesn't apply to cards because the header isn't unmounted. Lean: shared launcher.
- **Accuracy & auditability:** N/A. A display hint, not a record; no ledger.
- **Failure modes:** a failed list shows the shared error with Retry, and a failed launch toasts. A failed `lastPortal` read fails the list request (one transaction of reads). Lean: no partial "unknown" state, because the read is cheap and indexed.
- **Scale & unbounded growth:** one grouped read per page, at most 6 stations, on a new partial index. Portals per user grow without bound, and the index keeps the read a range scan. Lean: index plus the page bound.
- **Multi-tenancy:** the read is org-scoped and creator-scoped by the caller's own id from the request, never from input. Lean: as specified.
- **Contract stability:** an optional field behind an include, so nothing changes for existing callers or the agent. Lean: include-gated.
- **Data lifecycle:** soft-deleted portals are excluded, and a deleted station drops from the list. N/A otherwise.

## What this doesn't decide

- **Favorite views and connectors on the dashboard:** out of scope in the PRD; they're in the sidebar and palette.
- **Org-curated favorite stations:** N/A per the PRD, since favorites are personal.
- **The pins section (#1081):** separate. It may reuse D4's `?favorite=true` on `/portal-results`.
- **Fixing `PortalsRepository.findManyWithStation`'s ordering** (no NULLS LAST or id tiebreaker, found in the survey): unrelated to this ticket. Worth its own bug.

## Next step

`docs/DASHBOARD_FAVORITE_STATIONS.spec.md` pins the include's contract, the migration and the web wiring. `docs/DASHBOARD_FAVORITE_STATIONS.plan.md` slices it into about four commits:
1. Core contract and the API include, with the migration and integration tests.
2. The Stations route's read-once `?favorite=true`.
3. The `FavoriteStations` container in the dashboard, with Launch and the portal-open refresh.
4. Docs.
