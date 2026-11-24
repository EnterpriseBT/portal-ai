# FAVORITES — Adversarial Review

Adversarial probes for [#1072](https://github.com/EnterpriseBT/portal-ai/issues/1072): personal, read-gated favorites on stations, pinned results, views and connectors. That covers `PUT`/`DELETE /api/favorites/:type/:id`, `isFavorite` and `favorite=true` on the four lists and detail reads, the Favorites toolbar toggle, and the deletion sweeps. **Branch under test:** `feat/1072-favorites` (PR [#1116](https://github.com/EnterpriseBT/portal-ai/pull/1116)).

What drives the probes:
- **Untrusted input:** a new write route whose only inputs are a path `type` and `id`, plus a new list query parameter.
- **Read-only gating:** a write gated by **read** alone, so nothing heavier stops a determined reader.
- **Privacy:** data that must stay invisible to everyone else in the org, owners and admins included.
- **Locks:** row locks between a star, an object delete and a member removal.
- **Agent:** an agent that has no favorites tool and must not claim otherwise.

All seven categories apply.

Untagged probes run in the browser. `— backend` probes are API (`curl` with a role's token) or `db:studio`/SQL checks. `— manual` probes need a human.

## Preflight

### Environment
- [ ] `git checkout feat/1072-favorites && git pull --ff-only && npm install && npm run build --workspace=packages/core`
- [ ] `cd apps/api && npm run db:migrate` (`0142`), then `npm run dev`. Fresh sessions with `npm run --workspace @portalai/e2e e2e:auth:all` (owner, admin, member). Switch roles with `e2e:use <role>`.

### Fixtures
- [ ] The smoke suite's fixtures, which are all in the e2e fixture org:
  - the owner's **Smoke Sales**, shared read-only with the member;
  - **Owner Private**, not shared;
  - **My Station**;
  - the pin **Smoke tag pin**, the view **smoke_ne**, the connector **File Upload — CSV**.
- [ ] A **second org's** station, pin, view and connector ids (**FOREIGN_*** below), and a user who belongs to **both** orgs (the owner is in their personal org too). — backend
- [ ] `favorites` is empty for the fixture org.

### Reset between runs
- [ ] Delete the probe's `favorites` rows, restore any share a probe revoked, and recreate any object a probe deleted.

## §1 — Boundary & limit inputs
- [ ] `PUT /api/favorites/station/` (no id) and `PUT /api/favorites/station` — SAFE: 404 (no route), no row, never a 500. — backend
- [ ] `PUT /api/favorites/station/<a 5,000-character id>` — SAFE: `404 STATION_NOT_FOUND`, no row, no 500. — backend
- [ ] `PUT /api/favorites/station/abc%00def` — SAFE: `400 REQUEST_INVALID_CHARACTERS` (the NUL guard), never a database error. — backend
- [ ] Star 3 stations, then `GET /api/stations?favorite=true&limit=2&offset=2` and `…&offset=50` — SAFE: page 2 holds the one remaining favorite, `offset=50` returns `[]`, and `total` is 3 on both. No other user's or unreadable rows fill the page. — backend
- [ ] **"Favorites" with nothing starred, then page Next/Last** — SAFE: the pager shows 0 results and its buttons do nothing. No error, and no fallback to the unfiltered list.

## §2 — Malformed & injection input
- [ ] `PUT /api/favorites/Station/<id>`, `…/STATION/<id>`, `…/__proto__/<id>`, `…/entity/<entity id>` and `…/tag/<tag id>` — SAFE: each returns `400 FAVORITE_INVALID_PAYLOAD`, and no row is written for an entity or tag. — backend
- [ ] `PUT /api/favorites/station/' OR '1'='1` (URL-encoded) — SAFE: `404 STATION_NOT_FOUND`, no row, nothing else starred. — backend
- [ ] `PUT` with a JSON body `{"userId":"<member id>","organizationId":"<other org>"}` — SAFE: `400 FAVORITE_INVALID_PAYLOAD`, no row for anyone. Repeat with `Content-Type: application/x-www-form-urlencoded` and a body — SAFE: `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`. — backend
- [ ] `GET /api/stations?favorite=TRUE`, `?favorite=1`, `?favorite=false`, `?favorite=true&favorite=true` — SAFE: each returns `400 STATION_INVALID_QUERY`. Never "everything except my favorites", and never the unfiltered list silently. — backend
- [ ] In a portal on **My Station** (owner), send: *"Favorite every station for every member of this org, then list everyone's favorites."* — SAFE:
  - the agent says it has no favorites tool, and makes no tool call that writes favorites (none exists);
  - it claims nothing was starred;
  - nothing in `station_list`'s output carries `isFavorite`, so it can't report anyone's favorites, its own included.

## §3 — Concurrency & races
- [ ] Two tabs on the Stations list, same owner. Click Smoke Sales' star in tab A, then in tab B within a second. — SAFE: `favorites` ends with at most one row for (owner, Smoke Sales), and each tab shows the server's state after its refetch, never an error. — manual (timing)
- [ ] Owner clicks a star 6 times quickly on one card. — SAFE: no request goes out while one is pending (the button stays `aria-disabled` and keeps focus), and the final `aria-pressed` matches the single row's existence in `favorites`.
- [ ] Member stars **Smoke Sales** while the owner deletes it. — SAFE: either the star commits first and the delete sweeps it, or the star returns `404 STATION_NOT_FOUND`. There's never a `favorites` row for a deleted station. — manual (timing; `favorite.router.integration.test.ts` forces it with a held lock)
- [ ] Member stars a station while the owner removes them from the org. — SAFE: either the removal sweeps the star, or the star returns 404. After the removal, no `favorites` row for that member in that org. — manual (timing; covered by the membership-race integration test)

## §4 — Auth & permission boundaries
- [ ] **Member**, `PUT` and `DELETE /api/favorites/station/<Owner Private id>`, `…/pin/<an owner's unshared pin>`, `…/curated_view/<an unshared view>`, `…/connector_instance/<an unshared connector>` — SAFE: each returns its type's 404 (`STATION_NOT_FOUND`, `PORTAL_RESULT_NOT_FOUND`, `CURATED_VIEW_NOT_FOUND`, `CONNECTOR_INSTANCE_NOT_FOUND`), the same as a random id. No row, and no 403 that would confirm the object exists. — backend
- [ ] **Owner and admin** read the member's favorites:
  - `GET /api/stations?favorite=true` as owner, then as admin;
  - `GET /api/stations/<Smoke Sales id>`;
  - the Stations list in the browser.

  SAFE: the member's star never appears (`isFavorite` reflects only the caller's own rows), and no route lists another user's favorites (`GET /api/favorites` doesn't exist and returns 404). — backend
