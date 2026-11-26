# Command palette — Spec

This spec pins the contract for #1076's command palette: a read-scoped `GET /api/search`, the palette's container and shortcut, the per-browser Recent store, the `?create=` deep links, and the changes to #1122's and #1075's pieces. Discovery: `docs/COMMAND_PALETTE.discovery.md`. Issue: [#1076](https://github.com/EnterpriseBT/portal-ai/issues/1076), Launcher epic #1084.

## Key decisions (flag for review)

1. **One endpoint, three modes plus `refs`.** `GET /api/search` takes exactly one of `q` (search by name), `tag` (by tag), or `refs` (hydrate ids); with none it returns the caller's favorites. One `loadSet` per request, at most 5 results per type, no counts.
2. **Read-safety by construction.** Each type is filtered by org, not deleted, and the same `visibilityPredicate(type, …)` its list route uses, so a search can never return what that list wouldn't. An agreement test holds the two together for every type and role.
3. **`#tag` resolves server-side.** `tag=fin` matches readable tags by case-insensitive name prefix (at most 5 tags), then returns objects carrying any of them. An unreadable tag never matches.
4. **Recent is per browser.** localStorage holds `{type,id,visitedAt}` (ids only), keyed by org and user, capped at 20, and hydrated through `refs`. Entries the server doesn't return are pruned, but only after a successful response. Portals aren't kept there: the caller's 5 most recently opened portals (the server's `lastOpened`) get their own "Recent portals" group at home, so an existing portal opens in one step.
5. **Creates are links.** Each index page reads `?create=<kind>`, opens its own dialog when its gate allows, and removes the param (replace). The palette links there. New portal stays an action through #1075's launcher, which moves into a provider so the header and palette share one create.
6. **New Station is gated** (`useCreateGate("station", …)`) on its page and in the palette.
7. **Superseded searches are aborted.** The search query opts into react-query's signal (`meta: { abortable: true }`), and the input is debounced 200 ms.
8. **The shortcut stands down** in an editable target, inside `[data-sheet-surface]`, or while any other dialog is open. Pressing it again closes the palette.

## Scope

### In scope

- Core: the search contract and result types.
- API: `SearchService`, the search router, the auth-map entry and OpenAPI.
- Web:
  - the SDK endpoint;
  - the `CommandPalette` container;
  - `useCommandPaletteShortcut`, `useRecentVisits` and `useDebouncedValue`;
  - `PortalLauncherProvider`;
  - the `?create=` params on five index routes;
  - #1122 component changes (a `portal` item type, link actions, the trigger's icon layout, gated links);
  - New Station's gate;
  - Help and ACR.

### Out of scope

- A cross-device Recent (server record).
- Name indexes.
- Searching records, field mappings, column definitions, groups, policies or tags themselves.
- The sidebar Favorites group (#1077).

## Surface

### Core — `packages/core/src/contracts/search.contract.ts` (new; barrel-exported)

```ts
export const SEARCH_RESULT_TYPES = [
  "station", "pin", "curated_view", "connector_instance", "entity", "portal",
] as const;
export const SearchResultTypeSchema = z.enum(SEARCH_RESULT_TYPES);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

export const SEARCH_PER_TYPE_LIMIT = 5;
export const SEARCH_FAVORITES_PER_TYPE_LIMIT = 10;
export const SEARCH_MAX_REFS = 20;
export const SEARCH_MAX_TAGS = 5;

export const SearchRequestQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    tag: z.string().trim().min(1).max(120).optional(),
    /** Comma-separated `type:id`, at most SEARCH_MAX_REFS; unknown types rejected. */
    refs: z.string().optional(),
  })
  .strict()
  .refine((v) => [v.q, v.tag, v.refs].filter((x) => x !== undefined).length <= 1,
    { message: "Pass at most one of q, tag or refs" })
  .refine(/* refs: each entry `<SearchResultType>:<non-empty id>`, count ≤ SEARCH_MAX_REFS */);

export const SearchResultSchema = z.object({
  type: SearchResultTypeSchema,
  id: z.string(),
  name: z.string(),
  /** Readable tags only; [] for portals (not taggable). */
  tags: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })),
});
export const SearchResponsePayloadSchema = z.object({
  results: z.array(SearchResultSchema),
  /** `tag` mode: the readable tags that matched, for the group label. */
  matchedTags: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
```

`strict-request-bodies.test.ts` doesn't apply (it's a query). `name-length.guard` doesn't apply (no request body).

