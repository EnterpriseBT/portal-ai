# FAVORITES — Smoke Suite

Manual smoke test for [#1072](https://github.com/EnterpriseBT/portal-ai/issues/1072): personal favorites on stations, pinned results, views and connectors.
- Each item's card and detail page has a star beside its name.
- Each of those four lists has a **Favorites** toolbar toggle, led by a star, with its own empty state.
- `PUT`/`DELETE /api/favorites/:type/:id` need only read access on the item.
- Favorites are removed with their item and with their member.

**Branch under test:** `feat/1072-favorites` (PR [#1116](https://github.com/EnterpriseBT/portal-ai/pull/1116)).

Run **§Preflight** once. After that, each section stands on its own. Tool calls, rows and responses are read from the network panel or `db:studio`, not just from what renders.

## Preflight

### Environment

- [ ] `git checkout feat/1072-favorites && git pull --ff-only && npm install && npm run build --workspace=packages/core`. Core carries the new model, contracts, `titleAction` slots and the `favorite` palette colour.
- [ ] `cd apps/api && npm run db:migrate`: migration `0142_add-favorites` creates the `favorites` table. Then `npm run dev` (API :3001, web :3000), signed in as the e2e **owner**. Switch to the **member** session with `e2e:use member`.

### Fixtures

- [ ] **The e2e fixture org.** It has these stations:
  - **Smoke Sales**, shared read-only with the member;
  - **Owner Private**, not shared;
  - **Member Lab**, the member's own station;
  - **My Station**.

  It also has the pin **Smoke tag pin**, the connector **File Upload — CSV**, the view **smoke_ne**, the entity **Customers** and the tag **Finance Ops**.
- [ ] **No favorites.** In `db:studio`, `favorites` is empty, or delete its rows.

### Reset between runs

- [ ] Delete the `favorites` rows a run created, and re-share or recreate anything a section deleted (§5).

## §1 — The star (owner)

- [ ] On **Stations**, each card has a star button beside its name, an outline that reads "Favorite {station name}" with `aria-pressed="false"`.
- [ ] Click the star on **Smoke Sales**:
  - while it saves, the button stays focused and reads as unavailable;
  - it then shows a filled star with `aria-pressed="true"`, and its name is still "Favorite Smoke Sales";
  - the network panel shows `PUT /api/favorites/station/<id>` answering `200 {"isFavorite":true}`;
  - `favorites` holds one row with your `user_id` and that `station_id`.
- [ ] **Brand yellow.** The filled star is the brand yellow: gold (`#b07c00`) in light mode and yellow (`#f5c842`) in dark mode (toggle the theme). An unstarred outline stays neutral. — manual (visual judgment)
- [ ] Click a card's star: the station doesn't open (the card's link doesn't fire).
- [ ] Open **Smoke Sales**: its header shows the filled star beside the `h1`, outside it (the page title is still "Smoke Sales · Portals AI"). Click it to unstar, and go back: the card shows the outline, without a reload.
- [ ] Repeat star → card, star → detail header, and unstar on:
  - **Smoke tag pin** (Pinned results);
  - **smoke_ne** (Views);
  - **File Upload — CSV** (Connectors, Connected tab).

  Each sends `PUT`/`DELETE /api/favorites/{pin|curated_view|connector_instance}/<id>`.
- [ ] **Quick double-click.** Star an item, then click again while it's still saving: the second click does nothing until the first settles, and the item ends up starred.

## §2 — Favorites toggle and empty state (owner)

- [ ] **Toggle.** On each of the four lists, the toolbar has a **Favorites** button with a star icon, `aria-pressed="false"`, beside the Filter button. The Filter popover doesn't list it.
- [ ] **Nothing starred.** Press Favorites on Stations:
  - the request carries `favorite=true`;
  - the list shows "No favorites yet" with "Star a station to keep it here. Only you see your favorites." and a Help link "How do favorites work?";
  - a chip reads **Favorites**;
  - the button is pressed.
- [ ] **Help link.** Click it: Help opens on that FAQ entry, expanded.
- [ ] **One starred.** Star **Smoke Sales** and **My Station**, then press Favorites: only those two show, in the same order as the unfiltered list (sorted by name), with the total at 2.
- [ ] **Composes.** With Favorites on, search "Smoke": only Smoke Sales. Clear the search, add the Tags filter **Finance Ops**: only favorites carrying it. With a search or tag also on and no match, the page reads "No results found", not the favorites explainer.
- [ ] **Off.** Delete the **Favorites** chip, or press the button again: the full list returns, and the request has no `favorite` parameter. Nothing ever sends `favorite=false`.
- [ ] **Announced.** A screen reader announces the result count after the toggle, like any filter change. — manual (screen reader)
- [ ] **No reorder.** On each list, starring an item never moves it.
- [ ] **Other three lists.** Repeat the toggle and empty state on Pinned results ("Star a pinned result…"), Views ("Star a view…") and Connectors ("Star a connector…").

## §3 — Permissions and privacy

- [ ] **Read-only.** As the **member**, open **Smoke Sales** (shared read-only): the star is offered. Star it: `200`, and a `favorites` row with the member's `user_id`. The member has no Edit or Delete on it.
- [ ] **Unreadable.** As the member, `PUT /api/favorites/station/<Owner Private id>` and `DELETE` the same: both `404 STATION_NOT_FOUND`, with no row written.
- [ ] **Another org.** As the owner, `PUT` and `DELETE /api/favorites/station/<another org's station id>`: both `404`.
- [ ] **Bad input.** `PUT /api/favorites/entity/<id>` returns `400 FAVORITE_INVALID_PAYLOAD`. So does a `PUT` with a JSON body. `GET /api/stations?favorite=false` returns `400 STATION_INVALID_QUERY`.
- [ ] **Personal.** As the owner, the Stations list shows Smoke Sales unstarred (`isFavorite: false`) even though the member starred it. The owner's Favorites list doesn't include it. The reverse also holds.
- [ ] **Idempotent.** `PUT` the same favorite twice: `200` both times, one row. `DELETE` an unstarred item: `200 {"isFavorite":false}`.

## §4 — Losing and regaining access (member)

- [ ] As the member, with **Smoke Sales** starred: the owner unshares it, through Share on the station page. As the member, Stations and the Favorites list no longer show it, and its page is a 404. In `db:studio`, the member's `favorites` row is still there.
- [ ] The owner re-shares it (read): it's back in the member's Favorites list, starred.

## §5 — Deletes and leaving the org (owner) — backend checks in `db:studio`

- [ ] Create a station **Fav Doomed**, star it as the owner, and have the member star it too (share it read first). Delete it: both `favorites` rows are gone.
- [ ] Star a pin, a view and a connector on throwaway objects you then delete (the connector's delete takes its entities' views too): no `favorites` row is left for any of them. — backend (the row check)
- [ ] With the member holding favorites, remove the member (Settings → Members → Remove): their `favorites` rows in this org are gone, and any in another org stay. Re-invite them: they start with none. — backend (the row check)

## §6 — Help

- [ ] Help → Glossary has **Favorite**: personal, needs only access to see the item, a Favorites button marked with a star that doesn't reorder. Station, Pinned Result, Curated View and Connector Instance each say "Star one you use often…".
- [ ] Help search "star a station" lists "How do favorites work?" in the top three.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / user / station / pin / view / connector ids, favorite row id):
