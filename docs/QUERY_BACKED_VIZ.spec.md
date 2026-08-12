# Every visualization is query-backed — Spec

**Issue:** [EnterpriseBT/portal-ai#349](https://github.com/EnterpriseBT/portal-ai/issues/349) · **Discovery:** `docs/QUERY_BACKED_VIZ.discovery.md`

Pins the contract that makes every SQL-backed result carry its re-executable pipeline — inline or handle, table or chart or map — so `useWidgetRefresh` works uniformly and no block is a terminal snapshot. The refresh *mechanism* (mount-time freshness gate + manual button + per-org rate cap) is unchanged; this spec only widens what reaches it.

## Key decisions (flag for review)

1. **The pipeline is attached in `resolveResultSink`, so it rides the agent-facing tool result — accepted as duplication, not disclosure.** `resolveResultSink` returns the value the agent sees *and* the value `resolveDisplayBlock` projects into a block; the AI SDK feeds the tool's raw return to the model, so there is no later boundary to strip at (`handleToolResult`, `portal.service.ts:140-175`, runs after the model has seen the output).

   The incremental exposure is narrower than it first appears. The **handle** branch already returns the whole envelope (`result-sink.ts:172`), and `QueryHandleEnvelopeFieldsSchema` carries `sql` (`portal-sql.contract.ts:63`) — so large `sql_query` results already put the SELECT in the agent's context, and `visualize_d3`/`visualize_map` have shipped `pipeline` since #270. The only new case is the **inline** branch, where `pipeline.sql` is byte-identical to the `sql` argument the agent itself supplied and which is already in its context as the tool-call part. Cost ≈ 80 tokens per inline result.

   **Not a security surface.** The agent authors tool *arguments*, never tool *results* — the pipeline is built server-side from the executed `sink.sql` plus `ctx` ids from the authenticated request, so a model cannot inject or alter one. Refresh is reference-based (`{messageId, blockIndex}`; the client never supplies SQL — `portal-viz-refresh.service.ts:5-10`), and `executePipeline` scopes the re-run with `organizationId` **from the verified request, not the stored pipeline** (`:236-239`). *Caveat:* `pipeline.stationId` is read from the stored value, pinning a pipeline to its station — a pre-existing #270 property shared by every d3/geo block, bounded within the org, neither widened nor fixed here.

   A `toolCallId`-keyed side-channel would keep the pipeline out of the model's view, but it buys no security and adds hidden request-scoped state between tool execution and block projection. **Rejected as ad hoc and fragile.**
2. **`D3PipelineSchema` is renamed `VizPipelineSchema`** — no alias, per the standing no-compat-alias rule. The schema already governs pinned *tables* (`pinned-result.contract.ts:31`) and will now govern table blocks; the `D3` prefix is actively misleading. A spec-level naming call rather than a discovery decision — **confirmed 2026-08-12**.
3. **`WidgetRefreshResponse` needs no new variant** — correcting discovery recommendation 5. The existing `{kind:"inline", rows}` / `{kind:"handle", …envelope}` union (`portal-sql.contract.ts:85-91`) already describes a refreshed table exactly; columns are derived from `rows[0]` client-side, as `QueryResultDataBlockUI:111-112` already does.
4. **Open question 6 resolves to "already covered"** — `portal-result-pin.service.ts:51-70` prefers the source block's own `pipeline`, so once decisions 1–2 land, inline-backed pinned tables become refreshable with no pin-side change. `PinnedDataTableContentSchema.pipeline` is already optional.
5. **A legacy table block moves from 404 to 422.** Widening the refresh service's type gate means pre-change blocks answer `VIZ_WIDGET_NOT_REFRESHABLE` instead of `VIZ_WIDGET_NOT_FOUND`. Per discovery Q2 the UI renders the freshness cue **without** a refresh button in that state — not a degraded chip; nothing failed.

## Scope

### In scope

1. `resolveResultSink`'s `{sql}` arm attaches `pipeline` on both delivery branches.
2. `resolveDisplayBlock` stops whitelisting `pipeline` out of data-table blocks (handle + inline arms).
3. `visualize_d3`'s codegen-failure fallback carries the pipeline it already has in scope.
4. A `data-table` block content contract in `packages/core`, inline/handle union, `pipeline` optional.
5. `VizPipelineSchema` rename.
6. `PortalVizRefreshService.refresh` admits `data-table` blocks.
7. `apps/web/src/modules/TableWidget/` — container + pure UI + gate + registration, replacing both existing table render paths.
8. `WidgetFreshnessBar` in `packages/core/src/ui/`, adopted by map, d3, table, and the pin detail view, carrying the new **degraded** state.

### Out of scope

- Any continuous/interval/visibility-driven refresh cadence, and any pause control (amended PRD).
- Changes to `useWidgetRefresh`'s trigger logic, `VIZ_REFRESH_FRESHNESS_MS`, or `VIZ_REFRESH_RATE_PER_MIN`.
- The map tile path (`portal-map-tile.service.ts`) and `INLINE_ROWS_THRESHOLD` retuning.
- Consolidating the two duplicated rate-limit call sites.

## Surface

### 1. `VizPipelineSchema` rename — `packages/core/src/contracts/d3-widget.contract.ts:27`

`D3PipelineSchema` → `VizPipelineSchema`, `D3Pipeline` → `VizPipeline`. Fields, refinements, and JSDoc semantics unchanged. Update the four consumers: `d3-widget.contract.ts:46`, `pinned-result.contract.ts:4,31`, `portal-viz-refresh.service.ts:14,107,169,228`, plus `contracts/index.ts` re-exports. **No alias export.**

### 2. Data-table block contract — `packages/core/src/contracts/data-table-widget.contract.ts` (new)

```ts
import { z } from "zod";
import { QueryHandleEnvelopeFieldsSchema } from "./portal-sql.contract.js";
import { VizPipelineSchema } from "./d3-widget.contract.js";

const DataTableBaseContentSchema = z.object({
  type: z.literal("data-table").optional(),
  /** Set by visualize_d3's codegen-failure fallback (visualize-d3.tool.ts:164). */
  message: z.string().optional(),
  /** Durable re-executable pipeline. Optional — pre-#349 blocks and
   *  externally-supplied rows (produceFromRows) have none. */
  pipeline: VizPipelineSchema.optional(),
});

export const DataTableInlineContentSchema = DataTableBaseContentSchema.extend({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type DataTableInlineContent = z.infer<typeof DataTableInlineContentSchema>;

export const DataTableHandleContentSchema = DataTableBaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);
export type DataTableHandleContent = z.infer<typeof DataTableHandleContentSchema>;

/** Handle branch first — mirrors D3BlockContentSchema:74 for the same reason. */
export const DataTableBlockContentSchema = z.union([
  DataTableHandleContentSchema,
  DataTableInlineContentSchema,
]);
export type DataTableBlockContent = z.infer<typeof DataTableBlockContentSchema>;
```

Re-export from `contracts/index.ts`. This replaces the web-local `QueryResultDataBlockContent` interface (`QueryResultDataBlock.component.tsx:20-34`), which is deleted with that file.

### 3. Sink attaches the pipeline — `apps/api/src/tools/result-sink.ts:165-173`

```ts
if ("sql" in sink) {
  const delivery = await resolveSqlDelivery(
    { sql: sink.sql, inlineThreshold: inlineThresholdOf(production) },
    ctx
  );
  // #349: every SQL-backed result carries its re-executable pipeline, so a
  // small result is a fast first paint — never a terminal snapshot.
  const pipeline = {
    sql: sink.sql,
    stationId: ctx.stationId,
    organizationId: ctx.organizationId,
  };
  return delivery.kind === "inline"
    ? { ...(delivery.result as object), pipeline }
    : { type: "data-table", ...delivery.envelope, pipeline };
}
```

`delivery.result` has three shapes (`sqlRowCount:45-51`): `{rows}`, `{rows, truncated, totalCount}`, `{sample, totalCount}`. Spreading preserves all three. **Only the `{sql}` arm changes** — `{value}`, `{transform}`, and `{rows}` sinks have no originating SELECT to re-run and stay terminal by nature.

### 4. Projection stops dropping it — `apps/api/src/services/portal.service.ts:238-274`

Handle arm (`:245-252`) adds `pipeline: toolResult.pipeline`; inline arm (`:269`) becomes `{ type: "data-table", columns, rows, pipeline: toolResult?.pipeline }`. Both omit the key when undefined (a legacy/`produceFromRows` result), which the optional contract field accepts. The `rows.length === 0 → return null` guard at `:267` is unchanged — an empty result still mints no block.

### 5. D3 fallback keeps its pipeline — `apps/api/src/tools/visualize-d3.tool.ts:138-168`

Hoist `const pipeline = { sql, stationId, organizationId }` from inside the validation branch (`:140`) to above the codegen retry loop, then add `pipeline` to both fallback returns (`:166`, `:168`). The success returns are unchanged in behavior.

### 6. Refresh service admits data-table — `apps/api/src/services/portal-viz-refresh.service.ts:95-100`

```ts
const REFRESHABLE_BLOCK_TYPES = new Set(["d3", "geo", "data-table"]);
...
if (!block || !REFRESHABLE_BLOCK_TYPES.has(block.type as string)) throw notFound();
```

Everything downstream already works: `inner.pipeline` is read the same way (`:106-107`), `geometryColumnsFromSpec(inner.spec)` returns `[]` for a table (no `spec`), and `executePipeline` (`:227-261`) re-runs the full SELECT and maps to the existing response union. **No change to `WidgetRefreshResponse`, no new `ApiCode`** — `VIZ_WIDGET_NOT_FOUND` (`:596`), `VIZ_WIDGET_NOT_REFRESHABLE` (`:599`), and `VIZ_REFRESH_RATE_LIMITED` (`:601`) all exist and carry the right meanings.

`refreshPinnedResult` needs no change — it already reads `content.pipeline` off any pin row (`:169`).

### 7. `WidgetFreshnessBar` — `packages/core/src/ui/WidgetFreshnessBar.tsx` (new)

Single pure-UI component per the Component File Policy; no hooks, no context.

```ts
export interface WidgetFreshnessBarProps {
  title?: string;
  /** Epoch ms of the last hydration. Null ⇒ no cue rendered. */
  lastUpdatedAt?: number | null;
  isRefreshing?: boolean;
  /** Refresh affordance is available (blockRef present, pipeline present). */
  canRefresh?: boolean;
  /** Block predates durable pipelines — cue renders, button does NOT (Q2). */
  notRefreshable?: boolean;
  /** Last refresh failed or was rate-limited — renders the degraded chip. */
  degraded?: boolean;
  status?: "loading" | "ready" | "error" | "refreshing";
  /** aria-label + tooltip, e.g. "Refresh table" / "Refresh chart" / "Refresh map". */
  refreshLabel: string;
  onRefresh?: () => void;
}
```

Rendering rules, in precedence order:

| State | Renders |
|---|---|
| `degraded` | `Couldn't update — showing data from {DateFactory.relativeTime(lastUpdatedAt)}`, `data-testid="widget-freshness-degraded"`, MUI `Chip` `color="warning"` `variant="outlined"` |
| `notRefreshable` | `Updated {relativeTime}` only — **no** refresh button, no chip |
| otherwise | `Updated {relativeTime}` + `IconButton` (`RefreshIcon`, or `CircularProgress size={14}` while `isRefreshing`) when `canRefresh && onRefresh` |

`status` chip and `title` keep the existing layout (`display:flex, alignItems:center, gap:1, mb:0.5`, title takes `flex:1`), lifted from `D3Widget.component.tsx:128-179`. Stable test ids: `widget-freshness-updated`, `widget-freshness-refresh`, `widget-freshness-degraded`, `widget-freshness-status`.

Adopted by `MapWidget.component.tsx:277-320`, `D3Widget.component.tsx:128-179`, the new `TableWidgetUI`, and `PinnedResultDetail.view.tsx:217-236` — each passing its own `refreshLabel`. The per-widget `data-testid`s (`d3-widget-updated`, `map-widget-updated`) are replaced by the shared ones; existing tests asserting them are updated, not kept as aliases.

### 8. `TableWidget` module — `apps/web/src/modules/TableWidget/` (new)

Mirrors `modules/D3Widget/` exactly.

```
index.ts                        # TableWidget, TableWidgetUI, TableWidgetUIProps, registerTableBlockRenderer
TableWidget.component.tsx       # TableWidget (container) + TableWidgetUI (pure)
TableWidgetGate.component.tsx   # TableWidgetGate + TableWidgetPlaceholderUI
utils/register.util.tsx         # registerTableBlockRenderer()
__tests__/{TableWidget,TableWidgetGate,register.util}.test.tsx
stories/TableWidget.stories.tsx
```

**`TableWidgetUI`** (pure) — props:

```ts
export interface TableWidgetUIProps {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Handle-backed: the true matched total for the row-cap notice (#340). */
  rowCount?: number;
  truncated?: boolean;
  matchedCount?: number;
  matchedCountExact?: boolean;
  title?: string;
  message?: string;              // d3 codegen-fallback note
  loading?: boolean;
  error?: string | null;
  lastUpdatedAt?: number | null;
  canRefresh?: boolean;
  isRefreshing?: boolean;
  notRefreshable?: boolean;
  degraded?: boolean;
  onRefresh?: () => void;
}
```

Composes `<WidgetFreshnessBar refreshLabel="Refresh table" …/>`, the row-cap `Alert` lifted verbatim from `QueryResultDataBlockUI:119-142` (all three load-bearing clauses and `data-testid="query-result-row-cap-notice"` preserved — #277 asserts them), and **`<DataTableBlock columns rows />` directly**.

> **It must call `DataTableBlock` directly, never `ContentBlockRenderer`.** `QueryResultDataBlockUI:113-143` re-enters the registry with a synthetic `data-table` block; once `data-table` resolves to `TableWidget`, that path is infinite recursion. This is the single sharpest implementation hazard in the ticket.

**`TableWidget`** (container) — props `{ content: DataTableBlockContent | unknown; blockRef?: BlockRef; dataUpdatedAt?: number }`. Wiring:

- `useWidgetRefresh(blockRef, dataUpdatedAt)` → `fresh`, `isRefreshing`, `error`, `notRefreshable`, `lastUpdatedAt`, `refresh`.
- Rows resolve in precedence: `fresh` (inline → `fresh.rows`; handle → snapshot of `fresh.queryHandle`) → `content.rows` (inline) → snapshot of `content.queryHandle` (handle), via `sdk.portalSql.handleSnapshot(handle, { offset: 0, limit: 5_000 })` exactly as `QueryResultDataBlock:160-163`.
- `columns` = `content.columns` when present, else `Object.keys(rows[0] ?? {})`.
- `canRefresh = blockRef != null && !notRefreshable`; `degraded = error != null`.
- The `READ_HANDLE_EXPIRED` message (`QueryResultDataBlock:169-171`) is preserved.

**`TableWidgetGate`** mirrors `D3WidgetGate.component.tsx` — `useInView` + `useScrollRoot`, `TableWidgetPlaceholderUI` height-preserving stand-in. Seed height `240` (tables are shorter than the 360 iframe seed).

**`registerTableBlockRenderer()`** mirrors `D3Widget/utils/register.util.tsx:11-19`, registering `"data-table"` and overriding core's default `renderDataTable` (`ContentBlockRenderer.tsx:58-66`). Called from web bootstrap (`main.tsx`) alongside the d3/geo registrations. Core's built-in `renderDataTable` stays as the registry default for core-only consumers (core Storybook).

### 9. Plumbing deletions — `apps/web/src/components/PortalMessage.component.tsx`

- `shouldRenderViaWeb` (`:108-115`): delete the `data-table` arm; `WEB_BLOCK_TYPES` (bulk-job-progress, bulk-failures-table) is all that remains.
- `renderWebBlock` (`:52-59`): delete the `data-table` arm and the `QueryResultDataBlock` import.
- **Delete `apps/web/src/components/QueryResultDataBlock.component.tsx`** entirely.

With both arms gone, every data-table block falls through to `ContentBlockRenderer` at `:232-240` and receives `blockRef` + `dataUpdatedAt` — which is the whole fix for handle-backed tables.

## Migration

**None.** No DB schema change, no new table, no column. Existing persisted blocks keep parsing (`pipeline` is optional everywhere) and simply remain non-refreshable — the `notRefreshable` path.

## Seed

**None.**

## TDD test plan

Run via npm scripts only: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core` contracts

1. `DataTableInlineContentSchema` parses `{columns, rows, pipeline}`; also parses with `pipeline` absent.
2. `DataTableHandleContentSchema` parses a full envelope + `pipeline`.
3. `DataTableBlockContentSchema` resolves content carrying `queryHandle` to the **handle** branch even when `rows` is also present (the union-order guarantee, mirroring `D3BlockContentSchema`).
4. `VizPipelineSchema` rejects empty `sql`/`stationId`/`organizationId`; accepts an opaque `transform`.
5. `PinnedDataTableContentSchema` still parses against the renamed schema.

### Layer 2 — `@portalai/core` UI

6. `WidgetFreshnessBar` renders `Updated …` when `lastUpdatedAt` is set; renders nothing when null.
7. `canRefresh` renders the refresh button with the given `refreshLabel` as `aria-label`; `onRefresh` fires on click.
8. `isRefreshing` swaps the icon for a spinner and disables the button.
9. **`notRefreshable` renders the cue and NO refresh button** (discovery Q2).
10. **`degraded` renders the degraded chip with "Couldn't update — showing data from …"** and takes precedence over the plain cue.
11. `status` chip renders when not `"ready"`.

### Layer 3 — api tools

12. `resolveResultSink({sql})` inline attaches `pipeline` with the sink's `sql` + ctx ids, preserving `{rows}`.
13. Same for the `{sample, totalCount}` and `{rows, truncated, totalCount}` result shapes.
14. `resolveResultSink({sql})` handle branch returns `{type:"data-table", …envelope, pipeline}`.
15. `{value}` / `{rows}` / `{transform}` sinks attach **no** pipeline (guard against over-reach).
16. `visualize_d3` codegen-failure fallback returns `{type:"data-table", rows, pipeline, message}`; handle variant likewise.
17. `visualize_d3` success returns are unchanged (regression pin).

### Layer 4 — api services

18. `resolveDisplayBlock` inline data-table block content includes `pipeline` when the tool result carries one.
19. Handle data-table block content includes `pipeline` alongside `queryHandle/rowCount/schema/samplePeek/sampled`.
20. A tool result with no `pipeline` yields block content with the key absent (not `undefined`-valued).
21. Empty-rows result still returns `null` (no block) — unchanged.
22. `PortalVizRefreshService.refresh` on a `data-table` block with a pipeline returns the fresh delivery.
23. Same block **without** a pipeline throws 422 `VIZ_WIDGET_NOT_REFRESHABLE` (not 404).
24. A block of an unregistered type still throws 404 `VIZ_WIDGET_NOT_FOUND`.
25. Cross-org refresh of a data-table block throws 404 (no existence leak).
26. **Top-N: refresh re-runs the full SELECT** — a stubbed `resolveSqlDelivery` receives `pipeline.sql` verbatim and its changed row *set* is returned.

### Layer 5 — api integration

27. `POST /api/portal-sql/widget-refresh` against a persisted data-table message block returns `{kind:"inline", rows}`.
28. The same endpoint returns `{kind:"handle", …}` when the re-executed result exceeds the threshold.
29. Rate limiting still applies to data-table refreshes on the shared `viz-refresh:<org>` key.
30. Pinning an **inline** data-table block now yields a pin whose content carries `pipeline`, and `POST /api/portal-results/:id/refresh` succeeds against it (resolves discovery Q6).

### Layer 6 — web

31. `TableWidgetUI` renders columns/rows, the freshness bar, and the row-cap notice when `rows.length < matchedCount`.
32. `TableWidgetUI` does **not** re-enter `ContentBlockRenderer` — asserted by rendering a `data-table` block through a registry where `data-table` maps to `TableWidget`, and confirming no recursion/stack overflow.
33. `TableWidget` container: inline content renders without a snapshot fetch; handle content fetches via the mocked `sdk.portalSql.handleSnapshot`.
34. `TableWidget` shows the degraded chip when the mocked `useWidgetRefresh` reports an error, and keeps the previous rows on screen.
35. `TableWidget` renders the cue with no refresh button when `notRefreshable`.
36. `registerTableBlockRenderer()` overrides the `data-table` renderer in the core registry.
37. `PortalMessage` passes `blockRef` + `dataUpdatedAt` to a **handle-backed** data-table block (the `shouldRenderViaWeb` regression this ticket fixes).
38. `shouldRenderViaWeb` returns false for a queryHandle-carrying data-table block.
39. `MapWidget` / `D3Widget` still render their cue + refresh button after adopting `WidgetFreshnessBar` (updated existing suites).

**Totals:** ~5 core contracts, ~6 core UI, ~6 api tools, ~9 api services, ~4 api integration, ~9 web ≈ **39 cases**.

## Acceptance criteria

- [ ] `npm run lint && npm run type-check && npm run test` clean at repo root.
- [ ] A `sql_query` result of **any** size produces a block whose content carries `pipeline`.
- [ ] A table widget in a portal message shows "Updated X ago" + a working refresh button, inline and handle-backed alike.
- [ ] Refreshing a "top N" table changes the row **set**, not just values.
- [ ] A refresh failure or rate-limit shows the inline degraded chip with last-good rows still on screen — no toast.
- [ ] A pre-#349 table block shows the cue with no refresh button and raises no error.
- [ ] Pinning an inline table yields a refreshable pin.
- [ ] Map and d3 widgets behave exactly as before, now rendering through the shared `WidgetFreshnessBar`.
- [ ] No new `ApiCode`, no migration, no change to `VIZ_REFRESH_RATE_PER_MIN` / `VIZ_REFRESH_FRESHNESS_MS`.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| **Infinite recursion** — `TableWidgetUI` renders through `ContentBlockRenderer`, which now routes `data-table` back to `TableWidget`. | Spec mandates a direct `DataTableBlock` call; test 32 asserts it. Highest-severity hazard here. |
| `registerTableBlockRenderer()` not wired into `main.tsx` → tables silently render without refresh (no error, just the old behavior). | Test 36 + a bootstrap assertion; the smoke walks a real table widget. |
| Echoing SQL into the agent result inflates context. | Bounded and mostly pre-existing: the handle branch already carries `sql` in its envelope, so only the inline branch is new (~80 tokens, duplicating the agent's own argument). Accepted per Key decision 1; the side-channel alternative was weighed and rejected. |
| Refresh load grows as tables join the refreshable population. | Fail-**open** rate limiter is unchanged and correct for a read (cost is query load, not correctness). Per-org cap contains a noisy tenant; acceptance criteria pin no regression. |
| The `VizPipelineSchema` rename misses a consumer. | `type-check` fails the build — there is no alias to mask it. |
| Deleting `QueryResultDataBlock` breaks an unnoticed importer. | `type-check` + grep before deletion; the component is referenced only from `PortalMessage`. |
| Shared-chrome adoption regresses map/d3 markup. | Test 39 re-pins both widgets; `data-testid` renames are updated in the same commit as the adoption. |

**Rollback:** pure `git revert` — no migration, no persisted-state change. Blocks minted while the change was live keep their `pipeline`, which older code simply ignores.

## Files touched

**`packages/core`** — new: `contracts/data-table-widget.contract.ts`, `ui/WidgetFreshnessBar.tsx`, tests for both; edit: `contracts/d3-widget.contract.ts` (rename), `contracts/pinned-result.contract.ts`, `contracts/index.ts`, `ui/index.ts`.

**`apps/api`** — edit: `tools/result-sink.ts`, `tools/visualize-d3.tool.ts`, `services/portal.service.ts`, `services/portal-viz-refresh.service.ts`; tests: `__tests__/tools/result-sink.test.ts`, `__tests__/tools/visualize-d3.tool.test.ts`, `__tests__/services/portal.service.test.ts`, `__tests__/services/portal-viz-refresh.service.test.ts`, `__tests__/__integration__/routes/portal-viz-refresh.integration.test.ts`, `__tests__/__integration__/routes/portal-results.router.integration.test.ts`.

**`apps/web`** — new: `modules/TableWidget/` (7 files + tests + stories); edit: `components/PortalMessage.component.tsx`, `modules/MapWidget/MapWidget.component.tsx`, `modules/D3Widget/D3Widget.component.tsx`, `views/PinnedResultDetail.view.tsx`, `main.tsx`, and the MapWidget/D3Widget/PinnedResultDetail test suites; **delete**: `components/QueryResultDataBlock.component.tsx`.

No new dependency, no env-var change, no infra change.

## Next step

`docs/QUERY_BACKED_VIZ.plan.md` — six TDD slices, back to front so every commit is independently green and only the last changes what a user sees: (1) `VizPipelineSchema` rename + the core data-table contract; (2) sink attaches the pipeline + the `no-open-coded-sink` guard extension; (3) projection stops dropping it + the d3 fallback fix; (4) refresh service admits `data-table` (+ integration); (5) `WidgetFreshnessBar` extracted and adopted by map/d3/pin — pure refactor, no behavior change; (6) the `TableWidget` module, the `PortalMessage` plumbing deletions, and the `QueryResultDataBlock` removal.
