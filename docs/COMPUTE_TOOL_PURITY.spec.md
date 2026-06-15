# Compute-tool purity (pure read→compute) — Spec

**After this lands, the 18 built-in compute tools (statistics, regression, and the entity-reading financial tools) no longer touch the backend. Each receives its data as input — a `sql_query` handle the runtime materializes, or inline rows — via a shared `resolveComputeRecords(...)` step, then calls the same pure `AnalyticsService` method it does today. `fetchEntityRows` survives only behind the read primitives. The agent composes `read → compute` explicitly (`sql_query` → compute tool); over-large inputs hard-error with `COMPUTE_INPUT_TOO_LARGE` pointing at SQL pre-aggregation. Built-in and custom compute tools share one documented input contract: records-as-input.**

Discovery: `docs/COMPUTE_TOOL_PURITY.discovery.md`. Issue: [#114](https://github.com/EnterpriseBT/portal-ai/issues/114). Model to copy: the 8 already-pure financial tools (`npv`, `irr`, `tvm`, `xnpv`, `xirr`, `depreciation`, `amortize`, `bond_math`) — arg-less `build()`, scalar/array input, no `fetchEntityRows`.

## Key decisions (flag for review)

1. **Input contract = `queryHandle` XOR `rows`, plus the tool's existing scalar params.** A shared `withComputeInput(shape)` helper adds two optional fields — `queryHandle?: string` (from `sql_query`/`display_entity_records`) and `rows?: Record<string,unknown>[]` (inline) — with a refinement requiring exactly one. Records are keyed by the SQL aliases the agent SELECTed; the tool's existing `column`/`columns`/`x`/`y` params name keys within those rows (unchanged from how `column` works today). The agent is now responsible for `SELECT`ing the columns it will analyze.

2. **`resolveComputeRecords(data, ctx)` is a shared helper, called at the top of each compute tool's `execute`** (not a hidden wrapper). Discovery Decision 2. For `rows` → returns them (length-checked). For `queryHandle` → reads the envelope; if `envelope.truncated` or `rowCount > COMPUTE_MAX_ROWS` → throws `COMPUTE_INPUT_TOO_LARGE`; else `PortalSqlHandleService.getSnapshot(handle, { offset: 0, limit: COMPUTE_MAX_ROWS })` → `rows`. A missing/expired handle already throws `READ_HANDLE_EXPIRED` (reused).

3. **`COMPUTE_MAX_ROWS = HANDLE_ROW_CAP` (100,000).** Per discovery Open Q2: the read primitive stages at most `HANDLE_ROW_CAP` rows (`portal-sql-handle.service.ts:51`), so 100k is the real ceiling regardless. Beyond it the handle is `truncated` and the tool hard-errors rather than silently computing on a partial set — the agent must pre-aggregate/sample in SQL (`… LIMIT n` / `bulk_aggregate`). Reduce-shaped statistics don't compose across batches (discovery Decision 3), so there is no bulk path for these tools by design.

4. **Built-in now; custom-webhook handle-resolution is a fast-follow.** This ticket makes the 18 built-in tools pure and documents the one shared contract (records-as-input). Custom compute tools can already receive **inline** rows via their declared `parameterSchema` today; resolving a *handle* server-side and POSTing rows into the webhook body (so custom tools also get large data without rows in context) is a small, additive follow-up that touches the custom-toolpack registration schema — deferred to keep this PR the spine, not the sprawl.

## Scope

### In scope

1. **Shared input contract + helper** — new `apps/api/src/tools/compute-input.util.ts` (or co-located in `tools.util.ts`):
   - `withComputeInput(shape)` — wraps a Zod object shape with the `queryHandle` XOR `rows` fields + refinement; exported for the 18 tools.
   - `resolveComputeRecords(data, { /* no orgId — handle ids are unguessable session-minted uuids */ })` → `Promise<Record<string,unknown>[]>`. Reads `PortalSqlHandleService` meta for `rowCount`/`truncated`, enforces `COMPUTE_MAX_ROWS`, calls `getSnapshot`. Pure-ish (only I/O is the handle read); unit-testable with a mocked handle service.
   - `COMPUTE_MAX_ROWS` constant (= `HANDLE_ROW_CAP`) in `packages/core/src/constants/large-data-ops.constants.ts` (alongside `INLINE_ROWS_THRESHOLD`).

2. **Refactor the 18 compute tools** — drop `fetchEntityRows`; `build()` becomes arg-less; `execute(input)` does `const records = await resolveComputeRecords(input); return AnalyticsService.<method>({ records, ...rest })`. The `AnalyticsService` methods are already pure and unchanged (`describeColumn`/`correlate`/`detectOutliers`/`cluster`/`aggregate`/`hypothesisTest`/`regression`/`logisticRegression`/`trend`/`changepoint`/`decompose`/`forecast`/`technicalIndicator`/`sharpeRatio`/`maxDrawdown`/`rollingReturns`/`varCvar`/`portfolioMetrics` — each takes `{ records, ... }`). The `entity` input field is removed in favor of `queryHandle`/`rows`; **clean cut, no `entity` compatibility alias** (per [[feedback_no_compat_aliases]]).

3. **Registration** — `tools.service.ts buildAnalyticsTools`: change the 18 `new XTool().build(stationData, organizationId)` call sites to `.build()`. `AnalyticsService.loadStation` stays (the read primitives `sql_query`/`display_entity_records`/`resolve_identity` and `entity_management` still need `stationData`). Update the descriptor `parameterSchema`s in `builtin-toolpacks.ts` for the 18 tools to the new input shape (the #115 consistency test will enforce they stay aligned).

4. **API code** — add `COMPUTE_INPUT_TOO_LARGE` to `api-codes.constants.ts` + an `ApiCodeDefaultRecommendation` entry ("Pre-aggregate or sample in SQL — `… LIMIT n`, a `GROUP BY` rollup, or `bulk_aggregate` — then pass the smaller result.").

5. **Tests** — see Tests. Crucially, the 18 tools' unit tests drop all `stationData`/repo/wide-table mocks and drive the pure path with fixture `rows`.

### Out of scope

- **Custom-webhook handle-resolution** (Key decision 4) — the contract is documented; the webhook record-injection + `consumesRecords` declaration is a fast-follow ticket.
- **Toolpack reorganization / classification metadata / `write` auto-scaling** — the broader taxonomy investigation (discovery "What this doesn't decide").
- **Making reduce-shaped statistics streamable** (discovery Decision 3B).
- **Changing `sql_query`'s inline/handle threshold or `display_entity_records`** — the read primitives are unchanged; this ticket only consumes their output.

## Surface

| File | Change |
|---|---|
| `packages/core/src/constants/large-data-ops.constants.ts` | + `COMPUTE_MAX_ROWS` (= `HANDLE_ROW_CAP`) |
| `apps/api/src/tools/compute-input.util.ts` | new — `withComputeInput`, `resolveComputeRecords` |
| `apps/api/src/tools/{describe-column,correlate,detect-outliers,cluster,aggregate,hypothesis-test}.tool.ts` | statistics — arg-less `build()`, `resolveComputeRecords`, no `fetchEntityRows` |
| `apps/api/src/tools/{regression,logistic-regression,trend,changepoint,decompose,forecast}.tool.ts` | regression — same |
| `apps/api/src/tools/{technical-indicator,sharpe-ratio,max-drawdown,rolling-returns,var-cvar,portfolio-metrics}.tool.ts` | financial (data-dependent) — same |
| `apps/api/src/services/tools.service.ts` | 18 `.build()` call sites lose `stationData`; `loadStation` retained for read/write tools |
| `packages/core/src/registries/builtin-toolpacks.ts` | 18 `parameterSchema`s → new `queryHandle`/`rows` shape |
| `apps/api/src/constants/api-codes.constants.ts` | + `COMPUTE_INPUT_TOO_LARGE` + recommendation |
| `apps/api/src/utils/tools.util.ts` | `fetchEntityRows` retained only for read primitives (`resolve_identity` etc.); remove its compute-tool imports |
| `apps/api/src/__tests__/tools/*.test.ts` (18) | drop `stationData`/DB mocks; drive pure path with fixture rows |

## Tests

### Unit — `resolveComputeRecords` / `withComputeInput`
1. `rows` input passes through; `> COMPUTE_MAX_ROWS` rows → `COMPUTE_INPUT_TOO_LARGE`.
2. `queryHandle` with `rowCount ≤ cap`, `truncated:false` → `getSnapshot` rows returned (mock the handle service).
3. `queryHandle` with `truncated:true` (or `rowCount > cap`) → `COMPUTE_INPUT_TOO_LARGE`.
4. Expired handle → `READ_HANDLE_EXPIRED` propagates.
5. `withComputeInput` rejects neither-provided and both-provided (`queryHandle` AND `rows`).

### Unit — representative compute tools (≥6 across the three packs, e.g. describe_column, correlate, regression, forecast, cluster, technical_indicator)
6. Given fixture `rows` + scalar params, `execute` returns the same result the current tool produces for the same data — **no `stationData`, no DB mock**.
7. Given a `queryHandle`, `execute` resolves via the (mocked) handle service then computes.
8. Schema rejects an input missing both `queryHandle` and `rows`.

### Guard
9. Grep guard (extend the #115 `tools.service.test.ts` consistency suite, or a new lint test): none of the 18 tool files import or call `fetchEntityRows`.

### Integration
10. Real path: stage a `sql_query` result as a handle (real `er__` table + rows), then call a refactored tool with that `queryHandle`; assert the computed stat matches the hand-computed value over the same rows, and that a handle whose `rowCount` exceeds `COMPUTE_MAX_ROWS` yields `COMPUTE_INPUT_TOO_LARGE`.

## Acceptance criteria

- [ ] `COMPUTE_MAX_ROWS` constant + `COMPUTE_INPUT_TOO_LARGE` code + recommendation.
- [ ] `withComputeInput` / `resolveComputeRecords` pass tests 1–5.
- [ ] All 18 tools refactored to pure `build()`; none call `fetchEntityRows` (test 9 green).
- [ ] Representative compute-tool tests (6–8) pass with no `stationData`/DB mocks.
- [ ] Descriptor `parameterSchema`s updated; #115 consistency suite stays green.
- [ ] Integration test 10 green (real handle → compute).
- [ ] `npm run test:unit` (api + core) + `npm run test:integration` (api) green; `npm run lint && npm run type-check` clean.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Agent regression** — the agent must now `SELECT` the column(s) then pass the handle, where before it passed `{entity, column}`. | The tool descriptions state the two-step composition explicitly; `display_entity_records`/`sql_query` already return handles the agent threads elsewhere. Smoke-walk a representative prompt per pack before merge. |
| Key mismatch — records keyed by SQL alias vs the `column` param. | Contract passes both through unchanged; the agent owns alignment (it wrote the SELECT). Tool errors surface as "column not found in rows", same class as today's bad-column. |
| 100k rows materialized in worker/app memory for a compute. | Bounded by `COMPUTE_MAX_ROWS = HANDLE_ROW_CAP`; statistics over 100k numbers is cheap. Beyond → hard error, not OOM. |
| Custom compute tools can't yet resolve a handle (only inline rows). | Documented limitation (Key decision 4); inline rows work today, handle-resolution is the fast-follow. |

**Rollback**: revert the merge. The 18 tools return to `fetchEntityRows`; `resolveComputeRecords`/`withComputeInput`/`COMPUTE_MAX_ROWS`/`COMPUTE_INPUT_TOO_LARGE` are new and unreferenced after revert. No schema/migration, no data change.

## Cross-references

- `docs/COMPUTE_TOOL_PURITY.discovery.md` — decisions (handle-resolved contract, inline-bounded reduce, cap ≤ HANDLE_ROW_CAP, k-means limit case).
- `apps/api/src/services/portal-sql-handle.service.ts:220` — `getSnapshot(handleId, {offset?,limit?}) → {rows,total,offset,limit}`; `:29` envelope; `:51` `HANDLE_ROW_CAP`.
- `apps/api/src/utils/tools.util.ts:41` — `fetchEntityRows` (being removed from compute tools).
- `apps/api/src/services/analytics.service.ts` — the pure compute methods (unchanged), each `static <m>({ records, … })`.
- `apps/api/src/tools/npv.tool.ts` — arg-less pure-tool template.
- `apps/api/src/__tests__/services/tools.service.test.ts` — #115 consistency guard the descriptor changes must keep green.
