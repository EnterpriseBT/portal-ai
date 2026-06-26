# Transform handle — plan (phased TDD)

Contract: `docs/TRANSFORM_HANDLE.discovery.md`. Issue: #159. One branch, one PR; a commit per phase.

Per-phase loop: failing test → red → smallest change → green → `lint` + `type-check` → commit.

## Phase 1 — core: `produceFromTransform` + re-fold `streamHandle`
**Ships:** `PortalSqlHandleService.produceFromTransform({ sourceHandle, transform, stationId, organizationId })`; a `_transform` descriptor on `StoredHandleMeta`; the `streamHandle` >cap branch that re-folds the source when `_transform` is present (in place of re-running `sql`). The fold itself is injected (a `(stream) => AsyncGenerator<rows>` callback) so this phase is engine-agnostic and unit-testable with a trivial fake transform.
**Done when:** producing from a fake transform over a small fake source stages a snapshot + envelope; `streamHandle` over a >cap fake source re-folds the full set in `(orderBy,id)` order, bounded memory; `getSnapshot`/`getMeta` read it like any handle.

## Phase 2 — the online indicator fold engine
**Ships:** a module driving the `technicalindicators` `.nextValue` API for the 16 indicators (Donchian via an online ring buffer), emitting one output row per input row past warmup. One indicator at a time, each cross-checked for equality against the existing array `AnalyticsService.technicalIndicator` over the same fixture.
**Done when:** every indicator's streamed output equals the array path's `{ dates, values }` row-for-row (within float tolerance for the recursive ones).

## Phase 3 — rewire the tool + capability + docs + scale test
**Ships:** `technical_indicator` resolves its input via `resolveRecordStream` ordered by `dateColumn`; ≤ `INLINE_ROWS_THRESHOLD` rows return inline `{ dates, values }` (unchanged), above it `produceFromTransform` → `{ type: "data-table", ...envelope }`. Capability flips to streaming `map` / `data-table` (still emits a handle). `builtin-toolpacks` mirror + spec §162 + the system prompt (if it names the tool) updated. Integration test: a 120k source → transform handle, re-fold equals the array oracle, one keyset page at a time.
**Done when:** acceptance (discovery) holds; full unit + the new integration test green; no `COMPUTE_INPUT_TOO_LARGE` past 100k.

## Risks
- **Source TTL** — re-fold past the snapshot needs the source live + re-executable; accepted (shared 24h TTL), surfaced as `READ_HANDLE_EXPIRED`.
- **`nextValue` parity** — a few indicators (ADX/PSAR/Ichimoku/Stochastic) are stateful; Phase 2's per-indicator equality cross-check is the guard.
- **Core-service blast radius** — Phase 1 touches `PortalSqlHandleService`; the injected-fold design keeps the change small and the SQL path untouched (the >cap branch only diverges when `_transform` is set).
