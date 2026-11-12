# Accessible maps and charts — Spec

Pins the contract for #796: a required agent-written `summary` on chart and map blocks, a named figure with a visible summary, a paged data-table alternative, and keyboard map inspection. Builds on [`A11Y_MAPS_CHARTS.discovery.md`](./A11Y_MAPS_CHARTS.discovery.md) · [#796](https://github.com/EnterpriseBT/portal-ai/issues/796) (child of epic #791).

## Key decisions (flag for review)

1. **The summary is a block field.** It's required at tool input (`visualize_d3`, `visualize_map`) and optional on the stored block, so blocks and pins that predate it still parse. A missing one is refused through the existing `TOOL_INPUT_INVALID` path (`apps/api/src/services/portal.service.ts:249-277`), with no new code. The length limit lives on the tool input only, per CLAUDE.md's "limits on request contracts, never on models".
2. **The fallback is derived, not stored.** `deriveVisualSummary` in core builds a summary for a block with none. It never invents numbers beyond counts we hold.
3. **The data alternative pages the handle snapshot by offset.** `GET /api/portal-sql/handle/:handleId` reads Redis batch keys, so an offset costs what the first page does. The snapshot is capped at `HANDLE_ROW_CAP` = 100,000 rows. A result past the cap shows its first 100,000 and says so (decided 2026-11-12). Server-paged tables have **no search or sort**, because the endpoint has neither. Inline tables keep both.
4. **The table follows the widget's own data.** It reads the same `effectiveHandle` / inline rows the widget draws from, including a pin's live delivery and a refresh's fresh delivery. A handle that has expired (24h TTL, `READ_HANDLE_EXPIRED`) shows a message that points to Refresh.
5. **Maps keep MapLibre's own canvas semantics.** On maplibre-gl 6.9.0 the canvas is `tabindex=0`, `role="region"`, named by the `Map.Title` locale string, with keyboard pan/zoom on by default. We set the name through `locale` and describe the keys. No `role="application"`.
6. **"Features in view" is on every map**, inline and tiled, capped at 200 and deduped. It is built from `queryRenderedFeatures` after `idle`.
7. **No pattern or shape encodings** (decided 2026-11-12). A guessed pattern or shape set would be wrong too often to help. What a colour encodes reaches the user as text instead: each "Features in view" item names its `colorBy` value, the legend labels every category (and a gradient's min/max), and the data table holds the column. Chart colours are untouched.
8. **Axe scope.** The check doesn't enter the chart iframe (decided 2026-11-12). Zero findings is held on the frame's name and everything around it, and `a11y-walk.ts` is unchanged.
9. **Discovery's leaned questions are taken as decided:** the d3 tool's `data-table` fallback gets no summary (a table is its own alternative), and "Data" is a disclosure, not a status surface.

## Scope

### In scope

- `summary` on d3/geo block content, both tools' input, the mirror and the system prompt.
- `deriveVisualSummary` (core).
- `VisualFigure` (web) wrapping both widgets: `role="figure"`, name, visible summary, and the "Data" disclosure.
- `DataTableBlock` controlled-paging mode (core) and `VisualDataTable` (web).
- The D3 iframe's name, the srcdoc `lang`, and placeholders that carry the name and summary.
- Map keyboard description, `MapFeatureList`, feature highlight, and count announcements.
- Tests, and closing KB-09 in `docs/A11Y_AUDIT.md`.

### Out of scope

- New visualization types, rows past `HANDLE_ROW_CAP`, keyset paging on the handle endpoint, chart colours, map pattern/shape encodings, and accessibility inside agent SVG.
- Station dashboard pins: they render no widget (`PinnedResultsList.component.tsx:31-42`).

## Surface

### Core — block contracts (`packages/core/src/contracts/`)

`d3-widget.contract.ts` → `D3BaseContentSchema`, and `map-spec.contract.ts` → `GeoBaseContentSchema`, each gain:

```ts
/** Agent-written text alternative (#796): what the chart/map shows and its
 *  takeaway. Optional so pre-#796 blocks and pins parse; the widget derives
 *  one when absent (`deriveVisualSummary`). No length limit on the model. */
summary: z.string().optional(),
```

`PinnedD3ContentSchema` / `PinnedGeoContentSchema` (`pinned-result.contract.ts`) extend those bases, so a pinned block keeps its `summary` under `.strict()` with no change of their own.

### Core — `deriveVisualSummary` (`packages/core/src/utils/visual-summary.util.ts`, new)

```ts
export interface VisualSummaryInput {
  kind: "chart" | "map";
  title?: string;
  /** Column names, in order (first row's keys, or the handle `schema`). */
  fields: string[];
  /** Displayed total: `matchedCount ?? rowCount ?? rows.length`. */
  count: number;
  countExact: boolean;
  /** Maps only. */
  layers?: Array<{ kind: MapLayerKind; colorBy?: string }>;
}
export function deriveVisualSummary(input: VisualSummaryInput): string;
export function visualSummary(summary: string | undefined, input: VisualSummaryInput): string; // summary?.trim() || derive
```

The output is exact, and the tests assert these strings:

- Chart: `"Chart: <title>. 1,234 rows; fields month, revenue."`. Without a title: `"Chart. …"`. An inexact count reads `"100,000+ rows"`. Past 6 fields: `"fields a, b, c, d, e, f and 3 more."`.
- Map: `"Map: <title>. 1,234 features in 2 layers (polygons, points); coloured by zoning."`. One layer drops the parentheses' plural.
- Empty: `"Chart: <title>. No rows."` / `"Map: <title>. No features."`.

Exported from `@portalai/core` (utils barrel).

### Core — `DataTableBlock` controlled paging (`packages/core/src/ui/DataTableBlock.tsx`)

`DataTableBlockProps` gains an optional `paging` prop. When it is absent, behaviour is unchanged.

```ts
paging?: {
  /** Total rows across all pages (the snapshot's `total`). */
  total: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  loading?: boolean;
};
```

With `paging`, `rows` is the current page, and search and column sorting are not rendered (no sort buttons and no `aria-sort`). Pagination reads `total`, and `loading` sets `aria-busy` on the table.

### Web — `VisualFigure` (`apps/web/src/components/VisualFigure.component.tsx`, new, pure UI)

```ts
export interface VisualFigureUIProps {
  kind: "chart" | "map";
  title?: string;
  summary: string;              // already resolved via visualSummary()
  header: React.ReactNode;      // the WidgetFreshnessBar
  children: React.ReactNode;    // the chart/map body
  data?: React.ReactNode;       // the VisualDataTable; omitted → no Data button
  testId: string;               // keeps "d3-widget" / "map-widget"
}
```

It renders the existing outlined `Paper` with `role="figure"`, `aria-labelledby` pointing to a title element, and `aria-describedby` pointing to the summary element.

- **Title element:** when `title` is unset it is visually hidden and reads "Chart" or "Map".
- **Summary:** a visible `Typography variant="body2"` under the header.
- **Data button:** a `Button` toggles the data region, with the label "Show data" / "Hide data", `aria-expanded`, and `aria-controls`. The region is `role="region"`, named "Data for <title or Chart/Map>", and mounted only while open.

### Web — `VisualDataTable` (`apps/web/src/components/VisualDataTable.component.tsx`, new: UI + container)

```ts
export type VisualDataSource =
  | { kind: "inline"; rows: Record<string, unknown>[] }
  | { kind: "handle"; handleId: string; matchedCount?: number; matchedCountExact?: boolean; truncated?: boolean };

export interface VisualDataTableProps { label: string; source: VisualDataSource; onRefresh?: () => void }
export interface VisualDataTableUIProps {
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  paging?: DataTableBlockProps["paging"];
  /** "Showing the first 100,000 of 1,234,567 rows." when truncated. */
  capNote?: string;
  error?: ServerError | null;
  expired?: boolean;
  onRefresh?: () => void;
}
```

The container takes one of two paths:

- **Inline:** `DataTableBlock` with no `paging`.
- **Handle:** it holds page state and reads `sdk.portalSql.handleSnapshot(handleId, { offset: page*rowsPerPage, limit: rowsPerPage })`. Columns come from the first page's keys.

Its states:

- **Expired:** an error with `code === "READ_HANDLE_EXPIRED"` renders "This data has expired. Refresh to load it again.", with a Refresh button when `onRefresh` is set.
- **Other errors:** `serverErrorMessage(...)` in a `StatusMessage`.
- **Cap note:** shown when `truncated`, with the number from `matchedCount`. When `matchedCountExact` is false it reads "Showing the first 100,000 of more than 100,000 rows."

### Web — D3 widget (`apps/web/src/modules/D3Widget/`)

- **`D3WidgetUIProps` gains** `summary: string` and `dataSource?: VisualDataSource`. `D3WidgetUI` renders through `VisualFigureUI` (`testId="d3-widget"`), with the existing header, note and body as the figure's parts. `data` is `<VisualDataTable source={dataSource} label={...} onRefresh={onRefresh} />` whenever `dataSource` is set, error states included, so a failed chart still offers its data.
- **The container** computes:
  - `summary = visualSummary(parsedContent.summary, {...})`, with fields from the inline rows or the handle `schema`;
  - `dataSource` from the same `effectiveHandle` / `inlineRows` it already derives (`D3Widget.component.tsx:240-261`). A pin with no delivery yet gets no `dataSource`.
- **`D3SandboxFrameUIProps` gains** `title: string`. The iframe's `title` becomes `` `${title || "Chart"} (chart)` `` (`D3SandboxFrame.component.tsx:192`).
- **`sandbox-srcdoc.util.ts`:** `<html lang="en">`.
- **`D3WidgetPlaceholderUIProps` gains** `title?: string` and `summary?: string`. When given, the placeholder renders them as a visually hidden figure (`role="figure"`, same name and description). `D3WidgetGate` passes them from the parsed content, using `visualSummary` on what the content holds.

### Web — Map widget (`apps/web/src/modules/MapWidget/`)

- **`MapWidgetUIProps` gains** `summary: string` and `dataSource?: VisualDataSource`, rendered through `VisualFigureUI` (`testId="map-widget"`), as for D3. A tiled map's `dataSource` is its handle (`queryHandle` on the content or the fresh delivery). An inline map's is its rows with geometry columns left out of the table: `spec.layers[*].source.geometryColumn` is dropped, and lat/lng columns stay.
- **Map construction** (`MapWidget.component.tsx:205`):
  - `new maplibregl.Map({ …, locale: { "Map.Title": `Map: ${title ?? "untitled"}` } })`.
  - After construction, `getCanvas().setAttribute("aria-describedby", keysHintId)`.
  - `keysHintId` is a visible caption under the map: "Arrow keys pan, + and − zoom, when the map has focus."
- **`utils/rendered-features.util.ts` (new):**

```ts
export interface RenderedFeature { key: string; layerId: string; label: string; properties: Record<string, unknown>; lngLat: [number, number] }
export function collectRenderedFeatures(
  features: maplibregl.MapGeoJSONFeature[],
  opts: { template?: string; cap: number }      // cap = 200
): { items: RenderedFeature[]; total: number };
```

  - **`key`:** `${layerId}:${feature.id ?? stableHash(properties)}`, deduped (tiles split a feature across tiles).
  - **`label`:** `renderPopupTemplate(template, props)` stripped to text, or else the first three non-geometry properties as `"k: v, …"`.
  - **`lngLat`:** the feature's centroid (point coordinates, or the bbox centre for lines and polygons).
- **`MapFeatureList.component.tsx` (new, pure UI):**

```ts
export interface MapFeatureListUIProps {
  items: RenderedFeature[];
  total: number;
  selectedKey: string | null;
  onSelect: (item: RenderedFeature) => void;
}
```

  - **Container:** a `nav`-less section headed by `Typography component="h3"` "Features in view (N)". The `h3` sits under a page's `h2` result headings; the level comes from a prop `headingLevel` that defaults to 3.
  - **Items:** a `ul` of `Button`s, each named by `label`, with `aria-pressed` for the selection.
  - **Over the cap:** a trailing text item, "and N more. Zoom in to list them."
  - **Placement:** the list sits beside the map at `md` and up, and below it on narrow screens. The breakpoint is the widget's own layout prop, per the view-owns-layout rule (`layout?: "side" | "stacked"`).
- **Container wiring:**
  - On `idle`, `collectRenderedFeatures(map.queryRenderedFeatures({ layers: mlLayerIds }), …)`.
  - `onSelect` opens the same popup at `lngLat` and sets `setFeatureState({source, sourceLayer?, id}, {selected: true})`, clearing the previous selection. Each layer's paint adds a `["boolean", ["feature-state", "selected"], false]` case: a 3px outline for polygons, a larger stroke for points, a wider line for lines.
  - Escape in the popup closes it and returns focus to the list item.
  - A visually hidden `StatusMessage` announces "N features in view" 500ms after `moveend`.
  - Features without an `id` can't take feature state, so they open the popup without a highlight. `promoteId` is not set.
- **Selection paint** (`utils/map-config.util.ts`): each layer's paint gains the `feature-state` `selected` case above. Nothing else in the colour encoding changes.
- **Colour as text:** `collectRenderedFeatures` appends the layer's `colorBy` value to an item's label when the layer has one ("Parcel 12 · zoning: R2"), so the list carries what the colour shows.

### API — tools

`apps/api/src/tools/visualize-d3.tool.ts` and `visualize-map.tool.ts`, `InputSchema` gains:

```ts
summary: descriptionField("Summary")
  .trim()
  .min(1, "Summary is required")
  .describe("One to three sentences for someone who can't see the chart/map: what it shows and the main takeaway. Name the measures and the notable values; don't describe colours."),
```

The tool emits `summary` on the block next to `title`, as a `summaryField`, in all three d3 emits and both geo emits. It is **not** emitted on the d3 `data-table` fallback.

`packages/core/src/registries/builtin-toolpacks.ts`: `visualize_d3` and `visualize_map` gain `summary: stringField(...)` with the same text, and `"summary"` joins `required`. `builtin-toolpack-schema-parity.test.ts` holds the two together, and the examples gain a `summary`.

`apps/api/src/prompts/system.prompt.ts`: "### Charting" and "### Mapping" each gain one rule. Every chart and map call carries a `summary` written for a reader who can't see it, stating the takeaway and key values, not the colours.

### Audit (`docs/A11Y_AUDIT.md`)

KB-09's row is marked closed, with this PR's number, after `npm run a11y:report` re-runs with the #796 section empty.

## Migration

None. The block content is `jsonb`, and `summary` is optional on the stored model.

## Seed

None.

## TDD test plan

Per package: `npm run test:unit` (core, web, api), run with `--testPathPattern` on the touched files locally.

### Core: `packages/core/src/__tests__/`

- `utils/visual-summary.util.test.ts` (new): chart and map strings, no title, inexact count, field truncation, empty, single vs several layers, and an agent summary that wins over the derived one. (~10)
- `contracts/d3-widget.contract.test.ts` / `map-spec.contract.test.ts`: a block with and without `summary` parses, and a pinned block with `summary` passes `.strict()`. (~4)
- `ui/DataTableBlock.test.tsx`: in `paging` mode it shows `total` in the pagination, calls `onPageChange`/`onRowsPerPageChange`, renders no search box or sort buttons, and sets `aria-busy` while loading. Without `paging` it is unchanged. Axe-clean. (~6)

### API: `apps/api/src/__tests__/tools/`

- `visualize-d3.tool.test.ts`: the input schema refuses a missing or blank `summary` and one over 2000 characters. `summary` reaches the inline and handle blocks. The `data-table` fallback carries none. (~5)
- `visualize-map.tool.test.ts`: the same for inline and handle. (~4)
- `builtin-toolpack-schema-parity.test.ts`: passes unchanged once the mirror lists `summary`. `system.prompt.test.ts` pins the two new rules. (~2)

### Web: D3 (`apps/web/src/modules/D3Widget/__tests__/`)

- `D3Widget.test.tsx` (UI):
  - it is a figure named by the title, or "Chart" without one;
  - it is described by the summary;
  - "Show data" toggles `aria-expanded` and the region;
  - an error state still offers data;
  - axe-clean open and closed. (~7)
- `D3SandboxFrame.test.tsx`: the iframe title comes from the prop. (~1)
- `D3WidgetGate.test.tsx`: the placeholder is a named, described figure. (~2)

### Web: map (`apps/web/src/modules/MapWidget/__tests__/`)

- `MapWidget.test.tsx` (UI): figure name and summary, the key hint and its `aria-describedby` target, data toggling, and axe. (~5)
- `rendered-features.util.test.ts` (new): dedupe across tile copies, the 200 cap with `total`, a template label, a fallback label, the `colorBy` value in the label, and a centroid per geometry type. (~6)
- `MapFeatureList.test.tsx` (new): heading with count, the items are buttons named by label, `aria-pressed` on the selected one, the over-cap note, `onSelect`, and axe. (~6)
- `map-config.util.test.ts`: every layer kind's paint carries the `selected` feature-state case. (~2)

### Web: components (`apps/web/src/__tests__/`)

- `VisualFigure.test.tsx` (new): roles, name and description wiring, the hidden title fallback, no Data button without `data`, and axe. (~5)
- `VisualDataTable.test.tsx` (new, UI): inline rows, paged mode, the cap note exact and inexact, the expired message with Refresh, a server error through `StatusMessage`, and axe. (~6)

### Browser walk

No new spec file: `portal` and `portal-result-detail` are already in `packages/e2e/src/lib/a11y-routes.ts:219-244`, and `npm run a11y:report` is re-run for the audit.

**Totals ≈ 78 cases.**

## Acceptance criteria

- [ ] Every chart and map, inline in a session or on pinned result detail, is a figure named by its title and described by a visible summary. Pre-#796 blocks and pins get the derived summary.
- [ ] Calling `visualize_d3` or `visualize_map` without a `summary` returns a `TOOL_INPUT_INVALID` tool result, and the agent retries with one.
- [ ] "Show data" opens a table of the full result (paged, up to 100,000 rows, with the cap stated past that). It works on a chart that failed to render, and an expired handle offers Refresh.
- [ ] With the keyboard alone, a user can focus a map, pan with the arrows, zoom with `+`/`−`, reach "Features in view", and open any listed feature's details, with the feature highlighted on the map.
- [ ] What a map layer's colour encodes is available as text: in each listed feature's label, the legend and the data table.
- [ ] `npm run a11y:report` leaves the #796 section of `docs/A11Y_AUDIT.md` empty, and KB-09 is closed.

## Risks & rollback

- **The agent writes a poor or wrong summary.** It's shown beside a table that is the record of truth, and the system prompt rule plus tool-description guidance are the levers. Fail mode: a missing summary is refused (fail-closed at input), and a missing summary on a stored block falls back (fail-open at render).
- **The required field breaks a call path that builds tool input outside the agent** (tests, fixtures, evals). The plan's first slice runs api `type-check` and the tool suites, and a grep for `visualize_d3`/`visualize_map` callers.
- **`queryRenderedFeatures` cost on dense tiles.** It runs once per `idle` and is capped, with dedupe. If profiling shows jank, debounce `idle` further.
- **Rollback overall:** web and core changes revert cleanly. The tool `required` change reverts with the mirror in one commit. No data migrates.

## Files touched

- **Core:**
  - `src/contracts/d3-widget.contract.ts`, `src/contracts/map-spec.contract.ts`
  - `src/utils/visual-summary.util.ts` (new) + barrel
  - `src/ui/DataTableBlock.tsx`
  - `src/registries/builtin-toolpacks.ts`
  - tests above
- **API:**
  - `src/tools/visualize-d3.tool.ts`, `src/tools/visualize-map.tool.ts`
  - `src/prompts/system.prompt.ts`
  - tests above
- **Web, components:** `src/components/VisualFigure.component.tsx` (new), `src/components/VisualDataTable.component.tsx` (new)
- **Web, D3:** `src/modules/D3Widget/{D3Widget,D3SandboxFrame,D3WidgetGate}.component.tsx`, `src/modules/D3Widget/utils/sandbox-srcdoc.util.ts`
- **Web, map:**
  - `src/modules/MapWidget/{MapWidget,MapWidgetGate}.component.tsx`
  - `src/modules/MapWidget/MapFeatureList.component.tsx` (new)
  - `src/modules/MapWidget/utils/{map-config,rendered-features}.util.ts`
- **Web, stories:** the D3 and map widget stories gain summary and data variants. New stories for `VisualFigure`, `VisualDataTable` and `MapFeatureList`.
- **Docs:** `docs/A11Y_AUDIT.md` (KB-09).

## Next step

`/plan 796` writes `docs/A11Y_MAPS_CHARTS.plan.md` on this branch, in about five TDD slices:
1. The summary contract, tools, mirror and prompt.
2. `deriveVisualSummary`, `VisualFigure`, and wiring both widgets, the iframe name and the placeholders.
3. `DataTableBlock` paging and `VisualDataTable` behind "Show data".
4. Map keyboard description, `rendered-features`, `MapFeatureList`, and highlight and announcements.
5. The audit re-run and the KB-09 close-out.
