# `visualize_d3` agent tool over SQL delivery — Plan

**TDD-sequenced implementation of the `visualize` toolpack, the `visualize_d3` tool with its dedicated Opus codegen sub-call, parse-validation + retry + data-table fallback, and the block-mint wiring.**

Spec: `docs/VISUALIZE_D3_TOOL.spec.md`. Discovery: `docs/VISUALIZE_D3_TOOL.discovery.md`. Issue: #269 (epic #267). Builds on **#268** (the `d3` block contract + sandbox renderer, merged into the epic branch — the tool produces blocks that renderer already displays).

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/visualize-d3-tool`** (base `epic/d3-dashboard-widgets`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — contract first, then the pure codegen machinery, then the tool that composes them, then the wiring that makes it render:

- **Slice 1** — the `visualize` pack + capability + pins. Pure core data; every later slice's registration references it. No `apps/api` dep.
- **Slice 2** — the `AiService.generateCode` seam, the codegen prompt, and `validateProgram`. Pure/leaf api logic (model mocked), no tool yet. Carries the new capability's *behavior* so slice 3 has no forward dep.
- **Slice 3** — the `visualize-d3.tool.ts` `execute` composing slices 1–2 (delivery → codegen → validate/retry/fallback → mint). The tool exists but isn't registered/routed yet.
- **Slice 4** — wire it live: register in `tools.service.ts`, the `d3` mint arms (server + client), system-prompt guidance + SQL-gate extension, doc-sync. **After this slice a real chart prompt renders end-to-end** and #270/#271/#272 have their producer.

No migration, no seed, no new dependency (`validateProgram` uses `new Function`).

---

## Slice 1 — `visualize` pack + `visualize_d3` capability + pins

The shared contract in `@portalai/core`. Nothing produces a block yet.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — add `VISUALIZE_PACK` (slug `visualize`, one tool `visualize_d3`, params `{ sql, instruction, title? }` required `["sql","instruction"]`), register in `BUILTIN_TOOLPACKS` (`:1190`); add the `visualize_d3` capability to `CAPABILITIES` (`:1048`) — `resultKind:"d3"`, `costHint:"expensive"`, `production.onLarge:"handle"` (the `engineRead` helper's `"free"` doesn't fit, so an explicit literal or a sibling helper).
- Edit: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`, `apps/api/src/services/tool-capabilities.test.ts` (or wherever `EXPECTED_COST_HINTS` lives).

**Steps**

1. **Tests (spec cases 1–5).** `visualize` pack exists with exactly `visualize_d3`; pack count +1 (1); params require `["sql","instruction"]`, `title` optional, no `d3Program`/`spec` (2); capability `resultKind:"d3"`/`costHint:"expensive"`/`onLarge:"handle"`, passes `ToolCapabilitySchema` (3); `EXPECTED_COST_HINTS.visualize_d3 === "expensive"` + pin-keyset==registry-keyset (4); tool name globally unique (5). Run; fail.
2. **Implement** the pack literal + capability + the `EXPECTED_COST_HINTS` entry. Green.
3. Lint + type-check.

**Done when:** cases 1–5 pass; `@portalai/core` exports the `visualize` pack; nothing in `apps/api`/`apps/web` references `visualize_d3` yet.

**Risk:** `engineRead` returns `costHint:"free"` — using it verbatim would fail the pin. The capability is an explicit literal (or a new `codegenRead` helper); test 3/4 catches a slip.

---

## Slice 2 — codegen seam + prompt + `validateProgram`

The pure machinery the tool will call: a task-scoped model call, the codegen system prompt, and the sandbox-parity validator. Model provider mocked; no tool yet.

**Files**

