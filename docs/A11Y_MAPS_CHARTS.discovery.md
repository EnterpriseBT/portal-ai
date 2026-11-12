# Accessible maps and charts — Discovery

**Issue:** [EnterpriseBT/portal-ai#796](https://github.com/EnterpriseBT/portal-ai/issues/796) · Feature · full. Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why this exists.** A portal answer can be a D3 chart or a MapLibre map. Neither has a text alternative. A chart is an agent-written program in a sandboxed iframe whose only name is the fixed `title="D3 visualization"`, so a screen reader hears "frame" (KB-09: WCAG 1.1.1, 4.1.2). A map is a canvas whose features are inspected only by a mouse click on a popup and are told apart only by colour. Neither offers the data behind it in a form a screen reader can read.

The PRD was completed on 2026-11-12:
- the portal agent writes a required `summary` for every chart and map, enforced by the server, and the app derives one for blocks that predate it;
- the fix lives in the shared widgets, so it reaches every host;
- each chart and map links to a data table that pages the **full** result, not only the loaded rows;
- maps get keyboard pan/zoom and a "Features in view" list.

This is the work that gives a screen-reader or keyboard user the same answer a sighted mouse user gets from a chart or map.

## The current shape

### D3 charts (`apps/web/src/modules/D3Widget/`)

| Piece | Location | State today |
|---|---|---|
| Iframe | `D3SandboxFrame.component.tsx:189-205` | `sandbox="allow-scripts"`, `srcDoc`, fixed `title="D3 visualization"`; it ignores the block's title and has no description. |
| Srcdoc | `utils/sandbox-srcdoc.util.ts:15-16,31-55` | Static, CSP `default-src 'none'`, `<html>` with **no `lang`**, bare `#root`. |
| Wrapper | `D3Widget.component.tsx:188-193` | Outlined `Paper` with no role or name. Header is `WidgetFreshnessBar` (`:116-128`), which shows `title`. |
| Bridge | `utils/bridge.util.ts:29-70,145-200` | Nonce-checked, zod-validated `v:1` messages. Frame → parent: `ready`/`rendered`/`resize`/`error`. Parent → frame: `init`/`data`/`theme`/`resize`. Additive by rule. |
| Rows | `D3Widget.component.tsx:257-265`; `utils/progressive-rows.util.ts:42-100` | Inline blocks arrive as one batch. Handle blocks are paged by **offset**, 1000 per page, through `sdk.portalSql.handleSnapshotPage`. Pins wait for live delivery. |
| Offscreen gate | `D3WidgetGate.component.tsx:48-70` | Unmounts far-offscreen widgets and shows a placeholder `Box` with no text. |
| Theme | `utils/sandbox-theme.util.ts:8-41` | `categorical` = the six MUI palette main colours. Programs encode by colour only. |

### Maps (`apps/web/src/modules/MapWidget/`)

| Piece | Location | State today |
|---|---|---|
| Init | `MapWidget.component.tsx:205-220` | maplibre-gl `^6.9.0`. `attributionControl:false` (text attribution in `MapAttribution.component.tsx`, #928), `NavigationControl({showCompass:false})`, default handlers. What the canvas exposes (tabindex, role, label) is **unverified**. |
| Container | `:484-493` | `Box` with no ARIA. |
| Render paths | `:331-365`, `:738`, `:446-451` | Tiles (`protocolTileUrl` + `TILE_SOURCE_LAYER`) for handle blocks with a ref; one GeoJSON source per layer + `fitBounds` for inline. A handle block with no ref says "too large to map inline". |
| Inspection | `:371-387` | Mouse only: hover cursor + `click` → `maplibregl.Popup` from `spec.popup.template`. No `queryRenderedFeatures` anywhere in `apps/web`. |
| Spec + colour | `packages/core/src/contracts/map-spec.contract.ts:70-100,180-192`; `utils/map-config.util.ts:165,210-330`; `MapWidget.component.tsx:594-650` | `colorBy` on the layer style, Tableau 10 palette, a legend of swatch + label or a min/max gradient. Features differ by colour alone. |

### Block contracts and agent tools

| Piece | Location | State today |
|---|---|---|
| d3 block | `packages/core/src/contracts/d3-widget.contract.ts:45-79` | `program`, optional `title`; inline/handle union. No summary. |
| geo block | `map-spec.contract.ts:196-208,242` | `spec`, optional `title`, `pipeline`, reserved `program`. No summary. |
| `visualize_d3` | `apps/api/src/tools/visualize-d3.tool.ts:21-33,155-198` | Input `sql`, `instruction`, `title?`. Falls back to a `data-table` block when codegen keeps failing. |
| `visualize_map` | `apps/api/src/tools/visualize-map.tool.ts:33-46,186-225,356,375` | Input `sql`, `spec`, `title?`. Refuses a bad spec with a typed `MAP_SPEC_INVALID`. |
| Schema refusal | `apps/api/src/services/portal.service.ts:249-277` | An input that fails the zod schema becomes a `TOOL_INPUT_INVALID` tool result, so a required field is refused as a typed result for free. |
| Mirror + prompt | `packages/core/src/registries/builtin-toolpacks.ts:238-300`; `apps/api/src/prompts/system.prompt.ts:285-360` | `parameterSchema` + required keys (held by `builtin-toolpack-schema-parity.test.ts`); "### Charting" and "### Mapping" guidance. |

### Data paging and hosts

| Piece | Location | State today |
|---|---|---|
| Handle endpoint | `apps/api/src/routes/portal-sql-handle.router.ts:88-140` | `GET /api/portal-sql/handle/:handleId?offset&limit`, default 1000, org + user checked, 404 for wrong owner or expired. **Offset only.** |
| Snapshot store | `apps/api/src/services/portal-sql-handle.service.ts:~495`; `packages/core/src/constants/large-data-ops.constants.ts:60` | `getSnapshot` reads Redis batch keys of 1,000 rows, mapping `offset` to a batch index, with a 5,000-row page max. A handle stages at most `HANDLE_ROW_CAP` = **100,000** rows; past that it's `truncated`, with `matchedCount` as the true total. |
| SDK | `apps/web/src/api/portal-sql.api.ts:27-79` | `handleSnapshot` (query), `handleSnapshotPage` (mutation), `widget-refresh` for pins. |
| Table widget | `TableWidget.component.tsx:120-127,236-238` | One fetch at `offset:0, limit:5000` (`TABLE_DISPLAY_ROW_LIMIT`), then a capped notice. |
| Core table | `packages/core/src/ui/DataTableBlock.tsx:44-150` | Search, sort and pagination on rows it holds; hidden caption and `aria-sort` (#794). |
| Registry | `packages/core/src/ui/ContentBlockRenderer.tsx:27-49,79-118` | `BlockRef` = message or pin, passed as `ctx.blockRef`. |
| Hosts | `PortalMessage.component.tsx:246-248`; `PortalSession.component.tsx:119`; `views/PinnedResultDetail.view.tsx:234-237` | Message blocks get a ref. `PortalSession` renders some blocks **without** one. Pinned detail passes `{kind:"pin"}`. |
| Dashboard pins | `PinnedResultsList.component.tsx:31-42`; `views/Dashboard.view.tsx:73-76` | An icon and a link, **no widget**. Not a chart/map host. |

### A11y infra

- `StatusMessage` (`packages/core/src/ui/StatusMessage.tsx:41`); `expectNoAxeViolations` (`apps/web/src/__tests__/test-utils.tsx:115`, `packages/core/src/__tests__/axe.util.ts:17`).
- `packages/e2e/src/lib/a11y-routes.ts:219-244`: `portal` and `portal-result-detail` already list owner 796.
- `packages/e2e/src/lib/a11y-walk.ts:55-78`: a plain `AxeBuilder` run with no iframe handling. The check needn't reach inside the chart frame (decided 2026-11-12): "zero findings" is held on the frame's name and the page around it, and the walk stays as it is.
- `docs/A11Y_AUDIT.md:147-151,218,261`: no machine findings for #796; KB-09; the screen-reader script's "announced only as frame" check.

## The design space

### Decision 1 — Where the summary lives and how it reaches the page

- **A. A block field.** Add `summary` to `D3BaseContentSchema` and `GeoBaseContentSchema` (optional on the model so stored blocks still parse). Make it **required** in both tools' `InputSchema` and the mirror's `required`. The tool copies it onto the block.
- **B. The sandbox reports it.** The program sets a description, and a new `a11y` bridge message carries it out. That only works for charts, and it trusts generated code to describe itself.
- **C. A field on the portal result row.** It would be persisted per pin, so inline message blocks wouldn't have it.

**Lean: A.** One field serves charts and maps, inline and pinned. "Required on input, optional on stored blocks" is the PRD's "agent writes, app backs up" exactly. `TOOL_INPUT_INVALID` gives the typed refusal with no new code.

Fallback summary: `deriveVisualSummary(block, rowInfo)` in `@portalai/core` (pure, so web and tests share it). It reads "Chart: <title>. <N> rows; fields a, b, c." or "Map: <title>. <N> features in <k> layers (points/polygons); coloured by <field>." The count is `matchedCount` when exact, else "N+".

### Decision 2 — Naming and describing the widget

- The wrapper `Paper` becomes `role="figure"` named by the title (`aria-labelledby` → the freshness bar's title, else "Chart"/"Map") and described by the summary (`aria-describedby`). The summary is **visible** text under the header, not hidden: sighted users benefit too, and visible text can't drift from what's read aloud.
- The iframe `title` becomes `"<title> (chart)"`, and the srcdoc gets `lang` from the document. The frame is otherwise left alone, because the figure, summary and table are the text alternative.
- The offscreen placeholder in `D3WidgetGate` (and the map's) renders the same title and summary, so a torn-down widget still reads.

**Lean: all three.** `figure` + name + description is the standard pattern for a complex image (WCAG 1.1.1 technique G92/ARIA).

### Decision 3 — The data-table alternative

The PRD asks for full-result paging, and the handle endpoint pages by **offset**.

- **A. Offset over the handle snapshot.** A "Data" disclosure under each widget renders `DataTableBlock` in a new server-paged mode fed by `handleSnapshotPage`. The snapshot is capped at 100,000 rows and lives in Redis batches, so an offset is batch arithmetic: a deep page costs what the first does. CLAUDE.md's `OFFSET` warning is about Postgres and doesn't apply.
- **B. Add keyset paging to the handle endpoint.** Nothing to gain over a Redis batch read, and it changes a route contract.
- **C. Loaded rows only.** The PRD rejected it.

**Lean: A.** Inline blocks page the rows they already hold, client-side, through the same component. Sorting and search on a handle stay client-side within a page unless the endpoint already supports them. The table says "Showing rows x–y of N" and carries the `truncated` "N+" note.

- **Pins** have no rows until live delivery. The table pages the handle that the pin's refresh produced.
- **Inline session blocks with no `blockRef`** (`PortalSession.component.tsx:119`): the table needs the handle id, not a ref. That the envelope carries it is unverified (Open question 7).

### Decision 4 — Keyboard map operation and inspection

- **Pan/zoom.** Keep MapLibre's keyboard handler (arrows pan, `+`/`-` zoom, while the canvas has focus). Give the canvas container `role="application"` only if that handler needs it to receive keys; otherwise use `role="region"` named "Map: <title>". Add visible key hints to the help line. Verify maplibre 6's canvas attributes in a browser before choosing.
- **"Features in view".** A list beside the map (below it on narrow screens), refreshed on `moveend`/`idle` from `queryRenderedFeatures`, deduped by feature id and capped at 200 with "and N more — zoom in". Each item is a button named by the popup template's text (or the first fields when there's no template). Activating it opens the same popup, anchored on the feature, and highlights the feature through `setFeatureState`. Escape returns focus to the list.
- **Announcing.** A visually hidden `StatusMessage` reports "42 features in view" after a move, debounced.

**Lean: as above.** It works identically for tiled and inline maps, because both answer `queryRenderedFeatures`.

### Decision 5 — Colour that isn't the only carrier

- **Maps.** The legend already pairs a swatch with a text label. The gap is on the canvas. Polygon layers keyed by `colorBy` get an optional fill pattern per category (`fill-pattern`, from a small generated sprite), and points vary by shape (circle/square/triangle symbols). The table and features list give the value as text, which meets 1.4.1 on its own.
- **Charts.** Out of scope (decided 2026-11-12): agent-generated chart colours aren't changed. The summary and data table carry the meaning as text.

**Lean: shape and pattern on maps; nothing on chart colours.**

## Tradeoff comparison

| | Summary block field | Figure + visible summary | Offset-paged table | Features-in-view list | Map patterns/shape |
|---|---|---|---|---|---|
| Contract change | Tool input + block schema | No | No (reuses endpoint) | No | Sandbox theme only |
| Packages | core, api, web | web | core, web | web | core?, web, api (prompt) |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add `summary` (≤ 2000 chars, `descriptionField`) to the d3 and geo block schemas, optional on the stored model and **required** in the `visualize_d3`/`visualize_map` input schemas and their `builtin-toolpacks.ts` mirrors. The tools copy it onto the block, and `system.prompt.ts` says what a good summary states.
2. Add `deriveVisualSummary` to `@portalai/core` as the fallback for blocks without one.
3. Render both widgets as `role="figure"`, named by the title and described by a visible summary. Name the D3 iframe from the title, give the srcdoc `lang`, and make the offscreen placeholders carry the same name and summary.
4. Add a "Data" disclosure to both widgets, using `DataTableBlock` in a server-paged mode over `handleSnapshotPage` for handle blocks and client paging for inline ones.
5. Give maps keyboard pan/zoom with visible hints, a "Features in view" list from `queryRenderedFeatures` (capped, deduped, popup + highlight on activate), and a debounced count announcement.
6. Encode map categories by pattern/shape as well as colour.
7. Add axe tests on the open widgets (UI components), and keep `portal`/`portal-result-detail` in the browser walk. Close KB-09 in `docs/A11Y_AUDIT.md` when `a11y:report` re-runs clean.

## Open questions

1. A result past 100,000 rows: the table reaches the snapshot's first 100,000, with "Showing 100,000 of N" from `matchedCount`. A chart drew from the same snapshot, but a tiled map draws from the server's tiles over the whole query, so a map can show features the table can't reach. **Decided (2026-11-12): accept the cap** for both and say so in the table; reaching past it is the cursor tier's job (#129), not this ticket's.
2. Should the d3 tool's `data-table` fallback (`visualize-d3.tool.ts:186-198`) also get a summary? Lean: no. A table is its own text alternative.
3. Does maplibre 6 already make the canvas focusable with a label? Lean: verify in the browser during the first slice; the decision above covers both answers.
4. Should "Features in view" also exist on inline maps with a handful of features? Lean: yes, the same component for every map. Below the cap it simply lists everything.
5. Does the "Data" table count as a toast/status surface? Lean: no. It is a disclosure (`aria-expanded` button + region); paging status goes through `PaginationToolbar`'s existing announcement.
6. Does every handle block's envelope carry its handle id, so the table can page without a `blockRef`? Lean: yes (the D3 widget already pages handle blocks); confirm in spec.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because rendering is read-only. The only write is the tool storing a summary on a block it already writes.
- **Accuracy & auditability:** The summary is agent-written, so it can be wrong. Lean: show it as the agent's description next to the data table, which is the record of truth, and never derive numbers into it beyond counts we computed.
- **Failure modes:** Lean: fail open to the derived summary. A missing or failed summary never hides the widget, and the table renders even when the chart errors or the sandbox watchdog fires.
- **Scale & unbounded growth:** The table pages (never one fetch of everything). The features list is capped at 200 and deduped, and its updates are debounced on `moveend`. Lean: as stated; tiled maps never enumerate the whole layer.
- **Multi-tenancy:** The table reuses the handle endpoint's org + user check (wrong owner = 404). Lean: no new data path, so no new boundary.
- **Contract stability:** `summary` is optional on the stored model and required only at tool input, so old blocks parse and a future block type adopts the same field. Lean: as stated.
- **Data lifecycle:** N/A because a summary lives and dies with its block or pin.

## What this doesn't decide

- New visualization types (PRD out of scope).
- Making agent-generated SVG itself accessible (roles inside the sandbox). The frame is opaque to us; the alternative carries the meaning.
- Keyset paging on the handle endpoint: the Redis batch read doesn't need it.
- Agent-generated chart colours (decided 2026-11-12).
- Reaching rows past `HANDLE_ROW_CAP` (Open question 1).
- Rendering widgets on station dashboard pins. That host doesn't render widgets today, so there's nothing to fix there (the PRD's "everywhere" is the inline session and pinned detail).

## Next step

`/spec 796` turns the recommendation into the contract: the block schema and tool input changes, the widget roles and names, the paged table mode and the features list. `/plan 796` slices it roughly as (1) summary contract across core/api plus the derived fallback, (2) figure, name and summary in both widgets with their placeholders, (3) the paged data table, (4) map keyboard and the features list, (5) map pattern/shape encodings, (6) axe tests, the audit re-run and the KB-09 close-out.
