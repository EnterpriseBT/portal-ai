# Symmetric output-cardinality surface — plan (phased TDD)

Contract: `docs/OUTPUT_CARDINALITY.spec.md`. Discovery: `docs/OUTPUT_CARDINALITY.discovery.md`. Issue: [#161](https://github.com/EnterpriseBT/portal-ai/issues/161).

One branch (`feat/output-cardinality-surface`), one PR; a commit per slice. Per-slice loop: failing test → red → smallest change → green → full unit (+ integration when touched) → `lint` + `type-check` → commit.

**Scope reminder:** this ships the *surface + documentation*. The per-tool conversions (four sinks + `technical_indicator`) are the follow-up ticket filed in slice 6 — they are **not** in this PR.

## Slice 1 — `production` declaration + backfill
**Ships:** `ProductionSchema` (discriminated union `value | rows`) on `ToolCapability`; coherence refinements (`rows` requires `onLarge`; `scalar ⟺ value`; `mutation-result ⇒ value`); `COMPUTE_OUTPUT_TOO_LARGE` ApiCode. **Every built-in capability in `builtin-toolpacks.ts` declares `production`** (required field). 
**Tests/red-first:** extend `tool-capabilities.test.ts` — every tool has a coherent `production`; the `scalar ⟺ value` cross-check rejects a contradicting capability.
**Done when:** the field is required, all built-ins declare it, coherence suite green, type-checks bind it.

## Slice 2 — `produceFromStream`
**Ships:** `PortalSqlHandleService.produceFromStream({ rows: AsyncIterable<rows[]>, schema?, stationId, organizationId })` — drains the stream, stages ≤`HANDLE_ROW_CAP` snapshot (+ SSE), `sql: null`.
**Tests:** Map-backed Redis fake (mirror `transform-handle.service.test.ts`): stream in → envelope + snapshot round-trip; truncation flagged past cap; no caller-side full materialization.
**Done when:** a handle is staged from an async row stream, read back via getSnapshot/streamHandle like any snapshot handle.

## Slice 3 — `resolveResultSink`
**Ships:** `apps/api/src/tools/result-sink.ts` — `resolveResultSink(production, sink, ctx)` over the three sink shapes (`value` / `rows` / `transform`); inline ≤ threshold; past it `onLarge` (`handle` → `produceFromStream` for `rows` / `produceFromTransform` for `transform`; `sample`; `error`).
**Tests:** unit across value, rows-inline, rows-handle (`produceFromStream` called), transform-inline vs transform-handle (`produceFromTransform` called, by peeked source `rowCount`), and each `onLarge`. The resolver is the single inline-vs-handle decision point.
**Done when:** every (production × N) combination returns the correct inline/handle shape.

## Slice 4 — custom-pack subset rule
**Ships:** `customToolCapabilityError` (`tool-capability.model.ts`) validates `production`: `value`/`rows` allowed; `rows + onLarge: "handle"` requires `consumption.mode: "streaming"`; rejected combos → `TOOLPACK_CAPABILITY_INVALID` with a named reason. Wire schema already carries `capability` (`ToolpackToolDefinitionSchema`).
**Tests:** registration-validation unit — a `rows + handle` custom tool without `streaming` is rejected with the reason; a valid pure-consumer `production` registers.
**Done when:** the subset rule is enforced at registration with clear errors.

## Slice 5 — documentation
**Ships:**
- `docs/CUSTOM_TOOLPACK_INTEGRATION.md` §`capability` — `production` row in the declarable-subset table + example + the subset rule.
- `RegisterToolpackDialog` / `ToolpackMetadataModal` (`apps/web`) — helper text references `production`.
- Help `glossary.util.ts` (term: query handle / inline-vs-handle results) + `faq.util.ts` (Q: why some results inline vs streamed table), surfaced in `Help.view.tsx`.
**Tests:** `glossary.util.test.ts` (+ faq if pinned) cover the new entries; the registration dialog test covers the helper text if asserted.
**Done when:** `production` is documented for end users *and* custom-tool authors; doc/Help tests green.

## Slice 6 — file the migration follow-up
**Ships:** a follow-up ticket: refactor the four sinks (`sql_query`, `display_entity_records`, `visualize`, `visualize_tree`) + `technical_indicator` (#159) onto `resolveResultSink`, + a guard test that no tool open-codes `> INLINE_ROWS_THRESHOLD → produce()`. Reference it in this PR body. (#153 declares `production` natively — no refactor.)

## Sequencing / risks
- Slices 1–4 are backend + core; 5 spans `apps/web` + docs. 1 blocks 3 (resolver reads `production`); 2 blocks 3 (resolver calls `produceFromStream`); 3 and 4 are independent after 1.
- **#153 re-validation** — the surface is abstracted from one built precedent (#159). When #153 lands, confirm its k-means (`rows`/handle) + logistic (`value`) outputs slot into `production` without surface changes; amend the spec if not.
- **No web render change** — `production` rides the existing `resultKind`→`resolveDisplayBlock`→`QueryResultDataBlock` path (spec §6); slice 5 is helper text + Help copy only, not a new renderer.