- Edit: `apps/api/src/services/ai.service.ts` — add `CODEGEN_MODEL = "claude-opus-4-8"` and `static async generateCode({ model?, effort?, system, prompt, generateText? })` (default model `CODEGEN_MODEL`, default effort `high` — the pinned `@ai-sdk/anthropic@3.0.58` ceiling; `xhigh` deferred to a v4 upgrade) over the AI SDK `generateText` + Anthropic provider, with an injectable `generateText` test seam (mirrors `spreadsheet-parsing-llm.service`).
- New: `apps/api/src/prompts/visualize-d3.prompt.ts` — `VISUALIZE_D3_CODEGEN_SYSTEM` (runtime `api` contract, idempotence rule, "function body only", one worked bar-chart example) + a `buildCodegenPrompt(instruction, schema, samplePeek, lastError?)` helper.
- New: `apps/api/src/tools/visualize-d3.validate.ts` (or a util) — `validateProgram(src) → { ok } | { ok:false, error }` via `new Function("api", src)` construction in try/catch (never called).
- New: tests `apps/api/src/__tests__/services/ai.service.test.ts`, `tools/visualize-d3.validate.test.ts`, `prompts/visualize-d3.prompt.test.ts`.

**Steps**

1. **Tests (spec cases 6–8).** `generateCode` calls the injected generate fn with the given/default model + default effort `high` (asserting it reaches `providerOptions.anthropic.effort`), returns the text (6); `validateProgram` accepts a good body, rejects a syntax error with the `SyntaxError` message, and returns `ok:true` for a body containing `fetch(...)`/`throw` — construction-only, never executes (7); `VISUALIZE_D3_CODEGEN_SYSTEM` contains the markers `new Function`, `api.data`, idempotence wording, "function body", and a worked example (8). Run; fail.
2. **Implement** the seam, the prompt constant + builder, and the validator. Green.
3. Lint + type-check.

**Done when:** cases 6–8 pass; the seam/prompt/validator exist and are unit-covered; no tool imports them yet.

**Risk:** mocking the AI SDK provider — mirror the existing pattern in `spreadsheet-parsing-llm.service` tests (the per-task-model precedent) so the mock shape is proven.

---

## Slice 3 — `visualize-d3.tool.ts` execute (delivery → codegen → validate/retry/fallback → mint)

The tool composing slices 1–2. It exists and is unit-tested but isn't registered or routed yet.

**Files**

- New: `apps/api/src/tools/visualize-d3.tool.ts` — `Tool` subclass mirroring `visualize.tool.ts:43`; input `{ sql, instruction, title? }`, `MAX_CODEGEN_RETRIES = 2`; `execute`: `resolveSqlDelivery` → derive `{ schema, samplePeek }` (handle: from envelope; inline: `Object.keys(rows[0])` + first ≤10 rows) → codegen loop with `validateProgram` + retry-with-error → mint `{ type:"d3", program, title, rows|…envelope }` → on exhausted retries, data-table fallback result + relay marker.
- New: `apps/api/src/__tests__/tools/visualize-d3.tool.test.ts` (mock `resolveSqlDelivery` + `AiService.generateCode`).

**Steps**

1. **Tests (spec cases 9–14).** inline → `{type:"d3",program,title,rows}`, codegen prompt got schema + ≤10-row samplePeek not full rows (9); handle → `{type:"d3",program,...envelope}`, no rows (10); parse-fail-then-succeed → 2 `generateCode` calls, d3 block (11); all-fail → data-table fallback + marker, `1+MAX_CODEGEN_RETRIES` calls (12); provider throws → typed tool result, no throw out of `execute` (13); empty `instruction` → schema rejects pre-SQL (14). Run; fail.
2. **Implement** the tool. Green.
3. Lint + type-check.

**Done when:** cases 9–14 pass; the tool is fully unit-covered; `buildAnalyticsTools` does not yet instantiate it.

**Risk:** the fallback returns `type:"data-table"` while the capability `resultKind` is `d3` — slice 4's mint arm must route on `toolResult.type`, not `resultKind` alone (flagged there). This slice only asserts the *tool's return shape*, so no cross-slice test.

---

## Slice 4 — wire it live: registration, mint arms, prompt, doc-sync

The tool goes live end-to-end. After this slice a chart prompt renders through #268's registry.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — `if (enabledPacks.has("visualize")) tools.visualize_d3 = new VisualizeD3Tool().build(...)`.
- Edit: `apps/api/src/services/portal.service.ts` — `resolveDisplayBlock` `d3` arm (guards `toolResult?.type === "d3"`, so the data-table fallback lands in the existing data-table arm).
- Edit: `apps/web/src/utils/portal-stream.util.ts` — `isD3` arm + `d3` in the client block-kind union.
- Edit: `apps/api/src/prompts/system.prompt.ts` — `visualize_d3` charting guidance; extend the SQL-guidance gate to `data_query || visualize`.
- Edit: `apps/web/src/utils/glossary.util.ts:231` — `visualize` → `visualize_d3`.
- Tests: `resolveDisplayBlock` d3 + fallback-routing (15–17); `portal-stream.util` d3 mapping (18); integration guard + e2e (19–20).

