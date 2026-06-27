# Symmetric output-cardinality surface — spec

Issue: [#161](https://github.com/EnterpriseBT/portal-ai/issues/161). Discovery: `docs/OUTPUT_CARDINALITY.discovery.md`. Umbrella: #121.

**Binding contract for the output-cardinality surface.** Input cardinality declares `consumption` and resolves it through `record-source.ts`; this adds the symmetric output half — a declared `production` + a `resolveResultSink` resolver + a generic compute→handle mechanism — plus the documentation that makes the contract discoverable. **This ticket ships the surface + docs; the per-tool conversions are a follow-up** (the four hand-coded sinks + `technical_indicator` keep working as-is until then).

## 1. `production` — the declaration (explicit, not derived)

A new required field on `ToolCapability` (`packages/core/src/models/tool-capability.model.ts`), the mirror of `consumption`. It is **declared, never inferred from `resultKind`** (decision): `onLarge` is a per-tool policy `resultKind` can't carry, and explicit declaration is the symmetry the ticket targets.

```ts
export const ProductionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value") }),
  z.object({
    kind: z.literal("rows"),
    onLarge: z.enum(["handle", "sample", "error"]),
    inlineThreshold: z.number().int().positive().optional(), // default INLINE_ROWS_THRESHOLD
  }),
]);
```

- `value` — cardinality 1, always inline, never a handle (scalars, pure-math, mutation acks).
- `rows` — a row set that may be large: inline ≤ `inlineThreshold` (default `INLINE_ROWS_THRESHOLD` = 100), else apply `onLarge`:
  - `handle` — stage a handle (the scaling default for data/charts).
  - `sample` — reservoir-sample to the threshold, flagged in the result (symmetric with input `onOverflow: sample`).
  - `error` — throw `COMPUTE_OUTPUT_TOO_LARGE` (new `ApiCode`).

`production` ⟂ `resultKind`: delivery vs render stay independent. A `rows` output renders per its `resultKind` (`data-table` / `vega-lite` / `vega` / `geo`); a `value` output renders as prose (no block — see §UI).

### Coherence refinements (on `ToolCapabilitySchema`)
- The discriminated union already forbids `onLarge`/`inlineThreshold` on `value` and requires `onLarge` on `rows`.
- `resultKind: "scalar"` ⟺ `production.kind: "value"` (a scalar render must be value-delivered; a value must render scalar/mutation). `mutation-result` ⇒ `value`. Cross-checked so the two axes can't contradict.
- Backfill: **every built-in capability declares `production`** (the field is required). Type-checks + the `tool-capabilities` coherence suite enforce presence.

## 2. `resolveResultSink` — the resolver (mirror of `record-source.ts`)

New module `apps/api/src/tools/result-sink.ts`. A tool hands its output + its `production` + station/org context; the resolver returns the agent-facing result — an inline value/rows, or a handle envelope `{ type: "data-table", ...envelope }`.

```ts
type ResultSink =
  | { value: unknown }                                  // production.kind "value"
  | { rows: AsyncIterable<Record<string, unknown>[]> }  // one-shot row stream
  | { transform: TransformDescriptor };                 // re-foldable (a fn of a source handle)

resolveResultSink(production, sink, ctx): Promise<unknown>
```

- `{ value }` → returned inline, always. (Asserts `production.kind === "value"`.)
- `{ rows }` → buffer up to `inlineThreshold + 1`: if it fits, return `{ rows }` inline; else apply `onLarge` — `handle` → drain into `produceFromStream`; `sample` → reservoir-sample (flagged); `error` → throw.
- `{ transform }` → peek the source `rowCount` (`getMeta`): ≤ threshold → materialize + compute inline; else `produceFromTransform` (#159, cursor-backed, **unbounded**).

The two handle mechanisms are picked here by re-foldability — `transform` ⇒ unbounded `produceFromTransform`; `rows` ⇒ snapshot-only `produceFromStream`. This is the one place the inline-vs-handle decision lives; the four hand-coded checks + #159's switch collapse into it (in the follow-up).

## 3. `produceFromStream` — generic one-shot compute→handle

New on `PortalSqlHandleService`: `produceFromStream(opts: { rows: AsyncIterable<Record<string,unknown>[]>; schema?; stationId; organizationId })`. Drains the stream staging the first ≤ `HANDLE_ROW_CAP` rows as the snapshot (+ SSE) and counting the rest; `sql: null` (snapshot-only, not re-executable — the streaming-in counterpart to `produceFromRows`, no caller-side materialization). Re-foldable outputs use `produceFromTransform` instead.

## 4. Job as an orthogonal wrapper

No `production.kind: "job"`. A job's `result` is the handle envelope (precedent: `SqlQueryJobResultSchema = QueryHandleEnvelopeSchema`). The surface must not preclude producing any output mode on the job tier; generalizing the job wrapper broadly is out of scope here.

## 5. Stream-to-client — not a mode

Decided: streaming raw rows into an LLM tool-caller is the wrong default. "Stream to the user" = handle + the existing per-handle hydration SSE. No `stream` kind.

## 6. UI display (no web change required)

`production` needs no new rendering. `resolveDisplayBlock` (`portal.service.ts`) + `QueryResultDataBlock` (`apps/web`) already render inline-rows **and** a hydrated handle for the same `resultKind`, by sniffing `queryHandle`:

| Output | Result shape | User sees |
|---|---|---|
| `value` | the value | No widget — agent answers in prose (`resultKind: scalar` → no block) |
| `rows` inline | `{ rows }` / array | table from embedded rows (or rows inlined into the Vega spec) |
| `rows` handle | `{ type:"data-table", queryHandle, … }` | `QueryResultDataBlock` hydrates via `sdk.portalSql.handleSnapshot`; rows never enter agent context |
| job-wrapped | terminal result = handle envelope | `BulkJobProgressBlock` live, then renders as the handle row |

`resolveResultSink` only emits the right shape; the render layer is unchanged (child G/H).

## 7. Documentation surface (shipped in this ticket)

- **Custom-tool authors** — `docs/CUSTOM_TOOLPACK_INTEGRATION.md` §`capability`: add a `production` row to the declarable-subset table + an example. State the subset rule (below).
- **Custom-pack output transport (decouple the write-grant from streaming input).** Today the output write-grant (`{ output: { writeUrl, writeToken } }` → `{ resultHandle }`) is minted **only** inside the `streaming`-input branch (`webhook.tool.ts:140`), so a custom tool can stage a large output only if its *input* is also streaming. That coupling contradicts #161's premise that the two axes are independent. **The write-grant must be driven by `production`, not `consumption`:** whenever a custom tool declares `production: { kind: "rows", onLarge: "handle" }`, the runtime body carries an `output` grant — for *any* input mode (`none` / `bounded` / `streaming`). The existing stage→`resultHandle` round-trip (`buildOutputGrant`, `webhook-read-token.service`) is reused; only the *gating* moves from "streaming input" to "handle output." (This wiring is the custom-tool half of the output surface — in `#161`, not the built-in migration follow-up.)
- **Custom-pack subset rule** — `customToolCapabilityError` (`tool-capability.model.ts`) validates `production`: `value` and `rows` allowed for any input mode; `onLarge: "sample"`/`"error"` need no transport; `onLarge: "handle"` is allowed regardless of `consumption.mode` (the runtime supplies the write-grant from `production`). Rejected combinations surface `TOOLPACK_CAPABILITY_INVALID` with a named reason. (No `production` declared ⇒ legacy inline `value`.)
- **Registration UI** — `RegisterToolpackDialog` / `ToolpackMetadataModal` (`apps/web`) helper text references `production` so an author sees what output metadata to declare.
- **End-user Help** — `glossary.util.ts` (term: query handle / "inline vs. handle results") + `faq.util.ts` (e.g. "Why do some results appear inline and others as a streamed table?"), surfaced in `Help.view.tsx`.
- **Built-in tool descriptions** — unaffected (delivery is metadata, not agent-facing behavior), except where a description already promises inline/handle behavior (`sql_query` already does — left as-is).

## 8. Out of scope (follow-up ticket)

The per-tool conversions: refactor the four sinks (`sql_query`, `display_entity_records`, `visualize`, `visualize_tree`) + `technical_indicator` (#159) onto `resolveResultSink`, and a guard test that no tool open-codes a `> INLINE_ROWS_THRESHOLD → produce()` check. Filed when this lands. (#153 declares `production` natively, no refactor.)

## Acceptance

- `production` is required on `ToolCapability`; every built-in declares it; the coherence suite enforces presence + the `scalar ⟺ value` cross-check.
- `resolveResultSink` returns inline for ≤ threshold and the correct handle (`produceFromStream` vs `produceFromTransform`) past it, per declared `production`; `onLarge: error`/`sample` honored.
- `produceFromStream` stages a snapshot handle from an async row stream without caller-side materialization.
- A custom tool declaring `rows` + `onLarge: handle` without `streaming` is rejected at registration with a clear reason; the integration guide, registration UI, and Help all document `production`.

## Plan

Phased TDD slices in `docs/OUTPUT_CARDINALITY.plan.md` (declaration+backfill → `produceFromStream` → `resolveResultSink` → custom-pack subset rule → documentation → file the migration follow-up).
