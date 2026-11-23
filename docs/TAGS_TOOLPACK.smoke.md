# TAGS_TOOLPACK — Smoke Suite

Manual smoke test for [#1071](https://github.com/EnterpriseBT/portal-ai/issues/1071): the built-in **Tags** pack (`tag_management`). The agent lists, creates, edits and deletes tags and adds or removes them on entities, stations, pinned results, connectors and views, with the UI's permissions. It ships on Administrate (new orgs and, via migration `0140`, existing ones). **Branch under test:** `feat/1071-tags-toolpack` (PR [#1113](https://github.com/EnterpriseBT/portal-ai/pull/1113)).

Run **§Preflight** once. After it, each section is independent. Steps with no tag can be walked by the agent in a browser (`/smoke-walk`); `— manual` steps need a human and `— backend` steps are `curl`, CLI or `db:studio` checks.

## Preflight

### Environment

- [ ] `git checkout feat/1071-tags-toolpack && git pull --ff-only && npm install`
- [ ] `npm run build --workspace=packages/core` (the pack registry and the `EntityTag` model changed)
- [ ] `cd apps/api && npm run db:migrate`: applies `0139_add-entity-tag-source-portal-id` and `0140_attach-tags-pack-to-administrate`. On a database that applied an earlier `0140` from this branch, re-run its SQL by hand (it is idempotent). — backend
- [ ] `npm run dev` boots cleanly (web :3000, API :3001), signed in as the e2e **owner** (`e2e:auth`). The **member** session is `e2e:use member`.

### Fixtures

- [ ] The `e2e-fixture` org's tier allows enough agent turns for the walk (~25). Check with `select o.tier, t.agent_turns_per_day from organizations o join tiers t on t.slug = o.tier where o.name = 'e2e-fixture'`. — backend
- [ ] From the #1070 smoke walk, or recreated:
  - tags **Finance Ops** and **Smoke Unused**;
  - the owner's **Smoke Sales** station (shared read-only with the member), **Owner Private** station (not shared), **Smoke tag pin**, **File Upload — CSV** connector and **smoke_ne** view;
  - the member's own **Member Lab** station.
- [ ] One entity under **File Upload — CSV**: any of its entities (call it **ent-a**).

### Reset between runs

- [ ] Remove any tag a step added (from the object's Tags section) and delete tags a step created (Tags page). Re-running `0140` is safe.

## §1 — Placement and provisioning

- [ ] Stations page → **Administrate**: its tool packs include **Tags** (tag icon). Its description reads "Manage members, access and tags through the assistant: …" when it was still the #847 default; an edited description is unchanged.
- [ ] `npx portalai org create --env local …` (or provision a fresh user): the new org's Administrate lists **Tags**. — backend
- [ ] Re-run `0140`'s SQL against the local database: 0 rows inserted, and no duplicate `tag_management` row for any station (`select station_id, count(*) from station_toolpacks where builtin_slug='tag_management' and deleted is null group by 1 having count(*) > 1` returns nothing). — backend
- [ ] Open a portal on **Playground** (no Tags pack). Prompt: **"List my tags."** The agent calls no `tag_*` tool and says it can't manage tags here (the tool activity never shows "Listing tags").

## §2 — The catalog through the agent (owner, on Administrate)

- [ ] Prompt: **"What tags do we have?"** The agent calls `tag_list` ("Listing tags") and names **Finance Ops** and **Smoke Unused**.
- [ ] Prompt: **"Create a tag called Q4 Revenue, color #16A34A, for fourth-quarter revenue work."** The agent calls `tag_create` and confirms. Without reloading, the Tags page shows **Q4 Revenue** in green with **Created in a portal session**.
- [ ] Prompt: **"Rename Q4 Revenue to Q4 Rev."** The agent calls `tag_list` then `tag_update`. The Tags page shows **Q4 Rev** without a reload.
- [ ] Create a tag from the Tags page (**UI Made**). It shows **no** "Created in a portal session" chip.
- [ ] Prompt: **"Create a tag called Finance Ops."** The agent relays the duplicate-name refusal and creates nothing.

## §3 — Applying and removing tags through the agent (owner, on Administrate)

- [ ] Prompt: **"Put Q4 Rev on the Smoke Sales station, the Smoke tag pin, the File Upload — CSV connector, the smoke_ne view and the ent-a entity."** The agent finds each id with `tag_target_list` (one call per type), then makes one `tag_assign` call with five targets of five types. It reports each as assigned.
- [ ] Without reloading, each object's page shows the **Q4 Rev** chip, and its list filtered by **Q4 Rev** shows it: Stations, Pinned results, Connectors, Views and Entities.
- [ ] Prompt: **"Tag Smoke Sales with Q4 Rev and Finance Ops."** It reports Q4 Rev as **already assigned** and Finance Ops as assigned (or already assigned), with no error.
- [ ] Prompt: **"Remove Smoke Unused from the smoke_ne view."** It reports **not assigned**, with no error, and nothing changes.
- [ ] Prompt: **"Take Q4 Rev off the Smoke tag pin."** It reports removed, and the pin's page drops the chip without a reload.
- [ ] Prompt: **"Delete the Q4 Rev tag."** The agent calls `tag_delete` and reports how many objects of each type it came off (4: station, connector, view, entity). The Tags page no longer lists it, and no object shows it.

## §4 — Permissions (member, on a station of theirs with the Tags pack)

Attach the Tags pack to **Member Lab** (its Edit dialog), signed in as the member. The member holds no tag permission by default.

- [ ] Prompt: **"What tags do we have?"** The agent reports none (the member can read no tag).
- [ ] Grant the member **read tag** (Access page, a policy with `read` on `tag`, attached through a role). — manual
- [ ] Prompt: **"What tags do we have?"** Now **Finance Ops** and **Smoke Unused** are listed.
- [ ] Prompt: **"Create a tag called Member Made."** The agent says the member lacks permission (`TOOL_PERMISSION_DENIED`), names the permission rather than a role, and nothing is created.
- [ ] Prompt: **"Rename Finance Ops to Finance."** Refused as a missing permission; the Tags page still shows **Finance Ops**.
- [ ] Prompt: **"Put Finance Ops on Member Lab."** Applied (the member writes their own station).
- [ ] Prompt: **"Put Smoke Unused on Member Lab and Smoke Sales."** Refused for **Smoke Sales** (read-only), and **nothing** is applied: Member Lab still has no Smoke Unused chip.
- [ ] Prompt: **"Put Finance Ops on the Owner Private station"**, giving its id (`d26dd42e-3e87-4ee2-854e-5cc8364a0cf1`). The agent reports it not found (`TOOL_TARGET_NOT_FOUND`), never "no permission", and the owner's view of Owner Private shows no new tag.
- [ ] Prompt with another org's station id (from `portalai org create`, or the e2e `other` org): **"Tag station <foreign id> with Finance Ops."** Not found; that station is untouched. — backend (check the foreign station's tags as its owner)
- [ ] Clean up: remove Finance Ops from Member Lab, detach the pack, and remove the read-tag grant. — manual

## §5 — The UI paths are unchanged

- [ ] Tags page: create **UI Check**, edit its color, then delete it. Each works as before, and the delete dialog's counts match.
- [ ] `DELETE /api/entity-tags/<id>` still answers `200 { "id": … }` (no counts), with the owner's token. — backend
- [ ] An object's Tags section: add and remove a tag from a station page. It works as before.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / pin / connector / view / entity / tag / portal ids):
