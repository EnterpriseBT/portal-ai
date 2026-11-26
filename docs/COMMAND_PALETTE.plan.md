# Command palette — Plan

**This plan implements `docs/COMMAND_PALETTE.spec.md`: a read-scoped `GET /api/search`, then the web pieces that use it, ending with the palette mounted in the header. It's TDD-sequenced in six slices.**

Spec: `docs/COMMAND_PALETTE.spec.md`. Discovery: `docs/COMMAND_PALETTE.discovery.md`. Issue: #1076 (Launcher epic #1084). It builds on #1122, which built the palette's UI, and on #1075, which built the header launcher. #1127, already merged into the epic, scopes portals to their creator.

There are 6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/1076-command-palette`**: one feature, one PR (#1130, into `epic/launcher`), per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <names>
cd apps/api && npm run test:unit -- --testPathPattern <names>
cd apps/api && npm run test:integration -- --testPathPattern <names>
cd apps/web && npm run test:unit -- --testPathPattern <names>
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run them.
4. Run `npm run lint && npm run type-check`, plus the root `npm run build` whenever core changes.
5. Move to the next slice.

**Sequencing rationale.**
- **Slice 1** is the server contract. Everything on the web reads it, and its read-safety is the ticket's main risk, so it lands and is proven first.
- **Slice 2** is the web's access to it (the SDK, the abortable query) plus the palette's pure types and core's gated-link fix. It's leaf logic with no UI wiring yet.
- **Slice 3** is the shortcut, debounce and Recent store, which are pure utils, plus visit recording in the detail views. Recording can land before the palette exists: it only writes storage.
- **Slice 4** prepares the destinations: the launcher provider, the `?create=` deep links and New Station's gate. Each works on its own (a `?create=` URL opens the dialog) before anything links to it.
- **Slice 5** is the container and its mount in the layout. It depends on slices 1–4.
- **Slice 6** is docs and the ACR, which describe the finished behaviour.

---

## Slice 1 — the search contract and endpoint

Add the core contract and `GET /api/search` in all four modes, with the read-safety and agreement tests.

**Files**

- **New:**
  - `packages/core/src/contracts/search.contract.ts`, barrel-exported from `contracts/index.ts`.
  - `apps/api/src/services/search.service.ts`.
  - `apps/api/src/routes/search.router.ts`.
- **Edit:**
  - `apps/api/src/routes/protected.router.ts`: mount `/search`.
  - `apps/api/src/constants/api-codes.constants.ts`: `SEARCH_INVALID_QUERY`.
  - `apps/api/src/config/swagger.config.ts`: `SearchResponse` and the `Search` tag.
  - `apps/api/src/__tests__/config/route-authorization.map.ts`: `GET /api/search`.
- **Tests:**
  - `packages/core/src/__tests__/contracts/search.contract.test.ts`.
  - `apps/api/src/__tests__/routes/search.router.test.ts`.
  - `apps/api/src/__tests__/__integration__/routes/search.router.integration.test.ts`.
  - `apps/api/src/__tests__/__integration__/routes/search-visibility.agreement.integration.test.ts`.

**Steps**

1. **Tests first** (spec: Core ~7, API unit ~3, API integration ~20, agreement ~6), then run them; they fail.
   - The contract's mode exclusivity, strictness and refs validation.
   - The router's 400 `SEARCH_INVALID_QUERY`.
   - **Integration:**
     - `q` per type, including an entity by key;
     - prefix before substring;
     - 5 per type;
     - `%` and `_` escaped;
     - a member never sees others' unshared objects;
     - owner and admin never see another user's portal;
     - nothing from another org, nothing deleted;
     - `tag` with `matchedTags`, an unreadable tag matching nothing, and a readable tag on an unreadable object;
     - favorites only, without entities or portals;
     - `refs` returns the readable subset in order;
     - readable tags on results.
   - **The agreement test:** for each type × owner/admin/member, search equals the list route with the same `search`, capped at 5.
2. **Implement** the contract, then `SearchService` with `SEARCH_TYPE_CONFIG` (base filter, the four modes, `tagsForTargets`), the router with `setDbCancelPolicy("always")`, the mount, the code, OpenAPI and the map entry. Run until green.
3. Run the route-map and swagger guard tests (`route-authorization`, `swagger.config`), the root build, then lint and type-check.

**Done when:** every slice-1 case passes, the guards pass, and nothing in web reads the endpoint yet.

**Risk:** a list route with a read filter beyond `visibilityPredicate` that search misses. The agreement test is the guard; a mismatch means search must reuse the list's filter, not the test bending.

---

## Slice 2 — the web's access to search, the palette types and core's gated links

**Files**

- **New:** `apps/web/src/api/search.api.ts`, wired into `api/sdk.ts`, with `queryKeys.search` in `api/keys.ts`.
- **Edit:**
  - `apps/web/src/utils/api.util.ts`: `meta.abortable` passes the signal.
  - `apps/web/src/utils/launcher-items.util.ts`:
    - `LauncherItemType = SearchResultType`;
    - the portal icon and noun;
    - `PaletteAction.href`;
    - `toLauncherItem`, `parsePaletteQuery` and `RESULT_GROUP_LABEL`.
  - `apps/web/src/components/CommandPaletteOption.component.tsx`: the portal row.
  - `packages/core/src/ui/Combobox.tsx`: a gated link option renders as a non-link.
  - Freshness through `staleTime: 0` on the search query (see the spec), not invalidation helpers.
- **Tests:**
  - `api.util.test.ts`;
  - `launcher-items.util.test.ts`;
  - `CommandPaletteOption.test.tsx` (a portal row);
  - core `Combobox.test.tsx`;

**Steps**

1. **Tests first** (spec: Web unit, the `launcher-items`, `api.util` and core `Combobox` cases). Run them; they fail.
2. **Implement.** Run until green, and keep the existing palette stories rendering (the option and palette stories).
3. Root build (core changed), then lint and type-check.

**Done when:** these cases pass, `paletteOptions` accepts link actions, and the stories and their tests still pass.

**Risk:** `meta.abortable` must not change any other query. The `api.util` test asserts that a query without the meta still gets no signal outside a read pause.

---

## Slice 3 — the shortcut, debounce, the Recent store and visit recording

**Files**

- **New:**
  - `apps/web/src/utils/use-command-palette-shortcut.util.ts`;
  - `use-debounced-value.util.ts`;
  - `use-recent-visits.util.ts`.
- **Edit:** call `useRecordRecentVisit` in `StationDetail`, `PinnedResultDetail`, `CuratedViewDetail`, `ConnectorInstance` and `EntityDetail` after a successful GET.
- **Tests:**
  - `use-command-palette-shortcut.util.test.ts`;
  - `use-recent-visits.util.test.ts`;
  - `use-debounced-value.util.test.ts`;
  - one recording test per detail view (in each view's existing test file), checking that a visit is recorded on load and not on a 404.

**Steps**

1. **Tests first** (spec: Web unit, the shortcut, Recent and detail-view cases). Run them; they fail.
2. **Implement** the three utils, then add the five calls. Run until green.
3. Lint and type-check.

**Done when:** the shortcut's guards and the store's dedupe, cap, prune, key and failure handling pass, and the detail views record visits. Nothing reads Recent yet, so there's no visible change.

**Risk:** the detail views' tests mock modules partially, so a new import can break unrelated tests (`project_web_partial_module_mocks`). Mock `use-recent-visits.util` where a view's test doesn't set up storage.

---

## Slice 4 — the launcher provider, `?create=` deep links and New Station's gate

**Files**

- **New:**
  - `apps/web/src/providers/PortalLauncher.provider.tsx`;
  - `apps/web/src/utils/use-create-param.util.ts`.
- **Edit:**
  - `apps/web/src/utils/routes.util.ts`: `normalizeCreateSearch`.
  - `validateSearch` in routes `stations.index.tsx`, `views.index.tsx`, `entities.index.tsx`, `tags.index.tsx` and `connectors.index.tsx`; commit `routeTree.gen.ts` if the build changes it.
  - `useCreateParam` in `StationsView`, `CuratedViewsView`, `EntitiesView`, `TagsView` and `ConnectorView`.
  - `StationsView`: New Station's `useCreateGate("station", "Ask for access to create stations")`.
  - `NewPortalButton.component.tsx`: reads the context.
  - `Authorized.layout.tsx`: mounts the provider.
- **Tests:**
  - `use-create-param.util.test.ts`;
  - `routes.util` tests for `normalizeCreateSearch`;
  - `NewPortalButton.container.test.tsx` (it reads the provider, one create shared);
  - the `Stations.view` gate test;
  - one test per index view checking that `?create=` opens its dialog and removes the param;
  - `Authorized.layout.test.tsx` (the provider is mounted, and the header still renders New portal).

**Steps**

1. **Tests first** (spec: Web unit, the `use-create-param`, `NewPortalButton`, `Stations.view` and layout cases). Run them; they fail.
2. **Implement** the provider and hook, then the routes and views. Run until green, then run web's build so the route tree regenerates.
3. Lint and type-check. The route-exports guard passes because route files still export only `Route`.

**Done when:**
- `/stations?create=station` (and the other four links) opens the page's dialog and the param is gone after it opens;
- a refused create drops the param without opening;
- the header launcher behaves exactly as before;
- New Station is gated.

**Risk:** `validateSearch` on an index route changes the typed search for every link to it. Existing links pass no `search` and stay valid; type-check finds any that don't.

---

## Slice 5 — the palette container, mounted with its trigger

**Files**

- **Edit:**
  - `apps/web/src/components/CommandPalette.component.tsx`: the `CommandPalette` container beside `CommandPaletteUI`.
  - `CommandPaletteTrigger.component.tsx`: the `layout` prop.
  - The trigger story: an Icon variant.
  - `Authorized.layout.tsx`: palette state, the shortcut, the trigger before New portal, and the palette.
- **Tests:**
  - `CommandPalette.test.tsx` (container cases with axe);
  - `CommandPaletteTrigger.test.tsx` (icon layout and axe);
  - `Authorized.layout.test.tsx` (the trigger opens the palette, Ctrl+K opens it, and an open dialog blocks the shortcut).

**Steps**

1. **Tests first** (spec: Web unit, the `CommandPalette` container, trigger and layout cases). Run them; they fail.
   - Home groups, with Recent merged and pruned only on success.
   - One debounced request per pause.
   - `#fin`: label, no Actions.
   - `#` alone lists tags.
   - Gated actions and links.
   - New portal through the shared launcher.
   - The palette closes on navigation.
   - A search error keeps Actions.
   - Axe on home and results.
