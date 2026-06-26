# Toolpack taxonomy + data-management redesign — Spec

**This is the *binding contract* for umbrella #121 — the schema and the cross-cutting contracts every child slice conforms to. It ships no behavior itself.** After the children land: every tool declares capability metadata; "pack" is a UI/enablement projection while enforcement, cardinality, and render-routing are projections of that metadata; the runtime selects inline/handle/job from N (bounded by the tool's declared `consumption`); cardinality is a runtime mode, so the `bulk_*` prefix is gone; the reduce tier is 8 tools (10 pushed into `sql_query`); display routes by `resultKind` through an open web renderer registry; custom-webhook tools are first-class in the pure-consumer corner. **Unbounded datasets work seamlessly for every operation** — 100k is the in-memory-materialization threshold, not a processing ceiling.

Discovery: `docs/TOOLPACK_TAXONOMY.discovery.md`. Issue: [#121](https://github.com/EnterpriseBT/portal-ai/issues/121). Spine that unblocked this: #114 (`resolveComputeRecords`, `COMPUTE_MAX_ROWS`, the handle envelope). **No registered toolpacks exist in production** → every schema change here is a **clean cut** (no back-compat shim, no dual-write, no migration of existing packs).

## Key decisions (flag for review)

1. **One capability object per tool, declared in the descriptor** (`ToolpackTool` in core registry) **and in the custom-pack wire schema** (`ToolpackToolDefinitionSchema`). It is the single source the three projections read. Built-ins declare it in code; custom packs declare it in their served `/schema`.
2. **`consumption` is a ceiling, not a mandate** (discovery D1/D3). `bounded(maxRows) ⊂ streaming ≈ engine-pushdown`. A `streaming`/`engine-pushdown` tool still runs inline with zero overhead at small N; the streaming/job machinery engages only when N demands it. This is why declaring `streaming` is free on the common path.
3. **Role (producer/transformer/consumer) is derived, not declared** (D2) — a view over the capability fields. No separate field.
4. **Cardinality is a runtime mode, not a tool** (D8). The agent names the operation; the runtime escalates inline→handle→job by N. `bulk_aggregate`/`bulk_transform`/`bulk_delete`/`bulk_apply`/`bulk_materialize` are not tools — they are the job mode of `sql_query`/the write ops. Cost-ack and the entity lock are **runtime gates on escalation**, driven by `costHint`/`locks`.
5. **Reduce tier 18 → 8** (D4 spike, Q2 resolved). 10 tools are removed (expressed in `sql_query`); `hypothesis_test`/`var_cvar`/`regression` become `engine-pushdown`; `forecast`/`portfolio_metrics` are `streaming` reduces; `cluster`/`logistic_regression` are `bounded`+`onOverflow` reduces; `technical_indicator` is a `bounded` per-row **map** (its O(N) series can't stream inline — streaming it into a handle is #159) (mini-batch/SGD streaming variants are the exact-unbounded upgrade, a separate ticket).
6. **A handle is a streamable, cursor-backed reference** beyond the ≤100k Redis snapshot (discovery Appendix). The snapshot stays the cheap in-memory tier; the cursor is the unbounded tier. This is what makes "no hard wall" true.
7. **Render formats are an open set** (D7). The portal/agent layer is `resultKind`-agnostic; the web layer dispatches via a renderer registry keyed on `resultKind`. New formats (D3 graph, GIS) are curated frontend additions; author-supplied sandboxed renderers are explicitly out of scope.

## The capability schema

Added to **`ToolpackTool`** (`packages/core/src/registries/builtin-toolpacks.ts`) and **`ToolpackToolDefinitionSchema`** (`packages/core/src/models/organization-toolpack.model.ts`), with a shared Zod definition in core:

```ts
// packages/core/src/models/tool-capability.model.ts (new)
const ConsumptionMode = z.enum(["none", "engine-pushdown", "streaming", "bounded"]);
const OnOverflow     = z.enum(["stream", "sample", "decompose", "error"]);

const ConsumptionSchema = z
  .object({
    mode: ConsumptionMode,
    maxRows: z.number().int().positive().optional(),   // required iff mode === "bounded"
    onOverflow: OnOverflow.optional(),                 // required iff mode === "bounded"
  })
  .refine((c) => (c.mode === "bounded") === (c.maxRows != null && c.onOverflow != null),
    "bounded requires maxRows + onOverflow; other modes forbid them");

export const ResultKind = z.enum([
  "data-table", "scalar", "vega", "vega-tree", "d3", "geo", "mutation-result", "progress",
]);
const ComputeShape = z.enum(["scan", "reduce", "map", "mutate", "visualize", "pure"]);
const CostHint     = z.enum(["cheap", "moderate", "expensive"]);

export const ToolCapabilitySchema = z.object({
  pure: z.boolean(),
  reads: z.array(z.string()),          // entity kinds read, e.g. ["entity_records"]
  writes: z.array(z.string()),         // entity kinds written
  consumption: ConsumptionSchema,
  computeShape: ComputeShape,
  costHint: CostHint,
  locks: z.array(z.string()),          // job-metadata keys whose ids this tool locks, e.g. ["recordIds","connectorInstanceId"]
  resultKind: ResultKind,
  alwaysAvailable: z.boolean(),
});
```

**Coherence refinements** (validated for every built-in at registry-build, and for custom packs at registration):
- `pure: true` ⇒ `reads`, `writes`, `locks` empty, `consumption.mode ≠ "engine-pushdown"`.
- `writes` non-empty ⇒ `computeShape ∈ {map, mutate}` and (`locks` non-empty or explicitly waived).
- `consumption.mode === "none"` ⇒ tool takes no record input (pure-math / external).
- `resultKind === "mutation-result" | "progress"` ⇒ `writes` non-empty.

## The three projections (D1)

| Projection | Reads | Replaces |
|---|---|---|
| **Pack / UI / discovery** | the pack a tool is grouped under (unchanged) | nothing — packs stay the attach/register/UI unit |
| **Enablement** | station config (attached packs) **×** per-tool `writes` (write-gate) **×** `alwaysAvailable` | `SYSTEM_TOOL_PACKS` constant; pack-level write block |
| **Enforcement** | `costHint`, `locks`, `writes` | slug/name hardcodes in cost-ack + `JobLockService` |

**Role view** (derived, for docs/agent prompt): `produces a handle or resultKind∈{data-table}` → producer; `consumption.mode ≠ none` → consumer; both → transformer.

## The consumption contract + mode selection (D3)

A uniform **record-source** abstraction (`apps/api/src/tools/record-source.ts`, new) backs tool input by the cheapest substrate for N:

```
estimate N (rows the op touches)
N ≤ INLINE_ROWS_THRESHOLD (100)      → in-memory array
INLINE < N ≤ HANDLE_ROW_CAP (100k)   → materialized Redis handle snapshot (today's getSnapshot)
N > HANDLE_ROW_CAP                    → cursor-backed stream (#129, synchronous) — OR, for a
                                        long/expensive op, the JOB tier (asynchronous; see below)
```

The four tiers — **inline → handle → cursor → job** — are one ladder. The first three are **synchronous and transparent** (the call returns rows/handle within the turn) and selection across them is **automatic, by N** — the established convention (`sql_query` auto-escalates inline→handle at `INLINE_ROWS_THRESHOLD`; #129 engages the cursor past `HANDLE_ROW_CAP`). The **job tier** is the qualitatively different one — *asynchronous*, long-running, cost-bearing — so its escalation is **auto-detected but explicitly gated**, never silent (see "The job tier" below). This is what realizes "arbitrarily large reads and writes are a job," consistent with the operation+cardinality-mode model.

bounded above by `consumption`:
- **engine-pushdown** — runs set-wise in SQL; exact at any N; no materialization.
- **streaming** — fed the cursor batch-by-batch (Welford/reservoir/t-digest/online recurrence); exact/bounded-error at any N.
- **bounded(maxRows)** — materializes up to `maxRows`; past it applies `onOverflow` (`stream` → escalate to a streaming variant if one exists; `sample` → reservoir-sample to `maxRows`, flagged in the result; `decompose` → map-assign + sample-reduce; `error` → `COMPUTE_INPUT_TOO_LARGE`). Every overflow is **surfaced in the result**, never silent.
- **none** — no record input.

`COMPUTE_INPUT_TOO_LARGE` (from #114) is **retained only as the `onOverflow: error` outcome for `bounded` tools** — it is no longer the system-wide wall.

## Declarative enforcement (D5)

| Gate | Old trigger | New trigger |
|---|---|---|
| **Cost-ack** (`BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`) | `bulk_transform` slug + `costHint` enum | `costHint === "expensive"` **or** runtime escalates the op to job mode |
| **Entity lock** (`409 ENTITY_LOCKED_BY_JOB`) | `JobLockService` inspects job *type*/metadata | a tool with non-empty `locks` is checked against non-terminal jobs locking those ids, *before* the write; the enqueued job declares its locked ids **from** `locks` |
| **Always-available** | `SYSTEM_TOOL_PACKS = ["station_context"]` constant | `alwaysAvailable: true` on `current_time`/`station_context` |
| **Write-gate** | pack-level (`entity_management` block gated on station write capability) | per-tool: `writes` non-empty ⇒ gated (finer; a non-write tool in a write pack stays available) |

## The job tier (async escalation — D8a, realigned 2026-06-22)

The cursor (#129) makes a **synchronous** read exact at any N, but a genuinely long or expensive operation — a multi-minute aggregate scan, a large per-record map/write — must run **off the request thread as a job**. The job tier is therefore a first-class rung of the cardinality ladder, not a separate `bulk_*` tool:

- **Auto-detected.** The runtime escalates an operation to the job tier when its estimated cost crosses the synchronous ceiling (N and/or duration past what a `statement_timeout`-bounded synchronous call can serve) — the same auto-by-N spirit as `INLINE_ROWS_THRESHOLD`. The agent names the operation; it does **not** pick a `bulk_` variant.
- **Explicitly gated, never silent.** Because a job is async + cost-bearing, escalation surfaces through the **existing cost-ack flow** (reject → `acknowledgeCost` → retry), which is **server-enforced** (not a prompt instruction). This is the one tier where automatic detection pairs with an explicit confirm — it cannot run a big expensive job silently, and the agent learns the result is asynchronous.
- **Async result.** The job returns `resultKind: "progress"`; the enqueued job declares its locked ids from `capability.locks` (gate-4 registry, #142); the terminal payload lets the SSE consumer refresh without a full refetch (per the async-job convention).

This is the runtime mechanism the `bulk_*` tools collapse into: **`sql_query` at job mode** for a long aggregate read (rehoming `bulk_aggregate`'s 120s off-thread scan), and the **transform op at job mode** for a large write (the renamed `bulk_transform`). Establishing it is **child E's** work (it pairs with making `sql_query` the reduce operation); **child F** then removes the now-redundant `bulk_*` tools.

### Decided — the escalation trigger: hybrid `EXPLAIN`-predictive + timeout backstop (E1, 2026-06-22)
*How* the runtime decides "this needs the job tier." The trade is wasted work vs. a cost model:

| Option | Mechanism | Cost |
|---|---|---|
| **Reactive (timeout)** | Run sync; on the 30s `statement_timeout`, reject→ack→re-run as the 120s job. | **No cost model, but wastes ≤30s on every escalation, then runs the scan a *second* time.** |
| **Short probe** | Run sync with a small timeout (~2–3s); time out → escalate. | Same double-execution, but caps the waste at ~3s instead of 30s. |
| **Predictive (`EXPLAIN`)** | `EXPLAIN` the query first (fast, **non-executing** — returns PG's estimated cost + rows); escalate up front when the estimate crosses a threshold. **No wasted sync attempt, no double execution.** | Needs a cost/row threshold; PG estimates can be wrong on skewed stats. |
| **Hybrid (lean)** | **Predictive `EXPLAIN` as the primary** (skip the sync attempt for clearly-large queries) **+ the 30s timeout as a backstop** (catches under-estimates). | Best of both; a little more wiring. |

**Decided: hybrid — `EXPLAIN`-predictive primary + the 30s timeout as backstop.** Reactive-only's wasted 30s + double-execution is the thing to avoid, and **`EXPLAIN` is already in the codebase** (`BulkAggregateService.explainExpression` uses it for the aggregate pre-flight), so the predictive signal is cheap and precedented. Mechanism (E1b): `EXPLAIN` the validated query (non-executing) → if PG's estimated cost/rows **crosses the threshold**, escalate up front (cost-ack reject, no sync attempt); else run sync, and if it nonetheless hits the 30s `statement_timeout`, escalate then (the backstop catches under-estimates). The `EXPLAIN` cost/row **threshold** is the one tunable — pick a default in E1b (a new `*_constants` value), env-overridable; tune against real queries. The `sql_query@job` execution foundation (E1a — JobType + migration + 120s processor staging a handle) is trigger-independent and builds first.

## Cardinality is a mode, not a tool (D8)

The agent invokes the **operation**; the runtime picks inline/handle/cursor/job. The `bulk_*` tools dissolve (only `bulk_aggregate_records` + `bulk_transform_entity_records` were ever built; #101/#102/#112 are planning-only):

| Was | Becomes |
|---|---|
| `bulk_aggregate_records` | `sql_query` / aggregate at job mode |
| `bulk_transform`, `bulk_transform_entity_records`, `bulk_apply` (#102) | the transform/write op at job mode (`bulkDispatch` retained as the per-batch dispatch capability) |
| `bulk_delete` (#101) | delete op at job mode |
| `bulk_materialize` (#112) | materialize op at job mode |

The job result carries `resultKind: "progress"`; the enqueued job declares its `locks` from the operation's capability; cost-ack fires on the escalation (Key decision 4). **#101/#102/#112 ship as job modes, not new tools** — see the plan for their reconciliation.

## Visualization at scale (D6) + open renderers (D7)

- **Aggregate-before-render:** viz tools declare `consumption.mode = "engine-pushdown"` + `computeShape = "visualize"`; the engine aggregates to a renderable row cap **before** the Vega/spec is built — no inlining beyond threshold.
- **Routing by `resultKind`:** `resolveDisplayBlock` (`portal.service.ts:165`) keys off the result's `resultKind`, **not** `ROW_SET_TOOLS`/tool-name (`portal.service.ts:74`). **This fixes #120** (the empty-table mis-route for `cluster`/`detect_outliers`).
- **Web renderer registry:** `apps/web` maps `resultKind → renderer`; the portal/agent layer is format-agnostic. Adding D3 (`d3` / e.g. `force-graph`) or GIS (`geo`, #84) = register a curated renderer + a tool declaring that `resultKind`. No portal/agent change. Author-supplied sandboxed renderers are out of scope.

## Custom-webhook packs (pure-consumer subset)

Author declares the capability in the served `/schema`; `ToolpackRegistrationService.fetchSchema` validates the subset and **rejects with a named error** otherwise:

| Field | Custom tool |
|---|---|
| `pure` | forced `true` |
| `reads` / `writes` / `locks` / `alwaysAvailable` | rejected (must be empty/false) |
| `consumption.mode` | `none` / `bounded` / `streaming` — **not** `engine-pushdown` |
| `computeShape` | `map` / `reduce` / `pure` |
| `resultKind`, `costHint` | declarable |

Runtime wiring: `consumption: bounded` = records-in-body (#122 path); `streaming` = signed paged pull-on-read (#124 path). Registration form UX is unchanged (Key decision: see discovery "Custom toolpacks under the new taxonomy"). **The wire-schema + validation ship in the foundation child; the runtime record-feeding is #124.**

## Reduce-tier disposition (the spike, D4)

| Disposition | Tools | Capability after |
|---|---|---|
| **Removed → `sql_query`** (10) | `describe_column` `correlate` `detect_outliers` `aggregate` `trend` `changepoint` `decompose` `sharpe_ratio` `max_drawdown` `rolling_returns` | n/a (agent expresses in SQL) |
| **engine-pushdown** (3) | `hypothesis_test` `var_cvar` `regression` | `pure:false`* · `reads:[entity_records]` · `engine-pushdown` · reduce — reduction is SQL; O(1) scalar residue in-tool |
| **streaming** (2) | `forecast` `portfolio_metrics` | `pure:true` · `streaming` · reduce |
| **bounded reduce** (2) | `cluster` `logistic_regression` | `pure:true` · `bounded(maxRows)` + `onOverflow` · reduce · `costHint:expensive` |
| **bounded map** (1) | `technical_indicator` | `pure:true` · `bounded(maxRows)` · **map** · `resultKind:data-table` — a per-row N→N series, not a reduce; can't stream its O(N) output inline, so it stays bounded. Streaming it into a query handle is #159. |
| **unchanged pure-math** (8) | `npv` `irr` `tvm` `xnpv` `xirr` `depreciation` `amortize` `bond_math` | `pure:true` · `none` · pure |

\* **Reconciled in E2c (2026-06-24):** the implemented `ToolCapabilitySchema` models a pushdown as a *read*, so the coherence refinement forbids `pure:true` + `engine-pushdown` and requires a non-empty `reads[]`. The 3 pushdown tools are therefore `pure:false, reads:["entity_records"], consumption.mode:"engine-pushdown"` (the `enginePushdownReduce` capability), not the `pure:true*` originally sketched here. They still accept inline `rows` (in-memory fallback); the capability describes the engine-pushdown ceiling. Runtime: each tool issues its sufficient-statistics aggregate over the source handle via `PortalSqlHandleService.aggregateOverHandle` and computes the O(1) residue in-tool; `mann_whitney` / `chi_squared` / per-row `residuals` stay on the in-memory path.

## Surface (by child — full detail in each child's own spec)

| Area | Files (anchors) |
|---|---|
| Capability schema | `packages/core/src/models/tool-capability.model.ts` (new); `organization-toolpack.model.ts:70`; `builtin-toolpacks.ts` ToolpackTool |
| Projections / enablement | `apps/api/src/services/tools.service.ts:173` (`SYSTEM_TOOL_PACKS`), `:411-672` (`buildAnalyticsTools`), `:570` (write-gate) |
| Enforcement | cost-ack route; `job-lock.service.ts:83,122,149`; `api-codes.constants.ts` |
| Record-source / mode | `apps/api/src/tools/record-source.ts` (new); `compute-input.util.ts`; `portal-sql-handle.service.ts` (cursor); `large-data-ops.constants.ts` |
| Reduce tier | the 18 `*.tool.ts` + `analytics.service.ts` (SQL pushdown for 3) |
| Viz routing | `portal.service.ts:74,165` |
| Web renderer registry | `apps/web` display block renderer (new registry) |
| Custom validation | `toolpack-registration.service.ts` |

## Acceptance criteria (umbrella — each child carries its slice)

- [ ] `ToolCapabilitySchema` exists; every built-in tool declares a coherent capability (refinements pass); type-checks bind it to the registry.
- [ ] The three projections read capability metadata; `SYSTEM_TOOL_PACKS` + slug/name enforcement hardcodes are gone.
- [ ] Record-source selects inline/handle/job by N, bounded by `consumption`; `onOverflow` surfaced; unbounded read/viz/streaming-reduce never hit a wall (cursor path).
- [ ] Reduce tier is 8 tools; the 10 removed are expressed in `sql_query` (smoke-verified per pack); `cluster`/`logistic_regression` overflow is explicit.
- [ ] `bulk_*` tools no longer exist; their operations escalate to job mode with cost-ack + lock gates; #101/#102/#112 reconciled.
- [ ] Display routes by `resultKind`; #120's empty-table mis-route is gone; the web renderer registry accepts a new `resultKind` without portal/agent change.
- [ ] Custom-pack capability subset validated at registration with named errors.
- [ ] Each child: `npm run test:unit` + `test:integration` green; `lint` + `type-check` clean.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Agent regression** when 10 reduce tools vanish | tool removal lands with prompt/description guidance ("use `sql_query` for descriptive stats / correlation / windows"); §6-style smoke per pack before each removal merge |
| **Cursor handle** is real new infra (memory, TTL, cancellation) | its own child with its own spec; the snapshot tier is untouched and remains the default ≤100k path |
| **Enforcement projection** mis-derives a lock/write and lets a bad mutation through | refinements + a guard test asserting every `writes`-tool has `locks`; integration test per enforcement gate |
| Big-bang feel | the plan splits into independently-shippable children off `main`, each green on its own; the umbrella ships nothing |

**Rollback** is per-child (revert the child's PR). The foundation child is additive metadata + projections with no behavior change, so reverting later children leaves the substrate harmless.

## Cross-references

- `docs/TOOLPACK_TAXONOMY.discovery.md` — D1–D8, the spike section, the prompt→render appendix.
- `docs/COMPUTE_TOOL_PURITY.spec.md` — #114 contract this builds on (`resolveComputeRecords`, `COMPUTE_MAX_ROWS`).
- `docs/LARGE_DATA_OPS_PHASE_*.spec.md` — the handle envelope / bulk job machinery the cursor + job-mode generalize.
- Tickets reconciled: #101, #102, #112 (→ job modes), #120 (→ `resultKind` routing), #122 (closed), #124 (→ custom streaming), #84/#92 (→ renderer registry consumers).
