# Dashboard workbench UI components — Condensed design (#1123)

**Issue:** [EnterpriseBT/portal-ai#1123](https://github.com/EnterpriseBT/portal-ai/issues/1123) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). First child of the Dashboard redesign epic (#1085); branch `feat/1123-dashboard-ui-components` → `epic/dashboard-redesign`.

**Why.** The redesign turns the dashboard into a workbench with six sections, and how they look together can't be judged one section at a time or after wiring. This ticket builds the layout and every section as pure `…UI` components in `apps/web/src/components`, each with stories and axe-checked tests, mounted nowhere. #1078 to #1083 then wire them to their data. Web, plus three small core additions for the layout (see **Revision**). Nothing changes in the API, contracts or the running app.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Dashboard today | `views/Dashboard.view.tsx:34` (`DashboardViewUI`) | `PageHeader` "Dashboard" + two `PageSection`s in a one-column `PageGrid`. **Not touched.** |
| Recent portals row | `components/RecentPortalsList.component.tsx:29` | `CardList` of `DetailCard`s with `href` + `RouterLink`, station name, `DateFactory.relativeTime`. The pattern the new rows follow |
| Pin card | `components/PinnedResultsList.component.tsx:57` | `DetailCard` + tags `MetadataList`. Live block content (`TableWidget` etc.) pulls `sdk.portalSql`, so it can't render from props |
| Section frame | `core/ui/PageSection.tsx:44` | renders its `title` as `variant="h2"`; `primaryAction` slot holds the "see all" link |
| Cards, empty, gated | `core/ui/CardList.tsx`, `DetailCard.tsx` (`headingLevel`, `href`, `linkComponent`), `EmptyState.tsx` (`helpLink`, `action`), `GatedButton.tsx` (`gate`) | All the primitives the ticket asks for already exist |
| Chart frame | `components/VisualFigure.component.tsx:28` (`VisualFigureUI`) | Figure + summary for the tile's fixture chart and map |
| Tag chip | `components/TagChip.component.tsx:14` (`TagChipUI`) | Colour + name; no count, not a link |
| Job labels | `core/models/job.model.ts:809` (`JOB_TYPE_LABELS`), `utils/running-job-label.util.ts:12` | Needs attention names jobs the same way as lock alerts |
| Router in stories/tests | `.storybook/preview.tsx:78`, `__tests__/test-utils.tsx` | Both already supply a router and theme, so `RouterLink` works with no extra mocks (as `RecentPortalsListUI` does today) |
| Story fixtures | `stories/launcher-fixtures.ts` (#1122) | Stories-only fixtures file. Tests build their own |

## Decision — component breakdown (one pure UI component per file)

Each file exports only `<Name>UI` (Component File Policy), with no container. #1078 to #1083 add the containers when they wire the data. Props are narrow row shapes modelled on the core payloads (`{ id, name, … }`), so a container maps a response into them without the components importing contracts.

| File | Component | Holds |
|---|---|---|
| `DashboardWorkbench` | `DashboardWorkbenchUI` | `PageHeader` (the page's one `h1`) + optional slots `start`, `stations`, `pins`, `recent`, `tags`, `attention`. A five-column `PageGrid`: the start box (a named form, no heading), favorite stations and pins take full rows; below them Recent portals with Browse by tag under it span three, and Needs attention runs down the right two beside both. Stacks at phone width in that reading order |
| `WorkbenchSection` | `WorkbenchSectionUI` | `PageSection` (`h2`) + an optional `seeAll: { href, label }` rendered as a `RouterLink` in `primaryAction` |
| `StartBox` | `StartBoxUI` | One-line core `Composer`: the prompt (placeholder "Ask anything about your data…", Enter/Shift+Enter in its description) with the station chip and `GatedButton` Start inside the frame; `FormAlert` for `serverError`. No example prompts |
| `StationPicker` | `StationPickerUI` | The chip and its `Menu`: Favorites group first, then All stations |
| `FavoriteStationCard` / `FavoriteStations` | `…UI` | `DetailCard` (`headingLevel={3}`, `href`), the recent-activity line, a Launch `GatedButton` "Launch {name}". The list is a `CardList` with a teaching `EmptyState` |
| `PinTile` / `FavoritePins` | `…UI` | Tile: title link, `status: "loading" \| "error" \| "ready"`, `children` content. Grid: capped at `max` (default 6), plus a teaching empty state |
| `DashboardRecentPortals` | `…UI` | At most 5 one-line rows (core `LinkList`): the name, then its station and time. No "see all"; an empty state. New, so `RecentPortalsListUI` stays as it is |
| `TagCountChip` / `BrowseByTag` | `…UI` | A toggle chip in the tag's colour with its count (`aria-pressed`). Pressing one lists what carries the tag under the chips (core `LinkList`, each with its type's sidebar icon and name); pressing again hides it. Selection is controlled (`selectedTagId`, `onSelectTag`) so the container fetches the matches. While a tag is selected, a `matchesToolbar` slot above them takes the standard `PaginationToolbar` (search and paging), and `matchesFiltered` separates "no match for the search" from "nothing has this tag"; loading and error states; an empty state with no tags |
| `AttentionJobRow` / `NeedsAttention` | `…UI` | A row with its `JOB_TYPE_LABELS` name, where it runs, relative time, status and a link; the "All clear" state |

Two choices follow from the table:

- **Tile content goes in `children`.** Real blocks need the SDK, and the compact renderer belongs to #1081. So `PinTileUI` owns only the frame, and the stories pass static fixture content: a `VisualFigureUI` around a small SVG in `palette.dataViz` colours, a plain table, and a map stand-in.
- **The start box keeps its prompt and station in local UI state.** The Component File Policy allows a component's own interaction state, and keeping it local is what keeps the typed prompt after an error. Its props are `stations`, `initialStationId`, `gate`, `pending`, `serverError` and `onStart({ prompt, stationId })`. Enter submits unless the prompt is empty or `pending`; Shift+Enter adds a line. An empty prompt disables Start with a reason ("Type a question to start"), and the `gate` prop outranks it.

## Revision (after slice 3, on the design review)

To match the design doc's workbench wireframe and use the space better:

- **Start box:** drops its "Try:" examples and becomes one line (new core `Composer`: a growing input whose controls sit inside the frame and wrap under it on a phone). Its section heading went too, so the page has five section `h2`s.
- **Favorites:** both sections lay out three across (new `columns` on core `CardList`, a grid that stays a list). Station cards, pin tiles and attention rows carry no icon of their own; the section heading has it.
- **Recent portals:** one line per portal (new core `LinkList`).
- **Bottom of the page:** Browse by tag sits under Recent portals, and Needs attention runs down the right beside both.
- **Tags have no page of their own:** pressing a tag lists its matches in place, which changes #1082's "one page per tag".
- **Theme:** a default chip's icon takes `text.secondary`, since Brand Dark's `grey[300]` hid it.

## Plan — 3 slices

Every new component gets `stories/<Name>.component.stories.tsx` (stories render the `…UI`) and `__tests__/<Name>.test.tsx`, which calls `expectNoAxeViolations` on the primary and empty states, and on the open menu through `document.body`. Shared story data goes in `stories/dashboard-fixtures.ts`. Any new styling goes in both theme JSONs or `a11yComponents()`, never ad hoc `sx`.

1. **Section frame + start + stations + recent.** `WorkbenchSection`, `StartBox`, `StationPicker`, `FavoriteStationCard`, `FavoriteStations`, `DashboardRecentPortals`. Tests cover: Enter submits and Shift+Enter adds a line (`user.type`, never `fireEvent.submit`); empty prompt, pending and gated Start; the error keeps the prompt; the picker lists favorites first and selecting one updates the chip; card links' `href`; Launch names its station; the 5-row cap.
2. **Pins, tags, attention.** `PinTile`, `FavoritePins`, `TagCountChip`, `BrowseByTag`, `AttentionJobRow`, `NeedsAttention`. Tests cover: tile loading and error states, the cap, tag toggles and counts, a tag's matches with their types (and its loading, error and empty states), row labels from `JOB_TYPE_LABELS`, and "All clear".
3. **Workbench + whole-page stories.** `DashboardWorkbench` with Populated, NewOrg (every section empty), Mixed and Phone (`viewport` parameter) stories, each also in Brand Dark (`globals.theme`). A test checks there is one `h1` and that the six section titles are `h2`s, plus axe on populated and empty.

Run per slice: `npm run test:unit -- --testPathPattern '<names>'` (web), then `npm run lint`, `npm run type-check` and `npm run build`. CI runs `component-axe.guard.test.ts` and the full suites.

## Smoke (manual, against your dev stack)

1. `npm run storybook` (web, :7007). Under Components, open every new story, including the populated, capped, empty, gated, disabled-with-reason, pending, inline error, tile loading, tile error and "All clear" states. Each renders without console errors.
2. Open the whole-dashboard stories (Populated, NewOrg, Mixed, Phone) in Brand and Brand Dark. There is one "Dashboard" heading, the sections are in the order from #1078, the bottom row stacks at phone width, and nothing scrolls sideways.
3. In the start box story: Enter starts, Shift+Enter adds a line, an empty prompt can't start and its button says why, and after the error story's alert the prompt is still there.
4. Use the keyboard only. Tab reaches every link and button, the station picker opens and closes with the keyboard, and the focus ring shows.
5. Open the running app's `/` dashboard. It looks and behaves as it did before this branch: Open Portal, Recent Portals with delete, and Pinned Results with unpin.

## Out of scope

- All wiring and mounting: queries, SSE, gates, portal creation and swapping in `Dashboard.view.tsx`. That is #1078 to #1083.
- The create-with-first-message contract (#1079), compact `ContentBlockRenderer` and lazy tiles (#1081), and the per-tag counts and matches API (#1082).
- Help, FAQ, Getting Started and ACR changes, since nothing user-visible ships here.
- Core changes beyond the layout pieces in **Revision**.
