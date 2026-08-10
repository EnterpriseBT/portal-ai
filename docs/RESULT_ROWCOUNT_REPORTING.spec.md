# Large-result row-count reporting (matched vs staged) — Spec

Pins the contract for reporting a large result's **true matched total** distinct from the ≤100k it stages. Discovery: `docs/RESULT_ROWCOUNT_REPORTING.discovery.md`. Issue: [#340](https://github.com/EnterpriseBT/portal-ai/issues/340). Branch: `fix/result-rowcount-reporting` (off `main`).

## Key decisions (flag for review)

1. **Purely additive — `rowCount` is left untouched.** `rowCount` keeps its current value + meaning (the `cap+1` probe → a lower bound when `truncated`). We *add* `matchedCount` (true total) + `matchedCountExact` (bool). This refines the discovery's "keep `rowCount` = staged" into "don't touch `rowCount` at all" — least churn, every existing consumer keeps working, new fields are opt-in.
2. **Same transaction, but the count runs *after* the staging fetch and is isolated.** `runSqlQuery` computes `SELECT count(*)` in the same read-only session-view txn it already opens (no second view build), but only after the staged rows are in hand and wrapped in `try/catch` — so a count `statement_timeout` yields `exactTotal = null` (→ `matchedCountExact: false`) and **never fails the handle**. This is the safety refinement of the discovery's same-txn lean.
3. **No separate `stagedCount` field.** The "analysis ran on the first N" wording is derived on the web from the existing `HANDLE_ROW_CAP` constant (`min(HANDLE_ROW_CAP, matchedCount)`), so the contract change stays two fields.

## Scope

### In scope
- `QueryHandleEnvelopeFieldsSchema`: add `matchedCount?` + `matchedCountExact?` (core).
- `PortalSqlService.runSqlQuery`: optional `computeExactTotal` → same-txn isolated `count(*)` → `exactTotal` on the response (api).
- `PortalSqlHandleService.produce` (+ `produceFromRows`): populate the two fields (api).
- `QueryResultDataBlock` + `D3Widget`: render matched-vs-staged honestly (web).

### Out of scope
- The map/geo surface (not on `main`; inherits the corrected envelope when the epic integrates this).
- Raising `HANDLE_ROW_CAP` or changing what is staged/analysed.
- An EXPLAIN-estimate fast-path (OQ1 — only if exact proves too slow in smoke).

## Surface

### `packages/core/src/contracts/portal-sql.contract.ts`

Add to `QueryHandleEnvelopeFieldsSchema` (`:23-55`), **both optional** so pre-#340 persisted blocks still parse:

```ts
  /** True total rows the query matched — the value to display. EXACT when
   *  `matchedCountExact`; otherwise a lower bound equal to `rowCount` (the
   *  `count(*)` was skipped or timed out). Absent on pre-#340 handles →
   *  consumers fall back to `rowCount`. */
  matchedCount: z.number().int().nonnegative().optional(),
  /** Whether `matchedCount` is an exact `count(*)` (true) or the `rowCount`
   *  lower bound (false). */
  matchedCountExact: z.boolean().optional(),
```

`WidgetRefreshResponseSchema` (`:76-82`) inherits both (handle variant extends the fields). `QueryHandleEnvelope` type + the `superRefine` at `:57-66` are otherwise unchanged.

### `apps/api/src/services/portal-sql.service.ts` — `runSqlQuery`

- Add optional `computeExactTotal?: boolean` to `PortalSqlParams`.
- Inside the existing txn, **after** the staging fetch (`:385-391`) and before the envelope build (`:393`): when `computeExactTotal`, run the count over the **unwrapped** `cleaned` SQL (not `wrappedSql`, which carries the `LIMIT`):

