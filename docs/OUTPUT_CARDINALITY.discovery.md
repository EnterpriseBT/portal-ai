# Symmetric output-cardinality surface — discovery

Issue: [#161](https://github.com/EnterpriseBT/portal-ai/issues/161). Umbrella: #121. Precedents: #159 (compute→handle), #152 (streaming-in), the job-result-is-a-handle pattern.

> **Sequencing note.** #161 documents itself as *blocked on #159 + #153*, to abstract from two concrete precedents. #159 is merged; **#153 is not built**. We are proceeding ahead of #153 by deliberate choice (it shapes #153's output rather than the reverse). This discovery therefore abstracts from the **one** built precedent (#159's transform handle) + the four hand-coded sinks, and treats #153's known output shapes as a *forward design input* (k-means → O(N) per-point assignments = rows/handle; logistic regression → scalar coefficients = value/inline). The risk — abstracting from one instance — is mitigated by designing the surface to fit #153's shapes up front; the spec must re-validate once #153's exact result types exist.

## The asymmetry today

Input cardinality has both halves of a clean interface; output cardinality has neither.

| | Declaration | Resolver |
|---|---|---|
| **Input** | `consumption: none \| engine-pushdown \| streaming \| bounded` (+ `maxRows`/`onOverflow`) on `ToolCapability` (`tool-capability.model.ts`) | `record-source.ts` — `resolveRecordSource`/`resolveRecordStream` pick inline `rows[]` / handle snapshot / cursor by observed N, bounded by the declaration |
| **Output** | **none.** `resultKind` is render-category only (its sole consumer is `resolveDisplayBlock` in `portal.service.ts`); it never affects delivery | **none.** Each tool open-codes `countRows() > INLINE_ROWS_THRESHOLD → produce()`: `sql-query.tool.ts:182`, `visualize.tool.ts:70`, `visualize-tree.tool.ts:69`, `display-entity-records.tool.ts:68` — four copies; #159 added a fifth shape (`technical_indicator`) |

`resultKind` (render) and output cardinality (delivery) are **orthogonal**: a `rows` output may render as `data-table`, `vega-lite`, `vega`, `geo`… Delivery is "inline value vs handle vs job-wrapped"; render is "how the UI draws it." This discovery adds the delivery half; it does **not** touch `resultKind`.

## Handle-production surface today

- `PortalSqlHandleService.produce(sql)` — runs SQL, stages a ≤cap snapshot, retains `sql` → **cursor-backed** (re-executable, unbounded).
- `produceFromRows(rows[])` — a static caller array, snapshot-only, `sql: null` → **capped at `HANDLE_ROW_CAP`** (not re-executable).
- `produceFromTransform({sourceHandle, transform})` (#159) — a deterministic fold over a source handle, `_transform` descriptor → **cursor-backed via re-fold**, unbounded.
- Job result **is** a handle: `SqlQueryJobResultSchema = QueryHandleEnvelopeSchema` (`job.model.ts:417`). Job is an orthogonal *wrapper* around an output mode, not a mode.

Gap the issue names: there is no generic "handle from a one-shot compute stream" — `produceFromStream`. But note (refining the issue's strawman): a *re-foldable* output (a pure function of a source handle, like every compute tool) is better served by `produceFromTransform` (unbounded, re-executable) than by a snapshot-only `produceFromStream`. `produceFromStream` earns its place only for **non-re-foldable** outputs (e.g. a webhook's one-shot result) — it avoids caller-side materialization but stays snapshot-capped. So we have **two** output-handle mechanisms, picked by re-foldability, not one.

## Design

### 1. `production` declaration — the mirror of `consumption`

On `ToolCapability`:

```ts
production:
  | { kind: "value" }                                  // cardinality 1 — always inline
  | { kind: "rows"; onLarge: "handle" | "sample" | "error"; inlineThreshold?: number }
```

- `value` — inherently scalar (most reduces, pure-math): always inline, never a handle. (`forecast`, `portfolio_metrics`, `npv`, `regression`, …)
- `rows` — a row set that may be large: inline ≤ `inlineThreshold` (default `INLINE_ROWS_THRESHOLD` = 100), else `onLarge`. (`sql_query`, `display_entity_records`, `visualize*`, `technical_indicator`.)
- Refinement (mirrors `consumption`'s): `value` forbids `onLarge`/`inlineThreshold`; `rows` requires `onLarge`.

**Open question (spec):** is `production` *derivable* from `resultKind` + `computeShape` (e.g. `scalar`/`mutation-result` → `value`; `data-table`/`vega*`/`geo` → `rows`), making it a computed projection rather than a new declared field? Leaning **explicit field** — `onLarge` (sample vs error vs handle) is a real per-tool policy choice `resultKind` can't carry — but the redundancy is worth resolving in spec.

### 2. `resolveResultSink` — the mirror of `record-source.ts`

One resolver tools hand their output to; it returns either the inline result or `{ type, ...envelope }`, choosing by observed N + declared `production` + station/org:

```ts
resolveResultSink(production, sink, ctx) where sink is one of:
  { value }                        // → inline, always
  { rows: AsyncIterable<rows[]> }  // one-shot → inline ≤threshold, else produceFromStream (snapshot)
  { transform: TransformDescriptor } // re-foldable → inline if source ≤threshold, else produceFromTransform (#159)
```

Collapses the four hand-coded checks + #159's switch into one place. `onLarge: "error"` throws past the threshold (no handle); `"sample"` reservoir-samples (flagged) — symmetric with input's `onOverflow`.

### 3. `produceFromStream(AsyncIterable<rows[]>)`

The generic one-shot compute→handle: drain the stream, stage ≤cap snapshot, `sql: null` (snapshot-only, not re-executable). The streaming-in counterpart to `produceFromRows` — avoids caller materialization but stays capped. Re-foldable outputs use `produceFromTransform` instead (the resolver picks).

### 4. Job as an orthogonal wrapper

Generalize the `sql_query` precedent: any output mode can be produced on the job tier; the job's `result` is the handle envelope. Not a `production.kind`. Out of scope to *implement* broadly here, but the surface must not preclude it.

### 5. Stream-to-client

**Decided: not a real output mode.** Streaming raw rows into an LLM tool-caller's context is the wrong default; "stream to the user" already = "handle + the existing per-handle hydration SSE." `production` has no `stream` kind.

## Decisions

1. **`production` is the output mirror of `consumption`** — a declared field + a shared resolver, not per-tool improvisation.
2. **Two handle mechanisms, picked by re-foldability** — `produceFromTransform` (re-foldable, unbounded) vs `produceFromStream` (one-shot, snapshot-capped). The issue's single `produceFromStream` strawman is split.
3. **`production` ⟂ `resultKind`** — delivery vs render stay separate (pending the "derivable?" open question).
4. **Job = wrapper, not mode.** **Stream-to-client = handle + SSE, not a mode.**

## Migration (for the plan)

Declare `production` on every built-in tool; refactor the four sinks + `technical_indicator` (#159) onto `resolveResultSink`; add `produceFromStream`; a guard test that no tool open-codes a threshold check. #153's k-means/logistic declare `production` from the start.

## Acceptance

Any (input-mode × output-mode) combination is expressible through the declared surface; the four hand-coded sinks + #159 route through one resolver; a `value` tool can never mint a handle and a `rows` tool past threshold always does (per `onLarge`).
