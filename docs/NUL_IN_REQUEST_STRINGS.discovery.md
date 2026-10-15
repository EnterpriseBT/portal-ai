# NUL in request strings — Discovery

**Issue:** [EnterpriseBT/portal-ai#805](https://github.com/EnterpriseBT/portal-ai/issues/805)

**Why this exists.** `POST /api/stations` with `{"name":"Ops\u0000x"}` answers `500 STATION_CREATE_FAILED`. The name is valid JSON and passes the station contract, and then Postgres refuses it. The route's catch wraps the driver error, so the caller gets "Internal server error" and nothing tells them what to fix. U+0000 is legal in JSON and in a URL (`%00`), but no Postgres `text` or `jsonb` value can hold it. Nothing between the socket and the database rejects it today: a grep for `\u0000` / `\x00` / `0x00` / "null byte" / "control char" across api, core and web finds no handling. The only hit is a test that *pins* the 500 (see below).

This is the boundary check that turns "a character the database can't store" into one typed 400, before any route runs.

## The current shape

### What Postgres actually says (confirmed locally, postgres.js)

| Write | Result |
|---|---|
| `${"Ops\u0000x"}::text` | `22021` invalid byte sequence for encoding "UTF8": 0x00 |
| `${sql.array(["a\u0000"])}::text[]` | `22021` |
| `… ilike ${"%a\u0000%"}` (a search filter) | `22021` |
| `${sql.json({a: "Ops\u0000x"})}` (jsonb) | `22P05` unsupported Unicode escape sequence |

The third row matters: **reads 500 too.** Every list route that feeds `?search=` into `ilike` (`routes/station.router.ts:193`, `connector-entity.router.ts:154`, `jobs.router.ts:133`, `portal-results.router.ts:463`, and others) fails on `%00`. So does a NUL in a route param, e.g. `GET /api/field-mappings/%00`.

### Request pipeline (`apps/api/src/app.ts`)

| Step | Location | Note |
|---|---|---|
| `/api/webhooks` | `app.ts:66` | Mounted before the JSON parser (raw body for HMAC). Stripe-only, server-to-server |
| `express.json({ limit })` | `app.ts:68` | Only `limit`. No `reviver`/`verify`. Default limit 4 MiB (`environment.ts:275`) |
| `cors`, `jsonBodyOnly` | `app.ts:69–90` | `json-body-only.middleware.ts:29–54`: 415 `REQUEST_UNSUPPORTED_MEDIA_TYPE` for a non-JSON body (#775) |
| public/SSE/docs routers, then `/api` → `protectedRouter` | `app.ts:92–111` | `jwtCheck` first inside (`protected.router.ts:40`) |
| catch-all | `app.ts:114–228` | Body-parser `entity.too.large` → 413 `REQUEST_PAYLOAD_TOO_LARGE`; `entity.parse.failed` → 400 `REQUEST_BODY_INVALID_JSON`; else 500 `UNKNOWN` |

The request-lifecycle codes live together at `constants/api-codes.constants.ts:26–30`.

### How routes surface DB errors

Most routes catch everything and rethrow a non-`ApiError` as `new ApiError(500, <DOMAIN>_<X>_FAILED, …)`, e.g. station create at `station.router.ts:574–588`. The raw pg error never reaches the catch-all, so **a central `22021`/`22P05` → 400 mapping would see nothing** without editing every route's catch. `unwrapPgError` (`utils/pg-error.util.ts:17`) reads the SQLSTATE off Drizzle's `.cause`. The only per-route pg-code mapping is `23505` → 409 in `api-endpoints.router.ts:571–590`.

### Text contracts

`nameField` / `descriptionField` / `keyField` (`packages/core/src/contracts/text-limits.contract.ts:28–44`, #801) cap length. `name-length.guard.test.ts` sweeps every `*BodySchema`/`*RequestSchema` for them. The web maps Zod issues to inline field errors through `validateWithSchema` (`apps/web/src/utils/form-validation.util.ts:24–31`).

### Non-HTTP write paths (no middleware sees these)

| Path | Where strings come from | Writes via |
|---|---|---|
| File upload import | User's CSV/XLSX, presigned S3 PUT, streamed by `workbook-adapters/csv.adapter.ts` / `xlsx.adapter.ts` | `services/record-import.util.ts:145–151`, `layout-plan-commit.service.ts` |
| Connector sync | Remote REST / Google Sheets / Excel data | `adapters/rest-api/rest-api.adapter.ts`, record-import |
| Agent write tools | LLM-generated tool input | `tools/entity-record-create.tool.ts:151,205`, `entity-record-update`, `transform-entity-records` |

A NUL on these paths fails a job or a tool call rather than an HTTP request. Upstream, they enter through two ingest points:

- **Spreadsheets:** every spreadsheet pipeline (file upload, Google Sheets, Microsoft Excel, including Excel's sync-time fetch) streams cells through one `SessionWriter` from `WorkbookCacheService.beginSession` (`services/workbook-cache.service.ts:66–83, 103`). Cells arrive via `appendRows`, typed `ChunkCell = string | number | boolean | null` (`:44`), and sheet names via `finishSheet`. Interpret (header labels → field-mapping labels and keys), preview and commit all read back from that cache.
- **REST API syncs:** rows pass through `importRows` (`services/record-import.util.ts:69`), whose input is `AsyncIterable<Record<string, string>>`, from `adapters/rest-api/rest-api.adapter.ts`.

Downstream they write through `EntityRecordsRepository.upsertManyBySourceId` (`db/repositories/entity-records.repository.ts:171`) and `WideTableRepository.upsertMany` (`db/repositories/wide-table.repository.ts:405`). The latter already reports what it repaired or rejected (`{ repaired, rejected }`, #316).

Agent tools are composed in `ToolService.buildAnalyticsTools` (`services/tools.service.ts:918–950`). The lock gate is applied first (innermost), then the permission gate, then the cost gate (outermost). The lock gate's refusal is a typed tool result returned from inside the wrap (`services/lock-gate.service.ts:123–158`).

### The test that pins today's behavior

`__integration__/routes/field-mapping.router.integration.test.ts:500–517` (#687) uses `GET /api/field-mappings/%00` *as its way to cause a DB error* and asserts a 500 with no SQL in the body. A URL check turns that into a 400, so the test needs another trigger.

## The design space

### Decision 1 — where HTTP request NULs are rejected

**A. JSON `reviver` on `express.json()`.** Throw on a NUL key or value. Body-parser reports it as `entity.parse.failed`, which the catch-all already maps to 400 `REQUEST_BODY_INVALID_JSON`.

**B. A dedicated middleware after `jsonBodyOnly`.** Walk the parsed `req.body` (keys and string values) iteratively and check the raw URL for `%00`. Refuse with a new `400 REQUEST_INVALID_CHARACTERS` whose `details` name the location (`body` + JSON path such as `data.notes`, or `url`).

**C. A `.refine` in the shared text builders only.** A field-level message ("Name must not contain control characters") that the web also shows inline.

**D. Map `22021`/`22P05` → 400 after the fact.** Needs every route's catch to change (they wrap first), and it fires *after* the write began: a multi-statement route without a transaction may have applied part of the write.

| | A reviver | B middleware | C contracts | D map DB error |
|---|---|---|---|---|
| Covers every JSON body | Yes | Yes | Only guarded fields | Yes, eventually |
| Covers query/params | No | Yes | No | Yes |
| Honest code/message | No: says "invalid JSON" for valid JSON | Yes | Yes | Yes |
| Names the field | No | Yes (JSON path) | Yes | No |
| Runs before any write | Yes | Yes | Yes | **No** |
| Touch points | 1 | 1 + mount | ~every contract | every route catch |

**Lean: B.** One place, before any route or write, covering bodies, params and query strings, with a code that says what's wrong and a path that says where. A misses URLs and lies about the cause. D is the wrong layer.

### Decision 2 — also add the contract refine (C) on top of B?

The issue suggests both. With B mounted ahead of every router, an HTTP request carrying a NUL never reaches a contract's `safeParse`, so C would never fire on the API. Its only remaining consumer is the web form, where a NUL can only come from a paste.

| | B only | B + C |
|---|---|---|
| Rules for "what's storable" | 1 | 2, which can drift |
| Field-level message | Yes, through `details.path` | Yes |
| Web inline error on a pasted NUL | No: the API's 400 shows in `FormAlert` | Yes |

**Lean: B only.** C adds a second rule for a case the boundary already handles and names, to cover a paste that a form will almost never see. Revisit if a form turns out to receive NULs in practice.

### Decision 3 — which characters

Postgres refuses exactly U+0000 in `text`/`jsonb`. Other C0 controls (U+0001–U+001F) store fine, and tab/newline are legitimate in descriptions and record values. A lone UTF-16 surrogate can't arrive: body-parser decodes to valid UTF-8 and replaces it.

**Lean: U+0000 only.** The rule is "what the database can't store", not a content policy. Rejecting other controls would break real data (tabs in pasted TSV cells) for no correctness gain.

### Decision 4 — non-HTTP write paths (imports, syncs, agent tools)

B can't see these. **Folded into #805** (your call). Two sub-decisions follow: what to do with a NUL in imported data, and what to do with one in agent tool input.

#### 4a — imported and synced data: reject or strip?

- **Reject:** a NUL fails the run with a typed error. It's honest, but one stray byte in a 400K-row sync, or in a CSV exported from a legacy tool, fails the whole import. The user often can't fix the source (a remote API, a shared sheet).
- **Strip:** the data lands without the unstorable byte. This changes customer data, but U+0000 means nothing in a text cell, and dropping it is what ETL tools commonly do.

**Lean: strip, and say so.** The count goes on the job result and renders in `JobDetail` when nonzero, as #441's `mirrorDegraded` does: "a log line alone is not a surface anyone reads".

#### 4b — where imported data is stripped

- **At the write primitives** (`upsertManyBySourceId`, `wideTable.upsertMany`). These are the last stop before Postgres, but too late: header-derived field-mapping labels and keys, source ids, sheet names and the interpret preview have already used the raw strings. A NUL in a header still fails the commit.
- **At ingest:** in the `SessionWriter` (`appendRows` cells, `finishSheet` names) and in `importRows`. Everything downstream (preview, interpret, labels, keys, source ids, records, the wide mirror) then sees the same, storable data.

| | Write primitives | Ingest (session writer + `importRows`) |
|---|---|---|
| Covers headers → labels/keys | No | Yes |
| Preview matches what's stored | No | Yes |
| Covers source ids | Only if stripped there too | Yes |
| Places to change | 2 | 2 |
| A future ingest path | Covered | Must use one of the two |

**Lean: ingest.** It's the only option that also covers headers, and both spreadsheet and REST paths already funnel through it. HTTP writes and tool writes reach the primitives only after the boundary middleware or the tool gate has rejected a NUL, so a strip there would only hide a bug in those layers.

#### 4c — agent tool input

The model's tool-call JSON can carry `\u0000` like any client. A NUL in a read tool's search string fails the same way a `?search=` does. **Lean: reject, in a new `wrapWithInputCharacterGate` applied to every built-in tool, before (inside) the lock gate.** It returns a typed `TOOL_INPUT_INVALID_CHARACTERS` result that names the input path, so the agent can retry with clean input. It's never charged, the same as the lock gate's refusal. Custom (webhook) tools are exempt: their input goes to the org's endpoint as JSON, where NUL is legal, and never to our database. The existing every-tool-is-wrapped guard test gets this gate added.

## Tradeoff comparison

|  | D1: middleware (B) | D2: no contract refine | D3: U+0000 only | D4a/b: strip at ingest | D4c: tool gate |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| New code / field | `REQUEST_INVALID_CHARACTERS` | — | — | strip count on job results | `TOOL_INPUT_INVALID_CHARACTERS` |
| Packages touched | api | — | api | api, core (result schemas), web (`JobDetail`) | api |

## Recommendation

1. Add `REQUEST_INVALID_CHARACTERS` to the request-lifecycle block of `api-codes.constants.ts`, with a doc comment (#805, 400).
2. Add `middleware/reject-nul.middleware.ts`, mounted in `app.ts` right after `jsonBodyOnly`, so it covers public, SSE and protected routes alike.
3. The middleware refuses when the raw URL (`req.originalUrl`) contains `%00` (case-insensitive), or when any key or string value in `req.body` contains U+0000. The body walk is iterative, so deep nesting can't overflow the stack.
4. The 400's message names the location ("`name` contains a NUL character (U+0000), which can't be stored"). `details` carries `{ location: "body" | "url", path }`, with a JSON path for bodies capped like #745's issue paths. The rejected value is never echoed.
5. Log it at `warn` (a client error, like the malformed-JSON branch), with the redacted route.
6. Rewrite the #687 field-mapping test to trigger its DB error by making the repository read reject (`jest.spyOn`) with a Drizzle-shaped error that carries SQL text. The no-SQL-leak assertion stays.
7. Tests: unit tests for the middleware (body key, nested value, array element, URL path, query, clean pass-through, the escaped literal `"\\u0000"` text passes). Integration tests that a NUL station name, record value, filter and `?search=` each return 400 `REQUEST_INVALID_CHARACTERS` with nothing written.
8. One shared helper, `stripNul` (api `utils/`), removes U+0000 from a string and reports whether it changed anything. Every strip site uses it.
9. `WorkbookCacheService`'s `SessionWriter` strips string cells in `appendRows` and the sheet name in `finishSheet`, and counts stripped cells. The session meta carries the count, so the commit or sync job that reads the session can report it.
10. `importRows` strips keys and values of each incoming row before the checksum, so an unchanged remote row containing a NUL stays `unchanged` across syncs. It returns the count on `ImportResult`.
11. Each job type that imports (file-upload commit, Google Sheets / Excel commit and sync, REST sync) carries the count on its `result` as an optional field. Its core result schema gains the field, and `JobDetail` shows a line when it's nonzero.
12. `wrapWithInputCharacterGate` is applied to every built-in tool in `buildAnalyticsTools`, before the lock gate. A NUL anywhere in the input returns a typed `TOOL_INPUT_INVALID_CHARACTERS` result naming the path, never charged and never executed. The every-tool-is-wrapped guard test covers it.

## Open questions

1. **Mount before or after auth?** Mounted at `app.ts:90`, an unauthenticated request with a NUL gets 400 rather than 401. Body-parser's 400/413 already run pre-auth, so this matches. **Lean: before auth.** The check is cheap and leaks nothing.
2. **The webhook route** (`app.ts:66`) parses its own body and skips the middleware. **Lean: leave it.** It's Stripe, HMAC-verified and server-to-server, and its handler doesn't write arbitrary strings to text columns.
3. **Body walk cost on a 4 MiB body.** A single pass over already-parsed values is linear and small next to the parse itself. **Lean: no cap beyond the existing size limit.** Measure once in the unit tests with a max-size body.
4. **Two source ids that differ only by a NUL.** Stripping at ingest makes `"a\u0000"` and `"a"` the same source id, so the upsert merges them. Today the same row fails the whole import instead. **Lean: accept the merge.** A remote system whose ids differ only by U+0000 isn't a realistic input, and the strip count still flags that something was cleaned.
5. **Is the cost gate's "refusal is never charged" rule detected by result shape, or only because the lock gate refuses before `execute`?** **Lean: the spec reads `wrapWithCostGate` (`services/cost-gate.service.ts:327`) and makes the new refusal follow whichever mechanism the lock gate's refusal uses.** A test asserts a NUL-refused call leaves usage unchanged.
6. **Assistant message persistence.** Model output that contains a NUL and is stored in a text or jsonb column would hit the same `22021`/`22P05`. The survey didn't trace where portal messages are persisted. **Lean: the spec locates it and strips there with `stripNul`.** It's model output, not user input, so there's no one to reject it back to.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because this is a stateless, per-request check that runs before any DB work.
- **Accuracy & auditability:** HTTP and tool refusals store nothing. Imports and syncs change stored data by stripping, so every strip is counted on the job's `result` and rendered in `JobDetail`. A changed-data event isn't silent, and it's durable as long as the job row is.
- **Failure modes:** HTTP and tool input fail closed, as a typed refusal before any write; the write would have failed anyway. Imports degrade gracefully: a stray byte no longer fails a 400K-row run.
- **Scale & unbounded growth:** Bounded by the 4 MiB body limit. The walk is iterative, so depth can't blow the stack. `details.path` is capped. The ingest strip is one `includes("\u0000")` check per string cell on paths that already touch every cell, so the cost is linear and small next to parsing. The count is a single integer per session, not a list of positions.
- **Multi-tenancy:** N/A because the check doesn't touch tenant data and runs identically for every org.
- **Contract stability:** One new stable code for every route. Clients and the web's `serverErrorMessage` handle it like any other 400, and no per-route codes multiply.
- **Data lifecycle:** N/A.

## What this doesn't decide

- A general content policy for control characters or invisible Unicode (zero-width, bidi overrides). That's a product or safety question, not a storability one.
- Fixing the routes' blanket `catch → 500` wrapping. #687 already keeps it safe, and the boundary removes this cause.
- Re-cleaning records already stored. None can contain U+0000, because Postgres never accepted them.

## Next step

`/spec 805` writes `docs/NUL_IN_REQUEST_STRINGS.spec.md` (both codes, the `details` shape, mount point, strip-count fields, test matrix), and `/plan 805` writes the slices. The expected slicing:

1. The code + `stripNul` + middleware + unit tests.
2. Mount it, plus integration tests, plus the #687 test rewrite.
3. The ingest strip (session writer + `importRows`), the counts on job results, and the `JobDetail` line.
4. The tool input gate + guard-test coverage.
5. Assistant message persistence, once the spec has located it.
