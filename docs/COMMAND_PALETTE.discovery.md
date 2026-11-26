# Command palette — Discovery

**Issue:** [EnterpriseBT/portal-ai#1076](https://github.com/EnterpriseBT/portal-ai/issues/1076) · Launcher epic [#1084](https://github.com/EnterpriseBT/portal-ai/issues/1084)

**Why this exists.** Favorites (#1072) and tags (#1070) make objects easier to find on each list page, but nothing reaches them, or starts common work, from wherever the user is. The Launcher epic's third surface is a keyboard-first command palette. Opened with ⌘K / Ctrl+K or from a search box in the header, it runs gated actions, jumps to favorites and recently visited objects, and searches every major object type, including by `#tag`.

#1122 already built the palette's pure UI and #1075 wired the header's New portal button. What's missing is everything behind it: a search that is bounded and permission-safe across six types, a source for Recent, a way to launch each create from outside its page, and a global shortcut that knows when to stand down. This is the container and contract that turn #1122's approved Storybook component into the app's palette.

## The current shape

### The palette's UI (#1122, mounted nowhere yet)

| Piece | Location | Note |
|---|---|---|
| `CommandPaletteUI` | `apps/web/src/components/CommandPalette.component.tsx:20-39` | `open`, `onClose`, `query`, `onQueryChange`, `groups`, `loading?`, required `linkComponent`. Live status from `paletteStatusText` (:103); empty, loading and no-match copy built in (:71-87). Its comment (:53-54) leaves search, recents, gates, the ⌘K listener and close-on-navigate to #1076 |
| `CommandPaletteTriggerUI` | `CommandPaletteTrigger.component.tsx:193-221` | `onOpen`, `platform`; `aria-haspopup="dialog"`, `aria-keyshortcuts` |
| Item and group types | `apps/web/src/utils/launcher-items.util.ts:237-292` | `LauncherItem {id,type,name,href,tags?}`, `PaletteAction {id,label,onSelect,gate?,icon?}`, `PaletteGroup`; `paletteOptions` drops `hide` gates. `LauncherItemType = TagTargetType` (:237): **no `portal`** |
| Core `Combobox` | `packages/core/src/ui/Combobox.tsx:10-53` | Link options (`href`) vs action options (`onSelect`, `gate`); Escape left to the Modal |

### Header and portal launch (#1075)

`Authorized.layout.tsx:60-66` renders `NewPortalButton` in the header's right-hand box; the trigger fits beside it. `usePortalLauncher` (`use-portal-launcher.util.ts:95-187`) picks the station (page → last-opened own portal → first favorite), lists favorite stations, gates with `useCreateGate("portal", …)` and owns the create mutation and chooser state. A second call from the palette would make a second mutation, breaking "one create serves every path" (:92-93).

### Data sources

| Type | List route | search | tagIds | favorite |
|---|---|---|---|---|
| Station | `station-query.service.ts:65-93` | name | yes | yes |
| Pin | `portal-results.router.ts:494-533` | name | yes | yes |
| View | `curated-view.service.ts:465-500` | label | yes | yes |
| Connector | `connector-instance.router.ts:196-270` | name | yes | yes |
| Entity | `connector-entity.router.ts:164-224` | key or label | yes | — (not favoritable) |
| Portal | `portal.router.ts:256-275` | **accepted, ignored** (dropped at :256) | — (not taggable) | — |

Every route goes through `ilikeContains` (`filter-sql.util.ts:402`), org scoping and `visibilityPredicate` (`permission-set.ts:309-363`), and pages by offset with a separate `count()`. A `#tag` filter by name needs the tag id first (`GET /api/entity-tags?search=`). `tagIds` goes through `readableTagIds` (`tag-assignment.service.ts:421-447`), so an unreadable tag matches nothing. None of these tables has a name index; `pg_trgm` exists (`drizzle/0126_enable-pg-trgm.sql`) but only on wide-table columns.

### Existing cross-type search

`RbacObjectSearchService.search` (`rbac-object-search.service.ts:53-150`) already holds a per-type `SEARCH_CONFIG` for all six types, with org, ILIKE and `visibilityPredicate`. Its route is gated on custom RBAC and `member.role.assign` (`rbac-object-search.router.ts:67-79`), takes one type per call, has no ordering and no tag or favorite support. `TagAssignmentService.findTargets` (repository :331-368) is the other cross-type reader, used by the agent's `tag_target_list`.

### Creates, recents, shortcuts

- **Creates:** every primary create is a dialog or workflow held in its page's state; none can be deep-linked. Views, entities, groups, column definitions and tags gate with `useCreateGate`. Stations' New Station is **ungated** (`Stations.view.tsx:71-78`). Connectors gate by hand on `canOnResource("connector_instance","create")` (`Connector.view.tsx:89`), and "Import a file" opens `WORKFLOW_REGISTRY["file-upload"]` from local state (:63-72, :125-129). Only Help and Settings read search params (`routes/help.tsx:19`, `routes/settings.tsx:17`).
- **Recents:** nothing tracks visits except portals' `lastOpened` (dashboard `RecentPortalsList`). `useStorage` (`utils/storage.util.ts:31`) wraps localStorage.
- **Shortcuts:** there's no global hotkey utility. The RegionEditor's sheet handles keys on its grid (`use-sheet-keyboard.util.ts:175-202`) and marks itself `data-sheet-surface` (`SheetCanvas.component.tsx:1378`); `EditLayoutPlan.view.tsx:30` mounts it outside any Modal. Core `Modal` renders MUI `Dialog` (`Modal.tsx:208`).

## The design space

### Decision 1 — Search: one endpoint or parallel list calls

**A. Parallel calls** to the six list routes, with `search`, `tagIds`, `limit` and an AbortController. No new API, but every keystroke costs six requests on the shared 300/min bucket (`protected.router.ts:64-69`), six `loadSet`s and six `count()`s; portals need `search` fixed, and `#tag` needs a tag lookup first.

**B. One endpoint, `GET /api/search`.** One `loadSet`, one bounded query per type (limit per type, no `count()`), tag resolution server-side, one request per debounced keystroke. Built on `RbacObjectSearchService`'s config pattern, with no gate beyond each type's read.

| | A | B |
|---|---|---|
| Requests per keystroke | 6 (+1 for `#tag`) | 1 |
| Permission safety | each route's own | one `visibilityPredicate` per type, one place to test |
| New contract | none (plus portal `search`) | route, contract, OpenAPI, auth-map entry |
| Ordering across types | client merges | server orders per type |

**Lean: B.** The rate bucket and per-request `loadSet` make A expensive at typing speed, and one read-scoped endpoint is one place to prove "never reveals an unreadable name".

### Decision 2 — `#tag` resolution

**A.** The client resolves `#fin` to tag ids, then searches with `tagIds`. **B.** The endpoint takes `tag=<text>`, matches readable tags by name (case-insensitive prefix), and returns objects carrying any of them, grouped by type and labelled with the tag.

**Lean: B.** One request, and `readableTagIds` keeps an unreadable tag from matching. `#` alone lists the caller's readable tags as suggestions (from `GET /api/entity-tags`), picking one fills `#name`.

### Decision 3 — Recent

**A. Per-browser store**: `{type,id,visitedAt}` in localStorage, keyed by user and org, capped at 20, recorded when a detail page loads. Ids only, never names; hydrated through the search endpoint's `refs` mode, so a deleted, unshared or other-org object drops out silently (the PRD's rule) and is pruned. Portals come from the server's `lastOpened`. **B. Server table** `recent_visits`, written on every detail view. It follows the user across devices, but it's a write per page view and a new retention policy.

| | A | B |
|---|---|---|
| Cross-device | no | yes |
| Writes | none server-side | one per page view |
| Stale objects | dropped at hydrate | dropped at read |
| New schema | none | table, retention purge |

**Lean: A.** The PRD leaves the source open, and nothing yet needs Recent across devices. Hydrating ids through the read-scoped endpoint satisfies "drop silently, never show a stored name". This is a conscious choice, not a prototype shortcut: B can replace the store later without changing the palette.

### Decision 4 — Favorites source

**A.** Four `favorite=true` list calls (stations, pins, views, connectors). **B.** The search endpoint's empty-query mode returns the caller's favorites across types, in one request.

**Lean: B.** Same reasoning as Decision 1: the palette opens with one request, not four.

### Decision 5 — Launching creates from anywhere

**A. Deep link:** each page reads a `?create=<kind>` search param once at mount (Settings' read-once shape, #284) and opens its own dialog; the palette navigates there. **B. Global dialogs:** mount each create dialog in the palette's container. Their mutations, invalidation and post-create navigation live in each view today, so B duplicates or uproots them.

**Lean: A.** The page keeps owning its dialog, the action is a router link, and the param is one sanitizer per route. New portal is the exception: it's an action, not a link, through #1075's launcher, which moves into a provider so the header and palette share one create and one chooser.

### Decision 6 — The shortcut

A document keydown listener for ⌘K / Ctrl+K that stands down when: the event's target is editable (input, textarea, contenteditable); the target is inside `[data-sheet-surface]`; or a dialog is open (`[role="dialog"]` in the document). Pressing it while the palette is open closes it. **Lean: as described**, in a `useCommandPaletteShortcut` util, with a test per guard.

## Tradeoff comparison

| | One `/api/search` | Server `#tag` | Per-browser Recent | Favorites in search | `?create=` deep links | Guarded shortcut |
|---|---|---|---|---|---|---|
| New API contract | yes | yes (param) | yes (`refs`) | yes (mode) | no | no |
| New schema | no | no | no | no | no | no |
| Spread to spec | yes | yes | yes | yes | yes | yes |

## Recommendation

1. Add `GET /api/search`, one endpoint with three modes: `q` (name search across stations, pins, views, connectors, entities and the caller's portals), `tag` (objects carrying readable tags matching the text, prefix), and none (the caller's favorites). It returns `{type,id,name,tags}` grouped by type, at most 5 per type, never a count.
2. Each type is filtered by org, not deleted, and its `visibilityPredicate`, from one `loadSet`; entities use their key-or-label match, portals their own visibility (#1127). Its auth-map entry is `authorized` with that reason.
3. A `refs` parameter (up to 20 `type:id`) returns the readable subset, for Recent's hydration.
4. Recent is a per-user, per-org localStorage list of `{type,id,visitedAt}`, capped at 20, recorded on detail pages, hydrated through `refs`; portals use `lastOpened`. Unreadable or missing entries are pruned.
5. Add `portal` to `LauncherItemType`, with its icon and noun.
6. Actions: New portal through the shared launcher (lifted into a provider), plus New station, Import a file, New view, New entity, New tag, as links to `?create=<kind>` on their pages. Each is gated with `useCreateGate` like its page button; New Station's page button gets the same gate.
7. A guarded ⌘K / Ctrl+K listener, a header trigger beside New portal, and the palette closing after any navigation.
8. Search is debounced (200 ms), cancels the previous request on a new query, and the API bounds it per type.
9. Docs: glossary (Favorite, Tag), FAQ (palette and shortcut, `#tag`), troubleshooting if a search can't find something, and the ACR rows the survey named.

## Open questions

1. **Which creates are actions?** The PRD names New portal, New station, Import a file, New view "and the other primary creates". Lean: also New entity and New tag; leave groups, column definitions and policies to their pages (admin-only work, not launch work).
2. **Does New station's ungated page button get its gate here?** Lean: yes, in this PR: the palette must gate it, and the page shouldn't disagree with the palette.
3. **Search ranking within a type.** Lean: prefix matches before substring, then by name; favorites flagged with a star but not reordered.
4. **Does a search include tags themselves** (jump to a tag's page)? Lean: no; `#` is the tag path, and tags have no detail page worth jumping to.
5. **Rate limit for `/api/search`.** Lean: the shared API bucket. One request per debounced keystroke is well inside 300/min; a separate bucket is #705's answer to fan-out, which this doesn't have.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because the endpoint is read-only; the client cancels a superseded request, so a slow response can't overwrite a newer one. Lean: the container ignores a response whose query isn't the current one.
- **Accuracy & auditability:** N/A because nothing is written. Recent is a convenience, not a record.
- **Failure modes:** Lean: a failed search shows the palette's error state and keeps actions and favorites usable; Recent's storage failing (private mode) shows no Recent. Fail closed on reads: each type's predicate is applied or the type returns nothing.
- **Scale & unbounded growth:** Lean: 5 per type, 20 refs, no `count()`, debounce plus cancellation; ILIKE without an index is acceptable at today's table sizes, since each query is org-scoped and limited. A trigram index on the name columns is the follow-up if a table grows past that, measured against a production-sized org, not asserted in tests.
- **Multi-tenancy:** Lean: org from the request only; Recent keyed by org so an org switch never shows another org's ids, and hydration drops them anyway.
- **Contract stability:** Lean: `type` in the response is the shared `LauncherItemType`, so a future type (dashboards) adds a config row, not a new endpoint.
- **Data lifecycle:** Lean: Recent capped at 20 and pruned on hydrate; no server retention.

## What this doesn't decide

- Cross-device Recent (a server record): deferred until something needs it (Decision 3).
- Name indexes: measured first, added only when a real table needs one.
- Searching records, field mappings, column definitions, groups or policies: out of the PRD's scope.
- The sidebar Favorites group (#1077), which may reuse this endpoint's favorites mode.

## Next step

`docs/COMMAND_PALETTE.spec.md` pins the endpoint's contract (query, response, per-type config, auth-map entry, OpenAPI), the Recent store, the `?create=` params and the shortcut's guards. `docs/COMMAND_PALETTE.plan.md` likely slices it as: the search endpoint with its read-safety tests; the portal search fix and launcher provider; the `?create=` deep links and New Station's gate; the palette container with shortcut, trigger and Recent; then docs and the ACR.