### API — `apps/api/src/services/search.service.ts` (new)

```ts
export class SearchService {
  static async search(ctx: PermissionContext, query: SearchRequestQuery): Promise<SearchResponsePayload>;
}
```

- **Type config.** `SEARCH_TYPE_CONFIG: Record<SearchResultType, { table, idCol, nameCol, matchCols: PgColumn[], createdByCol, orgCol, deletedCol, favoriteType?: FavoriteTargetType, tagType?: TagTargetType }>`. It reuses `RbacObjectSearchService`'s column choices:
  - names: `stations.name`, `portalResults.name`, `curatedViews.label`, `connectorInstances.name`, `connectorEntities.label`, `portals.name`;
  - an entity matches on `key` or `label`.
- **Base filter (every mode, every type).** `eq(orgCol, ctx.organizationId)`, `isNull(deletedCol)`, and `set.visibilityPredicate(type, {createdByCol, idCol})` when defined. One `PermissionService.loadSet(ctx)` per request.
- **`q` mode.** Every type. Match: `or(...matchCols.map(c => ilikeContains(c, q)))`. Order: prefix match first (`lower(nameCol) LIKE lower(escaped q) || '%'` desc), then `nameCol`, then `idCol`. Limit `SEARCH_PER_TYPE_LIMIT`.
- **`tag` mode.**
  - Find the readable tags: `entityTags` in the org whose name matches `q%` (case-insensitive, escaped), filtered with `ObjectAccessService.readableInOrg(set, org, "tag", tag)`, ordered by name, at most `SEARCH_MAX_TAGS`.
  - No readable match → `{ results: [], matchedTags: [] }`.
  - Otherwise, for each type with a `tagType`, apply `entityTagAssignments.taggedWithAny(tagType, idCol, tagIds)`, ordered by name, limit `SEARCH_PER_TYPE_LIMIT`.
  - Portals are skipped.
- **No mode (favorites).** Each type with a `favoriteType` (station, pin, curated_view, connector_instance) filters with `FavoriteService.onlyFavorites(ctx, favoriteType, idCol)`, ordered by name, limit `SEARCH_FAVORITES_PER_TYPE_LIMIT`.
- **`refs` mode.** Group the refs by type, then for each type run `inArray(idCol, ids)` plus the base filter. Results come back in the request's order, and an id the caller can't read (or that is deleted or in another org) is absent, with no error.
- **Tags on results.** `TagAssignmentService.tagsForTargets(set, tagType, ids)` per taggable type with results; a portal gets `[]`.
- **Result order.** Types in `SEARCH_RESULT_TYPES` order, each type's rows in its own order (`refs` excepted).
- Types are queried with `Promise.all`.

### API — `apps/api/src/routes/search.router.ts` (new), mounted `protectedRouter.use("/search", searchRouter)`

- `GET /api/search`: `SearchRequestQuerySchema.safeParse(req.query)`. On failure it answers `invalidPayload(ApiCode.SEARCH_INVALID_QUERY, "search query", parsed.error)`. On success it returns `HttpService.success(res, payload)`.
- The DB cancel policy is `setDbCancelPolicy("always")`, since the route is read-only and a superseded search is safe to stop mid-statement.
- `ApiCode.SEARCH_INVALID_QUERY` is added in `apps/api/src/constants/api-codes.constants.ts`.
- `route-authorization.map.ts`: `"GET /api/search": { kind: "authorized", by: "org filter + visibilityPredicate per type, readable tags only (#1076)" }`.
- OpenAPI: an `@openapi` block with tag `Search`, the parameters `q`, `tag` and `refs`, 200 `$ref: SearchResponse` and 400 `ApiErrorResponse`. Register `SearchResponse` (`z.toJSONSchema(SearchResponsePayloadSchema)`) in `swagger.config.ts`, and add `Search` to the tag list.
- Shared API rate bucket; no gate beyond each type's read.

### Web — `apps/web/src/api/search.api.ts` (new), on `sdk.search`