2. **Implement** the container, the trigger layout and the layout mount. Run until green.
3. Lint and type-check.

**Done when:** the palette works end to end against the dev stack: ⌘K, the trigger, favorites, Recent, search, `#tag`, actions and creates.

**Risk:**
- **Several queries on open.** Home mode makes up to three requests: favorites, refs and portals. Each is `enabled` only while the palette is open and in home mode, so a closed palette sends nothing.
- **The shared bucket.** Watch that the shared rate bucket isn't hit hard while typing; the debounce and per-mode `enabled` are the bound.

---

## Slice 6 — docs and the ACR

**Files**

- **Edit:**
  - `packages/core/src/content/glossary.util.ts`: a new "Command palette" entry; Favorite and Tag mention it.
  - `faq.util.ts`: "How do I find something quickly?"; tags mention `#`; the New portal answer mentions the palette.
  - `troubleshooting.util.ts`: "Search doesn't find something".
  - `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`: rows 2.1.1, 2.1.4, 2.4.3, 2.4.5, 4.1.2 and 4.1.3, the APG patterns line and the report date.
- **Tests:**
  - `glossary.util.test.ts`, `faq.util.test.ts`, the troubleshooting tests;
  - `help-findability.test.ts` ("command palette", "keyboard shortcut" and "search" find the new entries);
  - the permission-copy guards (core, and web through its scan).

