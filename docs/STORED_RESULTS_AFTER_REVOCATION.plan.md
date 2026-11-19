# Stored results after revocation — Plan

**TDD-sequenced implementation of live-read portal results.** It covers the missing recipes, handle re-auth, refresh's access-loss answer, recipe-only block contracts, the web's live-only rendering, the persist/serve strip with history summaries, and the migration that clears stored rows.

Spec: `docs/STORED_RESULTS_AFTER_REVOCATION.spec.md`. Discovery: `docs/STORED_RESULTS_AFTER_REVOCATION.discovery.md`. Issue: #1038. It builds on the shipped #349 pipelines, the #640 pin live reads and #727's `STALE_REFERENCE` tagging.

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/1038-stored-results-after-revocation` / PR #1086**.

Run tests from each package (never invoke jest directly):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that greens them.
3. Run them focused.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

Sequencing rationale: the server learns to re-run and refuse before anything stops being stored, and the web reads live before the API stops sending stored rows. That way no slice leaves a stored block that renders blank.

| Slice | Why it sits here |
|---|---|
| 1 | Gives `display_entity_records` the recipe the rest assumes every SQL table has. It fixes the repro's refresh `422` on its own. |
| 2 | Re-authorizes handle reads, closing the 24h window. Independent of storage. |
| 3 | Refresh answers access loss with its own code, re-runs a transform pipeline, and `technical_indicator` mints one. These are API read-side changes that web slice 5 relies on. |
| 4 | Adds the recipe-only and not-kept block contracts in core, which slices 5 and 6 parse. |
| 5 | Makes the web read live and render the unavailable and not-kept states. It must land before slice 6, or a stored block with no rows would render empty. |
| 6 | Stops persisting rows and strips legacy rows on serve. History moves to summaries, and the system prompt changes. |
| 7 | Adds the data migration and the Help entry. |

---

## Slice 1 — `display_entity_records` carries a pipeline

Tables from `display_entity_records` refresh like `sql_query` tables.

**Files**
- Edit: `apps/api/src/tools/display-entity-records.tool.ts` (`:64-81`), returning `pipeline: { sql, stationId, organizationId }`.
- Edit: its unit test.

**Steps**
1. **Tests (spec api-unit, display-entity-records ≈ 1).** The result carries `pipeline.sql === 'SELECT … FROM "<entity>"'` plus the build's station and org. Run; it fails.
2. **Implement.** Spread `pipeline` into the returned envelope. Green.
3. Lint + type-check.

**Done when:** the case passes, and `resolveDisplayBlock`'s existing handle arm keeps the pipeline (no change needed, `portal.service.ts:356-378`).

**Risk:** none.

---

## Slice 2 — handle reads re-authorize as the caller

A revoked or detached view makes the caller's own handle answer `404 READ_HANDLE_EXPIRED`.

**Files**
- Edit: `apps/api/src/services/portal-sql-handle.service.ts`, adding `authorizeCallerRead(meta, ctx, deps?)`. It resolves the SQL (`meta.sql`, or the root of the `_transform.sourceHandle` chain), then runs `explainSqlQuery` as the caller. It maps `STALE_REFERENCE`, and a source handle that has expired, to 404, and skips the explain when there's no SQL.
- Edit: `apps/api/src/routes/portal-sql-handle.router.ts` (`:105-131`), calling it in the non-pin branch after the `_userId` check, and adding the 404 case to the `@openapi` block.

**Steps**
1. **Tests (spec api-integration, handle router ≈ 5).** In `portal-sql-handle.router.integration.test.ts`:
   - the owner reads (200);
   - after `DELETE /api/grants/:id` on the view → 404;
   - after the view is detached from the station → 404;
   - a transform handle whose source view is revoked → 404;
   - a staged-rows handle (`produceFromRows`) keeps the owner check (200 for the owner, 404 for others).

   Run; they fail.
2. **Implement** `authorizeCallerRead` and the router call. Green.
3. Lint + type-check, and confirm the route-authorization map entry still matches (same route, a stricter check).

**Done when:** the five cases pass and the existing handle-router tests stay green.

**Risk:** an `EXPLAIN` per page read. Mitigated by reusing the memoized `resolveViewsForSession`. Watch the integration run time.

---

## Slice 3 — refresh: access loss, transform re-runs, `technical_indicator`'s recipe

**Files**
- Edit: `apps/api/src/constants/api-codes.constants.ts`, adding `VIZ_WIDGET_DATA_UNAVAILABLE` and its recommendation.
- Edit: `apps/api/src/services/portal-viz-refresh.service.ts`:
  - `refresh` maps a `PORTAL_SQL_FORBIDDEN` with `STALE_REFERENCE` to `422 VIZ_WIDGET_DATA_UNAVAILABLE`;
  - `runPipeline` folds `pipeline.transform` over a freshly delivered source handle through `produceFromTransform`.
- Edit: `apps/api/src/tools/technical-indicator.tool.ts` (`:86-95`). The transform path returns `pipeline { sql: <source meta sql>, stationId, organizationId, transform }`, and gets no pipeline when the source has no `sql`.
- Edit: `routes/portal-sql-handle.router.ts`: widget-refresh's `@openapi` gains the 422.

**Steps**
1. **Tests:**
   - spec api-unit, viz-refresh ≈ 4: a transform pipeline re-folds; `STALE_REFERENCE` → 422 `DATA_UNAVAILABLE`; a not-kept or pipeline-less block → 422 `NOT_REFRESHABLE`; other errors pass through;
   - technical-indicator ≈ 2;
   - spec api-integration, widget refresh ≈ 2: revoked → 422 `VIZ_WIDGET_DATA_UNAVAILABLE`; access restored → 200 with rows.

   Run; they fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the cases pass, and pin refresh (`executePin`) still maps its own refusals unchanged.

**Risk:** `produceFromTransform` assumes its source handle lives for the fold. The fresh source handle comes from the same request, so it does.

---

## Slice 4 — recipe-only and not-kept block contracts (core)

**Files**
- Edit: `packages/core/src/contracts/data-table-widget.contract.ts`, `d3-widget.contract.ts` and `map-spec.contract.ts`. Each adds a stored shape (the base content with `pipeline` required, no rows/samplePeek/handle) and `NotKeptContentSchema` lands in `contracts/stored-result.contract.ts`. The unions become `[Handle, Inline, Stored]`; not-kept is checked before the union, not as a branch (see the spec).
- Edit: the contract tests.

**Steps**
1. **Tests (spec core contracts ≈ 6).** Stored and not-kept shapes parse for each type, and in-turn handle/inline content still resolves to its branch first. Run; they fail.
2. **Implement** the schemas and exports. Green.
3. Lint + type-check; then `npm run build --workspace=packages/core`, then the root `npm run type-check`, because a union change ripples to web/api typed fixtures (memory: core model change → full build).

**Done when:** core tests pass and the root type-check is clean.

**Risk:** a web or api consumer narrowing the union by `"rows" in content` now sees two more branches. The type-check catches it.

---

## Slice 5 — web renders live data only

**Files**
- Edit: `apps/web/src/utils/use-widget-refresh.util.ts`:
  - message refs read on every mount (the 3-min skip stays for pins);
  - it exposes `unavailable`, set on `VIZ_WIDGET_DATA_UNAVAILABLE`;
  - `lastUpdatedAt` is set only by a completed read.
- Edit: `TableWidget.component.tsx` (`:222-245`), `D3Widget.component.tsx` (`:250-270`) and `MapWidget.component.tsx` (`:965-972`). Data comes from `fresh`, or from in-turn content carrying rows/handle. A stored or not-kept block shows loading, then data, unavailable (`StatusMessage`) or not-kept, and the freshness bar shows only with `lastUpdatedAt`.
- Edit: their tests, plus the `useWidgetRefresh` tests.

**Steps**
1. **Tests:**
   - spec web, hook ≈ 4;
   - widgets ≈ 3 each: a persisted block paints nothing before `fresh`; the unavailable state, with `expectNoAxeViolations`; the not-kept state, with axe.

   Run; they fail.
2. **Implement** the hook changes, then the three widgets' data order and states. Green.
3. Lint + type-check, and the web guard suites (`component-axe`, `effect-mutation`): the mount read uses `mutateAsync` with no per-call options.

**Done when:** the cases pass. A legacy block that still has rows now waits for its live read rather than painting them.

**Risk:** one read per mounted widget on every portal open. It's under widget-refresh's per-org rate limit, and a rate-limited widget shows its error with Retry.

---

## Slice 6 — stop storing rows; strip on serve; history summaries

**Files**
- New: `apps/api/src/services/stored-result.util.ts` (`toStoredBlockContent`, `toStoredToolResult`, `stripStoredMessage`) + `stored-result.util.test.ts`.
- Edit: `apps/api/src/services/portal.service.ts`:
  - `handleToolResult` persists stripped content, with `sseResult` unchanged;
  - `getPortal` and `replayTurn` serve `stripStoredMessage`;
  - `replayResult` and `summarizeToolResult` render `{columns, rowCount}`, and the sample-row code goes.
- Edit: `apps/api/src/prompts/system.prompt.ts`, adding the re-query line, + `system.prompt.test.ts`.

**Steps**
1. **Tests:**
   - spec api-unit, stored-result util ≈ 12;
   - portal.service ≈ 6;
   - system prompt ≈ 1;
   - spec api-integration ≈ 1: a stored block has no rows on `GET` portal.

   Run; they fail.
2. **Implement** the util, then wire persist, serve and history. Green.
3. Lint + type-check, and re-run the slice-3 refresh integration (a stored block still refreshes from its pipeline).

**Done when:** new turns persist no rows, a legacy message serves without them, and the model history carries counts and columns only.

**Risk:** existing `portal.service` tests that assert persisted rows need updating. Diff the test names before committing (memory: scripted test edits can delete tests).

---

## Slice 7 — migration + Help

**Files**
- New: `apps/api/drizzle/<n>_strip-stored-result-rows.sql` (`npm run db:generate -- --name strip-stored-result-rows`, then hand-written as data-only SQL with `-- destructive-ok:`), plus the journal + snapshot (memory: commit the journal with the migration).
- New: the migration integration test.
- Edit: `packages/core/src/content/faq.util.ts` + `faq.util.test.ts`.

**Steps**
1. **Tests:**
   - spec api-integration, migration ≈ 2: a seeded legacy message (inline rows, a handle with `samplePeek`, a pipeline-less table, a raw tool-result with rows) is stripped to the stored/not-kept/summary forms, and a re-run is a no-op;
   - core FAQ ≈ 1.

   Run; they fail.
2. **Implement** the `UPDATE` (batched by id range) and the FAQ entry. Green.
3. `npm run lint:migrations`, lint + type-check, and the full root `npm run build`.

**Done when:** the cases pass and `lint:migrations` accepts the `destructive-ok` reason.

**Risk:** the migration must name no enum values added in the same run (memory), and doesn't. It runs in the deploy's single migrate transaction, so batching is by id range inside it.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `display_entity_records` pipeline | api unit |
| 2 | handle re-auth | handle router integration |
| 3 | `VIZ_WIDGET_DATA_UNAVAILABLE`, transform re-run, `technical_indicator` pipeline | api unit + refresh integration |
| 4 | stored / not-kept contracts | core unit + root type-check |
| 5 | web live-only rendering | web unit + guards |
| 6 | persist/serve strip + history + prompt | api unit + integration |
| 7 | migration + FAQ | migration integration + `lint:migrations` + root build |

Totals ≈ 56 cases, matching the spec.

## Cross-slice notes

- **Order matters for behavior, not just tests.** Slice 5 before 6 keeps every stored block renderable at every commit. Slice 3 before 5 gives the web a real code to branch on.
- **Docs in the same PR.**
  - Slice 6 changes the agent contract, so check `system.prompt.ts` and any tool description that promises results persist (`sql_query`, `display_entity_records`).
  - Slice 7's FAQ goes to the marketing site too (#311).
  - Check `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` if the new `StatusMessage` states change a cited criterion. No row cites widget loading today.
- **Smoke and adversarial** follow implementation:
  - smoke covers the issue's repro (revoke → unavailable, detach → unavailable, restore → rows), a follow-up question that re-queries, and a webhook table's not-kept state;
  - adversarial covers the handle, refresh and migration edges.

## Next step

Implementation starts on this branch with slice 1, tests first and one commit per slice, once this plan is confirmed.
