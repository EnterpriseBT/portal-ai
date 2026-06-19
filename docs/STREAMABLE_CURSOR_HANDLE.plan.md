# Streamable cursor-backed handle — Plan

**TDD-sequenced implementation of `docs/STREAMABLE_CURSOR_HANDLE.spec.md`. Five slices, each behind a green suite, each one commit. Backend-only — no frontend, no migration (envelope fields are additive). Slice 2 opens with a spike (keyset stability over re-execution) because that's mechanism A's headline risk; nothing downstream is built until the spike is green.**

Spec: `docs/STREAMABLE_CURSOR_HANDLE.spec.md`. Discovery: `docs/STREAMABLE_CURSOR_HANDLE.discovery.md`. Issue: [#129](https://github.com/EnterpriseBT/portal-ai/issues/129).

Run: `npm run test:unit --workspace=apps/api` / `--workspace=packages/core`; `npm run test:integration --workspace=apps/api`; `npm run lint`; `npm run type-check`. (DB + Redis available for integration.)

Each slice: failing tests → red → smallest change → green → full unit (+ integration when touched) → lint + type-check → commit. The substrate is inert until a tool consumes it, so the system runs fine throughout.

---

## Slice 1 — Envelope + retained `sql` ✅
**Why first.** Everything keys off the retained `sql`; additive schema, no behavior change.

- Edit: `portal-sql.contract.ts` — envelope += `sql` / `sortKey` / `cursor` + a `cursor ⇒ sortKey` coherence guard.
- Edit: `portal-sql-handle.service.ts` — `produce` retains `sql`; `sortKey: null`, `cursor: false` for now.
- Tests: `produce` retains `sql` and reports `sortKey: null` / `cursor: false`; the contract guard (cursor requires a non-null sortKey).

**Boundary note (realized while implementing):** `resolveSortKey` was originally bundled here, but a correct keyset key must be **both unique AND match the order the tool needs** (a `forecast` needs the agent's `ORDER BY ts`, not a uuid `id`) — deriving it (the query's `ORDER BY` + a unique tiebreaker) is inseparable from validating its keyset stability. So **resolution moves to slice 2 with the spike.** Slice 1 ships the envelope + `sql` retention; `cursor` stays `false` everywhere (behavior unchanged — every handle is the ≤100k snapshot it is today).

**Done when:** envelopes carry `sql`/`sortKey`/`cursor`; nothing reads them yet. *(done)*

## Slice 2 — Spike → `resolveSortKey` → the keyset read path + `streamHandle`
**Why a spike first.** Keyset over a *re-executed* query is A's load-bearing risk, and the key design is part of it. **Spike (key design + stability together):** derive the keyset key from the query's `ORDER BY` + a unique tiebreaker (append the source id); stage a >100k `er__` source; re-execute `… WHERE (<key>) > :last ORDER BY <key> LIMIT n` page-by-page; assert every row once, in the query's order, no skips/dups, including under concurrent inserts (rows appear at the tail or not at all). If it fails for the entity-source case, stop and escalate — the mechanism needs rework before building on it.
- New: `resolveSortKey(sql, schema)` — derive the ordered unique keyset key (ORDER BY + tiebreaker); `null` when none resolves. `produce` calls it and sets `cursor`.

- New: `streamHandle(handleId): AsyncIterable<ComputeRecord[]>` — Redis snapshot batches up to 100k, then (if `cursor`) keyset re-execution under a per-page `statement_timeout`, advancing `:last`, terminating on a short page; `null` sortKey stops at the snapshot.
- Tests: spec unit 2–4 (snapshot-only; cursor pages; null stops) + integration 7–8 (real >100k stream, one batch resident; keyset exactness = the promoted spike).

**Done when:** `streamHandle` streams ≤100k and >100k exactly; the spike/test 8 is green.

## Slice 3 — `resolveRecordStream` (the `streaming` consumption branch)
- Edit: `record-source.ts` — `resolveRecordStream(input, consumption)` delegating to `streamHandle`; small inline/handle still works (ceiling-not-mandate); `resolveRecordSource` (bounded/inline) untouched.
- Tests: spec unit 5.

**Done when:** the `streaming` mode yields batches; bounded/inline unchanged.

## Slice 4 — Fold the single-pass reduces
**Per-tool, green each (the bulk of the work).** For `forecast` and `portfolio_metrics`: add an online/fold form to `AnalyticsService` (accumulator across batches — Holt-Winters recurrence; cumulative/streamed covariance); the tool consumes `resolveRecordStream` and folds. `resolveRecordStream` also gains an order guarantee on every path (a fold needs ordered input).

**`technical_indicator` deferred (refinement during implementation).** It was bucketed here, but it's a **map** — `{ dates, values }`, one output per input row — so folding its input doesn't scale it (the O(N) *output* is the wall, and large raw-series output is explicitly deferred to aggregate-before-render / a `produceFromRows` handle). It stays on the bounded path; its >100k story rides the map/output track (per-record `bulk_transform kind:tool` + F job-escalation). See spec Decision 4.

- Edit: `analytics.service.ts` (online forms) + `forecast.tool.ts` / `portfolio-metrics.tool.ts`; `record-source.ts` (order guarantee); `builtin-toolpacks.ts` (`streamingReduce` capability).
- Tests: spec unit 6 — online form equals the whole-array result on a fixture stream, one tool at a time (forecast proven incl. shuffled-input ordering).

**Done when:** the reduce folds (`forecast`, `portfolio_metrics`) are exact over a stream; results match today's whole-array output.

## Slice 5 — Cap-semantics cleanup + the exactness lock
**Why last.** Once streaming is wired, demote the wall and prove unbounded exactness.

- Edit: `resolveRecordSource`/`record-source.ts` — `COMPUTE_INPUT_TOO_LARGE` fires only for `bounded` + `onOverflow:error`; a `streaming` tool over a >100k keyed source no longer errors.
- Edit: `large-data-ops.constants.ts` — doc 100k as the in-memory-materialization threshold (no value change).
- New/extend: integration test — `forecast` over a >100k `er__` source returns the exact forward fit (no `COMPUTE_INPUT_TOO_LARGE`), bounded memory.

**Done when:** `streaming`/`engine-pushdown` never hit the wall; `bounded` still does; the >100k exactness integration test is green.

---

## Sequencing notes

- **Slice 2's spike gates the feature** — if keyset can't be made stable over re-execution for the entity-source case, the mechanism (A) needs rework before slices 3–5. This is the one place the plan can bounce.
- **The cursor is best-effort** — un-keyable SQL (`sortKey: null`) falls back to the bounded tier throughout; no slice assumes every query is cursorable.
- **Consumers are out of scope** — #124 (remote), #92 (pin replay), F Part A (`bulk_transform` source read) build on `streamHandle`/`resolveRecordStream` after this lands.
- After slice 5, open/refresh the PR with `Closes #129`; discovery + spec + plan + five implementation commits sit on `feat/streamable-cursor-handle`.
