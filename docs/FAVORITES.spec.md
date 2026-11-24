# Favorites — Spec

This pins the contract for personal, read-gated favorites on stations, pinned results, curated views and connector instances, plus the generic toolbar quick-filter the four lists use for "Favorites only". Discovery: `docs/FAVORITES.discovery.md`. Issue: [#1072](https://github.com/EnterpriseBT/portal-ai/issues/1072). Follow-up: #1114 removes the org-wide default station after this lands.

## Key decisions (flag for review)

1. **One `favorites` table, with a nullable FK per type** (the #1070 shape) and CHECK exactly-one-target. The four target FKs cascade on hard delete.
2. **Rows are always hard-deleted:** on unstar, in each object's delete transaction, on member removal, and on org delete and reset. A favorite has nothing to restore, so nothing is kept as a tombstone.
3. **`PUT` / `DELETE /api/favorites/:type/:id`.** Both need **read** on the object, and an unreadable object is 404 for both verbs. Both answer `200 { isFavorite }` idempotently. `user_id` always comes from the request context.
4. **A star can't land on a deleted object.** `PUT` share-locks the live target row (`FOR SHARE`) in its transaction before inserting, so it can't interleave with that object's delete sweep.
5. **`isFavorite` is on every row** of the four lists and their detail GETs, from one batched lookup per page. It's attached in the route layer, so agent tool output (`station_list`, the view tools) doesn't change.
6. **`favorite=true` is the only accepted filter value.** `favorite=false` fails the list's strict query schema (400 `*_INVALID_QUERY`). The filter is ANDed with `visibilityPredicate`, so a favorite the caller can no longer read is hidden but kept. No `ORDER BY` reads favorites.
7. **Member removal** deletes the member's favorites in that org in one transaction with the membership soft delete. The rest of `removeMember` is unchanged.
8. **Quick filter:** `BooleanFilterConfig.placement: "toolbar"`. It's the same filter state, so chips, `isFiltered`, `resetOffset`, announcements and persistence (where a list opts in) come for free. Turning it off sets `[]`, never `"false"`. None of the four lists persists filters today, and "Favorites only" doesn't either (discovery OQ1).
9. **Star control:** a generic `titleAction` slot on core `DetailCard` and `PageHeader`, filled by `FavoriteToggle`. The station default's star stays until #1114.
10. **Free on every tier** and not entitlement-gated. No audit entry, and no job lock (`locks: { none }`).

## Scope

### In scope
- The core model and contracts, the table, migration `0142`, the repository and the service.
- The shared readable-target loader (extracted from `TagAssignmentService`).
- The two routes, with route-map entries and `@openapi` docs.
- `isFavorite` and `favorite=true` on the four list and detail endpoints.
- Delete sweeps (station, pin, view cascade, connector), and the member-removal, org-delete and reset sweeps.
- The toolbar `placement` option, the core `titleAction` slots, `FavoriteToggle`, the SDK, wiring on the four lists and four detail pages, and the favorites empty state.
- Glossary, FAQ and help-search content.

### Out of scope
- Removing the default station (#1114).
- Dashboard, launcher and palette surfaces.
- Other favoritable types.
- Ordering favorites first.
- Agent tools.
- `GET /api/favorites`.
- Persisting filters on the four lists.
- Toolbar "actions" (only toggles go in the slot).

## Surface

### Core: `packages/core/src/models/favorite.model.ts` (new)

```ts
export const FAVORITE_TARGET_TYPES = ["station", "pin", "curated_view", "connector_instance"] as const
  satisfies readonly TagTargetType[];          // each is also its permission resource type
export const FavoriteTargetTypeSchema = z.enum(FAVORITE_TARGET_TYPES);
export type FavoriteTargetType = z.infer<typeof FavoriteTargetTypeSchema>;
export const FavoriteTargetSchema = z.object({ type: FavoriteTargetTypeSchema, id: z.string() });
export type FavoriteTarget = z.infer<typeof FavoriteTargetSchema>;

export const FAVORITE_TARGET_COLUMNS = {
  station: "stationId", pin: "portalResultId",
  curated_view: "curatedViewId", connector_instance: "connectorInstanceId",
} as const satisfies Record<FavoriteTargetType, string>;

export const FavoriteSchema = CoreObjectSchema.extend({
  organizationId: z.string(),
  userId: z.string(),
  stationId: z.string().nullable(),
  portalResultId: z.string().nullable(),
  curatedViewId: z.string().nullable(),
  connectorInstanceId: z.string().nullable(),
}).refine(exactlyOneTarget, "A favorite names exactly one object");
```

It also gets a `FavoriteModel` and `FavoriteModelFactory` following `entity-tag-assignment.model.ts`. Both files are exported from the models barrel.

### Core: `packages/core/src/contracts/favorite.contract.ts` (new)

```ts
export const FavoriteParamsSchema = FavoriteTargetSchema.strict();             // :type, :id
export const FavoriteResponsePayloadSchema = z.object({ isFavorite: z.boolean() });
export const FavoriteListQueryFields = { favorite: z.literal("true").optional() };
export const FavoriteRowFields = { isFavorite: z.boolean().optional() };       // always set by the four routes
```

`FavoriteListQueryFields` is spread next to `TagListQueryFields`, and `FavoriteRowFields` next to `TaggedRowFields`, in:
- `station.contract.ts` (`:25`, `:55`);
- `portal.contract.ts` (`:174`, `:204`);
- `curated-view.contract.ts` (`:52`, `:65`);
- `connector-instance.contract.ts` (`:70`, `:82`).

The field is optional in the schema because those row schemas are shared with paths that don't attach it. Every route below always sets it.

### API: `apps/api/src/db/schema/favorites.table.ts` (new)

`favorites` table:
- **Columns:** `...baseColumns`, plus:
  - `organization_id text NOT NULL → organizations.id`;
  - `user_id text NOT NULL → users.id`;
  - `station_id → stations.id ON DELETE CASCADE`;
  - `portal_result_id → portal_results.id ON DELETE CASCADE`;
  - `curated_view_id → curated_views.id ON DELETE CASCADE`;
  - `connector_instance_id → connector_instances.id ON DELETE CASCADE`.
- **Constraints:**
  - `CHECK favorites_one_target`: `num_nonnulls(station_id, portal_result_id, curated_view_id, connector_instance_id) = 1`.
  - Non-partial unique indexes `favorites_station_user_unique (station_id, user_id)`, `favorites_portal_result_user_unique`, `favorites_curated_view_user_unique` and `favorites_connector_instance_user_unique`. These serve the idempotent insert, the per-page lookup and the object sweeps.
  - `favorites_org_user_idx (organization_id, user_id)` serves the filter subquery and the member sweep.

Exported from `schema/index.ts`. `FavoriteSelectSchema`/`FavoriteInsertSchema` go in `zod.ts`, with bidirectional checks in `type-checks.ts`.

### API: `apps/api/src/db/repositories/favorites.repository.ts` (new)

`FavoritesRepository` extends `Repository`, registered as `DbService.repository.favorites`. All methods take an optional `client: DbClient`.

| Method | Contract |
|---|---|
| `insertIfAbsent(row: {organizationId, userId, createdBy}, target, client)` | `INSERT … ON CONFLICT (<col>, user_id) DO NOTHING`. Returns `{ created: boolean }`. |
| `deleteFor(userId, target, client)` | Hard `DELETE` of that user's row for the target. Returns the count (0 is fine). |
| `hardDeleteByTargets(type, ids, client)` | Every user's favorites of those objects. `ids = []` is a no-op. |
| `hardDeleteByUser(organizationId, userId, client)` | The member sweep. |
| `hardDeleteByOrganization(organizationId, client)` | The org-delete and reset sweep. |
| `favoritedIds(organizationId, userId, type, ids, client): Promise<Set<string>>` | One `SELECT <col> … WHERE user_id = ? AND organization_id = ? AND <col> IN (ids)`. `[]` returns an empty set with no query. |
| `favoritedBy(organizationId, userId, type, idCol): SQL` | `idCol IN (SELECT <col> FROM favorites WHERE user_id = ? AND organization_id = ?)`. |
| `lockLiveTarget(target, client): Promise<boolean>` | `SELECT id … WHERE id = ? AND deleted IS NULL FOR SHARE` on the target's table, the same as `entity-tag-assignments.repository.ts:237-245`. |

### API: `apps/api/src/services/object-target.service.ts` (new; extracted)

The `TARGETS` descriptor map (`tag-assignment.service.ts:66-107`), with each type's `load` and `notFound`, moves here as `OBJECT_TARGETS: Record<TagTargetType, TargetDescriptor>`. It gets:

```ts
static async loadReadable(set: PermissionSet, ctx: PermissionContext, target: TagTarget): Promise<OwnedRow>
// org-scoped + resource.read, else the type's own 404 (ObjectAccessService.readableInOrg)
static descriptor(type: TagTargetType): TargetDescriptor
```

`TagAssignmentService.checkTarget` calls `loadReadable` for its read step, and `OBJECT_TARGETS[type]` with `loadForVerb` for write. Its behaviour and every existing tag test stay unchanged.

### API: `apps/api/src/services/favorite.service.ts` (new)

```ts
static async set(ctx: PermissionContext, target: FavoriteTarget): Promise<{ isFavorite: true }>
// loadSet → loadReadable (404) → transaction: lockLiveTarget (false → the type's 404) → insertIfAbsent
static async unset(ctx: PermissionContext, target: FavoriteTarget): Promise<{ isFavorite: false }>
// loadSet → loadReadable (404) → deleteFor(ctx.userId, target)
static async favoritedIds(ctx, type, ids): Promise<Set<string>>
static onlyFavorites(ctx, type, idCol): SQL
```

An unexpected error is wrapped as `500 FAVORITE_UPDATE_FAILED`, and an `ApiError` passes through. `ApiCode` gains `FAVORITE_INVALID_PAYLOAD` and `FAVORITE_UPDATE_FAILED` (`constants/api-codes.constants.ts`).

### API: `apps/api/src/routes/favorite.router.ts` (new), mounted at `/favorites` in `protected.router.ts`

| Method + path | Request | Response | Errors |
|---|---|---|---|
| `PUT /api/favorites/:type/:id` | No body (an empty body reaches the route as `{}`; a non-empty body fails `.strict()` → 400 `FAVORITE_INVALID_PAYLOAD`) | `200 { success, payload: { isFavorite: true } }` | 400 `FAVORITE_INVALID_PAYLOAD` (unknown `type`); 404 the target's own code (missing, cross-org, unreadable, deleted) |
| `DELETE /api/favorites/:type/:id` | — | `200 { payload: { isFavorite: false } }`, also when there was no row | same |

- Params are validated with `FavoriteParamsSchema` through `invalidPayload(ApiCode.FAVORITE_INVALID_PAYLOAD, …)`.
- The caller comes from `getApplicationMetadata`.
- Each route has an `@openapi` block referencing a registered `FavoriteResponsePayload` component (`swagger.config.ts`).
- `route-authorization.map.ts` gets both entries as `{ kind: "authorized", by: "FavoriteService: org-scoped read on the target, else its 404" }`, `locks: { none: "favorites are the caller's own data; no job reads or writes them" }`.

### API: the four lists and detail reads

For each list and detail endpoint below, when `favorite === "true"` the list `where` gains `FavoriteService.onlyFavorites(ctx, type, <table>.id)`, ANDed with the existing predicate. Then, after the page loads, each row gets `isFavorite = set.has(row.id)` from one `favoritedIds` call. The detail endpoints set `isFavorite` the same way from a one-id lookup.

| Type | List | Filter goes into | Detail |
|---|---|---|---|
| station | `station.router.ts:400` | `StationQueryService.listForCaller` gains `opts.favorite?: true` (the `station_list` tool never passes it) | `station.router.ts:521-593` |
| pin | `portal-results.router.ts:462-570` | the router's predicate (`:490-523`) | `:614` |
| connector_instance | `connector-instance.router.ts:164-340` | the router's predicate (`:197-262`) | `:399` |
| curated_view | `curated-view.router.ts` list handler | `CuratedViewService.list` gains `opts.favorite?: true` | `curated-view.router.ts` get handler |

`isFavorite` is attached in the router handlers, not in `listForCaller` or `CuratedViewService.list`/`get`, so agent tools reading those services see no new field.

### API: sweeps (hard delete, same transaction and stamp as the object)

| Path | Call |
|---|---|
| Station delete (`station.router.ts:1235-1250` tx) | `favorites.hardDeleteByTargets("station", [id], tx)` |
| Pin delete (`portal-results.router.ts:870-884` tx) | `hardDeleteByTargets("pin", [id], tx)` |
| `CuratedViewDeleteService.deleteByIds` (`curated-view-delete.service.ts:89-104`), the single view cascade for view, entity and connector deletes | `hardDeleteByTargets("curated_view", ids, tx)` |
| Connector delete (`connector-instance.router.ts:1494-1597`, inside `withUnlocked`) | `hardDeleteByTargets("connector_instance", [id], tx)` |
| `SeatService.removeMember` (`seat.service.ts:591`) | `DbService.transaction(tx => organizationUsers.softDelete(target.id, caller.userId, tx); favorites.hardDeleteByUser(orgId, target.userId, tx))` |
| `OrganizationDeleteService.cascade` (`organization-delete.service.ts:177-180`), before any target table is deleted | `hardDeleteByOrganization(orgId, tx)` |
| `ResetService` (`reset.service.ts:108-113`) | `hardDeleteByOrganization(orgId, tx)` |

### Web: `PaginationToolbar.component.tsx`

```ts
export interface BooleanFilterConfig extends BaseFilterConfig {
  type: "boolean";
  /** "toolbar" renders a one-click toggle beside Filter instead of a popover switch. Default "popover". */
  placement?: "popover" | "toolbar";
}
```

- **Rendering.** A toolbar filter is excluded from the popover. It renders as a `ToggleButton`-style `Button` with `aria-pressed={values[0] === "true"}` and the config's `label` as its name, beside the Filter button.
- **Clicking.** It calls the wrapped `onFilterValueChange(field, pressed ? [] : ["true"])`, so the offset reset and the result announcement fire as they do for any filter.
- **Chip.** The active chip reads `{label}` (not "{label}: Yes"), and deleting it sets `[]`.
- `activeFilterCount` and `isFiltered` count it like any other filter.
- A list with no `placement: "toolbar"` filter renders exactly as before.

### Core UI: `DetailCard.tsx`, `PageHeader.tsx`

Both gain `titleAction?: React.ReactNode`, rendered immediately after the title (before `actions` / `primaryAction`). In `DetailCard` a click inside it never follows the card's link (`isControlClick`). In `PageHeader` it sits beside the `h1` and outside it.

### Web: new files

- **`api/favorites.api.ts`, registered as `sdk.favorites`.**
  - `set()` and `unset()` are `useAuthMutation` hooks taking `FavoriteTarget`, sending `PUT`/`DELETE` to `/api/favorites/${type}/${id}`.
  - Both set `onPermissionDenied: { invalidate: (t) => favoriteKeys(t) }`.
- **`utils/favorite-invalidation.util.ts`.** `favoriteKeys(target)` returns the type's list prefix and the object's detail key (`api/keys.ts`), never the whole root, which also holds a pin's live data and a view's records.
- **`components/FavoriteToggle.component.tsx`.**
  - `FavoriteToggleUI {name, isFavorite, pending, onToggle}`: an `IconButton` (Star / StarBorder) with `aria-pressed={isFavorite}`, `aria-label` "Favorite {name}" in both states (the APG toggle pattern: `aria-pressed` carries the state), and `gate={pendingGate(pending)}`.
  - `FavoriteToggle {target, name, isFavorite}` calls `set`/`unset` with `invalidate: favoriteKeys(target)` and a `toast.error`, then waits for those queries' refetch before leaving its pending state. It does no optimistic update.
- **`utils/use-favorite-filter.util.ts`.** `useFavoriteFilter(): BooleanFilterConfig` returns `{ field: "favorite", label: "Favorites only", type: "boolean", placement: "toolbar" }`.
- **`components/FavoritesEmptyResults.component.tsx`.** A pure UI component over core `EmptyState`, with title "No favorites yet" and description "Star a {noun} to keep it here. Only you see your favorites.". Its `helpLink` goes to the FAQ entry "How do favorites work?".

### Web: wiring

- **The four lists** (`Stations.view.tsx`, `PinnedResultsListView.view.tsx`, `CuratedViews.view.tsx`, and `Connector.view.tsx`'s Connected tab):
  - add `useFavoriteFilter()` to their filters;
  - pass `titleAction={<FavoriteToggle …/>}` to each card (`StationList.component.tsx`, `PinnedResultsList.component.tsx`, the inline view cards, `ConnectorInstance.component.tsx`);
  - when `favorite` is on, no other filter or search is active and the page is empty, render `FavoritesEmptyResults`, otherwise the existing `EmptyResults`.
- **The four detail views** (`StationDetail`, `PinnedResultDetail`, `CuratedViewDetail`, `ConnectorInstance`) pass `titleAction` to `PageHeader`.

### Content

- **`glossary.util.ts`.** A new "Favorite" term in the Organization category. Its definition: "A station, pinned result, view or connector you starred. Favorites are personal: only you see them, starring needs only read access, and Favorites only narrows a list without reordering it." Its `relatedTerms` are Station, Pinned Result, Curated View, Connector Instance and Tag.
- **The four existing terms** each add one sentence saying they can be starred.
- **`faq.util.ts`.** "How do favorites work?", with the alias "star" and the `relatedGlossaryTerms` `["Favorite","Tag"]`.

## Migration

`npm run db:generate -- --name add-favorites` generates `0142_add-favorites.sql` plus its journal and snapshot. It's schema-only (create table, check, five indexes) with no backfill, nothing destructive, and no seed change. The integration DB setup applies it; there's no separate migration test.

## Seed

None.

## TDD test plan

Run per package: `cd packages/core && npm run test:unit`, `cd apps/api && npm run test:unit` / `npm run test:integration`, `cd apps/web && npm run test:unit`.

### Core
- **`__tests__/models/favorite.model.test.ts` (new):** exactly-one-target refine (0 or 2 targets rejected), `FAVORITE_TARGET_TYPES` ⊂ tag target types, column map. ≈ 6
- **`__tests__/contracts/favorite.contract.test.ts` (new):**
  - params `.strict()` and unknown type rejected;
  - `favorite` accepts `"true"` and rejects `"false"`;
  - the four list query schemas carry the field.

  ≈ 7
- **`__tests__/ui/DetailCard.test.tsx`, `PageHeader.test.tsx`:**
  - `titleAction` renders;
  - clicking it doesn't navigate;
  - absent → unchanged;
  - axe.

  ≈ 6

### API integration (`src/__tests__/__integration__/…`)
- **`services/object-target.service.integration.test.ts` (new):** readable → row; cross-org, unreadable or missing → the type's 404, for each type. ≈ 6. The existing tag suites stay green unchanged.
- **`routes/favorite.router.integration.test.ts` (new):**
  - a reader with read-only access can PUT and DELETE each of the 4 types, and gets 200 `{isFavorite}`;
  - a repeat PUT gives a single row, and a DELETE with no row returns 200;
  - unreadable, cross-org, deleted or missing → 404, for both verbs;
  - an unknown type or a body → 400;
  - concurrent PUTs (`Promise.all`) leave one row;
  - a PUT racing an object delete leaves no favorite.

  ≈ 16
- **`routes/favorite-lists.integration.test.ts` (new):** for each of the 4 lists:
  - `isFavorite` is true for the caller's star only, and another member's star is invisible, owner included;
  - `favorite=true` narrows;
  - it composes with search, `tagIds` and pagination totals;
  - sort order is unchanged;
  - `favorite=false` → 400;
  - a revoked share hides the favorite, and restoring the share brings it back starred.

  Plus detail `isFavorite` for each type. ≈ 24
- **`services/favorite-sweeps.integration.test.ts` (new):**
  - deleting each object type removes every user's favorite of it, including views deleted through entity and connector deletes;
  - member removal deletes that member's favorites in that org only, and a re-invite starts empty;
  - org delete and reset clear the table for that org;
  - a hard delete cascades.

  ≈ 10
- **`routes/route-authorization.test.ts`:** the existing guard covers the two new entries (no new cases). `station_list` tool output has no `isFavorite`. ≈ 1

### API unit
- **`__tests__/services/favorite.service.test.ts`:** error wrapping to `FAVORITE_UPDATE_FAILED`, `ApiError` pass-through. ≈ 3

### Web unit (`apps/web/src/__tests__/`)
- **`PaginationToolbar.test.tsx`:**
  - a toolbar toggle renders outside the popover with `aria-pressed`;
  - a click sets `["true"]` and then `[]`, never `"false"`;
  - the chip reads the label, and deleting it clears the filter;
  - it's announced;
  - `isFiltered` sees it;
  - an unconfigured toolbar is unchanged;
  - axe.

  ≈ 8
- **`FavoriteToggle.test.tsx`:** `aria-pressed` and both labels; `onToggle`; the pending gate keeps focus; axe on both states. ≈ 5
- **`FavoritesEmptyResults.test.tsx`:** copy, help link, axe. ≈ 3
- **`favorites.api` / `favorite-invalidation.util.test.ts`:** the URL per type, `onPermissionDenied` keys, and `favoriteKeys` per type. ≈ 5
- **View tests** (`Stations`, `PinnedResultsList`, `CuratedViews`, `Connector`, and the four detail views): the star renders per row and in the header; the favorites empty state shows only when the filter alone is active. ≈ 12

### Content (core)
- **`glossary.util.test.ts`, `faq.util.test.ts`, `help-findability.test.ts`:** the Favorite term and its related terms resolve; the FAQ entry exists; "star" finds it. ≈ 3

**Totals ≈ 124 cases.**

## Acceptance criteria

- [ ] A member with only read on a station, pin, view or connector can star and unstar it, and the star shows for every reader. An unreadable object answers 404 to both verbs.
- [ ] Favorites are personal: another member's favorites never appear in any response or change the caller's `isFavorite`, owner and admin included.
- [ ] Starring twice or unstarring an unstarred item succeeds without an error or a duplicate row.
- [ ] "Favorites only" on each of the four lists narrows in one click. It composes with search, filters, sort and pagination, shows as a chip, is announced, and behaves like the list's other filters across navigation.
- [ ] No list reorders by favorite.
- [ ] Revoking access hides the favorite, and restoring access shows it starred again.
- [ ] Deleting an object (including through entity and connector deletes) removes every favorite of it in the same transaction. No response ever references a deleted object's favorite.
- [ ] Removing a member deletes their favorites in that org in the same transaction as the membership removal, and a re-invite starts with none.
- [ ] The toolbar slot is generic: no favorite code in `PaginationToolbar`, and unconfigured lists are unchanged.
- [ ] The star toggle, the toolbar toggle and the favorites empty state pass `expectNoAxeViolations`.
- [ ] The glossary, FAQ and help search describe favorites.

## Risks & rollback

- **A per-page lookup failure fails the list request** (fail-closed). A list never reports every row as unstarred. It's one indexed query per page, so the cost risk is negligible.
- **Missed sweep path.** A new object-delete path that skips `hardDeleteByTargets` would leave rows. They'd never be returned, because every read joins a live, readable object, and they'd be removed by FK cascade on the object's eventual hard delete. The sweep tests pin the existing paths.
- **Member-removal transaction.** It now wraps two statements. A failure rolls back both, so the membership and the favorites stay consistent, and the remaining steps run as they did before.
- **Rollback.** Revert the PR. The table is additive and expand-only, so it can stay in place unused.

## Files touched

- **Core, new:**
  - `models/favorite.model.ts`, `contracts/favorite.contract.ts` (plus barrels);
  - tests `models/favorite.model.test.ts`, `contracts/favorite.contract.test.ts`.
- **Core, edited:**
  - `contracts/station.contract.ts`, `portal.contract.ts`, `curated-view.contract.ts`, `connector-instance.contract.ts`;
  - `ui/DetailCard.tsx`, `ui/PageHeader.tsx` and their tests;
  - `content/glossary.util.ts`, `content/faq.util.ts` and their tests.
- **API, new:**
  - `db/schema/favorites.table.ts`, `db/repositories/favorites.repository.ts`;
  - `services/object-target.service.ts`, `services/favorite.service.ts`, `routes/favorite.router.ts`;
  - `drizzle/0142_add-favorites.sql`, `drizzle/meta/0142_snapshot.json`;
  - integration and unit tests above.
- **API, edited:**
  - `db/schema/index.ts`, `zod.ts`, `type-checks.ts`, `services/db.service.ts` (repository registration), `drizzle/meta/_journal.json`;
  - `constants/api-codes.constants.ts`, `config/swagger.config.ts`, `routes/protected.router.ts`;
  - `__tests__/config/route-authorization.map.ts`;
  - `services/tag-assignment.service.ts`;
  - `routes/station.router.ts`, `services/station-query.service.ts`;
  - `routes/portal-results.router.ts`;
  - `routes/connector-instance.router.ts`;
  - `routes/curated-view.router.ts`, `services/curated-view.service.ts`, `services/curated-view-delete.service.ts`;
  - `services/seat.service.ts`, `services/organization-delete.service.ts`, `services/reset.service.ts`.
- **Web, new:**
  - `api/favorites.api.ts`, `utils/favorite-invalidation.util.ts`, `utils/use-favorite-filter.util.ts`;
  - `components/FavoriteToggle.component.tsx`, `components/FavoritesEmptyResults.component.tsx`;
  - tests and stories.
- **Web, edited:**
  - `api/sdk.ts`, `components/PaginationToolbar.component.tsx`;
  - `components/StationList.component.tsx`, `components/PinnedResultsList.component.tsx`, `components/ConnectorInstance.component.tsx`;
  - `views/Stations.view.tsx`, `PinnedResultsListView.view.tsx`, `CuratedViews.view.tsx`, `Connector.view.tsx`;
  - `views/StationDetail.view.tsx`, `PinnedResultDetail.view.tsx`, `CuratedViewDetail.view.tsx`, `ConnectorInstance.view.tsx`;
  - their tests.

## Next step

`docs/FAVORITES.plan.md` sequences this into roughly eight TDD slices on `feat/1072-favorites`:
1. the core model and contracts;
2. the table, migration and repository;
3. the extracted target reader plus the service and routes;
4. `isFavorite` and the filter on the four types;
5. the sweeps;
6. the toolbar `placement` slot;
7. the core `titleAction`, `FavoriteToggle`, SDK and wiring on lists and details, with the empty state;
8. content.

## Revisions after code review

1. **Fixed toggle name.** The star is always named "Favorite {name}", with `aria-pressed` carrying the state. Switching to "Unfavorite {name}" when pressed announced the state twice and contradicted the name.
2. **Pending until the refetch lands.** `FavoriteToggle` stays pending until its lists and detail have refetched, so a second click acts on the new state instead of repeating the last call.
3. **Narrower refresh.** `favoriteKeys(target)` refreshes the type's lists and the object's detail read, not the whole root.
4. **Membership lock.** `FavoriteService.set` share-locks the caller's live membership (`organizationUsers.lockLiveMembership`) as well as the object, so a star can't commit after the member's removal has swept their favorites. A star from a member removed mid-request answers the object's 404.
5. **One rule for "only this filter".** `usePagination` gains `isOnlyFilter(field)`, which shares `isFiltered`'s rules (search, advanced filters, defaults). The four lists use it with `FAVORITE_FILTER`, which replaces `useFavoriteFilter` and `isFavoritesOnly`.
6. The favorites router passes errors straight to `next` (the service already wraps them), and the four detail reads look up `isFavorite` in parallel with their other reads.
