# Accessible tables, grids and lists — Spec

**Issue:** [EnterpriseBT/portal-ai#794](https://github.com/EnterpriseBT/portal-ai/issues/794) · **Epic:** #791 · **Discovery:** `docs/A11Y_TABLES_LISTS.discovery.md`

This spec pins the props, roles, keys and announcement rules that bring every table, grid and card list to WCAG 2.2 AA and the APG table and grid patterns. It covers `packages/core` (`DataTable`, `DataTableBlock`, `DetailCard`, `StatusMessage`, `ActionsSuite`, a new `CardList` and a new `useGridNavigation`) and their `apps/web` callers. No API, schema or data change.

## Key decisions (flag for review)

1. **A table must be named.** `DataTableProps` takes either `label` (rendered as a visually hidden `<caption>`) or `aria-labelledby`, exactly one, and tsc fails a table with neither. This is the `ModalProps` precedent (#793).
2. **Opening a row is a link.** `rowHref` renders the row's primary cell as a link, and a click elsewhere on the row follows it. Core takes the link component as a prop (`linkComponent`) because it can't import the router. Web passes a `RouterLink` adapter. Every `onRowClick` and `onCellClick` that calls `navigate` migrates.
3. **Grids only where cells are interactive.**
   - `DataTable variant="grid"` and the core `useGridNavigation` hook implement the APG grid.
   - Members (`MemberList`) and Inferred columns (`InferredColumnsTable`) adopt it.
   - `KeyValueTable` and every read-only table stay native tables.
4. **Announcements are owned by `PaginationToolbar`.**
   - One persistent, visually hidden `StatusMessage` (polite, `role="status"`) speaks the result count, "No results found" and a delayed "Loading results…".
   - It speaks only after a user-initiated change (search, filter, advanced filter, sort, page size, paging), never on first load, when the route announcer's `h1` has the floor.
   - **Refinement of discovery D4:** errors are *not* repeated in the polite region. They render as the list's visible `StatusMessage variant="error"`, which is `role="alert"` and announced on insertion, so saying it twice would double it. Every list's error path must render that alert (the curated view's "No results found" on error is fixed).
5. **Cards are named by their title.**
   - `DetailCard`'s title is the card's one interactive element: a link (`href`) or a button (`onClick`), stretched over the card. The heading wraps it, and the body sits outside it.
   - Card lists render through `CardList` (`ul`/`li`).
   - Index pages use `headingLevel={2}`, and `PageEmptyState`'s title is an `h2`.
6. **Action names carry their row.**
   - An icon-only row button's `aria-label` includes the row's name.
   - A card's visible-text actions keep their label and take the card title as a description. `GatedButton` already merges a caller's `aria-describedby` with its gate reason (`useGateReason`, `gate-reason.tsx:23`), so no change there.
7. **KB-07:** the column-config list gets Move up and Move down buttons per column. Drag and dnd-kit's keyboard sensor stay.
8. **Accepted, not fixed:** a truncated records cell's hover tooltip isn't keyboard-reachable. The row link opens the record page, which shows every value in full (discovery Q2).

## Scope

### In scope

1. `DataTable`:
   - its name;
   - `aria-sort`;
   - `rowHref`;
   - `variant="grid"`;
   - column-config move buttons;
   - an announced-free empty state (see 4);
   - a hidden name for an empty header.
2. `DataTableBlock`: its name, `aria-sort`, and its search named like `PaginationToolbar`'s (#988).
3. `useGridNavigation` (new), and its adoption by `MemberList` and `InferredColumnsTable`.
4. `StatusMessage` `visuallyHidden`, and `PaginationToolbar`'s announcer with its new `loading` prop.
5. `PaginationToolbar` controls: popover button states and names, the labelled sort group, and the sort direction state.
6. `CardList` (new), `DetailCard`'s title-as-control, the index pages' migration, heading levels and `PageEmptyState`.
7. `DetailCard` passing its title to its actions, and row-named icon actions.
8. Smaller fixes:
   - validity and check icons' text alternatives;
   - `aria-expanded` on the `BulkFailuresTableBlock` and `ConnectorEntity` toggles;
   - the curated view's error state.
9. `RouterLink` (web), the router adapter for core's `linkComponent`.
10. Regenerating `docs/A11Y_AUDIT.md`, and closing KB-07.

### Out of scope

- The RegionEditor canvas and `RecordsPreviewDialog` (#795), and maps and charts (#796).
- CI gates for these checks (#799).
- Virtualization (PRD).
- Long-token wrapping in table cells and portaled listboxes, menus, tooltips and toasts (#984's out-of-scope note).
- Keyboard access to truncated cells' tooltips (Key decision 8).

## Surface

### `DataTable` (`packages/core/src/ui/DataTable.tsx`)

```ts
type DataTableName =
  | { label: string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; label?: never };

export interface DataTableColumn {
  // …existing: key, label, caption, sortable, format, render, onCellClick
  /** Accessible name for a header with no visible label (an actions column). */
  headerLabel?: string;
}

export type DataTableProps = DataTableBaseProps & DataTableName;

interface DataTableBaseProps {
  // …existing: columns, rows, sortColumn, sortDirection, onSort, emptyMessage,
  //   header, columnConfig, onColumnConfigChange, onRowClick
  /** The row's link target; renders the primary cell as a link. */
  rowHref?: (row: Record<string, unknown>) => string;
  /** Key of the column whose cell carries the row link. Default: first visible column. */
  primaryColumn?: string;
  /** Element the row link renders as (web passes `RouterLink`). Default: `"a"`. */
  linkComponent?: React.ElementType;
  /** `"grid"`: APG grid via `useGridNavigation`. Default `"table"`. */
  variant?: "table" | "grid";
}
```

- **Name:**
  - `label` renders `<caption>` with core's `visuallyHidden` style as the table's first child.
  - `aria-labelledby` goes on `<table>`.
  - In the no-visible-columns fallback (`DataTable.tsx:344`), the `Typography` stays as it is, and nothing is a table there.
- **Sort:**
  - Each sortable header `TableCell` receives `sortDirection={sortColumn === col.key ? sortDirection : false}`. MUI renders `aria-sort="ascending" | "descending"` on the `th` and omits it elsewhere.
  - The `TableSortLabel` button keeps the column label as its name. The caption Typography stays inside the header.
- **Row link** (only when `rowHref` is set):
  - The primary cell renders `<MuiLink component={linkComponent ?? "a"} href={rowHref(row)}>`, wrapping the cell's rendered content.
  - A click anywhere on the row outside an interactive descendant (`a, button, input, select, textarea, [role=button], [tabindex]`) calls `.click()` on that link, so the router handles it.
  - Rows get the existing pointer `cursor`.
  - `onRowClick` stays for non-navigation uses. With both set, `rowHref` wins and `onRowClick` isn't called.
- **Header:** a column whose `label` is empty renders `headerLabel` (required by a dev-time `console.error` when missing) in a visually hidden span.
- **Grid** (`variant="grid"`): `<table role="grid">`, rows `role="row"`, header cells `role="columnheader"`, body cells `role="gridcell"`, with keyboard behaviour from `useGridNavigation` (below). The caption name rule applies unchanged.
- **Column config (KB-07):**
  - Each `SortableColumnItem` adds two `IconButton`s, `aria-label="Move {label} up"` / `"Move {label} down"`, after the checkbox.
  - The first item's Up and the last item's Down render with a `disable` gate (`GatedIconButton`, reason "Already first" / "Already last").
  - A move calls `onColumnConfigChange` with the same `arrayMove` the drag uses.
  - The drag handle keeps "Drag to reorder {label}".
- **Empty state:** unchanged visually (`emptyMessage` row). It isn't a live region, because the toolbar announces.

### `useGridNavigation` (new: `packages/core/src/ui/use-grid-navigation.ts`, exported from `@portalai/core/ui`)

```ts
export interface GridNavigation {
  /** Spread on the <table role="grid">. */
  gridProps: { onKeyDown: React.KeyboardEventHandler; onFocus: React.FocusEventHandler };
  /** Spread on each gridcell / columnheader: tabIndex and data-grid-cell coordinates. */
  cellProps: (row: number, col: number) => { tabIndex: 0 | -1; "data-grid-cell": string };
}
export function useGridNavigation(opts: { rowCount: number; colCount: number }): GridNavigation;
```

APG data grid behaviour. Row 0 is the header row.

| Key | In navigation mode (a cell has focus) | In interaction mode (a widget inside a cell has focus) |
|---|---|---|
| Tab | Leaves the grid. The grid is one tab stop: the last focused cell, else (0,0). | Normal Tab order within the cell's widgets; past the last widget, leaves the grid. |
| ←/→/↑/↓ | Move one cell, stopping at the edges. | Passed to the widget. |
| Home / End | First / last cell in the row. | Passed to the widget. |
| Ctrl+Home / Ctrl+End | First / last cell in the grid. | Passed to the widget. |
| Enter, F2 | Moves focus to the cell's first focusable widget, if any. | Passed to the widget (a button activates). |
| Escape | — | Returns focus to the widget's cell. A widget that handles Escape itself (a Select closing its menu) calls `preventDefault`, and the grid ignores a `defaultPrevented` Escape, as `Modal` does. |

- Exactly one cell has `tabIndex=0` at a time (roving).
- Every focusable descendant of a cell has `tabIndex=-1` except while its cell is in interaction mode.
- A cell's widget clicked by pointer enters interaction mode for that cell.
- Rows added or removed keep focus on the same coordinates, clamped to the new bounds.

### `StatusMessage` (`packages/core/src/ui/StatusMessage.tsx`)

```ts
export interface StatusMessageProps {
  // …existing: message, variant, error, loading, tooltip, className, data-*
  /** Screen-reader only: renders just the role element and its text, with core's visuallyHidden style. */
  visuallyHidden?: boolean;
}
```

With `visuallyHidden`:
- it renders one element with the same `role` rule (`alert` for a non-loading error, else `status`), `aria-live` implied by the role, and the text;
- it renders no icon and no spinner;
- the element is present from mount even when `message` is empty, so a later change is announced.

### `PaginationToolbar` (`apps/web/src/components/PaginationToolbar.component.tsx`)

```ts
export interface PaginationToolbarProps {
  // …existing
  /** The list's request is in flight. Drives the delayed "Loading results…".
   *  Default: React Query's `useIsFetching() > 0`. */
  loading?: boolean;
}
```

**Announcer**
- The toolbar mounts `<StatusMessage visuallyHidden message={announcement} />` for its lifetime.
- `announcement` is set only after a user change made through the toolbar: search (after its debounce), a filter value, advanced filters applied or cleared, sort field or direction, page size, First/Previous/Next/Last. It is never set on mount.
- Exported helper `announcementFor(total: number)` returns:

| `total` | Returns |
|---|---|
| 0 | "No results found" |
| 1 | "1 result" |
| any other n | "{n} results", with `n` formatted by `toLocaleString()` |

- After a user change:
  - if `loading` stays true for 500 ms, the text becomes "Loading results…";
  - when `loading` turns false, the text becomes `announcementFor(total)`, plus ", page {currentPage} of {totalPages}" when `totalPages > 1`.
- The same text twice in a row (the same count after a new search) is re-announced by clearing the text, then setting it on the next frame.

**Controls**
- **Popover buttons:**
  - The Filter, Advanced Filters and Sort buttons get `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls` (the popover paper's `id`).
  - The popover papers get `role="dialog"` and `aria-label` "Filters" / "Advanced filters" / "Sort".
- **Active counts:** with a count, the Filter button's `aria-label` is "Filter, {n} active" and Advanced Filters' is "Advanced Filters, {n} conditions". Each starts with its visible text (2.5.3).
- **Sort options:** the sort-by `RadioGroup` gets `aria-labelledby` pointing at its "Sort by" text.
- **Sort direction:** the "Asc"/"Desc" `Chip`s become an exclusive MUI `ToggleButtonGroup` (`aria-label="Sort direction"`; buttons "Ascending", "Descending", with `aria-pressed`). The visual size is matched in the theme.

### `CardList` (new: `packages/core/src/ui/CardList.tsx`)

```ts
export interface CardListProps {
  /** Accessible name of the list (e.g. "Stations"). */
  "aria-label": string;
  children: React.ReactNode;
  className?: string;
}
```

- Renders `<ul>`, with each child wrapped in `<li>`.
- The list reset and the 8px gap are core `sx` with a reason comment. Core may use `sx` this way, and the app never does.

### `DetailCard` (`packages/core/src/ui/DetailCard.tsx`)

```ts
export interface DetailCardProps {
  // …existing: title, icon, children, actions, onClick, headingLevel, variant, className
  /** The card navigates: its title becomes a link to this href. */
  href?: string;
  /** Element the title link renders as (web passes `RouterLink`). Default `"a"`. */
  linkComponent?: React.ElementType;
}
```

- **Title as the control:**
  - The heading `h{headingLevel}` wraps the control: a `MuiLink component={linkComponent} href` when `href` is set; a text-styled `ButtonBase` when `onClick` is set; plain text otherwise.
  - Setting both `href` and `onClick` is a dev-time error.
  - `CardActionArea` is removed.
- **Whole-card click target** (implementation note, slice 5: replaces the planned stretched `::after`, which would have covered hover content in the body, such as tool-pack chip tooltips): a click anywhere on the card outside a control (`a, button, input, …`) calls `.click()` on the title's link or button, so the router handles it. Only the title is focusable. Focus shows the theme's standard ring on the title itself, so no card-level ring is added.
- **Body:** the body is no longer inside the control, so `MetadataList` text reads as text.
- **Actions:** DetailCard generates the title's `id` and passes it to `ActionsSuite`, which gives each `GatedButton` `aria-describedby` pointing at that id.

### `GatedButton` / `GatedIconButton`

No change. Both pass a caller's `aria-describedby` through `useGateReason` (`gate-reason.tsx:14`), which appends the reason's id (`"{caller ids} {reason id}"`). A `DetailCard` test pins this for a gated card action.

### `PageEmptyState` (`packages/core/src/ui/PageEmptyState.tsx`)

Its title renders `component="h2"`. The `variant="h6"` look is unchanged.

### `DataTableBlock` (`packages/core/src/ui/DataTableBlock.tsx`)

`DataTableBlockProps` gains a required `label: string`:
- it becomes the hidden caption;
- the search `TextField` gets `aria-label` "Search {label}";
- sortable headers get `sortDirection`, as `DataTable` does.

`ContentBlockRenderer` passes the block's title, else "Data table". `TableWidget` passes its widget title.

### `RouterLink` (new: `apps/web/src/components/RouterLink.component.tsx`)

```ts
export const RouterLink = React.forwardRef<HTMLAnchorElement, { href: string } & AnchorHTMLAttributes>(
  ({ href, ...rest }, ref) => <Link ref={ref} to={href} {...rest} />
);
```

A pure adapter: MUI hands `href` to the component, and TanStack's `Link` takes `to`. It is what web passes as `linkComponent` everywhere.

### Callers (apps/web)

| Caller | Change |
|---|---|
| Every `DataTable` (12 files, discovery's table) | `label` (e.g. "Records", "Members", "Pending invitations", "Toolpacks", "Field mappings", "Group members", "Usage ledger", "Audit log", "Policy statements"). |
| `EntityRecordDataTable` | `rowHref` to the record (replacing `EntityDetail`'s `onRowClick` navigate) and `linkComponent={RouterLink}`. The validity cell gets `aria-label`/`titleAccess` "Valid" / "Invalid". |
| `Toolpacks.view`, `EntityGroupDetail.view`, `ColumnDefinitionDetail.view` | Navigation clicks become `rowHref` or a `render`ed `RouterLink`. Icon actions name their row: "Refresh {name} schema", "Edit {name}", "Delete {name}", "Remove {entity}", "Set {entity} as primary" / "Remove {entity} as primary", "Edit mapping {key}", "Delete mapping {key}". Bare check icons get "Yes" text alternatives. |
| `MemberList`, `InferredColumnsTable` | `variant="grid"`. |
| Card lists: `StationList`, `Entities.view`, `EntityGroups.view`, `CuratedViews.view`, `ColumnDefinitionList.view`, `Jobs.view`, `Tags.view`, `Connector.view` (×2), `PinnedResultsListView.view` | `<Stack spacing={1}>` becomes `<CardList aria-label="…">`. Cards pass `headingLevel={2}`. Navigating cards pass `href` + `linkComponent={RouterLink}` instead of `onClick` + `navigate`. Tag cards keep `onClick` (it opens a dialog). |
| Every `<PaginationToolbar>` | No change. Most lists' queries run in a render-prop list below the toolbar, so the toolbar defaults `loading` to `useIsFetching() > 0`. A caller can still pass `loading` to override. (Implementation note, slice 3: the first draft had all 18 callers thread `loading`.) Known limit (code review): the count is app-wide, so an unrelated fetch can delay an announcement or, if it overlaps a change for over 500 ms, say "Loading results…". The cost is timing, never a wrong count. Scoping it means passing each list's query key to its toolbar. |
| `CuratedViewDetail.view` | The error path renders `StatusMessage variant="error"`, not `EmptyResults`. |
| `BulkFailuresTableBlock`, `ConnectorEntity` | Expand toggles get `aria-expanded` and `aria-controls`. `BulkFailures`' empty header gets `headerLabel`. |

## Migration

None. This change touches no schema and no data.

## Seed

None.

## TDD test plan

Run from each package with `npm run test:unit -- --testPathPattern <pattern>`, never jest directly. Run the audit with `npm run a11y:report` from the root.

### Layer 1 — core primitives (`packages/core/src/__tests__/ui/`)

| Test file | Cases |
|---|---|
| `DataTable.test.tsx` | ~14 |
| `use-grid-navigation.test.tsx` (new) | ~12 |
| `StatusMessage.test.tsx` | ~3 |
| `CardList.test.tsx` (new) | ~3 |
| `DetailCard.test.tsx` | ~9 |
| `PageEmptyState.test.tsx` | ~1 |
| `DataTableBlock.test.tsx` | ~4 |
| `Modal.types.test.tsx`-style type test (`DataTable.types.test.tsx`, new) | ~2 |

- **`DataTable.test.tsx`:**
  - `label` names the table (`getByRole("table", {name})`), and `aria-labelledby` works;
  - the sorted header has `aria-sort` matching the direction, and the others have none;
  - `rowHref` renders a link named by the primary cell, with the right href;
  - a click on a row's plain cell follows the link, and a click on a button in the row doesn't;
  - `primaryColumn` picks the cell;
  - `headerLabel` names an empty header;
  - Move up/down reorder and call `onColumnConfigChange`;
  - the end moves are `aria-disabled` with their reason;
  - axe passes on a sortable table with row links;
  - `variant="grid"` renders the grid roles.
- **`use-grid-navigation.test.tsx`:**
  - the grid is one tab stop;
  - each arrow moves, stopping at the edges;
  - Home/End and Ctrl+Home/Ctrl+End;
  - Enter and F2 enter a cell's widget, and Escape returns;
  - a `defaultPrevented` Escape is ignored;
  - a pointer click on a widget enters interaction mode;
  - Tab from a widget leaves the grid;
  - focus clamps when rows shrink;
  - widgets in other cells have `tabIndex=-1`.
- **`StatusMessage.test.tsx`:** `visuallyHidden` renders `role=status` with no icon and the text; an error renders `role=alert`; the element exists with empty text.
- **`CardList.test.tsx`:** a `list` named by `aria-label`; children are `listitem`s; axe passes.
- **`DetailCard.test.tsx`:**
  - `href` makes the title a link named by the title only, inside a heading of `headingLevel`;
  - `onClick` makes it a button;
  - the body text isn't part of the control's name;
  - a click on the card's body activates the control;
  - action buttons are described by the title;
  - a gated action keeps both descriptions;
  - with neither prop, the title is plain text;
  - `href` and `onClick` together log an error;
  - axe passes for the link and the button variants.
- **`PageEmptyState`:** the title is an `h2`.
- **`DataTableBlock.test.tsx`:** it is named by `label`; its search is named "Search {label}"; `aria-sort`; axe.
- **`DataTable.types.test.tsx`:** `@ts-expect-error` on a table with no name, and on one with both `label` and `aria-labelledby`.

### Layer 2 — web components and views (`apps/web/src/__tests__/`)

| Test file | Cases |
|---|---|
| `PaginationToolbar.test.tsx` | ~12 |
| `MemberList` test, `InferredColumnsTable` test | ~6 |
| `EntityRecordDataTable` / `EntityDetailView.test.tsx` | ~3 |
| `Toolpacks`, `EntityGroupDetail`, `ColumnDefinitionDetail` view tests | ~6 |
| Index-page view tests (Stations, Entities, Tags, Jobs, …) | ~8 |
| `CuratedViewDetail.container.test.tsx` | ~1 |
| `BulkFailuresTableBlock`, `ConnectorEntity` tests | ~3 |
| `RouterLink.test.tsx` (new) | ~1 |

- **`PaginationToolbar.test.tsx`:**
  - nothing is announced on mount;
  - after typing a search and the total settling, the status reads "12 results, page 1 of 2";
  - "No results found" and "1 result";
  - "Loading results…" only when `loading` outlasts 500 ms (fake timers);
  - the same count twice is re-announced;
  - Filter, Advanced Filters and Sort have `aria-haspopup="dialog"` and `aria-expanded` toggling, and their popovers are named dialogs;
  - the Filter name includes the active count;
  - sort direction exposes `aria-pressed`;
  - the sort-by group is named;
  - axe passes on the open toolbar.
- **`MemberList`, `InferredColumnsTable`:**
  - each table is a named grid, and one Tab stop enters it;
  - arrow keys reach the Roles select;
  - Enter opens interaction and Escape returns;
  - the row's Remove is reachable and named;
  - axe passes.
- **Records:** the record link opens the record route, and the validity cell is named "Valid"/"Invalid".
- **`Toolpacks`, `EntityGroupDetail`, `ColumnDefinitionDetail`:** row actions are named with their row; navigation is a link.
- **Index pages:**
  - the card list is a named `list`;
  - each card is a listitem whose link is named by the title alone and points at the right href;
  - card headings are `h2`;
  - Delete is described by its card's title.
- **`CuratedViewDetail`:** an error shows an alert, not "No results found".
- **`BulkFailuresTableBlock`, `ConnectorEntity`:** `aria-expanded` toggles, and the empty header is named.
- **`RouterLink`:** it renders an anchor with the href and navigates through the router.

### Layer 3 — the audit (root)

- `npm run a11y:report` leaves `docs/A11Y_AUDIT.md`'s `#794` section with no rows, and the stale `no-autofocus` row is gone.
- KB-07 is closed by hand with a "**Closed:**" Observed cell.
- No new rows appear in another owner's section.

**Totals:** about 90 cases (≈48 core, ≈40 web, plus the audit run). No migration or seed test.

## Acceptance criteria

- [ ] Every table in the app has an accessible name, and its sorted column's header reports `aria-sort`.
- [ ] Every row that opens something does so through a link reachable by Tab and Enter. No row is click-only.
- [ ] Members and Inferred columns are APG grids: one Tab stop, arrow-key cell navigation, and Enter/F2 in, Escape out.
- [ ] Changing a list's search, filters, sort, page size or page makes a screen reader say the new count ("No results found" when empty). A load longer than 500 ms says "Loading results…". A failed load is announced as an alert. Arriving on a page announces nothing extra.
- [ ] Each card in a list is one list item, named by its title, with its title as a heading of the right level. Its actions are described by that title.
- [ ] Every icon-only row action's name says which row it acts on.
- [ ] Columns can be reordered without dragging (Move up / Move down), closing KB-07.
- [ ] `npm run a11y:report` reports no findings in #794's section, and axe passes in the table, card and toolbar component tests.

## Risks & rollback

- **The required table name breaks the build for any caller not updated.** This is intended: tsc lists every one. Mitigation: all 14 callers change in the same slice.
- **Stretched-link cards change hit-testing.** A nested control without `z-index` would be covered by the `::after`. Detection: the card tests click the actions, and the smoke walk clicks every card list. Rollback: revert the `DetailCard` slice. The props are additive except the `CardActionArea` removal.
- **Grid key handling can trap focus or fight a widget's own keys** (a Select's arrows). Detection: the interaction-mode tests and the smoke walk. Escape is the documented way out, and Tab always leaves.
- **Over-announcing.** Announcements are gated on user changes and a 500 ms loading delay. The smoke walk listens with the accessibility tree.
- **Fail mode:** presentation only. On any failure the visible UI is unchanged, and nothing is fail-open on data.

## Files touched

**New**
- `packages/core/src/ui/use-grid-navigation.ts`
- `packages/core/src/ui/CardList.tsx`
- `apps/web/src/components/RouterLink.component.tsx`
- Tests:
  - `packages/core/src/__tests__/ui/use-grid-navigation.test.tsx`
  - `packages/core/src/__tests__/ui/CardList.test.tsx`
  - `packages/core/src/__tests__/ui/DataTable.types.test.tsx`
  - `apps/web/src/__tests__/RouterLink.test.tsx`

**Edit (core)**
- `DataTable.tsx`
- `DataTableBlock.tsx`
- `ContentBlockRenderer.tsx`
- `DetailCard.tsx`
- `ActionsSuite.tsx`
- `StatusMessage.tsx`
- `PageEmptyState.tsx`
- `ThemeProvider.tsx` (`a11yComponents`: the card focus ring)
- `index.ts`
- Stories for `DataTable`, `DetailCard`, `StatusMessage` and `CardList`, plus their tests

**Edit (web)**
- `PaginationToolbar.component.tsx`
- `EntityRecordDataTable.component.tsx`
- `MemberList.component.tsx`
- `PendingInvitationList.component.tsx`
- `AuditLogActivity.component.tsx`
- `UsageLedgerDialog.component.tsx`
- `PolicyStatementList.component.tsx`
- `ConnectorEntity.component.tsx`
- `BulkFailuresTableBlock.component.tsx`
- `StationList.component.tsx`
- The card components (`Job`, `ColumnDefinition`, `ConnectorInstance`, `ConnectorDefinition`, `TagCard`, `PinnedResultsList`, `PortalCard`, `DefaultStationCard`)
- `workflows/RestApiConnector/InferredColumnsTable.component.tsx`
- `modules/TableWidget/TableWidget.component.tsx`
- Views:
  - `Toolpacks`, `EntityGroupDetail`, `ColumnDefinitionDetail`
  - `EntityDetail`, `CuratedViewDetail`
  - `Entities`, `EntityGroups`, `CuratedViews`
  - `ColumnDefinitionList`, `Jobs`, `Tags`, `Connector`
  - `PinnedResultsListView`
- Every view rendering `<PaginationToolbar>` (the `loading` prop)
- Their tests

**Docs**
- `docs/A11Y_AUDIT.md` (regenerated, KB-07 closed)

## Next step

`docs/A11Y_TABLES_LISTS.plan.md` sequences this into 7 TDD slices on this branch, each a green commit:
1. `DataTable` name, sort and row links, with the 14 callers and `RouterLink`.
2. Column-config move buttons (KB-07).
3. `StatusMessage` `visuallyHidden` and the toolbar announcer, with `loading` at every caller.
4. Toolbar control states and names.
5. `CardList`, the title-as-control `DetailCard`, the index pages, heading levels and `PageEmptyState`.
6. Row-named actions and the smaller fixes, including `DataTableBlock`.
7. `useGridNavigation` and `variant="grid"` for Members and Inferred columns, then the audit regeneration.
