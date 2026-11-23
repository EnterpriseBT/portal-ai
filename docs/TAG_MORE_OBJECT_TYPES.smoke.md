# TAG_MORE_OBJECT_TYPES — Smoke Suite

Manual smoke test for [#1070](https://github.com/EnterpriseBT/portal-ai/issues/1070). The change extends tags to stations, pinned results, connectors and views, with tag filters on their lists, Tags sections on their detail pages and per-type usage on the Tags page. **Branch under test:** `feat/1070-tag-more-object-types` (PR [#1111](https://github.com/EnterpriseBT/portal-ai/pull/1111)).

Run **§Preflight** once. After that every section stands alone. Steps tagged `— manual` need a human; the rest can be walked by `/smoke-walk`. Steps tagged `— backend` are checked with `curl`/`db:studio`; the integration suites already cover them, so walking them here confirms the deployed wiring.

---

## Preflight

### Environment

- [ ] `git checkout feat/1070-tag-more-object-types && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Core gained `tag-target.model.ts`, `tag-list.contract.ts` and tag usage schemas.
- [ ] `cd apps/api && npm run db:migrate && cd ../..`. Migration **`0138_tag-assignment-targets.sql`** adds four nullable target columns, the `entity_tag_assignments_one_target` CHECK and the per-target unique indexes. `npm run dev` seeds but doesn't migrate, so run this first.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] You're signed in as the seeded org's **owner** (`npm run --workspace @portalai/e2e e2e:auth`, then `e2e:use owner`).

### Fixtures

| Alias | What | How |
|---|---|---|
| **Finance**, **Q4** | Two tags, Finance coloured | Tags page → Create Tag |
| **st-a**, **st-b** | Two stations, named `alpha` and `beta` | Stations → New Station |
| **pin-a** | A pinned result | Pin any answer from a portal session on st-a |
| **ci-a** | A connector (CSV upload is fine) with one entity **ent-a** | Connectors → Connect, CSV |
| **view-a** | A view over ent-a | Views → Create View |

### Reset between runs

- [ ] Delete the fixture objects and tags you created, or reuse them. Tagging is idempotent, apart from the deliberate 409 in §5.

---

## §1 — Tag each object type from its page (owner)

For each of **st-a** (`/stations/<id>`), **pin-a** (`/portal-results/<id>`), **ci-a** (`/connectors/<id>`) and **view-a** (`/views/<id>`):

- [ ] Before tagging, the page shows a **Tags** section under the header, with an **Add tag** picker and no chips.
- [ ] Pick **Finance** in Add tag. A Finance chip, with its colour dot, appears without a reload, and the picker clears.
- [ ] Add **Q4** too. Both chips show, ordered by name.
- [ ] Remove **Q4** with the chip's ✕. It disappears without a reload.
- [ ] Reload the page. Only Finance remains.

## §2 — Lists show tags and filter by them

For each of **Stations**, **Pinned results**, **Connectors** (Instances tab) and **Views**:

- [ ] The tagged object's card shows a **Tags** row with the Finance chip. An untagged card (e.g. st-b) shows no Tags row.
- [ ] The toolbar has a **Tags** filter. Choosing **Finance** lists only the tagged object, and the total reads 1.
- [ ] Choosing **Finance** and **Q4** together lists objects carrying either (any-match). Tag st-b with Q4 first to see both stations.
- [ ] With the Finance filter on, a search for `beta` on Stations shows the page's empty state ("No stations found" with the no-results wording), not an error.
- [ ] Changing sort or page with the filter on keeps the filter, and the total stays consistent.
- [ ] Clearing the filter brings every object back.

## §3 — Tags page usage and delete

- [ ] On the Tags page, Finance's card reads **"1 entity · 1 station · 1 pinned result · 1 connector · 1 view"** once ent-a is tagged from its entity page too. Counts follow the order entity, station, pinned result, connector, view.
- [ ] A tag on nothing reads **"Not used"**.
- [ ] Rename Finance to **Finance Ops**. Every object's chip shows the new name without a reload (visit one list and one detail page).
- [ ] Delete Q4. The confirm dialog reads: *"Q4" will be removed from every entity, station, pinned result, connector and view it's on.* Confirm.
- [ ] Q4 is gone from every card and detail page, and from the list filter's options.

## §4 — Deleting a tagged object takes its tags (backend)

- [ ] Delete **view-a**. In `db:studio` → `entity_tag_assignments`, its row(s) (`curated_view_id = <view-a id>`) have `deleted` set. — backend
- [ ] Delete **st-a**. The station's assignment rows have `deleted` set, and **pin-a**'s assignment (`portal_result_id`) is still live (the pin survives its station). Its detail page still shows Finance. — backend
- [ ] Delete **ci-a**. Its own assignment row and ent-a's are `deleted`. — backend
- [ ] Usage on the Tags page drops to match (refresh it).

## §5 — Errors and duplicates (backend)

Use the owner's bearer token from the browser's network tab (`Authorization` header of any `/api` call).

- [ ] `POST /api/stations/<st-b>/tags` with `{"entityTagId":"<Finance id>"}` twice. The first answers **201**, the second **409** with `code: ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`. — backend
- [ ] The same POST with a made-up tag id answers **404** `ENTITY_TAG_NOT_FOUND`. — backend
- [ ] The same POST with `{"entityTagId":"…","extra":1}` answers **400** `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`. — backend
- [ ] `GET /api/stations?tagIds=<Finance id>&include=tags` returns only Finance-tagged stations, each with `tags`. — backend

## §6 — A read-only caller (manual)

Members hold no tag permission by default, so this needs a grant.

- [ ] As owner, on the Access page, give the seeded **member** a policy allowing `read tag`. Then share **st-b** with the member as **read**. — manual
- [ ] `e2e:use member`, then open st-b. The Tags section shows st-b's chips **without** the Add tag picker or ✕ controls. — manual
- [ ] The member's `POST /api/stations/<st-b>/tags` answers **403** `PERMISSION_DENIED`. For a station the member can't read (one the owner didn't share), it answers **404** `STATION_NOT_FOUND`. — backend
- [ ] On the Stations list, the member's Tags filter on Finance shows only st-b, never the owner's unshared stations. — manual

## §7 — Running jobs don't block tagging

- [ ] Start a sync or a large CSV import on a connector. While its lock alert shows, add a tag from that connector's page. The tag appears with no "locked" refusal.

## §8 — Entity tagging unchanged

- [ ] On ent-a's page, add and remove a tag. The behaviour matches §1, at the same URL (`/api/connector-entities/<id>/tags` in the network tab).
- [ ] The Entities list's Tags filter and card chips work as before.

## §9 — Help copy

- [ ] Help → Glossary: the term is **Tag** (not "Entity Tag"). Its definition names entities, stations, pinned results, connectors and views, and its link opens the Tags page.
- [ ] Help → FAQ "How do tags work?" names the five types, the any-match filter, and that tagging needs permission to edit the object.
- [ ] Help → Troubleshooting has **"I can't add or remove a tag"**. Searching Help for "can't tag" finds it first.
- [ ] With no tags, the Tags page's empty state reads *"Tags are color-coded labels that group and filter entities, stations, pins, connectors and views."*

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / pin / connector / view / tag ids):
