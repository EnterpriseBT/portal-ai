# Large-result row-count reporting (matched vs staged) — Discovery

**Issue:** [EnterpriseBT/portal-ai#340](https://github.com/EnterpriseBT/portal-ai/issues/340)

**Why this exists.** Any query result larger than `HANDLE_ROW_CAP` (100,000) reports its size as **100,001** with `truncated: true`, on every surface that reads the query-handle envelope — a data table, a d3 chart, and (once the GIS epic merges) a map. The handle producer never runs a real `COUNT(*)`; it stages rows under a `LIMIT rowCap+1` probe and reports `rowCount = min(true, 100_001)`. For a 5M-row result the user is told "100,001", and the table even says "All 100,001+ were analysed" — both understating the true total and, for a map (which tiles *every* row per viewport and drops nothing), actively misleading. This is the single-point fix that makes a large result report **how many rows it actually matched**, distinct from **how many were staged for display/analysis**.

## The current shape

### The handle envelope + where the count is (mis)set

| Piece | Location | Note |
|---|---|---|
| `PortalSqlHandleService.produce` | `apps/api/src/services/portal-sql-handle.service.ts:117` | Runs `runSqlQuery` with `rowCap: HANDLE_ROW_CAP` (`:138`), lifts cell/payload caps (`:139-140`). |
| count computed from the capped probe | `:167-170`, `:195-200` | `rowCount: totalCount`, `truncated: rowsRaw.length < totalCount` — but `totalCount` comes from the `LIMIT 100_001` result, so it's `100_001` for anything bigger. |
| `LIMIT rowCap+1` probe | `apps/api/src/services/portal-sql-limit.util.ts:61-64` | `SELECT * FROM (${sql}) _q LIMIT ${rowCap + 1}`. |
| `HANDLE_ROW_CAP = 100_000` | `packages/core/src/constants/large-data-ops.constants.ts:48` | The staging ceiling. |
| `QueryHandleEnvelopeFieldsSchema` | `packages/core/src/contracts/portal-sql.contract.ts:23` | `rowCount:32` doc already concedes: "**Exact when `truncated` is false; a LOWER BOUND when `truncated` is true** … counts via a `cap+1` probe rather than a full `COUNT(*)`." The contract *predicts* this bug. |
| exact re-count mechanism exists | `portal-sql-handle.service.ts:518-538` (`aggregateOverHandle`) | Runs `SELECT <projection> FROM (${meta.sql}) _src` in a READ ONLY session-view txn — `count(*)` would work, but returns `null` when `sql === null` (external handles). |
| session-view + timeout constraints | `portal-sql.service.ts:138` (`buildSessionViews`), `:344-345` (`SET LOCAL statement_timeout`, default 30s), `:383` (read-only), `:410-414` (rollback drops temp views) | A count is a scan inside this same pipeline. |

### Consumers (all read the same envelope)

| Surface | Location | Renders |
|---|---|---|
| inline path (already exact) | `result-sink.ts:69` (`resolveSqlDelivery`), `portal-sql-response.util.ts:52-64` (`applyRowCap` → real `totalCount`) | Inline delivery is chosen only at ≤ `INLINE_ROWS_THRESHOLD` (100) rows, so its count is genuinely exact — **only the handle path loses the total.** |
| data table | `apps/web/src/components/QueryResultDataBlock.component.tsx:47,112-121,158` | `"…first {shownCount} of {rowCount}{truncated?'+':''} rows. All {rowCount}+ were analysed…"` — the "+" hints a floor, but "All 100,001+ analysed" is false, and the floor hides magnitude. |
| d3 chart | `apps/api/src/tools/visualize-d3.tool.ts:141-148,166` (spreads `...delivery.envelope`); `packages/core/src/contracts/d3-widget.contract.ts:63-65` (extends envelope); `apps/web/src/components/D3Widget.component.tsx:114,219,321-332` | `"Rendering {receivedRows} of {total}+ rows…"` — same floor. |
| map (geo) | **not on `main`** — `visualize-map.tool.ts` / `MapWidget` live on `epic/gis-toolpack` | The geo block spreads the *same* `...delivery.envelope`, so it inherits whatever `rowCount` the envelope carries. Fixing the envelope fixes the map with no map-code change. |
| refresh / pins | `portal-sql.contract.ts:76-83` (`WidgetRefreshResponseSchema` reuses the envelope); `portal-viz-refresh.service.ts:210`; `pinned-result.contract.ts:61` | Same fields → same fix, automatically. |

**The one-point-of-repair fact:** every surface funnels through `QueryHandleEnvelopeFieldsSchema` + `resolveSqlDelivery`. Correct the count where the handle is produced and all of table / d3 / refresh / pins / (future) map inherit it.

## The design space

### Decision 1 — How to obtain the true matched total

| | A. Exact `COUNT(*)` | B. Planner estimate (EXPLAIN) | C. Honest lower-bound only |
|---|---|---|---|
| Accuracy | Exact | Approximate (±orders of magnitude possible) | Just "≥ 100,000" |
| Cost | One extra scan of the pipeline | Cheap, non-executing | Zero |
| Failure | Can hit `statement_timeout` on huge pipelines | None | None |
| User value | "5,000,000" | "~5M" | "100,000+" (hides magnitude) |

**Lean: A, computed in the *same* transaction that stages the rows, with a fallback to the current cap+1 lower bound on timeout / external handle.** Critically, `produce` can add `SELECT count(*) FROM (${sql}) _c` to the **same** `buildSessionViews` transaction it already opens for staging — so the only added cost is the count scan itself, **not** a second session-view rebuild (unlike a separate `aggregateOverHandle` call). Count over 400k geometry rows was sub-second in the #316 benchmark; the 30s `statement_timeout` bounds the worst case, and on timeout we keep today's honest lower bound.

### Decision 2 — Envelope shape: add `matchedCount`, keep `rowCount` as staged

Consumers need **both** numbers to be honest: the true total *and* how many were actually staged/analysed (≤ 100k). Options: (A) redefine `rowCount` to the true total — but then "analysed" labels can't tell staged from matched; (B) add a field.

**Lean: B — add `matchedCount: number` + `matchedCountExact: boolean` to `QueryHandleEnvelopeFieldsSchema`, keep `rowCount` = rows actually staged in the handle (exact, ≤ cap).** `matchedCount` = the `COUNT(*)` (or the lower bound when `!matchedCountExact`). `truncated` stays `= staged < matchedCount`. Additive + optional-with-defaults so existing consumers keep working until updated, and refresh/pins/geo inherit the fields for free. (Alternatively name them `stagedCount`/`matchedCount` for symmetry — pinned in the spec.)

### Decision 3 — Consumer labels (what each surface says)

**Lean: update the two surfaces that exist on `main` (table + d3) to render matched-vs-staged honestly; the map inherits the correct count with no code change.**
- Table: *"Showing the first {shown} of {matchedCount}{exact?'':'+'} rows — analytics ran on the first {rowCount}."* (drops the false "all analysed").
- d3: *"Rendering {received} of {matchedCount}{exact?'':'+'} rows."*
- Map (on the epic): once the envelope carries `matchedCount`, the geo block reports the true feature total; the map-specific nuance — that `truncated` must **not** read as "the map dropped features" (it tiles all of them) — is a small copy change owned where the map lives (the epic), not this branch.

## Tradeoff comparison

| | Exact count same-txn (D1) | Add `matchedCount` (D2) | Update table+d3 labels (D3) |
|---|---|---|---|
| Spreads to spec | Yes (producer + fallback) | **Yes** (contract fields) | Yes (web copy) |
| Contract change | No | **Yes** (additive) | No |
| Touches web | No | No | **Yes** |
| Fixes map | via envelope | via envelope | inherited (no code) |

## Recommendation

1. In `PortalSqlHandleService.produce`, run `COUNT(*)` over the pipeline **in the same session-view transaction** as the staging query; set `matchedCount` = that count (exact), `matchedCountExact: true`. On `statement_timeout` or an external handle (`sql === null`), fall back to the cap+1 lower bound with `matchedCountExact: false`.
2. Add `matchedCount: number` + `matchedCountExact: boolean` to `QueryHandleEnvelopeFieldsSchema` (`packages/core`); keep `rowCount` = staged rows. Default them on the inline/exact paths (`matchedCount = totalCount`, `matchedCountExact = true`) so every producer stays consistent.
3. Update `QueryResultDataBlock` + `D3Widget` copy to show matched-vs-staged honestly (no "all N analysed" when staged < matched).
4. Leave the map surface to inherit the corrected envelope; note the `truncated`-copy nuance for the epic to pick up when it lands.

## Open questions

1. **Count on every >100k handle — acceptable cost?** Lean: yes, same-txn count is one bounded scan; the bug only bites large results, and the timeout fallback caps the downside. Revisit with an EXPLAIN-estimate fast-path only if a real pipeline times out in smoke.
2. **Field names — `matchedCount`/`rowCount` vs `matchedCount`/`stagedCount`?** Lean: keep `rowCount` (staged, existing meaning), add `matchedCount` — minimizes consumer churn; the spec pins the exact names + defaults.
3. **External handles (`sql === null`) — no count possible.** Lean: `matchedCount = rowCount`, `matchedCountExact: false` (honest floor), same as today.
4. **Does the table's `TABLE_DISPLAY_ROW_LIMIT` (5,000) interact?** Lean: no — that's a separate display cap below the handle cap; the label just needs three numbers (shown / staged / matched).

## Enterprise-scale considerations

- **Accuracy & auditability** — the whole ticket is accuracy: report the real matched total, exact when affordable, an explicit floor otherwise (`matchedCountExact`). Display-only, no billing tie-in. `Lean: exact best-effort + honest floor.`
- **Failure modes** — a count that hits `statement_timeout` degrades to the current lower bound, never a crash or a blank result. `Lean: fail to floor, not to error.`
- **Scale & unbounded growth** — the count is one extra bounded scan per large-result handle (not per row, not per tile); worst case capped by the 30s timeout. `Lean: bounded; smoke a genuinely huge pipeline.`
- **Concurrency & correctness** — runs in the same READ ONLY session-view txn as staging; no new shared state. `N/A because it rides the existing pipeline.`
- **Multi-tenancy** — inherited from session-view scoping. `N/A.`
- **Contract stability** — additive envelope fields; refresh, pins, d3, table, and the future geo block all inherit through the shared schema. `Lean: additive-open; one schema, every surface.`
- **Data lifecycle** — render-time only, nothing persisted differently. `N/A.`

## What this doesn't decide

- **Map-widget copy** ("truncated ≠ dropped features") — the map lives on `epic/gis-toolpack`, not `main`; it inherits the corrected `matchedCount` automatically, and the copy nuance is owned there when the epic integrates this fix.
- **Raising `HANDLE_ROW_CAP` or changing what gets staged/analysed** — the 100k staging ceiling is a separate memory/analysis bound; this ticket reports it honestly, it doesn't move it.
- **EXPLAIN-estimate mode** — kept as a possible fast-path only if the exact count proves too slow in smoke (OQ1); not built by default.

## Next step

`/spec 340` pins the contract on this branch (`fix/result-rowcount-reporting`, off `main`): the two new envelope fields + defaults, the `produce` same-txn count + fallback, and the table/d3 copy. `/plan 340` then slices it — roughly: (1) core contract fields + defaults; (2) `produce` count + fallback + tests; (3) web table + d3 label copy + tests. Each a green, compilable commit; the map inherits with no code change.
