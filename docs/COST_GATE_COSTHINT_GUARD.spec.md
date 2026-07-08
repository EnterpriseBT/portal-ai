# Cost-gate costHint guard — Spec

Pins the contract for the #184 guardrail against a built-in tool silently metering as `free`. Discovery: `docs/COST_GATE_COSTHINT_GUARD.discovery.md`. Issue: [#184](https://github.com/EnterpriseBT/portal-ai/issues/184) (epic #177).

## Key decisions (flag for review)

1. **`costHint` is already required — Decision 2A is a no-op.** `ToolCapabilitySchema.costHint: CostHintSchema` (`packages/core/src/models/tool-capability.model.ts:144`) is **not** `.optional()`, and `ToolCapability = z.infer<…>` makes an omitted `costHint` a TypeScript **compile error**. Combined with `attachCapabilities()` throwing on a *missing* capability (`builtin-toolpacks.ts:1173`), a **declared** built-in can never reach `?? "free"`. So the spec drops the "make it required" work and narrows to the two things the type system does **not** catch.
2. **The live gap is a *value* drift.** `metered → free` (or a new billable tool shipped `free`) is a valid `CostHint` value, so neither TS nor Zod flags it. → **an explicit pinning test** over `ALL_TOOL_CAPABILITIES` (value-per-tool + key-set equality) is the primary deliverable.
3. **Residual runtime path: an unknown application tool name.** The only way to still hit `?? "free"` is a tool built in `buildAnalyticsTools` whose name is absent from `ALL_TOOL_CAPABILITIES` (a future non-registry app tool). → a **`logger.warn` in `metaFor`** for that case; keep `?? "free"` as the defensive final default.

## Scope

### In scope
- A pinning test locking every entry of `ALL_TOOL_CAPABILITIES` to an expected `costHint`, with key-set equality so adding/removing a tool forces a reviewed pin update.
- A `logger.warn` in `ToolService.buildAnalyticsTools`'s `metaFor` when an `application`-paid tool name is absent from `ALL_TOOL_CAPABILITIES`.

### Out of scope
- Making `costHint` required (**already required** — no change). Stated for the record.
- The `expensive` cost-acknowledgement dispatch flow, per-tool unit weights / `COST_RESOLVERS` (#84/#169).
- Custom/webhook tools — `costBearer: "organization"`, never charged regardless of `costHint`.

## Surface

### `packages/core/src/__tests__/registries/tool-capabilities.test.ts` (edit)

Add a pinning block that imports `ALL_TOOL_CAPABILITIES` (`../../registries/index.js`) and `CostHint`:

- `const EXPECTED_COST_HINTS: Record<string, CostHint>` — one entry for **every** tool currently in `ALL_TOOL_CAPABILITIES` (~31 built-in + 2 system). The billable ones are explicit: `web_search: "metered"`, `cluster: "expensive"`, `logistic_regression: "expensive"`, `transform_entity_records: "expensive"`; every other tool is `"free"`.
- **Value assertion:** for each `name` in `EXPECTED_COST_HINTS`, `ALL_TOOL_CAPABILITIES[name].costHint === EXPECTED_COST_HINTS[name]`.
- **Key-set equality:** `Object.keys(ALL_TOOL_CAPABILITIES).sort()` deep-equals `Object.keys(EXPECTED_COST_HINTS).sort()` — a new/removed tool fails until the pin is updated (the forced-review seam).

The expected map is authored from the registry inventory in the discovery doc; it is the source of truth the test enforces, not a mirror of the registry (mirroring would defeat the pin).

### `apps/api/src/services/tools.service.ts` (edit — `metaFor`, ~`:697–703`)

In the `application` branch, when the lookup misses, warn before defaulting:

```ts
const capability = ALL_TOOL_CAPABILITIES[name];
if (!isCustom && !capability) {
  logger.warn(
    { tool: name },
    "cost gate: application-paid tool has no capability entry; defaulting costHint=free — verify the tool is registered in ALL_TOOL_CAPABILITIES"
  );
}
```

Then return `costHint: isCustom ? (customCostHint[name] ?? "free") : (capability?.costHint ?? "free")` — behavior unchanged for known tools; the `?? "free"` stays as the defensive default so tool-build never throws. Uses the existing module `logger` (`tools.service.ts` already imports `createLogger`).

## Migration / Seed

**None.** No schema or DB change — `costHint` is already a required enum field; this ticket adds a test and a log line only.

## TDD test plan

Run per package — never invoke jest directly (`feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit      # the pin
cd apps/api && npm run test:unit           # the warn
```

### Layer 1 — core: the pin (`packages/core/src/__tests__/registries/tool-capabilities.test.ts`)
- Every tool in `EXPECTED_COST_HINTS` has the pinned `costHint` in `ALL_TOOL_CAPABILITIES`.
- Key-set equality: registry keys ≡ pin keys (drift in either direction fails).
- (Cheap invariant) every `ALL_TOOL_CAPABILITIES[*].costHint` is a valid `CostHint` — redundant with the schema but documents intent.

### Layer 2 — api: the `metaFor` warn (`apps/api/src/__tests__/services/tools.service.test.ts`)
- **Negative (primary):** building the real tool set (all packs enabled, as the existing guard test does) triggers **no** warn — proves no current built-in falls through the fallback (a live no-leak assertion). Spy the module `logger.warn`.
- **Positive (residual path):** if the plan extracts the app-branch resolution into a tiny exported helper (`resolveBuiltinCostMeta(name)`), unit-test that an unknown name logs + returns `free`. If not extracted, note this path is covered by inspection + the negative test (accepted gap — the type system makes the positive case unreachable for registry tools).

**Totals ≈ 4–5 cases** (3 core + 1–2 api). No migration test.

## Acceptance criteria
- [ ] Flipping any billable tool's `costHint` to `free` (or adding a tool without updating the pin) fails `packages/core` unit tests.
- [ ] Removing/renaming a tool without updating the pin fails the key-set assertion.
- [ ] The real tool build emits no cost-gate capability warning (no current leak).
- [ ] `costHint` remains a required field; no schema change shipped.
- [ ] `npm run lint && npm run type-check` clean in both packages.

## Risks & rollback
- **Maintenance cost:** the pin must be updated when a tool is added — that's the intended friction (a forced, reviewed cost-class decision), not a defect. Rollback = delete the test block + the warn; no runtime behavior changes either way (fail policy of the gate itself is unchanged — this ticket only adds detection).
- **False confidence:** the pin guards the *registry* value, not that a tool's declared class is *economically* right — that's a human review call, unchanged.

## Files touched
- Edit: `packages/core/src/__tests__/registries/tool-capabilities.test.ts` — the pin.
- Edit: `apps/api/src/services/tools.service.ts` — the `metaFor` warn.
- (If the positive api test is pursued) Edit: `apps/api/src/services/tools.service.ts` — extract `resolveBuiltinCostMeta`; and `apps/api/src/__tests__/services/tools.service.test.ts` — its unit test.

## Next step
`docs/COST_GATE_COSTHINT_GUARD.plan.md` — small, **2 slices**: (1) the core pin (test-only, highest value, lands first); (2) the `metaFor` warn + its api test. Both commit to `chore/cost-gate-costhint-guard`.
