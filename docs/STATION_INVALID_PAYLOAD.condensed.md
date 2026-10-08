# Station payload errors say so — Condensed design (#706)

**Issue:** [EnterpriseBT/portal-ai#706](https://github.com/EnterpriseBT/portal-ai/issues/706) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `POST /api/stations` and `PATCH /api/stations/:id` answer a body that fails validation with `400 STATION_NOT_FOUND` "Invalid station payload". Callers key off `code`, so a bad body reads as a deleted station. The schemas also strip unknown keys, so a PATCH carrying the create-only `curatedViewIds` next to a valid field returns **200** and attaches nothing. The same router labels its five catch-all **500s** `STATION_NOT_FOUND` too. Touches `apps/api` (router + `ApiCode`) and `packages/core` (the two body schemas).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Create body 400 | `apps/api/src/routes/station.router.ts:467-475` | `CreateStationBodySchema` fails → `400 STATION_NOT_FOUND` "Invalid station payload", with no detail |
| Update body 400 | `station.router.ts:674-682` | `UpdateStationBodySchema` fails (incl. its "At least one field must be provided" refine) → the same |
| Catch-all 500s | `station.router.ts:261` (list), `:393` (get), `:581` (create), `:806` (update), `:952` (delete) | `500 STATION_NOT_FOUND` "Failed to …" |
| Body schemas | `packages/core/src/contracts/station.contract.ts:117` (create, `curatedViewIds`), `:164` (update, `curatedViewChanges`) | plain `z.object`, which strips unknown keys |
| Precedent | `connector-instance-layout-plans.router.ts:112-121` | `400 <DOMAIN>_INVALID_PAYLOAD` with `{ issues: parsed.error.issues }` as details; `CONNECTOR_INSTANCE_{FETCH,CREATE,UPDATE,DELETE}_FAILED` for 500s |
| Who reads the code | `apps/web/src/utils/portal-station.util.ts:20` | treats **404** `STATION_NOT_FOUND` as "station gone"; the 400s and 500s don't match today, and won't after this |
| Callers of the bodies | `CreateStationDialog`, `EditStationDialog`, `stations.api.ts` | typed `CreateStationBody` / `UpdateStationBody`, so no extra keys are sent |

## Decision — real codes, and unknown keys fail

1. **`STATION_INVALID_PAYLOAD`** (new `ApiCode`, per the `<DOMAIN>_INVALID_PAYLOAD` convention) on both 400s. The message is `Invalid station payload: <first issue>`, prefixed with the field path when there is one (e.g. `Unrecognized key: "curatedViewIds"`, `At least one field must be provided`). `{ issues }` goes in `details`, as the layout-plan routes do.
2. **Both body schemas become `.strict()`**, so an unknown key is a 400 instead of a silent no-op. That covers `curatedViewIds` on update and `curatedViewChanges` on create, plus any typo. The web app sends typed bodies, so nothing legitimate changes. This is what makes the "200, attached nothing" case fail loudly; renaming the code alone wouldn't.
3. **The five 500s get real codes:** `STATION_FETCH_FAILED` (list and get), `STATION_CREATE_FAILED`, `STATION_UPDATE_FAILED` and `STATION_DELETE_FAILED`, matching `CONNECTOR_INSTANCE_*_FAILED`. The issue asks for a sweep of `*_NOT_FOUND` misuse in this router, and a 500 is a failure, not an absence. The 404 `STATION_NOT_FOUND` sites (`:343`, `:353`, `:695`, `:879`) stay as they are; they're correct.

The `@openapi` 400 descriptions on POST and PATCH name the code and the unknown-key rule.

## Plan — one slice

**Files**
- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `STATION_INVALID_PAYLOAD`, `STATION_FETCH_FAILED`, `STATION_CREATE_FAILED`, `STATION_UPDATE_FAILED`, `STATION_DELETE_FAILED`.
- Edit: `apps/api/src/routes/station.router.ts`: the two 400s and five 500s as above; a small helper formats the first Zod issue; update the `@openapi` 400s.
- Edit: `packages/core/src/contracts/station.contract.ts`: `.strict()` on `CreateStationBodySchema` and on `UpdateStationBodySchema`'s object (before its `.refine`).

**Tests**
- `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`: PATCH `{}` → 400 `STATION_INVALID_PAYLOAD` "…At least one field must be provided"; PATCH `{ curatedViewIds: [...] }` → 400 naming the key; PATCH `{ name, curatedViewIds }` → **400** (was 200), with the name unchanged; POST `{}` → 400 `STATION_INVALID_PAYLOAD`; POST `{ name, curatedViewChanges }` → 400. A valid create and update still return 201 and 200.
- `packages/core/src/__tests__/contracts/station.contract.test.ts`: the strict schemas reject an unknown key and accept the documented fields.
- `npm run type-check` and `npm run build` (root, since this is a core contract change), `lint`, plus the affected unit and integration suites.

## Smoke (manual, against your dev stack)

1. As the e2e owner, `PATCH /api/stations/<a station you own>` with `{"curatedViewIds": ["<viewId>"]}` → **400 `STATION_INVALID_PAYLOAD`**, and the message names `curatedViewIds`.
2. The same with `{"name": "Renamed", "curatedViewIds": [...]}` → 400, and the station's name is unchanged.
3. `PATCH … {}` → 400 `STATION_INVALID_PAYLOAD` "…At least one field must be provided". `POST /api/stations {}` → 400 `STATION_INVALID_PAYLOAD`.
4. In the app, create a station and edit its name and attached views from the dialogs → both save (the typed web bodies still pass the strict schemas).

## Out of scope

- The web app's handling of these codes; nothing keys off a 400 or 500 station code today.
- Making other routers' body schemas strict. Station is the one with a reported silent no-op.

## Adversarial

Probes for how #706 breaks. The change makes three schemas strict, and it echoes the first validation issue in the message and every issue in `details`. So the probes ask whether hostile or odd bodies are rejected cleanly (never a 500, never a partial write), whether the more specific 400 tells callers anything about stations they can't see, and whether the real web flows still save. **Branch under test:** `fix/706-station-invalid-payload-code` (PR [#741](https://github.com/EnterpriseBT/portal-ai/pull/741)). API probes use `curl` against `:3001` with the e2e owner and member tokens, in `e2e-fixture`. Create the stations a probe needs and delete them afterwards.

### §1 Boundary & limit inputs
- [ ] PATCH a station you own with `{ "name": "x", <500 junk keys> }`. Expected safe result: 400 `STATION_INVALID_PAYLOAD`, no 500, and the name unchanged. — backend
- [ ] PATCH with a body over the JSON limit (`REQUEST_JSON_LIMIT_BYTES`, e.g. a 5 MB `description`). Expected safe result: 413 from the body parser, not a 500 and not a write. — backend
- [ ] PATCH `{ "curatedViewChanges": {} }`. Expected safe result: 200 with nothing attached. This is the deliberate #674 rule that an empty change object counts as a field, which the code review chose to keep; record it as observed. — backend

### §2 Malformed & injection input
- [ ] POST `/api/stations` with a JSON array `[]`, a bare string `"x"`, and `null`. Expected safe result: 400 `STATION_INVALID_PAYLOAD` each time (or the body parser's 400), never a 500. — backend
- [ ] PATCH `{ "name": "x", "__proto__": { "polluted": true } }` and `{ "constructor": { "prototype": { "polluted": true } } }`. Expected safe result: 400 (unknown key), and a later `GET /api/stations` response carries no `polluted` field anywhere. — backend
- [ ] PATCH `{ "name": 123 }` and `{ "toolPacks": [] }`. Expected safe result: 400, with the message naming the path (`name: …`, `toolPacks: …`). — backend

### §3 Concurrency & races: N/A. Validation runs before any write; no new state.

### §4 Auth & permission boundaries
- [ ] As the **member**, PATCH an owner's station (which the member can't read) with an **invalid** body, and then a random station id with the same body. Expected safe result: an identical 400 for both, since validation reads only the body. Then with a **valid** body: the same 404 `STATION_NOT_FOUND` for both. Nothing about the station leaks. — backend

### §5 Multi-tenant isolation
- [ ] As the e2e owner, PATCH an Org B station id with an invalid body, and then with a valid one. Expected safe result: an invalid body gives the same 400 as a random id; a valid body gives 404 `STATION_NOT_FOUND`, the same as a random id. — backend

### §6 State & lifecycle abuse
- [ ] Delete a station you own, then PATCH it with an invalid body and then a valid one. Expected safe result: an invalid body → 400 `STATION_INVALID_PAYLOAD` (validation first, as for any id); a valid body → 404 `STATION_NOT_FOUND`. A deleted station is never reported as a payload error once the body is valid. — backend

### §7 Misuse sequences
- [ ] In the browser as the owner: create a station from the Create Station dialog, then open Edit, rename it, attach a curated view and save. Expected safe result: both dialogs save with no error alert; the station shows the new name and one attached view. The dialogs' typed bodies pass the strict schemas. Delete the station afterwards.

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station ids):
