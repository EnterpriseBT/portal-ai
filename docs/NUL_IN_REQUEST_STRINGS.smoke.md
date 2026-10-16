# nul-in-request-strings — Smoke Suite

Manual smoke test for [#805](https://github.com/EnterpriseBT/portal-ai/issues/805): U+0000 (NUL) is refused at the HTTP boundary and in agent tool input with a typed 400 / tool result, and stripped and counted when it arrives in imported, synced or model-produced data. **Branch under test:** `fix/805-nul-in-request-strings` (PR [#807](https://github.com/EnterpriseBT/portal-ai/pull/807)).

Run **§Preflight** once. Sections are independent after it.

Steps are tagged:
- *(untagged)* — agent-walkable via `/smoke-walk` (browser).
- `— backend` — a `curl`/`psql`/shell check the agent can run in the devcontainer.
- `— manual` — needs a human (a real vendor account, or a custom toolpack you host).

Filing bugs: open an issue on `EnterpriseBT/portal-ai` (type `Bug`) linking the section; template at the bottom.

---

## Preflight

### Environment

- [ ] `git checkout fix/805-nul-in-request-strings && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `job.model.ts` gained `nulStrippedValues` on three result schemas; the API reads core's built `dist`.
- [ ] No migration on this branch.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If the API was already running from another branch, restart it.
- [ ] Log in to the web app as the e2e fixture user (`npm run --workspace @portalai/e2e e2e:auth` if the saved session has expired); land on the dashboard in the `e2e-fixture` org.

### Fixtures

- [ ] **`$TOKEN`** — a bearer token for `curl`: in the logged-in app, open any `/api/…` request in DevTools → Network and copy the `Authorization` header's token (or read it from the request via Playwright's network inspector). `export TOKEN=<token>` in the shell you'll run the backend steps from. — backend
- [ ] **`$ENTITY`** — the id of any connector entity in `e2e-fixture` with records and a string column (open an entity in the app; the id is in the URL). — backend
- [ ] **`nul.csv`** — a CSV with a NUL in a header and in a cell: `printf 'na\0me,city\nAl\0ice,Paris\nBob,London\n' > /tmp/nul.csv` — backend
- [ ] **REST mock** — a local endpoint whose JSON carries U+0000 (`JSON.stringify` writes it as `\u0000`). Run it in its own terminal and leave it up for §4: — backend
  ```bash
  node -e 'require("http").createServer((q,r)=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({items:[{id:"a",name:"Al\u0000ice"},{id:"b\u0000",name:"Bob"}]}))}).listen(4805)'
  ```
  `curl -s localhost:4805 | od -c | head -3` shows `\ 0 0 0 0` escapes, not raw bytes.

### Reset between runs

- [ ] Delete the stations, connectors and entities this run created (names start `Smoke 805`) from the app. Nothing else is written; refused requests write nothing by design.

---

## §1 — HTTP boundary: refusals (spec AC 1, 2)

- [ ] `curl -s -X POST localhost:3001/api/stations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Smoke 805 \u0000x","toolPacks":["data_query"]}'` → `400`, `code: "REQUEST_INVALID_CHARACTERS"`, `details: {"location":"body","path":"name"}`, message `` `name` contains a NUL character (U+0000), which can't be stored ``. — backend
- [ ] In the app, Stations list: no station named `Smoke 805 …` exists (nothing was written).
- [ ] Same request **without** the `Authorization` header → the same `400` (refused before auth, like body-parser's 400s), not a `401`. — backend
- [ ] A NUL in a nested value and in a key: `-d '{"name":"Smoke 805","toolPacks":["data_query"],"meta":{"k\u0000":1}}'` → `400` with `path: "meta.k"`. — backend
- [ ] The value is never echoed: `-d '{"name":"secret-xyz\u0000"}'` → the response body doesn't contain `secret-xyz`. — backend
- [ ] Query strings, on list reads that used to 500 (each `400 REQUEST_INVALID_CHARACTERS`, `details: {"location":"url"}`): — backend
  - `curl -s "localhost:3001/api/stations?search=a%00b" -H "Authorization: Bearer $TOKEN"`
  - `curl -s "localhost:3001/api/connector-entities?search=a%00b" -H "Authorization: Bearer $TOKEN"`
  - `curl -s "localhost:3001/api/jobs?search=a%00b" -H "Authorization: Bearer $TOKEN"`
  - `curl -s "localhost:3001/api/connector-entities/$ENTITY/records?search=a%00b" -H "Authorization: Bearer $TOKEN"`
- [ ] A route param: `curl -s localhost:3001/api/field-mappings/%00 -H "Authorization: Bearer $TOKEN"` → `400 REQUEST_INVALID_CHARACTERS` (was `500 FIELD_MAPPING_FETCH_FAILED`). — backend
- [ ] A base64 filter (hidden from the URL check): — backend
  ```bash
  F=$(printf '{"combinator":"and","conditions":[{"field":"name","operator":"contains","value":"a\\u0000b"}]}' | base64 -w0)
  curl -s "localhost:3001/api/connector-entities/$ENTITY/records?filters=$F" -H "Authorization: Bearer $TOKEN"
  ```
  → `400`, `code: "ENTITY_RECORD_INVALID_FILTER"`, message names `` `conditions.0.value` `` (use a string column of `$ENTITY` in place of `name` if it has none).

## §2 — HTTP boundary: clean requests unchanged (spec AC 3)

- [ ] Create a station in the app (Stations → Create, name `Smoke 805 clean`, any toolpack) → it's created and opens normally.
- [ ] `curl -s -X POST localhost:3001/api/stations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Smoke 805 text","description":"tab\there\nline two, and the text \\u0000","toolPacks":["data_query"]}'` → `201`; the stored description contains a real tab, a newline, and the six characters `\u0000` (an escaped backslash, not a NUL). — backend
- [ ] `curl -s "localhost:3001/api/stations?search=%2500" -H "Authorization: Bearer $TOKEN"` → `200` (`%2500` is the text `%00`, not a NUL). — backend
- [ ] The records list for `$ENTITY` in the app still searches and filters as before (type a search term, add a filter; results update).

## §3 — File upload import strips and counts (spec AC 4)

- [ ] Connectors → New → File upload; upload `/tmp/nul.csv`; continue through the region editor (the preview shows the header as `name` and the cell as `Alice`, with no stray character) and commit as `Smoke 805 csv`.
- [ ] The commit completes (no failed job). Jobs → the `layout_plan_commit` job → its result JSON includes `"nulStrippedValues": 2` (the header cell and `Al?ice`).
- [ ] The new entity's records show `Alice` / `Paris` and `Bob` / `London`; its field mapping is labelled `name`.
- [ ] Upload a clean CSV the same way (`printf 'name,city\nAda,Rome\n' > /tmp/clean.csv`) → its commit job result has **no** `nulStrippedValues` key.
- [ ] XLSX: not walkable. XML 1.0 forbids U+0000, so an XLSX file can't hold one; the cache-writer strip is the same code path as CSV.

## §4 — REST sync strips, counts and stays unchanged (spec AC 4, 5)

- [ ] Connectors → New → REST API, base URL `http://localhost:4805`, one endpoint: path `/`, records path `items`, id field `id`; name it `Smoke 805 rest` and commit, then run a sync. If the form refuses an `http://localhost` base URL, record that and expose the mock through a tunnel you control instead (the sync, not the form, is what's under test).
- [ ] The `connector_sync` job completes. Its result JSON includes `"nulStrippedValues": 2` (record `a`'s `name`, record `b`'s `id`).
- [ ] The entity's records: `a` → `Alice`, and the second record's source id is `b` (stripped). — backend: `psql "$DATABASE_URL" -c "select source_id, data from entity_records where connector_entity_id='<entity id>' and deleted is null"`
- [ ] Sync again without changing the mock → the job's `recordCounts` reports `unchanged: 2`, `created: 0`, `updated: 0`.

## §5 — Google Sheets / Excel sync (spec AC 4) — manual

- [ ] Google Sheets: put a cell holding U+0000 in a sheet you've connected (the Sheets UI won't type one; write it through the Sheets API, e.g. `values.update` with `"Al\u0000ice"`), then sync. The `connector_sync` job completes with `nulStrippedValues: 1` and the record reads `Alice`. If you can't get a NUL into the sheet, record that here; `google-sheets-sync.integration.test.ts` covers this path. — manual
- [ ] Excel: not walkable, for the XLSX reason in §3. The Excel sync's throwaway session uses the same writer. — manual

## §6 — Agent tool input refused, uncharged (spec AC 6)

- [ ] Open a portal on a station with `data_query`; note the org's usage in Settings → Billing / usage.
- [ ] Prompt: **"Search the records of <entity> for a name containing the character U+0000 — pass that exact character, not an escape, in the search."** If the model sends a real NUL, the tool-call panel shows a result with `code: "TOOL_INPUT_INVALID_CHARACTERS"` and a message naming the input path, and the agent relays it or retries without it. If the model only sends the escaped text, mark this step "not reproducible by prompt"; the guard test in `tools.service.test.ts` covers it.
- [ ] Usage in Settings is unchanged by the refused call.

## §7 — Model and custom-tool output persists stripped (spec AC 7) — manual

- [ ] With a custom toolpack you host whose tool returns `{"label":"a\u0000b"}`: ask the agent to call it. The turn completes and is saved: reload the portal and the reply is still there, showing `ab`. The API log has a `warn` "Stripped U+0000 from an assistant message before persisting it" with a `stripped` count and no message text. — manual
- [ ] Bulk transform with the same tool (`transform_entity_records` writing its `label` into a column): the `bulk_transform` job completes, the column holds `ab`, and the job result has `nulStrippedValues`. — manual
- [ ] Webhook staging: a streaming custom tool that stages `{"rows":[{"k":"a\u0000b"}]}` via `POST /api/webhook/handle/:sessionId` gets `200` (not a `400`), and the staged handle reads back `ab`. — manual

## §8 — Build gates (spec AC 8) — backend

- [ ] At the repo root: `npm run build && npm run type-check && npm run lint && npm run format:check` all succeed. — backend

## §9 — Edge cases

- [ ] A NUL in the body of `POST /api/webhook/handle/x` without a token → `401` from the route (the body check is skipped there; the route's own auth still runs), not `400`. — backend
- [ ] `curl -s -X POST localhost:3001/api/webhook/handle/x%00` → `400 REQUEST_INVALID_CHARACTERS` (that route's URL is still checked). — backend
- [ ] The API log has no `500` for any step above. — backend: `grep -c '"status":500' <api log>` before and after the run is unchanged

---

## Sign-off

- [ ] Every section above verified (or its unwalkable steps recorded with a reason)
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact command / prompt): · Identifiers (org / job / entity / connector ids):
