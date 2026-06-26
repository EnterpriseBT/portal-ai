# Transform handle — streaming `technical_indicator` into a re-foldable handle

Issue: [#159](https://github.com/EnterpriseBT/portal-ai/issues/159). Umbrella: #121. Predecessor: #152 (which left `technical_indicator` bounded(100k) and filed this).

## Problem

`technical_indicator` is a per-row **map** (N rows → N aligned indicator values), not a reduce. Unlike `forecast`/`portfolio_metrics` (true reduces that fold to a bounded summary), its output is O(N) — it can't be returned inline past a small N, and it can't fold to a scalar. #152 corrected its capability to a bounded `map`/`data-table` and capped it at 100k with `onOverflow: error` — so today a >100k series throws `COMPUTE_INPUT_TOO_LARGE` and the agent gets nothing.

The naive fix — stream the input, materialize the output via `produceFromRows` — fails: `produceFromRows` stages a *static* row set in Redis capped at `HANDLE_ROW_CAP` (100k) and is **not** cursor-backed, so a >100k series would have to be lossily collapsed (and head-truncation drops the most recent values — backwards for technical analysis).

## Key insight

The indicator series is a **pure, deterministic transform of an already cursor-backed source handle**. So the output never needs to be materialized whole — it can be a **cursor-backed transform handle** that re-executes the fold over the source on demand, exactly as a `sql_query` handle re-executes its SQL past the snapshot. No cap, no collapse, bounded memory, full series preserved.

## Design

A transform handle is symmetric with the existing `produce`: a handle whose re-execution mechanism is "re-fold the source through the indicator" instead of "re-run SQL."

`PortalSqlHandleService.produceFromTransform({ sourceHandle, transform, stationId, organizationId })`:

- **Production pass** — one streaming pass over `streamHandle(sourceHandle, dateColumn)`, feeding each row through the indicator's online `nextValue` fold, emitting output rows. Stage the first ≤`HANDLE_ROW_CAP` as the Redis snapshot + SSE broadcast (exactly like `produce`); record the full output `rowCount`, `schema` (from the first output row), and `samplePeek`.
- **Re-execution descriptor** — store a `_transform` block in the stored meta (in place of `sql`): `{ sourceHandle, indicator, params, dateColumn }`.
- **`streamHandle` >cap branch** — if `_transform` is present, re-stream the source through the fold (the unbounded path) rather than re-running SQL. *This is the only genuinely new mechanism.*
- **`getSnapshot` / SSE / `getMeta`** — unchanged; they read the staged snapshot, so the agent envelope, the chart renderer, and downstream folds all consume it identically to any handle.

### The online fold engine

The `technicalindicators` library (already used by the array path) exposes a `.nextValue(input)` streaming method on every indicator class in use — instantiate once, call per row, bounded internal state. So **no indicator math is reimplemented**; the streaming path stays bit-faithful to the array path. Donchian is hand-rolled in the array path (no library class), so it gets an online ring buffer of size `period`.

Input shapes for `nextValue`: `number` (SMA, EMA, RSI, MACD, BB, WilliamsR, ROC), `{high,low,close,volume}` (ATR, OBV, Stochastic, ADX, VWAP, CCI), `{high,low}` (Ichimoku, Donchian, PSAR). Outputs are scalar or object (MACD, BB, Stochastic, ADX, Ichimoku, Donchian → multi-column output rows).

## Decisions

1. **Cursor-backed transform handle, not static materialization** (#159 direction). Dissolves the 100k cap + the lossy-collapse dilemma. (Static `produceFromRows` rejected; entity-materialization — the reconciled-away `bulk_materialize` — is a larger separate effort if durable random-access is ever needed.)
2. **Inline small-N, handle past threshold.** ≤ `INLINE_ROWS_THRESHOLD` rows return today's `{ dates, values }` (backward-compatible with existing charting + tests); above it, a transform handle. Mirrors `sql_query`'s inline→handle auto-switch.
3. **`nextValue` over reimplementation.** Reuse the library's streaming API; stay faithful to the array path, cross-checked in tests.
4. **TTL coupling, accepted.** A transform handle is live only while its source handle is (shared 24h TTL); past the snapshot, re-fold requires the source re-executable. Documented, not worked around.

## Integration points

- `PortalSqlHandleService` — new `produceFromTransform`; `_transform` field on `StoredHandleMeta`; `streamHandle` >cap branch.
- New online fold engine module (the per-indicator `nextValue` drivers + Donchian ring buffer).
- `technical_indicator` tool — inline/handle switch; produce a transform handle past threshold.
- Capability (`builtin-toolpacks.ts`), spec §162, mirror description — kept in sync.

## Acceptance

A `technical_indicator` over a >100k source returns a transform handle (no `COMPUTE_INPUT_TOO_LARGE`); the handle re-folds the full series exactly (cross-checked vs the array path) in bounded memory; ≤ threshold stays inline `{ dates, values }`.
