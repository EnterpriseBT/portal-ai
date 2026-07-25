# Remove Vega/Vega-Lite visualization tools — Discovery

**Issue:** [EnterpriseBT/portal-ai#272](https://github.com/EnterpriseBT/portal-ai/issues/272) (epic #267, branch base `epic/d3-dashboard-widgets`) · **Task**

**Why this exists.** #269 shipped `visualize_d3` as the successor charting tool; keeping the legacy Vega `visualize`/`visualize_tree` alongside it leaves two competing visualization contracts live — duplicated agent guidance, cost/pin surfaces, toolpack mirrors, and ~800 lines of Vega spec-repair heuristics — and (per the #269 smoke walk) the agent keeps routing chart prompts to the Vega tools instead of `visualize_d3`. This is a **total clean cut**: remove the Vega tools, their compute paths, their spec-repair machinery, the `vega`/`vega-lite`/`react-vega` dependencies, the `vega`/`vega-lite` block/result **types** (including the Postgres enum), and every reference — so `visualize_d3` is the only chart path and no Vega vocabulary survives anywhere. The deployed QA environment is ephemeral and no orgs use Vega or webhooks, so there is no legacy content to preserve — the ticket that erases Vega, full stop.

## The current shape

### Vega tools + compute (apps/api) — delete wholesale

| Piece | Location | Note |
|---|---|---|
| `VisualizeTool` | `apps/api/src/tools/visualize.tool.ts:43-88` | slug `visualize`; emits `type:"vega-lite"`; imports `rewriteForNamedDataset` |
| `VisualizeTreeTool` | `apps/api/src/tools/visualize-tree.tool.ts:42-88` | slug `visualize_tree`; emits `type:"vega"` |
| `rewriteForNamedDataset` | `apps/api/src/utils/vega-spec-rewrite.util.ts:1-49` | only importer is `visualize.tool.ts:7` — dies with the tool |
| `AnalyticsService.visualize` / `visualizeVega` | `analytics.service.ts:516-531`, `541-578` | + validators `validateVegaLiteSpec` (264-271), `validateVegaSpec` (273-283); vega imports `31-34`,`40` go dangling |
| registration | `tools.service.ts:23-24` (imports), `510-514` (instantiation), `169-170` (`BUILTIN_TOOL_NAMES`) | `VisualizeD3Tool`/`visualize_d3` (25, 171, 529-533) all stay |

### Registry + capability mirror (packages/core/registries/builtin-toolpacks.ts)

`data_query` pack description (`:162`) says "render **Vega-Lite or Vega** charts" — reword. Tool literals `visualize` (`:205-219`) and `visualize_tree` (`:221-235`) — delete. `CAPABILITIES`: `visualize` (`:1089`), `visualize_tree` (`:1090`) — delete (`visualize_d3` `:1094-1101` stays). The `visualize` **pack** slug (the #269 pack holding `visualize_d3`) is unrelated — keep.

### Renderer + repair heuristics (packages/core/ui/ContentBlockRenderer.tsx)

Vega-only, delete: `LazyVegaLite`/`LazyVega` (`:12-18`), `ensureBaseDataset`/`fixForceLayout`/`fixStratifyRoots`/`normalizeVegaSpec` (`:27-`,`54-`,`132-`,`158-`), `VegaErrorBoundary` (`:183-`), `renderVegaLite`/`renderVega` (`:240-280`), the Map seeds `["vega-lite",…]`/`["vega",…]` (`:299-300`), and **`CHART_BOUNDS` (`:234`)** (used only by the two vega renderers; the D3 widget has its own copy at `D3Widget.component.tsx:17`). Shared/keep: the `blockRenderers` Map, `registerBlockRenderer`/`hasBlockRenderer`, `renderText`/`renderDataTable`/`renderMutationResult`. (An unregistered block type already renders `null` via `ContentBlockRenderer` — no placeholder needed.)

### Vega minting + web routing

`resolveDisplayBlock` (`portal.service.ts`): vega-lite arm `:177-182`, vega arm `:183-188` — delete (d3 `:194-203` + data-table `:205+` stay). `streamingBlockFor` (`portal-stream.util.ts:47-50`): the `visualize`/`visualize_tree`/`type:vega*` arms — delete. `QueryResultDataBlock.component.tsx`: the **chart/`spec` branch** (`:28,38,48,87,112-113,150`) is the handle-path vega renderer — the tabular branch (`:84-91`) is non-vega. `PortalMessage.component.tsx`: `renderWebBlock` (`:62`) and `shouldRenderViaWeb` (`:118`) couple `"vega-lite" || "data-table"` — narrow to `data-table`.

### Persisted types — contract/DB

`PortalResultTypeSchema` (`models/portal-result.model.ts:13-19`) and `PortalBlockTypeSchema` (`contracts/portal.contract.ts:164-174`) include `vega-lite`/`vega`; `PINNABLE_BLOCK_TYPES` derives from the former. **DB-synced:** `portal-results.table.ts:10-15` is a real `pgEnum("portal_result_type", …)` (values added by migrations `0024`/`0027`); the dual-schema type-checks keep the Drizzle table and the Zod model in lockstep. `docs/CUSTOM_TOOLPACK_INTEGRATION.md` + `swagger.config.ts:1411-1412` reference the vega block types. **`webhook.tool.ts:198-213`** independently propagates `type:"vega-lite"/"vega"` from custom webhook tools.

## The design space

### Decision 1 — Fate of Vega rendering (resolved: remove entirely)

AC3 originally allowed either a legacy renderer or graceful degradation. The user's directive is a **clean slate**: QA is ephemeral, no org has Vega content, so there is nothing to preserve.

**A. Keep react-vega read-only** — dead deps forever. **B. Lightweight placeholder** — keeps the `vega`/`vega-lite` block types alive as a degraded render path. **C. Remove Vega rendering outright** — delete the renderers + `react-vega`/`vega`/`vega-lite` deps; do *not* register any renderer for the (also-removed) vega types.

**Decision: C.** No placeholder, no read-only renderer. With the block/result types themselves removed (Decision 2), there is no Vega vocabulary left to render, and any stray persisted block hits `ContentBlockRenderer`'s existing `null` fallback (renders nothing) — acceptable because no such content exists in any environment that matters. This is the true clean cut and sheds three heavy deps across `apps/web` + `packages/core`.

### Decision 2 — The block/result types + Postgres enum (resolved: remove)

**A. Leave the enums** — retains `vega`/`vega-lite` as producer-less dead vocabulary. **B. Remove `vega`/`vega-lite` from `PortalResultTypeSchema` + `PortalBlockTypeSchema` + the `portal_result_type` pg enum** — a destructive migration (Postgres can't drop an enum value in place; the type is recreated), which would break any already-pinned Vega row.

**Decision: B.** No production data exists (project memory) and QA is ephemeral, so the destructive migration breaks nothing real, and the user explicitly wants no legacy display-block vocabulary. Removing the types is what lets Decision 1 be a true removal (no types → no renderer needed) and keeps the dual-schema invariant honest (the Zod enums and the pg enum move together). `PINNABLE_BLOCK_TYPES` auto-narrows since it derives from `PortalResultTypeSchema`.

### Decision 3 — Web handle-path + `QueryResultDataBlock` + webhook path

Remove the vega arms from `resolveDisplayBlock` and `streamingBlockFor`; drop `QueryResultDataBlock`'s chart/`spec` branch (it becomes data-table-handle-only); narrow `shouldRenderViaWeb`/`renderWebBlock` to `data-table`. **Also remove `webhook.tool.ts`'s `vega-lite`/`vega` propagation (`:198-213`)** — no orgs use webhooks or Vega, so the clean cut extends to the custom-tool path; `CUSTOM_TOOLPACK_INTEGRATION.md`'s vega envelope docs are deleted, not deprecated.

**Decision: as stated.** Total removal — no code path anywhere still knows the `vega`/`vega-lite` types.

## Tradeoff comparison

| | D1 remove rendering | D2 remove types + migration | D3 remove web + webhook paths |
|---|---|---|---|
| Spread to spec | Yes (renderers + deps) | Yes (enums + migration) | Yes (routing + webhook + custom-tool doc) |

## Recommendation

1. Delete `visualize.tool.ts`, `visualize-tree.tool.ts`, `vega-spec-rewrite.util.ts`; remove `AnalyticsService.visualize`/`visualizeVega` + `validateVegaLiteSpec`/`validateVegaSpec` + dangling `vega`/`vega-lite` imports; drop `vega`+`vega-lite` from `apps/api/package.json`.
2. Remove the `visualize`/`visualize_tree` tool literals + `CAPABILITIES` entries + `BUILTIN_TOOL_NAMES` entries + `tools.service.ts` imports/instantiation; reword the `data_query` pack description.
3. Delete `renderVegaLite`/`renderVega`, `LazyVega*`, the repair heuristics, `VegaErrorBoundary`, `CHART_BOUNDS`, and the `vega-lite`/`vega` Map seeds from `ContentBlockRenderer.tsx` — **no replacement renderer**; drop `react-vega`+`vega`+`vega-lite` from `apps/web` + `packages/core` package.json (both dep blocks in core).
4. Remove the vega arms from `resolveDisplayBlock` + `streamingBlockFor`; drop `QueryResultDataBlock`'s chart/`spec` branch; narrow `shouldRenderViaWeb`/`renderWebBlock` to `data-table`; remove `webhook.tool.ts`'s vega propagation.
5. Remove `"vega"`/`"vega-lite"` from `PortalResultTypeSchema` (`portal-result.model.ts`) and `PortalBlockTypeSchema` (`portal.contract.ts`); regenerate the drizzle-zod + type-checks; hand-author the migration to recreate the `portal_result_type` pg enum without those values (see Migration).
6. `system.prompt.ts`: drop the "preferred over the older visualize/visualize_tree… being retired" clause (`:304-305`) — `visualize_d3` is simply the chart tool.
7. Doc-sync: `swagger.config.ts:1411-1412` pinned-result enum → real `PortalResultTypeSchema` options (drop `vega-lite`); delete the vega envelope sections in `docs/CUSTOM_TOOLPACK_INTEGRATION.md`. Glossary already says `visualize_d3`; READMEs/CLAUDE.md grep-clean.
8. Tests: delete `vega-spec-rewrite.util.test.ts`; strip vega cases from `analytics.service.test.ts`, `portal.service.test.ts`, `tools.service.test.ts`, `portal-stream.util.test.ts`, `QueryResultDataBlock.test.tsx`, `PortalMessage.test.tsx`, `ContentBlockRenderer.test.tsx`; remove `visualize`/`visualize_tree` from `EXPECTED_COST_HINTS` + `BUILTIN_TOOL_NAMES` pins; **delete** the now-invalid vega cases in `portal-result.model.test.ts`, `portal.contract.test.ts`, and `portal-results.repository.integration.test.ts:99-114` (the types no longer exist).

## Migration

`portal_result_type` is a Postgres enum; Postgres has no `DROP VALUE`. `npm run db:generate` does not reliably emit enum-value removal, so **hand-author** the migration: create `portal_result_type_new` without `vega`/`vega-lite`, `ALTER TABLE portal_results ALTER COLUMN type TYPE portal_result_type_new USING type::text::portal_result_type_new`, drop the old type, rename the new one. **No backfill / no dual-write** — there are no rows carrying the removed values (no production data; ephemeral QA), so the `USING` cast can't fail. If a stray row ever existed, the cast would error and surface the assumption — acceptable. Name it `--name remove_vega_portal_result_types`.

## Open questions

All resolved with the issue author (2026-07-24) — clean-slate directive:

1. **Legacy render path** — **Resolved: none.** Remove rendering entirely (Decision 1-C); no placeholder, no read-only renderer.
2. **Block/result types + pg enum** — **Resolved: remove** (Decision 2-B) with a destructive migration; no production/meaningful QA data to preserve.
3. **Custom webhook vega output** — **Resolved: remove** the `webhook.tool.ts` propagation + delete the vega envelope docs (Decision 3); no orgs use webhooks or Vega.

## Enterprise-scale considerations

- **Concurrency & correctness / Multi-tenancy / Scale** — N/A because this is a pure removal of request-scoped tools + client rendering; no shared state, no fan-out.
- **Accuracy & auditability** — N/A; removing producers doesn't touch the usage ledger. The cost-gate pins shrink (two `free` tools gone) — a pin update, not a behavior change.
- **Failure modes** — compile-time removal; nothing to fail open/closed. The one runtime edge — a persisted Vega row surviving the enum migration — is precluded by "no such rows exist"; the `USING` cast would error loudly rather than silently corrupt if that assumption were wrong.
- **Contract stability** — this is a deliberate, **recorded backward-incompatible cut** (enum + block-type vocabulary removed), justified by the ephemeral-QA / no-production-data / clean-slate context — the exact "conscious, stated downgrade" the enterprise lens permits, not a silent default. Post-cut the contract is *simpler* (one chart type, `d3`).
- **Data lifecycle** — no retention concern: there is no Vega content to retain; the migration recreates the enum without backfill because there are no rows to migrate.

## What this doesn't decide

- **Converting historical Vega specs to D3** — out of scope: there is no historical content; nothing to convert.
- **`visualize` *pack* / `visualize_d3`** — untouched; only the Vega *tools* and *types* are removed.
- **Cross-ticket effect on #273 (pin gating):** removing `vega`/`vega-lite` from `PortalResultTypeSchema` narrows `PINNABLE_BLOCK_TYPES` to non-visualization types, and `d3` was never pinnable — so after #272, **there is no pinnable visualization block left**, which may reduce #273 to a near-no-op or re-scope it. Flag for #273; #272 does not touch the pin *affordance* code, only the type vocabulary.

## Next step

`docs/REMOVE_VEGA_TOOLS.spec.md` pins the deletion inventory, the enum-removal migration SQL, the "no replacement renderer" statement, and the per-file test-strip/delete list; then `.plan.md` slices it: (1) api tool + compute + dep removal; (2) core registry/capability/pins + renderer + type removal; (3) web routing + `QueryResultDataBlock`/`PortalMessage` + webhook + dep removal; (4) migration + drizzle-zod/type-checks + doc-sync. Each a testable commit; the smoke verifies the inverse of #269 — a chart prompt routes to `visualize_d3` (no Vega tool offered), `apps/api` builds with zero vega deps, and no `vega`/`vega-lite` string survives a repo grep.