```ts
let exactTotal: number | null = null;
if (params.computeExactTotal) {
  try {
    const c = await tx.execute(sql.raw(`SELECT count(*)::bigint AS n FROM (${cleaned}) _c`));
    exactTotal = Number((c as unknown as Array<{ n: string | number }>)[0]?.n ?? NaN);
    if (!Number.isFinite(exactTotal)) exactTotal = null;
  } catch {
    exactTotal = null; // statement_timeout / error → fall back; no further DB stmts before rollback
  }
}
```

Return `exactTotal` on the response. Concretely: `PortalSqlTxResult` carries `{ response, exactTotal }` (or the return type widens to `PortalSqlResponse & { exactTotal?: number | null }`). Non-`computeExactTotal` callers are unaffected (`exactTotal` absent/`undefined`). The count is the last DB statement before the rollback sentinel (`:413`), so an aborted-txn state after a count error is harmless.

### `apps/api/src/services/portal-sql-handle.service.ts` — `produce`

- Pass `computeExactTotal: opts.sql != null` to `runSqlQuery` (`:134-144`). External/`produceFromRows` handles (`sql === null`) skip the count.
- Read `exactTotal` off the response and set on the envelope (`:194-203`):
  - `matchedCount: exactTotal ?? totalCount`
  - `matchedCountExact: exactTotal != null`
- `rowCount`, `truncated`, everything else **unchanged**. `produceFromRows` (external rows) sets `matchedCount: rowCount, matchedCountExact: false` (the rows it was handed are the full set, but there's no query to `count(*)`; it's already ≤ cap so `matchedCount === rowCount` is in fact exact — set `matchedCountExact: true` there since the handed rows *are* the total). *(Confirm this nuance in review — see Risks.)*

### `apps/api/src/tools/visualize-d3.tool.ts` + `apps/api/src/services/portal-viz-refresh.service.ts`

No shape change — they spread `...delivery.envelope` / build from `produce`, so both fields flow through automatically. The pinned-refresh branch (`portal-viz-refresh.service.ts:173-180`) that hand-builds `{ rowCount: total, truncated }` adds `matchedCount: total, matchedCountExact: true` (it already has the true `total`).

### `apps/web/src/components/QueryResultDataBlock.component.tsx`

- Derive `matched = content.matchedCount ?? content.rowCount`, `exact = content.matchedCountExact ?? !content.truncated`.
- `rowCountLabel = matched.toLocaleString() + (exact ? "" : "+")`.
- Notice copy (`:112-121`) becomes: *"Showing the first {shownCount} of {rowCountLabel} rows."* + when `matched > HANDLE_ROW_CAP`: *"Analysis ran on the first {HANDLE_ROW_CAP.toLocaleString()}."* — drop the false "All N were analysed." (Import `HANDLE_ROW_CAP` from `@portalai/core/constants`.)

### `apps/web/src/modules/D3Widget/D3Widget.component.tsx`

- `totalLabel` (`:114`) from `matchedCount ?? rowCount` + the exact/`+` rule; the "Rendering {receivedRows} of {totalLabel} rows…" notice (`:219`) unchanged in shape.

## Migration
None — additive optional Zod fields, no DB schema change.

## Seed
None.

## TDD test plan

Run per package (never raw jest): `cd <pkg> && npm run test:unit` / `npm run test:integration`.

