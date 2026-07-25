# Remove Vega/Vega-Lite visualization tools — Plan

**TDD-sequenced teardown of Vega: remove the producers (tools), then rendering, then routing, then the `vega`/`vega-lite` type vocabulary + Postgres enum last — so nothing references the types by the time they're deleted.**

Spec: `docs/REMOVE_VEGA_TOOLS.spec.md`. Discovery: `docs/REMOVE_VEGA_TOOLS.discovery.md`. Issue: #272 (epic #267). Builds on **#269** (`visualize_d3`, already merged into the epic) — it is the surviving chart tool.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/remove-vega-tools`** (base `epic/d3-dashboard-widgets`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write/adjust the failing (mostly deleted) tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — a removal is torn down leaf-first so each boundary stays green:

- **Slice 1** — the tools cease to exist. Cross-package by necessity: the api `BUILTIN_TOOL_NAMES` set and the core registry must shrink together or the "names == descriptor set" guard fails. Removes api Vega deps.
- **Slice 2** — the core Vega renderers + `react-vega`/`vega`/`vega-lite` from `packages/core`. A persisted Vega block now renders `null` (the existing unregistered-type fallback).
- **Slice 3** — the block-routing that mints/detects Vega (api `resolveDisplayBlock` + web `streamingBlockFor`/`QueryResultDataBlock`/`PortalMessage`) + web Vega deps.
- **Slice 4** — the `vega`/`vega-lite` **types** themselves (Zod + pg enum, moved together) + the migration + doc-sync. Last, because slices 1–3 removed everything that referenced them; now they're dead vocabulary safe to delete. **This closes the epic's Vega removal; #273 re-scopes off the emptied `PINNABLE_BLOCK_TYPES`.**

