# Cap the query-handle samplePeek — Condensed design (#704)

**Issue:** [EnterpriseBT/portal-ai#704](https://github.com/EnterpriseBT/portal-ai/issues/704) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The handle envelope `{queryHandle, rowCount, schema, samplePeek}` is the model-facing summary of a large result. Its `samplePeek` is the first 10 **raw** rows, with no per-cell or payload cap. One raw PostGIS geometry serialises as EWKB hex at about 32 characters per vertex, so a layer whose first rows are big contours puts megabytes into the agent's context. The provider then rejects the turn (`prompt is too long: 6826573 tokens`). The broken result is also persisted in history, so the portal stays broken afterwards. The handle path deliberately lifts `cellCap`/`payloadCap` for the **staged rows**, which only the UI renders. The bug is that the same lift also reaches the slice the model sees. The fix touches `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Caps + helpers | `apps/api/src/services/portal-sql-response.util.ts` | `PORTAL_SQL_DEFAULTS` (`cellCap: 500`, `payloadCap: 100_000`), `applyCellCap` → marker `…<truncated, original Nb>`. Pure functions. |
| Cap lift (correct, for staged rows) | `portal-sql-handle.service.ts:127-142` | `produce` runs the query with `cellCap/payloadCap = MAX_SAFE_INTEGER` so the UI gets full rows. |
| Uncapped peek ×3 | `portal-sql-handle.service.ts:190` (`produce`), `:260` (`produceFromRows`, webhook results), `:403` (`stageFromStream` → `produceFromStream`) | `rowsRaw.slice(0, SAMPLE_PEEK_SIZE)` / `head.slice(…)`, no cap. |
| Envelope contract | `packages/core/src/contracts/portal-sql.contract.ts:53` | `samplePeek: z.array(z.record(…)).max(10)`. Values are `unknown`, so a marker string is already valid. |
| Forwarders | `result-sink.ts:71` (`resolveSqlDelivery` → `produce`, used by `sql_query`/`visualize_map`/`visualize_d3`), `webhook.tool.ts:268` (re-reads staged meta), `portal.service.ts:255` (persists `samplePeek` into the `data-table` block), `visualize-d3.tool.ts:62` → `visualize-d3.prompt.ts:91` (sent to the codegen LLM) | All forward `envelope.samplePeek` verbatim, so all of them inherit whatever is produced. |
| Web | none | `apps/web/src` never reads `samplePeek`, so truncation changes nothing the user sees. |

## Decision — cap once, where the envelope is minted

**Options.**
- **(A) Cap at each tool boundary** (sql_query, visualize_map, visualize_d3, display_entity_records, webhook). That means five or more sites, the persisted block and the Redis meta would still hold the raw peek, and the next forwarder added would bypass it.
- **(B) Cap at the three production sites in `PortalSqlHandleService`.** This is the single choke point every envelope goes through. The staged Redis meta, the webhook re-read, the persisted message block and the d3 codegen prompt all inherit it for free.

**Chosen: B.** Add a pure `capSamplePeek(rows, { cellCap, payloadCap })` to `portal-sql-response.util.ts`, defaulting to `PORTAL_SQL_DEFAULTS`:
1. `applyCellCap(rows, cellCap)`, reusing the existing marker so the model sees the same truncation shape as the inline path.
2. Payload bound: while `Buffer.byteLength(JSON.stringify(peek)) > payloadCap`, drop the **last** row, down to `[]`. Cell capping alone leaves about 10 rows × columns × 500 B, which can still exceed 100 KB on a wide (200+ column) table. Dropping tail rows keeps the result within the `.max(10)` contract and keeps the cells that remain intact.

All three sites call `capSamplePeek(...)` in place of the bare `slice`. The staged rows, `schema` detection (still from the raw first row, so `geometry` typing is unchanged) and `rowCount` are untouched. The `:127` comment gets one sentence explaining that the lift covers the staged rows and that the peek is capped separately (#704).

## Plan — 1 slice

**Files**
- edit `apps/api/src/services/portal-sql-response.util.ts`: add `capSamplePeek`.
- edit `apps/api/src/services/portal-sql-handle.service.ts`: three call sites + the comment.

**Tests** (written first; run with `npm run test:unit -- --testPathPattern 'portal-sql-response|portal-sql-handle|produce-from-stream'` from `apps/api`)
- `src/__tests__/services/portal-sql-response.util.test.ts`, `capSamplePeek`:
  - a cell over 500 B → marker;
  - numbers, booleans, nulls and short strings pass through unchanged;
  - a wide row set over 100 KB after cell cap → tail rows dropped until it fits, result ≤ `payloadCap`, order preserved;
  - empty input → `[]`.
- `src/__tests__/services/portal-sql-handle.service.test.ts`: `produce` with a mocked first row carrying a 200 KB hex `geom` → `envelope.samplePeek[0].geom` is the marker; the staged rows (`mockRedisSet` payload) still carry the full string; `JSON.stringify(envelope.samplePeek)` ≤ 100 KB. Same test for `produceFromRows`.
- `src/__tests__/services/produce-from-stream.service.test.ts`: the same assertion for the stream path.

## Smoke (manual, against your dev stack)

1. As org owner, use a station with a curated view over `smoke_contours` (the #698 seed). Its first five rows are the 109K/87K/64K/51K/50K-vertex lines.
2. In a **new** portal, ask "Map the Smoke Contours as lines". The turn completes and the map renders all contours. The API log has no `AI stream error chunk` and no `prompt is too long`.
3. Check the persisted block: `select content from portal_messages …` (or the network response) → `samplePeek[*].geom` values are `…<truncated, original Nb>` and the block is a few KB.
4. Ask a follow-up ("how many contours are there?") in the same portal. It answers, which shows history no longer carries the oversized result.
5. Regression: in a new portal ask "show all smoke contours as a table". The data table still shows full rows, because staged rows are uncapped.
6. Regression: run a small inline `sql_query` (≤100 rows). The result is unchanged.

## Out of scope

- **Portals already broken** by a persisted oversized result. Their history keeps the raw peek, and the user resets the conversation. No backfill: the only repro is local, and the app-dev peeks were small.
- **The inline (≤100-row) geometry path.** It already goes through the default caps. The #343 render-only lift never reaches the model.
- **A geometry-aware summary** in the peek (e.g. `{type, vertexCount, bbox}` in place of the marker). It could help reasoning, but it's a new pattern and a contract change. Ticket it if the marker turns out to cost real follow-ups.
- **Capping historical tool results when rebuilding model context** (a defence-in-depth guard in the prompt builder). Capping at production removes the source. Raise it separately if other oversized result shapes turn up.
