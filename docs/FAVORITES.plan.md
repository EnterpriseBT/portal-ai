# Favorites — Plan

**This plan implements personal favorites test-first. It goes from the data model to the read-gated favorite routes, then `isFavorite` and the filter on the four types, the delete and membership sweeps, the generic toolbar quick-filter, the star control and its wiring, and finally Help content.**

Spec: `docs/FAVORITES.spec.md`. Discovery: `docs/FAVORITES.discovery.md`. Issue: #1072. It builds on the shipped #1070: the tag-assignment table shape, `insertIfAbsent`/`lockLiveTarget`, `TagAssignmentService`'s target descriptors, and the shared tag list fields. #1114 (removing the default station) follows this PR.

There are nine slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as a **commit on `feat/1072-favorites`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly, per `feedback_use_npm_test_scripts`), passing `--testPathPattern` for the touched files:

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. write failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. run `npm run lint && npm run type-check` in each touched package at the boundary;
5. move on to the next slice.

Sequencing rationale:

- **Slice 1:** the core model and contract building blocks, with no consumer yet.
- **Slice 2:** the table, migration and repository. Every later API slice reads or writes through it.
- **Slice 3:** the shared readable-target loader and the two routes. After this, a favorite can be set, but nothing reads it yet.
- **Slice 4:** `isFavorite` and `favorite=true` on the four types. This is the read side the web needs.
- **Slice 5:** the sweeps. They come after the routes so their tests can create favorites through the real path. They're server-side only and come before any web slice, so no user ever sees a dangling favorite.
- **Slice 6:** the toolbar `placement` option, generic and web-only, with no favorite code. It's independent of slices 1–5 but placed here so web work is contiguous.
- **Slice 7:** the core `titleAction` slots, the SDK, `FavoriteToggle` and the empty-state component, each tested alone.
- **Slice 8:** wiring the four lists and four detail pages. It's the only slice that needs everything before it.
- **Slice 9:** the content (glossary, FAQ, help search).

---

## Slice 1 — Core model and contract

The `Favorite` model and the favorite contract's building blocks. The four list contracts don't change yet; slice 4 spreads the fields into them together with the routes that honor them.

**Files**

- New: `packages/core/src/models/favorite.model.ts`: `FAVORITE_TARGET_TYPES`, `FavoriteTargetSchema`, `FAVORITE_TARGET_COLUMNS`, and `FavoriteSchema` with the exactly-one-target refine, plus `FavoriteModel`/`FavoriteModelFactory`.
- New: `packages/core/src/contracts/favorite.contract.ts`: `FavoriteParamsSchema`, `FavoriteResponsePayloadSchema`, `FavoriteListQueryFields`, `FavoriteRowFields`.
- Edit: the models and contracts barrels.
- New tests: `__tests__/models/favorite.model.test.ts` and `__tests__/contracts/favorite.contract.test.ts`, covering the params and `favorite` field cases only. The four-list case lands in slice 4.

**Steps**

1. **Tests (spec Core cases: model ≈6, contract ≈6).**
   - A refine rejects zero or two targets.
   - The target types are a subset of `TAG_TARGET_TYPES`.
   - The column map is complete.
   - The params reject an unknown type and an extra key.
   - `favorite` accepts `"true"` and rejects `"false"`.

   Run them and watch them fail.
2. **Implement** the two files and the barrel exports. Green.
3. Lint and type-check in core. Run `npm run build --workspace=packages/core` (NodeNext needs `.js` on relative imports).

**Done when:** the core cases pass and the core build succeeds. Nothing outside core imports the new files yet.

**Risk:** none.

---

## Slice 2 — Table, migration, repository

The `favorites` table and `FavoritesRepository`, proven directly against the database.

**Files**

- New: `apps/api/src/db/schema/favorites.table.ts`.
- Edit: `db/schema/index.ts`, `zod.ts` (`FavoriteSelectSchema`/`FavoriteInsertSchema`), `type-checks.ts`.
- New: `apps/api/src/db/repositories/favorites.repository.ts`, with every method in the spec's repository table.
- Edit: `db/repositories/index.ts`, `services/db.service.ts` (`repository.favorites`).
- New: `drizzle/0142_add-favorites.sql`, `drizzle/meta/0142_snapshot.json`; edit `drizzle/meta/_journal.json`. Generate with `npm run db:generate -- --name add-favorites` and apply with `npm run db:migrate`.
- New: `src/__tests__/__integration__/db/favorites.repository.integration.test.ts`.

**Steps**

