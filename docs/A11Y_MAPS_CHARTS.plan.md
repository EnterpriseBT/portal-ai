# Accessible maps and charts — Plan

**TDD-sequenced implementation of #796: a required agent-written `summary` on chart and map blocks, every chart and map rendered as a named and described figure, a paged "Show data" table over the widget's own data, and keyboard inspection of maps through "Features in view".**

Spec: `docs/A11Y_MAPS_CHARTS.spec.md`. Discovery: `docs/A11Y_MAPS_CHARTS.discovery.md`. Issue: #796 (epic #791). Builds on shipped #794 (`DataTableBlock`'s caption and `aria-sort`) and the existing query-handle endpoint and SDK (`sdk.portalSql.handleSnapshot`, `apps/web/src/api/portal-sql.api.ts:31`).

Five slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/796-a11y-maps-charts`**, one feature and one PR (per `CLAUDE.md` → "Phase = commit, not PR"), which merges into `epic/a11y-conformance`.

Run tests from each package (never invoke jest directly; see `feedback_use_npm_test_scripts`), scoped to the touched files locally:

```bash
cd packages/core && npm run test:unit -- --testPathPattern <files>
cd apps/api && npm run test:unit -- --testPathPattern <files>
cd apps/web && npm run test:unit -- --testPathPattern <files>
```

Each slice runs the same loop:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Do a focused run.
4. Run `npm run lint && npm run type-check` at the boundary. A slice that changes core also runs the root `npm run build`, because a new core field reaches web's typed fixtures.
5. Move to the next slice.

Sequencing rationale:

- **Slice 1** pins the contract and makes the agent write the summary. Every later slice reads `content.summary`, and new blocks carry one from here on.
- **Slice 2** adds the derived fallback and the figure wrapper, then wires both widgets. After this slice every chart and map is named and described, with no data table yet.
- **Slice 3** adds paging to `DataTableBlock`, builds `VisualDataTable` and fills `VisualFigure`'s `data` slot. It needs slice 2's wrapper.
- **Slice 4** covers map keyboard inspection. It is independent of slice 3, but it sits after slice 2 because the key hint and feature list live inside the figure.
- **Slice 5** re-runs the audit, closes KB-09 and does the doc-sync pass.

No migration and no seed (spec → Migration).

---

## Slice 1: `summary` contract, tools, mirror and prompt

The block contracts accept a `summary`, and both tools require one and emit it. Nothing renders it yet.

**Files**

- Edit: `packages/core/src/contracts/d3-widget.contract.ts` and `map-spec.contract.ts`: add `summary: z.string().optional()` to `D3BaseContentSchema` / `GeoBaseContentSchema`.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts`: add `summary` to the `visualize_d3` / `visualize_map` parameter schemas, add it to `required`, and add it to the examples.
- Edit: `apps/api/src/tools/visualize-d3.tool.ts` and `visualize-map.tool.ts`: add `summary` to `InputSchema` (`descriptionField("Summary").trim().min(1, …).describe(…)`) and emit it on every chart and map block, but not on the d3 `data-table` fallback.
- Edit: `apps/api/src/prompts/system.prompt.ts`: add one rule each under "### Charting" and "### Mapping".
- Edit: the tests listed below. Also edit any fixture that builds `visualize_d3` / `visualize_map` input and now fails parse.

**Steps**

1. **Tests (spec → TDD test plan, Core contracts ~4; API tools ~11).**
   - **Core contracts:** a block with and without `summary` parses, and a pinned block with `summary` passes `.strict()`.
   - **`visualize-d3.tool.test.ts`:** the input schema refuses a missing summary, a blank one and one over 2000 characters. `summary` reaches the inline and handle blocks, and the `data-table` fallback has none.
   - **`visualize-map.tool.test.ts`:** the same cases for inline and handle blocks.
   - **`system.prompt.test.ts`:** pins both rules.

   Run them and confirm they fail.
2. **Implement** the schema fields, the emits, the mirror and the prompt rules. `builtin-toolpack-schema-parity.test.ts` must pass with no edits of its own.
3. Search for callers outside the agent (`grep -rn "visualize_d3\|visualize_map\|VisualizeD3Tool\|VisualizeMapTool" apps packages`), such as fixtures, e2e stubs and the Anthropic stub in `packages/e2e`. Give each one a `summary`.
4. Lint, type-check and the root build. Green.

**Done when:** the contract, tool and prompt cases pass, the parity test is green unchanged, and no caller sends a summary-less visualize call.

**Risk:** the e2e Anthropic stub may script a visualize call. It would now get `TOOL_INPUT_INVALID`, and only the E2E workflow would notice. Step 3 covers it.

---

## Slice 2: `deriveVisualSummary`, `VisualFigure` and both widgets as figures

Every chart and map, inline or pinned, becomes a figure named by its title and described by a visible summary. A block without a summary gets the derived one. The D3 iframe gets a name, the srcdoc gets `lang`, and the placeholders become figures too.

**Files**

