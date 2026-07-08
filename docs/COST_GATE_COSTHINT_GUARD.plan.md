# Cost-gate costHint guard — Plan

**TDD-sequenced implementation of the #184 guardrail: a pinning test that locks every built-in tool's `costHint`, then a `metaFor` warn for the residual unknown-app-paid-tool path.**

Spec: `docs/COST_GATE_COSTHINT_GUARD.spec.md`. Discovery: `docs/COST_GATE_COSTHINT_GUARD.discovery.md`. Issue: #184 (epic #177). Builds on shipped #169 (the cost gate + `metaFor` wrap) and #172 — both on `main`.

Two slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/cost-gate-costhint-guard`** — one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests per package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** is the primary deliverable and pure `packages/core` (no api/db/SDK mocks) — it catches the *value drift* that the type system can't, and delivers all the ticket's protective value on its own. It ships first so the guardrail exists even if slice 2 is deferred.
- **Slice 2** is `apps/api` hardening for the residual runtime path (an app-paid tool absent from the registry). It depends on nothing in slice 1, but sits second because it's belt-and-suspenders over a path the type system already makes unreachable for registry tools.

---

## Slice 1 — Pin every built-in's `costHint` (core, test-only)

Lock `ALL_TOOL_CAPABILITIES` to an explicit expected cost-class map with key-set equality.

**Files**

- Edit: `packages/core/src/__tests__/registries/tool-capabilities.test.ts` — the pin block.

**Steps**

1. **Tests (spec Layer 1).** Add `EXPECTED_COST_HINTS: Record<string, CostHint>` covering every tool in `ALL_TOOL_CAPABILITIES` (billable explicit: `web_search`→`metered`, `cluster`/`logistic_regression`/`transform_entity_records`→`expensive`; all others→`free`). Assert: (a) per-tool `ALL_TOOL_CAPABILITIES[name].costHint === EXPECTED_COST_HINTS[name]`; (b) key-set equality `Object.keys(ALL_TOOL_CAPABILITIES).sort()` ≡ `Object.keys(EXPECTED_COST_HINTS).sort()`; (c) cheap invariant — every resolved `costHint` is a valid `CostHint`. Run; the pin should **pass immediately** against today's registry — so first assert a deliberately-wrong expectation to confirm the test *can* fail (red), then correct it to the true map (green). This proves the guard bites.
2. **Implement** — no production change; the "implementation" is the corrected expected map. Green.
3. Lint + type-check `packages/core`.

**Done when:** the pin passes against the current registry; flipping any billable tool to `free`, or adding/removing a tool without updating the map, fails the suite. Nothing in production references the test.

**Risk:** none — test-only. The one judgment call is the exact tool inventory; cross-check against `builtin-toolpacks.ts:1043–1164` + `tool-capabilities.ts:30–56` when authoring the map.

---

## Slice 2 — `metaFor` warn for an unregistered application tool (api)

Signal the residual runtime fallback path; keep `?? "free"` as the defensive default.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — in `metaFor`'s application branch, `logger.warn` when `ALL_TOOL_CAPABILITIES[name]` is absent (per spec Surface).
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — the warn tests.

**Steps**

1. **Tests (spec Layer 2).**
   - **Negative (primary):** spy the module `logger.warn`; build the full tool set (all packs, as the existing guard test at `:684` does) and assert the cost-gate capability warning fired **zero** times — a live no-leak assertion. Run; fail (no warn code yet, but also the spy setup is new — confirm it fails for the right reason).
   - **Positive (optional):** only if pursuing it, extract the app-branch resolution into an exported `resolveBuiltinCostMeta(name)` and unit-test that an unknown name logs once and returns `costHint: "free"`. If not extracting, omit this case and record the accepted gap (spec Layer 2 note) — the negative test + the type system cover it.
2. **Implement** the `logger.warn` guard in `metaFor` (and the tiny helper extraction if doing the positive case). Green.
3. Lint + type-check `apps/api`.

**Done when:** the real tool build emits no capability warning; (if extracted) an unknown app-paid name logs once and defaults to `free`. Known-tool behavior is unchanged.

**Risk:** low. Watch that the warn is scoped to `!isCustom && !capability` — a custom tool legitimately has no `ALL_TOOL_CAPABILITIES` entry and must **not** warn (it's org-paid, resolved from `customCostHint`).

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | Explicit costHint pin + key-set equality (core) | `packages/core` unit green; red-first proven |
| 2 | `metaFor` warn for unregistered app tool (api) | `apps/api` unit green; no warn on real build |

## Cross-slice notes

- **No production behavior change to the gate** — this ticket adds *detection* (a test + a log), not enforcement. The gate's charge/deny/fail-open logic is untouched.
- **No schema, no migration, no seed** (spec: `costHint` already required).
- **Doc-sync:** none required — no user-facing capability, tool description, or convention changes. The tool cost classes themselves are unchanged; this only locks them. Note in the PR body that the pin is now the source of truth a future tool addition must update.
- **Custom-tool carve-out** spans both slices conceptually: slice 1 pins only built-ins (custom tools aren't in `ALL_TOOL_CAPABILITIES`); slice 2's warn must exclude custom tools. Keep them aligned.

## Next step

Once discovery + spec + plan are reviewed and confirmed, implementation begins on `chore/cost-gate-costhint-guard` — slice 1 first (tests red-then-green), one commit per slice, opening the PR (`Closes #184`) after the first commit lands.
