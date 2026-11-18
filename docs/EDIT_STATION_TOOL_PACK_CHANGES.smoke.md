# EDIT_STATION_TOOL_PACK_CHANGES — Smoke Suite

Manual smoke test for [#1052](https://github.com/EnterpriseBT/portal-ai/issues/1052): a station update changes tool packs by difference, and the Edit Station dialog keeps packs it can't show. **Branch under test:** `fix/1052-edit-station-tool-pack-changes` (PR [#1062](https://github.com/EnterpriseBT/portal-ai/pull/1062)).

Steps tagged `— backend` are API or database checks (curl with an e2e token, or psql); the rest are browser steps `/smoke-walk` can drive.

## Preflight

### Environment

- [ ] `git checkout fix/1052-edit-station-tool-pack-changes && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core` — no migration
- [ ] `npm run dev` boots cleanly (API :3001, web :3000); touch an API source file if the API was already running, so it picks up the rebuilt core

### Fixtures

- [ ] The `e2e-fixture` org, with owner, admin and member sessions (`npm run --workspace @portalai/e2e e2e:auth:all`)
- [ ] A custom tool pack in that org, created as the owner (Tool Packs → Register, or a row through `organizationToolpacks.create`). Call it **Walk Pack**
- [ ] A station **Walk1052** created by the owner with Data Query, Statistics and Walk Pack, and the member granted write on it (Share → member → Can edit)

### Reset between runs

- [ ] Put Walk1052's packs back to Data Query, Statistics and Walk Pack as the owner; delete Walk1052 and Walk Pack when done

## §1 — A member's pack edit keeps the custom pack

- [ ] As the member, open Walk1052 → **Edit**. The Tool Packs picker shows Data Query and Statistics, and under it: "1 tool pack on this station can't be changed here."
- [ ] Remove **Statistics** and save → the request body is `{"toolPackChanges":{"remove":["statistics"]}}`
- [ ] The station page now lists Data Query and Walk Pack (as the owner, who can name it). In `station_toolpacks`, Walk Pack's row has `deleted IS NULL`
- [ ] As the owner, open **Edit**: no count line; Walk Pack has its own chip

## §2 — Two editors

- [ ] As the owner, open **Edit** on Walk1052 and leave it open. As the admin (another session or the API), remove Statistics. Refresh the owner's page behind the dialog. In the owner's dialog add **Web Search** and save → the body is `{"toolPackChanges":{"add":["web_search"]}}`, and the station has Data Query, Walk Pack and Web Search (Statistics stays removed)
- [ ] Two at once — backend: with the station on exactly two built-ins and no custom pack, send two PATCHes at the same moment, one removing each → one answers 200, the other `400 STATION_TOOLPACK_REQUIRED`; the station keeps one pack

## §3 — The plan

- [ ] Move the org to a plan without GIS (`portalai org set-tier <org> standard --env local --yes`, wait 60s or restart the API). As the owner, attach GIS by API is refused: `PATCH … {"toolPackChanges":{"add":["gis"]}}` → `403 STATION_TOOLPACK_NOT_ENTITLED` — backend
- [ ] With GIS already attached from before the downgrade: one editor removes GIS; another editor whose dialog opened before that adds Web Search and saves → 200, GIS stays removed (before this change, that save was refused)
- [ ] Put the org back on its plan

## §4 — At least one pack

- [ ] As the owner, open **Edit** on a station with one built-in and no custom pack; remove it → "At least one tool pack is required", nothing sent
- [ ] Backend: `PATCH … {"name":"x","toolPackChanges":{"remove":["data_query"]}}` on that station → `400 STATION_TOOLPACK_REQUIRED`, and the name is unchanged

## §5 — Custom packs the caller can't read — backend

- [ ] As the member, `PATCH /api/stations/<Walk1052> {"toolPackChanges":{"add":["org:<Walk Pack id>"]}}`, then the same with a random id, then with another org's pack id → all three `400 STATION_INVALID_TOOLPACK`, the same message apart from the id
- [ ] As the member, `{"toolPackChanges":{"remove":["org:<Walk Pack id>"]}}` → 200, and Walk Pack is still attached

## §6 — Audit and contract — backend

- [ ] After §1 and §2: `audit_log` rows with `action = 'station.attachments.change'` and `target_id = <Walk1052>` carry `metadata.removed.toolPacks = ["statistics"]` (member) and `metadata.added.toolPacks = ["web_search"]` (owner), each with the right `user_id`
- [ ] `PATCH … {"toolPacks":["data_query"]}` → `400 STATION_INVALID_PAYLOAD` naming `toolPacks`
- [ ] `http://localhost:3001/api/docs`: the PATCH station body shows `toolPackChanges` and no `toolPacks`; the POST body still shows `toolPacks`

## §7 — Create is unchanged

- [ ] As the owner, **Create Station** with Data Query and Walk Pack → the station has both

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / pack ids, request body):