1. **Tests (repository behavior underpinning spec API cases).**
   - `insertIfAbsent` twice gives one row, and `created` is true then false.
   - Parallel inserts give one row.
   - The CHECK refuses a row with no target.
   - `deleteFor` returns 0 then 1.
   - `favoritedIds` returns only the caller's ids, and `[]` runs no query.
   - The `favoritedBy` predicate narrows a stations query.
   - `hardDeleteByTargets`, `hardDeleteByUser` and `hardDeleteByOrganization` delete exactly their scope.
   - `lockLiveTarget` returns false on a deleted row.
   - A hard delete of a station cascades.

   Run them and watch them fail.
2. **Implement** the table, migration and repository. Green.
3. Run `npm run lint:migrations`, then lint and type-check.

**Done when:** the repository suite passes, migration 0142 applies on a fresh database, and the dual-schema type checks compile.

**Risk:** a partial index needs its predicate restated in `ON CONFLICT`. This one isn't partial by design (spec Key decision 2), so the conflict target is just `(<col>, user_id)`.

---

## Slice 3 — Shared target reader, `FavoriteService`, routes

`TARGETS` is extracted into `ObjectTargetService` with no change to tag behavior. Then `FavoriteService` and `PUT`/`DELETE /api/favorites/:type/:id` are added and classified.

**Files**

- New: `apps/api/src/services/object-target.service.ts`.
- Edit: `services/tag-assignment.service.ts` reads from it.
- New: `services/favorite.service.ts` and `routes/favorite.router.ts`.
- Edit: `routes/protected.router.ts` mounts the router at `/favorites`.
- Edit: `constants/api-codes.constants.ts` adds `FAVORITE_INVALID_PAYLOAD` and `FAVORITE_UPDATE_FAILED`.
- Edit: `config/swagger.config.ts` registers the `FavoriteResponsePayload` component.
- Edit: `__tests__/config/route-authorization.map.ts` adds both entries with `locks: { none }`.
- New tests:
  - `__integration__/services/object-target.service.integration.test.ts` (≈6);
  - `__integration__/routes/favorite.router.integration.test.ts` (≈16);
  - `__tests__/services/favorite.service.test.ts` (≈3).

**Steps**

1. **Tests (spec object-target ≈6, favorite.router ≈16, favorite.service ≈3).**
   - A read-only member can PUT and DELETE all four types.
   - The calls are idempotent.
   - The four kinds of unreadable object (unreadable, cross-org, deleted, missing) answer 404 to both verbs.
   - An unknown type or a body answers 400.
   - Concurrent PUTs leave one row.
   - A PUT racing an object delete leaves no favorite: one transaction holds the object row `FOR UPDATE` while the PUT runs.
   - Errors are wrapped.

   Run them and watch them fail.
2. **Implement** the extraction first, and re-run the existing tag suites: `tag-assignment*`, `tag-*-tools`, `entity-tag*`. They must stay green unchanged. Then add the service, the router, the codes, the swagger component and the route map. Green.
3. Lint and type-check. The route-authorization guard must pass.

**Done when:** the new suites and every existing tag suite pass, and the route map has no unclassified route.

**Risk:** the extraction touches #1070's tag paths. Keep it a pure move and diff the tag test names before and after (`feedback_scripted_test_edits_diff_names`).

---

## Slice 4 — `isFavorite` and `favorite=true` on the four types

This is the read side. The field and the filter land together with the contract spreads.

**Files**

- Edit, core: spread `FavoriteListQueryFields` and `FavoriteRowFields` into `station.contract.ts`, `portal.contract.ts`, `curated-view.contract.ts` and `connector-instance.contract.ts`. Add the four-list case to `favorite.contract.test.ts`.
- Edit, API:
  - `services/station-query.service.ts` (`opts.favorite`), `routes/station.router.ts` (list and detail);
  - `routes/portal-results.router.ts` (list and detail);
  - `routes/connector-instance.router.ts` (list and detail);
  - `services/curated-view.service.ts` (`opts.favorite`), `routes/curated-view.router.ts` (list and detail);
  - each route's `@openapi` block gets the `favorite` query parameter and the `isFavorite` row field.
- New tests: `__integration__/routes/favorite-lists.integration.test.ts` (≈24), plus a `station_list` tool assertion (no `isFavorite`) in the existing station tool suite (≈1).

**Steps**

1. **Tests (spec favorite-lists ≈24, tool-output ≈1, contract four-list ≈1).**
   - Per type:
     - `isFavorite` reflects only the caller's own stars, and the owner can't see a member's;
     - `favorite=true` narrows the list;
     - it composes with `search`, `tagIds` and paging totals;
     - the sort order is unchanged;
     - `favorite=false` answers 400;
     - revoking access hides a favorite, and restoring access shows it starred again;
     - the detail response carries `isFavorite`.
   - The `station_list` tool output is unchanged.

   Run them and watch them fail.
