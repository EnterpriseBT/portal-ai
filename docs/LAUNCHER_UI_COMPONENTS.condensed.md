# Launcher UI components in Storybook — Condensed design (#1122)

**Issue:** [EnterpriseBT/portal-ai#1122](https://github.com/EnterpriseBT/portal-ai/issues/1122) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic [#1084](https://github.com/EnterpriseBT/portal-ai/issues/1084), branch `feat/1122-launcher-ui-components` → `epic/launcher`.

**Why.** The launcher adds three pieces of chrome to every page: a "New portal" split button (#1075), a command palette (#1076) and a sidebar Favorites group (#1077). This ticket builds them as pure, props-driven UI with stories and tests, mounted nowhere, so their look, states and keyboard behaviour are settled in Storybook before any wiring. It touches core `ui` (two generic primitives, two icons) and web `components`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Gates | `packages/core/src/ui/ActionGate.ts:16-33`, `GatedButton.tsx:55`, `GatedIconButton.tsx:122`, `gate-reason.tsx:178` | `disable` = `aria-disabled` + reason as tooltip and description; `pendingGate` |
| Menu button | `packages/core/src/ui/ActionsMenu.tsx:42-141` | IconButton trigger + `MuiMenu` (MUI owns the keys); gated items with reasons. **No split button exists** |
| Modal | `packages/core/src/ui/Modal.tsx:53-76, 123-132` | Plain variant (no `onSubmit`) for a palette; ignores an Escape a child `preventDefault`ed |
| Selects | `packages/core/src/ui/searchable-select/` | MUI `Autocomplete` wrappers. **No combobox/listbox shell or `aria-activedescendant` hook exists** |
| Announcements | `packages/core/src/ui/StatusMessage.tsx:18-70` (`visuallyHidden`); web `utils/results-announcer.util.ts:25-52` | Web's announcer can't be used from core |
| Sidebar item | `apps/web/src/components/SidebarNavItem.component.tsx:39-139` | Link + `aria-current`, `collapsed` (label hidden, `aria-label`, tooltip), a disclosure group with `Collapse` |
| Header | `apps/web/src/layouts/Authorized.layout.tsx:59-62`, `HeaderMenu.component.tsx:49-71` | Right `ButtonGroup`: theme switcher + user menu |
| Layout prop precedent | `packages/core/src/ui/MetadataList.tsx:31`, `apps/web/src/modules/MapWidget/MapWidget.component.tsx:149` | The view decides the layout and passes it in |
| Links from core | `packages/core/src/ui/DetailCard.tsx:37`, `DataTable.tsx:115-627`; web `RouterLink.component.tsx` | `href` + `linkComponent` |
| Favorites, tags | `packages/core/src/models/favorite.model.ts:10-25`, web `TagColorDot.component.tsx`, `FavoritesEmptyResults.component.tsx` | Four favorite types; rows hold ids only; no type → icon map (the sidebar uses SatelliteAlt, PushPin, Layers, MemoryChip) |
| Guards | core and web `component-axe.guard.test.ts`; web `dialog-contract.guard.test.ts` R6/R7 | Each component's own test runs axe; a `Modal` needs its open-dialog axe test |

## Decision — two core primitives, web compositions, display-only item types

- **`SplitButton` (core, new).**
  - Shape: a `ButtonGroup` of a `GatedButton` (the main action) and a `GatedIconButton` menu trigger, which has `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` and the `aria-label` "More {label} options". It opens a `GatedMenu` of `ActionMenuItem`s (a new file holding `ActionsMenu`'s gated-item rendering, which `ActionsMenu` now uses too), and MUI owns the menu's keys. Both halves are `GatedButton`s: `ButtonGroup` styles them through context, so the gate's hidden reason doesn't break the group.
  - `gate` and `pending` (through `pendingGate`) apply to the main action. Each menu item keeps its own gate.
  - `layout: "full" | "icon"`, decided by the view as with `MetadataList`. `"icon"` renders the main action as an icon button whose `aria-label` is its label.
  - New `IconName`s: `Add` and `ArrowDropDown`.
- **`Combobox` (core, new), a shell for a list that's always shown, not a popup select.**
  - Built on MUI's headless `useAutocomplete`, with `open` held true, `groupBy`, `filterOptions` = identity (the caller filters), and `autoHighlight`. That gives `role="combobox"`, `aria-activedescendant`, arrows, Home/End, Enter and the grouped `listbox`, without a hand-rolled keyboard model.
  - An option carries `href` (rendered as `linkComponent ?? "a"` with `role="option"`, which ARIA allows on a link) or `onSelect` (rendered as a plain `role="option"` element). Enter on the input activates the highlighted option, following a link as a click would.
  - It renders a `visuallyHidden` `StatusMessage` from a `statusText` prop (the caller words "8 results" / "Loading…"). An option's `description` (by default a gate's reason) is read through `aria-describedby`, outside its name. Escape is left to the host `Modal`: the hook would otherwise claim it (`preventDefault`), and `Modal` ignores a handled Escape, so the shell marks it `defaultMuiPrevented`.
- **Web compositions** (pure `…UI`, one per file):
  - `NewPortalButtonUI` (`SplitButton`): "New portal in {station}"; a menu headed in sections, as in the brainstorm: "On this page" (its station), "Favorite stations" (each with a star; the "Star a station to add it here" teaching row when there are none), then "Choose station…" after a divider. `GatedMenu` gains an optional `section` per item, rendering a heading and a divider where the section changes. A menu may hold only items, groups and separators, and MUI's MenuList walks sibling elements, so the heading is visual (`aria-hidden`) and each item in its section is described by it ("Finance Close, Favorite stations"). A `hint` item is the teaching row: listed and focusable, but inert. Every gated or hint item is reachable from the keyboard (`disabledItemsFocusable`); MenuList skipped `aria-disabled` items, so `ActionsMenu`'s gated items couldn't be reached to read their reason either (#793). Stars take the theme's `favorite` colour, which `SvgIcon` now accepts.
  - `CommandPaletteUI` (plain `Modal`, `aria-label` "Search and actions", `Combobox` inside), with a footer of key hints: "↑↓ move", "↵ open", "# filter by tag", "esc close".
  - `CommandPaletteOptionUI`: type icon, name, `TagColorDotUI`s, and a gated row's reason as secondary text.
  - `CommandPaletteTriggerUI`: the header trigger, drawn as a search box ("Search or run…") with a keycap showing the shortcut ("⌘K" on a Mac, "Ctrl K" elsewhere, from a prop). It's a button named by its visible text, "Search or run…" (so the name contains the label, WCAG 2.5.3), with `aria-keyshortcuts` (`Meta+K` / `Control+K`) and `aria-haspopup="dialog"`; the keycap is decorative. The keycap is a small new core `Kbd` component, styled from theme tokens, and the palette's footer uses it too.
  - `SidebarFavoritesUI`: a disclosure group like `SidebarNavItemUI`'s, with items as `SidebarNavItemUI` links (`aria-current`, `collapsed`). It shows the first `limit` items (default 8, as in the brainstorm), then "Show all (n)" (a sidebar item itself, so it lines up), which expands in place and becomes "Show fewer". Long names truncate; `SidebarNavItemUI` now truncates rather than wraps its label. An empty group shows a one-line hint.
- **Display types, not data contracts.** `utils/launcher-items.util.ts` declares `LauncherItem { id, type, name, href, tags? }` and `favoriteTypeIcon(type)`, which uses the sidebar's icons. The sibling tickets map their data onto it.
- **Styling.** No theme change: MUI's `ButtonGroup` already gives the split button its divider and radius. The combobox shell styles its own list, groups and highlight from theme tokens in core; there's no `sx` in web.
- Not chosen: forking `searchable-select` (it's a popup select over `Autocomplete`'s own list, so it can't hold groups of links), or a hand-written `aria-activedescendant` model (more keyboard code to own than `useAutocomplete` gives for free).

## Plan — 3 slices (one commit each)

1. **Core primitives.** New: `packages/core/src/ui/SplitButton.tsx`, `Combobox.tsx`, `GatedMenu.tsx`, stories `packages/core/src/stories/SplitButton.stories.tsx`, `Combobox.stories.tsx`. Edit: `ActionsMenu.tsx` (uses `GatedMenu`), `Icon.tsx` (two icons), `ui/index.ts`. Plus `GatedMenu.test.tsx`. Tests: `packages/core/src/__tests__/ui/SplitButton.test.tsx` (main click, gate hide/disable/pending, menu open and arrow/Escape, gated item reason, icon layout, axe closed and open); `Combobox.test.tsx` (arrows and Home/End move `aria-activedescendant`, Enter selects or follows `href`, groups labelled, status text, axe).
2. **Palette.** New core: `packages/core/src/ui/Kbd.tsx` (+ story, test with axe). Edit core: `Modal.tsx`, whose header row was an empty `h2` for a dialog named only by `aria-label` (the palette is the first such dialog; it's now a `div`, with a `Modal.test.tsx` axe case). New: `apps/web/src/components/CommandPalette.component.tsx`, `CommandPaletteOption.component.tsx`, `CommandPaletteTrigger.component.tsx`, `utils/launcher-items.util.ts`, stories for each. Tests (`apps/web/src/__tests__/`): `CommandPalette.test.tsx` (groups, `#tag` state, loading, no results, teaching empty, gated action reason, Enter on a link and on an action, Escape calls `onClose`, axe open: R6), `CommandPaletteOption.test.tsx`, `CommandPaletteTrigger.test.tsx`, `launcher-items.util.test.ts`.
3. **Header button and sidebar group.** Edit core: `GatedMenu.tsx` and `ActionsMenu.tsx` (`section`, `hint`, keyboard-reachable gated items; `GatedMenu.test.tsx`), `types/theme.ts` (`SvgIcon` takes `favorite`). Edit web: `SidebarNavItem.component.tsx` (truncation). New: `NewPortalButton.component.tsx`, `SidebarFavorites.component.tsx`, their stories. Tests: `NewPortalButton.test.tsx` (label names the station, menu rows, teaching row, gate and pending, icon layout, axe with menu open); `SidebarFavorites.test.tsx` (cap and "Show all (n)", `aria-current`, collapsed icons with names, disclosure keys, empty hint, axe).

Each slice: `npm run test:unit -- --testPathPattern <names>` in its package, then the root `npm run build`, `lint`, `type-check`.

## Smoke (manual, in Storybook: `npm run storybook`, core :7006, web :7007)

1. Core → SplitButton: Tab to the main action, then the arrow; Enter opens the menu, arrows move, Escape closes and returns focus to the arrow. The Disabled story keeps the button focusable and reads its reason. The Pending story shows "Saving…". The Icon story shows only icons.
2. Core → Combobox: typing filters (story-side); arrows move the highlight through grouped options, Enter on a link option navigates the story's router and on an action option logs it; a screen reader hears the result count.
3. Web → CommandPaletteTrigger: a search-box button reading "Search or run…" with a "⌘K" keycap (the Windows story shows "Ctrl K"). Web → CommandPalette: the footer shows the four key hints; every state story (Default, Tag query, Loading, No results, Empty/teaching, Gated action) renders in Brand and Brand Dark and at 400px width.
4. Web → NewPortalButton: "New portal in Sales Ops"; the menu shows the "On this page" and "Favorite stations" headings, starred favorites (or the teaching row), a divider and "Choose station…"; Narrow shows the icon with its name on hover.
5. Web → SidebarFavorites: Capped shows 8 and "Show all (12)", which expands; the active item is marked; Collapsed shows icons with tooltips; Empty shows the hint; long names truncate.
6. The running app (`npm run dev`) shows none of these anywhere.

## Out of scope

- All wiring (#1075, #1076, #1077): data, search, recents, gates' sources, `sdk.portals.create`, navigation, the ⌘K listener, mounting in the layout or `SidebarNav`.
- Help, FAQ, Getting Started and ACR changes; they ship with the tickets that mount these.
- Standard vs bespoke variants and lifecycle states beyond what props express (recorded N/A on the issue).
