# Every visualization is query-backed — Plan

**TDD-sequenced removal of the terminal inline snapshot: the pipeline schema rename + table block contract, the sink attaching the pipeline, the projection keeping it, the refresh service admitting `data-table`, the shared freshness chrome, and the `TableWidget` module that finally puts a refresh button on a table.**

Spec: `docs/QUERY_BACKED_VIZ.spec.md`. Discovery: `docs/QUERY_BACKED_VIZ.discovery.md`. Issue: #349. Builds on **shipped #270** (durable pipeline + `useWidgetRefresh`), **#271** (widget gates), **#312** (`BlockRef`, pin addresser), and **#348** (the map freshness cue) — all live on `main`.

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/query-backed-viz`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"). No PR is open yet; open it as a draft once slice 1 lands so the remaining commits flow into it.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the data has to reach the block before anything can refresh it, and the client is last because it's the only user-visible change:

- **Slice 1** — contracts only (rename + the new table shape). Nothing produces or consumes them yet.
- **Slice 2** — the sink starts attaching the pipeline. Still invisible: the projection drops it.
- **Slice 3** — the projection keeps it, and the d3 fallback stops losing it. Blocks on the wire are now query-backed; nothing reads them yet.
- **Slice 4** — the server can refresh a `data-table` block. No client asks yet, but slice 6's UI has a working endpoint the moment it ships.
- **Slice 5** — the shared freshness chrome, adopted by map/d3/pin as a **pure refactor**. Isolating it here keeps slice 6 about the table alone.
- **Slice 6** — the `TableWidget` module + the plumbing deletions. The only slice a user can see.

**One deviation from the spec's Next-step ordering:** the *source-level* half of the `no-open-coded-sink` guard moves from slice 2 to slice 3. `visualize_d3`'s codegen fallback constructs a `{type:"data-table"}` result directly (`visualize-d3.tool.ts:166-168`), so a guard forbidding that pattern cannot pass until slice 3 has given the fallback its pipeline. Asserting it in slice 2 would be a test that fails across a boundary.

No migration, no seed, no new `ApiCode` (spec *Migration* / *Seed*).

---

## Slice 1 — `VizPipelineSchema` rename + the `data-table` block contract

Contracts only. Pure, leaf-level, no producer or consumer yet.

**Files**

- Edit: `packages/core/src/contracts/d3-widget.contract.ts` — `D3PipelineSchema` → `VizPipelineSchema`, `D3Pipeline` → `VizPipeline` (spec Surface 1). No alias.
- Edit: `packages/core/src/contracts/pinned-result.contract.ts` — import + `:31` usage.
- Edit: `apps/api/src/services/portal-viz-refresh.service.ts` — the four references (`:14`, `:107`, `:169`, `:228`). Mechanical rename only; behavior untouched.
- Edit: `packages/core/src/contracts/index.ts` — re-exports.
- New: `packages/core/src/contracts/data-table-widget.contract.ts` (spec Surface 2).
- New: `packages/core/src/__tests__/contracts/data-table-widget.contract.test.ts`.
- Edit: `packages/core/src/__tests__/contracts/pinned-result.contract.test.ts` — renamed symbol.

**Steps**

1. **Tests (spec cases 1–5).** Inline content parses with and without `pipeline`; handle content parses with a full envelope + `pipeline`; content carrying `queryHandle` **and** `rows` resolves to the *handle* branch (union order); `VizPipelineSchema` rejects empty `sql`/`stationId`/`organizationId` and accepts an opaque `transform`; `PinnedDataTableContentSchema` still parses. Run; fail.
2. **Implement** the rename, then the new contract file + re-exports. Green.
3. Lint + type-check — this is where a missed rename consumer surfaces (there is no alias to mask it).

**Done when:** cases 1–5 pass; `npm run type-check` is clean across all three packages; nothing constructs a `pipeline` for a table yet.

**Risk:** low. The rename's blast radius is fully typed, so `type-check` is the backstop. Remember to rebuild `@portalai/core` before type-checking `apps/api|web` (`project_stale_core_dist_after_branch_switch`).

---

## Slice 2 — The sink attaches the pipeline

Every SQL-backed result gains its re-executable query. Invisible end-to-end: the block projection still whitelists it away.

**Files**

- Edit: `apps/api/src/tools/result-sink.ts` — the `{sql}` arm (spec Surface 3).
- Edit: `apps/api/src/__tests__/tools/result-sink.test.ts` — new cases + **existing inline/handle assertions updated** for the added key.
- Edit: `apps/api/src/__tests__/tools/sql-query.tool.test.ts` — same, wherever a result shape is asserted whole.

**Steps**

1. **Tests (spec cases 12–15).** Inline attaches `pipeline` with the sink's `sql` + `ctx` ids, preserving `{rows}`; same for the `{rows, truncated, totalCount}` and `{sample, totalCount}` shapes; the handle branch returns `{type:"data-table", …envelope, pipeline}`; **`{value}` / `{rows}` / `{transform}` sinks attach no pipeline** (the over-reach guard — they have no originating SELECT). Run; fail.
2. **Implement** the `{sql}` arm per spec. Green.
3. **Sweep `toEqual`/`toStrictEqual` assertions** across both suites — any test asserting a whole inline result now needs `pipeline`. This is the slice's real work; expect several updates.
4. Lint + type-check.

**Done when:** cases 12–15 pass and every pre-existing `result-sink` / `sql-query` assertion is green. `resolveDisplayBlock` still drops the field, so no block changes yet.

**Risk:** the assertion sweep is the likely source of churn. Prefer `expect.objectContaining` where a test's intent isn't shape-exactness, but don't loosen a test that was deliberately pinning the full shape.

---

## Slice 3 — The projection keeps it + the d3 fallback stops losing it

Blocks on the wire become query-backed. Adds the source-level sink guard, which is only satisfiable now.

**Files**

- Edit: `apps/api/src/services/portal.service.ts` — both data-table arms (spec Surface 4).
- Edit: `apps/api/src/tools/visualize-d3.tool.ts` — hoist `pipeline` above the codegen loop; add it to both fallback returns (spec Surface 5).
- Edit: `apps/api/src/__tests__/services/portal.service.test.ts` — the `resolveDisplayBlock` suites (`:1511-1620`).
- Edit: `apps/api/src/__tests__/tools/visualize-d3.tool.test.ts`.
- Edit: `apps/api/src/__tests__/tools/no-open-coded-sink.test.ts` — the source-level guard.

**Steps**

1. **Tests (spec cases 16–21).** Inline block content includes `pipeline` when the tool result carries one; handle block content includes it alongside `queryHandle/rowCount/schema/samplePeek/sampled`; a result with no pipeline yields content with the **key absent**, not `undefined`-valued; the empty-rows path still returns `null`; the d3 codegen fallback returns `{type:"data-table", rows, pipeline, message}` and its handle variant likewise; d3 success returns unchanged (regression pin). Run; fail.
2. **Implement** the projection change and the `pipeline` hoist. Green.
3. **Extend the sink guard.** Assert no tool file constructs a `{type: "data-table"}` result without a `pipeline` alongside it — so a future SQL tool cannot mint a terminal block by omission. `visualize-d3.tool.ts` now satisfies this rather than needing an allowlist entry; keep the allowlist empty if the existing guard has one.
4. Lint + type-check.

**Done when:** cases 16–21 pass; the guard fails if `pipeline` is removed from either d3 fallback return (verify by temporarily deleting one).

**Risk:** the `resolveDisplayBlock` suites are large and shape-exact; expect the same assertion sweep as slice 2. The `key absent vs undefined` distinction (case 20) matters because the contract field is `.optional()` — spreading an `undefined` value would still serialize as absent in JSON but fails a strict `toEqual` against `{}`.

---

## Slice 4 — The refresh service admits `data-table`

The server can now re-execute a table's pipeline. No client asks yet.

**Files**

- Edit: `apps/api/src/services/portal-viz-refresh.service.ts` — `REFRESHABLE_BLOCK_TYPES` (spec Surface 6).
- Edit: `apps/api/src/__tests__/services/portal-viz-refresh.service.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal-viz-refresh.integration.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` — case 30.

**Steps**

1. **Unit tests (spec cases 22–26).** A `data-table` block with a pipeline returns the fresh delivery; **without** one throws 422 `VIZ_WIDGET_NOT_REFRESHABLE` (not 404); an unregistered block type still throws 404 `VIZ_WIDGET_NOT_FOUND`; cross-org throws 404 (no existence leak); **top-N — a stubbed `resolveSqlDelivery` receives `pipeline.sql` verbatim and its changed row *set* is returned**. Run; fail.
2. **Integration tests (spec cases 27–29).** `POST /api/portal-sql/widget-refresh` against a persisted data-table block returns `{kind:"inline", rows}`; returns `{kind:"handle", …}` past the threshold; rate limiting still applies on the shared `viz-refresh:<org>` key.
3. **Case 30** — pinning an *inline* data-table block yields a pin whose content carries `pipeline`, and `POST /api/portal-results/:id/refresh` succeeds against it. This needs **no pin-side code** (spec Key decision 4); it passes purely because slices 2–3 put the pipeline on the source block. If it fails, the cause is upstream, not in `portal-result-pin.service.ts`.
4. **Implement** the type-set widening. Green.
5. Lint + type-check.

**Done when:** cases 22–30 pass; no `WidgetRefreshResponse` change was needed (spec Key decision 3 — if you find yourself adding a variant, stop and re-read the contract).

**Risk:** case 23's status-code flip (404 → 422) is a deliberate behavior change; an existing test may assert 404 for a data-table block and will need updating rather than preserving.

---

## Slice 5 — `WidgetFreshnessBar` extracted and adopted (pure refactor)

Shared chrome with the new degraded state, adopted by the three existing surfaces. No behavior change beyond the degraded chip becoming *possible*.

**Files**

- New: `packages/core/src/ui/WidgetFreshnessBar.tsx` (spec Surface 7); edit `packages/core/src/ui/index.ts`.
- New: `packages/core/src/__tests__/ui/WidgetFreshnessBar.test.tsx`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` (`:277-320`), `apps/web/src/modules/D3Widget/D3Widget.component.tsx` (`:128-179`), `apps/web/src/views/PinnedResultDetail.view.tsx` (`:217-236`).
- Edit: `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx`, `apps/web/src/modules/D3Widget/__tests__/D3Widget.test.tsx`, `apps/web/src/__tests__/PinnedResultDetail.test.tsx` — the `data-testid` renames.

