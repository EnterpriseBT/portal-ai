# command-palette — Adversarial Review

Adversarial probes for [#1076](https://github.com/EnterpriseBT/portal-ai/issues/1076) — the command palette, its read-scoped `GET /api/search`, the localStorage Recent store, gated actions and `?create=` deep links. **Branch under test:** `feat/1076-command-palette` (PR [#1130](https://github.com/EnterpriseBT/portal-ai/pull/1130)).

Tags: untagged probes are agent-walkable in the browser; `— backend` probes call `GET /api/search` directly (from devtools with the app's bearer token, or `curl -H "Authorization: Bearer $TOKEN"`); `— manual` needs a human.

## Preflight

### Environment

- [ ] Same as `docs/COMMAND_PALETTE.smoke.md` §Preflight (branch, core build, `npm run dev`, owner session).

### Fixtures

- [ ] The smoke fixtures: "Smoke Sales" (starred), "Smoke Ops" tagged "Finance", view "Smoke Q3 orders", owner portals. Note their ids.
- [ ] The e2e member identity, with nothing above shared to them.
- [ ] An object in **another org** the owner can't reach (any org the e2e owner isn't a member of; a local DB row id is enough). Note `<foreign station id>`.

### Reset between runs

- [ ] Clear `portalai-recent:*` keys in localStorage between probes that seed them. Delete objects created by §3.

---

## §1 — Boundary and limit inputs

- [ ] `GET /api/search?q=` (empty) and `?q=%20%20` (spaces) → `400 SEARCH_INVALID_QUERY`, no results, no 500. — backend
- [ ] `?q=` with 121 characters → `400 SEARCH_INVALID_QUERY` naming `q`; 120 characters → `200`. — backend
- [ ] `?refs=` with 21 `station:<uuid>` pairs → `400 SEARCH_INVALID_QUERY`; 20 → `200`. — backend
- [ ] `?q=a` in an org with more than 5 matches of a type → at most 5 rows per type, never a count. — backend
- [ ] Paste a 5,000-character string into the palette input → one search at most, a `400` shown as "Couldn’t search. Try again.", the actions still listed, no freeze.
- [ ] Seed the Recent key with 500 entries in devtools, reload, open the palette → at most 20 refs sent (`refs` param ≤ 20 pairs), Recent shows at most 8, no error.

## §2 — Malformed and injection input

- [ ] Type `%` , `_` and `\` in the palette (each alone) → they match literally (only names containing that character), not every row. 
- [ ] Type `'; DROP TABLE stations; --` → "Nothing matches …" (or literal matches), no 500, stations still list.
- [ ] Type `#%` → no tag matches unless a tag name starts with `%`.
- [ ] `?q=a&tag=b` (two modes) → `400 SEARCH_INVALID_QUERY`. — backend
- [ ] `?bogus=1` (unknown key) → `400` naming the key. — backend
- [ ] `?refs=station:not-a-uuid,widget:<uuid>,station` → `400 SEARCH_INVALID_QUERY` (or the malformed pairs dropped), never a 500. — backend
- [ ] `?q=a%00b` → `400 REQUEST_INVALID_CHARACTERS`. — backend
- [ ] Seed the Recent key with `not json`, then with `[{"type":"station","id":"<script>alert(1)</script>","visitedAt":1}]`, reload, open the palette → no error, no script runs, no Recent group; the bad entries are dropped.
- [ ] Rename "Smoke Ops" to `<img src=x onerror=alert(1)>` and search `img` → the name renders as text, nothing executes.

## §3 — Concurrency and races

- [ ] Highlight "Open Portal in Smoke Sales" and press Enter twice fast → exactly one portal created (one `POST /api/portals`), one navigation.
- [ ] Click the header's Open Portal, then immediately Ctrl+K and pick "Open Portal in Smoke Ops" → the palette's launch actions show "Starting…" and are disabled; one portal created. — manual (throttle the network to hold the create)
- [ ] Type `smo`, wait for results, then type `ke zzzz` fast → the final groups match `smoke zzzz` (no results from the earlier `smo` request arriving late).
- [ ] Close the palette mid-search with Ctrl+K, reopen at once → empty input and home groups, no stale results from the in-flight search.

## §4 — Auth and permission boundaries

- [ ] As the member, `GET /api/search?refs=station:<Smoke Sales id>,curated_view:<Smoke Q3 orders id>` → `200 {"results":[]}`, indistinguishable from unknown ids. — backend
- [ ] As the member, `?tag=Fin` → `{"results":[],"matchedTags":[]}`: the unreadable tag doesn't appear in `matchedTags`. — backend
- [ ] As the member, `?q=Smoke` → none of the owner's objects; `?` (favorites) → only the member's own favorites. — backend
- [ ] As the owner, search a teammate's portal name → absent (portals are creator-only, #1127), in `q`, `refs` and Recent portals alike.
- [ ] As the member, if "New station" is disabled, remove its `aria-disabled` in devtools and click it → nothing happens (it's not a link); then visit `/stations?create=station` directly → no dialog opens.
- [ ] As the member, a tag result's tag chips on a readable object never include a tag the member can't read. — backend (`?q=` on an object carrying both a readable and an unreadable tag; check `results[].tags`)

## §5 — Multi-tenant isolation

- [ ] As the owner, `GET /api/search?refs=station:<foreign station id>` → `200 {"results":[]}`. — backend
- [ ] Seed the owner's Recent key with that foreign station, reload, open the palette → nothing shown, the entry pruned from the key.
- [ ] Copy the owner's Recent key value into a key for a different org id (`portalai-recent:<other org>:<sub>`), switch to that org (if the owner has two) → the copied entries don't hydrate there unless they're that org's objects. — manual (needs a second org)

## §6 — State and lifecycle abuse

- [ ] Visit "Smoke Q3 orders" (it enters Recent), delete it, open the palette → it's absent from Recent and pruned from the key; no stale name.
- [ ] As the owner share "Smoke Ops" with the member; as the member visit it (enters Recent); unshare it as the owner; as the member reopen the palette → absent and pruned.
- [ ] Delete the "Finance" tag, search `#fin` → no match, and "Smoke Ops" carries no Finance chip.
- [ ] Revoke the member's create grant for views (if granted) while the palette is open on their machine, reopen the palette → "New view" reflects the new gate (hidden or disabled). — manual (two sessions)

## §7 — Misuse sequences

- [ ] In a file import's RegionEditor sheet, press Ctrl+K with the sheet focused → the palette doesn't open; the sheet keeps its key handling. — manual (needs an uploaded workbook)
- [ ] Open a create dialog from `?create=view`, press Back → the previous page, and the dialog doesn't reopen on Forward.
- [ ] Bookmark `/tags?create=tag`, then sign in as a member who can't create tags and open the bookmark → the page opens with no dialog and the param removed.
- [ ] Open the palette, press Ctrl+K while focus is in its own input → it closes (doesn't type a "k" or open the browser's search).
- [ ] Open the palette on a station page, pick that same station from Favorites → it closes; no navigation loop, no second history entry.
- [ ] Middle-click a palette result → a new tab opens; the palette stays open here. — manual

---

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §1 — 500-entry Recent store | Agent walk (2026-11-26): all 501 refs sent; the 400 hid Recent, and a refused hydration never prunes, so it stayed hidden until the next visit rewrote the store. Reachable only by hand-editing localStorage. | low | fixed-in-PR: `readVisits` caps at `RECENT_VISITS_MAX` (20) on read |
| §7 — bookmarked `/tags?create=tag` without access | Agent walk: no dialog opened, but a member who can't read tags gets the 403 page, the Tags view never mounts, and `?create=tag` stays in the URL. | low | proposed waiver: nothing opens or leaks; the param is inert (human to confirm) |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station/portal ids, the Recent key's contents):
