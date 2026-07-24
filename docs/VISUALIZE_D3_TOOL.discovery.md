# `visualize_d3` agent tool over SQL delivery — Discovery

**Issue:** [EnterpriseBT/portal-ai#269](https://github.com/EnterpriseBT/portal-ai/issues/269) (epic #267, branch base `epic/d3-dashboard-widgets`)

**Why this exists.** #268 shipped the sandboxed D3 runtime — the `d3` block type, `D3BlockContentSchema`, and the renderer registered into the open block registry — but nothing *produces* a `d3` block yet. This child adds the tool that does. Per the design decisions below, `visualize_d3` is **not** a thin pass-through: the portal agent supplies *intent* (`{ sql, instruction, title? }`), and the tool runs the existing SQL-delivery contract (inline ≤100 rows / Redis query-handle above) **and a dedicated `claude-opus-4-8` codegen sub-call** that synthesizes the D3 render program from the data shape + intent, validating and retrying before it mints the `d3` block. It replaces the *role* of `visualize`/`visualize_tree` (removed by sibling #272), lives in its **own `visualize` toolpack** for independent tier-gating and cost accounting, and is a **`expensive`-classed** tool because each call incurs an Opus invocation. This is the tool that turns a chart request into a validated, sandboxed D3 widget.

## The current shape

### The predecessor tool (structural template)

| Piece | Location | Note |
|---|---|---|
| `VisualizeTool` | `apps/api/src/tools/visualize.tool.ts:43` | extends `Tool`, declares `slug`/`name`/`description`/`get schema()`/`build()`; input `{ sql, vegaLiteSpec }` (`:38`), spec a loose `z.record` (`:22`) — the agent writes the spec inline (the shape #269 deliberately moves away from) |
| inline vs handle branch | `visualize.tool.ts:62`,`:68`,`:79` | `resolveSqlDelivery({ sql })` → inline returns bare spec; handle returns `{ type, ...envelope, spec }` |
| `Tool` base | `apps/api/src/types/tools.ts:3` | abstract `slug`/`name`/`description`/`get schema()`/`build()`; concrete `validate()` = `schema.parse` |
| SQL delivery | `apps/api/src/tools/result-sink.ts:69` | `resolveSqlDelivery(opts, ctx) → { kind:"inline", result } \| { kind:"handle", envelope }`; envelope = `QueryHandleEnvelopeFieldsSchema` shape (schema + samplePeek — the data-shape the codegen call needs) |

### The AI service (the codegen seam)

| Piece | Location | Note |
|---|---|---|
| `AiService` | `apps/api/src/services/ai.service.ts:5` | `createAnthropic` provider; `DEFAULT_MODEL = "claude-sonnet-4-6"` (`:12`) — the model the main portal agent runs on |
| main agent loop | `apps/api/src/services/portal.service.ts:634` | `streamText({ model: AiService.providers.anthropic(DEFAULT_MODEL), … })` — authors all tool arguments inline today |
| existing per-task model precedent | `apps/api/src/services/spreadsheet-parsing-llm.service.ts:78`,`:116` | `DEFAULT_INTERPRET_MODEL = "claude-haiku-4-5-…"` — a **focused, non-agent model call at a task-specific model** already exists in the codebase; the codegen sub-call follows this precedent |

### Where a new tool + pack plug in

| Surface | Location | What #269 adds |
|---|---|---|
| Instantiation | `apps/api/src/services/tools.service.ts:508` (currently the `data_query` block) | a new `if (enabledPacks.has("visualize"))` block instantiating `visualize_d3` |
| Cost-gate wrap | `tools.service.ts:720`,`:740` | automatic — reads `costHint` from `ALL_TOOL_CAPABILITIES`; #269 sets `expensive` |
| Toolpack mirror | `packages/core/src/registries/builtin-toolpacks.ts` (packs at `:157`; `engineRead` helper `:1015`) | a **new `visualize` pack** with the `visualize_d3` tool literal `{ sql, instruction, title? }`; a `CAPABILITIES` entry (a new helper — `engineRead`'s `costHint:"free"` no longer fits; see Decision 1) |
| Server block minting | `apps/api/src/services/portal.service.ts:149` `resolveDisplayBlock` (keyed on `resultKind` `:156`) | a `resultKind === "d3"` arm |
| Client block minting | `apps/web/src/utils/portal-stream.util.ts:127` | a `toolName === "visualize_d3" \|\| result.type === "d3"` arm + `d3` in the block-kind union |
| Agent guidance | `apps/api/src/prompts/system.prompt.ts:217` | when to reach for `visualize_d3`, and that it supplies *intent*, not a program |
| Codegen prompt | new (e.g. `apps/api/src/prompts/`) | the focused system prompt for the sub-call: the `api` runtime contract + the worked example + the progressive-idempotence rule |
| Pinning tests | `builtin-toolpacks.test.ts` (pack count `:14`), `tool-capabilities.test.ts:127` | new `visualize` pack + `visualize_d3: "expensive"` in `EXPECTED_COST_HINTS` |
| User Help | `apps/web/src/utils/glossary.util.ts:231` | the one string naming `visualize` → `visualize_d3` |

### The `d3` block contract + sandbox (shipped in #268)

`packages/core/src/contracts/d3-widget.contract.ts` — `D3BlockContentSchema` (handle branch first, `:52`): inline `{ program, title?, params?, rows }` or handle `{ program, title?, params?, ...QueryHandleEnvelopeFieldsSchema }`. Program signature: `new Function("api", program)`, `api = { d3, container, data, params, theme, width, height }`; CSP carries `'unsafe-eval'` for this; data arrives progressively (program must render idempotently). **The sandbox is the security boundary** (see Decision 4) — opaque origin (no `allow-same-origin`), `default-src 'none'` (no egress, no remote script), nonce-validated data bridge; it contains any program regardless of origin, so the codegen model's output is never security-load-bearing.

## The design space

### Decision 1 — Cost hint (revised: `expensive`, not `free`)

The who-pays rule (`tools.service.ts:740`): built-in tools that incur Portal-paid compute are charged. The inline shape (predecessor `visualize`) was `free` — one engine-pushdown SQL query, no Portal compute beyond it. **The dedicated codegen sub-call changes that**: each `visualize_d3` call makes a `claude-opus-4-8` invocation that Portal pays for.

| | `free` | `metered` | `expensive` |
|---|---|---|---|
| Portal-incurred cost | none | light (e.g. `web_search`) | heavy compute / premium model call |
| Fits an Opus codegen call | no | understates it | yes |

**Lean: `expensive`.** A per-call Opus invocation is a genuine heavyweight cost — the same class the gate exists to meter (#169). This is also the concrete reason the tool wants its **own pack** (Decision 6): an independently priced/gated cost surface. Add `visualize_d3: "expensive"` to `EXPECTED_COST_HINTS`; the `engineRead` helper (which hard-codes `costHint:"free"`) no longer fits — introduce a sibling capability helper (or an explicit capability literal).

### Decision 2 — Program authorship: dedicated codegen sub-call (decided)

The tool's job is to produce a correct D3 program. Who writes it?

**A. Inline (main agent).** The agent emits `d3Program` as a tool argument on `DEFAULT_MODEL`. Simplest, but: program quality rides the conversational model (Sonnet-4.6 today), there is **no retry loop** (a bad program → the sandbox error card, and the user must re-prompt), and model choice is a portal-wide concern, not tunable per-task.
**B. Dedicated codegen sub-call (decided).** `visualize_d3.execute` calls `claude-opus-4-8` (via a new `AiService` seam) with the data schema + samplePeek + intent + the runtime-API system prompt + the worked example, and gets back a program. The main agent only supplies intent. This isolates correctness-sensitive codegen on the best model, enables a validate-and-retry loop (Decision 4), and — the user's framing — establishes a **per-tool codegen-model convention** other toolpacks can reuse ("the best model for the task").

**Decision: B.** Tool input becomes `{ sql: z.string(), instruction: z.string().min(1), title: z.string().optional() }` (`instruction` = a natural-language description of the desired visualization). `execute`: `resolveSqlDelivery({ sql })` → derive `{ schema, samplePeek }` → codegen sub-call → validate/retry (Decision 4) → mint the `d3` block binding the *generated* program to the inline rows or the handle envelope. The codegen seam is `AiService.generateStructured`-style (new), taking a model id + effort so it's reusable.

### Decision 3 — The codegen model + effort

**Decision (user): `claude-opus-4-8` at `high`/`xhigh` effort.** D3 program synthesis is code generation where first-shot correctness dominates; Opus 4.8 is the strongest coding/knowledge-work tier. The model id + effort are a declared property of the codegen call, not hard-wired into agent flow — the reusable convention. (`claude-sonnet-5` is the value fallback if cost proves prohibitive; recorded, not chosen.)

### Decision 4 — Validation (revised: validate + retry server-side; sandbox is security, not correctness)

Making the renderer the validator is **bad UX** (user re-prompts on a compile failure). The dedicated sub-call makes real validation possible:

**A. Static parse + bounded codegen retry (decided floor).** After codegen, parse the program as a JS function body (a parser such as `acorn`). On a syntax error, retry the codegen call with the error fed back (bounded, e.g. 2 retries). Catches the "doesn't compile" case the user flagged before the block is ever minted.
**B. Headless execution smoke (enhancement).** Additionally run the program in a Node `jsdom` + `d3` harness against `samplePeek`, catching runtime throws (bad field refs, D3 misuse) too. Heavier, and jsdom SVG is imperfect, so runtime-only failures that slip through still land on the sandbox error card.
**Fallback on exhausted retries:** mint a `data-table` block from the rows instead of failing — the query succeeded, only the viz codegen didn't; the user still gets their data. (Graceful degradation, reuses existing rendering.)

**Lean: A now (parse + retry + data-table fallback); B as a fast-follow if the smoke walk shows runtime failures slipping through.** The Opus model + worked example should make both syntax and runtime failures rare.

**Security is a separate axis, already solved by #268 — validation is *not* the safety control.** The sandbox contains any program by construction: opaque origin (`sandbox="allow-scripts"` without `allow-same-origin` → no cookies/storage/parent-DOM, proven in #268 §3 smoke), `default-src 'none'` CSP (no network egress, no remote/"shadow" script can load; `'unsafe-eval'`-run code is subject to the same origin+CSP), data only over the nonce-validated bridge. A malicious or buggy program can at worst draw misleading SVG in its own frame or spin CPU (bounded by #268's watchdog + #271's teardown). So the codegen output is never security-load-bearing — consistent with the standing "safety via server/architecture enforcement, not prompt instructions" rule (`feedback_no_prompt_safety_gates`).

### Decision 5 — Inline block construction (unchanged)

No `AnalyticsService.visualizeD3`; the program reads `api.data`, so the tool attaches the (generated) program to the delivery result directly: inline → `{ type:"d3", program, title, rows }`; handle → `{ type:"d3", program, title, ...envelope }`. Include `type:"d3"` on the result for the client mint arm's robustness (matches `visualize`). No `params` in the tool input — the codegen model bakes constants into the program; `params` stays a block-content affordance for a future programmatic producer.

### Decision 6 — Toolpack placement: a dedicated `visualize` pack (decided)

`visualize`/`visualize_tree` live in `data_query` today. #269 introduces a **new `visualize` pack** holding `visualize_d3`.

**Decision (user): dedicated `visualize` pack.** It is a heavy, Opus-backed, `expensive`-classed tool the user may want to price and tier-gate independently — a separate pack is the clean entitlement + cost-class boundary (the contract-stability enterprise lens: shape it so a future paid tier plugs in without re-plumbing). The predecessor Vega tools stay in `data_query` until #272 deletes them (no value in moving doomed tools). **Sub-question — do data-table/markdown blocks belong to a `system` pack instead?** No: packs gate *tools*, not block types. `text`/markdown is the agent's own narrative output (no producing tool, no pack); `data-table` is produced by `sql_query` and rides `data_query`. A formal `system` pack for genuine always-on tools (`current_time`, `station_context`) is a reasonable *future* cleanup but out of scope for #269.

**SQL-guidance caveat:** the system-prompt SQL guidance is `data_query`-gated (`system.prompt.ts:217`). `visualize_d3` needs the agent to write `sql`, so with `visualize` as its own pack the guidance must also fire when `visualize` is enabled (extend the gate), or `visualize` documents that it expects `data_query` alongside. Lean: extend the prompt gate to `data_query || visualize`.

## Tradeoff comparison

| | D1 `expensive` | D2 dedicated codegen | D3 opus-4-8 | D4 validate+retry | D6 `visualize` pack |
|---|---|---|---|---|---|
| Spread to spec | Yes (capability + pin) | Yes (tool execute + AiService seam) | Yes (codegen call) | Yes (execute + tests) | Yes (pack + entitlement + prompt gate) |

## Recommendation

1. New `visualize` toolpack in `builtin-toolpacks.ts` holding `visualize_d3` (`parameterSchema` `{ sql, instruction, title? }`, required `["sql","instruction"]`); a capability with `resultKind:"d3"`, `costHint:"expensive"`; `visualize_d3:"expensive"` in `tool-capabilities.test.ts` `EXPECTED_COST_HINTS`; new-pack assertion in `builtin-toolpacks.test.ts`.
2. New `apps/api/src/tools/visualize-d3.tool.ts`: input `{ sql, instruction, title? }`; `execute` → `resolveSqlDelivery({ sql })` → derive `{ schema, samplePeek }` → codegen sub-call → parse-validate + bounded retry → mint `{ type:"d3", program, title, rows|…envelope }`; on exhausted retries, mint a `data-table` block from the rows.
3. New codegen seam on `AiService` (model id + effort parameterized — the reusable per-tool convention), plus a focused codegen system prompt (runtime `api` contract + worked example + progressive-idempotence rule). Codegen model = `claude-opus-4-8`, effort `high`/`xhigh`.
4. Register in `tools.service.ts` under a new `visualize` pack block; cost-gate wrap + #214 entitlement automatic once the pack exists.
5. `resolveDisplayBlock` (`portal.service.ts`) + `portal-stream.util.ts`: add the `d3` arm to both; `d3` in the client block-kind union.
6. `system.prompt.ts`: reach for `visualize_d3` for charts; it takes an `instruction` (describe the chart), not a program; extend the SQL-guidance gate to `data_query || visualize`.
7. Doc-sync: `glossary.util.ts:231` → `visualize_d3`; verify no other user-Help chart string names the tool.

## Open questions

All resolved with the issue author (2026-07-24):

1. **Toolpack placement.** **Resolved:** dedicated `visualize` pack (independent pricing/tier-gating for a heavy Opus-backed tool); data-table/markdown stay put (not a pack concern); a `system` pack for always-on tools is a future cleanup, not #269 (Decision 6).
2. **Worked `d3Program` example in the prompt.** **Resolved: yes** — one compact idiomatic example, a deliverable of the codegen system prompt; documents the progressive-idempotence rule by example.
3. **What the agent sees back.** `visualize` returns the envelope (rowCount/schema/samplePeek), never the full rows on the handle path. **Lean: identical** — the agent gets the display block; the rows reach the sandbox out-of-band, and the codegen sub-call sees only schema + samplePeek (not full rows). Confirm the inline path doesn't bloat the agent context with 100 rows (match `visualize` today).
4. **Program authorship.** **Resolved: dedicated `claude-opus-4-8` codegen sub-call** (not inline), establishing a reusable per-tool codegen-model convention (Decisions 2–3).

## Enterprise-scale considerations

- **Concurrency & correctness** — stateless request-scoped; reuses `resolveSqlDelivery`'s READ ONLY org-scoped path. The codegen sub-call adds no shared state. Bounded retry has a hard ceiling (no runaway loop).
- **Accuracy & auditability** — the codegen Opus call is metered through the cost gate (#169) as an `expensive` unit, so visualization spend is independently accountable — reinforced by the dedicated pack. Durable pipeline persistence (re-run past the handle TTL) is #270.
- **Failure modes** — layered and fail-*useful*: syntax failure → codegen retry; exhausted retries → `data-table` fallback (query data still delivered); runtime-only throw → sandbox error card (#268, contained). A SQL error surfaces through `resolveSqlDelivery` as `visualize` does. An Opus outage fails the tool call (typed result the agent relays) — no silent bad render.
- **Scale & unbounded growth** — inherits the delivery ceilings (inline ≤100, handle ≤`HANDLE_ROW_CAP`, sampled >50k); the codegen call sees only schema + a ≤10-row samplePeek, so its input is bounded regardless of result size. One extra Opus call per visualization is the new per-call cost — bounded, metered, and the reason for `expensive`.
- **Multi-tenancy** — org-scoped SQL + org-scoped handle; the codegen call receives only this org's schema/sample; the sandbox receives only this org's rows. No cross-tenant surface. The dedicated pack lets a tenant's tier gate visualization independently.
- **Contract stability** — `resultKind:"d3"` + `D3BlockContentSchema` are the stable seam (#268); the tool input `{ sql, instruction, title? }` is minimal and additive; the `visualize` pack + `expensive` cost class are the pricing/entitlement hooks the user asked to keep independent; the per-tool codegen-model seam generalizes to future tools. Nothing here re-plumbs a call site to add a paid tier later.
- **Data lifecycle** — persists nothing new (block content stored in `portal_messages.blocks` as today); durable pipeline re-execution is #270.

## What this doesn't decide

- **Removing `visualize`/`visualize_tree`** — #272 (they stay in `data_query` until then; no user sees both — the epic ships as one deployment).
- **Durable pipeline persistence / refresh** — #270 (block content carries the ephemeral handle exactly as vega blocks do).
- **Widget chrome / lazy-mounting** — #271.
- **A formal `system` toolpack** for `current_time`/`station_context` — a reasonable future cleanup surfaced by OQ1, but not this ticket.
- **Headless execution validation (Decision 4B)** — parked as a fast-follow if the smoke walk shows runtime failures slipping past parse-validation.
- **Sandbox security mechanics** — owned and shipped by #268; #269 relies on that boundary and adds no new execution surface.

## Next step

`docs/VISUALIZE_D3_TOOL.spec.md` pins: the `visualize` pack + `visualize_d3` capability (`expensive`, `resultKind:"d3"`), the tool input `{ sql, instruction, title? }`, the `AiService` codegen seam signature (model + effort) and codegen system-prompt text (with the worked example), the parse-validate + retry + data-table-fallback flow, the two block-mint arms, and the SQL-guidance gate extension. Then `.plan.md` slices it: (1) the `visualize` pack + capability + pins; (2) the `AiService` codegen seam + codegen prompt (unit-tested with a mocked model); (3) the tool `execute` (delivery → codegen → validate/retry/fallback → mint) + server/client block minting; (4) system-prompt guidance + doc-sync. Each a testable commit; the smoke walk drives a real agent chart prompt end-to-end (reusing #268's `d3`-block rendering) and specifically exercises the compile-failure retry and the data-table fallback.