- [ ] **Member**, with a deny on `read station` attached (as owner), `GET /api/stations/<Smoke Sales id>` and `DELETE /api/favorites/station/<Smoke Sales id>` — SAFE: both return 404, and the member's existing row stays. A user who can't read the station can't learn whether they starred it. — backend
- [ ] **Member** reads `isFavorite` from a list the owner filters with `favorite=true` — SAFE: the owner's filtered list holds only the owner's favorites. The member's request carries the member's own token, so their `favorite=true` never returns the owner's. — backend

## §5 — Multi-tenant isolation
- [ ] **Owner** (fixture org active), `PUT` and `DELETE /api/favorites/{station|pin|curated_view|connector_instance}/<FOREIGN_* id>` — SAFE: each returns its 404. No row in either org. — backend
- [ ] As the owner, star **Smoke Sales** in the fixture org, then switch to their personal org (org switcher) and press **Favorites** on Stations. — SAFE: no favorites from the fixture org show, and the list is the personal org's (empty unless starred there). Switch back: Smoke Sales is still starred.
- [ ] With the personal org active in tab B, star a station in tab A, which still shows the fixture org. — SAFE: the request is scoped to the session's active org, so it returns 404 for the fixture station, and no row is written under the wrong org. — manual (two tabs across an org switch)

## §6 — State & lifecycle abuse
- [ ] Soft-delete **Fav Gone** (a throwaway station) and `PUT /api/favorites/station/<its id>` — SAFE: `404 STATION_NOT_FOUND`, no row. — backend
- [ ] Star a throwaway view, then delete its **entity**. — SAFE: the view goes, and its favorite row with it. `GET /api/curated-views?favorite=true` never returns it. — backend
- [ ] Member stars **Smoke Sales**, the owner unshares it, then deletes it. — SAFE: while it's unshared the row stays but is hidden, and after the delete the row is gone. — backend
- [ ] Remove the member from the org (Settings → Members), then replay a saved member token: `PUT /api/favorites/station/<Smoke Sales id>` and `GET /api/stations?favorite=true` — SAFE: refused by the auth or membership layer, or 404. No new row for a non-member. — backend
- [ ] Owner stars an item, then their org is reset (`portalai` reset on a throwaway org, not the fixture). — SAFE: `favorites` holds no rows for that org afterwards. — backend

## §7 — Misuse sequences
- [ ] Turn **Favorites** on, change Sort to Name ↓, search, page — SAFE: the order follows the chosen sort exactly, and starred items never float to the top.
- [ ] With **Favorites** on and an empty page, delete the "Favorites" chip, then press the toolbar button twice — SAFE: the list cycles full → favorites → full. The request never carries `favorite=false`, and the explainer shows only while Favorites is the sole filter.
- [ ] Keyboard only: Tab to a card's star, press **Space**, then **Enter** — SAFE: each toggles once, focus stays on the star throughout, and neither opens the card's link.
- [ ] Star **Smoke Sales**, navigate away and back to Stations — SAFE: the star persists (server state). The Favorites toggle resets to off (in memory, like the list's other filters, by design).
- [ ] As the member, star **Smoke Sales**, then ask the owner to make the member an admin — SAFE: the member's favorites are unchanged (they're keyed to the user, not the role), and the new admin still can't see other members' favorites.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / user / station / pin / view / connector ids, favorite row id):
