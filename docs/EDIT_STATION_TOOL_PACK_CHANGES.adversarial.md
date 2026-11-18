# EDIT_STATION_TOOL_PACK_CHANGES — Adversarial Review

Adversarial probes for [#1052](https://github.com/EnterpriseBT/portal-ai/issues/1052): `PATCH /api/stations/:id` changes tool packs by difference (`toolPackChanges: { add, remove }`) against the live rows, and Edit Station sends only what its editor changed among the packs it can show. **Branch under test:** `fix/1052-edit-station-tool-pack-changes` (PR [#1062](https://github.com/EnterpriseBT/portal-ai/pull/1062)).

The smoke already covers the spec's own refusals: a member adding an unreadable, random or other-organization pack (§5), two concurrent removals (§2), the plan (§3), and `toolPacks` on PATCH (§6). These probes go after what those leave open. `— backend` probes are curl with an e2e token (`Authorization: Bearer …` against `:3001`) or psql; untagged probes are browser steps `/smoke-walk` can drive.

## Preflight

### Environment

- [ ] The smoke's environment (branch checked out, core rebuilt, `npm run dev`, API touched after the rebuild)
- [ ] Playwright MCP available; owner, admin and member sessions from `e2e:auth:all`, and a bearer token for each for the backend probes

### Fixtures

- [ ] The smoke's fixtures: **Walk1052** (Data Query, Statistics, **Walk Pack**), owned by the owner, the member granted Can edit
- [ ] **Walk1052-RO**: a second owner station with Data Query, shared with the member as **Can view** only
- [ ] A **second org** (`portalai org create … --env local`) with its own custom pack **Other Pack** attached to its own station **OtherStation**; note both ids. The e2e owner has no membership there
- [ ] A scratch custom pack **Doomed Pack**, attached to Walk1052, for the lifecycle probes

### Reset between runs

- [ ] As the owner, put Walk1052 back to Data Query, Statistics and Walk Pack; re-create Doomed Pack if a probe deleted it. Delete Walk1052, Walk1052-RO, the packs and the second org when done

## §1 — Boundary & limit inputs

- [ ] `PATCH /api/stations/<Walk1052> {"toolPackChanges":{}}`, then `{"toolPackChanges":{"add":[],"remove":[]}}` — expected SAFE: 200, packs unchanged, and **no** new `station.attachments.change` row in `audit_log` for this station — backend
- [ ] Remove an unattached pack and add an attached one: `{"toolPackChanges":{"add":["data_query"],"remove":["web_search"]}}` — expected SAFE: 200 no-op; no duplicate live `data_query` row in `station_toolpacks` (`SELECT builtin_slug, count(*) … WHERE station_id = … AND deleted IS NULL GROUP BY 1` shows 1 each); no audit row — backend
- [ ] The same slug repeated: `{"toolPackChanges":{"add":["web_search","web_search","web_search"]}}` — expected SAFE: 200, exactly one live `web_search` row, the audit row's `added.toolPacks` is `["web_search"]` once — backend
- [ ] 5,000 random `org:<uuid>` refs in `remove` — expected SAFE: a clean answer (200 no-op, or 413 from the body limit), not a 500; packs unchanged — backend
- [ ] 5,000 random `org:<uuid>` refs in `add` — expected SAFE: `400 STATION_INVALID_TOOLPACK` (or 413), not a 500; nothing written — backend

## §2 — Malformed & injection input

- [ ] Wrong shapes, one request each: `{"toolPackChanges":{"add":"data_query"}}`, `{"toolPackChanges":{"add":[1]}}`, `{"toolPackChanges":["data_query"]}`, `{"toolPackChanges":null}`, `{"toolPackChanges":{"adds":["data_query"]}}` — expected SAFE: each `400 STATION_INVALID_PAYLOAD` naming the field; nothing written — backend
- [ ] Refs that look like packs but aren't: `"org:"`, `"ORG:<Walk Pack id>"`, `" data_query"`, `"Data_Query"`, `"org:<Walk Pack id>'; DROP TABLE station_toolpacks;--"` in `add` — expected SAFE: each `400 STATION_INVALID_TOOLPACK` echoing only the ref sent; `station_toolpacks` intact — backend
- [ ] The same five in `remove` — expected SAFE: 200 no-op, every live pack still attached (a `remove` ref is matched by shape, so a near-miss must detach nothing) — backend
- [ ] A NUL in a ref: `{"toolPackChanges":{"add":["data_query\u0000"]}}` — expected SAFE: `400 REQUEST_INVALID_CHARACTERS` with `details.location` = body; nothing written — backend
- [ ] Both fields at once: `{"toolPacks":["data_query"],"toolPackChanges":{"add":["web_search"]}}` — expected SAFE: `400 STATION_INVALID_PAYLOAD` naming `toolPacks`; `web_search` not attached — backend

## §3 — Concurrency & races

- [ ] As the owner, open **Edit** on Walk1052, remove Statistics, then click **Save** twice fast (or Save then Enter) — expected SAFE: one PATCH in the network log; one audit row
- [ ] Two sessions add the same pack at the same moment (`add: ["web_search"]` twice in parallel, e.g. `curl … & curl … & wait`) — expected SAFE: both 200, exactly **one** live `web_search` row, at most one audit row records it as added — backend
- [ ] A pack change racing a station delete: send the PATCH and `DELETE /api/stations/<scratch station>` in parallel — expected SAFE: the PATCH answers 200 (it ran first) or `404 STATION_NOT_FOUND`, never a 500; no live `station_toolpacks` row under a deleted station — backend
- [ ] An add racing an attached pack's deletion: `add: ["org:<Doomed Pack id>"]` on a second station in parallel with deleting Doomed Pack — expected SAFE: no 500; afterwards no live `station_toolpacks` row names a deleted pack, or if one does, `GET /api/stations/<id>` doesn't list it in `enabledToolpacks` — backend

## §4 — Auth & permission boundaries

- [ ] As the member, `PATCH /api/stations/<Walk1052-RO> {"toolPackChanges":{"remove":["data_query"]}}` (shared Can view) — expected SAFE: `403 PERMISSION_DENIED` naming the permission, not a role; Data Query still attached; no audit row — backend
- [ ] As the member, the same against an owner station that was **never shared** with them — expected SAFE: `404 STATION_NOT_FOUND` (unreadable is absent), nothing written — backend
- [ ] As the member, open Walk1052-RO in the browser — expected SAFE: no Edit action; driving the PATCH anyway is the 403 above
- [ ] As the member, a valid built-in change that also tries to remove the custom pack: `{"toolPackChanges":{"remove":["statistics","org:<Walk Pack id>"]}}` — expected SAFE: 200, Statistics removed, **Walk Pack still attached**, the audit row's `removed.toolPacks` is `["statistics"]` only — backend

## §5 — Multi-tenant isolation

- [ ] As the e2e owner, `PATCH /api/stations/<Walk1052> {"toolPackChanges":{"remove":["org:<Other Pack id>"]}}` — expected SAFE: 200 no-op; Other Pack still attached to **OtherStation** in the second org (`station_toolpacks` row unchanged) — backend
- [ ] As the e2e owner, `PATCH /api/stations/<OtherStation> {"toolPackChanges":{"remove":["data_query"]}}` — expected SAFE: `404 STATION_NOT_FOUND`, not 403 (the station's existence isn't confirmed); OtherStation unchanged — backend
- [ ] After every probe above, the e2e org's `audit_log` holds no row naming Other Pack or OtherStation, and no response body included Other Pack's name — backend

## §6 — State & lifecycle abuse

- [ ] As the owner, delete **Doomed Pack** (Tool Packs → Delete) while it's attached to Walk1052, then open **Edit** on Walk1052 — expected SAFE: the dialog opens with no ghost chip and no count line for it (or a count line that a save can't trip on); saving a built-in change answers 200
- [ ] Then `PATCH … {"toolPackChanges":{"remove":["org:<Doomed Pack id>"]}}` — expected SAFE: 200, and `GET /api/stations/<Walk1052>` lists no Doomed Pack; a stale live `station_toolpacks` row it can't detach is a **finding** to record (it isn't readable, so the remove is skipped) — backend
- [ ] `PATCH … {"toolPackChanges":{"add":["org:<Doomed Pack id>"]}}` after the delete — expected SAFE: `400 STATION_INVALID_TOOLPACK`, the same answer as a random id — backend
- [ ] As the owner, open **Edit** on a scratch station; in another tab delete that station; back in the dialog change a pack and save — expected SAFE: the dialog's `FormAlert` shows the not-found error, the dialog stays open and the request settles; no rows written
- [ ] Revoke the member's Can edit on Walk1052 while their **Edit** dialog is open, then save a pack change there — expected SAFE: 403 shown in the dialog's `FormAlert`, nothing written, and the station page re-renders without the Edit action (`onPermissionDenied` invalidation)

## §7 — Misuse sequences

- [ ] As the member, in **Edit** on Walk1052 remove **every** chip the picker shows (Data Query, Statistics) and save — expected SAFE: the save is allowed (Walk Pack still counts), the station keeps Walk Pack only; reopening **Edit** shows an empty picker with "1 tool pack on this station can't be changed here." and the form still saves a rename
- [ ] As the owner, with the member's dialog from the probe above still open in another session, remove Walk Pack; then the member saves a rename only — expected SAFE: 200 with no pack change sent; the station isn't re-given Walk Pack
- [ ] As the owner, remove a pack in the dialog and add it back before saving — expected SAFE: no `toolPackChanges` in the body (or no request when nothing else changed)
- [ ] As the owner, open **Edit** while the custom pack list is slow to load (throttle the network in the walk browser) and save a rename before it settles — expected SAFE: the body carries no `toolPackChanges`; Walk Pack stays attached

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / station / pack ids, request body):
