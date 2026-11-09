# a11y-tables-lists — Smoke Suite

Manual smoke test for [#794](https://github.com/EnterpriseBT/portal-ai/issues/794): accessible tables, grids and card lists. It covers:
- named, sortable tables whose rows open through links;
- APG grids for Members and Inferred columns;
- announced list results;
- toolbar control states;
- card lists named by their titles;
- row-named actions;
- non-drag column reorder (KB-07).

**Branch under test:** `feat/794-a11y-tables-lists` (PR [#994](https://github.com/EnterpriseBT/portal-ai/pull/994)).

Run **§Preflight** once; every section after it is independent. Accessibility checks read the **accessibility tree** (Chromium DevTools → Accessibility, a screen reader, or the agent's `browser_snapshot`), not just what's on screen. Steps tagged `— manual` need a human; the rest are `/smoke-walk`-eligible.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/794-a11y-tables-lists && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Web reads core's `dist`, and this branch changes `DataTable`, `DetailCard`, `StatusMessage`, `DataTableBlock`, and adds `CardList`, `useGridNavigation` and `VisuallyHidden`. No migration.
- [ ] `npm run dev` boots cleanly (web :3000, API :3001).

### Fixtures

- [ ] Signed in as the e2e owner in the `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:auth`). It has Customers (8 mappings, two of them "Enum"), several entities and stations, and owner/admin/member members.
- [ ] For §2 and §6, create one entity group ("Smoke 794 group") with a Customers member. For §4, create one curated view on Customers. Delete both afterwards.

### Reset between runs

- [ ] Delete the group and view you created. Everything else is read-only.

## §1 — Tables are named and report their sort (criterion 1)

- [ ] Open the Customers entity. In the accessibility tree its records table is a `table` named **"Records"**.
- [ ] Settings → Members: the members grid is named **"Members"**, and the pending invitations table is named **"Pending invitations"** (by the visible heading above it).
- [ ] `/toolpacks`: the table is named **"Toolpacks"**. Settings → Organization → "Itemized usage": **"Usage ledger"**. Settings → Activity: **"Audit log"**.
- [ ] On the Customers records, sort by a column. Its header reports `aria-sort="ascending"`, then `"descending"` after a second sort. No other header has `aria-sort`.

## §2 — Rows open through links (criterion 2)

- [ ] On Customers, Tab to a record row's first cell. It's a link named **"Open record <value>"**, and Enter opens `/entities/<id>/records/<recordId>`.
- [ ] Back on the list, click a row's plain text (not the link). The same record opens.
- [ ] Ctrl/Cmd-click a row's plain text. The record opens in a **new tab**, and the current tab stays on the list.
- [ ] Open "Smoke 794 group". Its member row's entity name is a link to `/entities/<id>`.
- [ ] Open a column definition that has mappings (e.g. "Enum"). Each mapping's entity name is a link to that entity.
- [ ] `/toolpacks`: a pack's name is a **button** (it opens the details dialog, not a page). Enter on it opens the dialog.

## §3 — Column reorder without dragging (criterion 7, KB-07)

- [ ] On Customers, press "Configure columns". Each column row has **"Move <label> up"** and **"Move <label> down"** buttons.
- [ ] Press "Move <second column> up". That column becomes the first header. Reloading keeps the order.
- [ ] The first column's Up and the last column's Down are reachable but unavailable (`aria-disabled="true"`), described "Already first" / "Already last".

## §4 — List results are announced (criterion 4)

The live text is the toolbar's visually hidden `role="status"` element. Read it from the accessibility tree.

- [ ] Arrive on `/entities`. The status is **empty**, and focus is on the `h1`.
- [ ] Type "Cust" in Search. About half a second after typing stops, the status reads **"1 result"** (or the matching count).
- [ ] Search "zzznomatch". It reads **"No results found"**. Clear the search; it reads the full count, with **", page 1 of N"** when there's more than one page.
- [ ] Press "Next page". It reads the count and **"page 2 of N"**.
- [ ] Throttle the network to "Slow 3G" in DevTools and change the sort. **"Loading results…"** is read before the count. — manual
- [ ] Open your curated view, block `/api/curated-views/*/records` (DevTools request blocking), and reload. The records area shows an **alert**, "Couldn't load this view's rows.", not "No results found". — manual

## §5 — Toolbar controls (diff surface)

- [ ] On `/entities`, "Filter" and "Sort" each report `aria-haspopup="dialog"` and `aria-expanded="false"`. Opening one sets `aria-expanded="true"` and shows a `dialog` named **"Filters"** / **"Sort"**.
- [ ] Set a filter. The Filter button's name becomes **"Filter, 1 active"**.
- [ ] In Sort, the options are a radio group named **"Sort by"**. Direction is a group named **"Sort direction"** with **"Ascending"** / **"Descending"** buttons, exactly one `aria-pressed="true"`.

## §6 — Card lists (criterion 5)

- [ ] `/stations`: the cards are a `list` named **"Stations"**, one `listitem` per station. Each card's title is an `h2` holding a link named by the **title alone**, not the tool packs or description.
- [ ] Click a station card's body text (not the title). The station opens. Hovering a "Not included in your plan" tool-pack chip still shows its tooltip.
- [ ] A station's "Delete" button is described by the station's name (accessible description = the title).
- [ ] Repeat the list/link/heading check on `/entities`, `/entity-groups`, `/views`, `/column-definitions`, `/connectors` (both tabs), `/jobs` and `/portal-results`. On `/tags` the cards are a list of `h2`s with **no** title link (Edit opens a dialog).
- [ ] Dashboard: "Recent portals" and "Pinned results" are named lists whose cards link to `/portals/<id>` and `/portal-results/<id>`. "View All" is a link to `/portal-results`.
- [ ] A station's detail page: its portals are a list named **"Portals"**, each card linking to its portal.
- [ ] On an empty list (`/entity-groups` with none), the empty-state title is an `h2`.

## §7 — Row actions name their row (criterion 6)

- [ ] "Smoke 794 group": the member's remove button is named **"Remove Customers"**, and the star **"Set Customers as primary"** (or "Remove Customers as primary").
- [ ] Column definition "Enum": each mapping's actions read **"Edit mapping <source field> in <entity>"** / **"Delete mapping …"**. Its Primary Key / Required check icons read **"Yes"**.
- [ ] Customers records: the Valid column's icons read **"Valid"** / **"Invalid"**.
- [ ] A connector instance's page: each entity card's mappings toggle is named **"<entity> field mappings"** and reports `aria-expanded` as it opens and closes.
- [ ] `/toolpacks` with a custom pack: its actions read **"Refresh <name> schema"**, **"Edit <name>"**, **"Delete <name>"**. — manual (needs a registered custom pack)
- [ ] A portal message with a bulk job's failures table: it's named **"Failed records"**, and each row's toggle is **"Details for <sourceKey>"** with `aria-expanded`. — manual (needs a bulk job with failures)

## §8 — Grids (criterion 3)

- [ ] Settings → Members: Tab from the controls before the grid. Focus lands on **one cell**, and the next Tab leaves the grid entirely.
- [ ] Back in the grid, the arrow keys move cell by cell and stop at the edges. Home/End go to the row's ends, Ctrl+Home/End to the grid's.
- [ ] On a member's Roles cell, press Enter. Focus moves into the "Roles for <email>" combobox. ArrowDown opens its menu, the first Escape closes the menu (focus stays on the combobox), and a second Escape returns to the cell.
- [ ] On a member's last cell, Enter focuses **"Remove <email>"**.
- [ ] REST connector wizard: reach the columns step (any JSON endpoint). The "Inferred columns" table is a grid. ArrowRight to a key cell, Enter into the text field, then arrow keys move the caret and typing edits it. Escape returns to the cell.
- [ ] On the same step with no columns yet, ArrowDown from a header lands on the "No columns yet…" cell, and the grid still has a Tab stop.

## §9 — Chat and widget tables (diff surface)

- [ ] In a portal session, ask for a table of records (e.g. "Show the customers as a table"). The table is named **"Query results"**, its search is named **"Search Query results"**, and a sorted header reports `aria-sort`. — manual (needs a live model)

## §10 — The audit (criterion 8)

- [ ] `docs/A11Y_AUDIT.md` (regenerated on this branch by `npm run a11y:report`) shows **"No automated findings."** under #794, and no other owner's row count rose. KB-07 reads **Closed**. — manual (a file check, not a browser one)

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/entity/group/view ids):