**Steps**

1. **Tests first:** add the findability phrases. Run them; they fail.
2. **Write the entries.** Write troubleshooting copy in terms of access, not roles. Update the ACR rows against the shipped behaviour. Run until green.
3. Root build, then lint and type-check.

**Done when:** the content and findability tests and the copy guards pass, and the ACR rows describe the palette.

**Risk:** none beyond wording. The ACR claims must match what slice 5 shipped, so walk the keyboard path once before editing them.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Core contract and `GET /api/search` (four modes) | Contract, router, integration and agreement tests; route map; swagger |
| 2 | SDK and abortable query; palette types; core gated-link fix | `api.util`, `launcher-items`, `Combobox` tests; stories intact |
| 3 | Shortcut, debounce, Recent store, visit recording | Util tests; detail-view recording tests |
| 4 | Launcher provider; `?create=` deep links; New Station gate | `use-create-param`, view and launcher tests; route tree committed |
| 5 | Palette container in the header | Container (with axe), trigger and layout tests |
| 6 | Glossary, FAQ, troubleshooting, ACR | Content, findability and copy-guard tests |

## Cross-slice notes

- **Core rebuilds.** The API and web read core's build output, so run the root `npm run build` after slices 1 and 2 before the dependent suites. After a core rebuild, touch an API source file to restart the dev server before a manual check (nodemon doesn't watch core).
- **Relative imports in core** need `.js` extensions (NodeNext); type-check and the tests miss it, but the build catches it.
- **The route tree.** Slice 4 regenerates `routeTree.gen.ts`; commit it with the route change and never hand-format it.
- **The component file policy.** The container joins `CommandPaletteUI` in its file, which is allowed as UI plus its implementation. The provider is a provider, not a component file. The layout wires state, the shortcut and the trigger.
- **The guards.** Watch these as slices land:
  - `component-axe.guard`: every touched component's test asserts axe;
  - `action-gate.guard`: no raw `disabled={!can…}`;
  - `effect-mutation.guard`: `useCreateParam` opens a dialog, it doesn't mutate;
  - `mutation-toast` / `mutation-invalidate`: the launch keeps its call-level `toast` and `invalidate`;
  - `route-exports.guard`.
- **Docs in sync.** Slice 6 carries Help and the ACR. The OpenAPI block lands with the route in slice 1. No README or CLAUDE.md convention changes.
- **The epic.** Before this PR merges into `epic/launcher`, merge `main` into the epic (keep-pace rule). #1077 (sidebar Favorites) can later reuse the favorites mode of `/api/search`.

## Next step

Once discovery, spec and plan are confirmed, implementation begins on this branch with slice 1, tests first, one commit per slice.

## Amendment — Recent portals (slice 7)

Added after slice 6 at the user's request (#1076's body amended): the palette's home shows the caller's 5 most recently opened portals in their own "Recent portals" group, newest first, instead of mixing them into Recent. Slice 7 changes the container's groups, its tests and the Help copy that lists the palette's home.