```ts
search: {
  query: (params: SearchRequestQuery, options?: QueryOptions<SearchResponsePayload>) =>
    useAuthQuery(queryKeys.search.query(params), `/api/search?${qs(params)}`, undefined,
      { meta: { abortable: true }, placeholderData: keepPreviousData, ...options }),
}
```

- `queryKeys.search = { root: ["search"], query: (p) => ["search", p] }` goes in `api/keys.ts`.
- **Freshness.** The search query sets `staleTime: 0`, and the palette enables its queries only while it's open, so every open refetches. A create, rename, delete or star therefore shows the next time the palette opens, without adding the search key to each mutation's invalidation helpers.
- **`useAuthQuery` (`utils/api.util.ts:290`).** Pass `context.signal` when `queryOptions.meta?.abortable === true` (as well as during a read pause). React Query then aborts the superseded fetch when the key changes.

### Web — palette types (`apps/web/src/utils/launcher-items.util.ts`)

- `LauncherItemType = SearchResultType` (it adds `portal`).
- `LAUNCHER_TYPE_ICON.portal` is the sidebar's portal icon. `launcherTypeNoun("portal")` is `"portal"`.
- `PaletteAction` gains `href?: string`. Exactly one of `href` or `onSelect` is set. `paletteOptions` passes `href` through.
- `toLauncherItem(result: SearchResult): LauncherItem` maps each result to its detail route:
  - station → `/stations/:id`
  - pin → `/portal-results/:id`
  - curated_view → `/views/:id`
  - connector_instance → `/connectors/:id`
  - entity → `/entities/:id`
  - portal → `/portals/:id`
- `parsePaletteQuery(raw: string): { mode: "home" } | { mode: "search"; text: string } | { mode: "tag"; text: string }`. The input is trimmed. A leading `#` selects tag mode, with the text after it trimmed; an empty result is home mode.
- `RESULT_GROUP_LABEL: Record<SearchResultType, string>` holds the plural labels "Stations", "Pinned results", "Views", "Connectors", "Entities", "Portals".

### Core — `Combobox` (`packages/core/src/ui/Combobox.tsx`)

- A link option with a `disable` or `upsell` gate renders as a non-link option (no `href`), so a click can't navigate. The `upsell` gate still calls `onUpgrade` on pick.

### Web — #1122 component changes

- `CommandPaletteTriggerUI` gains `layout?: "full" | "icon"`, defaulting to `"full"`. Icon form is an `IconButton` named "Search or run…" with the same `aria-keyshortcuts` and `aria-haspopup="dialog"`. The story gains an Icon variant.
- `CommandPaletteOptionUI`: a portal row reads `{name} · portal`.

### Web — `apps/web/src/providers/PortalLauncher.provider.tsx` (new)

`PortalLauncherProvider` calls `usePortalLauncher()` once and exposes it through context. `usePortalLauncherContext()` returns it, and throws outside the provider. The provider is mounted in `Authorized.layout.tsx`, around the header and main. `NewPortalButton` reads the context instead of calling the hook, and the palette reads the same instance, so there's one create mutation, one pending state and one chooser. `NewPortalButton` keeps rendering the chooser dialog; the palette's "Choose station…" calls the launcher's chooser opener after closing itself.

### Web — `apps/web/src/utils/use-command-palette-shortcut.util.ts` (new)

```ts
export function isPaletteShortcut(e: KeyboardEvent, platform: "mac" | "other"): boolean;
export function useCommandPaletteShortcut(opts: { open: boolean; onToggle: () => void; platform: "mac" | "other" }): void;
export function detectPlatform(): "mac" | "other";
```

- **`isPaletteShortcut`.** True when `e.key` is `k` or `K` with `metaKey` (mac) or `ctrlKey` (other), and neither `altKey` nor `shiftKey` is held.
- **When the listener acts.** The listener is on `document` (keydown). It returns early unless `isPaletteShortcut` holds and the event isn't already `defaultPrevented`. When the palette is open, the shortcut closes it.
- **When the listener stands down.** While the palette is closed, it does nothing when the target is editable (`input`, `textarea`, `select`, `[contenteditable]`, `role="textbox"`), when the target is inside `[data-sheet-surface]`, or when any `[role="dialog"]` is in the document.
- **Otherwise** it calls `preventDefault()` and toggles the palette.
- **`detectPlatform`.** Reads `navigator.userAgentData?.platform ?? navigator.platform` and returns `"mac"` for Mac, iPhone or iPad.

