# attach-views-from-portal — Smoke Suite

This is the manual smoke test for [#1036](https://github.com/EnterpriseBT/portal-ai/issues/1036). It covers the three new `view_management` tools: `curated_view_attach`, `curated_view_detach` and `station_list`. Together they let an admin create an entity and a view, attach the view to a station (this session's or another one), and query it in the same portal session. It also covers the station refresh in the web after an attach turn, and the help copy that now says the assistant can attach views.

**Branch under test:** `feat/1036-attach-views-from-portal` (PR [#1037](https://github.com/EnterpriseBT/portal-ai/pull/1037)).

Run **Preflight** once. After that, each section stands on its own. Steps tagged `— manual` need a person; steps tagged `— backend` are checked in the database or with curl. The rest can be walked by `/smoke-walk` in a browser. Every box starts unchecked: `/smoke-walk` produces evidence, and you check the boxes.

To file a bug, open an issue on `EnterpriseBT/portal-ai`, set its type to `Bug`, and link the section of this file. A template is at the bottom.

---

## Preflight

### Environment

- [ ] `git checkout feat/1036-attach-views-from-portal && git pull --ff-only`
- [ ] `npm install && npm run build`. The branch changes `packages/core` (the pack mirror and the help content), so the API and web need the rebuilt core dist. **There is no migration.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If the API dev server was already running, touch a file in `apps/api/src` so nodemon picks up the new core.
- [ ] The e2e sessions are fresh: `npm run --workspace @portalai/e2e e2e:auth:all`, then `npm run --workspace @portalai/e2e e2e:seed` (re-applies `--all-toolpacks`, so the fixture station has `curated_view_attach`, `curated_view_detach` and `station_list`).

### Fixtures (in the `e2e-fixture` org, as the owner)

| Alias | What | How |
|---|---|---|
| **Lab** | The fixture station. It has every built-in pack, including `data_query`, `entity_management` and `view_management`, and has the **Sandbox** connector attached | Already seeded. On Stations → Lab, check that the Sandbox connector chip is present, and attach it in Edit if it isn't |
| **Smoke Sales** | A second station with only `data_query` and no views | Stations → Create station: name "Smoke Sales", toolpack Data Query |
| **member** | The e2e member identity | Lab and Smoke Sales are both shared with the member at **Read** (station Share dialog). This gives read, not write |

### Reset between runs

- [ ] Delete the `smoke_widgets` entity and the `smoke_*` views the previous run created: Views page → delete, then Entities → delete `smoke_widgets`. Alternatively, run every prompt with a fresh suffix (`smoke2_…`).

---

## §1 — Create, attach and query in one turn (acceptance criterion 1)

As the **owner**, open a portal on **Lab**.

- [ ] Prompt: **"Create an entity called smoke_widgets on the Sandbox connector with columns name (text) and region (text). Add three records: Acme/NE, Bolt/SW, Cog/NE. Then create a view called smoke_ne over it showing name and region where region is NE, attach it to this station, and list the rows in it."**
- [ ] The tool activity strip shows **"Attaching the view"** while `curated_view_attach` runs. The raw tool name never shows.
- [ ] The tool calls run in this order within **one turn**: `connector_entity_create` … `curated_view_create` → `curated_view_attach` (with no `stationId`) → `sql_query`. The attach result shows `isSessionStation: true`, `added: [<view id>]`, and `views[0].columns` with `wideColumnName` values like `c_name`.
- [ ] The answer lists **Acme** and **Cog** and not Bolt, and it comes in the same turn, without asking the user to send another message.
- [ ] **No reload:** the portal header's view chips now include **smoke_ne** as soon as the turn ends (acceptance criterion 10).

## §2 — Attach to another station by name; a member sees it on their next turn (criteria 2 and 7)

As the **owner**, in the same Lab portal:

- [ ] Prompt: **"Share the smoke_ne view with the member at read access, then attach it to the Smoke Sales station."**
- [ ] `station_list` runs (strip: **"Listing stations"**) and returns Smoke Sales with `isSessionStation: false`, `capabilities.write: true` and `toolpacks` including `data_query`. Then `curated_view_attach` runs with `stationId` = Smoke Sales's id, and its result shows `isSessionStation: false` and no `views` field.
- [ ] Stations → **Smoke Sales** shows a **smoke_ne** chip without a reload. If that page was already open in another tab, it shows the chip after focusing that tab.

Switch to the **member** (`e2e:use member`) and open a portal on **Smoke Sales**:

- [ ] Prompt: **"How many rows are in smoke_ne?"** The answer is **2**.

## §3 — `station_list` contents and unreadable views (criterion 7)

As the **owner**, create a second view that is **not** shared with the member, and attach it to Smoke Sales:

- [ ] In the Lab portal, prompt: **"Create a view called smoke_all over smoke_widgets showing all rows, and attach it to Smoke Sales."** It succeeds.

As the **member**, in a Smoke Sales portal:

- [ ] Prompt: **"List the stations I can see and the views on each."**
- [ ] The answer lists only **Lab** and **Smoke Sales**, both read-only for the member, with the stations' tool packs. For Smoke Sales it names **smoke_ne** and says there is **one view the member can't read**, without naming it. The `station_list` tool result (in the transcript or the network panel) contains `{ "unreadable": true }` and **no** `smoke_all` id, key or label.

## §4 — Refusals (criteria 3, 4 and 5)

As the **member**, in a **Lab** portal (Lab is readable, not writable):

- [ ] Prompt: **"Attach the smoke_ne view to this station."** The answer says the member lacks permission to edit the station, naming the permission rather than a role. The tool result's code is `TOOL_PERMISSION_DENIED`. Lab's header shows no new chip.
- [ ] Prompt: **"Detach smoke_ne from Smoke Sales."** It is refused the same way (`TOOL_PERMISSION_DENIED`), and Smoke Sales still shows smoke_ne.

As the **owner**, in the Lab portal:

- [ ] Prompt: **"Attach the views smoke_ne and a view with id 00000000-0000-4000-8000-000000000000 to this station."** The tool result is `TOOL_TARGET_NOT_FOUND`, and **neither** view is attached: Lab's chips are unchanged, and smoke_ne isn't attached twice. The batch is all or nothing.
- [ ] Prompt: **"Attach smoke_ne to the station with id 00000000-0000-4000-8000-000000000000."** The tool result is `TOOL_TARGET_NOT_FOUND` (an unreadable or missing station reads as absent).

## §5 — No-ops (criterion 6)

As the **owner**, in the Lab portal:

- [ ] Prompt: **"Attach smoke_ne to this station again."** The result is `added: []` and `alreadyAttached: [<smoke_ne id>]`, with no error. Lab still has exactly one smoke_ne chip.
- [ ] Prompt: **"Detach smoke_all from this station."** (smoke_all is attached to Smoke Sales, not Lab.) The result is `removed: []` and `notAttached: [<smoke_all id>]`, with no error.
- [ ] Prompt: **"Detach smoke_ne from this station, then try to list its rows."** The detach succeeds (`removed: [<id>]`). The query **in the same turn** is refused with an unknown-view error, and the smoke_ne chip disappears from the header when the turn ends.

## §6 — Audit (criterion 8) — backend

- [ ] `npm run db:studio` (from `apps/api/`) → `audit_log`, filtered to `action = station.attachments.change` and this org. Each attach and detach from §1–§5 that changed something has exactly **one** row. Each of those rows has `user_id` set to the actor, `target_id` set to the station, `user_agent = portal-agent`, and `metadata.sourcePortalId` set to the portal's id. The no-ops in §5 added **no** rows.
- [ ] Attach or detach a view through the UI (§7) and confirm its row has a browser `user_agent` and **no** `sourcePortalId`.

## §7 — Routes and the Stations page are unchanged (criterion 9)

As the **owner**:

- [ ] Stations → **Smoke Sales** → Edit: detach **smoke_all** in the dialog and save. The chip disappears. Edit again, re-attach it, and save. The chip is back.
- [ ] — backend: the single-view attach and detach routes (the web doesn't call them; stations attach views through the edit dialog above). With the owner's token:
  - `curl -s -X POST localhost:3001/api/curated-views/<smoke_all id>/attach -H "Authorization: Bearer $OWNER_TOKEN" -H 'content-type: application/json' -d '{"stationId":"<Lab id>"}'` answers **200** with `{ stationId, curatedViewId }`, and Lab shows a smoke_all chip on reload.
  - Repeating the request also answers **200**, and there's still only one chip.
  - `curl -s -X DELETE localhost:3001/api/curated-views/<smoke_all id>/attach/<Lab id> -H "Authorization: Bearer $OWNER_TOKEN"` answers **200**, and the chip is gone.
- [ ] The Stations index lists Lab and Smoke Sales with their tool packs and Edit/Share actions as before. Search **"sales"** filters to Smoke Sales.
- [ ] As the **member**, the Stations index shows only Lab and Smoke Sales, without Edit (read-only).
- [ ] — backend: `curl -s -H "Authorization: Bearer $MEMBER_TOKEN" -X POST localhost:3001/api/curated-views/<smoke_ne id>/attach -H 'content-type: application/json' -d '{"stationId":"<Lab id>"}'` answers **403**. With the id of a station in another org or a random one, it answers **404 `STATION_NOT_FOUND`**.

## §8 — Refresh when a turn fails after an attach (criterion 10, error path) — manual

- [ ] — manual: as the owner in the Lab portal, prompt **"Attach smoke_all to this station, then run a SQL query that selects from a table called does_not_exist_xyz."** The query fails, and the agent reports it. Whatever the turn ends with, the smoke_all chip appears in Lab's header without a reload. This is manual because whether the model ends with an error event or a normal reply isn't deterministic; the unit and container tests cover the error ending directly.

## §9 — Help copy (diff surface)

- [ ] Help → Glossary → **Curated View** says the assistant can "attach a view to a station, its own session's station included, so a view it just created can be queried straight away". It no longer says attaching "is still done when creating or editing the station".
- [ ] Help → Glossary → **Station** ends with "Views can be attached when creating or editing the station, or by the assistant with the Curated Views tool pack."
- [ ] Help → FAQ → **"Why are the assistant's answers vague or missing my data?"** includes "(with the Curated Views tool pack, the assistant can attach one for you)".
- [ ] — manual: the marketing site (`npm run dev` → `:3002`, `/faq/` or the glossary page) shows the same updated wording. Its content is built from the same core files.

---

## Sign-off

- [ ] Every section above verified (agent-walked steps reviewed from the `/smoke-walk` evidence; manual and backend steps walked by hand)
- [ ] _date + name_ — confirmed against my own running stack

## Bug-filing template

```
Section: §<n> — <title>
Expected: <from the step>
Got: <what happened, with the tool call/result if relevant>
Repro: <prompt / clicks, identity (owner/member), station>
Identifiers: org <id> · station <id> · view <id> · portal <id>
```
