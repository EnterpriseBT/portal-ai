# Favorites — Discovery

**Issue:** [EnterpriseBT/portal-ai#1072](https://github.com/EnterpriseBT/portal-ai/issues/1072)

**Why this exists.** Stations, pinned results, curated views and connectors are the lists that grow fastest, and users need a quick, personal way to keep the ones they use within reach. Tags (#1070) don't fit. A tag is shared across the org and applying one needs write. A favorite belongs to one user and needs only read. The Dashboard redesign and Launcher epics (header launcher, command palette, sidebar favorites) are blocked on having this data.

This is the user-anchored favorites model, plus its first surfaces: a star on every row and detail page, and a generic quick-filter slot in `PaginationToolbar` that the four lists use for "Favorites only".

## The current shape

### Tag assignments: the closest precedent (#1070)

| Piece | Location | Note |
|---|---|---|
| Table | `apps/api/src/db/schema/entity-tag-assignments.table.ts:25-80`, migration `0138_tag-assignment-targets.sql` | One nullable FK per type (`station_id`, `portal_result_id`, `curated_view_id`, `connector_instance_id`, `connector_entity_id`). CHECK `num_nonnulls(...) = 1`. A partial unique index per type. FKs `onDelete: cascade`. |
| Core model | `packages/core/src/models/entity-tag-assignment.model.ts:10-38`, `tag-target.model.ts:10-26` | `TAG_TARGET_COLUMNS` maps type → column. `TagTarget {type,id}`, where the type name is also the permission resource type. |
| Idempotent insert | `entity-tag-assignments.repository.ts:181-229` (`insertIfAbsent`) | `onConflictDoNothing` against the partial index, then a read-back that returns `created:false`. |
| Race guard | same file `:237-245` (`lockLiveTarget`) | `FOR SHARE` on the live object row, so an insert can't land after the object's delete. |
| List filter | same file `:375-395` (`taggedWithAny`) | `idCol IN (SELECT <col> FROM entity_tag_assignments WHERE … AND deleted IS NULL)`. |
| Read-only target check | `apps/api/src/services/tag-assignment.service.ts:65-145` (`loadTarget(ctx, target, "read")`) | A per-type `TARGETS` descriptor (loader + 404). The "read" branch is exactly "readable in org, else 404". |
| Locks | `route-authorization.map.ts:934-982` | Every tag route declares `locks: { none: … }`. No job reads them. |

### The four lists and detail reads

All four list endpoints use offset pagination, and each builds the same predicate: org filter, `ilikeContains` search, `visibilityPredicate`, then `taggedWithAny`. Each then calls `ObjectCapabilitiesService.attach` (`object-capabilities.service.ts:79-89`).

| Type | List | Detail |
|---|---|---|
| Station | `station.router.ts:400` → `StationQueryService.listForCaller` (`station-query.service.ts:53-145`, attach `:137`; also backs the agent's `station_list`) | `station.router.ts:521-593` |
| Pinned result | `portal-results.router.ts:462-570` (attach `:559`) | `:614` (capabilities `:653`) |
| Connector instance | `connector-instance.router.ts:164-340` (attach `:331`) | `:399` (capabilities `:493`) |
| Curated view | `CuratedViewService.list` (`curated-view.service.ts:440-547`, attach `:539`) | `get()` (`:593`) |

Query and row fields shared by the four contracts are spread from `packages/core/src/contracts/tag-list.contract.ts` (`TagListQueryFields`, `TaggedRowFields`).

### Delete paths: where favorites must be swept

Each sweep below runs inside the object's delete transaction:
- **Station:** `station.router.ts:1235-1250`.
- **Pin:** `portal-results.router.ts:870-884`. A portal delete only nulls `portalId` (`portal.router.ts:727-739`), so it never deletes a pin.
- **View:** `curated-view-delete.service.ts:89-104` (`deleteByIds`). This one cascade serves view delete, entity delete and connector delete.
- **Connector:** `connector-instance.router.ts:1494-1597`, inside `JobLockService.withUnlocked`. The deferred `EntityDataDeleteService` job (`entity-data-delete.service.ts:26-62`) handles only records, and everything user-visible is removed in the request.
- **Org delete and reset:** these hard-delete by `organization_id` (`organization-delete.service.ts:179`, `reset.service.ts:108-113`). FK cascades cover any other hard delete.

### Membership removal

`DELETE /api/organization/members/:userId` (`organization.router.ts:1027`) calls `SeatService.removeMember` (`seat.service.ts:549-636`). It runs these steps under an advisory seat lock (`withSeatLock`), **not in one DB transaction**:
- soft-delete `organization_users`;
- remove the user's roles;
- hard-delete their grants;
- soft-delete their policy attachments and groups;
- write an audit entry.

No per-user preference table exists today. `user_role` and `user_group` are the closest per-user, org-scoped shapes.

### Authorization primitives

- `ObjectAccessService.loadForVerb` (`object-access.service.ts:59-72`) supports only write, delete and share.
- `readableInOrg` (`:39-50`) is the 404 step.
- No route yet writes a per-user, per-object row gated only by read. `POST /api/portal-sql/widget-refresh` and `POST /api/organization/switch` are read-gated, but neither writes such a row. Favorites would be the first.

### Web

| Piece | Location | Note |
|---|---|---|
| Filter types | `PaginationToolbar.component.tsx:69-131` | Every `FilterConfig` renders in the popover (`:894-1060`); there's no placement option. A boolean filter is a `Switch` setting `"true"`/`"false"` (`:939-965`). |
| Chips / counts | `:1281-1361`, `:575-578` | A boolean chip reads "{label}: Yes/No". `"false"` counts as active and is sent as `param=false` (`:524-530`). |
| Announcements | `:768`, `:774-795` | `useResultsAnnouncer` is armed only by the toolbar callbacks wrapped in `changed(...)`. |
| Persistence | `:156-159`, `:297-304` | Opt-in through `initialValue`/`onPersist`. **None of the four lists persists filters**, so they live in memory only. |
| `isFiltered` | `:559-573` (#1059) | Selects `EmptyResults` over the list's explainer. |
| Lists | `StationList.component.tsx:97-190`, `PinnedResultsList.component.tsx:60-112`, `CuratedViews.view.tsx:103-169`, `ConnectorInstance.component.tsx:92+` | All `CardList` + `DetailCard`; no `DataTable`. Row actions go through `ActionSuiteItem` (`packages/core/src/ui/ActionsSuite.tsx:9-23`), which has no pressed state. `DetailCard` (`DetailCard.tsx:15-32`) has no slot for a control beside the title. A click on a real control doesn't navigate (`:78-86`). |
| Detail headers | `PageHeader.tsx:13-31` | `primaryAction` + `secondaryActions`, but no slot by the title. Used at `StationDetail.view.tsx:189-235`, `PinnedResultDetail.view.tsx:148-171`, `CuratedViewDetail.view.tsx:135-144`, `ConnectorInstance.view.tsx:406-464`. |
| Icon clash | `StationList.component.tsx:113-117, 144-151` | Stations already use `StarOutline` for "Set as default" and `Star` on the "Default" chip. |
| SDK precedent | `api/tag-assignments.api.ts:14-95` | Generic over `TagTarget`. `onPermissionDenied` invalidates the target's root key. |
| Empty states | `utils/empty-list-help.util.ts:33-117`, `components/EmptyResults.component.tsx` | #1059's explainers. Any active filter shows the generic `EmptyResults`. |
| Help | `glossary.util.ts:223-239` (Tag), `faq.util.ts:220-232` ("How do tags work?"), `utils/glossary-routes.util.ts:18-55` | **There are no per-page Help entries.** Pages link into Help through glossary terms and the empty-state FAQ links. |

## The design space

### Decision 1 — Schema shape

**A. One `favorites` table with a nullable FK per type** (`station_id`, `portal_result_id`, `curated_view_id`, `connector_instance_id`), plus `user_id`, `organization_id`, CHECK `num_nonnulls(...) = 1`, a unique index per type on `(user_id, <col>)`, and `onDelete: cascade`. This is the tag-assignment shape exactly.
**B. A polymorphic `(object_type, object_id)` pair.** There are no real FKs, so nothing cascades and a dangling row is possible.
**C. A table per type.** Four tables, four repositories, and four dual-schema sets for one concept.

| | A | B | C |
|---|---|---|---|
| Real FKs / cascade on hard delete | ✓ | ✗ | ✓ |
| New type = | a column + an index | an enum value | a table |
| Precedent | #1070 (0138) | none | none |
| One repository and one filter helper | ✓ | ✓ | ✗ |

**Lean: A.** It reuses #1070's proven shape and repository helpers, the FKs make a dangling favorite impossible on any hard delete, and the soft-delete sweeps cover the rest.

### Decision 2 — Soft or hard delete of a favorite row

**A. Soft delete**, like tag assignments: tombstones pile up with every unstar.
**B. Hard delete**: an unstar, an object delete's sweep, and a member removal all `DELETE` the row.

A favorite has no history worth keeping and nobody restores one: losing access keeps the row, and only deletes remove it. Toggling a star many times would otherwise grow the table without bound, which is #442's tombstone problem in miniature.

**Lean: B.** Keep `baseColumns` for conformity with the dual-schema guards, but always hard-delete, and make the unique indexes non-partial. The object delete sweeps hard-delete as well, because their rows have no meaning once the object is gone (the grant rule).

### Decision 3 — API shape

**A. A generic `PUT/DELETE /api/favorites/:type/:id`**, as the ticket suggests. One router, with a `type` enum validated by Zod and a per-type target descriptor.
**B. Per-resource `PUT/DELETE /api/{stations|portal-results|…}/:id/favorite`**, mirroring tags' `/:id/tags`.

| | A | B |
|---|---|---|
| Routes to classify | 2 | 8 |
| Matches the tag URL style | ✗ | ✓ |
| Launcher/palette reuse | one surface | four |

**Lean: A.** One read-gated pair, `{ none: "favorites are the caller's own data; no job reads them" }` locks, and one SDK hook generic over the target. Both verbs answer `200 { isFavorite }` whether or not anything changed, which keeps them idempotent.

### Decision 4 — Authorization for a favorite

Both verbs require **read** on the object: org-scoped load, then `resource.read`, else 404. That's `TagAssignmentService.loadTarget(ctx, target, "read")`'s rule.

**A. Reuse it** by extracting a shared target-reader that tags and favorites both call.
**B. Duplicate** the per-type descriptor.

**Lean: A.** Lift the `TARGETS` loader map into a small `ObjectTargetService` (or export it from `TagAssignmentService`) restricted to the four types. One readable-object rule then serves both features. The row's `user_id` always comes from the request context, never from input. **Unstar needs read too**, so a user who has lost access can't learn whether the object still exists. Their hidden favorite stays in place until the object or their membership goes.

### Decision 5 — Delivering `isFavorite` and the filter

- **Row field.** `isFavorite` goes on every row of the four lists and their detail GETs, always rather than behind an `include`. It costs one batched `SELECT <col> FROM favorites WHERE user_id = ? AND <col> IN (…page ids)` per page, merged next to `ObjectCapabilitiesService.attach`. The field is per caller, so it's computed in the route or service path, never cached across users.
- **Filter.** `favorite=true` adds `idCol IN (SELECT <col> FROM favorites WHERE user_id = ? AND organization_id = ?)`. It's a sibling of `taggedWithAny`, ANDed with the visibility predicate, so a favorite the user can no longer read never appears. The contract accepts only `true`. `favorite=false` is a 400, because "not my favorites" was never asked for and the toolbar must never send it (see Decision 6).
- **Shared fields.** `FavoriteListQueryFields` and `FavoriteRowFields` live in a new core contract and are spread into the four contracts, the way the tag fields are.

**Lean: as above.** Sort stays exactly as chosen: the filter only narrows, and no `ORDER BY` reads favorites.

### Decision 6 — The quick-filter slot in `PaginationToolbar`

**A. A `placement: "toolbar"` flag on `BooleanFilterConfig`.** The filter keeps living in `filters`, so chips, `isFiltered`, `resetOffset`, persistence (where a list opts in) and announcements (through `onFilterValueChange`) all come for free. It renders as a toggle button (`aria-pressed`) beside the Filter button instead of a popover `Switch`. Turning it off sets `[]`, not `"false"`.
**B. A separate `quickFilters` prop with its own state.** It would duplicate every behaviour A inherits.
**C. A generic `toolbarSlot?: ReactNode`.** That's the most flexible, but it bypasses filter state, chips and announcements: it's exactly the per-list wiring the ticket rules out.

| | A | B | C |
|---|---|---|---|
| Chips / announcements / persistence for free | ✓ | re-implemented | ✗ |
| Favorite-specific code in the toolbar | none | none | none |
| Unconfigured list unchanged | ✓ | ✓ | ✓ |

**Lean: A.** A quick toggle's chip reads "{label}" rather than "{label}: Yes". The toolbar is unchanged for any list that doesn't set `placement`.

### Decision 7 — The star control

- **Component.** A pure `FavoriteToggle` UI component (an `IconButton` with `aria-pressed`, `aria-label` "Favorite {name}" / "Unfavorite {name}", and `pendingGate` while saving), with a container wiring the SDK mutation.
- **Placement.** It needs a slot, because neither `DetailCard` nor `PageHeader` has room beside the title. Add a generic `titleAction?: ReactNode` to both in core, so the star sits next to the name in every card and detail header and keeps working within `isControlClick`.
- **Icon.** The station default uses Star today, but #1114 removes the default station once favorites land.
  - **A.** Favorites take Star, and the station default moves to another icon (e.g. `Home`).
  - **B.** Favorites use a heart (`IconName.Favorite`).
  - **C.** Favorites take Star, and the default keeps its star until #1114 removes it.

**Lean: C.** The ticket, the AC and every launcher mock say "star". Moving an icon that #1114 is about to delete (A) is wasted work. The overlap lasts only between the two merges and appears only on the one default station's card: there the default shows as a labelled "Default" chip plus a "Set as default" menu item, and the favorite as an `aria-pressed` toggle named "Favorite {name}". No optimistic update: the mutation invalidates the type's `.root` key and the button holds `pendingGate` until the request settles, per Mutation Cache Invalidation.

## Tradeoff comparison

| | Per-type FK table | Hard delete | Generic route | Shared read-check | Always-on `isFavorite` | `placement: "toolbar"` | Star + `titleAction` |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| New pattern | no (0138) | small | small | refactor | no | yes (toolbar) | yes (core slot) |

## Recommendation

1. Add a `favorites` table with `user_id`, `organization_id`, nullable `station_id`/`portal_result_id`/`curated_view_id`/`connector_instance_id` FKs (`onDelete: cascade`), CHECK `num_nonnulls(...) = 1`, a non-partial unique index per type on `(user_id, <col>)`, and an `(organization_id, user_id)` index. Migration `0142`, schema-only, no backfill. Add a core `Favorite` model, `FAVORITE_TARGET_TYPES`, drizzle-zod schemas and type checks.
2. Favorite rows are always hard-deleted: on unstar, inside each object's delete transaction (station, pin, view `deleteByIds`, connector), and on member removal. Org delete and reset sweep by `organization_id`.
3. Add `PUT` and `DELETE /api/favorites/:type/:id`. Both require read on the object (404 otherwise, the same for both verbs), take `user_id` from the context, and lock the live target `FOR SHARE` before inserting. Both answer `200 { isFavorite }` idempotently and declare `locks: { none }`, with `@openapi` docs and route-map entries.
4. The readable-target loader is shared by tags and favorites, not duplicated.
5. The four list and detail responses always carry `isFavorite` from one batched per-page lookup. The four list contracts accept `favorite=true` only, applied as an IN-subquery ANDed with the visibility predicate.
6. `BooleanFilterConfig` gains `placement?: "popover" | "toolbar"`. A toolbar toggle renders as an `aria-pressed` button beside Filter, sets `["true"]` or `[]`, and reuses chips, `isFiltered`, announcements and any opted-in persistence.
7. `DetailCard` and `PageHeader` gain `titleAction?: ReactNode`. A `FavoriteToggle` (UI + container) fills it on the four list cards and four detail pages. The station default's star is left alone because #1114 removes it.
8. The favorites-only empty state is its own explainer, shown when `filters.favorite` is active and nothing matches. It says how to star an item and links to the new FAQ entry.
9. Docs: a glossary "Favorite" term (related to Station, Pinned Result, Curated View, Connector Instance), the FAQ "How do favorites work?", mentions in those four terms' definitions, and a Help-search alias for "star".

## Open questions

1. **Persistence.** The AC says the filter "persists like other filters", but none of the four lists persists any filter today. Lean: "favorites only" behaves exactly like its siblings (in memory), and making those lists persist is a separate change. If you want persistence, all four lists opt in through `useStorage`, as `curated-view-table.util.ts` does.
2. **"Help entries for the Stations, Pinned results, Views and Connectors pages"** don't exist as such. Lean: satisfy this through the glossary terms those pages link to, the new FAQ and the empty-state link (Recommendation 9).
3. **Member removal atomicity.** `SeatService.removeMember` isn't transactional. Lean: put the `organization_users` soft delete and the favorites delete in one transaction, leaving the other steps as they are. That meets the "same operation" AC without reworking the seat flow.
4. **Agent tool output.** `StationQueryService.listForCaller` also backs `station_list`. Lean: attach `isFavorite` in the route layer, so tool results don't change (agent support is out of scope).
5. **"Toggles or actions" in the slot.** The ticket mentions actions too. Lean: toggles only for now. An action has no filter state and no caller in this ticket, and the slot's config shape can take one later without re-plumbing.

## Enterprise-scale considerations

- **Concurrency & correctness.**
  - An idempotent `INSERT … ON CONFLICT DO NOTHING` on the unique index makes double-clicks and parallel tabs harmless, and so does `useAuthMutation`'s in-flight dedupe.
  - `FOR SHARE` on the live target row stops a star from landing after an object delete's sweep has run.
  - A hard-deleted object is covered by FK cascade.
  - Lean: no row-count reads before writes; the database enforces uniqueness.
- **Accuracy & auditability.** N/A because a favorite is a personal preference with no billing or compliance meaning. No audit entry is written (member removal's own audit entry covers that event).
- **Failure modes.** A failed favorite write is a normal error with a toast, and the star shows the server's state after refetch. The `isFavorite` lookup failing fails the list request rather than reporting every row as unstarred. Lean: fail-closed, the same as the capability attach.
- **Scale & unbounded growth.**
  - Rows are bounded by users × objects in an org, and hard delete means no tombstones.
  - The per-page lookup is one indexed query over ≤ page-size ids. The filter subquery reads the `(user_id, <col>)` index.
  - Lean: no cap.
- **Multi-tenancy.** Every row carries `organization_id`, both verbs load the object org-scoped first, and `user_id` comes only from the context. No route lists another user's favorites, owner and admin included. The org-delete sweep keys on `organization_id`.
- **Contract stability.**
  - A new type is a column, an index, and an enum value.
  - The `/api/favorites/:type/:id` surface and `FavoriteRowFields` are what the Launcher/palette epics will read.
  - Lean: favorites are free on every tier and not entitlement-gated, since they meter no cost (capability tiering is about toolpacks).
- **Data lifecycle.** Rows live until the user unstars, the object is deleted, the user leaves the org, or the org is deleted. Lean: no retention window is needed, because hard delete leaves nothing to purge.

## What this doesn't decide

- **The dashboard, header launcher, command palette and sidebar favorites.** Those are their own epics, which read this data later.
- **Other favoritable types** (entities, column definitions, groups, toolpacks). Out of scope per the PRD, though Decision 1's shape takes them as columns.
- **Removing the org-wide default station.** That's #1114, which lands after this ticket.
- **Ordering favorites first, or a user-chosen favorites order.** Explicitly excluded by the AC.
- **Agent tools for favorites.** Out of scope, and Open question 4 keeps tool output unchanged.
- **A `GET /api/favorites` listing across types.** No caller in this ticket; the launcher epic adds it with its real query shape.
- **Filter persistence for the four lists.** See Open question 1.

## Next step

`docs/FAVORITES.spec.md` pins the table and migration `0142`, the core model and contracts, the two routes and their route-map entries, the read-check refactor, the four list and detail changes, the toolbar `placement` option, the core `titleAction` slots, and the docs entries. `docs/FAVORITES.plan.md` then slices roughly:
1. the model, table and repository;
2. the shared target reader and the favorite routes;
3. `isFavorite` and the filter on the four types;
4. delete and member-removal sweeps;
5. the toolbar quick-filter slot;
6. the core `titleAction` slots and `FavoriteToggle`;
7. wiring the four lists and four detail pages, with the empty state;
8. Help content.