**Steps**

1. **Tests (spec cases 6–11).** Renders `Updated …` when `lastUpdatedAt` is set, nothing when null; `canRefresh` renders the button with `refreshLabel` as `aria-label` and fires `onRefresh`; `isRefreshing` swaps in a spinner and disables it; **`notRefreshable` renders the cue and NO button** (discovery Q2); **`degraded` renders "Couldn't update — showing data from …" and takes precedence** over the plain cue; the `status` chip renders when not `"ready"`. Run; fail.
2. **Implement** the component per the spec's precedence table. Green.
3. **Adopt in all three surfaces**, deleting the hand-rolled headers. Update the three suites for the shared test ids (`widget-freshness-updated` etc.) — **rename, don't alias**.
4. **Case 39** — map and d3 still render their cue + refresh button after adoption.
5. Lint + type-check.

**Done when:** cases 6–11 + 39 pass; `d3-widget-updated` / `map-widget-updated` no longer appear anywhere in the repo (grep to confirm).

**Risk:** the accessibility rules apply — every icon-only `IconButton` keeps a descriptive `aria-label` (`refreshLabel`). Layout regressions are the other watch item: the header's flex/gap/`mb` values are lifted verbatim from `D3Widget` so map and pin should be visually unchanged, but this is worth an eyeball in the smoke.

