# Accessible tables, grids and lists — Discovery

**Issue:** [EnterpriseBT/portal-ai#794](https://github.com/EnterpriseBT/portal-ai/issues/794) · Feature · full. Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why this exists.** Records, entities, column definitions, members and jobs render as tables or card lists, the densest surfaces in the app, and none of them is built for a keyboard or screen-reader user. Tables have no name and no `aria-sort`, and a row opens only by clicking its `<tr>`. Cards are one button whose name is every word on the card, with the heading inside the button. Search, filter, sort and paging change the results silently. Tables whose cells hold controls give a keyboard user dozens of tab stops per screen. The audit (#792) caught only the part a scanner sees: 5 rows (4 `heading-order`, 1 stale `no-autofocus`) and keyboard row KB-07.

The PRD was completed on 2026-11-09:
- result changes, loading, empty and error are announced through `StatusMessage`;
- the index pages' card lists are in scope;
- a table becomes an APG grid only where its cells are interactive.

This is the work that makes every list in the app readable and operable cell by cell, row by row, without a pointer.

## The current shape

### Core primitives (`packages/core/src/ui`)

| Piece | Location | State today |
|---|---|---|
| `DataTable` | `DataTable.tsx:379` | `<Table size="small">` with no name. Sort is MUI `TableSortLabel` (:385, :392), with no `aria-sort` on the `th`. The empty state is a row with `emptyMessage` (default "No data", :326). |
| Row and cell clicks | `DataTable.tsx:85`, :429–448 | `onRowClick` and `onCellClick` are `onClick` on `<tr>`/`<td>`, with no tabindex, role or key handling. Not keyboard-reachable. |
| Column config | `DataTable.tsx:211`, :254 | A popover list reordered with dnd-kit (`KeyboardSensor` present). Each drag handle is named "Drag to reorder {label}". There is no single-pointer alternative, which is KB-07 (2.5.7). |
| `DataTableBlock` | `DataTableBlock.tsx:113` | Chat and `TableWidget` table. Its search `TextField` has only a placeholder; it also has `TablePagination` and `TableSortLabel`. |
| `DetailCard` | `DetailCard.tsx:100`, :77, :29/:44 | With `onClick`, one `CardActionArea` button wraps the title and body, so the name is all of the card's text and the title heading sits inside a button. The title is `h${headingLevel}`, default 3, and no web caller passes `headingLevel`. |
| Card actions | `DetailCard.tsx:118` → `ActionsSuite.tsx:51` | `GatedButton`s beside the action area (not nested), named only "Delete", "Edit" and so on, identical on every card. |
| `PageEmptyState` | `PageEmptyState.tsx:50` | `Typography variant="h6"` with no `component`. This is the audit's `h6` `heading-order` row, on 11 pages. |
| `StatusMessage` | `StatusMessage.tsx:63` | `role="alert"` for an error, `status` otherwise. It mounts already holding its text, which a live region may not read (`ToastHost.component.tsx:49` records this). |

### Tables in apps/web

| Table | Location | Cells | Row actions |
|---|---|---|---|
| Records (entity, curated view) | `EntityRecordDataTable.component.tsx`, via `EntityDetail.view.tsx`, `CuratedViewDetail.view.tsx` | Read-only. The validity column is a bare icon (:85, :87). Truncated text has a hover-only tooltip. | Row click opens the record. |
| Members | `MemberList.component.tsx` | A Groups `Select` and a Roles `Select` per row (:113, :177) | "Remove {email}" (:214) |
| Toolpacks | `Toolpacks.view.tsx` | Read-only; the name cell is clickable | "Refresh toolpack schema", "Edit toolpack", "Delete toolpack" (:232, :252, :265), the same on every row |
| Group members | `EntityGroupDetail.view.tsx` | Read-only | "Set as / Remove as primary" (:189), "Remove member" (:211), the same on every row |
| Inferred columns (REST wizard) | `workflows/RestApiConnector/InferredColumnsTable.component.tsx` | A TextField, a select, a Checkbox and a Remove button per row | — |
| Key/value editor | `KeyValueTable.component.tsx:89` | A bespoke MUI `Table` with TextFields and Remove per row | — |
| Others | `PendingInvitationList`, `AuditLogActivity`, `UsageLedgerDialog`, `ColumnDefinitionDetail` (field mappings), `ConnectorEntity`, `PolicyStatementList`, `BulkFailuresTableBlock`, `FilterSqlPreview` | Mostly read-only. Some have bare check icons, an empty header cell, or expand buttons without `aria-expanded`. | Icon buttons, mostly named |

### Lists, toolbar and states

- **Card lists:** always `<Stack spacing={1}>` (e.g. `Entities.view.tsx:225`, `StationList.component.tsx:210`), never a list. Cards open through `onOpen`-style callbacks that call `navigate` (`StationList.component.tsx:119`). That breaks CLAUDE.md's rule that a route change is a router `Link`.
- **`PaginationToolbar`:**
  - The range is plain text, "{page} of {totalPages} ({total})" (:1106).
  - Filter, Advanced Filters (:1044) and Sort are Buttons that open Popovers, with no `aria-haspopup`/`aria-expanded`, and their badge counts aren't in their names.
  - Sort direction is two `Chip`s, "Asc"/"Desc" (:1011), whose state is shown only by colour.
- **States:**
  - `DataResult` swaps in a fresh `StatusMessage` for loading or error.
  - The empty state is `EmptyResults` (`h2` "No results found") or `PageEmptyState`.
  - Nothing announces a result change.
- **No router seam in core.** `SidebarNavItem.component.tsx:2` imports TanStack's `Link` in web, so a core card can't render a router link by itself.

### Tests and the audit

- `expectNoAxeViolations` (web `test-utils.tsx`, core `axe.util.ts`) runs almost only on dialogs. `DataTable`, `DataTableBlock` and `DetailCard` tests have no axe call.
- `npm run a11y:report` regenerates `docs/A11Y_AUDIT.md` from jsx-a11y, the story sweep and the Playwright route walk (`packages/e2e/src/lib/a11y-routes.ts:58` gives each list its empty, error and loading states).
- `scripts/a11y-inventory.mjs:111` (`PATH_OWNERS`) routes this area's files to #794. The `no-autofocus` row is stale since #988 and clears on the next run.

## The design space

### Decision 1 — How a table row opens

- **A. Focusable rows:** `tabIndex={0}` on `<tr>` with an Enter handler. A table row isn't an interactive role, so a screen reader announces a focusable row as nothing in particular, and it adds a tab stop per row.
- **B. A link in the row's primary cell:** `DataTable` takes `rowHref` (and `primaryColumn`). That cell renders a link. The row click stays as a pointer convenience that follows the same href.
- **C. A separate "Open" button per row:** an extra column, and redundant for pointer users.

| | A | B | C |
|---|---|---|---|
| Semantics | Weak (a row isn't a control) | A link, read with its row | A button, not a link |
| Tab stops | One per row | One per row | One per row, plus a column |
| Matches "navigation is a link" | No | Yes | No |

**Lean: B.** Opening a record is navigation, so it is a link, as CLAUDE.md requires. A cell holding a link reads naturally with its headers.

### Decision 2 — Naming tables and exposing sort

- **A. Optional `label`/`caption`:** callers may name a table.
- **B. A required name:** `DataTableProps` requires `label` (a visually hidden `<caption>`) or `aria-labelledby`. This mirrors `ModalProps` requiring a `title` or `aria-label` (#793), so tsc fails an unnamed table.

Either way, the sorted column's `th` gets `aria-sort` (`ascending`/`descending`, absent elsewhere), and the sort button keeps its visible label.

**Lean: B.** An optional name stays unset. The dialog contract showed that the type is the gate that holds.

### Decision 3 — Which tables become APG grids

The confirmed rule is a grid only where cells are interactive. Per table:

| Table | Interactive cells | Rows | Lean |
|---|---|---|---|
| Members | Two selects and a remove button | Paginated, often 10–50 | **Grid.** Three tab stops per row is the case a grid is for. |
| Inferred columns (REST wizard) | Four controls | One per inferred column, can be 50+ | **Grid.** It would otherwise be 200+ tab stops. |
| Key/value editor | Two fields and a remove button | Usually 1–5 (headers, params) | **Native table**, with each control named by its row. A form this small is easier to tab through. |
| Every other table | Read-only, or one action | — | **Native table** |

- **How:** one core `useGridNavigation` hook with roving tabindex. Arrows move between cells and Home/End/Ctrl+Home/Ctrl+End jump. Enter or F2 enters a cell's control and Escape returns to the cell. `DataTable` exposes it as `variant="grid"` (`role="grid"`, cells `gridcell`).
- **Alternative:** each grid hand-rolls its own keys. Rejected, because two grids would already disagree.

**Lean: a shared hook and `variant="grid"`, adopted by Members and Inferred columns.**

### Decision 4 — Announcing result changes and states

- **A. A persistent visually hidden `StatusMessage` owned by `PaginationToolbar`:**
  - It is mounted for the list's lifetime, so changing its text is announced (the `ToastHost` lesson).
  - Its text comes from the toolbar's own state: "12 results", "No results found", "Loading…", or the error.
  - This needs `isLoading` and `error` passed to the toolbar beside the `total` it already gets.
- **B. `DataResult` announces:** it only sees loading and error, not the count after search, filter or paging.
- **C. Each view announces itself:** 19 places would drift.

Both A and B use `StatusMessage`, which needs a `visuallyHidden` option, since the toolbar already shows the range.

**Lean: A.** Every list has a toolbar, and the toolbar already owns search, filter, sort and paging.

### Decision 5 — Card lists

- **Container:** a core `CardList` renders `ul`/`li`, with list styling reset in the theme, not by `sx`.
- **Name and click target:**
  - **A.** Keep one `CardActionArea` and give it `aria-labelledby` (the title) and `aria-describedby` (the body). The heading stays inside a button, which strips its heading role.
  - **B. "Stretched link":**
    - The title itself is the interactive element: a link when the card navigates (`href` plus a `linkComponent`, which web passes as TanStack's `Link`), or a button when it runs an action (Tag cards open their editor).
    - A pseudo-element stretches the title's hit area over the card, so the whole card is still clickable.
    - The heading wraps the title, and the body is plain text outside any control.
- **Heading level:** index pages have an `h1` and no `h2`, so their cards use `headingLevel={2}`. Cards nested under a section `h2` keep 3. `PageEmptyState` renders `component="h2"`.

**Lean: B, with `CardList` and explicit heading levels.** It gives a short accessible name, a real heading, a link for navigation, and a body that is just text.

### Decision 6 — Row and card action names

Icon-only row buttons repeat one name on every row ("Remove member", "Delete toolpack"). Card actions show visible text ("Delete").

- **Icon-only buttons:** the `aria-label` names the row ("Remove Customers", as Members' "Remove {email}" already does).
- **Visible-text card actions:** keep the visible label as the name (2.5.3, label in name), and take the card title as their description (`aria-describedby`), so the actions list reads "Delete, Customers".

**Lean: both, as above.**

### Decision 7 — Column reorder without dragging (KB-07)

Add "Move up" / "Move down" icon buttons to each item in `DataTable`'s column-config list, named "Move {label} up" / "Move {label} down", and disabled at the ends with a `disable` gate. Keep dnd-kit's drag and keyboard sensor. **Lean: yes.** This is the APG-standard single-pointer alternative, and it costs one row of buttons.

## Tradeoff comparison

| | D1 row link | D2 required name | D3 grids (2) | D4 toolbar announcer | D5 stretched-link cards | D6 action names | D7 move buttons |
|---|---|---|---|---|---|---|---|
| Core API change | `DataTable` props | `DataTableProps` | Hook + variant | `StatusMessage` option | `DetailCard` + `CardList` | — | `DataTable` internal |
| Callers touched | Tables that open rows | Every `DataTable` | 2 | Every toolbar caller | ~13 card lists | ~10 tables, all cards | 0 |
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. `DataTable` requires a name: `label` (a visually hidden caption) or `aria-labelledby`. tsc fails an unnamed table.
2. The sorted column's header cell carries `aria-sort`. `DataTableBlock` gets the same, and its search is named the way `PaginationToolbar`'s is (#988).
3. A table row opens through a link in its primary cell (`rowHref`). Row clicks remain for pointers and follow the same href. `onCellClick` navigation becomes a link the same way.
4. `DataTable` gains `variant="grid"`, backed by a core `useGridNavigation` hook (roving tabindex, APG grid keys). Members and Inferred columns adopt it. The key/value editor and read-only tables stay native tables.
5. `StatusMessage` gains a `visuallyHidden` option. `PaginationToolbar` mounts one persistent instance announcing the result count after search, filter, sort or paging, and the loading, empty and error states, from its `total`, `isLoading` and `error` props.
6. `PaginationToolbar`'s Filter, Advanced Filters and Sort buttons expose `aria-haspopup`/`aria-expanded` and include active counts in their names. Sort direction becomes a labelled radio pair, and the sort options are labelled by "Sort by".
7. A core `CardList` renders card lists as `ul`/`li`. `DetailCard` makes its title the interactive element (a link with `href` + `linkComponent`, or a button with `onClick`), stretched over the card, with the body outside it. Index pages pass `headingLevel={2}`. `PageEmptyState`'s title renders as `h2`.
8. Icon-only row actions name their row. Visible-text card actions take the card title as their description.
9. The column-config list gains Move up / Move down buttons per column (KB-07).
10. Smaller fixes:
    - text alternatives for the records table's validity icon and the bare check icons;
    - `aria-expanded` on the expand toggles (`BulkFailuresTableBlock`, `ConnectorEntity`);
    - a hidden name for empty header cells;
    - the curated view shows an error state on error, not "No results found".
11. Table, card and toolbar tests assert `expectNoAxeViolations`, and a re-run of `npm run a11y:report` leaves this area's audit section empty.

## Open questions

1. **Announce on first load?** On arrival the route announcer focuses the `h1`, so "10 results" right after would compete with the heading. **Lean: no.** Announce only after a user-initiated change (search, filter, sort, page size, page). Loading is announced only if it outlasts ~500 ms, so a fast fetch says nothing until its result.
2. **Truncated cells' hover-only tooltip.** The full text is in the DOM, so screen readers read it, but a sighted keyboard user can't reach the tooltip in a read-only cell (1.4.13). **Lean: accept for the records table.** The row's link opens the record page, which shows every value in full. Recorded, not hidden.
3. **Where the link component comes from.** **Lean: a `linkComponent` prop on `DetailCard` (and `DataTable` for `rowHref`).** The other option, MUI's theme-level `LinkComponent` default, would turn every MUI `Link` and `ButtonBase` with an `href` into a router link, including external links.
4. **Card lists vs paging announcements.** Index pages use the same toolbar, so Recommendation 5 covers them with no extra work. **Lean: confirm in the spec; no separate mechanism.**
5. **Grid on the Members table vs its page size.** A grid's value rises with rows. **Lean: grid regardless of page size,** since the keys are the same and one model per table is simpler.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A, because this is client-side presentation with no shared state or writes.
- **Accuracy & auditability:** N/A, because no record of truth is involved. The audit doc regenerates from the tools.
- **Failure modes:** an error state is announced (`role="alert"`) instead of reading "No results found" (the curated-view bug), so a failed load is never presented as an empty one. **Lean:** fail visibly.
- **Scale & unbounded growth:**
  - Roving tabindex is O(1) per keystroke, with one tab stop per grid.
  - The announcer speaks once per settled change, not per keystroke; search is already debounced, and loading has a 500 ms delay.
  - Large lists stay paginated server-side (keyset where #433 applies).
  - **Lean:** no new cost with row count.
- **Multi-tenancy:** N/A, because nothing crosses an org boundary. Row names in labels are data the viewer can already read.
- **Contract stability:** the core `DataTable`/`DetailCard`/`StatusMessage` props change. A required table name, required by type, keeps future tables conformant without a reviewer. **Lean:** make the conformant path the only one that compiles.
- **Data lifecycle:** N/A, because no data is stored or retained.

## What this doesn't decide

- **The RegionEditor spreadsheet canvas** (#795) and **maps and charts** (#796): separate children.
- **Turning #794's checks into CI gates:** #799 does that once the area is clean.
- **Virtualization:** out of scope by the PRD, and no table virtualizes today.
- **Long-token wrapping in table cells and in portaled listboxes, menus, tooltips and toasts:** #984's out-of-scope note.

## Next step

Write `docs/A11Y_TABLES_LISTS.spec.md` (the props, keys and announcement contract above) and `docs/A11Y_TABLES_LISTS.plan.md`. Slices, each a testable commit:
1. `DataTable` semantics: name, `aria-sort`, row links, move buttons, plus callers.
2. `StatusMessage` `visuallyHidden` and the toolbar announcer.
3. Toolbar control states and names.
4. `CardList` and the stretched-link `DetailCard`, plus the index pages, heading levels and `PageEmptyState`.
5. Row and card action names and the small fixes.
6. `useGridNavigation`, `variant="grid"`, Members and Inferred columns.
7. Re-run `a11y:report` and close KB-07.