- New: `packages/core/src/utils/visual-summary.util.ts` (`VisualSummaryInput`, `deriveVisualSummary`, `visualSummary`), plus its export from the utils barrel.
- New: `apps/web/src/components/VisualFigure.component.tsx` (`VisualFigureUI`, pure UI). This slice builds the data slot's toggle too, so slice 3 only fills it.
- Edit: `apps/web/src/modules/D3Widget/D3Widget.component.tsx`: add `summary` to `D3WidgetUIProps` and render through `VisualFigureUI`. The container computes the summary with `visualSummary`.
- Edit: `D3SandboxFrame.component.tsx`: add the `title` prop and set the iframe title to `` `${title || "Chart"} (chart)` ``.
- Edit: `utils/sandbox-srcdoc.util.ts`: `<html lang="en">`.
- Edit: `D3WidgetGate.component.tsx`: the placeholder takes `title` and `summary` and renders a hidden named figure.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` (and `MapWidgetGate` if it renders a placeholder): render through `VisualFigureUI` with `summary`.
- Edit: the D3 and map widget stories gain a summary. New: `VisualFigure.stories.tsx`.

**Steps**

1. **Tests (spec → Core `visual-summary.util.test.ts` ~10; Web `VisualFigure.test.tsx` ~5; D3 ~6 of 10; map ~3 of 5).**
   - **`visual-summary.util.test.ts`:** the exact chart and map strings, a block with no title, an inexact count, field truncation past 6, empty data, one layer versus several, and an agent summary winning over the derived one.
   - **`VisualFigure.test.tsx`:** the figure role, the name and description wiring, the hidden title fallback, no Data button when `data` is absent, and axe.
   - **`D3Widget.test.tsx`:** named by the title or "Chart", described by the summary, and axe.
   - **`D3SandboxFrame.test.tsx`:** the iframe title comes from the prop.
   - **`D3WidgetGate.test.tsx`:** the placeholder is a named, described figure.
   - **`MapWidget.test.tsx`:** the figure's name and summary, and axe.

   Run them and confirm they fail.
2. **Implement** the util, then `VisualFigureUI`, then wire the widgets. Keep `testId` `d3-widget` / `map-widget` so existing tests and the e2e walk still find them.
3. Lint, type-check and the root build. Green.

**Done when:** these cases pass and the existing D3 and map widget suites are still green.

**Risk:** the map's `role="region"` canvas now sits inside a `role="figure"`. Axe allows that, but check the map story under `a11y:stories` before moving on.

---

## Slice 3: paged "Show data" table

"Show data" opens the full result: inline rows directly, or the handle snapshot paged by offset, with the cap note, an expired-handle message with Refresh, and errors shown through `StatusMessage`. It also works on a chart that failed to render.

**Files**

- Edit: `packages/core/src/ui/DataTableBlock.tsx`: add the optional `paging` prop (controlled pagination, no search or sort, `aria-busy` while loading).
- New: `apps/web/src/components/VisualDataTable.component.tsx` (`VisualDataTableUI` and the `VisualDataTable` container, plus the `VisualDataSource` type).
- Edit: `D3Widget.component.tsx`: the container derives `dataSource` from `effectiveHandle` / `inlineRows` (`:240-261`) and the UI passes `<VisualDataTable>` as `data`, in error states too.
- Edit: `MapWidget.component.tsx`: the same, with geometry columns dropped from inline rows and the handle source for tiled maps.
- New: `VisualDataTable.stories.tsx`. The widget stories gain a data variant.

**Steps**

1. **Tests (spec → Core `DataTableBlock.test.tsx` ~6; Web `VisualDataTable.test.tsx` ~6; D3 ~4 of 10; map ~2 of 5).**
   - **`DataTableBlock`:** paging mode shows `total`, fires `onPageChange` / `onRowsPerPageChange`, renders no search box or sort buttons, and sets `aria-busy` while loading. Without `paging` nothing changes. Axe.
   - **`VisualDataTableUI`:** inline rows, paged mode, the cap note exact and inexact, the expired message with Refresh, a server error through `StatusMessage`, and axe.
   - **`D3Widget`:** "Show data" toggles `aria-expanded` and the region, an error state still offers data, and axe with the table open.
   - **`MapWidget`:** data toggling, and geometry columns are absent from an inline map's table.

   Run them and confirm they fail.
2. **Implement** core paging first, then rebuild core. Then build `VisualDataTableUI`, then the container: page state, `sdk.portalSql.handleSnapshot`, a `READ_HANDLE_EXPIRED` check and `serverErrorMessage`. Wire both widgets last.
3. Lint, type-check and the root build. Green.

**Done when:** these cases pass, and in a dev session a handle-backed chart pages through the data with one request per page.

**Risk:** web's partial mocks of `api.util` / `sdk` may lack `portalSql.handleSnapshot`, and those tests fail only in CI (`project_web_partial_module_mocks`). Grep the D3 and map widget test fakes before pushing.

---

## Slice 4: map keyboard description and "Features in view"

A keyboard user can focus the map, read how the keys work, reach a list of the features in view, open any of them, and see it highlighted. Count changes are announced. Each label carries the layer's `colorBy` value.

**Files**

- New: `apps/web/src/modules/MapWidget/utils/rendered-features.util.ts` (`collectRenderedFeatures`, `RenderedFeature`).
- New: `apps/web/src/modules/MapWidget/MapFeatureList.component.tsx` (`MapFeatureListUI`).
- Edit: `utils/map-config.util.ts`: every layer kind's paint gains the `feature-state` `selected` case.
- Edit: `MapWidget.component.tsx`:
  - the `locale: { "Map.Title": … }` name, the visible key hint and the canvas's `aria-describedby`;
  - on `idle`, collect the features in view; `onSelect` opens the popup and sets the feature state;
  - Escape returns focus to the list item;
  - a debounced `StatusMessage` announces the count;
  - the `layout` prop decides side or stacked.
- New: `MapFeatureList.stories.tsx`.

**Steps**

1. **Tests (spec → map `rendered-features.util.test.ts` ~6, `MapFeatureList.test.tsx` ~6, `map-config.util.test.ts` ~2, `MapWidget.test.tsx` key hint ~1).**
   - **`collectRenderedFeatures`:** dedupe across tile copies, the 200 cap with `total`, a template label, a fallback label, the `colorBy` value in the label, and a centroid per geometry type.
   - **`MapFeatureListUI`:** a heading with the count, items that are buttons named by their label, `aria-pressed` on the selected one, the over-cap note, `onSelect`, and axe.
   - **`map-config`:** each layer kind carries the selected case.
   - **`MapWidgetUI`:** the key hint is the canvas's `aria-describedby` target.

   Run them and confirm they fail.
2. **Implement** the util, then the list, then the paint case, then the container wiring.
3. Lint and type-check. Green.

**Done when:** these cases pass. A manual pass on the dev stack shows Tab to the map, arrow keys to pan, `+`/`−` to zoom, Tab into the list, Enter to open a popup with its feature highlighted, and Escape returning focus to the list.

**Risk:**
- jsdom has no WebGL, so the `idle` → `queryRenderedFeatures` → `setFeatureState` wiring isn't unit-testable beyond the existing maplibre mock. The pure util and UI carry the tests, and the wiring is checked by smoke.
- `queryRenderedFeatures` may be slow on dense tiles. It runs once per `idle` with the 200-feature cap.

---

## Slice 5: audit re-run, KB-09 close-out and doc sync

**Files**

- Edit: `docs/A11Y_AUDIT.md`: regenerate it and mark KB-09 closed with this PR's number.
- Edit, if affected: the user-facing Help surfaces (see Steps).

**Steps**

1. **Test:** `npm run a11y:report` against the dev stack. The #796 section must be empty, and `portal` and `portal-result-detail` are already in `a11y-routes.ts`.
2. **Doc-sync check** (CLAUDE.md → "Keeping Documentation in Sync"):
   - The tool surfaces were updated in slice 1.
   - Check `glossary.util.ts`, `faq.util.ts` and the README files for anything that says a chart or map is visual-only, or that names a "data" view. Add a FAQ entry only if one already covers charts and maps.
3. Lint. Green.

**Done when:** the audit section is empty and KB-09 is closed.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `summary` on contracts, tools, mirror and prompt | core and api suites; parity test; root build |
| 2 | `deriveVisualSummary`, `VisualFigure`, both widgets as figures | core util; web figure, D3 and map suites |
| 3 | `DataTableBlock` paging, `VisualDataTable`, "Show data" | core table; web table and widget suites |
| 4 | Key hint, `MapFeatureList`, highlight, announcements | map util, list and config suites; manual keyboard pass |
| 5 | Audit re-run, KB-09, doc sync | `a11y:report` with the #796 section empty |

Totals ≈ 78 cases, matching the spec.

## Cross-slice notes

- **Core changes need a rebuild.** Slices 1–3 touch core. Rebuild it (`npm run build` at the root, or `turbo --force` if a stale cache shows up) before running web tests. Run the full root build before pushing (`feedback_core_model_change_run_full_build`).
- **Two tests split across slices.** `D3Widget.test.tsx` and `MapWidget.test.tsx` gain cases in slices 2, 3 and 4. Each slice adds only the cases its own code makes pass, and nothing waits on a later slice.
- **Pinned results:** `PinnedD3ContentSchema` / `PinnedGeoContentSchema` inherit `summary`, so pinning keeps it with no route change. Pre-#796 pins get the derived summary from slice 2.
- **No cache invalidation:** nothing here is a mutation. The snapshot reads are imperative (`handleSnapshot`) and keyed per handle and page.
- **Epic keep-pace:** before this PR merges into `epic/a11y-conformance`, merge `main` into the epic branch.

## Next step

Implementation starts on this branch once discovery, spec and plan are confirmed: slice 1 first, tests first, one commit per slice.