---

## Slice 6 — The `TableWidget` module + plumbing deletions

The user-visible slice: a table gets a freshness cue and a working refresh button, inline and handle-backed alike.

**Files**

- New: `apps/web/src/modules/TableWidget/{index.ts,TableWidget.component.tsx,TableWidgetGate.component.tsx,utils/register.util.tsx}` (spec Surface 8).
- New: `apps/web/src/modules/TableWidget/__tests__/{TableWidget,TableWidgetGate,register.util}.test.tsx`, `stories/TableWidget.stories.tsx`.
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — delete the `data-table` arms of `shouldRenderViaWeb` (`:110-113`) and `renderWebBlock` (`:52-59`) (spec Surface 9).
- Edit: `apps/web/src/main.tsx` — call `registerTableBlockRenderer()`.
- **Delete:** `apps/web/src/components/QueryResultDataBlock.component.tsx`.
- Edit: `apps/web/src/__tests__/` — any suite referencing `QueryResultDataBlock`.

**Steps**

1. **Tests (spec cases 31–38).** `TableWidgetUI` renders columns/rows + the freshness bar + the row-cap notice when `rows.length < matchedCount`; **it does not re-enter `ContentBlockRenderer`** (render a `data-table` block through a registry where `data-table` → `TableWidget` and confirm no recursion); the container renders inline content with no snapshot fetch and handle content via the mocked `sdk.portalSql.handleSnapshot`; the degraded chip shows on a mocked refresh error **with the previous rows still on screen**; `notRefreshable` renders the cue with no button; `registerTableBlockRenderer()` overrides the core `data-table` renderer; **`PortalMessage` passes `blockRef` + `dataUpdatedAt` to a handle-backed data-table block** (the regression this ticket exists to fix); `shouldRenderViaWeb` returns false for a queryHandle-carrying data-table. Run; fail.
2. **Implement** `TableWidgetUI` first (pure, props-only), then the container, then the gate, then the registration. Lift the row-cap `Alert` verbatim from `QueryResultDataBlockUI:119-142` — all three clauses and `data-testid="query-result-row-cap-notice"` intact (#277 asserts them).
3. **Wire and delete:** register in `main.tsx`, strip both `PortalMessage` arms, delete `QueryResultDataBlock.component.tsx`. Grep for stragglers before deleting.
4. **Doc-sync sweep** (`CLAUDE.md` → "Keeping Documentation in Sync"). The agent-facing `sql_query` *description* is unchanged — its inputs and semantics didn't move, only its result gained a field the agent never acts on — so the three tool surfaces need no edit. Do confirm with `grep -rn "QueryResultDataBlock\|D3PipelineSchema" docs/ *.md` that no shipped-behavior doc describes the deleted component or the renamed schema, and update any that does.
5. Green; lint + type-check; `npm run format`.

**Done when:** cases 31–38 pass; a table widget in the dev app shows "Updated X ago" + a working refresh button; `QueryResultDataBlock` and both `data-table` web-render arms are gone.

**Risk:** **the recursion hazard is the sharpest in the ticket** (spec Risks, row 1) — `TableWidgetUI` must call `DataTableBlock` directly, never `ContentBlockRenderer`. Case 32 exists for exactly this. Second risk: forgetting the `main.tsx` registration degrades silently (tables render, just never refresh) — case 36 plus the smoke catch it.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests | User-visible |
|---|---|---|---|---|
| 1 | `VizPipelineSchema` rename + table block contract | 1–5 | core unit | No |
| 2 | Sink attaches `pipeline` | 12–15 | api unit | No |
| 3 | Projection keeps it + d3 fallback + sink guard | 16–21 | api unit | No |
| 4 | Refresh service admits `data-table` | 22–30 | api unit + integration | No |
| 5 | `WidgetFreshnessBar` extracted + adopted | 6–11, 39 | core + web unit | Degraded chip becomes possible |
| 6 | `TableWidget` module + deletions + doc sweep | 31–38 | web unit | **Yes** |

Total ≈ **39 cases**, no migration. Commits on `feat/query-backed-viz`; open the draft PR after slice 1.

---

## Cross-slice notes

- **No migration, no seed, no new `ApiCode`.** `VIZ_WIDGET_NOT_FOUND`, `VIZ_WIDGET_NOT_REFRESHABLE`, and `VIZ_REFRESH_RATE_LIMITED` already exist with the right meanings.
- **Rebuild `@portalai/core` between slices that touch it** (1, 5) before type-checking `apps/api|web` — they compile against core's git-ignored `dist/` (`project_stale_core_dist_after_branch_switch`).
- **Assertion sweeps are the hidden cost of slices 2 and 3.** Adding one field to a widely-asserted result shape churns more test lines than implementation lines. Budget for it; don't loosen deliberately-exact assertions to dodge it.
- **`pipeline` stays `.optional()` everywhere.** Every slice must keep pre-#349 blocks parsing — that's what makes this a zero-migration change and what makes the `notRefreshable` path reachable rather than theoretical.
- **The agent-facing result grows by ~80 tokens on the inline path only** (spec Key decision 1) — accepted as duplication of the agent's own argument, not disclosure. Don't "optimize" it away with a side-channel; that was weighed and rejected.
- **Slice 5 is a refactor, slice 6 is the feature.** Keeping them separate means a layout regression in the shared chrome is bisectable independently of the new table behavior.
- **Rate limiting is untouched.** The population of refreshable blocks widens but the per-widget freshness gate and per-org cap are unchanged; the acceptance criteria pin no regression.
- **Toast pattern does not apply here.** Refresh failure renders the inline degraded chip on the widget — per the amended PRD, deliberately *not* a toast, because a failing dependency across several widgets would produce a storm.

---

## Next step

Implementation begins on this branch, slice 1 first, tests before code — **after** discovery, spec, and plan are reviewed and confirmed. Before coding slice 1, re-read the spec's *Surface* sections 1–2: the contract skeletons there are lifted from the real `d3-widget.contract.ts` / `portal-sql.contract.ts` shapes, so copy them rather than reinventing the field lists.
