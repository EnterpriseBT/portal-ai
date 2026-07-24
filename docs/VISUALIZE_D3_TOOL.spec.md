# `visualize_d3` agent tool over SQL delivery — Spec

**Issue:** [EnterpriseBT/portal-ai#269](https://github.com/EnterpriseBT/portal-ai/issues/269) · **Epic:** #267 · **Discovery:** `docs/VISUALIZE_D3_TOOL.discovery.md`

Pins the contract for the tool that produces `d3` blocks: a new `visualize` toolpack, the `visualize_d3` tool taking **intent** (`{ sql, instruction, title? }`), a reusable `AiService` codegen seam that synthesizes the D3 program on `claude-opus-4-8`, parse-validation + bounded retry + data-table fallback, the two block-mint arms, and the `expensive` cost class.

## Key decisions (from discovery, all resolved)

1. **Dedicated `visualize` toolpack** — `visualize_d3` alone; independent tier-gating + cost class (D6). Vega tools stay in `data_query` until #272.
2. **Agent supplies intent, not a program** — tool input `{ sql, instruction, title? }`; the tool does codegen internally (D2).
3. **Codegen on `claude-opus-4-8`, effort `high`** — via a reusable `AiService` seam parameterized by model + effort (D3).
4. **Parse-validate + bounded retry, then `data-table` fallback** — the user never re-prompts for a compile failure; the sandbox error card (#268) is the contained last-resort for runtime-only throws. Validation is correctness/UX; **security is #268's sandbox boundary, not this tool's concern** (D4).
5. **`costHint: "expensive"`** — each call is an Opus invocation (D1), metered through the #169 gate.
6. **No new `AnalyticsService` method** — the tool attaches the generated program to the delivery result directly (D5).

## Scope

### In scope
1. New `visualize` pack + `visualize_d3` capability in `packages/core/src/registries/builtin-toolpacks.ts`; `EXPECTED_COST_HINTS` + pack-count pins.
2. `apps/api/src/tools/visualize-d3.tool.ts` (new).
3. `AiService` codegen seam (`ai.service.ts`) + codegen system prompt (`apps/api/src/prompts/`).
4. `d3` arm in `resolveDisplayBlock` (`portal.service.ts`) and `portal-stream.util.ts` (+ client block-kind union).
5. `system.prompt.ts` guidance + SQL-guidance gate extension to `data_query || visualize`.
6. Doc-sync: `glossary.util.ts:231`.

### Out of scope
Durable pipeline/refresh (#270); Vega removal (#272); widget chrome (#271); headless *execution* validation (parse-only here); a `system` pack for `current_time`/`station_context`; sandbox security mechanics (#268).

## Surface

### `visualize` toolpack + capability — `packages/core/src/registries/builtin-toolpacks.ts`

New pack literal (mirrors `DATA_QUERY_PACK` at `:157`), registered in `BUILTIN_TOOLPACKS` (`:1190`):

```ts
const VISUALIZE_PACK: BuiltinToolpackSpec = {
  slug: "visualize",
  name: "Visualize",
  description: "Render expressive, interactive D3 visualizations from SQL query results.",
  iconSlug: "InsertChart", // an existing MUI icon slug
  tools: [
    {
      name: "visualize_d3",
      description:
        "Render an interactive D3 visualization from a SQL query. Describe the chart you want in `instruction` (type, encodings, emphasis) — the program is generated for you. Do not add a LIMIT; result size is handled automatically (rows stream to the widget via a handle when large).",
      parameterSchema: objectSchema(
        {
          sql: stringField("The SQL query whose rows feed the visualization"),
          instruction: stringField(
            "A natural-language description of the visualization to render (chart type, which columns map to which encodings, and any emphasis/among the columns returned by `sql`)."
          ),
          title: stringField("Optional display title for the widget"),
        },
        ["sql", "instruction"]
      ),
    },
  ],
};
```

Capability (the `engineRead` helper hard-codes `costHint:"free"` and no longer fits — add a sibling helper or an explicit literal) in the `CAPABILITIES` map (`:1048`):

```ts
// A codegen-backed engine read: reads entity_records like engineRead, but the
// per-call Opus codegen invocation makes it application-metered `expensive`.
visualize_d3: {
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "engine-pushdown" },
  computeShape: "visualize",
  costHint: "expensive",
  locks: [],
  resultKind: "d3",
  production: { kind: "rows", onLarge: "handle" },
  alwaysAvailable: false,
},
```

`apps/api/src/services/tool-capabilities.test.ts` `EXPECTED_COST_HINTS` gains `visualize_d3: "expensive"`; `builtin-toolpacks.test.ts` pack-count assertion (`:14`) bumps by one and asserts the `visualize` pack + its single tool.

### `AiService` codegen seam — `apps/api/src/services/ai.service.ts`

Add a focused, non-streaming structured-generation call parameterized by model + effort (the reusable per-tool convention; precedent: `spreadsheet-parsing-llm.service.ts`). Uses the AI SDK `generateText` with the Anthropic provider:

```ts
static readonly CODEGEN_MODEL = "claude-opus-4-8";

/**
 * A focused single-shot text generation at a task-specific model + effort —
 * distinct from the conversational agent loop (DEFAULT_MODEL). Reusable by any
 * tool that needs "the best model for a codegen/synthesis subtask".
 */
static async generateCode(params: {
  model?: string;          // defaults to CODEGEN_MODEL
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // defaults to "high" (SDK 3.0.58 ceiling; xhigh deferred to the v4 upgrade)
  system: string;
  prompt: string;
}): Promise<string>;
```

Effort is passed through the provider's Anthropic options (adaptive thinking + `effort`), defaulting to **`high`** — the ceiling the pinned `@ai-sdk/anthropic@3.0.58` exposes (its typed `effort` enum is `low|medium|high|max`; `xhigh` exists at the API but not in this SDK version). Lifting the default to `xhigh` is a recorded follow-up gated on a deliberate `@ai-sdk/anthropic` v4 upgrade (a breaking major that also drives the main agent loop — out of #269's scope). The seam's `effort` param still accepts `xhigh` so the follow-up is a one-line default change. The return is the raw model text (the D3 program body). No streaming (the sub-call is internal to one tool `execute`).

### Codegen system prompt — `apps/api/src/prompts/visualize-d3.prompt.ts` (new)

A constant `VISUALIZE_D3_CODEGEN_SYSTEM` stating:
- The program is a **function body** executed as `new Function("api", program)`; `api = { d3, container, data, params, theme, width, height }`.
- **Render idempotently from `api.data`** — it may be re-invoked as batches arrive; clear/redraw, never assume all rows are present or append blindly.
- Size to `api.width`/`api.height`; color from `api.theme` (categorical palette, fg/bg, fonts).
- Output **only** the function-body JS — no markdown fence, no `function` wrapper.
- **One worked example** (a compact SVG bar chart reading `api.data`/`api.theme`), explicitly labelled "a pattern, not a template."

The per-call user `prompt` interpolates: the `instruction`, the result `schema` (column names + types), and the `samplePeek` (≤10 rows) — never the full dataset.

### `visualize_d3` tool — `apps/api/src/tools/visualize-d3.tool.ts` (new)

Mirrors `visualize.tool.ts:43` structurally (`Tool` subclass, `build()` → AI-SDK `tool({...})`).

```ts
const InputSchema = z.object({
  sql: z.string().describe("SQL query to fetch visualization data"),
  instruction: z.string().min(1).describe("What to visualize (chart type, encodings, emphasis)"),
  title: z.string().optional(),
});

const MAX_CODEGEN_RETRIES = 2; // total codegen attempts = 1 + retries
```

`execute` flow:
1. `delivery = await resolveSqlDelivery({ sql }, { stationId, organizationId })`.
2. Derive `{ schema, samplePeek }`: **handle** → from `delivery.envelope` (`schema`, `samplePeek`); **inline** → `schema` from `Object.keys(rows[0])`, `samplePeek` = first ≤10 rows (rows from the `PortalSqlResponse` shape).
3. Codegen loop (≤ `1 + MAX_CODEGEN_RETRIES`): `program = await AiService.generateCode({ system: VISUALIZE_D3_CODEGEN_SYSTEM, prompt: buildPrompt(instruction, schema, samplePeek, lastError?) })`; `validateProgram(program)` (parse — see below). On parse failure, loop with the error appended to the prompt.
4. On success → mint `{ type: "d3", program, title, ...binding }` where binding is inline `{ rows }` (the full inline rows) or the handle `{ ...envelope }` (matching `D3BlockContentSchema`'s two arms).
5. On exhausted retries → **fall back**: return the delivery as a `data-table` result (handle envelope tagged `type:"data-table"`, or `{ type:"data-table", rows }` inline) so `resolveDisplayBlock` renders the data; include a marker the agent can relay ("visualization codegen failed; showing data as a table").

`validateProgram(src: string)`: construct `new Function("api", src)` inside a try/catch — **construction only, never called**. A `SyntaxError` means the program won't parse; return `{ ok: false, error: err.message }`, else `{ ok: true }`. This is the *exact* parser the sandbox bootstrap uses (`new Function("api", program)`), so validation can't diverge from what the frame accepts — and it adds **no new dependency**. **Never executes** the program (that's the sandbox's job).

### Block minting

**Server — `resolveDisplayBlock` (`portal.service.ts:149`)**: add a `d3` arm beside the vega arms (`:177`). Since the tool's result content already matches `D3BlockContentSchema`, pass it through verbatim:
```ts
if (resultKind === "d3" || (resultKind === undefined && toolResult?.type === "d3")) {
  return { block: { type: "d3", content: toolResult }, sseResult: toolResult ?? undefined };
}
```
(The `data-table` fallback result carries `resultKind` `d3` but `type:"data-table"` — route it via the existing data-table arm by checking `toolResult?.type` first, i.e. the `d3` arm guards on `toolResult?.type !== "data-table"`. Alternatively the fallback returns through the tool as a plain data-table result; spec chooses: **the `d3` arm only fires when `toolResult?.type === "d3"`**, so the fallback naturally lands in the data-table arm.)

**Client — `portal-stream.util.ts:127`**: add, alongside `isVegaLite`/`isVega`:
```ts
const isD3 = result != null && typeof result === "object" &&
  (data.toolName === "visualize_d3" || result["type"] === "d3");
// ... else if (isD3) block = { type: "d3", content: result };
```
Add `"d3"` to the client `PortalMessageBlock`-kind union comment/type at `:37`.

### Agent guidance — `apps/api/src/prompts/system.prompt.ts`

- Charting guidance: reach for `visualize_d3` for any chart/graph; it takes an `instruction` describing the chart (not a program) plus the `sql`.
- Extend the SQL-guidance gate (`:217`, currently `enabledPacks.has("data_query")`) to `data_query || visualize` so a `visualize`-only station still gets SQL authoring guidance.

### Registration — `apps/api/src/services/tools.service.ts`

New block beside the `data_query` one (`:508`): `if (enabledPacks.has("visualize")) tools.visualize_d3 = new VisualizeD3Tool().build(stationId, organizationId);`. Cost-gate wrap (`:720`) + #214 entitlement automatic.

### Doc-sync — `apps/web/src/utils/glossary.util.ts:231`

The lone `visualize`-naming string → `visualize_d3`. Sweep glossary/FAQ for other chart-tool mentions (survey found none needing change).

## Migration / Seed

None — no schema, no DB, **no new dependency** (validation uses the built-in `new Function` constructor). Stated per template.

## TDD test plan

Run via npm scripts: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`.

### Layer 1 — core registry (`packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` + `tool-capabilities` pins)
1. `visualize` pack exists with slug/name and exactly the `visualize_d3` tool; pack count incremented.
2. `visualize_d3` parameterSchema requires `["sql","instruction"]`, `title` optional; no `d3Program`/`spec` field.
3. `visualize_d3` capability: `resultKind:"d3"`, `costHint:"expensive"`, `production.onLarge:"handle"`; passes `ToolCapabilitySchema`.
4. `EXPECTED_COST_HINTS.visualize_d3 === "expensive"`; pin key-set == registry key-set (adding the tool without the pin fails).
5. `visualize_d3` tool name is globally unique across packs.

### Layer 2 — codegen seam + validation (`apps/api/src/__tests__/services/ai.service.test.ts`, `tools/visualize-d3.validate.test.ts`)
6. `AiService.generateCode` calls the injected generate fn with the given model (defaults `CODEGEN_MODEL`) + effort (defaults `high`, reaching `providerOptions.anthropic.effort`) and returns the text.
7. `validateProgram` accepts a well-formed function body; rejects a syntax error with the `SyntaxError` message; **never executes** (a body containing `fetch(...)` or a `throw` still validates `ok:true` — construction-only). Uses `new Function("api", src)` construction, matching the sandbox bootstrap exactly.
8. `VISUALIZE_D3_CODEGEN_SYSTEM` contains the load-bearing contract markers: `new Function`, `api.data`, idempotence wording, "function body only", and a worked example.

### Layer 3 — tool execute (`apps/api/src/__tests__/tools/visualize-d3.tool.test.ts`, mocking `resolveSqlDelivery` + `AiService.generateCode`)
9. Inline delivery + valid program → `{ type:"d3", program, title, rows }`; codegen prompt received schema + ≤10-row samplePeek, **not** full rows.
10. Handle delivery + valid program → `{ type:"d3", program, ...envelope }` (queryHandle present; rows absent).
11. First program fails parse → retries codegen with the error in the prompt; second succeeds → d3 block (assert 2 `generateCode` calls).
12. All attempts fail parse → **data-table fallback** result (`type:"data-table"`, rows or handle) + relay marker; `generateCode` called `1+MAX_CODEGEN_RETRIES` times.
13. Codegen model error (provider throws) → typed tool result the agent relays (no throw out of `execute`).
14. `instruction` empty → schema rejects before any SQL/codegen (guard).

### Layer 4 — block minting (`apps/api/src/__tests__/services/portal.service.*` or a focused `resolveDisplayBlock` test)
15. `resolveDisplayBlock("visualize_d3", { type:"d3", program, rows })` → `{ block: { type:"d3", content } }`.
16. `resolveDisplayBlock("visualize_d3", { type:"data-table", … })` (fallback) → routes to the **data-table** block, not d3.
17. Handle-shaped d3 result → block content carries `queryHandle` (sseResult set).

### Layer 5 — web client mapping (`apps/web/src/__tests__/portal-stream.util.test.ts` if present, else a focused unit)
18. `tool_result` with `toolName:"visualize_d3"` → `{ type:"d3", content }` streaming block; a `type:"d3"` result with a different toolName also maps to d3.

### Layer 6 — integration (`apps/api` integration)
19. Guard test: `buildAnalyticsTools` for a station with the `visualize` pack enabled wraps `visualize_d3` through the cost gate (spy on `resolveCostGate`); a station without `visualize` does not offer it.
20. End-to-end (mocked codegen model): a `visualize_d3` call with `visualize` enabled yields a persisted `d3` block; SQL-guidance prompt present when only `visualize` is enabled.

**Totals ≈ 20 cases** (5 core, 3 seam, 6 tool, 3 minting, 1 web, 2 integration). No migration/seed test.

## Acceptance criteria

- [ ] A portal chart prompt yields a `visualize_d3` call carrying an `instruction`; the tool's Opus codegen produces a program that renders through the #268 sandbox — live over SSE and after reload from persisted blocks.
- [ ] A program that fails to parse triggers a bounded codegen retry with no user involvement; exhausted retries fall back to a `data-table` block (query data still delivered).
- [ ] >100 rows → handle path (rows never in agent context); ≤100 → inline. The codegen call sees only schema + ≤10-row samplePeek, never the full result.
- [ ] `visualize_d3` lives in the `visualize` pack, is cost-gated as `expensive` (guard test), and is entitlement-gated independently of `data_query`.
- [ ] Tool description, `builtin-toolpacks.ts` mirror, and system-prompt guidance agree (pins + doc-sync); `glossary.util.ts` names `visualize_d3`.
- [ ] `npm run lint && npm run type-check && npm run test` green at root.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Opus codegen latency adds a visible pause before the chart. | Acceptable for an `expensive` tool; the agent can say "building the chart"; effort tunable down to `high`/`medium`. Measured in smoke. |
| Parse-validation passes a program that throws at render (runtime-only error). | Contained by the #268 sandbox error card; headless execution validation is a parked fast-follow if smoke shows it's common. |
| Codegen model outage breaks all charting. | `execute` returns a typed tool result the agent relays (fail-*useful*, not a throw); the data-table fallback path also covers the case where codegen can't produce valid output. |
| `expensive` cost newly charges for charts that were free under Vega. | Intentional (the Opus call is real cost) and the reason for the dedicated pack — orgs gate/price it independently. Called out in the epic's user-facing notes. |
| Server-side validation accepts a program the browser frame later rejects at parse. | `validateProgram` uses `new Function("api", src)` construction — the *exact* call the sandbox bootstrap makes — so acceptance can't diverge. Test 7 pins it. |

**Rollback:** pure revert — no schema, no persisted-shape change. Removing the pack + tool + arms restores prior behavior (no d3 producer; #268's renderer simply has nothing to render).

## Files touched

**`packages/core`** — edit: `registries/builtin-toolpacks.ts` (+`VISUALIZE_PACK`, capability), tests (`builtin-toolpacks.test.ts`, `tool-capabilities.test.ts`).

**`apps/api`** — new: `tools/visualize-d3.tool.ts`, `prompts/visualize-d3.prompt.ts`, tests; edit: `services/ai.service.ts` (+`generateCode`/`CODEGEN_MODEL`), `services/tools.service.ts` (register), `services/portal.service.ts` (`resolveDisplayBlock` d3 arm), `prompts/system.prompt.ts` (guidance + gate). No new dependency.

**`apps/web`** — edit: `utils/portal-stream.util.ts` (d3 arm + union), `utils/glossary.util.ts` (doc-sync); test.

**No** DB/migration/infra/env change.

## Next step

`docs/VISUALIZE_D3_TOOL.plan.md` slices: (1) `visualize` pack + capability + pins (core unit); (2) `AiService.generateCode` seam + codegen prompt + `validateProgram` (api unit, mocked model); (3) `visualize-d3.tool.ts` execute — delivery → codegen → validate/retry/fallback → mint (api unit); (4) server + client block minting + `system.prompt` guidance/gate + doc-sync (api/web unit + integration guard). Each a testable commit; the smoke walk drives a real agent chart prompt end-to-end and specifically exercises the compile-retry and the data-table fallback.
