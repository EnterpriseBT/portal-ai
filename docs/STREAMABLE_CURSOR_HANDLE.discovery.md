# Streamable cursor-backed handle — Discovery

**Issue:** [EnterpriseBT/portal-ai#129](https://github.com/EnterpriseBT/portal-ai/issues/129)

**Why this exists.** A query handle today is a **≤ `HANDLE_ROW_CAP` (100k) Redis snapshot**: `produce(sql)` runs the query, stages up to 100k rows in Redis batches, and `getSnapshot(handle,{offset,limit})` pages them back. Past 100k the result is `truncated` and compute hard-errors. The #121 taxonomy declared a `streaming` consumption mode — "exact at any N over a batch stream" — but **nothing feeds it**: `resolveRecordSource` materializes the ≤100k snapshot or applies `onOverflow`. This is the **in-process dataset-scaling substrate** that makes the `streaming` mode real: a handle that can stream the *full* result past 100k, one batch at a time, so a single-pass reduce (Holt-Winters, EMA, cumulative returns) is exact at any N. Per the "one substrate, two localities" framing (`docs/WEBHOOK_COMPUTE_SCALING.discovery.md`), this is the shared substrate built **first**; #124 is later a thin remote adapter over the *same* cursor.

## The current shape

- **`produce(opts: { stationId, organizationId, sql })`** (`portal-sql-handle.service.ts:90`) → runs `PortalSqlService.runSqlQuery({ sql, rowCap: HANDLE_ROW_CAP })`, stages rows in Redis batches of 1 000, returns a `QueryHandleEnvelope { queryHandle, rowCount, schema, sampled, truncated, samplePeek }`. **The `sql` is *not* retained on the envelope** — the snapshot is all that survives.
- **`getSnapshot(handle, { offset, limit })`** (`:220`) → reads batches from Redis; `limit` capped at 5 000/call; never returns more than `produce` staged (≤100k).
- **`resolveRecordSource(input, consumption)`** (#121/C, `record-source.ts:79`) → for `streaming`/over-cap it currently throws "ships in #129" (this is the stub we fill); `bounded` samples/errors in-memory.
- **`HANDLE_ROW_CAP` / `COMPUTE_MAX_ROWS` = 100 000** (`large-data-ops.constants.ts`); 24 h TTL on the Redis batches.
- **Streaming-reduce tools** (`forecast`, `technical_indicator`, `portfolio_metrics`) are declared `streaming` (#121 spike) but run today over the ≤100k snapshot via `resolveComputeRecords`. Their algorithms are **already single-pass** (Holt-Winters recurrence, EMA recurrence, cumulative product) — naturally streamable.

## The design space

### Decision 1 — The cursor mechanism (the crux)
How does the handle deliver rows *past* the 100k snapshot? Constraints from the current model: **24 h TTL**, **multiple API processes** (no process affinity), and a Redis-snapshot hot tier already in place.

**A. Re-execute + keyset.** Retain the `sql` (+ a stable sort key) on the envelope; for reads past the snapshot, re-run the query wrapped `… ORDER BY <key> WHERE <key> > :last LIMIT :n` and page forward. **B. Long-lived Postgres cursor.** `DECLARE CURSOR` in a held transaction; `FETCH` per page. **C. Unlogged materialized table.** `CREATE UNLOGGED TABLE qh_<id> AS <sql>` at produce time; keyset-page from it; drop on TTL/GC.

| | A re-execute + keyset | B long-lived cursor | C unlogged table |
|---|---|---|---|
| Survives 24 h TTL / multi-process | **yes** (stateless) | no (pins a conn + txn) | yes (a real-ish table) |
| Held DB resources | none | a connection + open txn per handle | disk for the full set + GC |
| Snapshot-consistent across pages | no (re-reads live data) | yes | yes |
| Efficient forward paging | yes (keyset, not OFFSET) | yes | yes (keyset) |
| New machinery | retain sql + sort key; wrap query | cursor lifecycle + leak mgmt | table create/drop + GC sweep |

**Lean: A (re-execute + keyset).** It fits the existing model with the least new machinery: stateless, so it survives the 24 h TTL and horizontal scaling with **no held connections** (B's fatal flaw here) and **no disk staging + GC** (C's cost). The price — non-snapshot-consistency across pages (it re-reads live data) — is acceptable because the streaming-reduce use case is a *forward pass*, and the existing ≤100k snapshot is *already* a point-in-time read. Keyset (not `OFFSET`) keeps deep paging O(page), not O(offset). **B** is ruled out by the TTL/multi-process model.

**#92 (trace-based pins) settles this against C — and validates A.** #92's chosen model is *live re-executing pins*: a pin saves the data **pipeline** (the SQL/tool trace) and **re-runs it on view** for fresh data ("open it Friday, see Friday's data"); the frozen-snapshot mode is explicitly deferred. That is the *same primitive as A* — retain the spec, re-execute — at a different scope: **A's cursor is the single-SQL case; a #92 pin is the multi-step-trace case** (the handle's retained `sql` is a length-1 trace; #92 generalizes it). So A's "non-snapshot-consistency" is not a cost here — it is exactly the freshness #92 promises, and **C (a frozen materialized table) would give pins the wrong semantics**, contradicting #92's contract. #92 is therefore a *second consumer* of A's re-execution substrate (a pin whose pipeline produces >100k feeds the same cursor server-side, then aggregate-before-renders), not a reason to prefer C.

### Decision 2 — What the substrate exposes
The ≤100k Redis snapshot stays the **cheap hot tier**; the cursor is the **unbounded tier**, engaged only when `rowCount > HANDLE_ROW_CAP`. The envelope gains what re-execution needs: the `sql`, a resolved **stable sort key** (a unique/ordered column — fall back to a synthesized row-number ordering if none), and a `cursor: true` flag. A new read path — `streamHandle(handle): AsyncIterable<Batch>` (or `getSnapshot` extended past the cap) — pages: Redis batches up to 100k, then keyset re-execution beyond. **Lean:** add an async-iterable `streamHandle` rather than overload `getSnapshot` (snapshot stays the bounded random-access API; streaming is forward-only).

### Decision 3 — How streaming-reduce tools consume it
`resolveRecordSource` gains a `streaming` path: instead of returning a materialized array, expose the cursor as a batch stream the tool folds. The three streaming tools need an **online/single-pass form** of their `AnalyticsService` method (fold over batches) rather than the current whole-array call. **Lean:** add `resolveRecordStream(input, consumption): AsyncIterable<ComputeRecord[]>`; wire `forecast`/`technical_indicator`/`portfolio_metrics` to fold over it — their recurrences are already single-pass, so the refactor is mechanical. `bounded` tools (`cluster`/`logistic`) stay materialized + `onOverflow` (the exact-unbounded streaming variants are #130/E2, out of scope here).

### Decision 4 — Cap semantics + cost
100k stays the in-memory materialization threshold; the cursor is the unbounded processing tier, so `COMPUTE_INPUT_TOO_LARGE` stops being a hard wall for `streaming`/`engine-pushdown` tools (it remains the `bounded` `onOverflow:error` outcome). A cursor read re-runs the query with a `statement_timeout` per page (reuse `STATEMENT_TIMEOUT_MS`); a runaway is bounded per page, not unbounded. **Lean:** no new global cap — N is bounded by the query, paging by the keyset; surface a per-page timeout, never hang.

## Tradeoff comparison

|  | D1 re-execute+keyset | D2 streamHandle | D3 resolveRecordStream | D4 cap semantics |
|---|---|---|---|---|
| Spreads to spec | the envelope (sql+sortKey) + the wrapped query | the async-iterable read API | the streaming record path + 3 tool refactors | timeout per page |
| New infra | retain sql + sort-key resolution | forward-only iterator | online folds | reuse `STATEMENT_TIMEOUT_MS` |
| Shared with #124 | the cursor IS the substrate | the read API #124's endpoint wraps | — | — |

## Recommendation

1. **Re-execute + keyset** for the unbounded tier (D1): retain `sql` + a resolved stable sort key on the envelope; page forward with `WHERE <key> > :last ORDER BY <key> LIMIT :n` past the 100k snapshot.
2. **Keep the ≤100k Redis snapshot as the hot tier**; add a forward-only `streamHandle` async-iterable for the unbounded tier (D2).
3. **`resolveRecordStream`** feeds the `streaming` consumption mode; wire the three single-pass reduce tools to fold over batches (D3).
4. **No new global cap** — the cursor makes `streaming` exact at any N; per-page `statement_timeout` bounds runaways (D4).
5. **Deliverable: spec + plan** — slices: (a) envelope gains `sql`+sortKey + `produce` retains them; (b) keyset re-execution read path + `streamHandle`; (c) `resolveRecordStream` + the `streaming` branch of `resolveRecordSource`; (d) wire `forecast`/`technical_indicator`/`portfolio_metrics` to fold over the stream; (e) an integration test over a > 100k dataset proving exactness + bounded memory.

## Open questions

1. **Concrete consumers to anchor this.** Several, now: (a) the builtin streaming reduces (`forecast`/`technical_indicator`/`portfolio_metrics`) over >100k ordered points; (b) **#92 trace-based pins** — a pin re-executes its SQL/tool pipeline on view, so a pin over a >100k pipeline streams server-side through this cursor; (c) **`bulk_transform`'s worker source-read** — it batch-reads its source entity through a bespoke loop today, the cleanest *internal* first consumer to fold onto `resolveRecordStream` (F Part A / #131); (d) #124's remote pull-on-read (later). **The substrate has real callers; A's re-execution primitive is shared across all of them.** (`bulk_aggregate` is the *contrast* — engine-pushdown, the engine reduces set-wise, so it does **not** use the cursor.) A product gut-check on >100k pin/forecast frequency still sharpens priority, but this is no longer a one-consumer bet.
2. **Resolved by #92 — non-snapshot-consistency is desired, not a bug.** A's re-read-live-data behavior *is* the freshness #92's live pins promise; C (frozen table) is the option-3 snapshot mode #92 deferred. So we **accept it as a feature** and do not switch to C. (Strict point-in-time consistency is a separate, compliance-only concern — #92's deferred snapshot mode — out of scope here.)
3. **The stable sort key when the query has no unique column.** **Lean: synthesize `row_number() OVER (<the query's order, else ctid>)` as the keyset key** — deterministic within a single re-execution; degrades gracefully.
4. **Memory bound during a streaming fold.** **Lean: one batch (≤ page size) resident at a time** — the tool folds and discards; that's the whole point of streaming vs materializing.

## What this doesn't decide

- **The remote (webhook) transport** (#124) — it *consumes* this cursor via an authed endpoint; built after, as the adapter.
- **The trace-based pin replay engine** (#92) — it *consumes* this substrate (a pin re-executes its pipeline; a >100k pipeline streams through this cursor). #92 owns the trace shape, replay interpreter, and pin surface; this only provides the re-execution substrate its single-SQL case rides on.
- **Streaming variants of `bounded` tools** (mini-batch k-means / SGD logit) — #130/E2; this only wires the *already-single-pass* reduces.
- **The reduce-tier shrink + engine-pushdown** (#130/E) — orthogonal; this is the escape-hatch streaming path, not the SQL-pushed majority.
- **Display of >100k** — humans don't read 100k rows; the table widget still virtualizes the ≤100k snapshot. The cursor is for *compute*, not display.

## Next step

Confirm Open Q1 (the anchor caller), then write `docs/STREAMABLE_CURSOR_HANDLE.spec.md` (the envelope `sql`+sortKey additions; the keyset re-execution contract; `streamHandle` + `resolveRecordStream`; the streaming-reduce fold) and `docs/STREAMABLE_CURSOR_HANDLE.plan.md` slicing per Recommendation §5 — the keyset read path isolated with an over-100k integration test, the three tool refactors each green on their own.