### Web — `apps/web/src/utils/use-recent-visits.util.ts` (new)

```ts
export interface RecentVisit { type: Exclude<SearchResultType, "portal">; id: string; visitedAt: number }
export const RECENT_VISITS_MAX = 20;
export function recentVisitsKey(organizationId: string, userSub: string): string; // "portalai-recent:<org>:<sub>"
export function recordVisit(list: RecentVisit[], visit: RecentVisit): RecentVisit[]; // dedupe by type+id, newest first, cap 20
export function pruneVisits(list: RecentVisit[], readable: Set<string>): RecentVisit[]; // keep `${type}:${id}` in set
export function useRecentVisits(): { visits: RecentVisit[]; record: (v: Omit<RecentVisit, "visitedAt">) => void; prune: (readable: Set<string>) => void };
export function useRecordRecentVisit(type: RecentVisit["type"], object: { id: string; organizationId: string } | null | undefined): void;
```

- **Storage.** A small store on `useSyncExternalStore` (not `useStorage`, which reads its key once and doesn't sync between hook instances). Every storage access is wrapped, and any failure reads as `[]`. The user key is Auth0's `user.sub` from `AuthContext`. The palette reads under `sdk.organizations.current()`'s id; until both are known it doesn't read or write.
- **Recording.** `useRecordRecentVisit` records the loaded object under the object's own `organizationId`, so a detail view needs no extra query. It's called by `StationDetail`, `PinnedResultDetail`, `CuratedViewDetail`, `ConnectorInstance` and `EntityDetail` with their GET's row; a 404 has no row, so it never records.

### Web — `apps/web/src/utils/use-debounced-value.util.ts` (new)

`useDebouncedValue<T>(value: T, ms: number): T`.

### Web — `CommandPalette` container (`apps/web/src/components/CommandPalette.component.tsx`, beside `CommandPaletteUI`)

`interface CommandPaletteProps { open: boolean; onClose: () => void }`. It owns `query` and resets it when it closes.

- **Request by mode.** The debounced (200 ms) query drives `parsePaletteQuery`:

  | Mode | Request |
  |---|---|
  | home | `sdk.search.query({})` for favorites; `sdk.search.query({ refs })` for Recent, with refs from `useRecentVisits` (skipped when empty); `sdk.portals.list({ mine: "true", sortBy: "lastOpened", sortOrder: "desc", limit: 5 })` |
  | search | `sdk.search.query({ q: text })` |
  | tag, with text | `sdk.search.query({ tag: text })` |
  | tag, no text | `sdk.entityTags.list({ limit: 8, sortBy: "name" })` |

  Each query is `enabled` only in its mode and while the palette is open.
- **Groups by mode.**
  - **Home:** "Actions", then "Favorites", then "Recent portals" (the caller's 5 most recently opened portals, by `lastOpened` descending), then "Recent" (the hydrated refs, newest first, at most 8).
  - **Search:** "Actions" (those whose label contains the text, case-insensitive), then one group per result type, labelled from `RESULT_GROUP_LABEL`.
  - **Tag with text:** one group labelled `Tagged “<matchedTags[0].name>”` when one tag matched, or `Tagged “<text>…”` when several did, holding every result.
  - **Tag with no text:** one "Tags" group of actions labelled `#<name>`, each setting the query to `#<name>`.
- **Pruning.** After a successful `refs` response, prune the visits to the returned `type:id` set. An error never prunes.
- **Actions.**
  - "New portal in <station>" for `launcher.station` and then each `launcher.favoriteStations` not already listed, each with `onSelect: () => { onClose(); launcher.launch(id) }` and `gate: launcher.gate`.
  - "Choose station…", which closes the palette and opens the chooser.
  - The page creates are links with gates:

    | Action | Link | Gate |
    |---|---|---|
    | "New station" | `/stations?create=station` | `useCreateGate("station", "Ask for access to create stations")` |
    | "Import a file" | `/connectors?create=file-upload` | `useCreateGate("connector_instance", "Ask for access to connect data")` |
    | "New view" | `/views?create=view` | `useCreateGate("curated_view", "Ask for access to create views")` |
    | "New entity" | `/entities?create=entity` | `useCreateGate("entity", "Ask for access to create entities")` |
    | "New tag" | `/tags?create=tag` | `useCreateGate("tag", "Ask for access to create tags")` |

  - Actions are absent in tag mode.
- **Closing.** The palette closes when the location's `pathname` or `search` changes (`useRouterState`).
- **Errors.** A failed search sets the empty content to `StatusMessage` error, "Couldn't search. Try again.", and keeps Actions.
- **Rendering.** Renders `CommandPaletteUI` with `linkComponent={RouterLink}`.

### Web — `Authorized.layout.tsx`

- It mounts `PortalLauncherProvider`, holds `paletteOpen`, and calls `useCommandPaletteShortcut`.
- In the header's right-hand box it renders `CommandPaletteTriggerUI` (with `layout` set to `isMobile ? "icon" : "full"` and `platform={detectPlatform()}`) before `NewPortalButton`.
- It renders `<CommandPalette open={paletteOpen} onClose={…} />`.

### Web — `?create=` deep links

- **`utils/routes.util.ts`.** Add:

  ```ts
  export function normalizeCreateSearch<K extends string>(search: Record<string, unknown>, allowed: readonly K[]): { create?: K }
  ```

  It fails open: an unknown value is dropped.
- **Routes that declare it.** `validateSearch` is added to `stations.index.tsx` (`["station"]`), `views.index.tsx` (`["view"]`), `entities.index.tsx` (`["entity"]`), `tags.index.tsx` (`["tag"]`) and `connectors.index.tsx` (the `WORKFLOW_REGISTRY` slugs).
- **`useCreateParam(kind, gate, ready, onOpen)`** (`utils/use-create-param.util.ts`, new) reads `useRouterState({select: s => s.location.search})`.
  - It waits until `ready`, which means capabilities are known and, for connectors, the catalog is loaded.
  - When `create === kind` and the gate is `allow`, it calls `onOpen()`.
  - Either way it then navigates `{ search: (prev) => omit(prev, "create"), replace: true }`.
  - It reacts to the param changing, not only to mount.
- **Callers.**
  - `StationsView` (which also gains `useCreateGate("station", …)` on its New Station button, through the gated button);
  - `CuratedViewsView`;
  - `EntitiesView`;
  - `TagsView`;
  - `ConnectorView`, whose `onOpen` finds the catalog definition by slug and calls `handleConnect`. A missing definition does nothing.

### Docs

- **`glossary.util.ts`:** a new "Command palette" entry (⌘K / Ctrl+K, the header search box, `#` for tags). The "Favorite" and "Tag" entries mention the palette.
- **`faq.util.ts`:**
  - a new "How do I find something quickly?" entry;
  - "How do tags work?" mentions `#`;
  - the New portal answer mentions the palette.
- **`troubleshooting.util.ts`:** a new entry, "Search doesn't find something", whose causes are that the object isn't readable, is in another org, or is a type the palette doesn't search.
- **`docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`:** the rows 2.1.1, 2.1.4, 2.4.3, 2.4.5, 4.1.2 and 4.1.3, the APG patterns line (combobox + listbox in a dialog), and the report date.

## Migration

None. No schema change.

## Seed

None.

## TDD test plan

Run the tests with each package's npm scripts: `cd packages/core && npm run test:unit`, `cd apps/api && npm run test:unit` / `npm run test:integration`, and `cd apps/web && npm run test:unit`.

### Core — `packages/core/src/__tests__/contracts/search.contract.test.ts` (~7)

- Accepts `{}`, `{q}`, `{tag}` and `{refs}`.
- Rejects two modes at once.
- Rejects an unknown key (strict).
- Rejects a malformed ref, an unknown ref type, and more than 20 refs.
- Trims and length-limits `q` and `tag`.

### API unit — `apps/api/src/__tests__/routes/search.router.test.ts` (~3)

- A 400 `SEARCH_INVALID_QUERY` for two modes, an oversized `q`, and a bad ref.
- A 200 passes the parsed query to `SearchService`.

### API integration — `apps/api/src/__tests__/__integration__/routes/search.router.integration.test.ts` (~20)

- **`q` mode:**
  - finds each type by name;
  - finds an entity by key;
  - puts a prefix match before a substring match;
  - caps each type at 5;
  - escapes `%` and `_`.
- **Read safety:**
  - a member never sees another member's unshared station, view, connector, entity or pin, nor another user's portal (including as owner or admin, #1127);
  - another org's objects are never returned;
  - deleted objects are never returned.
- **`tag` mode:**
  - a prefix match returns tagged objects of every taggable type, with `matchedTags`;
  - an unreadable tag matches nothing (`results: []`);
  - a readable tag on an unreadable object doesn't return that object;
  - portals are never in tag results.
- **Favorites (no mode):**
  - only the caller's favorites;
  - a favorite the caller can no longer read is absent;
  - entities and portals are never included.
- **`refs` mode:**
  - returns the readable subset in the request's order;
  - drops a deleted, cross-org or unreadable id with no error.
- **Tags on results:** readable tags only.

### API integration — agreement (~6)

`search-visibility.agreement.integration.test.ts`. For each of the six types and each role (owner, admin, member), `q` results equal the type's list route filtered by the same `search` and capped at 5.

### API — route map and OpenAPI (existing guards)

- `route-authorization.test.ts` passes with the new entry.
- `swagger.config.test.ts` pins `SearchResponse`.

### Web unit (~45)

- **`launcher-items.util.test.ts`:**
  - `parsePaletteQuery` (home, search, `#tag`, `#` alone, whitespace);
  - `toLauncherItem` for all six types;
  - a link action in `paletteOptions`.
- **`use-command-palette-shortcut.util.test.ts`:**
  - ⌘K on Mac and Ctrl+K elsewhere toggle the palette;
  - Shift or Alt doesn't;
  - an input, textarea or contenteditable stands it down;
  - `[data-sheet-surface]` stands it down;
  - an open dialog stands it down, except the palette itself, which the shortcut closes;
  - `preventDefault` runs only when it acts.
- **`use-recent-visits.util.test.ts`:**
  - `recordVisit` dedupes and caps at 20;
  - `pruneVisits`;
  - the key holds org and sub;
  - nothing is read or written before both are known;
  - a storage failure reads as `[]`.
- **`use-create-param.util.test.ts`:**
  - opens on a matching `create` with an allow gate and removes the param (replace);
  - drops it without opening on a `disable` or `hide` gate;
  - waits for `ready`;
  - reacts when the param changes on the same route.
- **`CommandPalette.test.tsx` (container, SDK mocked):**
  - Home shows Actions, Favorites, Recent portals and Recent.
  - Recent portals lists the 5 latest portals, newest first, and picking one opens it; Recent keeps other items, newest first.
  - A successful `refs` response prunes and an error doesn't.
  - Typing debounces to one request.
  - `#fin` sends `tag=fin`, labels its group, and hides Actions.
  - `#` alone lists tags, and picking one sets `#name`.
  - A gated action shows its reason.
  - "New portal in X" calls the shared launcher.
  - A link closes the palette on navigation.
  - A search error shows its message and keeps Actions.
  - Axe on the open palette, home and results.
- **`CommandPaletteTrigger.test.tsx`:** icon layout has its name, `aria-keyshortcuts` and axe.
- **Core `Combobox.test.tsx`:** a gated link option isn't a link, a click doesn't navigate, and upsell calls `onUpgrade`.
- **`Authorized.layout.test.tsx`:** the trigger renders before New portal, the trigger opens the palette, and Ctrl+K opens it.
- **`NewPortalButton.container.test.tsx`:** it reads the provider, and one create is shared with a second consumer.
- **`Stations.view` test:** New Station is gated (disabled with its hint when create is refused).
- **Detail views:** each records a visit after a successful load and not after a 404 (one test per view, through `useRecordRecentVisit`).
- **`api.util.test.ts`:** `meta.abortable` passes the signal, and other queries don't get it.
- **Content:** the glossary, FAQ and troubleshooting tests, the help-findability tests ("command palette", "keyboard shortcut", "search" find the new entries), and the permission-copy guard.

**Totals ≈ 90 cases.**

## Acceptance criteria

- ⌘K / Ctrl+K opens the palette from any authorized page, but not while focus is in a text field, the RegionEditor sheet, or another open dialog. The header's "Search or run…" opens it too, as an icon at phone width.
- Results contain only objects the caller can read, in the active org. An unreadable object's name or existence never appears, by search, tag, favorites or Recent.
- `#finance` returns only readable objects carrying a readable tag whose name starts with "finance", labelled with the tag. An unreadable tag matches nothing.
- Every offered action would succeed on the caller's permissions and plan. A refused one is hidden or disabled with its reason. A gated link can't be followed.
- The palette's home lists the caller's 5 most recently opened portals in a "Recent portals" group, newest first; picking one opens it.
- A Recent item that was deleted, unshared or is in another org is silently absent and pruned. Recent never shows a stored name.
- Fully keyboard operable, with an announced result count, and axe passes on the open palette.
- Typing sends at most one search per 200 ms pause, aborts the superseded one, and the server returns at most 5 results per type.
- Opening a create from the palette lands on the page with its dialog open, and Back doesn't reopen it.
- New Station is gated on its page like every other create.

## Risks & rollback

- **Read leak through the new endpoint.** This is the main risk. It's mitigated by reusing each list's `visibilityPredicate` and by the agreement test, which fails CI if search and list ever differ. The endpoint fails closed: a type whose predicate can't be built returns nothing.
- **Search load on unindexed ILIKE.** The search is org-scoped, limited to 5 per type, debounced and abortable, and the DB cancel policy is `always`. If a production org shows slow searches, a trigram index on the name columns is the measured follow-up.
- **Shortcut conflicts.** The browser's own Ctrl+K (Chrome and Firefox focus the address bar) is pre-empted only on authorized pages, and only outside text fields. Rollback: remove the listener and keep the trigger.
- **The `?create=` params** are fail-open: an unknown value is dropped. Rollback: remove `validateSearch` and the hooks, and the pages behave as before.
- **Provider move.** The whole branch reverts cleanly into the epic: no schema, no seed.

## Files touched

- **New:**
  - `packages/core/src/contracts/search.contract.ts` (+ test)
  - `apps/api/src/services/search.service.ts`
  - `apps/api/src/routes/search.router.ts` (+ unit and integration tests, agreement test)
  - `apps/web/src/api/search.api.ts`
  - `apps/web/src/providers/PortalLauncher.provider.tsx`
  - `apps/web/src/utils/use-command-palette-shortcut.util.ts`
  - `apps/web/src/utils/use-recent-visits.util.ts`
  - `apps/web/src/utils/use-debounced-value.util.ts`
  - `apps/web/src/utils/use-create-param.util.ts`
  - web tests for each
- **Edit, core:**
  - `packages/core/src/contracts/index.ts`
  - `packages/core/src/ui/Combobox.tsx`
  - `glossary.util.ts`, `faq.util.ts`, `troubleshooting.util.ts`
- **Edit, API:**
  - `apps/api/src/routes/protected.router.ts`
  - `apps/api/src/constants/api-codes.constants.ts`
  - `apps/api/src/config/swagger.config.ts`
  - `apps/api/src/__tests__/config/route-authorization.map.ts`
- **Edit, web:**
  - `api/sdk.ts`, `api/keys.ts`
  - `utils/api.util.ts`
  - `utils/launcher-items.util.ts`
  - `utils/routes.util.ts`
  - `components/CommandPalette.component.tsx`, `CommandPaletteTrigger.component.tsx`, `CommandPaletteOption.component.tsx`, `NewPortalButton.component.tsx`
  - `layouts/Authorized.layout.tsx`
  - routes `stations.index.tsx`, `views.index.tsx`, `entities.index.tsx`, `tags.index.tsx`, `connectors.index.tsx`, and `routeTree.gen.ts` if it changes
  - views `Stations`, `CuratedViews`, `Entities`, `Tags`, `Connector`, `StationDetail`, `PinnedResultDetail`, `CuratedViewDetail`, `ConnectorInstance`, `EntityDetail`
  - the stories for the trigger and palette
- **Edit, docs:** `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`.

## Next step

`docs/COMMAND_PALETTE.plan.md` sequences this in about six TDD slices, each a commit on `feat/1076-command-palette`:

1. The core contract and the API endpoint, with read-safety and agreement tests.
2. The web SDK, the abortable query and the palette types.
3. The shortcut, debounce and Recent store.
4. The launcher provider and the `?create=` deep links, with New Station's gate.
5. The palette container, mounted in the layout with its trigger.
6. Docs and the ACR.
