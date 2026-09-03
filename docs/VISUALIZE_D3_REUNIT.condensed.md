# Re-unit `visualize_d3` — Condensed design (#499)

**Issue:** [EnterpriseBT/portal-ai#499](https://github.com/EnterpriseBT/portal-ai/issues/499) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The `expensive` cost class charges `visualize_d3` (≈$0.06/call — an Opus 4.8 codegen) and a `bulk_geocode_records` row (≈$0.00075) the same 1 unit — an 80× per-unit spread that made #495's T2 ceiling check unpassable (Pro's geocode-sized 20,000-unit allocation carries a ~$1,200 adversarial ceiling if spent on d3). This closes the gap by charging d3 its measured cost ratio through the existing per-tool resolver seam. Packages touched: `apps/api`, `packages/core` (description mirror), `docs/TIER_PRICING_MODEL.md`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Resolver seam | `apps/api/src/services/cost-gate.service.ts:50-72` | `COST_RESOLVERS` + `registerCostResolver(toolName, fn)`; default 1 unit/call |
| Registration precedent | `apps/api/src/services/geocoding/cost-resolvers.ts` (registered at tool build, `tools.service.ts:549`, idempotent) | cache-hit → 0 units |
| Admission math | `cost-gate.service.ts:151-196` | quota check uses `units`; **rate window counts calls, not units** (`incrementRateWindow` takes no units) — so 80/call leaves `ratePerMin` semantics untouched; Pro = 20,000/80 = 250 d3 calls/mo |
| The tool | `apps/api/src/tools/visualize-d3.tool.ts:79-140` | Opus codegen (`CODEGEN_MODEL`), up to 3 attempts (`MAX_CODEGEN_RETRIES = 2`); charged only on success (two-phase gate) |
| Advisory mirror | `packages/core/src/registries/builtin-toolpacks.ts` visualize pack (tool contract pinned at `builtin-toolpacks.test.ts:166-171`) | description must stay in sync with the tool file |
| Model doc | `docs/TIER_PRICING_MODEL.md` §1 (worst-rate ≈$0.06/unit), §5 (T2 fail-with-closure), §6 (verdict names #499) | the numbers this change flips |

## Decision — resolver constant, not `perToolCaps`

**Register `visualize_d3` at 80 units/call** via `registerCostResolver` — one registration in the existing seam, mirroring geocoding; the class's per-unit vendor cost equalizes to ≈$0.00075 and Pro's adversarial expensive ceiling drops $1,200 → ~$15. The alternative — enforcing the inert `perToolCaps` column — builds new enforcement machinery (schema plumbing, admission logic, per-tier data) for the same outcome; rejected. **80** comes from the model's ratio ($0.06 ÷ $0.00075); each codegen attempt logs its actual Opus token usage so the next model re-run replaces the estimate with measurement. Retry nuance, accepted and recorded: a success after failed attempts costs up to 3× vendor-side but still charges 80 (charge is per successful call; total failures charge nothing — bill-on-success rule).

## Plan — 1 slice

**Files**

- Edit `apps/api/src/tools/visualize-d3.tool.ts` — export `VISUALIZE_D3_UNITS_PER_CALL = 80` (comment cites `docs/TIER_PRICING_MODEL.md` §1); append to `description`: "Each call charges 80 usage units from the organization's expensive allocation — the heaviest single charge in the catalog; prefer one well-specified call over iterating."
- Edit `apps/api/src/services/ai.service.ts` — `generateCode` logs each call's token usage (`{ model, inputTokens, outputTokens }`, module `ai-codegen`): one line per d3 codegen attempt, and every future codegen consumer inherits the telemetry the model re-run needs.
- Edit `apps/api/src/services/tools.service.ts` — `registerCostResolver("visualize_d3", () => VISUALIZE_D3_UNITS_PER_CALL)` where the tool is built (geocoding precedent; idempotent).
- Edit `packages/core/src/registries/builtin-toolpacks.ts` — mirror the description sentence (hand-authored mirror rule).
- Edit `docs/TIER_PRICING_MODEL.md` — §1: d3 row → 80 units ≈ $0.00075/unit, class worst-rate → $0.00075; §5: recompute T2 (Pro ceiling ≈ $135 gated-tools total → inside 2×$99 for the tool half; the LLM-turn term remains #498's); §6: verdict → `implemented (#499)`.
- `system.prompt.ts`: no cost prose exists for d3 (checked) — no edit.

**Tests**

- `apps/api/src/__tests__/services/cost-gate.resolve.test.ts` — extend: after registration, `resolveCallCost("visualize_d3", {})` → 80; unregistered tools still default to 1.
- `apps/api/src/__tests__/tools/visualize-d3.tool.test.ts` — extend: the exported constant is 80; description carries the charge sentence.
- `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` — mirror pin updated to the new sentence.
- Run: `cd apps/api && npm run test:unit -- --testPathPattern "cost-gate.resolve|visualize-d3"`; `cd packages/core && npm run test:unit -- --testPathPattern builtin-toolpacks`.

## Smoke (manual, against your dev stack)

1. On a visualize-entitled station, prompt a portal session: "chart total records per entity as a bar chart" → chart renders. (No cost-ack: the ack handshake is a per-tool `acknowledgeCost` schema field — `transform_entity_records` carries it, `visualize_d3` does not; charging is independent of ack.)
2. Settings → Subscription & Billing → Itemized usage: the `visualize_d3` row shows **80 units**; the expensive balance dropped by exactly 80.
3. API log shows one `visualize-d3` token-usage line for the call (`inputTokens`/`outputTokens` present).
4. Edge: set a test org's expensive allocation below 80 (`db psql` UPDATE on `tiers` clone or a custom tier), retry step 1 → typed `TOOL_USAGE_QUOTA_EXCEEDED` result relayed by the agent; ledger shows **no** charge.
5. `web_search` and `geocode` calls still charge 1 unit (resolver isolation).

## Out of scope

- Enforcing `perToolCaps` (stays inert; rejected above).
- The agent-turn rate ceiling (#498) — T2's LLM term closes there.
- Any allocation/price change — #495 set them; this changes only what a d3 call debits.