**Steps**

1. **Tests (spec cases 15–20).** `resolveDisplayBlock("visualize_d3", {type:"d3",...})` → d3 block (15); fallback `{type:"data-table"}` routes to data-table arm, not d3 (16); handle d3 → content carries `queryHandle`, `sseResult` set (17); client `tool_result` toolName `visualize_d3` → d3 block, and a `type:"d3"` result with another toolName also maps (18); guard: `buildAnalyticsTools` wraps `visualize_d3` through the cost gate when `visualize` enabled, absent when not (19); e2e (mocked codegen) → persisted `d3` block + SQL guidance present with only `visualize` enabled (20). Run; fail.
2. **Implement** the registration, both mint arms, the prompt guidance + gate extension, and the glossary edit. Green.
3. Lint + type-check; full `npm run test` at root.

**Done when:** cases 15–20 pass; a hand-driven `visualize_d3` result renders a `d3` block in the session (via #268's renderer); `system.prompt`/`builtin-toolpacks`/glossary agree. **#270/#271/#272 now have a live producer.**

**Risk:** the `d3`-arm-vs-data-table-fallback routing (spec Key decision + Surface) — test 16 is the fence. Also confirm the client union addition doesn't break existing block-type exhaustiveness checks.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `visualize` pack + capability + pins | 1–5 | core unit |
| 2 | `AiService.generateCode` + codegen prompt + `validateProgram` | 6–8 | api unit |
| 3 | `visualize-d3.tool.ts` execute (delivery→codegen→validate/retry/fallback→mint) | 9–14 | api unit |
| 4 | registration + mint arms + prompt/gate + doc-sync | 15–20 | api unit + integration, web unit |

Total ≈ **20 cases**, no migration, no new dependency. Commits on `feat/visualize-d3-tool`; PR opened after these docs confirm, growing commit-by-commit.

## Cross-slice notes

- **`resultKind` is not the sole router** — the data-table fallback (slice 3) returns `type:"data-table"` under a `d3`-capability tool, so the slice-4 mint arms route on `toolResult.type === "d3"` first (matching how custom/webhook tools already route by `result.type`). Test 16 pins it; getting this wrong sends the fallback to the d3 renderer, which would try to run an absent program.
- **Codegen effort defaults to `high` on `claude-opus-4-8`** (slice 2) — the pinned `@ai-sdk/anthropic@3.0.58`'s `effort` enum ceiling; the API's `xhigh` isn't in this SDK version. The seam's `effort` param already accepts `xhigh`, so lifting the default is a one-line change once `@ai-sdk/anthropic` is bumped to v4 (a breaking major that also drives the main agent loop — a scoped follow-up, out of #269). The `expensive` cost class (slice 1) is the billing consequence regardless of effort.
- **The `d3` block contract is #268's** (`D3BlockContentSchema`, handle branch first) — the tool's mint shapes must satisfy it; slice 3 builds against that shipped schema (no core change here).
- **Doc-sync is in-PR (slice 4), not deferred** — `system.prompt.ts`, the `builtin-toolpacks.ts` mirror, and `glossary.util.ts` all move with the code; the pinning tests (`builtin-toolpacks.test.ts`, `system.prompt.test.ts` if it asserts the guidance) catch a mirror slip. Vega-copy removal is #272's sweep, not this PR.
- **CLAUDE.md compliance:** tool/prompt/service file suffixes, server-enforced cost gate (the `expensive` class, not prompt text — `feedback_no_prompt_safety_gates`), SDK-helper rules N/A (api-only), npm-scripts-only testing.

## Next step

Implement slice 1 on this branch once discovery + spec + plan are confirmed: tests-first, one commit per slice (`feat(core): …` for slice 1, `feat(api): …` for 2–3, `feat(api,web): …` for 4).