Full `apps/api` + `apps/web` + `packages/core` suites run at every boundary (the #269 lesson — a pack/type change ripples into route + integration pins, not just unit).

---

## Slice 1 — Remove the Vega tools, compute, webhook path, and registry entries

The two tools and everything that produces a Vega result server-side stop existing. Cross-package: core registry + api names must shrink together (consistency guard).

**Files**

- Delete: `apps/api/src/tools/visualize.tool.ts`, `visualize-tree.tool.ts`, `utils/vega-spec-rewrite.util.ts`, `apps/api/src/__tests__/utils/vega-spec-rewrite.util.test.ts`.
- Edit (api): `services/analytics.service.ts` (drop `visualize`/`visualizeVega`/validators + dangling imports), `services/tools.service.ts` (imports, instantiation, `BUILTIN_TOOL_NAMES` `:169-170`), `tools/webhook.tool.ts:198-213` (drop vega arms), `prompts/system.prompt.ts:304-305` (drop the "retired vega tools" clause), `package.json` (remove `vega`,`vega-lite`), `docs/CUSTOM_TOOLPACK_INTEGRATION.md` (delete vega envelope sections).
- Edit (core): `registries/builtin-toolpacks.ts` (delete the `visualize`/`visualize_tree` tool literals + `CAPABILITIES` entries; reword pack description `:162`).

**Steps**

1. **Tests (spec cases 1, 2, 6, 7).** Remove `visualize`/`visualize_tree` from `EXPECTED_COST_HINTS` (`tool-capabilities.test.ts`) so the key-set equality holds (1); `builtin-toolpacks.test.ts` — data_query pack no longer lists the two tools (2); strip the 9 vega cases from `analytics.service.test.ts` (6); strip the `vega`/`vega-lite` module mocks + registration assertions from `tools.service.test.ts` (7). Run; fail (dangling refs / stale pins).
2. **Implement** the deletions/edits above. Green — the "names == descriptor set" and "every built tool cost-gated" guards hold with the smaller set.
3. Lint + type-check (repo — proves no dangling `vega`/`vega-lite` import remains in api, and the core registry compiles).

**Done when:** cases 1,2,6,7 pass; `apps/api` has no `vega`/`vega-lite` dep and no Vega tool; the agent's built toolset excludes `visualize`/`visualize_tree`. Renderers/routing/types still present (harmless).

**Risk:** the consistency guard couples core+api — run the **full api unit suite**, not just the touched files, at the boundary (the #269 miss). `webhook.tool.ts` other result-type arms must stay intact.

---

## Slice 2 — Remove the core Vega renderers + `packages/core` deps

The block renderer stops knowing Vega; an unregistered `vega-lite`/`vega` block falls through to `ContentBlockRenderer`'s existing `null`.

**Files**

- Edit: `packages/core/src/ui/ContentBlockRenderer.tsx` — delete `LazyVegaLite`/`LazyVega`, `ensureBaseDataset`/`fixForceLayout`/`fixStratifyRoots`/`normalizeVegaSpec`, `VegaErrorBoundary`, `renderVegaLite`/`renderVega`, `CHART_BOUNDS`, the `["vega-lite",…]`/`["vega",…]` Map seeds, and the `react-vega` import.
- Edit: `packages/core/package.json` — remove `react-vega`/`vega`/`vega-lite` from **both** dep blocks.

**Steps**

1. **Tests (spec case 5).** In `ContentBlockRenderer.test.tsx`, delete the vega/vega-lite render + repair-heuristic suite (~38 refs); add a case: a `{type:"vega-lite"}` block renders `null` (unregistered, no crash). Run; fail (imports/mocks reference deleted symbols).
2. **Implement** the renderer + dep deletions. Green.
3. Lint + type-check (core builds with no `react-vega` import → dep drop is safe).

**Done when:** case 5 passes; `packages/core` has no Vega dep; text/data-table/mutation/registered-d3 rendering unchanged. api routing still constructs vega blocks (they now render `null`) — removed next slice.

**Risk:** confirm nothing else in core imports the deleted `CHART_BOUNDS`/`VegaErrorBoundary` (survey: Vega-only; the D3 widget has its own `CHART_BOUNDS`).

---

## Slice 3 — Remove Vega block routing (api + web) + `apps/web` deps

Nothing mints or detects a Vega block anymore.

**Files**

- Edit (api): `services/portal.service.ts` `resolveDisplayBlock` — delete the vega-lite (`:177-182`) and vega (`:183-188`) arms.
- Edit (web): `utils/portal-stream.util.ts` `streamingBlockFor` (drop the vega arms `:47-50` + legacy comment), `components/QueryResultDataBlock.component.tsx` (drop the chart/`spec` branch → data-table-handle-only), `components/PortalMessage.component.tsx` (`renderWebBlock`/`shouldRenderViaWeb` narrow to `data-table`), `package.json` (remove `react-vega`/`vega`/`vega-lite`).

**Steps**

1. **Tests (spec cases 8, 10, 11, 12).** Delete the `resolveDisplayBlock` vega cases in `portal.service.test.ts` (8); delete the `visualize`/`visualize_tree`→vega mapping cases in `portal-stream.util.test.ts` + add that those toolNames map to no block (10); delete the chart/spec cases in `QueryResultDataBlock.test.tsx`, keep tabular (11); delete/adjust vega-lite routing in `PortalMessage.test.tsx`, keep data-table/d3/text (12). Run; fail.
2. **Implement** the routing deletions + web dep drop. Green.
3. Lint + type-check (web builds with no Vega import).

**Done when:** cases 8,10,11,12 pass; no api/web code routes a Vega block; `apps/web` has no Vega dep. The `vega`/`vega-lite` *types* still exist in the enums (dead vocabulary) — removed next.

**Risk:** verify `apps/web` source imported the Vega deps only vestigially (via core's `ContentBlockRenderer`, not directly) so the dep drop doesn't dangle; `type-check`/`build` catches it.

---

## Slice 4 — Remove the `vega`/`vega-lite` types + Postgres enum + doc-sync

The type vocabulary is deleted from Zod and the DB together (dual-schema), via the recreate-enum migration.

**Files**

- Edit (core): `models/portal-result.model.ts` (`PortalResultTypeSchema` → `["text","data-table"]`), `contracts/portal.contract.ts` (`PortalBlockTypeSchema` drops `"vega-lite"`,`"vega"` + doc comment).
- Edit (api): `db/schema/portal-results.table.ts` (`portalResultTypeEnum` → `["text","data-table"]`); regen `db/schema/zod.ts` + confirm `db/schema/type-checks.ts:603`; new migration `drizzle/0073_remove_vega_portal_result_types.sql` + `meta/` snapshot; `config/swagger.config.ts:1411-1412` (drop `vega-lite`).

**Steps**

1. **Tests (spec cases 3, 4, 9, 13).** `portal-result.model.test.ts`: delete vega accept cases + fixtures, add `safeParse("vega") === false` (3). `portal.contract.test.ts`: delete vega block-type + `PINNABLE_BLOCK_TYPES.has("vega")` cases, add reject + "no visualization type pinnable" (4). `portal-results.repository.integration.test.ts:99-114`: rewrite the `vega-lite` pinned-result row to a valid type (9). Migration probe (13): fresh migrated DB → `portal_result_type = {text, data-table}`; `type='data-table'` inserts, `type='vega'` rejected. Run; fail.
2. **Implement:** edit the enum in `portal-results.table.ts`, run `npm run db:generate -- --name remove_vega_portal_result_types` to advance the snapshot, then **replace the generated SQL** with the hand-authored recreate-type sequence (rename old → create 2-value → `ALTER COLUMN … USING type::text::…` → drop old); edit the two Zod enums; edit swagger. Green.
3. Lint + type-check (the dual-schema `IsAssignable` pair proves Zod + Drizzle moved together) + **repo grep** `grep -rn "vega" apps packages --include=*.ts --include=*.tsx` returns clean (case 14, manual).

**Done when:** cases 3,4,9,13 pass; the migration applies on a fresh DB; `PINNABLE_BLOCK_TYPES` has no visualization type; a `grep` for `vega` in source is clean. **Epic Vega removal complete.**

**Risk:** `db:generate` may emit no/broken SQL for the value-drop — the hand-authored migration is mandatory (don't ship the generated stub). The migration is the one integration-gated step; run `npm run test:integration` here.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | tools + compute + webhook + registry + api deps + prompt/custom-doc | 1,2,6,7 | core + api unit |
| 2+3 | core Vega renderers + api/web routing + core/web deps (merged — see note) | 5,8,10,11,12 | core + api + web unit |
| 4 | Vega types + pg enum + migration + swagger | 3,4,9,13,14 | core + api unit + **integration** |

Total ≈ **14 cases** (mostly deletions), one net-new migration + probe. Commits on `chore/remove-vega-tools`; PR opened after these docs confirm.

> **Slices 2 and 3 were merged during implementation.** The plan assumed removing core's Vega renderers (slice 2) would leave a green tree with routing intact (slice 3). It didn't: `ContentBlockRenderer` is shared, so the moment core stops rendering `vega-lite`/`vega`, the web tests that assert those blocks render (`PortalMessage`, `PortalSession`, `QueryResultDataBlock`, `cache-invalidation`) go red. Keeping every slice green (a hard rule) forced core renderers + api/web routing + both dep drops into one commit — the same cross-package coupling the #269 lesson flags. Slice 4 (types + pg enum + migration) stays separate.

## Cross-slice notes

- **The enum is the only hard coupling** — core Zod (`PortalResultTypeSchema`) + api Drizzle (`portalResultTypeEnum`) + `type-checks.ts:603` must change in one slice (slice 4) or `type-check` fails. Everything else is string-keyed and decouples cleanly.
- **Teardown order is load-bearing:** removing the type (slice 4) before its consumers (slices 1–3) would leave dangling references; keep the order.
- **Run the full api + web suites at each boundary**, not just touched files — a Vega removal ripples into route/integration pins (the #269 lesson: unit-only local runs missed the `toolpacks.router` integration pin).
- **Migration is hand-authored** (Postgres has no `DROP VALUE`); the generated stub must be replaced. `--name remove_vega_portal_result_types`, index `0073`. No backfill (no rows carry the removed values).
- **Doc-sync is in-PR:** `system.prompt.ts` + `CUSTOM_TOOLPACK_INTEGRATION.md` (slice 1), `swagger.config.ts` (slice 4). Glossary already says `visualize_d3`; READMEs/CLAUDE.md grep-clean.
- **#273 cross-ticket:** after slice 4, `PINNABLE_BLOCK_TYPES` holds no visualization type and `d3` was never pinnable → #273 (pin gating) has nothing to gate; re-scope it. #272 does not touch pin-affordance code.

## Next step

Implement slice 1 on this branch once discovery + spec + plan are confirmed: tests-first, one commit per slice (`chore(api,core): remove vega tools …`, etc.).
