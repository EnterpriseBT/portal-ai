# Large-result row-count reporting (matched vs staged) — Plan

**Implements the additive `matchedCount` contract TDD-first: core fields → the same-txn `count(*)` in `produce` → the web table + d3 copy. Each a green, compilable commit.**

Spec: `docs/RESULT_ROWCOUNT_REPORTING.spec.md`. Discovery: `docs/RESULT_ROWCOUNT_REPORTING.discovery.md`. Issue: #340 (standalone Bug, off `main`).

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/result-rowcount-reporting`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 (core) adds the optional envelope fields both api and web read, so it lands first (additive; api/web compile untouched). Slice 2 (api) is the behavioral core — the count + `produce` wiring — and depends only on core. Slice 3 (web) consumes the same fields for the labels, independent of slice 2. No forward deps.

---

## Slice 1 — Core envelope fields

Add the two optional fields to the shared handle-envelope schema.

**Files**

- Edit: `packages/core/src/contracts/portal-sql.contract.ts` — add `matchedCount?` (nonneg int) + `matchedCountExact?` (bool) to `QueryHandleEnvelopeFieldsSchema`; `WidgetRefreshResponse` handle variant inherits them.
- Edit: `packages/core/src/__tests__/contracts/portal-sql.contract.test.ts`.

**Steps**

1. **Tests (spec: core cases).** `matchedCount`/`matchedCountExact` accepted; **absent** still valid (pre-#340 back-compat); negative `matchedCount` rejected; the `WidgetRefreshResponse` handle branch carries both. Run; fail.
2. **Implement** the two optional fields + doc comments. Green.
3. Lint + type-check (`packages/core`); rebuild core (`npm run build --workspace @portalai/core`) so api/web type-check against the new dist.

**Done when:** core cases pass; api + web still compile (nothing consumes the fields yet — additive optional).

**Risk:** none — purely additive.

---

## Slice 2 — Same-txn `count(*)` + `produce` wiring

`runSqlQuery` optionally computes the exact total; `produce`/`produceFromRows`/the pinned-refresh envelope populate `matchedCount`/`matchedCountExact`.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts` — `computeExactTotal?` param; same-txn isolated `SELECT count(*) FROM (cleaned) _c` after the staging fetch (`:387-391`), before the rollback sentinel (`:413`); return `exactTotal: number | null`.
- Edit: `apps/api/src/services/portal-sql-handle.service.ts` — `produce` passes `computeExactTotal: opts.sql != null`, sets `matchedCount = exactTotal ?? totalCount`, `matchedCountExact = exactTotal != null`; `produceFromRows` sets `matchedCount = rowCount`, `matchedCountExact: true` (handed rows are the full set).
- Edit: `apps/api/src/services/portal-viz-refresh.service.ts` — the hand-built pinned-refresh envelope (`:173-180`) adds `matchedCount: total, matchedCountExact: true`.
- Edit: `apps/api/src/__tests__/services/portal-sql-handle.service.test.ts`.
- New: `apps/api/src/__tests__/__integration__/db/portal-sql-rowcount.integration.test.ts`.

**Steps**

1. **Tests (spec: api unit + integration).** Unit (mocked `runSqlQuery`): `exactTotal` present → `matchedCount = exactTotal`, `matchedCountExact: true`; `exactTotal = null` → `matchedCount = rowCount`, `matchedCountExact: false`, `rowCount`/`truncated` unchanged; `produceFromRows` → `matchedCount = rowCount`, exact `true`. Integration: seed > a small test `rowCap`; `runSqlQuery({computeExactTotal:true, rowCap:<small>})` → `exactTotal` = true count while `rowCount`/`totalCount` reflect the capped probe; no `computeExactTotal` → no `exactTotal`; `statementTimeoutMs:1` on a slow count → `exactTotal: null`, staged rows still returned. Run; fail.
2. **Implement** the param + count + wiring. Green.
3. Lint + type-check (`apps/api`).

**Done when:** unit + integration cases pass; a > cap result carries the true `matchedCount`; a timed-out/external count degrades to the lower bound without failing the handle.

**Risk:** the count must be the **last** DB statement before the sentinel throw (an aborted txn after a count timeout must run no further statements) — assert the staged-rows-still-returned case in integration. Grep for any other `runSqlQuery` caller to confirm the widened return type is back-compatible.

---

## Slice 3 — Web table + d3 copy

Render matched-vs-staged honestly; fall back to `rowCount` for pre-#340 blocks.

**Files**

- Edit: `apps/web/src/components/QueryResultDataBlock.component.tsx` — `matched = matchedCount ?? rowCount`, `exact = matchedCountExact ?? !truncated`; label `"{matched}{exact?'':'+'}"`; replace "All N analysed" with "analysis ran on the first {HANDLE_ROW_CAP}" when `matched > HANDLE_ROW_CAP`.
- Edit: `apps/web/src/modules/D3Widget/D3Widget.component.tsx` — same `matched`/`exact` derivation for `totalLabel`.
- Edit: `apps/web/src/__tests__/QueryResultDataBlock.test.tsx`, `apps/web/src/modules/D3Widget/__tests__/D3Widget.test.tsx`.

**Steps**

1. **Tests (spec: web cases).** `matchedCount` + `!exact` → label `"{matched}+"`; exact → no `+`; `matchedCount` absent (old block) → falls back to `rowCount` (regression); the "analysis ran on the first {HANDLE_ROW_CAP}" line only when `matched > HANDLE_ROW_CAP`. Run; fail.
2. **Implement** the derivation + copy in both widgets (import `HANDLE_ROW_CAP` from `@portalai/core/constants`). Green.
3. Lint + type-check (`apps/web`).

**Done when:** web cases pass; a large-result table/chart shows the true total (or an honest `+` floor); old blocks unchanged.

**Risk:** none beyond matching existing label test assertions (regression cases guard them).

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 · core | `matchedCount?` + `matchedCountExact?` on the envelope | core cases green; api/web still compile |
| 2 · api | same-txn `count(*)` + `produce`/refresh wiring | api unit + integration green; timeout → floor, staging intact |
| 3 · web | table + d3 matched-vs-staged copy | web cases green; old blocks fall back to `rowCount` |

## Cross-slice notes

- **Rebuild `@portalai/core` after slice 1** before api/web type-check (`project_stale_core_dist_after_branch_switch`).
- **Widened `runSqlQuery` return** (`exactTotal?`) must stay back-compatible — grep callers (`AnalyticsService.sqlQuery`, others) so the optional field breaks none.
- **Doc-sync:** the `rowCount` doc-comment in `portal-sql.contract.ts` should cross-reference `matchedCount` as the display value (per CLAUDE.md → "Keeping Documentation in Sync") — do it in slice 1.
- **Map inherits, no code:** the geo block (on `epic/gis-toolpack`) picks up `matchedCount` when the epic next merges `main`; the `truncated`-copy nuance is owned there.
- **No migration, no seed** — additive optional contract fields only.
- **Smoke** (`/smoke 340` after implementation): a > 100k-row `sql_query` table shows the true total, not `100,001`.

## Next step

Implementation begins on `fix/result-rowcount-reporting`, slice 1 first, tests-first, one commit per slice — only after discovery + spec + plan are confirmed.
