# TAG_MORE_OBJECT_TYPES — Adversarial Review

Adversarial probes for [#1070](https://github.com/EnterpriseBT/portal-ai/issues/1070): tags on stations, pins, connectors and views, plus tag filters and per-type usage. **Branch under test:** `feat/1070-tag-more-object-types` (PR [#1111](https://github.com/EnterpriseBT/portal-ai/pull/1111)).

What drives the probes:
- 15 assignment routes (`/<type>/:id/tags`);
- `tagIds` and `include=tags` on five lists;
- `include=usage` on the tag list;
- delete sweeps and cascading foreign keys;
- one shared picker.

The change is authorization- and tenancy-heavy, so all seven categories apply.

Probes with no tag can be walked in a browser. Probes tagged `— backend` are `curl` requests with a bearer token taken from the browser's network tab (`Authorization` on any `/api` call), or `db:studio` checks. Probes tagged `— manual` need a human.

## Preflight

### Environment

- [ ] `git checkout feat/1070-tag-more-object-types && git pull --ff-only && npm install`
- [ ] `cd apps/api && npm run db:migrate`. Migration 0138 must be the regenerated one (its four target FKs `ON DELETE CASCADE`).
- [ ] `npm run dev` (web :3000, API :3001), signed in as the e2e **owner** (`e2e:auth`). The **member** session is `e2e:use member`.

### Fixtures

- [ ] Tags **Finance Ops** and **Smoke Unused** in the e2e org, from the smoke walk, or create two.
- [ ] Owner-created **Smoke Sales** station (st-a), **Smoke tag pin** (pin-a), **File Upload — CSV** connector (ci-a) and **smoke_ne** view (view-a). These are the smoke walk's fixtures.
- [ ] A **second org** the owner doesn't belong to, with one tag and one station. Its ids are **FOREIGN_TAG** and **FOREIGN_STATION**. Use `portalai org create --env local` or the e2e `other` owner from `seedTenancyFixture`.
- [ ] `TOKEN` (owner) and `MTOKEN` (member) bearer tokens copied from each session's network tab.

### Reset between runs

- [ ] Remove the tags a probe added, from the object's page or with `DELETE …/tags/<assignmentId>`. Recreate any deleted fixture object.

## §1 — Boundary & limit inputs

- [ ] `GET /api/stations?tagIds=,,%20,` — expected SAFE: the empty list is treated as **no filter**, so 200 with the unfiltered total; never a 400 or 500. — backend
- [ ] `GET /api/stations?tagIds=<Finance Ops>,<Finance Ops>,<Finance Ops>` — expected SAFE: deduped, the same rows and `total` as a single id, with no row repeated. — backend
- [ ] Filter Stations by Finance Ops with **Rows per page 1** and step to page 2 of 2 — expected SAFE: each page shows a different station, the total stays 2, and nothing repeats or is skipped. (Tag a second station first.)
- [ ] Put **all** the org's tags on st-a, then open the Stations list and st-a's page — expected SAFE: the chips wrap within the card and section, with no horizontal page scroll at 400 px width.

## §2 — Malformed & injection input

- [ ] `POST /api/stations/<st-a>/tags` with `{"entityTagId": 123}`, `{"entityTagId": ["x"]}`, `{}` and a non-JSON body — expected SAFE: **400** `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD` naming the field (415 for non-JSON), and no row written. — backend
- [ ] `POST …/tags` with `{"entityTagId":"<Finance Ops>","stationId":"<another station>"}` (target smuggling) — expected SAFE: **400** naming the unknown key `stationId`. The target always comes from the URL. — backend
- [ ] `GET /api/stations?tagIds=' OR 1=1--` and `?tagIds=%00` — expected SAFE: the first matches **nothing** (200, empty, total 0), and the NUL is **400** `REQUEST_INVALID_CHARACTERS`. Never a 500, never every station. — backend
- [ ] Rename a tag to `<img src=x onerror=alert(1)>` and view it on the Stations list, st-a's page and the Tags page — expected SAFE: the literal text renders in the chip, no script runs and no image loads.
- [ ] `DELETE /api/stations/<st-a>/tags/not-a-real-id` — expected SAFE: **404** `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`. — backend

## §3 — Concurrency & races

- [ ] On st-a's page, pick a tag and immediately pick the same tag again before the chip appears (or open two tabs and assign it in both) — expected SAFE: **one** chip, one live row in `entity_tag_assignments`. The duplicate attempt shows a "Couldn't add the tag." toast naming the duplicate, never an error page.
- [ ] Fire two identical `POST /api/portal-results/<pin-a>/tags` in parallel (`curl … & curl …`) — expected SAFE: one **201** and one **409**, never a 500, and one live row. — backend
- [ ] Tab A has view-a open with the picker ready. In tab B, delete view-a. In tab A, pick a tag — expected SAFE: **404** (the view is gone) shown as a toast, and **no live assignment** with `curated_view_id = <view-a>` in `db:studio`. — backend check of the row
- [ ] Tab A has st-a's picker open. In tab B, delete the tag on the Tags page. In tab A, pick that tag (still in the stale options) — expected SAFE: **404** `ENTITY_TAG_NOT_FOUND` toast, and no chip appears.

## §4 — Auth & permission boundaries

- [ ] As **member** with a `read tag` grant (Access page), share **st-a** with them as **read**. Open it — expected SAFE: chips show, with **no picker and no ✕**. — manual (the grant)
- [ ] As **member**, drive it anyway: `POST /api/stations/<st-a>/tags` and `DELETE /api/stations/<st-a>/tags/<assignmentId>` with `MTOKEN` — expected SAFE: **403** `PERMISSION_DENIED` on both, and the assignment is unchanged. — backend
- [ ] As **member**, `POST /api/stations/<an owner station not shared with them>/tags` — expected SAFE: **404** `STATION_NOT_FOUND` (not 403, which would reveal it exists). — backend
- [ ] As **member** without `read tag`, open a station they own that the owner tagged — expected SAFE: **no tag chips**, and the picker shows "You don't have permission to view tags." `GET /api/stations?include=tags` returns `tags: []` on that row. — manual (the grant setup)
- [ ] As **member** without `read tag`, `GET /api/stations?tagIds=<Finance Ops>` — expected SAFE: an **empty** page (total 0), not the stations carrying it. A hidden tag can't narrow a list. — backend
- [ ] As **member**, `GET /api/entity-tags?include=usage` with `read tag` — expected SAFE: the usage counts only objects the member can read. Finance Ops shows 0 stations unless st-a is shared with them, then 1. — backend
- [ ] `DELETE /api/stations/<st-b>/tags/<an assignment that sits on st-a>` as owner — expected SAFE: **404**, and st-a's tag stays. The assignment must belong to the object in the URL. — backend

## §5 — Multi-tenant isolation

- [ ] `POST /api/stations/<st-a>/tags` with `{"entityTagId":"FOREIGN_TAG"}` — expected SAFE: **404** `ENTITY_TAG_NOT_FOUND`, and no row. — backend
- [ ] `POST /api/stations/FOREIGN_STATION/tags` with a home-org tag — expected SAFE: **404** `STATION_NOT_FOUND`. — backend
- [ ] `GET /api/stations?tagIds=FOREIGN_TAG` and `GET /api/stations/FOREIGN_STATION/tags` — expected SAFE: an empty page, and a 404. Nothing from the other org leaks. — backend
- [ ] `GET /api/entity-tags?include=usage` — expected SAFE: counts are unchanged after the other org tags its own objects with a tag of the same name. — backend

## §6 — State & lifecycle abuse

- [ ] Delete **st-a** while it's tagged, then `GET /api/stations?tagIds=<Finance Ops>` — expected SAFE: st-a isn't listed. In `db:studio`, st-a's assignment rows have `deleted` set, with the same stamp as the station's toolpack/view rows. — backend
- [ ] Delete pin-a's station with pin-a tagged — expected SAFE: **pin-a keeps its tag**. Its page and the Pinned results filter still show it.
- [ ] Hard-delete a tagged **pending** connector (start a file upload, tag the pending instance from the Connectors list's Pending filter, then fail or cancel the commit) — expected SAFE: the rollback completes, no orphan connector is left, and its assignment rows are gone (cascade). — manual (forcing the failure)
- [ ] Open the delete dialog of a connector whose own tag, entity tag and view tag are set — expected SAFE: the dialog's tag count includes all three.
- [ ] Re-assign a tag right after removing it (✕ then pick again) — expected SAFE: a new chip and a new live row, with no 409 from the soft-deleted one.
- [ ] Tag a connector **during a running sync** — expected SAFE: it succeeds (tagging takes no job lock), and the sync finishes untouched. — manual (holding a sync open)

## §7 — Misuse sequences

- [ ] Pick a tag, then press browser **Back** before the chip appears — expected SAFE: the assignment still lands. Returning to the page shows the chip, and the list's tags are refreshed (the call's `invalidate` runs after unmount).
- [ ] On a pin's detail, add three tags in quick succession — expected SAFE: three chips. The pin's live data panel does **not** re-run per tag (the network tab shows no `/portal-results/<id>/data` refetch), so the org's chart-refresh budget isn't spent.
- [ ] After picking a tag, click the area where the old picker chip used to sit, and press Backspace in the empty picker — expected SAFE: no tag is removed. Only a tag chip's own ✕ (or Delete on a focused tag chip) removes a tag.
- [ ] Filter Connectors by a tag, then switch to the Catalog tab and back — expected SAFE: the Instances filter is still applied, and the Catalog tab has no Tags filter (definitions aren't taggable).
- [ ] Rename a tag while another tab has a list filtered by it — expected SAFE: after refocus, the filter chip shows the new name and the results are the same (the filter is by id).

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §3 same tag from two tabs | Server held (201 + 409, one row), but the 409 tab toasted "already assigned" and kept showing no chip | low | fixed-in-PR: 6ddf17bb (a 409 refetches the object's tags), re-walked |
| §7 rename while another tab is filtered | Results stay correct (the filter is by id); the other tab shows the old name until it refetches | low | waived: app-wide cross-tab cache staleness, not specific to tags; the renaming tab refreshes every list |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / station / pin / connector / view / tag / assignment ids):
