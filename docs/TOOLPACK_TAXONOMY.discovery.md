# Toolpack taxonomy + data-management redesign — Discovery

**Issue:** [EnterpriseBT/portal-ai#121](https://github.com/EnterpriseBT/portal-ai/issues/121)

**Why this exists.** The current toolpack model is a workable v1, but it collapses four independent axes — **privilege** (pure / reads / writes / visualizes), **origin** (builtin / custom-webhook / system), **cardinality** (inline / by-reference handle / bulk async job), and **compute shape** (scan / map / reduce / mutate) — into three origin-flavored buckets (the six packs). The seams that produces (privilege fused with origin, "bulk" treated as a category, enforcement keyed off pack slugs, no visualization-at-scale story) are now actively costing us: #114 had to fight the privilege/origin conflation, #120 is a symptom of result-shape routing by tool name, and #124 (webhook scaling) is blocked on a decided data interface.

This is the **umbrella discovery** #114 was carved as "the spine that unblocks." It decides the target taxonomy and the large-scale data-management + visualization contracts, then spawns child slices — it ships no reorg itself. This is the design that decides *what a toolpack means* and *how data flows at scale*.

## The current shape

### Toolpack = origin bucket doing double duty

Six built-in packs (`packages/core/src/registries/builtin-toolpacks.ts:26-33`) each carry `tools[]` of `ToolpackTool` (`:58-68` — `name`, `parameterSchema`, optional `examples`, opt-in `bulkDispatch`). A pack is simultaneously the **station enablement unit** (`tools.service.ts:411-672` `buildAnalyticsTools` instantiates only enabled packs' tools) and the **UI/discovery grouping**. `SYSTEM_TOOL_PACKS` (`tools.service.ts:173`) hardcodes `station_context` as always-attached.

### Seam 1 — privilege fused with origin

"Builtins are pure" is already false. Privileged **builtins**: `sql_query` and `display_entity_records` (read the SQL engine / stream a table), `bulk_aggregate_records` (async read job), and the nine `entity_record_*`/`connector_entity_*`/`field_mapping_*` **writes** (`builtin-toolpacks.ts:896-1119`, write-gated at `tools.service.ts:570-625`). Genuinely pure: only the 8 pure-math financial tools (`npv`/`irr`/`tvm`/`xnpv`/`xirr`/`depreciation`/`amortize`/`bond_math`). The 18 compute tools became *handle-consumers* in #114 (`resolveComputeRecords`). So the real cut is **pure vs privileged** (and *which* privilege); origin is a separate, non-load-bearing axis.

### Seam 2 — "bulk" is a mechanism, not a tier

Cardinality is auto-selected per tool: `sql_query`/`display_entity_records`/`visualize` switch inline↔handle at `INLINE_ROWS_THRESHOLD` (=100; `sql-query.tool.ts:33-42`). The handle envelope (`PortalSqlHandleService.produce`, `portal-sql-handle.service.ts:90-116`; `HANDLE_ROW_CAP`=100k) is then reused by **read** (handle), **reduce** (`bulk_aggregate`), and **map** (`bulk_transform` per-record dispatch, `bulk-transform-tool.dispatcher.ts:94-100`). "Bulk" cross-cuts the privilege/shape axes — it's a delivery mode (inline / handle / job), not a peer category.

### Seam 3 — enforcement hardcoded to slugs/names

- **Cost-ack:** `bulk_transform` declares `costHint: "expensive"` (`builtin-toolpacks.ts:1084`); the route throws `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` off that enum.
- **Entity lock:** `JobLockService` (`job-lock.service.ts:83,122,149`) throws `409 ENTITY_LOCKED_BY_JOB` by inspecting job *type*/metadata, not a declared capability — a new high-cardinality write tool needs the lock check patched by hand.
- **Always-attached:** `SYSTEM_TOOL_PACKS` is a constant slug list, not a declared flag.

### Seam 4 — visualization unaddressed at scale

`visualize`/`visualize_tree` (`visualize.tool.ts:40-78`) run SQL and inject results into a Vega/Vega-Lite spec — inline `data[]` ≤100 rows, else rewrite the spec to reference a handle. Display routing in `portal.service.ts:74-92` keys off hardcoded `ROW_SET_TOOLS` / tool-name checks in `resolveDisplayBlock` (`:165-200`), branching on `type: "vega-lite"` / `"vega"` — exactly where #120's empty-table mis-routing lives. Two problems compound here: (a) **no aggregate-before-render** story for handle/streamed data, and (b) the render pipeline is **closed** — Vega/Vega-Lite are the only formats, baked into the routing + block types + web renderer, so a *new* visualization format (e.g. a D3-backed force graph, a GIS map for #84) means patching the portal routing, adding a block type, *and* adding a frontend renderer in lockstep. There's no registry that lets a new render format slot in.

### Custom-webhook origin

`ToolpackRegistrationService` (`toolpack-registration.service.ts:1-47`) validates a pack's served tools against `ToolpackToolDefinitionSchema` (`organization-toolpack.model.ts:70-82`, optional `bulkDispatch` at `:78`); `buildAnalyticsTools` wraps each in a `WebhookTool` → `callWebhook` (`tools.service.ts:631-659,352`). Custom tools have no backend access → pure-only today (the #124 gap).

## The design space

The issue frames A–D as alternatives. Grounded in the code, **they compose** — B is the substrate, A the data model, D the agent surface, C the tier-sizing spike, and visualization is a consumer of A. The decisions below carve that combined target.

### Decision 1 — Capability metadata vs origin packs (the substrate; issue option B)

**A. Status quo** — packs carry behavior implicitly by slug. **B. Declared capability metadata** — each tool declares `{ pure, reads:[…], writes:[…], consumption, computeShape, costHint, locks, resultKind, alwaysAvailable }`; "pack" becomes a *UI/discovery projection*, enablement a *station-config projection*, enforcement a *capability projection* — all independent reads of one source.

`consumption` is the tool's **cardinality contract** — how it can take data, *declared by the tool, not guessed by the runtime*: `engine-pushdown` (computation expressible to the engine; exact at any N), `streaming` (maintains state over a batch stream — Welford, reservoir, t-digest, mini-batch k-means; exact/bounded-error at any N), or `bounded(maxRows)` (needs the whole set in memory; honestly capped) with an `onOverflow` policy (`stream | sample | decompose | error`). This is the field that makes the unbounded story deterministic and the non-SQL-reduce caveat explicit (see Decision 3 + Appendix).

| | A origin packs | B capability metadata |
|---|---|---|
| Dissolves seams 1 + 3 | no | yes |
| Enforcement is declarative | no (slug-keyed) | yes |
| Blast radius | low | schema + every enforcement site |

**Decided: B, additive** (confirmed 2026-06-16). Declare *what a tool does* once, and make **enforcement** a projection of that metadata. **The toolpack stays the station-enablement unit, the custom-registration unit, and the UI grouping — unchanged UX/mental model** (see Open Q1); capability metadata is layered onto the tools *inside* packs, not a replacement for packs. `costHint` already lives on metadata — extend the pattern to `locks`/`alwaysAvailable`/`writes`/`resultKind`. For custom packs the author declares these in the served `/schema` (optional fields, clean-cut per Open Q6) — the registration form is unchanged.

### Decision 2 — Handle as universal data currency (issue option A)

**Lean: adopt it.** Carve tools by position relative to the data-table envelope: **producer** (`sql_query`, `display_entity_records`), **transformer** (`bulk_transform`), **consumer** (the 18 compute tools, `visualize`). Privilege = which side of the handle a tool sits on. #114 already made compute tools consumers; this generalizes it and is the precondition #124 (webhook scaling) waits on.

### Decision 3 — Runtime matches data cardinality to the tool's declared consumption contract (issue option D)

**A. Agent picks inline/handle/job.** **B. Agent picks the *operation*; the runtime matches the data's N to the tool's declared `consumption` (Decision 1) and selects the delivery mode** — generalize the `INLINE_ROWS_THRESHOLD` auto-switch (already in `sql_query`). `engine-pushdown` → run set-wise (any N); `streaming` → feed the cursor/stream (any N); `bounded(maxRows)` → materialize inline/handle up to the bound, and past it apply the tool's `onOverflow` (`stream | sample | decompose | error`).

**Lean: B.** Makes "bulk" a *mode* of an operation (dissolves seam 2), and — crucially — the unbounded behavior is no longer a runtime guess or a hidden fudge: it's a **match against the tool's declared contract**. Streaming/pushdown tools are exact at any N; only `bounded` tools without a streaming form hit `onOverflow`, and that's an explicit, surfaced, author-chosen fallback (the honest residue of the caveat).

### Decision 4 — Shrink the reduce tier; push SQL-expressible reduce into the engine (issue option C)

**Lean: spike, then push.** The §6 smoke (issue #120 walk) showed the live agent does *everything SQL can express* — descriptive stats incl. skewness/kurtosis — directly in `sql_query`, never reaching for `describe_column`/`correlate`/`aggregate`. Strong evidence most of the 18-tool reduce tier is dead weight as agent-facing tools. Express the SQL-expressible majority as engine aggregates/window functions; keep the pure-fn tier only for the genuinely-iterative escape hatch (k-means, Holt-Winters, IRLS). Needs a spike (Open Q2) to measure the fraction.

### Decision 5 — Enforcement reads declared capability, not slug

**Lean: declarative.** Cost-ack reads `costHint`; the `409` lock reads a declared `locks: [entityIds]` (or `mutates` capability), not job-type inspection; "always available" is a declared flag. Half-there already (`costHint`). Dissolves seam 3 and makes adding a new write/expensive tool config-only.

### Decision 6 — Visualization is a handle consumer with aggregate-before-render

**Lean.** Charts declare they *consume a handle* (Decision 2); the engine **aggregates-before-render** to a renderable cardinality before the Vega spec is built (no inlining >threshold rows). Display routing reads a declared `resultKind` (`data-table` / `vega` / `vega-tree` / `scalar` / `mutation`) instead of the hardcoded `ROW_SET_TOOLS`/tool-name checks — **which also fixes #120**. #92 (trace pins) and #84 (GIS/map) are additional consumers of this contract.

### Decision 7 — Visualization is extensible to new render formats (e.g. D3)

`resultKind` (Decision 6) is the routing key; the question is how a *new* render format is added without touching the portal/agent layer. **A. Closed set** — formats are hardcoded block types + routing (status quo); every new format patches portal + web in lockstep. **B. Open `resultKind` + a frontend renderer registry** — the render-format set is open; the portal/agent layer is **format-agnostic** (passes the block through by its declared `resultKind`); the web layer dispatches to a renderer **registered by `resultKind`**. Adding D3 = register a curated D3-backed renderer (e.g. `force-graph`) + ship a tool that declares that `resultKind`; no portal/agent change. **C. Author-supplied sandboxed renderers** — third parties ship render code, run in an iframe/worker sandbox; maximal flexibility, heavy security surface.

| | A closed | B open resultKind + registry | C sandboxed author renderers |
|---|---|---|---|
| New format touches portal/agent | yes | no | no |
| New format = curated, reviewed | yes | yes | no — arbitrary author JS |
| Security surface | low | low | high (client sandbox, CSP) |

**Lean: B.** An open `resultKind` plus a web renderer registry keyed on it makes new visualizations (D3-backed graphs, the #84 GIS map, future formats) **curated frontend additions** addressable by `resultKind`, with the portal/agent layer never learning a format. Note D3 is *imperative* JS — so "a D3 tool" means a curated D3-backed renderer the tool targets *declaratively* (`resultKind` + spec/params + handle), **not** running arbitrary author D3. **C** (author-supplied sandboxed render code) is the genuine "anyone adds any viz" escape hatch — real, but a separate security-gated feature; out of scope here.

## Tradeoff comparison

|  | D1 capability metadata | D2 handle currency | D3 runtime mode | D4 shrink reduce | D5 declarative enforce | D6 viz-consumer | D7 viz-extensible |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes — the metadata schema | Yes — producer/transformer/consumer | Yes — mode-select rule | Spike first, then spec | Yes — per-enforcement | Yes — resultKind + agg-before-render | Yes — renderer registry |
| Dissolves a seam | 1 + 3 | 1 | 2 | (tier size) | 3 | 4 (+ #120) | 4 (extensibility) |
| Ships as | foundation slice | foundation slice | slice | spike → slices | slice | slice | slice (web registry) |

## Recommendation

**Cross-cutting requirement (confirmed):** **unbounded datasets work seamlessly for every operation — no hard wall.** Handles are streamable / cursor-backed; the runtime auto-escalates inline → handle → stream/job by scale; 100k is the in-memory-materialization threshold, not a processing ceiling. The lone tradeoff is non-SQL reduce, which becomes streamed/online/sampled (approximate) rather than failing — exactness, not capability. See the Appendix for the full prompt→render graph.

1. **Make declared capability metadata the substrate** — each tool declares `{ pure, reads, writes, consumption, computeShape, costHint, locks, resultKind, alwaysAvailable }`; "toolpack" becomes a UI/discovery projection, enablement a station-config projection, enforcement a capability projection. `consumption` is the tool's cardinality contract (`engine-pushdown | streaming | bounded(maxRows)` + `onOverflow`).
2. **Adopt handle-as-currency**: tools are producers / transformers / consumers of the data-table envelope; privilege = side of the handle.
3. **Runtime selects cardinality mode** (inline / handle / job) from scale; the agent picks the operation. Generalize the `INLINE_ROWS_THRESHOLD` pattern; escalate to a job past `HANDLE_ROW_CAP`.
4. **Spike the reduce tier**: measure how much of the 18 compute tools is SQL/window-expressible; push that into the engine, leaving a small iterative escape-hatch tier.
5. **Move enforcement off slugs**: cost-ack, the `409` lock, and always-available all read declared capability.
6. **Visualization consumes handles + aggregates before render**; display routing reads a declared `resultKind` (fixes #120). **The render-format set is open**: the portal/agent layer is format-agnostic, the web layer has a renderer registry keyed by `resultKind`, so a new format (D3-backed graph, #84 GIS map) is a curated frontend renderer + a tool declaring its `resultKind` — no portal/agent change. Author-supplied sandboxed renderers are a future, security-gated escape hatch. #92/#84 are downstream consumers.
7. **Deliverable: a slice map** decomposing the above into child tickets sequenced behind #114, with the capability-metadata schema as the foundation slice everything else builds on.

## Open questions

1. **Does "toolpack" survive as an enforcement unit, or collapse to UI/discovery grouping?** **Resolved (product constraint): the pack survives.** It stays the unit a station attaches/detaches *and* the unit a custom pack registers as — **the current attach-toolpack and register-custom-toolpack UX + mental model are preserved (hard constraint).** What decouples is only the *policy attachment*: cost-ack, the `409` lock, always-available, and write-gating move from pack-slug/name hardcodes to **per-tool declared capability metadata** (additive — `bulkDispatch` is the existing precedent). So "enforcement unit" splits cleanly — *enablement + registration + UI grouping* stay with the pack; *policy* reads capability metadata. The pack is **enriched, not collapsed.**
2. **How much of the 18-tool reduce tier is SQL/window-expressible (Decision 4 spike)?** **Lean: most** — the §6 smoke shows the agent already does skewness/kurtosis/correlation in SQL; hypothesis ≥ ~80%, leaving k-means/Holt-Winters/IRLS/rank-correlation as the pure-fn remainder. Measure before committing.
3. **What is the visualization-at-scale contract — does a chart consume a handle directly, and who aggregates before render?** **Lean: the chart declares handle-consumption; the engine aggregates to a renderable row cap before the spec is built** — charts never inline beyond the threshold.
4. **Which engine backs the reduce push — the existing Postgres-direct `sql_query` path, or DuckDB (named in option C)?** **Lean: reuse the current SQL engine** unless the spike shows window/aggregate coverage gaps that justify DuckDB; don't introduce an engine on spec.
5. **Are render formats a curated set, or open to author-supplied renderers?** A `resultKind` registry (Decision 7) makes *new built-in/curated* formats easy (D3-backed graphs, GIS). Letting a *third party* ship its own renderer is a different, security-heavy thing. **Lean: curated for v1** — the web renderer registry is extended by reviewed frontend additions; author-supplied sandboxed renderers (iframe/worker + CSP) are a future escape hatch, not part of this redesign.
6. **How does the wire schema (`ToolpackToolDefinitionSchema`) evolve for custom packs to declare capabilities?** **Lean: clean cut — no back-compat shim.** There are **no registered toolpacks in production yet** (confirmed 2026-06-16), so the capability fields can be first-class (required where it makes sense) rather than additive-optional-for-compat; no dual-write, no migration of existing packs, no destructive-migration risk. Builtins still default sensibly in code. Aligns with the project's no-production-data posture and the no-compat-aliases convention — and removes a migration/back-compat slice from the slice map.
7. **Do we mandate a `streaming`/`engine-pushdown` form for every reduce tool, or accept `bounded(maxRows)` + `onOverflow` for some?** **Lean: accept bounded+onOverflow** — don't force a streaming rewrite of every tool. Provide `streaming`/pushdown for the high-value, high-N ones (k-means → mini-batch; quantiles → t-digest; stats → engine), and let niche tools stay `bounded` with `onOverflow: sample|error`, surfaced. The D4 spike + the §6 smoke (agent already prefers SQL) inform which tools earn a streaming form.

## What this doesn't decide

- **Shipping the reorg** — child slices (spawned from the slice map) own implementation; this is design-only.
- **Re-deciding #114's contract** (`resolveComputeRecords`, the 100k threshold) — consumed as settled *for the in-memory tier*. But the **experience beyond the threshold is in scope here**: #114 surfaced a hard `COMPUTE_INPUT_TOO_LARGE`; this redesign replaces that wall with the seamless-unbounded path (streamable cursor / transparent decompose) per the cross-cutting requirement. The 100k figure stays; the dead-end past it does not.
- **Re-modeling the toolpack attach/register UX** — explicitly preserved. Stations still attach/detach packs; custom packs register via the same dialog/flow; the pack stays the user-facing unit. The redesign is additive (per-tool capability metadata for enforcement) and must not change either flow's UX or mental model.
- **The bulk family implementations** (`bulk_delete` #101, `bulk_apply` #102, `bulk_materialize` #112) — the taxonomy gives them a coherent home (transformers/producers at job cardinality); they ship as children.
- **#124 (webhook scaling)** — consumes this taxonomy's handle contract; sequenced after.
- **#84 GIS visuals / #92 trace pins specifics** — named as viz-at-scale consumers; their own tickets.

## Next step

Write `docs/TOOLPACK_TAXONOMY.spec.md` (the capability-metadata schema; the producer/transformer/consumer + resultKind contract; the mode-selection rule; the declarative enforcement points) and `docs/TOOLPACK_TAXONOMY.plan.md`. The plan's headline output is the **slice map**: a foundation slice (capability-metadata schema + projections), then independent slices for runtime mode-selection, declarative enforcement, the reduce-tier spike→push, and the visualization-consumer contract + the web renderer registry (open `resultKind` → renderer, so new formats like D3/GIS slot in) — each a child ticket sequenced behind #114, each green-testable on its own.

## Appendix — Worked example: prompt → render across all cardinalities

**Requirement this encodes: unbounded datasets work seamlessly for *every* operation — no hard wall.** The agent picks the operation; the runtime auto-escalates the mode by scale. The 100k figure (`HANDLE_ROW_CAP` / `COMPUTE_MAX_ROWS`) is an **in-memory materialization** threshold for the pure-fn path, **not a ceiling on what the system can process** — beyond it, operations stream (cursor-backed handle) or run engine-side / decomposed, transparently.

```
PROMPT
  │  agent picks the OPERATION only (D3); runtime picks the mode
  ▼
classify by COMPUTE SHAPE:  scan · reduce · map · mutate · visualize
  ▼
runtime estimates N (rows the op touches)
  ▼
cardinality gate ─ N≤100 INLINE ─ 100<N≤100k HANDLE(materialized) ─ N>100k STREAM / JOB
  ▼
RESULT { resultKind }  →  resolveDisplayBlock routes by resultKind   (D6, fixes #120)
  ▼
web renderer registry (D7): data-table · scalar · vega · vega-tree · d3 · geo · mutation-result
```

| Operation | N ≤ 100 (inline) | 100 < N ≤ 100k (handle) | **N > 100k — seamless unbounded path** | resultKind |
|---|---|---|---|---|
| **scan/read** | rows inline | materialized handle | **streamable cursor — paged/streamed, unbounded** | `data-table` |
| **reduce (SQL)** | engine, inline | engine | **engine set-wise / `bulk_aggregate`, unbounded** | `scalar`/`data-table` |
| **reduce (non-SQL)** | pure-fn, inline | pure-fn over handle | **runtime auto-decomposes (sample-reduce → map-assign) or streams an online variant — see caveat** | `data-table`/custom |
| **map/transform** | SQL / few inline calls | `bulk_transform` | **`bulk_transform` job, batched, unbounded** | progress |
| **mutate/write** | `entity_record_*` + lock | — | **`bulk_transform` job + lock, unbounded** | `mutation-result` |
| **visualize** | inline spec | aggregate-before-render | **aggregate-before-render over the cursor/engine → small handle → render, unbounded** | `vega`/`vega-tree`/`d3`/`geo` |

**Commits to (resolves the handle-backing question):** a handle becomes a **streamable, cursor-backed reference** (unbounded paged reads over the engine), not only a materialized ≤100k Redis snapshot. The snapshot stays as the cheap in-memory tier (≤100k); the cursor is the unbounded tier. Read / compute / viz / #124-webhook consumers stream pages and never hit a wall. (The cursor mechanism — engine cursor vs temp table vs re-runnable query, and Postgres vs DuckDB — is a spec/spike detail; the *requirement* is fixed.)

**The caveat is resolved by the tool's declared `consumption` contract (Decision 1/3), not a runtime fudge.** A tool declares how it consumes data: `engine-pushdown` and `streaming` tools are **exact at any N** (the runtime runs them set-wise or feeds the cursor) — for these the caveat *disappears*. Only a `bounded(maxRows)` tool with no streaming form (e.g. an exact in-memory Lloyd k-means) hits its bound on unbounded data, and then the runtime applies that tool's **declared `onOverflow`** (`stream | sample | decompose | error`) — an explicit, surfaced, author-chosen fallback. The irreducible residue (exact in-memory reduce over unbounded data is physically impossible) is thus narrowed to a *declared* property of a specific tool, with a clear upgrade path: ship a `streaming` variant (mini-batch k-means) and it becomes exact-unbounded. Nothing approximates silently.
