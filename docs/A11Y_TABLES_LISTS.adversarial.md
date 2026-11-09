# a11y-tables-lists — Adversarial Review

Adversarial probes for [#794](https://github.com/EnterpriseBT/portal-ai/issues/794). The surfaces under test:
- tables with names and row links;
- APG grids;
- the toolbar's results announcer;
- card lists with title links and click forwarding;
- row-named actions.

**Branch under test:** `feat/794-a11y-tables-lists` (PR [#994](https://github.com/EnterpriseBT/portal-ai/pull/994)).

These probes ask how the new behaviour breaks: hostile names flowing into labels, forwarded clicks firing when they shouldn't, the grid's key handling, the announcer under rapid input, and stale or deleted rows. Read results from the DOM and accessibility tree. Probes tagged `— manual` need a human.

## Preflight

### Environment
- [ ] `git checkout feat/794-a11y-tables-lists && git pull --ff-only`, then `npm run build --workspace=packages/core`, then `npm run dev` (web :3000, API :3001). No migration.

### Fixtures
- [ ] Signed in as the e2e owner in `e2e-fixture` (`e2e:auth:all` also refreshes admin and member).
- [ ] Hostile names, created through the UI:
  - a tag named `<img src=x onerror=alert(1)>`;
  - an entity group named `"><svg onload=alert(2)>` with a Customers member;
  - a station named `Quote "test" & <b>bold</b>`.

### Reset between runs
- [ ] Delete the tag, group and station you created. Everything else is read-only.

## §1 — Boundary & limit inputs

- [ ] Search `/entities` for a term with no match, then page to the last page and back while the list is filtered.
  - **Safe:** the status says "No results found" and never "page 1 of 0". Paging buttons stay disabled, with no announcement for a no-op.
- [ ] Open a records table whose first visible column is empty or JSON for some rows (hide columns until a JSON or blank column is first).
  - **Safe:** every row link still has a name ("Open record <n>"). No unnamed link appears (axe `link-name` clean on the page).
- [ ] Hide every column in the records table's "Configure columns".
  - **Safe:** the table shows its empty message with no crash and no unnamed link. The column menu stays operable to show columns again.
- [ ] Give a station a 120-character unbroken name and view `/stations`.
  - **Safe:** the card title truncates with "…" or wraps, and its link name is the full title. The Delete description equals that full title.

## §2 — Malformed & injection input

- [ ] View `/tags` with the `<img src=x onerror=alert(1)>` tag.
  - **Safe:** the title renders as literal text with no image element and no script running (no alert, nothing in the console). The Delete button's description is that literal text.
- [ ] View the `"><svg onload=alert(2)>` group's page and its row actions.
  - **Safe:** "Remove <name>" and "Set <name> as primary" carry the literal string in `aria-label`. No attribute breaks out, and no `svg` is injected.
- [ ] View the `Quote "test" & <b>bold</b>` station on `/stations` and on its detail page's portals list.
  - **Safe:** the link name, heading and tab title show the literal characters, with no bold rendering and no escaping artefacts like `&amp;` in the accessible name.

## §3 — Concurrency & races (rapid input)

- [ ] On `/entities`, type a long search quickly, delete it, retype it, and press Next page twice fast, all within about 2 seconds.
  - **Safe:** at most one or two announcements after input settles, and the final one matches the visible range text. No stale count (from an earlier keystroke) is spoken last.
- [ ] Double-click a station card's body text.
  - **Safe:** one navigation to the station, not two history entries. Back returns to `/stations` in one step.
- [ ] On a records row, double-click a cell's text.
  - **Safe:** one navigation. Back returns to the list once.

## §4 — Auth & permission boundaries

- [ ] As the e2e **member** (`e2e:use member`), open `/entities` and `/stations`.
  - **Safe:** cards still link (read access), and Delete is absent where the member can't delete. No `aria-describedby` points at a missing id (axe clean).
- [ ] As the member, open Settings.
  - **Safe:** no Members tab (`member.invite` gate unchanged), so no grid. Nothing in this change exposes member management.
- [ ] As the owner, focus your own row's Remove in the Members grid (End, then Enter).
  - **Safe:** nothing happens (you can't remove yourself) and focus stays in the grid. Pressing it never sends a request (check the network panel).

## §5 — Multi-tenant isolation

N/A. No request, route or payload changed. Links are built from ids already in the caller's own list responses, and server authorization is untouched.

## §6 — State & lifecycle abuse

- [ ] Open `/entity-groups` in two tabs. In tab A delete "<group>". In tab B (stale) click that group's card body.
  - **Safe:** tab B navigates to the group's URL and shows the app's not-found state with an `h1`. No crash and no blank page.
- [ ] In Settings → Members, focus a cell in the last row. In another tab (as owner) remove that member. Return and refresh the members list (switch tabs and back).
  - **Safe:** the grid still has exactly one `tabindex="0"` cell, inside the shrunken bounds, and Tab still enters it.
- [ ] Delete a curated view in another tab while its page is open, then change its sort.
  - **Safe:** an error or not-found message appears, an alert where it's an error. The polite region doesn't read a stale count.

## §7 — Misuse sequences

- [ ] Drag-select a records cell's text (press, drag across the text, release) to copy it.
  - **Safe:** selecting text doesn't navigate away; the user can copy cell values.
- [ ] Ctrl/Cmd-click a card's "Delete" button, or middle-click it.
  - **Safe:** no new tab opens, and the Delete dialog opens or nothing happens. The forwarded new-tab behaviour applies only to the card's link target.
- [ ] Middle-click a toolpack row's plain text (the row opens a dialog, not a page).
  - **Safe:** no new tab and no dialog.
- [ ] In the Members grid, press Escape on a cell (not inside a control), and press Enter on a cell with no control (Name, Joined).
  - **Safe:** nothing happens, and focus stays on that cell. No dialog closes and no navigation starts.
- [ ] In the Members grid, open a Roles menu (Enter, ArrowDown) and press Tab instead of Escape.
  - **Safe:** the menu closes, and focus is either back on the combobox or past the grid, never inside a hidden menu. The grid still has one tab stop.
- [ ] With a screen reader on, `/entities`: change sort direction with the toggle buttons using Space. — manual
  - **Safe:** the new pressed state is read, then the result count after it settles, each once.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/entity/group/station ids):
