# Streamable cursor-backed handle — Spec

**After this lands, a query handle can stream its *full* result past `HANDLE_ROW_CAP` (100k), not just page a ≤100k Redis snapshot.** The ≤100k snapshot stays the hot random-access tier (`getSnapshot`, unchanged); a new forward-only `streamHandle` pages the snapshot then, beyond it, **re-executes the retained query with keyset pagination** (decision A). A new `resolveRecordStream` exposes that stream to the `streaming` consumption mode, and the single-pass **reduce** tool `forecast` folds over it — exact at any N, one batch resident at a time. (Discovery bucketed three reduces here; implementation narrowed it to `forecast`. `technical_indicator` is a **map** — O(N) output, the deferred large-raw-series-output wall; `portfolio_metrics` is a genuine reduce but has no order column for path-dependent `maxDrawdown`, a positional two-stream benchmark join, and a realistic-N that never reaches 100k — both stay on the bounded path. See Decision 4.) This is the shared in-process dataset-scaling substrate; #124 (remote pull-on-read), #92 (pin replay), and `bulk_transform`'s worker read are later consumers of the *same* cursor.

Discovery: `docs/STREAMABLE_CURSOR_HANDLE.discovery.md`. Issue: [#129](https://github.com/EnterpriseBT/portal-ai/issues/129). Builds on #121 (`resolveRecordSource`, the `consumption` contract).

## Key decisions (flag for review)

1. **Re-execute + keyset (D1, confirmed).** The handle retains its `sql` + a stable sort key; reads past the 100k snapshot re-run `… WHERE <key> > :last ORDER BY <key> LIMIT :n`. Stateless — survives the 24h TTL + multi-process, no held connections, no disk staging. Non-snapshot-consistent across pages *by design* (this is the freshness #92's live pins want); strict point-in-time consistency is out of scope (#92's deferred compliance mode).

2. **Order is tool-declared; keyset on `(orderBy, id)` (decision B, confirmed; spike-validated).** Keyset over a *re-executed* query needs a **deterministic unique total order**. Rather than parse the agent's SQL for it (fragile), **the streaming tool declares its order column** — `forecast` already has `dateColumn`, etc. The cursor keysets on the **composite `(orderBy, id)`**: the tool's semantic order (ties allowed) + a unique tiebreaker. The tiebreaker is the result's `id` column (the `er__` row id, present when the query projects it). The **plan-S2 spike proved this composite is keyset-stable over re-execution, including under concurrent inserts** (no skip/dup; after-cursor rows appear, before-cursor don't).
   - **`streamHandle` always re-executes** the retained `sql` wrapped in the `(orderBy, id)` keyset — it does **not** interleave the Redis snapshot (whose staged order needn't match the tool's order). The snapshot stays the **display/random-access** tier (`getSnapshot`); the cursor is the **compute/stream** tier. Clean separation, no cross-tier order-consistency problem.
   - **Requires `orderBy` + an `id` tiebreaker in the result.** If absent: `≤HANDLE_ROW_CAP` → fall back to `resolveRecordSource` (materialize; the tool sorts in-memory as today); `>HANDLE_ROW_CAP` → `COMPUTE_INPUT_TOO_LARGE` ("project `id` to stream a >100k reduce, or pre-aggregate"). Never silently mis-orders or truncates.

3. **Two tiers + a separate forward-only API (D2, confirmed).** `getSnapshot(handle,{offset,limit})` unchanged (random-access, ≤100k, ≤5k/call). New `streamHandle(handle): AsyncIterable<Batch>` — forward-only; yields Redis snapshot batches up to 100k, then keyset re-execution batches beyond. Envelope gains `sql`, the resolved `sortKey`, and `cursor: boolean` (true iff a sort key resolved and `rowCount > HANDLE_ROW_CAP`).

4. **`resolveRecordStream` + the `forecast` fold (D3, confirmed; narrowed in implementation).** New `resolveRecordStream(input, consumption): AsyncIterable<ComputeRecord[]>` is the `streaming` branch (parallel to `resolveRecordSource` for inline/`bounded`), and it **guarantees `orderBy` ordering on every path** (cursor via SQL `ORDER BY`; inline/fallback sorted in-memory) since a single-pass fold needs ordered input. `forecast` folds over batches (online Holt-Winters recurrence — `forecastFromStream`). `bounded` tools (`cluster`/`logistic_regression`) are unchanged — their streaming variants are #130/E2.
   - **Discovery's "three reduces" narrowed to one.** `forecast` is the lone fold that both is a true reduce *and* has a realistic >100k caller (an `er__` time series). The other two stay on the `bounded` + `onOverflow:error` path:
     - **`technical_indicator` — a map, not a reduce.** It emits one value per input row (`{ dates, values }`, length ≈ N), so the scaling wall is the O(N) *output* — exactly the "large raw-series output" this spec defers (aggregate-before-render / a `produceFromRows` handle, overlapping #124). Folding the input would move the wall, not remove it. Its >100k story rides the map/output track (per-record `bulk_transform kind:tool` + F job-escalation).
     - **`portfolio_metrics` — a reduce, but no realistic >100k caller and two structural blockers.** Its metrics fold to O(1) accumulators, but (a) it has no order column and `maxDrawdown` is path-dependent (the cursor needs a declared `orderBy`), and (b) the optional benchmark is a *second* stream paired positionally — a two-keyset-cursor merge-join, not a fold. And a returns series >100k periods is ~400 years of daily data: no concrete caller. Folding it now would be speculative infra; revisit if a tick/intraday case ever materializes.

5. **Cap semantics (D4, confirmed).** 100k is the *in-memory materialization* threshold, not a processing ceiling; `COMPUTE_INPUT_TOO_LARGE` is demoted to the `bounded` + `onOverflow:error` outcome only. No new global cap: the query bounds N, keyset keeps one batch resident, a per-page `statement_timeout` (`STATEMENT_TIMEOUT_MS`) bounds a runaway page. **Follow-up (F):** a very-large *synchronous* streaming reduce blocks the agent turn; total-work job-escalation is F's machinery, noted not built.

## The envelope + read contract

`QueryHandleEnvelope` (`portal-sql-handle.service.ts:30`) gains:
```ts
sql: string;                 // retained for re-execution (was discarded)
sortKey: string | null;      // resolved deterministic keyset column; null → no cursor
cursor: boolean;             // true iff sortKey != null && rowCount > HANDLE_ROW_CAP
```
`produce` retains `sql`, calls `resolveSortKey`, sets `cursor`. (`sql` lives in Redis under the handle's existing 24h TTL + scoping — it's the agent's own query, no new secret.)

`streamHandle(handleId): AsyncIterable<ComputeRecord[]>`:
1. Page the Redis snapshot in batches (existing `getSnapshot` machinery) up to `min(rowCount, HANDLE_ROW_CAP)`.
2. If `cursor`, continue past 100k by re-executing `SELECT … FROM (<sql>) t WHERE <sortKey> > :last ORDER BY <sortKey> ASC LIMIT :pageSize`, advancing `:last` to the last row's key each page, until a short page. Each page runs under `SET LOCAL statement_timeout = STATEMENT_TIMEOUT_MS`.
3. `null` sortKey ⇒ no step 2; the stream ends at the snapshot (the `bounded` tier owns >100k for un-keyable queries).

## Surface

| File | Change |
|---|---|
| `packages/core/src/contracts/portal-sql.contract.ts` | envelope schema += `sql`, `sortKey`, `cursor` |
| `apps/api/src/services/portal-sql-handle.service.ts` | `produce` retains `sql` + `resolveSortKey` + `cursor`; new `streamHandle` (snapshot batches → keyset re-execution) |
| `apps/api/src/services/portal-sql-handle.service.ts` (or a util) | `resolveSortKey(sql, stationData)` — entity-id case + null fallback |
| `apps/api/src/tools/record-source.ts` | new `resolveRecordStream(input, consumption)`; `streaming` branch delegates to `streamHandle` |
| `apps/api/src/services/analytics.service.ts` | online fold form `forecastFromStream` (`technical_indicator`/`portfolio_metrics` deferred — see Decision 4) |
| `apps/api/src/tools/forecast.tool.ts` | consumes `resolveRecordStream` + folds |
| `packages/core/src/constants/large-data-ops.constants.ts` | doc the 100k as materialization-threshold (no value change) |

## Tests

**Unit**
1. `resolveSortKey` — entity-source SQL → the id column; arbitrary/un-keyable SQL → `null`.
2. `streamHandle` — ≤100k handle yields exactly the snapshot batches, no re-execution (mock the engine; assert no keyset query).
3. `streamHandle` — `cursor` handle yields snapshot batches then keyset pages; advances `:last`; terminates on a short page (mock engine returns ordered pages).
4. `streamHandle` — `sortKey: null` ends at the snapshot (no step 2).
5. `resolveRecordStream` — `streaming` consumption yields batches; small inline/handle still works (ceiling-not-mandate).
6. The `forecast` fold — given a fixture stream, the online form (`forecastFromStream`) equals the whole-array `forecast` (MAPE/forecast values/intervals to 8 decimals), including shuffled-input ordering via `resolveRecordStream`.

**Integration** — split across two halves, each proven where it's cheapest:
7a. *Real keyset SQL* (covered by `portal-sql.service.integration` + the S2 spike): the wrapped `SELECT * FROM (<sql>) WHERE (orderBy, _record_id) > (…) ORDER BY … LIMIT n` returns each row once in keyset order against real Postgres.
7b. *Orchestration + exactness* (`portal-sql-handle.integration`, "#129 streaming fold over a > HANDLE_ROW_CAP handle"): a handle with `rowCount > HANDLE_ROW_CAP` folds end-to-end — produce → `streamHandle` keyset branch → `resolveRecordStream` → `forecastFromStream` — with **no `COMPUTE_INPUT_TOO_LARGE`**, exact to the whole-array `forecast`, one BATCH_SIZE page at a time (asserted via the page-call count + per-call `rowCap`). Real Redis; `runSqlQuery` mocked to serve ordered pages, so it doesn't re-seed/re-prove the keyset SQL of 7a on every run.
8. Keyset stability (the S2 spike, promoted to a test): re-execution across pages over a stable-id source returns each row exactly once (no skips/dups) — including with concurrent inserts to the source (the new rows appear at the tail or not at all, never duplicate an emitted key).

## Acceptance criteria

- [ ] Envelope carries `sql`/`sortKey`/`cursor`; `produce` retains + resolves them.
- [ ] `streamHandle` streams ≤100k from the snapshot and >100k via keyset re-execution; `null` sortKey stops at the snapshot.
- [ ] `resolveRecordStream` feeds the `streaming` mode; `resolveRecordSource` (bounded/inline) unchanged.
- [ ] The `forecast` fold matches the whole-array form over a stream (test 6); `technical_indicator` + `portfolio_metrics` deferred (Decision 4).
- [ ] `COMPUTE_INPUT_TOO_LARGE` only fires for `bounded` + `onOverflow:error` (a `streaming` tool over >100k keyed source succeeds).
- [ ] Integration tests 7a/7b + 8 green; one batch (BATCH_SIZE) per page; keyset exact; >100k handle folds with no `COMPUTE_INPUT_TOO_LARGE`.
- [ ] `npm run test:unit` + `test:integration` + `lint` + `type-check` green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Keyset instability over re-execution** (no deterministic order → skip/dup) — *the headline risk of A* | The S2 spike + test 8 gate it; cursor is **best-effort, gated on a resolvable stable key**; un-keyable SQL falls back to the bounded tier, never silently mis-pages. |
| Non-snapshot-consistency (rows change mid-stream) | By design (matches #92 freshness); a mid-stream insert appears at the tail or not, never duplicates an emitted key (test 8). |
| Long synchronous fold blocks the turn | Realistic-N for series folds is use-case-bounded; total-work job-escalation noted as an F follow-up. |
| Re-execution cost vs the snapshot | The ≤100k hot tier is unchanged; re-execution only for the >100k tail, keyset (O(page) not O(offset)), per-page timeout. |

**Rollback:** revert the merge. The envelope fields are additive; `streamHandle`/`resolveRecordStream` are new and unreferenced after revert; the three tools fall back to `resolveComputeRecords` (bounded). No schema/migration.

## Display of >100k (the boundary — this cursor is compute-only)

**Nothing >100k ever reaches the browser, and the frontend never consumes this cursor.** `streamHandle` is forward-only *server-side* compute. What crosses to the client is always bounded, by block type:

- **Charts** → **aggregate-before-render** (D6 viz-consumer contract): the engine bins/down-samples the >100k result to a renderable cardinality (`GROUP BY`/`width_bucket` — engine-pushdown, no cursor) *before* the spec is built; the client gets a small spec and renders ~thousands of marks. (Also a perceptual necessity, not just scaling.)
- **Tables** → **virtualized windows** over the ≤100k Redis snapshot via `getSnapshot` (random-access, ≤5k/call), optionally live-hydrated by the existing `portal-sql:stream` SSE as `produce` stages rows. The snapshot is capped at `HANDLE_ROW_CAP`, so a >100k result shows the first 100k (`truncated`) with a "sample / refine" affordance — a human never scrolls to row 400k.

This is why D2 keeps **two read APIs**: `getSnapshot` (random-access — the UI table's source) vs `streamHandle` (forward-only — compute's source). A forward cursor can't cheaply serve "rows 50k–55k," so the UI never uses it. **The >100k *display* story is D6 aggregate-before-render (its own viz-consumer slice, consumed by #92/#84), not #129.**

## Out of scope

- **Streaming variants of `bounded` tools** (mini-batch k-means / SGD) — #130/E2.
- **Total-work job-escalation** for huge synchronous folds — F.
- **Remote (webhook) consumption** (#124) and **pin replay** (#92) — consumers built on this.
- **`bulk_transform` re-homing its source read onto the cursor** — F Part A (#131).
- **Large raw-series *output*** (a >100k fitted series as rows) — aggregate-before-render for display; a raw-series output handle overlaps #124's `produceFromRows`.

## Cross-references

- `docs/STREAMABLE_CURSOR_HANDLE.discovery.md` — D1–D4, the #92-resolved consistency question.
- `apps/api/src/services/portal-sql-handle.service.ts` — `produce` / `getSnapshot` (the snapshot tier this extends).
- `apps/api/src/tools/record-source.ts` — `resolveRecordSource` (#121/C; `resolveRecordStream` is its `streaming` sibling).
- #92 (pin replay), #124 (remote adapter), #131 F Part A (`bulk_transform`) — downstream consumers.