2. **Implement** the filter in the query builders and the per-page `favoritedIds` attach in each router handler. Green.
3. Rebuild core, then lint and type-check in core and the API.

**Done when:** the list and detail suites pass, and the existing station, pin, connector and view list suites still pass.

**Risk:** the curated-view list is the only one built inside a service. Attach `isFavorite` in its router, not in `CuratedViewService.list`, so the agent's view tools stay unchanged (spec Key decision 5).

---

## Slice 5 — Sweeps

Every path that ends an object or a membership deletes the related favorites in its own transaction.

**Files**

- Edit:
  - `routes/station.router.ts` (delete transaction);
  - `routes/portal-results.router.ts` (delete transaction);
  - `services/curated-view-delete.service.ts` (`deleteByIds`);
  - `routes/connector-instance.router.ts` (the delete inside `withUnlocked`);
  - `services/seat.service.ts` (the membership soft delete and `hardDeleteByUser` in one `DbService.transaction`);
  - `services/organization-delete.service.ts` (before any target table is deleted);
  - `services/reset.service.ts`.
- New tests: `__integration__/services/favorite-sweeps.integration.test.ts` (≈10).

**Steps**

1. **Tests (spec favorite-sweeps ≈10).**
   - Deleting each type removes every user's favorite of it, including views removed by an entity delete and a connector delete.
   - Removing a member deletes only their favorites, only in that org, and a re-invite starts with none.
   - Org delete and reset clear the org's favorites.
   - When the member-removal transaction fails, both the membership and the favorites stay.

   Run them and watch them fail.
2. **Implement** the seven call sites. Green.
3. Lint and type-check. Re-run the existing station, pin, view, connector, seat, org-delete and reset suites.

**Done when:** the sweep suite and those existing suites pass.

**Risk:** an org delete that hard-deletes a target table before the favorites goes through FK cascade anyway. Placing the sweep first, beside the tag assignments, keeps the order explicit.

---

## Slice 6 — Toolbar quick-filter slot

A generic `placement: "toolbar"` option for boolean filters, with no favorite code.

**Files**

- Edit: `apps/web/src/components/PaginationToolbar.component.tsx`:
  - add `placement` to `BooleanFilterConfig`;
  - filter toolbar filters out of the popover;
  - render the pressed toggle beside the Filter button;
  - the chip reads the bare label, and deleting it clears the filter.
- Edit: `apps/web/src/__tests__/PaginationToolbar.test.tsx` (≈8).

**Steps**

1. **Tests (spec PaginationToolbar ≈8).**
   - The toggle renders outside the popover with `aria-pressed`.
   - Clicking it sets `["true"]` and then `[]`, never `"false"`.
   - The chip shows the label, and deleting it clears the filter.
   - The results announcer fires.
   - `isFiltered` becomes true.
   - An unconfigured toolbar renders unchanged (existing snapshot and assertions).
   - No axe violations.

   Run them and watch them fail.
2. **Implement.** Green.
3. Lint and type-check in web.

**Done when:** the toolbar suite passes and no list's existing tests change.

**Risk:** clicks must go through the `changed(...)`-wrapped `onFilterValueChange`, or the announcement is lost.

---

## Slice 7 — `titleAction` slots, SDK, `FavoriteToggle`, empty state

The building blocks of the star UI, each tested on its own.

**Files**

- Edit, core: `ui/DetailCard.tsx` and `ui/PageHeader.tsx` (`titleAction`), and their tests (≈6).
- New, web:
  - `api/favorites.api.ts` (and register it in `api/sdk.ts`);
  - `utils/favorite-invalidation.util.ts`, `utils/use-favorite-filter.util.ts`;
  - `components/FavoriteToggle.component.tsx`, `components/FavoritesEmptyResults.component.tsx`;
  - stories for both components;
  - tests `FavoriteToggle.test.tsx` (≈5), `FavoritesEmptyResults.test.tsx` (≈3), `favorite-invalidation.util.test.ts` (≈5).

**Steps**

1. **Tests (spec core UI ≈6, FavoriteToggle ≈5, FavoritesEmptyResults ≈3, SDK/invalidation ≈5).**
   - `titleAction` renders, clicking it doesn't navigate, a card or header without it is unchanged, and there are no axe violations.
   - The toggle carries `aria-pressed` and both labels, calls `onToggle`, and its pending gate keeps focus.
   - The empty state has the right copy and help link.
   - Each type gets the right URL and `favoriteKeys`, and `onPermissionDenied` invalidates them.

   Run them and watch them fail.
