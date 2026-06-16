# Compute-tool purity (pure read→compute) — Plan

**TDD-sequenced implementation of `docs/COMPUTE_TOOL_PURITY.spec.md`. Five slices, each behind a green test suite, each one commit. Slice 1 lays the shared contract; slices 2–4 flip the three packs one at a time (statistics → regression → financial); slice 5 cleans up and locks the invariant. Backend-only — no frontend, no migration.**

Spec: `docs/COMPUTE_TOOL_PURITY.spec.md`. Discovery: `docs/COMPUTE_TOOL_PURITY.discovery.md`. Issue: [#114](https://github.com/EnterpriseBT/portal-ai/issues/114).

Run tests with:

```bash
npm run test:unit --workspace=packages/core
npm run test:unit --workspace=apps/api
npm run test:integration --workspace=apps/api
npm run lint
npm run type-check
```

Each slice loop: write failing tests → confirm red → implement smallest change → confirm green → full unit suite (+ integration when touched) → lint + type-check → commit. Each slice's tools are independently shippable: after slice 2, statistics is pure while regression/financial still read — the system runs fine throughout.

---

## Slice 1 — Contract primitives (`COMPUTE_MAX_ROWS`, error code, `resolveComputeRecords`, `withComputeInput`)

**Why first.** Every tool slice imports these; the cap/error and the materialization helper are the spine.

**Files**
- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — `COMPUTE_MAX_ROWS` (= `HANDLE_ROW_CAP`); update the constants test.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `COMPUTE_INPUT_TOO_LARGE` + `ApiCodeDefaultRecommendation`.
- New: `apps/api/src/tools/compute-input.util.ts` — `withComputeInput(shape)`, `resolveComputeRecords(input, ctx?)`.
- New: `apps/api/src/__tests__/tools/compute-input.util.test.ts` — cases 1–5.

**Steps**
1. Write failing tests: rows pass-through + over-cap → `COMPUTE_INPUT_TOO_LARGE`; handle under cap → `getSnapshot` rows (mock `PortalSqlHandleService`); `truncated`/over-cap handle → `COMPUTE_INPUT_TOO_LARGE`; expired handle → `READ_HANDLE_EXPIRED`; `withComputeInput` rejects neither/both.
2. Confirm red.
3. Add the constant + code; implement the helper (read envelope meta for `rowCount`/`truncated`, enforce cap, `getSnapshot`).
4. Green; lint + type-check. Commit.

**Done when:** the helper + schema wrapper exist and pass cases 1–5; nothing consumes them yet.

## Slice 2 — Statistics pack (6 tools)

**Files**
- Edit: `apps/api/src/tools/{describe-column,correlate,detect-outliers,cluster,aggregate,hypothesis-test}.tool.ts` — arg-less `build()`; input via `withComputeInput`; `execute` calls `resolveComputeRecords` then the unchanged `AnalyticsService` method; drop `fetchEntityRows`/`entity`.
- Edit: `apps/api/src/services/tools.service.ts` — the 6 `.build(stationData, organizationId)` → `.build()`.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — the 6 `parameterSchema`s → `queryHandle`/`rows` shape.
- Edit: `apps/api/src/__tests__/tools/{…}.test.ts` — drop `stationData`/DB mocks; drive with fixture rows (cases 6–8 for the representatives).

**Steps**
1. Rewrite/extend the 6 tools' tests to the pure path (fixture `rows` + scalar params; assert results match current behavior for the same data; one `queryHandle` case via mocked handle service; schema rejects neither-provided).
2. Confirm red (tools still read).
3. Refactor the 6 tools + their registration + descriptors.
4. Green for the statistics suites; run the #115 `tools.service.test.ts` consistency suite (descriptors must still align); lint + type-check. Commit.

**Done when:** statistics tools are pure and the consistency suite is green; regression/financial untouched.

## Slice 3 — Regression pack (6 tools)

Same shape as slice 2 for `{regression,logistic-regression,trend,changepoint,decompose,forecast}.tool.ts` + their registration, descriptors, and tests. Commit when the regression suites + consistency suite are green.

## Slice 4 — Financial data-dependent tools (6 tools)

Same shape for `{technical-indicator,sharpe-ratio,max-drawdown,rolling-returns,var-cvar,portfolio-metrics}.tool.ts`. The 8 already-pure financial tools (`npv` etc.) are untouched. Commit when financial suites + consistency suite are green.

## Slice 5 — Cleanup + invariant lock

**Why last.** Once no compute tool reads, prove it and prevent regression.

**Files**
- Edit: `apps/api/src/utils/tools.util.ts` — confirm `fetchEntityRows` is referenced only by the read primitives (`resolve_identity` and any other reader); remove dead compute imports.
- Edit/New: extend the #115 consistency suite (or a small lint test) with case 9 — none of the 18 tool files import/call `fetchEntityRows`.
- New: `apps/api/src/__tests__/__integration__/tools/compute-from-handle.integration.test.ts` — case 10 (real `er__` table → `sql_query` handle → compute; over-cap handle → `COMPUTE_INPUT_TOO_LARGE`).

**Steps**
1. Write the grep guard (case 9) + the integration test (case 10); confirm red where applicable.
2. Remove any now-dead `fetchEntityRows` compute usage; keep it for readers.
3. Green across api unit + integration + core unit; lint + type-check. Commit.

**Done when:** the 18 tools are provably read-free, the integration path works end-to-end, and the guard prevents future drift.

---

## Sequencing notes

- **Per-pack slices (2–4) are the discovery Decision 4 lean** — each is reviewable alone and lets the test simplification (dropping `stationData`/DB mocks) land incrementally.
- **The #115 consistency suite is the safety net** for every descriptor edit in slices 2–4 — run it each slice, not just at the end.
- **Custom-webhook handle-resolution is NOT a slice here** — it's the fast-follow ticket (spec Key decision 4). This plan ends at built-in purity + the documented contract.
- After slice 5, open/refresh the PR with `Closes #114`; the discovery + spec + plan + five implementation commits all sit on `chore/compute-tool-purity`.
