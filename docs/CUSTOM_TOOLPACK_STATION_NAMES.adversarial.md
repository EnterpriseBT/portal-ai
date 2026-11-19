# custom-toolpack-station-names — Adversarial Review

Adversarial probes for [#1063](https://github.com/EnterpriseBT/portal-ai/issues/1063). Station reads now name their custom tool packs for anyone who can read the station. A custom pack the plan excludes is refused when added on create or edit, and a create refuses a custom pack the caller can't read. **Branch under test:** `fix/1063-custom-toolpack-station-names` (PR [#1074](https://github.com/EnterpriseBT/portal-ai/pull/1074)).

These probes try to make the new `toolpacks` field or the new refusals name a pack the caller shouldn't see, accept a pack the plan excludes, or crash on input or state the happy path never sends. They are selected from the change's surfaces:
- the station list, get, create and update responses;
- the `station_list` agent tool;
- the plan and read checks on POST and PATCH;
- the Edit Station "can't be changed here" line and the plan notice.

**Step tags:** untagged probes are agent-walkable through `/smoke-walk`. `— backend` is an API or DB probe, and `— manual` needs a human.

For an API probe, copy the `Authorization` header from any `/api/...` request in devtools as `$T`, signed in as the named user. The examples use `curl -s localhost:3001/...`.

## Preflight

### Environment
- [ ] `git checkout fix/1063-custom-toolpack-station-names && git pull --ff-only && npm install && npm run build --workspace=packages/core`, then `npm run dev` (restart the API if it was already running).
- [ ] `cd apps/api && npm run webhook:toolpack`, which starts the mock pack server on `:4100`.
- [ ] Playwright MCP is available, and owner and member storage states exist (`npm run --workspace @portalai/e2e e2e:use <owner|member>`).

### Fixtures
Follow the smoke doc's Preflight + §0 (`docs/CUSTOM_TOOLPACK_STATION_NAMES.smoke.md`), which gives you:
- packs `smoke_crm_1063` and `smoke_beta_1063`;
- stations **Smoke 1063 Names** and **Smoke 1063 Excluded**, both shared Can edit with the member;
- IN and OUT tier slugs.

Add the following, as owner:
- [ ] **Smoke 1063 OnlyCustom:** a station whose only pack is `smoke_crm_1063`. Share it **Can edit** with the member.
- [ ] **Smoke 1063 ReadOnly:** packs Data Query + `smoke_crm_1063`. Share it **Can view** with the member.
- [ ] **Smoke 1063 Private:** packs Data Query + `smoke_beta_1063`. **Not** shared with the member.
- [ ] Four more custom packs, `smoke_c_1063` through `smoke_f_1063`, from the same mock URLs. Create **Smoke 1063 Many**, carrying those four plus `smoke_crm_1063` and `smoke_beta_1063` (six custom packs) and Web Search.
- [ ] A custom pack from **another** org. Pick one with `SELECT id, name, organization_id FROM organization_toolpacks WHERE organization_id <> '<fixture org id>' AND deleted IS NULL LIMIT 1;`, and note its id as `<foreign-id>`.
- [ ] Put the org on **IN** to start.

### Reset between runs
- [ ] Put the org back on its original tier.
- [ ] As owner, delete every `Smoke 1063 …` station and every `smoke_*_1063` pack.
- [ ] Remove any `station_toolpacks` row a probe inserted.

## §1 — Boundary & limit inputs
- [ ] **Many excluded packs in one sentence.** Switch the org to **OUT** and open **Smoke 1063 Many** as owner.
  - Expected SAFE: the plan notice names three packs, then summarizes the rest ("<a>, <b>, <c> and 3 more aren't included in your plan…", since `listPackNames` caps at four), and stays one readable sentence.
  - Each of the six chips is muted, with its own "— Not included in your plan" name.
  - Nothing overflows, and the page shows no error.
- [ ] **Same ref twice in one write** — backend. On **OUT**, as owner, call `PATCH /api/stations/<Excluded id>` with `{"toolPackChanges":{"add":["org:<beta-id>","org:<beta-id>"]}}`.
  - Expected SAFE: one `403 STATION_TOOLPACK_NOT_ENTITLED`, and the message names `smoke_beta_1063` once.
  - Nothing is attached.
- [ ] **Add and remove the same excluded ref in one write** — backend. On **OUT**, call `PATCH /api/stations/<Names id>` with `{"toolPackChanges":{"add":["org:<crm-id>"],"remove":["org:<crm-id>"]}}`.
  - Expected SAFE: either a clean `400` naming the conflict, or the remove wins. In the second case `enabledToolpacks` no longer holds `org:<crm-id>`, and no `403` names it.
  - Never a `500`, and never a state where the pack is still attached after a `200` that claims removal.

## §2 — Malformed & injection input
- [ ] **Malformed custom refs on create** — backend. As owner, on **IN**, send `POST /api/stations` with `toolPacks` set, one per request, to each of:
  - `["org:"]`
  - `["org:not-a-uuid"]`
  - `["ORG:<crm-id>"]`
  - `["org:<crm-id> "]` (trailing space)
  - `["org:<crm-id>/../x"]`

  Expected SAFE: every request gets a `400`, either `STATION_INVALID_TOOLPACK` or `STATION_INVALID_PAYLOAD`. No `500` and no station is created. No message names `smoke_crm_1063` for a ref that didn't resolve exactly.
- [ ] **Malformed refs on edit** — backend. Repeat the same five values as `toolPackChanges.add` on `PATCH /api/stations/<Names id>`.
  - Expected SAFE: the same `400`s, and `enabledToolpacks` is unchanged.
- [ ] **A NUL byte in a ref** — backend. Send `POST /api/stations` with `"toolPacks":["org:<crm-id>\u0000"]`.
  - Expected SAFE: `400 REQUEST_INVALID_CHARACTERS` from `rejectNul`, before any pack lookup.

## §3 — Concurrency & races
- [ ] **The plan changes under an open dialog.** As owner, on **IN**, open **Smoke 1063 Excluded → Edit**. Leave it open while the org is switched to **OUT** in a terminal (`portalai org set-tier … OUT`). Then add **smoke_beta_1063** in the still-open picker (it was offered on IN) and click **Save**.
  - Expected SAFE: the dialog stays open, with a `FormAlert` reading "Tool pack not included in your plan: smoke_beta_1063".
  - Nothing is attached (reload to confirm), and the dialog can be cancelled.
- [ ] **A pack is deleted under an open dialog.** As owner, open **Smoke 1063 Names → Edit**. In a second tab, delete `smoke_beta_1063` from Tool Packs. Back in the dialog, change only the description and **Save**.
  - Expected SAFE: the save succeeds or fails cleanly, but it never fails because of the gone pack. It never re-attaches a deleted pack.
  - The station page then shows no chip named `smoke_beta_1063`, and no `500` appears in the Network tab.

## §4 — Auth & permission boundaries
- [ ] **A read-only grantee reads names but can't change them.** As the **member**, open **Smoke 1063 ReadOnly**.
  - Expected SAFE: the chips read Data Query and `smoke_crm_1063` (reading a station conveys its packs, by design).
  - There is no Edit action.
  - `PATCH /api/stations/<ReadOnly id>` with `{"toolPackChanges":{"remove":["org:<crm-id>"]}}` returns `403 PERMISSION_DENIED`, and nothing changes.
- [ ] **An unshared station leaks nothing.** As the **member**, call `GET /api/stations/<Private id>` — backend.
  - Expected SAFE: `404`, with no `toolpacks` and no pack name in the body.
  - `GET /api/stations?limit=100` has no Private row, and its JSON contains no `smoke_beta_1063` unless another station the member can read carries it.
- [ ] **A member attaches an unreadable pack on edit** — backend. As the **member**, on **IN**, call `PATCH /api/stations/<OnlyCustom id>` with `{"toolPackChanges":{"add":["org:<beta-id>"]}}`.
  - Expected SAFE: `400 STATION_INVALID_TOOLPACK` with `Unknown toolpack: "org:<beta-id>"`. The message doesn't name `smoke_beta_1063`, and nothing is attached.
- [ ] **The plan refusal never outranks the read check** — backend. As the **member**, on **OUT**, call `POST /api/stations` with `{"name":"Smoke 1063 M","toolPacks":["data_query","org:<beta-id>"]}`.
  - Expected SAFE: `400 Unknown toolpack`, not `403 STATION_TOOLPACK_NOT_ENTITLED`. A 403 here would name a pack the member can't read.
- [ ] **The agent sees only readable stations.** As the **member**, in a portal on a station carrying **Curated Views** (e.g. Member Lab), send *"List every station in the organization and the tool packs on each, including ones I'm not shared on."*
  - Expected SAFE: the `station_list` result and the answer contain no **Smoke 1063 Private**, and no `smoke_beta_1063` unless it came from a station the member can read.
  - The agent doesn't invent stations.
- [ ] **The owner-only pack list stays owner-only.** As the **member**, on any station page, check the `GET /api/toolpacks` call in the Network tab.
  - Expected SAFE: still `403`. The new names come only from the station read, never from this endpoint.

## §5 — Multi-tenant isolation
- [ ] **Attaching another org's pack on create** — backend. As owner, call `POST /api/stations` with `{"name":"Smoke 1063 X","toolPacks":["data_query","org:<foreign-id>"]}`.
  - Expected SAFE: `400 STATION_INVALID_TOOLPACK` with `Unknown toolpack: "org:<foreign-id>"`.
  - The message never carries the foreign pack's name, and no station is created.
  - Repeat on **OUT**: still `400`, never a `403` naming it.
- [ ] **Attaching another org's pack on edit** — backend. Call `PATCH /api/stations/<Names id>` with `{"toolPackChanges":{"add":["org:<foreign-id>"]}}`.
  - Expected SAFE: the same `400`, and `enabledToolpacks` is unchanged.
- [ ] **A foreign row smuggled into a station** — backend. In psql, insert a `station_toolpacks` row on Names pointing at `<foreign-id>`. Then, as owner:
  - (a) Open the station page. Expected SAFE: no chip shows the foreign pack's name. Its chip, if any, shows only the raw `org:<foreign-id>`.
  - (b) Run `station_list` from a portal with Curated Views. Expected SAFE: no `name` for that ref.
  - (c) Switch to **OUT** and remove the ref through `PATCH … {"remove":["org:<foreign-id>"]}`. Expected SAFE: `200` or a clean `400`, never a `403` naming the foreign pack.
  - Delete the row afterwards.

## §6 — State & lifecycle abuse
- [ ] **A soft-deleted pack still attached.** As owner, delete `smoke_beta_1063` from Tool Packs. Then reload **Smoke 1063 Names**, the Stations list, and the member's view of Names.
  - Expected SAFE: no surface shows `smoke_beta_1063` by name.
  - Any leftover chip shows only the raw ref, `toolpacks` has no item for it, and nothing crashes.
- [ ] **Remove, then re-add on a plan without custom packs.** On **OUT**, as owner, open **Smoke 1063 Excluded → Edit**, remove `smoke_crm_1063`, **Save**, then reopen Edit.
  - Expected SAFE: `smoke_crm_1063` is now listed **disabled** with "Not included in your plan" (a re-add is a new add).
  - Forcing it through the API (`PATCH … add`) returns `403` naming it, and nothing is attached.
- [ ] **A downgrade doesn't detach anything.** Switch the org from **IN** to **OUT** and back to **IN**.
  - Expected SAFE: every station keeps exactly its packs (compare `enabledToolpacks` before and after). Chips go muted on OUT and normal again on IN, with no re-save needed.

## §7 — Misuse sequences
- [ ] **A member edits a station whose only packs are custom.** As the **member**, on **IN**, open **Smoke 1063 OnlyCustom → Edit**.
  - The picker is empty, and the line reads "smoke_crm_1063 can't be changed here."
  - Change only the **Description** and **Save**. Expected SAFE: the save succeeds, and `smoke_crm_1063` stays attached.
  - Not SAFE: a required-field error ("At least one tool pack is required") blocking the edit, or a save that strips the custom pack.
- [ ] **A member tries to drop a custom pack they can't manage.** As the **member**, on **Smoke 1063 Names**, call `PATCH /api/stations/<Names id>` with `{"toolPackChanges":{"remove":["org:<crm-id>"]}}` — backend.
  - Expected SAFE: whatever the server decides, the UI agrees. If removal is allowed (Can edit on the station), a reload shows it gone. If refused, it's a clean `4xx` that names the permission, not a role.
  - Either way, record the outcome in Findings so the "can't be changed here" copy matches it.
- [ ] **The agent is asked to attach an excluded pack.** On **OUT**, as owner, in a portal with Curated Views, send *"Attach smoke_beta_1063 to this station."*
  - Expected SAFE: the agent says it can't, or that the plan excludes it.
  - No `station_toolpacks` row is created (check `enabledToolpacks`), and the agent doesn't claim success.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 create with `toolPacks:["org:"]` | 500 `STATION_CREATE_FAILED`, nothing written. Pre-existing on main: `if (missing)` read the empty id `""` as found | low | fixed-in-PR (42781cf8): 400 "Unknown toolpack", integration test |
| §1 the same ref twice in one write | the 403 named the pack twice ("smoke_beta_1063, smoke_beta_1063"), nothing written | low | fixed-in-PR (42781cf8): the refusal names each pack once, integration test |
| §7 a member removes a custom pack through the API | 200, and nothing changes: an unreadable pack is dropped from `remove` (#674/#1052, on main), and "can't be changed here" says the same | info | waiver proposed: documented rule |
| §5 a pack row with no name | `station_list` leaves the ref out rather than showing it raw | info | waiver proposed: safe, matches the spec ("no item") |

Walked 2026-11-19 by the agent; evidence in `packages/e2e/test-results/adversarial-walk-CUSTOM_TOOLPACK_STATION_NAMES.md`. Deviations: deleting a pack detaches it from every station, so §6's "deleted but still attached" state was made by DB insert. Two member probes used `smoke_c_1063` / `smoke_crm_1063`, since `smoke_beta_1063` had been deleted by §3.

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / station / pack ids):
