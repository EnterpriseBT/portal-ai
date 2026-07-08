# Cost-gate costHint guard — Discovery

**Issue:** [EnterpriseBT/portal-ai#184](https://github.com/EnterpriseBT/portal-ai/issues/184)

**Why this exists.** The #169 cost gate charges a built-in tool only when its `costHint` is `metered` or `expensive`; a `free` tool is immune. The per-tool class is resolved in `ToolService.buildAnalyticsTools` via `ALL_TOOL_CAPABILITIES[name]?.costHint ?? "free"` (`apps/api/src/services/tools.service.ts:702`). That `?? "free"` is a **silent** default: a built-in that *should* be billable but whose `costHint` is absent or mis-typed resolves to `free`, is short-circuited as immune, and is never charged — with no signal. On a per-org billing feature that's a revenue leak that only surfaces in a usage audit, not at build or run time.

This is the guardrail that makes an application-paid tool's cost class **impossible to omit silently** — a pinning test that fails loudly when a built-in's class drifts, plus a root-cause change so the fallback can't apply to a declared tool.

## The current shape

### Where the silent default lives

| Symbol | Location | Role |
|---|---|---|
| `metaFor` fallback | `apps/api/src/services/tools.service.ts:702` | `ALL_TOOL_CAPABILITIES[name]?.costHint ?? "free"` — the silent default for built-ins |
| the wrap | `apps/api/src/services/tools.service.ts:693–705` | `wrapWithCostGate(tools, {org,user}, metaFor)` — supplies `{costBearer, costHint}` per tool |
| gate short-circuit | `apps/api/src/services/cost-gate.service.ts` (`resolveCostGate`) | `costHint === "free"` ⇒ allowed, never charged |

Two distinct fallback paths hide in that one line: **(a)** the tool name is absent from `ALL_TOOL_CAPABILITIES` (`?.` yields `undefined`), and **(b)** the capability exists but its `costHint` is `undefined` (`?? "free"`). Both land on `free`.

### The registry (source of truth)

`ALL_TOOL_CAPABILITIES` is assembled once in `packages/core/src/registries/tool-capabilities.ts:62–70` — the spread of `SYSTEM_TOOL_CAPABILITIES` (`:30–56`, for `current_time` / `station_context`) plus every tool's `capability` from `BUILTIN_TOOLPACKS`. The capability matrix that sets each `costHint` lives in `packages/core/src/registries/builtin-toolpacks.ts:1043–1164` via helpers (`pureMath`, `engineRead`, `enginePushdownReduce`, `streamingReduce`, `entityWrite`, and inline definitions).

### The guard that already exists (partial)

`attachCapabilities()` (`builtin-toolpacks.ts:1168–1181`) **throws at module load** if a `BUILTIN_TOOLPACKS` tool has *no* capability entry:

```
builtin-toolpacks: no capability declared for tool '<name>'
```

So fallback path (a) **cannot happen for a registry tool** — a fully un-tagged built-in already fails the build. What `attachCapabilities` does **not** check: that `costHint` is *present and correct* on the capability it validates. A capability with an omitted or wrong-but-valid `costHint` (e.g. a new metered tool shipped as `free`, or `web_search` flipped to `free`) passes today with zero signal.

### `CostHint` type

`packages/core/src/models/tool-capability.model.ts:98` — `CostHintSchema = z.enum(["free","metered","expensive"])`. Whether `costHint` is `.optional()` on `ToolCapabilitySchema` is the crux of fallback path (b) and is the one thing to confirm before the spec (see Open questions).

### Current cost classes (raw material for the pin)

From `builtin-toolpacks.ts:1043–1164` + `tool-capabilities.ts:30–56`:

- **metered (1):** `web_search` (`:1124`).
- **expensive (3):** `cluster` (`:1060`), `logistic_regression` (`:1076`), `transform_entity_records` (`:1157`).
- **free (rest):** all `pureMath`/`engineRead`/`enginePushdownReduce`/`streamingReduce`-default tools, `technical_indicator`, all `entityWrite` tools, and the 2 system tools (`current_time`, `station_context`).

Total ≈ 31 built-in + 2 system. The **billable** set (metered + expensive = 4 tools) is what a leak would silently zero out — that's the set the pin most needs to lock.

### The existing guard test

`apps/api/src/__tests__/services/tools.service.test.ts:684–736` — `"wraps every built tool's execute with the cost gate"`. Enables all packs (+ `entity_management`, + a `portalId` to activate `transform_entity_records`), spies `CostGateService.resolveCostGate` with a deny sentinel, invokes each tool's `execute`, asserts the gate fired for every tool. It proves *wrapping*, not *class correctness*. A costHint pin lives in this same file with the same pack-enabling setup, but asserts against `ALL_TOOL_CAPABILITIES` directly.

### Dev-time signal precedents

- **Build-time throw:** `attachCapabilities` (`builtin-toolpacks.ts:1173`) — synchronous, kills module load on drift.
- **Runtime warn (fail-soft):** `cost-gate.service.ts:157` — `logger.warn({err, tool, organizationId}, "…")` for a non-fatal fallback.

## The design space

### Decision 1 — How to pin the cost classes

**A. Explicit expected map.** A test holds `{ web_search: "metered", cluster: "expensive", … }` for every built-in and asserts `ALL_TOOL_CAPABILITIES[name].costHint` matches, **and** that the map's key set equals the registry's tool set (so adding a tool forces updating the pin).

**B. Invariant only.** Assert weaker properties: every built-in has a `costHint` that's a valid `CostHint`, and none resolves via the `?? "free"` fallback. No hardcoded expectations.

**C. Billable-set pin.** Pin only the metered/expensive tools explicitly; assert everything else is `free`.

| | A explicit map | B invariant | C billable-set |
|---|---|---|---|
| Catches metered→free flip | Yes | No | Yes |
| Catches new metered tool shipped as free | Yes (key-set check fails) | No | Yes (unlisted ⇒ must be free ⇒ if it's actually billable, the test author notices) |
| Maintenance when a tool is added | Update the map | None | Update only if billable |
| Brittleness | Higher (every tool) | Lowest | Low |

**Lean: A.** The whole point is to catch a *value* drift, which B can't. The key-set equality check turns "someone added a tool" into a forced, reviewed decision about its cost class — exactly the moment the leak would otherwise be introduced.

### Decision 2 — Close the silent path at the root, or only signal it

**A. Make `costHint` required.** If `ToolCapabilitySchema.costHint` is optional, make it required. Then fallback path (b) is impossible for any declared tool — `.costHint` is always present — and combined with the existing `attachCapabilities` throw for path (a), a *registry* tool can never reach `?? "free"`. The fallback then only applies to a tool name genuinely unknown to the registry (defensive).

**B. Warn at wrap time.** Keep the fallback; in `metaFor`, when `costBearer === "application"` and the capability is absent (or costHint undefined), `logger.warn` naming the tool (Pattern B). Runtime signal, distinguishes "declared free" from "defaulted free."

**C. Throw at wrap time.** Same detection as B but a hard throw (Pattern A) for an application-paid tool that resolves its class via fallback.

| | A required field | B wrap warn | C wrap throw |
|---|---|---|---|
| Removes the silent path for declared tools | Yes (at the type level) | No (still defaults, but logs) | No (defaults unless it throws) |
| Signals a truly-unknown app-paid tool name | No (still `?? "free"`) | Yes | Yes (fatal) |
| Blast radius | `packages/core` schema + any omitted callsite | `tools.service.ts` only | `tools.service.ts` only |

**Lean: A + a light B.** Making the field required is the root-cause fix and is cheap if it's currently optional. Keep a `logger.warn` (B, not C — don't fail the whole tool build over one tool) for the residual unknown-name case so a future non-registry app-paid tool still surfaces.

## Tradeoff comparison

|  | D1: explicit map (A) | D2: required field + warn (A+B) |
|---|---|---|
| Spread to spec | Yes | Yes — confirm optionality first |
| Touches `packages/core` | Test only (registry test) | Yes (schema) if currently optional |
| Touches `apps/api` | Pin test | `metaFor` warn |

## Recommendation

1. Add a **pinning test** with an explicit `{ tool → costHint }` map for every built-in + system tool, asserting both the value per tool and **key-set equality** with `ALL_TOOL_CAPABILITIES` (adding/removing a tool fails until the pin is updated).
2. If `ToolCapabilitySchema.costHint` is optional, **make it required** so a declared tool can never fall through `?? "free"`.
3. Add a `logger.warn` in `metaFor` for the residual case — an `application`-paid tool whose name is absent from `ALL_TOOL_CAPABILITIES` — so a future non-registry app-paid tool isn't silently freed.
4. Keep the `?? "free"` as the final defensive default (never let a missing lookup throw inside tool build), now that the loud paths above front-run it.

## Open questions

1. **Is `costHint` currently optional on `ToolCapabilitySchema`?** If it's already required, Decision 2A is a no-op and the whole ticket collapses to the pinning test (Decision 1) + the warn (2B). **Lean: check first in the spec.** The `?? "free"` strongly implies optional-or-defensive; the spec confirms against `tool-capability.model.ts` and adjusts scope.
2. **Where does the pin live — `apps/api` or `packages/core`?** The registry is core; the leak manifests in api. **Lean: `packages/core` registry test** (`builtin-toolpacks.test.ts`, which already pins registry shape) for the value/key-set pin, since that's where the source of truth is and it needs no SDK/db mocks — keep the api guard test focused on *wrapping*. A one-line api-side assertion that `metaFor` never returns fallback-free for a known tool can complement it.
3. **Does the warn belong in `metaFor` (api) or the gate (`resolveCostGate`)?** **Lean: `metaFor`** — it's the resolution site and has the registry-absence signal in hand; the gate only sees the already-resolved `costHint`.

## Enterprise-scale considerations

Localized, single-feature guardrail — most dimensions `N/A`:

- **Accuracy & auditability** — *engaged (lightly).* This ticket exists precisely to protect billing accuracy: it turns a silent metering gap into a build/test failure. It complements the future audit ledger (#179) but doesn't need it.
- **Contract stability** — *Lean:* making `costHint` required hardens the tool-capability contract so future paid tiers can't accidentally ship a billable tool as free.
- **Concurrency & correctness / Failure modes / Scale / Multi-tenancy / Data lifecycle** — `N/A because` this is static registry validation + a build-time signal; no runtime state, no per-request path, no tenancy dimension.

## What this doesn't decide

- **The `expensive` cost-acknowledgement route.** `expensive` means "requires cost ack before dispatch" per the tier contract; this ticket only guards the *classification*, not the ack flow. Out of scope.
- **Per-tool unit weights / `COST_RESOLVERS`.** Whether a metered tool costs 1 or `f(N)` units is #84/#169 territory, not the class pin.
- **Custom/webhook tools.** Those are `costBearer: "organization"` and never charged regardless of `costHint`; the leak is application-paid-only. No change to the custom path.

## Next step

Write `docs/COST_GATE_COSTHINT_GUARD.spec.md` (contract: the pin's exact expected map + key-set assertion, the `costHint`-required schema change if warranted, the `metaFor` warn) and `docs/COST_GATE_COSTHINT_GUARD.plan.md`. The plan is small — likely **2 slices**: (1) confirm optionality + make `costHint` required + fix any omitted callsite; (2) the pinning test + the `metaFor` warn. Both land as commits on `chore/cost-gate-costhint-guard`.
