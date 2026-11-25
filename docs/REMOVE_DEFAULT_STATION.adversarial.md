# remove_default_station — Adversarial Review

Adversarial probes for [#1114](https://github.com/EnterpriseBT/portal-ai/issues/1114): the default station is removed from the web app, the rename-only org PATCH, provisioning, station delete and the admin CLI, with `default_station_id` left in the database until #1118. **Branch under test:** `feat/1114-remove-default-station` (PR [#1117](https://github.com/EnterpriseBT/portal-ai/pull/1117)).

The surfaces these probes target:
- the org PATCH is now strict and rename-only;
- a station delete no longer locks or touches the org;
- the New Portal dialog has no preselect;
- old clients and the dormant column outlive the change.

Tags: untagged probes are browser-walkable; `— backend` probes are API, CLI or DB requests; `— manual` probes need a human.

## Preflight

### Environment
- [ ] Same as `docs/REMOVE_DEFAULT_STATION.smoke.md` → Preflight: the branch checked out, core rebuilt, the API restarted, `npm run dev` up, and admin-cli built for §6.
- [ ] A bearer token for the API probes: in the walk browser, `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('@@auth0spajs@@') && !k.includes('@@user@@')))).body.access_token`.

### Fixtures
- [ ] The e2e owner session in `e2e-fixture` (org id below as `<org>`), plus the member session (`npm run --workspace @portalai/e2e e2e:use member`) for §4.
- [ ] A second org's id, `<other-org>`, and one of its station ids, `<other-station>`, from `db:psql`: `SELECT o.id, s.id FROM organizations o JOIN stations s ON s.organization_id = o.id WHERE o.id <> '<org>' AND s.deleted IS NULL LIMIT 1;`

### Reset between runs
- [ ] Restore `organizations.default_station_id` for `<org>` if §5 or §6 changed it, and rename the org back if a probe renamed it. Delete any station or portal a probe created.

## §1 — Boundary & limit inputs
- [ ] `PATCH /api/organization/<org>` with `{}` — `400 ORGANIZATION_INVALID_PAYLOAD` naming `name`; the row is unchanged. — backend
- [ ] `PATCH` with `{"name":"<120 × a>"}`, then with 121 — 120 succeeds; 121 is `400 ORGANIZATION_INVALID_PAYLOAD` with the length message, and the 120-character name stays. Rename back. — backend
- [ ] `PATCH` with `{"name":null,"defaultStationId":null}` — 400; `details.issues` names both `name` and the unrecognized `defaultStationId`; nothing written. — backend

## §2 — Malformed & injection input
- [ ] `PATCH` with `{"name":"Acme","defaultStationId":["a","b"]}`, then `{"name":"Acme","defaultStationId":{"$ne":null}}` — 400 "Unrecognized key"; the value is never read, so its type doesn't matter; the name is unchanged. — backend
- [ ] `PATCH` with `{"name":"Acme","defaultStationId":"x' OR '1'='1"}` — 400 "Unrecognized key"; no SQL error and no 500. — backend
- [ ] `PATCH` with a form-encoded body `name=Acme&defaultStationId=x` (`Content-Type: application/x-www-form-urlencoded`) — `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`; nothing written. — backend
- [ ] `PATCH` with `{"name":"Acme","__proto__":{"defaultStationId":"x"}}` — 400 (an unknown key), or the rename applies with no `defaultStationId` anywhere in the response. Never a 500, and `default_station_id` is unchanged in the DB. — backend

## §3 — Concurrency & races
- [ ] Open the New Portal dialog in tab A and pick station "Smoke 1114 race". In tab B, delete that station. Back in tab A, press Create. — Create fails with a clear error in the dialog (`FormAlert`, the station not found); no portal is created on the deleted station; the dialog stays open.
- [ ] Double-click a station's Delete confirm button. — One delete request is sent (in-flight dedupe); the card goes; no error toast for a second request.
- [ ] Favorite a station in tab A, then delete it in tab B within a second, or with the station row locked from psql (`BEGIN; SELECT … FOR UPDATE`). — The delete still sweeps the favorite (#1072): no `favorites` row survives for the deleted station. This checks that removing the org lock kept the station row lock. — backend

## §4 — Auth & permission boundaries
- [ ] As the **member**, `PATCH /api/organization/<org>` with `{"name":"Member rename"}` — `403 PERMISSION_DENIED` naming the permission, not a role; the name is unchanged. — backend
- [ ] As the member, `PATCH` with `{"defaultStationId":"<a station id>"}` — 400 (the body fails before permission); nothing written; the response leaks nothing about the station. — backend
- [ ] As the member, `GET /api/organization/current` — no `station.default.set` in `capabilities` and no `defaultStationId`. — backend
- [ ] As the member, open `/stations` and a station's detail page. — No "Set as default", "Default" chip or "Organization Default" row anywhere: none is rendered for any caller, not just hidden for this one.

## §5 — Multi-tenant isolation
- [ ] As the owner, `PATCH /api/organization/<other-org>` with `{"defaultStationId":"<other-station>"}` — `404 ORGANIZATION_NOT_FOUND`, answered before the body is read; `<other-org>`'s row is unchanged. — backend
- [ ] As the owner, `PATCH /api/organization/<org>` with `{"name":"Acme","defaultStationId":"<other-station>"}` — 400 "Unrecognized key"; no lookup of `<other-station>`; the message and details don't reveal whether it exists. — backend
- [ ] Set `<org>`'s dormant column to `<other-station>` in psql, then load `/stations`, the Dashboard and `GET /api/organization/current`. — Nothing in any response or page names `<other-station>` or its org: the column is never selected. Restore the column. — backend

## §6 — State & lifecycle abuse
- [ ] Set the dormant column to a **deleted** station's id, then use the app (Stations, a station's detail, New Portal, Settings → Organization). — Every page renders; no 500; nothing reads the dangling id.
- [ ] With the dormant column set, run `npx portalai org reset <org-copy> --env local --yes` on a throwaway org (`portalai seed org` makes one). — Reset succeeds and leaves the column alone; the org gets fresh Administrate and Playground. — backend
- [ ] With the dormant column set on a throwaway org, `npx portalai org delete <id> --env local --yes`. — The delete succeeds; the column has no foreign key (migration 0024 added it as plain `text`), so nothing about it can block the purge. Check: no `stations` rows are left for the org. — backend
- [ ] Simulate a stale SPA: from the walk browser, send the old `setDefault` request (`PATCH /api/organization/<org>` with `{"defaultStationId":"<a station id>"}`). — 400 with a readable message, which a cached client would show in its toast; `default_station_id` is unchanged. — backend
- [ ] Old ECS task during a rolling deploy: an old API build reading the column while new code serves writes. — The column exists, so old reads keep working; the new code never writes it. Covered by keeping the column; it can't be reproduced locally. — manual

## §7 — Misuse sequences
- [ ] New Portal: pick a station, clear the picker (the clear icon or deleting the text), then press Create. — "Station is required"; no portal is created.
- [ ] New Portal: type "Nonexistent station" into the picker without choosing an option and press Enter. — "Station is required" (free text is not a selection); no portal; no request with a made-up station id.
- [ ] New Portal: trigger "Station is required", press Cancel, then reopen the dialog. — It reopens with an empty picker and no stale error.
- [ ] `npx portalai org update <org> --default-station-id x --name "Smoke" --env local --yes`, the old flag mixed with a valid one. — Exit 2 (an unknown option); nothing written, including the name. — backend
- [ ] In a portal on a station with the Help pack, ask: "Make Playground my organization's default station." — The agent says there's no such setting (it may point at favorites); no tool writes anything. — manual (live model)

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station/portal ids):