### core — `packages/core/src/__tests__/contracts/portal-sql.contract.test.ts`
- `matchedCount`/`matchedCountExact` accepted; **absent** still valid (pre-#340 back-compat); negative `matchedCount` rejected; `WidgetRefreshResponse` handle variant carries both. (~4)

### api (unit) — `apps/api/src/__tests__/services/portal-sql-handle.service.test.ts`
- `produce`: `exactTotal` present on the response → `matchedCount = exactTotal`, `matchedCountExact: true`; `exactTotal = null` → `matchedCount = rowCount`, `matchedCountExact: false`, `rowCount`/`truncated` unchanged; `produceFromRows` (external) → `matchedCount = rowCount`, exact per the resolved nuance. (~4, via injected/mocked `runSqlQuery`)

### api (integration) — `apps/api/src/__tests__/__integration__/db/portal-sql-rowcount.integration.test.ts` (new)
- Seed a table with > a small test cap of rows; `runSqlQuery({ computeExactTotal: true, rowCap: <small> })` → response `exactTotal` equals the **true** row count while `totalCount`/`rowCount` reflect the capped probe; without `computeExactTotal` → no `exactTotal`. (~2)
- (Count-timeout path) with a `statementTimeoutMs: 1` against a deliberately slow count → `exactTotal: null`, staged rows still returned. (~1)

### web — `apps/web/src/__tests__/QueryResultDataBlock.test.tsx` + `apps/web/src/modules/D3Widget/__tests__/D3Widget.test.tsx`
- `matchedCount` present + `!exact` → label shows `"{matched}+"`; exact → no `+`; `matchedCount` absent (old block) → falls back to `rowCount` (regression); the "analysis ran on the first {HANDLE_ROW_CAP}" line appears only when `matched > HANDLE_ROW_CAP`. (~5 across the two files)

**Totals ≈ 16 cases** (core 4, api 7, web 5). No migration test needed.

## Acceptance criteria

- [ ] A > 100k-row result reports its **true** total (e.g. 413,311), not 100,001, wherever the handle count is shown (table, d3 today; map on epic-merge).
- [ ] When the exact count times out or the handle is external, the surface shows the honest lower bound (`{HANDLE_ROW_CAP}+`), never a crash — `matchedCountExact: false`.
- [ ] The table no longer claims "All N were analysed" when `matched > HANDLE_ROW_CAP`; it states analysis ran on the first `HANDLE_ROW_CAP`.
- [ ] `rowCount`/`truncated` are byte-for-byte unchanged; pre-#340 persisted blocks still validate and render (fields absent → fall back to `rowCount`).
- [ ] The count adds no second session-view build (same txn) and never fails a handle it can't count.

## Risks & rollback

- **Count latency on a genuinely huge pipeline.** Bounded by `statement_timeout` (30s); on timeout → `matchedCountExact: false` (lower bound), staging unaffected. Detected in smoke (OQ1); rollback = stop passing `computeExactTotal` (one line), fields default to the lower bound. **Fail mode: fail to floor, not to error.**
- **`produceFromRows` exactness nuance** — external rows are the full set (≤ cap), so `matchedCount === rowCount` is exact; setting `matchedCountExact: true` there is correct. Flagged for review because it reads counter to "no `count(*)` ran."
- **Aborted-txn after a count timeout** — the count is the last DB statement before the rollback sentinel, so no statement runs against the aborted txn; the pre-fetched staged rows are returned regardless.

## Files touched

- **Edit** `packages/core/src/contracts/portal-sql.contract.ts` — two optional fields.
- **Edit** `apps/api/src/services/portal-sql.service.ts` — `computeExactTotal` + same-txn isolated count + `exactTotal` on the response.
- **Edit** `apps/api/src/services/portal-sql-handle.service.ts` — populate `matchedCount`/`matchedCountExact` in `produce` + `produceFromRows`.
- **Edit** `apps/api/src/services/portal-viz-refresh.service.ts` — set the fields on the hand-built pinned-refresh envelope.
- **Edit** `apps/web/src/components/QueryResultDataBlock.component.tsx`, `apps/web/src/modules/D3Widget/D3Widget.component.tsx` — matched-vs-staged copy.
- **Tests** — the four files in the test plan (one new integration file).

## Next step

`/plan 340` slices this on `fix/result-rowcount-reporting` — ≈3 slices: (1) core fields + defaults + contract tests; (2) api `runSqlQuery` count + `produce` wiring + unit/integration tests; (3) web table + d3 copy + tests. Each green + compilable; the map inherits the corrected envelope with no code change.
