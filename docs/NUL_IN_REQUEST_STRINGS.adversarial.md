# nul-in-request-strings — Adversarial Review

Adversarial probes for [#805](https://github.com/EnterpriseBT/portal-ai/issues/805): U+0000 is refused at the HTTP boundary (`rejectNul`, the base64 filter check, the tool input gate) and stripped on ingest (workbook cache, Sheets/REST sync, bulk transform, webhook staging, assistant blocks). **Branch under test:** `fix/805-nul-in-request-strings` (PR [#807](https://github.com/EnterpriseBT/portal-ai/pull/807)).

Most of this change is server-side, so most probes are `— backend` (curl/psql from the devcontainer). Untagged probes are browser-drivable; `— manual` needs a human.

## Preflight

### Environment
- [ ] `git checkout fix/805-nul-in-request-strings && npm install && npm run build --workspace=packages/core && npm run dev` (web :3000, API :3001). No migration.
- [ ] Logged in as the e2e user in `e2e-fixture` (`e2e:auth` if the session expired); Playwright MCP available.

### Fixtures
- [ ] `$TOKEN` — the session's bearer token (as in the smoke doc's preflight). — backend
- [ ] `$ENTITY` — an entity with records and a string column `name` (the smoke walk's `smoke_805_csv` works). — backend
- [ ] The REST mock from the smoke doc, made switchable: `PAYLOAD` read from a file per request, so a probe can change what upstream returns between syncs. — backend
  ```bash
  echo '{"items":[{"id":"a","name":"Al\u0000ice"}]}' > /tmp/rest805.json
  node -e 'require("http").createServer((q,r)=>{r.setHeader("content-type","application/json");r.end(require("fs").readFileSync("/tmp/rest805.json"))}).listen(4805)'
  ```
- [ ] A REST connector on `http://localhost:4805` (records path `items`, id field `id`), synced once.

### Reset between runs
- [ ] Delete the stations, connectors and entities the probes created (names start `Adv 805`). Refused requests write nothing.

## §1 — Boundary & limit inputs

- [ ] **Max-size body, NUL in the last value.** POST `/api/stations` with a body just under `REQUEST_JSON_LIMIT_BYTES` (4 MiB): `{"name":"Adv 805","toolPacks":["data_query"],"blob":"<~4,000,000 x 'a'>","z":"\u0000"}` — expected SAFE: `400 REQUEST_INVALID_CHARACTERS`, `path: "z"`, answered promptly (no 413, no 500, no timeout). — backend
- [ ] **Very deep nesting.** A body nested 50,000 objects deep with a NUL at the leaf (`{"a":{"a":…"\u0000"…}}`) — expected SAFE: `400` with a path of `a.a.a…` capped at 200 characters (ending `…`), not a 500 or a crashed process; the API keeps serving the next request. — backend
- [ ] **Huge key holding a NUL.** `{"<10,000 x 'k'>\u0000":1}` — expected SAFE: `400`, `details.path` ≤ 200 characters, and the response body stays small (the key isn't echoed in full). — backend
- [ ] **Many NULs.** A body with 10,000 fields each holding a NUL — expected SAFE: one `400` naming only the first, response under 1 KB. — backend

## §2 — Malformed & injection input

- [ ] **Raw NUL byte inside a JSON string** (not the `\u0000` escape): `printf '{"name":"a\0b","toolPacks":["data_query"]}' | curl --data-binary @- …/api/stations` — expected SAFE: `400 REQUEST_BODY_INVALID_JSON` (JSON forbids unescaped control characters), nothing written. — backend
- [ ] **Overlong UTF-8 NUL** (`C0 80`) inside a JSON string — expected SAFE: no 500; either a `400` or the bytes decode to U+FFFD and the station stores the replacement character, never a NUL. — backend
- [ ] **Encoded URL variants:** `?search=%C0%80`, `?search=%u0000`, `/api/field-mappings/%C0%80`, and `%2500` — expected SAFE: no 500 on any; none reaches Postgres as a NUL (`%2500` is the literal text `%00` → 200). — backend
- [ ] **NUL in a `__proto__` key:** `{"name":"Adv 805","toolPacks":["data_query"],"__proto__\u0000":{"polluted":1}}` — expected SAFE: `400` with `path: "__proto__"`; a following clean request is unaffected (no prototype pollution). — backend
- [ ] **A non-UTF-8 charset:** `Content-Type: application/json; charset=utf-16` with a UTF-16 body containing `\0` bytes — expected SAFE: body-parser's existing `415`/`400` refusal, no 500. — backend
- [ ] **NUL deep in a filter tree:** a base64 filter whose NUL sits in a nested group's condition, and one whose NUL is in the `field` name — expected SAFE: `400 ENTITY_RECORD_INVALID_FILTER` naming the nested path (e.g. `conditions.0.conditions.1.value`, `conditions.0.field`). — backend
- [ ] **base64url filter encoding** (`-`/`_`, no padding) carrying a NUL — expected SAFE: either the existing invalid-encoding 400 or the NUL refusal, never a 500. — backend

## §3 — Concurrency & races

- [ ] **Two uploads committed together:** upload `nul.csv` and a clean CSV in two tabs and commit both within a second — expected SAFE: the dirty commit's job reports `nulStrippedValues: 2`, the clean one has no count (the per-session counter doesn't leak between concurrent sessions). — manual

## §4 — Auth & permission boundaries

- [ ] **Refusal before auth leaks nothing:** without a token, `GET /api/stations/<a real station id>%00` and `GET /api/stations/<a random uuid>%00` — expected SAFE: byte-identical `400` responses (no existence signal), and with a token the same. — backend
- [ ] **Smuggling a NUL body through the webhook exemption:** with a valid user token, `curl --path-as-is -X POST 'localhost:3001/api/webhook/handle/../../stations'` (and `%2e%2e/%2e%2e/stations`) with `{"name":"Adv 805 \u0000","toolPacks":["data_query"]}` — expected SAFE: never reaches station create (no station named `Adv 805…` exists afterwards); `404`/`401`/`400`, never `201` or `500`. — backend
- [ ] **Case and trailing-slash variants of the exempt route:** `POST /API/WEBHOOK/HANDLE/x` and `POST /api/webhook/handle/x/` with a NUL body and no token — expected SAFE: the stricter outcome (`400` from the body check, or `401` from the route's token check); never a 2xx. — backend

## §5 — Multi-tenant isolation

- N/A — the refusal runs before any lookup (covered by §4's existence probe), and stripping only rewrites strings inside one org's own entity, session or message. No new cross-tenant read or write path.

## §6 — State & lifecycle abuse

- [ ] **Two source ids that collide after stripping in one sync:** set the mock to `{"items":[{"id":"b\u0000","name":"one"},{"id":"b","name":"two"}]}` and sync — expected SAFE: the sync **completes** (no `ON CONFLICT … cannot affect row a second time` / 21000 failure), one live record with source id `b`, and `nulStrippedValues: 1`. A failed sync here is a finding. — backend
- [ ] **Upstream "fixes" the NUL:** after a sync of `{"id":"a","name":"Al\u0000ice"}`, change the mock to `{"id":"a","name":"Alice"}` and sync — expected SAFE: the record is reported `unchanged` (stored data and checksum were already the stripped form) and the job has no `nulStrippedValues`. — backend
- [ ] **Colliding identity values in a CSV:** `printf 'id,name\nx\0,one\nx,two\n'` uploaded with `id` as the identity column — expected SAFE: the commit completes or reports a clean duplicate-identity outcome; no 500 / failed job from a duplicate key. A failed job is a finding. — backend (upload through the UI, verify in `jobs` / `entity_records`)
- [ ] **Recommit after an edit:** edit the layout plan of the `nul.csv` connector and recommit — expected SAFE: the recommit job completes and still reports `nulStrippedValues` (the count is read before the commit). — manual (needs an editor-backed connector: Google Sheets / Excel)

## §7 — Misuse sequences

- [ ] **Paste a NUL into a form field:** open Stations → New Station, put `Adv 805 \u0000paste` into Name (Playwright `fill` with a real U+0000), submit — expected SAFE: either the browser drops the NUL and the station saves clean, or the dialog stays open with a `FormAlert` reading "`name` contains a NUL character (U+0000), which can't be stored"; never a silent failure, a blank screen or a 500.
- [ ] **Paste a NUL into a records search box:** on `$ENTITY`'s records list, type `Al` + U+0000 into Search — expected SAFE: the list shows an error state or toast for the 400 (or the browser drops the NUL and searches `Al`); the page stays usable and clearing the box restores the list.
- [ ] **Paste a NUL into an Advanced Filters value:** set `name is` to `Al` + U+0000 — expected SAFE: the 400 `ENTITY_RECORD_INVALID_FILTER` surfaces as an error the user can read, and removing the condition restores the list.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 encoded URL variants: `GET /api/field-mappings/%C0%80` (also `/api/stations/%C0%80`, `/api/stations/%E0%A4%A`) | `500 UNKNOWN` "Internal server error". Express's param decoding throws a `URIError` (status 400) that the catch-all doesn't map. **Predates #805**: nothing in this branch touches param decoding, and it isn't a NUL. Same kind of client-triggerable 500 as #805, though | low–med | fixed-in-PR: the catch-all maps Express's 400 `URIError` to `400 REQUEST_URL_INVALID_ENCODING`; re-run live → `400` on all three URLs |
| §6 two source ids that collide after stripping (`b\u0000` + `b`) in one REST sync | Sync **failed**, `SQLSTATE 21000` (ON CONFLICT can't touch a row twice); nothing written. The control, plain duplicates `b` + `b` with no NUL, fails identically, so this **predates #805**: one upstream record with a repeated id fails the whole sync | med | fixed-in-PR: the REST batch writer keeps the last record per source id (`lastPerSourceId`); re-run live → sync `completed`, one record `b` = `two` |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
