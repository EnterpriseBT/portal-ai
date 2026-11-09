# Accessible tables, grids and lists — Plan

**This is the test-first order for #794's contract:**
- named, sortable tables whose rows open through links;
- a non-drag column reorder;
- announced list states and named toolbar controls;
- card lists named by their titles;
- row-specific action names;
- two APG grids;
- the regenerated audit and the doc sync.

Spec: `docs/A11Y_TABLES_LISTS.spec.md`. Discovery: `docs/A11Y_TABLES_LISTS.discovery.md`. Issue: #794, a child of epic #791. Builds on #793's gates and descriptions (`ActionGate`, `useGateReason`), #797's route announcer and #988's search naming, all on `epic/a11y-conformance`.

There are 8 slices. Each sits behind a green test suite and leaves the repo compilable. Each lands as a commit on `feat/794-a11y-tables-lists` (PR #994): one feature, one PR, per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package (never jest directly):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
cd packages/core && npm run build   # before any web run that needs the change
```

Each slice:
1. write the failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. run `npm run lint && npm run type-check && npm run format:check` in each touched package (core's `npm run build` first);
5. move to the next slice.

**Sequencing rationale.** Core primitives land with their callers in the same slice, so the tree always compiles:

| Slice | Why it sits here |
|---|---|
| 1 | The required table name breaks every `DataTable` caller, so all of them and `RouterLink` land together. Later slices reuse `RouterLink` and the named tables. |
| 2 | Column-config move buttons are internal to `DataTable` and independent; they close KB-07's code. |
| 3 | The announcer needs `StatusMessage` `visuallyHidden`, so they go together. `loading` is an optional prop, so callers can adopt it in the same slice without breaking anything. |
| 4 | Toolbar control states. It touches the same file as slice 3, so it comes after to keep the diffs apart. |
| 5 | `CardList` and `DetailCard`. It reuses `RouterLink` (slice 1) and is the largest view sweep. |
| 6 | Row-named actions, `DataTableBlock`, and the small fixes. These are leaf changes over files slices 1 and 5 already touched. |
| 7 | `useGridNavigation` is the riskiest behaviour, so it comes after the tables are named and stable. Its two adopters are already named tables. |
| 8 | The audit regeneration has to run last, when the area is clean. The convention docs go here too. |

---

## Slice 1 — Named, sortable tables whose rows open through links

Every `DataTable` gets a name, sorted headers report `aria-sort`, and rows that navigate become links.

**Files**

- Edit: `packages/core/src/ui/DataTable.tsx`:
  - the `DataTableName` union;
  - a hidden `<caption>`;
  - `sortDirection` on the header `TableCell`;
  - `rowHref`, `primaryColumn`, `linkComponent`, and the row-click-follows-link handler;
  - `headerLabel`.
- New: `packages/core/src/__tests__/ui/DataTable.types.test.tsx`.
- New: `apps/web/src/components/RouterLink.component.tsx` and `apps/web/src/__tests__/RouterLink.test.tsx`.
- Edit: every `DataTable` caller in the spec's Callers table. Each gets a `label`:
  - `InferredColumnsTable`, `ConnectorEntity`, `UsageLedgerDialog`, `EntityRecordDataTable`, `AuditLogActivity`;
  - `PendingInvitationList`, `MemberList`, `TableWidget`, `PolicyStatementList`;
  - `ColumnDefinitionDetail`, `EntityGroupDetail`, `Toolpacks`.
- Edit: navigation moves from `onRowClick`/`onCellClick` calling `navigate` to `rowHref` (or a `render`ed `RouterLink`):
  - `EntityDetail.view` (records);
  - `Toolpacks.view` (the name cell, the row);
  - `EntityGroupDetail.view` (row to entity);
  - `ColumnDefinitionDetail.view` (the entity cell).
- Edit: the `DataTable` story, so the story sweep names the table.

**Steps**

1. **Tests:**
   - spec Layer 1 `DataTable.test.tsx`: the name (both forms), `aria-sort`, the `rowHref` link, row-click-follows-link, a click on a button in the row doesn't follow, `primaryColumn`, `headerLabel`, axe on a sortable table with row links;
   - `DataTable.types.test.tsx` (both `@ts-expect-error` cases);
   - `RouterLink.test.tsx`;
   - Layer 2 records: the record link opens the record route;
   - `Toolpacks`, `EntityGroupDetail`, `ColumnDefinitionDetail`: navigation is a link with the right href.

   Run them; they fail.
2. **Implement** the core props, then `RouterLink`, then each caller until tsc is clean (the type test proves the name is required). Run core's `npm run build`, then the web suites. Green.
3. Lint, type-check and format in core and web.

**Done when:** every `getByRole("table")` in the touched tests resolves by name, no web code calls `navigate` from a table click, and both packages compile.

**Risk:** existing tests that clicked a row expecting `onRowClick`'s `navigate` mock must now assert the link's href or route. Update them, don't delete them.

---

## Slice 2 — Column reorder without dragging (KB-07)

**Files**

- Edit: `packages/core/src/ui/DataTable.tsx` (`SortableColumnItem`):
  - "Move {label} up/down" `GatedIconButton`s;
  - `disable` gates at the ends ("Already first" / "Already last");
  - the shared `arrayMove`.
- Edit: `packages/core/src/__tests__/ui/DataTable.test.tsx`.

**Steps**

1. **Tests:**
   - spec Layer 1: Move up and Move down call `onColumnConfigChange` with the reordered config;
   - the first item's Up and the last item's Down are `aria-disabled` and described by their reason;
   - the drag handle keeps its name.

   Run them; they fail.
2. **Implement.** Green. Core build.
3. Lint and type-check.

**Done when:** a keyboard or single-pointer user can reorder any column without dragging. KB-07 is closed in slice 8, after the audit run.

**Risk:** none. The props are unchanged, and the popover only gains buttons.

---

## Slice 3 — Announced list states

**Files**

- Edit: `packages/core/src/ui/StatusMessage.tsx` (`visuallyHidden`) and `packages/core/src/__tests__/ui/StatusMessage.test.tsx`.
- Edit: `apps/web/src/components/PaginationToolbar.component.tsx`:
  - the `loading` prop;
  - the persistent announcer;
  - `announcementFor`;
  - user-change tracking on search (after debounce), filters, advanced filters, sort, page size and paging;
  - the 500 ms loading delay;
  - re-announcing the same text.
- Edit: `apps/web/src/__tests__/PaginationToolbar.test.tsx`.
- Edit: every view or component rendering `<PaginationToolbar>`, passing `loading` from its list query.
- Edit: `CuratedViewDetail.view.tsx`: the error path renders `StatusMessage variant="error"` (Key decision 4 makes every list's error an alert), and its container test.

**Steps**

1. **Tests:**
   - spec Layer 1 `StatusMessage` (3 cases);
   - Layer 2 `PaginationToolbar`:
     - nothing is announced on mount;
     - the count, with the page suffix, after a search;
     - "No results found" and "1 result";
     - "Loading results…" only past 500 ms (fake timers);
     - the same count twice re-announces;
   - `CuratedViewDetail`: an error shows an alert.

   Run them; they fail.
2. **Implement** `StatusMessage`, run core's build, then the toolbar. Thread `loading` through each caller (grep `<PaginationToolbar`). Green.
3. Lint and type-check, core and web.

**Done when:** every list's search, filter, sort or paging change is spoken once its results settle, and a list's load error is an alert everywhere.

**Risk:** a view whose query uses `isFetching` for a background refetch would announce "Loading…" on every refetch. Pass `isLoading`, unless the toolbar's own change triggered the fetch. The 500 ms delay and the user-change gate cover most of it.

---

## Slice 4 — Toolbar control states and names

**Files**

- Edit: `apps/web/src/components/PaginationToolbar.component.tsx`:
  - `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls` on Filter, Advanced Filters and Sort;
  - their popover papers get `role="dialog"` and an `aria-label`;
  - the count in the buttons' names;
  - the `aria-labelledby` "Sort by" group;
  - the sort direction becomes a `ToggleButtonGroup`.
- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json`: compact `MuiToggleButton` sizing, if the default doesn't match the chips.
- Edit: `apps/web/src/__tests__/PaginationToolbar.test.tsx`, and the snapshot (expected to change).

**Steps**

1. **Tests:**
   - spec Layer 2: popover buttons expose state and control their named dialogs;
   - the Filter name carries the active count;
   - the sort-by group is named;
   - the direction exposes `aria-pressed`;
   - axe passes with each popover open.

   Run them; they fail.
2. **Implement.** Green. Review the snapshot diff, then update it.
3. Lint and type-check.

**Done when:** every toolbar control's role, state and name are complete in the accessibility tree.

**Risk:** callers' tests that clicked the "Asc"/"Desc" chips by text must click the toggle buttons by name. Grep `"Asc"`/`"Desc"` in the web tests.

---

## Slice 5 — Card lists named by their titles

**Files**

- New: `packages/core/src/ui/CardList.tsx` and `packages/core/src/__tests__/ui/CardList.test.tsx`, plus a story.
- Edit: `packages/core/src/ui/DetailCard.tsx`:
  - the title becomes the control (link or button);
  - the stretched `::after`;
  - remove `CardActionArea`;
  - a title `id` passed to `ActionsSuite`;
  - `href` and `linkComponent`.
- Edit: `packages/core/src/ui/ActionsSuite.tsx`: an optional `describedBy`, forwarded to each `GatedButton`.
- Edit: `packages/core/src/ui/ThemeProvider.tsx` (`a11yComponents`): a card focus ring through `:has(:focus-visible)`.
- Edit: `packages/core/src/ui/PageEmptyState.tsx`: `component="h2"`.
- Edit:
  - core tests `DetailCard.test.tsx` and `PageEmptyState.test.tsx`;
  - `ThemeProvider.test.tsx` for the focus ring, if it's asserted there.
- Edit: `packages/core/src/ui/index.ts` (export `CardList`).
- Edit (web), the card lists:
  - `StationList`, `Entities.view`, `EntityGroups.view`, `CuratedViews.view`;
  - `ColumnDefinitionList.view`, `Jobs.view`, `Tags.view`, `Connector.view` (×2), `PinnedResultsListView.view`.

  Each gets `<CardList aria-label>` and `headingLevel={2}`, and its cards navigate with `href` and `linkComponent={RouterLink}`, except those that open a dialog (Tag, and any card whose click isn't a route change).
- Edit (web), the card components:
  - `Job`, `ColumnDefinition`, `ConnectorInstance`, `ConnectorDefinition`, `TagCard`;
  - `PinnedResultsList`, `PortalCard`, `DefaultStationCard`.

  Their click props change from an `onOpen` that navigates to an `href`.
- Edit: those views' and components' tests.

**Steps**

1. **Tests:**
   - spec Layer 1 `CardList` (3 cases), `DetailCard` (9 cases, including the gated action's description surviving), `PageEmptyState` (1 case);
   - Layer 2, the index pages:
     - a named list of listitems;
     - each card's link is named by its title alone, with the right href;
     - `h2` card headings;
     - Delete is described by the card's title.

   Run them; they fail.
2. **Implement** core, then run core's build. Sweep the views one at a time, running each view's suite as it goes. Green.
3. Lint and type-check, core and web.

**Done when:** no card button's name includes its body, every card list is a `list`, and the `h3`/`h6` heading-order sources are gone. The audit confirms this in slice 8.

**Risk:**
- **Hit-testing:** an action without `position: relative; z-index: 1` would be covered by the stretched `::after`. The card tests click both the body and the actions.
- **The deciding question per card is whether its click changes the route.** Only route changes become links. Check each card's `onOpen` target before converting it.

---

## Slice 6 — Row-named actions, `DataTableBlock`, and the small fixes

**Files**

- Edit: icon actions get row names, per the spec's Callers table, in `Toolpacks.view`, `EntityGroupDetail.view` and `ColumnDefinitionDetail.view`.
- Edit: text alternatives for the records validity icon (`EntityRecordDataTable`) and the `ColumnDefinitionDetail` check icons.
- Edit: `aria-expanded`/`aria-controls` and a named empty header in `BulkFailuresTableBlock.component.tsx` and `ConnectorEntity.component.tsx`.
- Edit:
  - `packages/core/src/ui/DataTableBlock.tsx`: a required `label`, the caption, its search named "Search {label}", and `sortDirection`;
  - `ContentBlockRenderer.tsx` and `TableWidget.component.tsx` pass the label;
  - `DataTableBlock.test.tsx`.
- Edit: those components' and views' tests.

**Steps**

1. **Tests:**
   - spec Layer 1 `DataTableBlock` (4 cases);
   - Layer 2:
     - row actions are named with their row;
     - the validity cell reads "Valid"/"Invalid";
     - the expand toggles report `aria-expanded`;
     - the empty header is named.

   Run them; they fail.
2. **Implement.** Run core's build. Green.
3. Lint and type-check.

**Done when:** no icon-only row action in the app shares one name across rows, and every icon carrying meaning in a cell has a text alternative.

**Risk:** existing tests that queried "Remove member" or "Delete toolpack" by their old name. Update them to the row-specific names.

---

## Slice 7 — APG grids: Members and Inferred columns

**Files**

- New: `packages/core/src/ui/use-grid-navigation.ts` and `packages/core/src/__tests__/ui/use-grid-navigation.test.tsx`.
- Edit: `packages/core/src/ui/DataTable.tsx`: `variant="grid"`, with the roles and `useGridNavigation` wired to the header and body cells.
- Edit: `packages/core/src/ui/index.ts` (export the hook).
- Edit: `MemberList.component.tsx` and `workflows/RestApiConnector/InferredColumnsTable.component.tsx` (`variant="grid"`), plus their tests.

**Steps**

1. **Tests:**
   - spec Layer 1 `use-grid-navigation` (12 cases), and `DataTable`'s grid roles;
   - Layer 2 `MemberList` and `InferredColumnsTable`:
     - one Tab stop;
     - arrows reach the Roles select;
     - Enter in, Escape out;
     - a select's own Escape closes its menu first;
     - Remove is reachable and named;
     - axe passes.

   Run them; they fail.
2. **Implement** the hook against a plain test grid first, then wire it into `DataTable`, then the two adopters. Core build. Green.
3. Lint and type-check, core and web.

**Done when:** both tables behave as the spec's key table says, and Tab always leaves the grid.

**Risk:**
- **Escape from MUI Select menus.** The menu portals out of the grid, so its Escape never reaches the grid's handler. The grid must ignore an Escape that's already `defaultPrevented`, and treat focus returning to the Select as staying in interaction mode.
- **Text fields in Inferred columns.** Arrow keys belong to the caret there, which is why interaction mode passes them through.

---

## Slice 8 — Regenerate the audit; doc sync

**Files**

- Regenerated: `docs/A11Y_AUDIT.md`, via `npm run a11y:report` (the dev stack running, as the route walk needs it).
- Edit: `docs/A11Y_AUDIT.md` KB-07 gets a "**Closed:**" Observed cell, citing slice 2's commit.
- Edit: `CLAUDE.md` → "Accessibility Requirements (apps/web)". It gains one bullet:
  - a `DataTable` is named (`label`);
  - a row or card that navigates is a link (`rowHref` / `href` with `RouterLink`), never a click calling `navigate`;
  - card lists render through `CardList`;
  - a table whose cells are interactive uses `variant="grid"`;
  - list states are announced by `PaginationToolbar` (pass `loading`).
- Edit: `apps/web/README.md`, if it documents table or list usage. Check it, and record the check in the commit either way.

**Steps**

1. **Tests:** the full core and web unit suites for the touched packages. CI runs everything.
2. **Run** `npm run a11y:report`. The #794 section must be empty, and no other owner may gain a row. If anything remains, fix it in the slice that owns it (an extra commit), then regenerate.
3. Write the docs. Lint and format (markdown isn't formatted).

**Done when:** the audit's #794 section reads "No automated findings.", KB-07 is closed, and CLAUDE.md states the conventions this ticket introduced.

**Risk:** the route walk needs the seeded e2e org and an authenticated fixture. If `e2e:auth` has expired, refresh it first.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Named `DataTable`, `aria-sort`, row links, `RouterLink`, 12 callers | `DataTable` and type tests; caller tests; tsc in core and web |
| 2 | Move up / Move down (KB-07 code) | `DataTable` tests |
| 3 | `StatusMessage` `visuallyHidden`, the toolbar announcer, `loading` everywhere, the curated-view error alert | `StatusMessage` and `PaginationToolbar` tests (fake timers) |
| 4 | Toolbar popover states, names, the sort group and direction toggle | `PaginationToolbar` tests and axe; snapshot reviewed |
| 5 | `CardList`, the title-as-control `DetailCard`, the card focus ring, index pages, `PageEmptyState` `h2` | `DetailCard`, `CardList` and index-page tests |
| 6 | Row-named actions, icon alternatives, toggles, `DataTableBlock` | Component and view tests |
| 7 | `useGridNavigation`, `variant="grid"`, Members, Inferred columns | Hook and adopter keyboard tests |
| 8 | The audit regenerated (empty #794), KB-07 closed, CLAUDE.md | `npm run a11y:report` |

## Cross-slice notes

- **Core rebuild:** web consumes core's `dist`, so run `npm run build` in `packages/core` before every web run that needs a core change.
- **Partial module mocks:** web tests fake some modules partially. A new core export (`CardList`, `useGridNavigation`) that a component imports can fail CI only, under a test that mocks `@portalai/core/ui` partially. Grep those mocks before pushing slices 5 and 7.
- **Snapshots:** `PaginationToolbar`'s snapshot changes in slices 3 and 4. Review each diff before updating it, never blind.
- **No new local `Snackbar` or live region:** the announcer is a `StatusMessage`, per CLAUDE.md's status rule.
- **Styling:** card list reset and grid focus styles are core `sx` with a reason, or `a11yComponents()`. Nothing ad hoc in `apps/web`.
- **Doc sync:** CLAUDE.md gets the conventions in slice 8. No user-facing help, glossary or tool copy describes tables, so none changes. Check `apps/web/README.md`.
- **Merge gate:** after slice 8, run the full chain: code-review, security (likely waivable: presentation only), smoke and adversarial. Both are required for a full feature, through `/smoke` and `/adversarial-review`.

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
