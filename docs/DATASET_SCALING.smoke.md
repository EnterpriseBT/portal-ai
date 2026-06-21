# Large-Scale Dataset Features — Smoke Suite

Manual smoke test plan for the dataset-scaling epic:

- **#129 — streamable cursor-backed handle** ([PR #144](https://github.com/EnterpriseBT/portal-ai/pull/144), merged): a query handle streams its *full* result past `HANDLE_ROW_CAP` (100k), so `forecast` folds over an unbounded handle — exact, bounded memory — instead of hitting `COMPUTE_INPUT_TOO_LARGE`.
- **#124 — custom webhook compute scaling** ([PR #143](https://github.com/EnterpriseBT/portal-ai/pull/143)): a custom (webhook) tool scales over large data in **both** directions via its declared `consumption` — `bounded` (records-in-body), `streaming` (pull-on-read over the cursor), and outbound (`{ resultHandle }`) — **rows never enter the agent's context, the user JWT never crosses the trust boundary.**

Run **§Preflight** once. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

> **Walkthrough result (2026-06-21): ✅ all sections green.** Walked live against a running dev env + the mock toolpack server, using a 730-row synthetic daily-sales entity (`date`/`revenue`/`units`/`region`) and the lowered-cap trick (`HANDLE_ROW_CAP=200`) for §1c/§1d. The "one substrate, two localities" design verified end-to-end: `forecast` folds an unbounded cursor in-process (§1c: `count 730` from a handle advertising `rowCount 201` — proof the cursor re-executed the full set, not the 200-row snapshot), and a webhook scales over the same handle remotely in all three tiers (§2–§4), with the trust-boundary endpoints failing closed (§5). Findings filed, none blocking: [#145](https://github.com/EnterpriseBT/portal-ai/issues/145) (chart blank/overflow — pre-existing web), [#146](https://github.com/EnterpriseBT/portal-ai/issues/146) (agent fabricates/mislabels analytics instead of calling the tool), [#147](https://github.com/EnterpriseBT/portal-ai/issues/147) (handle `rowCount` ≈ cap+1 under truncation). Per-section evidence in the Sign-off checklist below.

---

## Preflight

### Environment

- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] `npm run build --workspace=packages/core` is current (the API reads core's `dist` for the `consumption` contract + constants).
- [ ] Redis is reachable (the cursor stages snapshots + the webhook tokens live in Redis); Postgres migrations applied.
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.
- [ ] **Mock toolpack server running:** from `apps/api`, `npm run webhook:toolpack` → listens on `http://localhost:4100` (`/schema`, `/runtime`, `/metadata`). It now exposes the three reference tools `sum_records` (bounded), `count_via_pull` (streaming), `aggregate_to_handle` (streaming + output staging). Leave it running for §2–§5.
- [ ] **`apps/api/.env` for the local webhook round-trip (§3–§5):**
  - `TOOLPACK_DISABLE_SSRF_FILTER=true` — **required.** The API's outbound call to the mock toolpack is to `localhost`, which the SSRF filter blocks by default; without this, registration and `streaming`/`bounded` runtime calls fail. (Production keeps the filter on — the real webhook is a public host.)
  - `PUBLIC_API_BASE_URL=http://127.0.0.1:3001` — the callback base handed to a `streaming` webhook in its grant. Defaults to `http://localhost:3001`, so only set it if your API isn't on `:3001`. The mock server pulls/stages against this URL.
  - Signing can stay on (the mock server skips verification when `MOCK_TOOLPACK_SIGNING_SECRET` is unset). To exercise signing, set the same secret on the pack and as `MOCK_TOOLPACK_SIGNING_SECRET`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **ts-entity** | A source entity with a **time series**: a date/timestamp wide-column (e.g. `c_date`) and a numeric column (e.g. `c_value`), ordered, with enough rows to be a real forecast (≥ ~60). | §1 |
| **big-handle** | The same entity (or any) with a **row count above the effective `HANDLE_ROW_CAP`** — see the cap note below. | §1c, §3, §4 |
| **mock pack** | The running mock toolpack registered as a custom pack (§Register below) and enabled on the station under test. | §2–§5 |

#### Exercising the > 100k cursor without seeding 100k rows

`HANDLE_ROW_CAP` (`packages/core/src/constants/large-data-ops.constants.ts`, default `100_000`) is the snapshot tier; **above it the cursor (keyset re-execution) engages.** Two ways to cross it:

- **Real scale (staging):** a source entity with > 100k rows. Honest, but heavy to seed locally.
- **Lowered cap (local, recommended):** temporarily set `HANDLE_ROW_CAP = 200`, `npm run build --workspace=packages/core`, restart the API. Now a ~300-row entity produces a handle whose `rowCount` exceeds the cap and the cursor engages. **Revert + rebuild after the run.**

> **The cursor needs a keyset.** For streaming to engage on a > cap handle, the result must project a **unique id** (`_record_id` — entity views expose it) plus the tool's order column. Use `display_entity_records`, or a `sql_query` that selects `_record_id` alongside the date/value columns. Without an id projected, a > cap handle falls back and surfaces `COMPUTE_INPUT_TOO_LARGE` (by design — §1d).

### Register the mock pack

- [ ] Toolpacks view → **Register toolpack** → schema `http://localhost:4100/schema`, runtime `http://localhost:4100/runtime`, metadata `http://localhost:4100/metadata`. Registration succeeds (with `TOOLPACK_DISABLE_SSRF_FILTER=true`).
- [ ] The three reference tools register **without** a `TOOLPACK_CAPABILITY_INVALID` error — `bounded` and `streaming` consumption are now accepted (the gate widened in #124). Enable the pack on the station under test.

### Reset between runs

- [ ] Nothing to clean up structurally — everything here is read-only or stages short-TTL handles (24h) / tokens (10m). `npm run db:studio` is handy for inspecting entity row counts.

---

## §1 — #129 cursor: `forecast` over a large handle

### §1a — Forecast over a normal (≤ cap) handle (baseline)

- [ ] In a portal on a station with the **regression** toolpack, prompt: **"Forecast the next 5 periods of `c_value` over time for <ts-entity>."**
- [ ] The agent calls `sql_query` (or `display_entity_records`) → gets a `queryHandle` (the rows are **not** in the chat — only a `samplePeek`), then calls `forecast` with that `queryHandle` + `dateColumn` / `valueColumn` / `horizon`.
- [ ] `forecast` returns `{ forecast: { dates, values, lower, upper }, parameters, mape, count }` — note it returns **forecast + intervals + MAPE**, not the full fitted series. `count` equals the source row count.
- [ ] The agent answers inline with the projection.

### §1b — Rows never enter context

- [ ] In the same transcript, confirm the `sql_query`/`forecast` tool-call panels show a **handle reference** (`queryHandle`, `rowCount`, `samplePeek` of ≤10) — never the full row set. The model's context never contains the dataset.

### §1c — Forecast over a > cap handle folds (the #129 win)

- [ ] With **big-handle** in play (real > 100k, or the lowered-cap trick from Preflight), repeat §1a so the handle's `rowCount` exceeds `HANDLE_ROW_CAP`.
- [ ] `forecast` **succeeds** — it does **not** raise `COMPUTE_INPUT_TOO_LARGE`. (Pre-#129 this errored; the cursor now folds the full set.)
- [ ] Sanity: the forecast is consistent with a smaller-horizon manual check / the ≤cap run shape — the fold is exact, not sampled.
- [ ] (Optional, API log) the handle's read goes through keyset re-execution (paged), not a single 100k materialization — memory stays bounded (one page resident).

### §1d — No keyset → clear error (not a silent wrong answer)

- [ ] Force a > cap handle whose query does **not** project `_record_id`/`id` (a bare aggregate-free `SELECT c_date, c_value …`). `forecast` over it surfaces `COMPUTE_INPUT_TOO_LARGE` with guidance to project an id / pre-aggregate — never a silently mis-ordered or truncated result.

### §1e — Snapshot endpoint still paginates (display tier unchanged)

- [ ] For a ≤cap handle, `GET /api/portal-sql/handle/:handleId?offset&limit` (with your user JWT) returns a paged window — the random-access display tier is unchanged by #129.

---

## §2 — #124 `bounded`: records-in-body

- [ ] Prompt: **"Use `sum_records` to total the `amount` column of <a handle/entity>."** (the agent supplies a `queryHandle` or inline `rows` + `column`).
- [ ] The agent's tool call carries `queryHandle` (or `rows`) + `column`; the **mock server log** shows a `POST /runtime` whose body contains `{ tool: "sum_records", input: { column }, records: [...] }` — the server resolved the rows, they are **in the request body, not the chat**.
- [ ] The result (`{ sum, count }`) comes back inline and matches a manual sum.
- [ ] Over-bound: point `sum_records` at a source larger than its `maxRows` (50k in the mock's declaration). With `onOverflow: "error"` the call surfaces `COMPUTE_INPUT_TOO_LARGE` rather than silently truncating.

---

## §3 — #124 `streaming`: pull-on-read

- [ ] Prompt: **"Use `count_via_pull` to count the rows of <big-handle>."**
- [ ] The agent's `count_via_pull` tool call carries a `queryHandle`; the **mock server log** shows `POST /runtime` whose body has a `source` grant `{ readUrl, readToken, rowCount, schema, pageLimit }` and an `output` grant — **no `records`** (the rows are pulled, not pushed).
- [ ] The mock server then makes **its own** `GET …/api/webhook/handle/:id?offset&limit` calls (visible in the API log) with `Authorization: Bearer <readToken>` and pages to the end.
- [ ] The result `{ count }` equals the source `rowCount` — every row pulled exactly once.
- [ ] Confirm **no user JWT** appears in the mock server's request log — only the scoped `readToken`.
- [ ] After the turn settles, the read token is revoked: replay one of the logged `GET` calls by hand (curl with the same token) → **401** `WEBHOOK_READ_TOKEN_INVALID` (the grant lived only for the call).

---

## §4 — #124 outbound: `{ resultHandle }`

- [ ] Prompt: **"Use `aggregate_to_handle` on <big-handle>."**
- [ ] The mock server pulls the input (as §3) and then `POST`s its rollup to the **write** endpoint (`POST …/api/webhook/handle/:session`, `Authorization: Bearer <writeToken>`) — visible in the API log — and returns `{ resultHandle: "qh-…" }`.
- [ ] The agent receives a **handle envelope** (`queryHandle`, `rowCount`, `schema`, `samplePeek`), not a wall of rows — the large output stayed out of context, past the old 1 MB inline cap.
- [ ] The agent can read/chart the result handle in a follow-up (e.g. "show me that result as a table") — it resolves like any query handle.

---

## §5 — Fail-closed (the trust-boundary surface)

Drive these by hand (curl/HTTP client) against the API; obtain a token by watching the mock-server log during a §3 run, or mint scenarios mentally from the scopes.

- [ ] **No token** → `GET /api/webhook/handle/:id` returns **401** `WEBHOOK_READ_TOKEN_INVALID`.
- [ ] **Bogus token** → **401** `WEBHOOK_READ_TOKEN_INVALID`.
- [ ] **Read token used on the write endpoint** (`POST`) → **403** `WEBHOOK_HANDLE_SCOPE_MISMATCH`.
- [ ] **A token for handle A used on handle B** → **403** `WEBHOOK_HANDLE_SCOPE_MISMATCH`.
- [ ] **`limit` > 5000** is clamped, not honored verbatim.
- [ ] A webhook returning a `{ resultHandle }` it did **not** stage this call → the tool result surfaces `WEBHOOK_RESULT_HANDLE_INVALID` (try a tool variant that returns a fabricated handle id, or temporarily edit the mock).

---

## §6 — Invariants

- [ ] **Context hygiene:** across §1–§4, the model's context never contains the bulk dataset — only handle envelopes / scalar results. Inspect transcripts.
- [ ] **No JWT egress:** the user's bearer token never appears in any outbound webhook body or in the mock server's logs.
- [ ] **Gate:** in the registration dialog (or `/schema`), a custom tool declaring `consumption.mode: "engine-pushdown"` is still **rejected** (`TOOLPACK_CAPABILITY_INVALID`); `none` / `bounded` / `streaming` are accepted.
- [ ] **No writes/locks:** none of these tools acquire an entity lock or write — concurrent edits to the source entity remain possible during a run.

---

## Sign-off checklist

**Verified live 2026-06-21 (730-row sales entity; lowered cap for §1c/§1d).**

- [x] §1 (#129 cursor) — forecast over ≤cap and >cap handles; >cap folds (no `COMPUTE_INPUT_TOO_LARGE`); no-keyset errors cleanly; rows never in context.
  - §1a/§1b: `display_entity_records`/`sql_query` → `queryHandle` (rowCount + 10-row samplePeek only) → `forecast` returned the reduced shape `{ forecast, parameters, mape, count }`, `count 730`, MAPE ≈ 2.4%.
  - **§1c (headline):** raw keyed handle (`_record_id` + `c_date`) advertising `rowCount 201` → `forecast` succeeded with **`count 730`** ⇒ the cursor re-executed the full retained query (keyset), not the 200-row snapshot.
  - §1d: a narrowed/aggregated handle (no `_record_id`) over the cap → `COMPUTE_INPUT_TOO_LARGE`, clean — no silent mis-order/truncation.
  - §1e: `GET /api/portal-sql/handle/:id?limit=5000` paged the staged window.
- [x] §2 (bounded) — `sum_records` POST body carried `records: […730]` (server-resolved, in body, not chat); `{ sum, count: 730 }` correct; HMAC `Signature: VERIFIED`.
- [x] §3 (streaming) — `count_via_pull` POST body carried a `source` grant (no `records`); the mock pulled `GET /api/webhook/handle/:id` pages with the scoped `readToken` (no user JWT); `count 730`; replayed token after settle → 401 (revoke-on-settle).
- [x] §4 (outbound) — `aggregate_to_handle` pulled the input, `POST`ed its rollup to the write endpoint with a `writeToken`, returned `{ resultHandle: qh-… }`, resolved into a handle envelope (1 rollup row, page 0 = 730) — output returned as a handle, not inline.
- [x] §5 (fail-closed) — live: no-token, bogus-token, malformed-Authorization, and POST-no-token all → **401 `WEBHOOK_READ_TOKEN_INVALID`** (read + write endpoints). Scope-mismatch 403s / expired / cross-org / `limit` clamp / unstaged-resultHandle are covered by the 9 adversarial integration tests (`webhook-handle.router.integration.test.ts`, green in CI) — impractical to drive by hand since tokens revoke on settle.
- [x] §6 (invariants) — context hygiene + no-JWT-egress observed across §1–§4 (handles/scalars only); gate confirmed via registration (the mock pack's `bounded`/`streaming` tools registered, `engine-pushdown` rejected by the registration tests); these tools take no locks/writes.

**Outcome:** ✅ epic verified end-to-end — validates PR #143 (ready for review) and the merged #129. Non-blocking findings filed: #145 (chart blank/overflow), #146 (agent fabricates/mislabels analytics), #147 (handle `rowCount` ≈ cap+1 under truncation).

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <agent transcript / API + mock-server logs / curl output>
**Repro:** <prompt + any preconditions (cap setting, entity id, fixture)>
**Handle / token / session id:** <from the logs>
```
