# command-palette — Smoke Suite

Manual smoke test for [#1076](https://github.com/EnterpriseBT/portal-ai/issues/1076) — the command palette: ⌘K / Ctrl+K and the header's "Search or run…", read-scoped search over `GET /api/search`, `#tag` search, Favorites, Recent portals and Recent, gated actions with `?create=` deep links, and the shared Open Portal launcher. **Branch under test:** `feat/1076-command-palette` (PR [#1130](https://github.com/EnterpriseBT/portal-ai/pull/1130), into `epic/launcher`).

Run **§Preflight** once. Each section after it is independent. Steps tagged `— manual` need a human; the rest are walkable by `/smoke-walk`.

---

## Preflight

### Environment

- [ ] `git checkout feat/1076-command-palette && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` (core's `Combobox`, `Modal`, `Kbd`, `SplitButton` and the search contract changed; the web and API read core's `dist`). No migration.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); restart the API after the core build (nodemon doesn't watch core).
- [ ] Signed in as the e2e **owner** (`npm run --workspace @portalai/e2e e2e:auth`), in the `e2e-fixture` org.

### Fixtures

In the e2e org, as the owner (create through the app if missing):

- [ ] A station **"Smoke Sales"**, starred (favorite), and a second station **"Smoke Ops"**, not starred.
- [ ] A curated view **"Smoke Q3 orders"**, and a tag **"Finance"** assigned to "Smoke Ops".
- [ ] At least 2 portals the owner opened (start one in each station), so Recent portals has rows.
- [ ] The e2e **member** identity (`e2e:auth:member`) exists. As the member, nothing above is shared with them.

### Reset between runs

- [ ] Recent is per user and org in localStorage (`portalai-recent:<org>:<sub>`). To start Recent empty, clear that key in devtools. Created test objects carry "Smoke" in their name; delete them after.

---

## §1 — Opening and the shortcut

- [ ] On `/dashboard`, press **Ctrl+K** (⌘K on a Mac) → a dialog named "Search and actions" opens, focus in the "Search or run an action" input.
- [ ] Press Ctrl+K again → it closes. Click the header's **"Search or run…"** box → it opens. Escape → it closes and focus returns to the trigger.
- [ ] Click into any page text field (e.g. the Stations list search) and press Ctrl+K → the palette does **not** open (the browser's own Ctrl+K may run instead).
- [ ] Open any dialog (Stations → New Station) and press Ctrl+K → the palette does not open over it.
- [ ] Resize to 400px wide → the trigger shows as a search icon button named "Search or run…", and opens the palette.

## §2 — Home: actions, favorites, recent portals, recent

- [ ] Open the palette on `/dashboard` → groups in this order: **Actions**, **Favorites**, **Recent portals**, **Recent** (Recent only after a visit).
- [ ] Actions include "Open Portal in Smoke Sales" (the favorite), "Open Portal: choose station…", "New station", "Import a file", "New view", "New entity", "New tag", each launch action with the portal icon.
- [ ] Favorites lists "Smoke Sales · station".
- [ ] Recent portals lists at most 5 of the owner's portals, newest opened first. Picking one opens `/portals/<id>` and closes the palette.
- [ ] Visit "Smoke Q3 orders" and "Smoke Ops", then open the palette on `/dashboard` → Recent lists "Smoke Ops" then "Smoke Q3 orders" (newest first), no flicker or blank Recent group while it loads.
- [ ] On `/stations/<Smoke Ops id>`, open the palette → the first action is "Open Portal in Smoke Ops".

## §3 — Search and tags

- [ ] Type `smoke` → after a short pause, results grouped by type ("Stations", "Views", "Portals" …), at most 5 per type, prefix matches first; matching actions stay on top ("New station" for `new st`).
- [ ] Type quickly `smok` then `smoke` in one burst → the network panel shows one `/api/search?q=smoke` (or an earlier one marked cancelled), never one request per keystroke.
- [ ] Type `#` → a "Tags" group suggests tags; pick "#Finance" → the input reads `#Finance` and the group "Tagged “Finance”" lists "Smoke Ops", with no Actions group.
- [ ] Type `#fin` → the same object under "Tagged “Finance”".
- [ ] Type `zzzz-nothing` → "Nothing matches “zzzz-nothing”." and no error.
- [ ] Ctrl/⌘-click a result → it opens in a new tab and the palette stays open in this one. — manual (a new tab's content)

## §4 — Read safety (member)

Switch to the member (`npm run --workspace @portalai/e2e e2e:use member`, then reload).

- [ ] Type `smoke` → none of the owner's unshared stations, views or portals appear in any group.
- [ ] Type `#fin` → nothing (the member can't read "Finance" or its objects).
- [ ] Home's Recent portals lists only the member's own portals (none of the owner's).
- [ ] In devtools, set the member's Recent key to `[{"type":"station","id":"<Smoke Sales id>","visitedAt":1}]`, reload, open the palette → no Recent group, no name shown, and the key is emptied (pruned).
- [ ] Actions the member can't take are hidden or disabled with a reason ("Ask for access to create stations" on "New station" if refused); a disabled action isn't a link and picking it does nothing.

Switch back to the owner (`e2e:use owner`).

## §5 — Create deep links and New Station's gate

- [ ] Pick **New view** → lands on `/views` with the New view dialog open; the URL has no `?create=`. Close it and press Back → the dialog doesn't reopen.
- [ ] Same for **New station** (`/stations`), **New entity** (`/entities`), **New tag** (`/tags`) and **Import a file** (`/connectors`, the file upload workflow opens).
- [ ] On `/views`, pick New view from the palette → the dialog opens on the same page.
- [ ] Visit `/views?create=bogus` directly → the page opens normally, no dialog, and the param is removed.
- [ ] As the member, `/stations` → "New Station" is hidden or disabled with its reason, and `/stations?create=station` opens no dialog.

## §6 — Open Portal launcher

- [ ] The header split button reads "Open Portal in Smoke Sales" (or "Open Portal") with the portal icon; the dashboard's button and the chooser dialog's title read "Open Portal", its submit "Open portal".
- [ ] From the palette, pick "Open Portal in Smoke Sales" → the palette closes, a portal is created and opens.
- [ ] Pick "Open Portal: choose station…" → the palette closes and the chooser dialog opens; choosing "Smoke Ops" and "Open portal" opens a portal there.
- [ ] On `/stations/<Smoke Sales id>`, open the palette and pick "Smoke Sales" from Favorites (the page you're on) → the palette closes.

## §7 — Keyboard and accessibility

- [ ] With the palette open, ↓/↑ move the highlight through every group; Enter on a result opens it; Enter on an action runs it. No mouse needed.
- [ ] ↓ from the last option wraps to the first, which is highlighted and visible below the input (not hidden under it). ↑ from the first wraps to the last, visible.
- [ ] Type `smoke` with a screen reader on → the result count is announced ("N results"), and each option reads its name and type. — manual
- [ ] Focus ring visible on the input and highlighted option in both light and dark themes. — manual (visual judgment)

## §8 — Closing and freshness

- [ ] Type `smoke`, close with **Ctrl+K**, reopen → the input is empty and the home groups show (not the previous results); no `q=smoke` request on reopen.
- [ ] Same with Escape and by picking a result.
- [ ] Rename "Smoke Ops" in another tab, then open the palette and search `smoke` → the new name shows (each open refetches).

## §9 — Error and edge cases

- [ ] Stop the API (or block `/api/search` in devtools), type `smoke` → "Couldn’t search. Try again." above the rows; the matching actions still show.
- [ ] With `/api/portals*` blocked, open home → "Couldn’t load everything here. Try again." and the other groups still show.
- [ ] Start a portal from the header and, before it opens, open the palette → its Open Portal actions are disabled with "Starting…". — manual (timing: throttle the network to hold the create)
- [ ] Switch org (if the owner has two) → Recent and results come only from the new org.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/portal ids, the Recent key's contents):
