# name_length_limits — Adversarial Review

Adversarial probes for [#801](https://github.com/EnterpriseBT/portal-ai/issues/801). The change caps user-authored names, labels and titles at 120, descriptions at 2000 and keys at 58, enforces the caps in request contracts, a few non-contract write paths and the agent tools, and shows them inline in the web. It also clips generated names and derived keys, and keeps wide-table column names within 63 bytes. **Branch under test:** `fix/801-name-length-limits` (PR [#803](https://github.com/EnterpriseBT/portal-ai/pull/803)).

The probes go after the cap itself: input built to sit on or slip past the boundary, a cap driven around the UI, data saved before the cap, and the paths that turn text into Postgres identifiers. Steps tagged `— backend` are API, DB or CLI probes. For API probes in the walk, reuse the `Authorization` header from one of the app's own requests with `page.request`, as the smoke walk did.

## Preflight

### Environment
- [ ] `git checkout fix/801-name-length-limits && git pull --ff-only && npm install && npm run build --workspace=packages/spreadsheet-parsing && npm run build --workspace=packages/core && npm run dev` (web :3000, API :3001)
- [ ] Playwright MCP available; the e2e owner session (`e2e:auth`)

### Fixtures
- [ ] The seeded `e2e-fixture` org. The smoke §3 file-upload connector (`Quarterly_regional_revenue_…`, with field mappings `name`, `email` and a 58-character derived key) and the smoke §Fixtures legacy station with a 500-character name. Recreate them from `docs/NAME_LENGTH_LIMITS.smoke.md` if they're gone.

### Reset between runs
- [ ] Delete the stations, tags, groups, column definitions and connectors the probes create, from their list pages. Restore any row a `— backend` probe updated by SQL (each probe says how).

## §1 — Boundary & limit inputs
- [ ] **New Station** Name of 60 × "😀" (each is 2 UTF-16 units, so 120 units), then 61 × "😀" (122 units) — expected SAFE: 60 is accepted and saved intact (no split emoji); 61 shows "Name must be 120 characters or fewer" inline, and the API refuses the same body with a 400. The web and the API agree on the count (both count UTF-16 units). Record whether "characters" reads as wrong to a user here.
- [ ] **New Station** Name of 120 × "a" plus 10 leading and 10 trailing spaces — expected SAFE: accepted, and saved as exactly 120 characters (trimmed before measuring); the DB row has no surrounding whitespace.
- [ ] **New Station** Name of 121 × "a" where the 121st is a zero-width space (`​`) — expected SAFE: refused like any 121-character name (zero-width characters count); no 400/inline disagreement.
- [ ] **Create Column Definition** Key of exactly 58 lowercase letters → create, then a field mapping to it on the §3 entity with Normalized Key of exactly 58 letters — expected SAFE: both succeed; the wide-table column is `c_` + 58 letters (60 bytes) and holds the mapped values.
- [ ] **Create Tag** Description of exactly 2,000 characters made of "é" (one unit each, two UTF-8 bytes) — expected SAFE: accepted; the stored description is 2,000 characters, unclipped.

## §2 — Malformed & injection input
- [ ] — backend — `POST /api/stations` with `{"name": "Ops\u0000x", "toolPacks": ["data_query"]}` (a NUL inside a valid-length name) — expected SAFE: a 4xx with a readable message, never a 500 (Postgres `text` rejects NUL, so an unguarded insert errors). Record the status; a 500 here predates #801 but is a finding.
- [ ] — backend — `POST /api/stations` with `{"name": 12345}` and with `{"name": ["a"]}` — expected SAFE: 400 `STATION_INVALID_PAYLOAD` naming `name`; nothing written.
- [ ] **Create Entity** Key `a'; drop table x;--` (under 58) — expected SAFE: refused by the key pattern inline and by the API (400); no SQL reaches the database.
- [ ] — backend — Field mapping PATCH with `normalizedKey` `"k\"; DROP TABLE er__x; --"` — expected SAFE: 400 (pattern); `sanitizeColumnName` never sees it.
- [ ] **New Station** Name `<img src=x onerror=alert(1)>` padded to 120 characters → create, then open the station and the stations list — expected SAFE: the text renders literally in the header, breadcrumbs and list; no script runs (no dialog, no console error).

## §3 — Concurrency & races
- N/A — the change adds no shared state or new write path. Column-name allocation runs inside the existing per-entity lock (`withEntityLock`) and is unchanged except for clipping.

## §4 — Driving a cap around the UI
- [ ] — backend — With the app's token, send an over-length value straight to the API on each family the web caps: `POST /api/entity-tags` (name 121), `POST /api/entity-groups` (description 2,001), `POST /api/column-definitions` (label 121), `POST /api/connector-entities` (key 59), `POST /api/curated-views` (label 121), `POST /api/policies` (name 121), `PATCH /api/portals/<id>` (name 121) — expected SAFE: each is a 400 naming the field with the shared message, and no row is created or changed.
- [ ] Rewrite a valid **Create Group** request in flight (`page.route`) to send a 121-character name — expected SAFE: 400; the dialog stays open and shows the error in its `FormAlert`; no group is created.
- [ ] — backend — `PATCH /api/stations/<legacy id>` with `{"name": "<the same 500 characters>"}` (resending the unchanged legacy name, as a non-web client might) — expected SAFE: 400 (the API holds any sent name to the cap); the station is unchanged. A PATCH with only `{"description": "x"}` → 200.
- [ ] — manual — Ask the portal agent to "rename the connector entity <id> to <121 characters>" and to "create a field mapping with key <59 characters>" — expected SAFE: the tool call is refused with the limit message as a typed tool result, nothing is written, and the agent doesn't claim success.

## §5 — Multi-tenant isolation
- N/A — no authorization, org-scoping or loader change. The new 400s carry only the caller's own plan paths and fixed messages, so they echo no other tenant's data.

## §6 — State & lifecycle abuse
- [ ] **Legacy pin:** set an existing pin's name to 500 characters (`UPDATE portal_results SET name = repeat('P',500) WHERE id = '<pin id>';`), open the pin page, then **Rename** without changing it and press Enter — expected SAFE: the page renders, and an unchanged rename closes without a request (no error). Changing it to 121 characters shows the inline limit. Restore the name afterwards.
- [ ] — backend — **Recommit a plan whose derived keys predate the clip:** on the §3 connector, set its long mapping's key to the old unclipped form (`UPDATE field_mappings SET normalized_key = 'total_revenue_for_the_quarter_across_every_region_and_channel_combined_net_of_returns' WHERE …;`), then re-run the commit for its plan by id (with its upload session as the source) — expected SAFE: the commit completes (job `completed`, no "column already exists"), the entity's records are readable under the clipped key, and no wide-table column name exceeds 63 bytes (`information_schema.columns` for `er__<entity id>`). Record what happens to the old mapping (soft-deleted, renamed).
- [ ] — backend — **A legacy over-63-byte column:** on a scratch entity, create a field mapping whose stored `column_name` is 72 characters (as a pre-#801 reconcile would have), with Postgres holding its first 63 bytes. Then add a mapping whose key shares those first 61 characters — expected SAFE: the reconcile picks a different column name (a `_2` suffix), and no `ADD COLUMN` fails.
- [ ] **Edit Station on a legacy name:** open the legacy station, delete one character of the 500-character name (499, still over), Save — expected SAFE: the inline limit (an edited name is held to it), and no PATCH.
- [ ] — manual — **Generated names over time:** connect a Google Sheets account whose email makes "Google Sheets (<email>)" longer than 120 characters, then rename the connector to its clipped name plus nothing — expected SAFE: the clipped name saves and round-trips; no 400 on a name the app itself generated.

## §7 — Misuse sequences
- [ ] Paste a 300-character name into **New Station**, click **Create** (the error shows), then trim it to 120 by deleting from the middle and press **Enter** — expected SAFE: the error clears as soon as the value fits (the field was touched), and Enter creates exactly one station.
- [ ] In the region editor, type a 200-character **Label** (the region's optional label hint) and Interpret — expected SAFE: Interpret runs (the hint isn't capped); if the hint becomes the entity target, commit refuses it with a readable message in the wizard rather than a crash or a silent failure. Record which happens.
- [ ] **New Entity** in the region editor: type a label whose slug is exactly 58 characters, then add one more letter to the label — expected SAFE: the derived key stays at 58 (clipped, no trailing `_`), with no error the user didn't cause.
- [ ] Open **Edit field mapping** on the §3 long mapping (58-character key), change only **Required**, Save, and confirm the revalidation prompt if shown — expected SAFE: one PATCH with no `normalizedKey`; the mapping keeps its key.
- [ ] Upload a file whose name is 300 "é" characters plus `.csv` (if the OS allows) or 300 ASCII characters — expected SAFE: the connector is named with the clipped name ending in "…", length ≤ 120 units, no split character.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station/connector/entity/plan ids):