2. **Implement.** Green.
3. Rebuild core, then lint and type-check in core and web. The component-axe guard and `dialog-contract`/`action-gate` guards must pass.

**Done when:** every component suite passes. The components aren't rendered by any view yet.

**Risk:** a `pendingGate` on a toggle must not drop focus (#793). Assert focus stays on the button while the request is pending.

---

## Slice 8 — Wire the four lists and four detail pages

**Files**

- Edit:
  - `components/StationList.component.tsx`, `PinnedResultsList.component.tsx`, `ConnectorInstance.component.tsx`, and the inline view cards in `views/CuratedViews.view.tsx` (`titleAction={<FavoriteToggle …/>}`);
  - `views/Stations.view.tsx`, `PinnedResultsListView.view.tsx`, `CuratedViews.view.tsx`, `Connector.view.tsx` (`useFavoriteFilter()`, and `FavoritesEmptyResults` when that filter is the only one active);
  - `views/StationDetail.view.tsx`, `PinnedResultDetail.view.tsx`, `CuratedViewDetail.view.tsx`, `ConnectorInstance.view.tsx` (`titleAction` on `PageHeader`);
  - the matching view and component tests (≈12).

**Steps**

1. **Tests (spec view tests ≈12).**
   - A star renders on each card and in each detail header, named for its object.
   - The "Favorites only" toggle appears on all four lists.
   - The favorites empty state appears only when that filter is active alone. With search added, the generic empty results show instead.

   Run them and watch them fail.
2. **Implement.** Green.
3. Lint and type-check in web.

**Done when:** the view suites pass, and a station card shows both the favorite star and the existing default affordance (#1114 removes the default).

**Risk:** typed fixtures in web tests and stories will need `isFavorite` where their schemas are strict. Add it as the type checker flags them.

---

## Slice 9 — Help content

**Files**

- Edit: `packages/core/src/content/glossary.util.ts` (the "Favorite" term, plus one sentence in Station, Pinned Result, Curated View and Connector Instance) and `faq.util.ts` ("How do favorites work?", alias "star").
- Edit: `glossary.util.test.ts`, `faq.util.test.ts`, `help-findability.test.ts` (≈3).

**Steps**

1. **Tests (spec content ≈3).**
   - The Favorite term exists and its related terms resolve.
   - The FAQ entry exists.
   - A search for "star" finds it.

   Run them and watch them fail.
2. **Implement.** Green.
3. Lint and type-check in core. Check the API and web permission-copy guards (no role-framed wording).

**Done when:** the content suites pass.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Core model + contract blocks | core unit + build |
| 2 | Table, 0142, repository | repo integration + `lint:migrations` |
| 3 | `ObjectTargetService`, `FavoriteService`, routes | router integration + tag suites unchanged + route-map guard |
| 4 | `isFavorite` + `favorite=true` on 4 types | list integration + tool output unchanged |
| 5 | Delete, member, org and reset sweeps | sweep integration + existing delete suites |
| 6 | Toolbar `placement: "toolbar"` | toolbar unit |
| 7 | `titleAction`, SDK, toggle, empty state | component units + guards |
| 8 | Lists + detail wiring | view units |
| 9 | Glossary / FAQ / search | content units |

## Cross-slice notes

- **Core rebuilds.** Slices 1, 4, 7 and 9 change core. Rebuild it (`npm run build --workspace=packages/core`) before API or web runs, and restart the API dev server for any live check, since nodemon doesn't watch core.
- **Commit the drizzle journal and snapshot together with `0142`** (slice 2).
- **Invalidation.** Every favorite mutation passes `invalidate: favoriteKeys(type)` and `onPermissionDenied`. The `.root` key covers both the list and the detail query. Nothing calls `invalidateQueries` in a per-call callback (`mutation-invalidate.guard`).
- **Docs in sync.**
  - Slice 9 carries the user-facing content.
  - Slices 3 and 4 carry the `@openapi` docs.
  - CLAUDE.md's Mutation Cache Invalidation list needs no new delete row, because favorites never cascade on the web side.
  - Nothing changes in `builtin-toolpacks.ts` or `system.prompt.ts`, since agent support is out of scope.
- **The favorite star and the station default's star appear together on purpose until #1114** (discovery Decision 7).

## Next step

Implementation starts on `feat/1072-favorites` with slice 1, tests first, one commit per slice, once this plan is confirmed.
