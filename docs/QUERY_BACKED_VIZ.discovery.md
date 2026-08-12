# Every visualization is query-backed — Discovery

**Issue:** [EnterpriseBT/portal-ai#349](https://github.com/EnterpriseBT/portal-ai/issues/349)

**Status:** confirmed 2026-08-12 — every `Lean:` below is an accepted decision, including Decision 4 option B (promote a `TableWidget` module). `/spec` lifts them as settled; it does not re-open them.

**Why this exists.** A visualization's job is to show the current state of the data. #270 gave every widget a durable, re-executable pipeline and `useWidgetRefresh` gave it a freshness-gated auto-refresh plus a manual button. The premise of this ticket is that *small* results skip that machinery — they're delivered as a baked row snapshot with nothing behind them to re-run.

The survey says the premise is half right, and the half it gets wrong matters. **Map and d3 already carry their pipeline on the inline branch** (`visualize-map.tool.ts:349`, `visualize-d3.tool.ts:141-156`) — a 10-row map is as refreshable as a 10-million-row one. The terminal snapshot is not a size problem at all. It is a **type** problem: the **table** carries no pipeline at *any* size, and the d3 codegen-failure fallback degrades into a table and loses its pipeline with it. So the widget users reach for most often to read exact numbers — "the 10 largest wildfires" as a table — is the one that can never refresh.

This is the ticket that makes the table a first-class, query-backed widget, and removes the last two paths that mint a block with no query behind it.

## The current shape

### The delivery fork

One function decides inline-vs-handle for every SQL-backed result: `resolveSqlDelivery` (`apps/api/src/tools/result-sink.ts:69-86`) counts rows and returns `{kind:"inline"}` under `INLINE_ROWS_THRESHOLD` (100 — `packages/core/src/constants/large-data-ops.constants.ts:56`), else produces a handle. `resolveResultSink` (`:154`) wraps it; its `{sql}` arm (`:165-173`) returns `delivery.result` **verbatim** on inline.

| Surface | Inline branch | Handle branch | Refreshable? |
|---|---|---|---|
| Map / geo | `pipeline` emitted — `visualize-map.tool.ts:349` | `pipeline` emitted — `:329-335` | **Yes, any size** |
| D3 / chart | `pipeline` emitted — `visualize-d3.tool.ts:141-156` | same | **Yes**, except the fallback below |
| D3 codegen failure | `{type:"data-table", rows}`, **no pipeline** — `visualize-d3.tool.ts:165-168` | — | **No** |
| Table (`sql_query`) | raw `{rows}` from `AnalyticsService.sqlQuery` — no `sql`, no `pipeline` | envelope retains `sql` (contract `:63`) | **No, any size** |

The map/d3 pipelines are built at `visualize-map.tool.ts:279-284` and `visualize-d3.tool.ts:140` — both `{sql, stationId, organizationId}`, the map adding a `geom` alias when the primary geometry column is named otherwise.

### Two places the table loses its query

1. **`sql_query` never builds one.** It routes through `resolveResultSink` (`apps/api/src/tools/sql-query.tool.ts`), which has no pipeline concept for the `{sql}` arm.
2. **The block projection whitelists it away.** `resolveDisplayBlock` (`apps/api/src/services/portal.service.ts:238-273`) passes d3 and geo tool results through *whole* (`:219`, `:233`) — which is precisely why only those two keep `pipeline` — but the handle arm for tables (`:245-252`) copies only `queryHandle/rowCount/schema/samplePeek/sampled`, **dropping the envelope's `sql`**, and the inline arm (`:269`) emits exactly `{type, columns, rows}`. So even where the SQL survives to the service, the projection discards it.

The consequence: **every table block on the wire is terminal**, handle-backed ones included.

### Contracts

| Piece | Location | Note |
|---|---|---|
| `D3PipelineSchema` | `packages/core/src/contracts/d3-widget.contract.ts:27-37` | `sql/stationId/organizationId` + optional opaque `transform` |
| `pipeline` optionality | `d3-widget.contract.ts:46`, `map-spec.contract.ts:187` | Optional **by design** so pre-#270 and mid-stream blocks still parse |
| Geo block union | `map-spec.contract.ts:183-223` | `GeoInlineContentSchema` (`:198`) / `GeoHandleContentSchema` (`:209`) |
| Table block | **absent from `packages/core/src/contracts/`** | Web-side only: `QueryResultDataBlockContent` (`apps/web/src/components/QueryResultDataBlock.component.tsx:20-34`) |
| Pinned table | `packages/core/src/contracts/pinned-result.contract.ts:22-32` | `PinnedDataTableContentSchema` — `pipeline` optional, commented *"Present ⇢ the pin is refreshable"* |
| `dataUpdatedAt` | `packages/core/src/ui/ContentBlockRenderer.tsx:37-44` | **Not a wire field** — a render-context prop seeded from `message.created` or a pin's `snapshotUpdatedAt` |

A terminal snapshot on the wire is therefore: content with `rows` and neither `pipeline` nor `queryHandle`.

### The refresh path

`POST /api/portal-sql/widget-refresh` (`apps/api/src/routes/portal-sql-handle.router.ts:164-217`) takes `{messageId, blockIndex}` and enforces `VIZ_REFRESH_RATE_PER_MIN` (120) at `:189-198` via `incrementRateWindow("viz-refresh:<org>")`, **fail-open on Redis error**. The pin twin `POST /api/portal-results/:id/refresh` (`apps/api/src/routes/portal-results.router.ts:297-330`) shares the same rate key (`:309-315`).

Both land in `PortalVizRefreshService` (`apps/api/src/services/portal-viz-refresh.service.ts`). Two facts shape this work:

- `refresh` (`:77`) org-gates on `message.organizationId` (`:93`), then **404s any block whose `type` isn't `d3` or `geo`** (`:99`). A `data-table` block isn't "not refreshable" today — it's *not a widget* as far as the service is concerned.
- **422 `VIZ_WIDGET_NOT_REFRESHABLE`** (`:108-114`, `:170-176`) is exactly `D3PipelineSchema.safeParse(content.pipeline)` failing — a persisted d3/geo block or pin row with no `pipeline`.

`refreshPinnedResult` (`:140`) reads `row.content.pipeline` (`:169`) and persists the fresh snapshot back with `snapshotUpdatedAt` (`:200-211`). Pin pipelines are derived at `apps/api/src/services/portal-result-pin.service.ts:51-70` — own `pipeline`, else the handle's retained `sql`, else `getMeta().sql` (`:207-227`).

### The three widget surfaces

| Widget | `useWidgetRefresh` | "Updated X ago" | Refresh button |
|---|---|---|---|
| Map | `MapWidget.component.tsx:539` | `:289-296` (#348) | `:298-315`, gated `canRefresh` `:601-606` |
| D3 | `D3Widget.component.tsx:285` | `:150-157` | `:159-170`, wired `:403-406` |
| Table (inline) | — | — | — |
| Table (handle) | — | — | — |

Inline tables render through `renderDataTable` → `DataTableBlock` (`packages/core/src/ui/ContentBlockRenderer.tsx:58-66`, `packages/core/src/ui/DataTableBlock.tsx:41`), which **ignores `ctx` entirely**. Handle tables render through `apps/web/src/components/QueryResultDataBlock.component.tsx`, which receives only `content` — no `blockRef`, no cue, no button.

**There is no shared chrome.** The title + freshness cue + refresh button header is hand-duplicated three times: `MapWidget:277-320`, `D3Widget:129-175`, `PinnedResultDetail.view.tsx:217-236`.

### BlockRef plumbing

`BlockRef` (`packages/core/src/ui/ContentBlockRenderer.tsx:27-29`) is threaded into `ctx` at `:106-113` and constructed at `apps/web/src/components/PortalMessage.component.tsx:234-239`. **The gap is at `:229-230`**: `shouldRenderViaWeb` (`:108-115`) diverts handle-backed data-tables to `renderWebBlock` (`:33-61`), which passes **no ctx at all**. Pins render at `PinnedResultDetail.view.tsx:261-262`, with page-level refresh gated by `isPageRefreshable` — data-table-with-pipeline only (`:76-80`, `:404-412`).

### Top-N semantics — already correct

`executePipeline` (`portal-viz-refresh.service.ts:227-260`) calls `resolveSqlDelivery({sql: pipeline.sql}, …)` — **the full original SELECT re-runs unbounded**, re-deciding inline-vs-handle by the same threshold. Nothing is parameterized or id-replayed, so the result *set* changes on refresh. The acceptance criterion about a newly-largest wildfire appearing is satisfied the moment a pipeline exists; it needs no new work. (The only bounded replay is the map tile path, `portal-map-tile.service.ts:381-450`, which wraps `pipeline.sql` in `ST_AsMVT`/`ST_TileEnvelope` — viewport-bounded but still against the live query.)

## The design space

### Decision 1 — Where the table's pipeline is attached

**A. In `sql_query.tool.ts`**, mirroring what visualize-map/d3 do in their own tool files.
**B. In `resolveResultSink`'s `{sql}` arm** (`result-sink.ts:165-173`) — the one place every SQL-backed sink already funnels through.
**C. Only fix `resolveDisplayBlock`'s whitelist**, relying on the handle envelope's retained `sql`.

| | A (tool) | B (sink) | C (projection only) |
|---|---|---|---|
| Covers inline tables | Yes | Yes | No — inline has no `sql` to recover |
| Covers future `{sql}` tools | No — per-tool opt-in | Yes, automatically | Partly |
| Guard-testable | Per tool | Single choke point (`no-open-coded-sink.test.ts` precedent) | No |
| Touches map/d3 | No | No — they pass their own pipeline through | No |

**Lean: B, with C as a required companion.** The sink is already the single fork, and `no-open-coded-sink.test.ts` shows the codebase already guards that choke point — attaching the pipeline there means a *new* SQL tool cannot ship a terminal block by omission. C is not an alternative: the projection whitelist must stop dropping the field regardless, or B's work never reaches the wire.

### Decision 2 — Where the table block contract lives

**A. Promote a `data-table` block contract into `packages/core/src/contracts/`**, an inline/handle union with optional `pipeline`, mirroring `d3-widget.contract.ts` and `map-spec.contract.ts`.
**B. Keep the web-side `QueryResultDataBlockContent` type and widen it in place.**

**Lean: A.** The refresh service validates with `D3PipelineSchema.safeParse` server-side, so the shape has to be shared regardless — B would leave the server validating against a type the client owns. `PinnedDataTableContentSchema` (`pinned-result.contract.ts:22-32`) already carries an optional `pipeline` with exactly this meaning, so A makes the message-block contract consistent with the pin contract rather than inventing a shape.

### Decision 3 — How the refresh service admits `data-table`

The service 404s non-`d3`/`geo` blocks (`:99`). Options: widen the type allowlist to include `data-table` and add a data-table variant to `WidgetRefreshResponse`, **or** keep the allowlist and have tables ride the existing d3 path.

**Lean: widen the allowlist.** A table is a distinct delivery shape (`columns`/`rows` or an envelope), not a chart, and `executePipeline` already returns whichever `resolveSqlDelivery` picks. Note the *status-code* consequence worth being deliberate about: today a legacy table block yields 404, and after this change it yields 422 `VIZ_WIDGET_NOT_REFRESHABLE` — which is the honest answer and the one `useWidgetRefresh` already knows how to render (`use-widget-refresh.util.ts:91`).

### Decision 4 — How the table becomes a refresh-aware widget

**A. Minimal.** Make core's `DataTableBlock` read `ctx`, and thread `ctx` through `renderWebBlock`.
**B. Promote a `modules/TableWidget/`** module with a Gate + `register.util`, mirroring `MapWidget`/`D3Widget`, and collapse the two renderers into it.
**C. Container-only.** Leave both renderers, wrap each in a refresh-aware container.

| | A | B | C |
|---|---|---|---|
| Renderers left | 2 | 1 | 2 |
| Matches the other two widgets | No | Yes | No |
| Chrome duplication after | 4 copies | 3 → shared | 5 copies |
| Blast radius | Small | Medium — touches `PortalMessage` dispatch | Small |

**Lean: B — confirmed.** The ticket's own word is *uniform*; two divergent table renderers, neither of which sees `ctx`, is the reason the table fell behind in the first place. B also gives the natural home for the Gate pattern the other two widgets already use, and lets `shouldRenderViaWeb`'s ctx-dropping divert (`PortalMessage.component.tsx:229-230`) be deleted rather than worked around. This is the largest slice and the only one that changes what a user sees; the plan sequences it last so every earlier commit is independently green.

### Decision 5 — Shared chrome for the freshness cue

The new degraded-state requirement ("Couldn't update — showing data from X ago") has to land on map, d3, table, and the pin detail view. Written inline, that's four copies of a state machine (fresh / refreshing / degraded / not-refreshable) on top of three existing copies of the header.

**A. Extract a pure-UI `WidgetFreshnessBar`** consumed by all four surfaces.
**B. Add the degraded chip inline in each surface.**

**Lean: A, placed in `packages/core/src/ui/`.** Placement is forced rather than chosen: `DataTableBlock` lives in core, so a web-side component can't serve all consumers. Per the Component File Policy it is a single-component file — a pure UI component taking `lastUpdatedAt`/`isRefreshing`/`error`/`notRefreshable`/`onRefresh` as props, with the container wiring staying in each widget.

## Tradeoff comparison

|  | D1: sink attaches pipeline | D2: contract in core | D3: widen allowlist | D4: TableWidget module | D5: shared chrome |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Touches `packages/core` | No | Yes | No | No | Yes |
| Touches `apps/api` | Yes | No | Yes | No | No |
| Touches `apps/web` | No | No | No | Yes | Yes |
| Reversible if wrong | Yes | Additive-only | Yes | Medium | Yes |

## Recommendation

1. Attach `{sql, stationId, organizationId}` as `pipeline` in `resolveResultSink`'s `{sql}` arm (`result-sink.ts:165-173`) so every SQL-backed result — inline or handle — carries its query. Extend the `no-open-coded-sink` guard so a future SQL tool cannot mint a terminal block.
2. Stop `resolveDisplayBlock` (`portal.service.ts:238-273`) whitelisting `pipeline` away on both the handle arm (`:245-252`) and the inline arm (`:269`).
3. Add a `data-table` block contract to `packages/core/src/contracts/` as an inline/handle union with an optional `pipeline`, matching the d3/geo shape and the existing `PinnedDataTableContentSchema`.
4. Give `visualize-d3.tool.ts:165-168`'s codegen-failure fallback the pipeline it already has in scope — a degraded chart is still a query-backed table.
5. Widen `PortalVizRefreshService.refresh`'s block-type gate (`:99`) to admit `data-table`, and add the matching `WidgetRefreshResponse` variant.
6. Promote `apps/web/src/modules/TableWidget/` (container + pure UI + Gate + `register.util`), collapsing `DataTableBlock` and `QueryResultDataBlock` into it, and delete the ctx-dropping `shouldRenderViaWeb` divert at `PortalMessage.component.tsx:229-230`.
7. Extract a pure-UI `WidgetFreshnessBar` into `packages/core/src/ui/` carrying fresh / refreshing / degraded / not-refreshable, and adopt it in `MapWidget`, `D3Widget`, `TableWidget`, and `PinnedResultDetail`.

## Open questions

1. **Do message blocks get rewritten on refresh?** Pin refresh persists its fresh snapshot (`:200-211`); message-block refresh does not. **Lean: keep message blocks immutable.** A message is a record of what the agent said at a point in time; silently rewriting its rows would make the transcript lie. Freshness is a *view* concern — the client holds the fresh delivery, the stored block stays as-sent.
2. **What does a legacy (pre-#270) block show?** It will now 422 rather than 404. **Lean: cue without a button** — render "Updated X ago" and omit the refresh affordance entirely, rather than showing a degraded/error chip. Nothing failed; the block simply predates pipelines, and `notRefreshable` is already a distinct flag from `error` in `use-widget-refresh.util.ts`.
3. **Does storing SQL on every table block bloat message rows?** Every `sql_query` result gains its SELECT text. **Lean: accept.** d3 and geo blocks have carried the same text since #270 with no reported pressure, and the alternative (a pipeline reference table) adds a join to a read path for no current benefit.
4. **Does the rate cap need revisiting now that tables are refresh candidates?** More block types become refreshable, so a table-heavy thread can burst more auto-refreshes on view. **Lean: no change.** 120/min per org against a mount-gated, freshness-gated trigger leaves substantial headroom; revisit only if the smoke shows otherwise.
5. **Is `dataUpdatedAt` right for a table seeded from `message.created`?** **Lean: yes, unchanged.** It is the honest "when this data was produced" for an as-sent block, and post-refresh the client's `lastUpdatedAt` takes over.
6. **Are pinned tables already refreshable?** `portal-result-pin.service.ts:51-70` falls back to the handle's retained `sql`, so handle-backed pins may already work while inline-backed pins don't. **Lean: confirm during spec** and treat any gap as covered by recommendation 1 rather than a separate fix.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because refresh is a read-only re-execution of a SELECT; there is no check-then-act and no state to race. The one shared mutable structure, `lastHydratedAt` (`use-widget-refresh.util.ts:17`), is per-tab and advisory.
- **Accuracy & auditability** — **Lean: message blocks stay immutable** (open question 1). The conversation transcript is the durable record; refreshed data is presentation state. Pins keep their existing persist-with-`snapshotUpdatedAt` behavior, which is the intended record-of-truth for a saved result.
- **Failure modes** — **Lean: fail-soft, visibly.** A failed refresh keeps last-good data and flips the freshness cue to the degraded chip; it never blanks the widget and never raises a toast. This preserves the existing rate-limiter fail-open on Redis error (`portal-sql-handle.router.ts:189-198`) — correct here because the gated action is a read, so failing open costs query load, not correctness or money.
- **Scale & unbounded growth** — **Lean: bounded by the existing two gates.** Making tables refreshable widens the *population* of auto-refresh candidates, not the per-widget rate: the freshness window still suppresses re-fetch within `VIZ_REFRESH_FRESHNESS_MS` and the per-org window caps the burst. Worth naming in the spec that a refresh re-runs the full unbounded SELECT (`executePipeline:227-260`) — a wide top-N over a large table costs a full query per refresh.
- **Multi-tenancy** — **Lean: unchanged and adequate.** Org gating is already enforced on the message (`portal-viz-refresh.service.ts:93`), and both refresh endpoints share one per-org rate key, so a widget-heavy tenant throttles itself without affecting neighbors.
- **Contract stability** — **Lean: additive-only.** `pipeline` stays optional on the new table contract exactly as it is on d3/geo (`d3-widget.contract.ts:46`), so historical blocks keep parsing and no migration is needed. Per the standing decision that the core visualization loop is not a monetized axis, no entitlement read is introduced on this path.
- **Data lifecycle** — N/A because this work adds no new retention surface: message blocks follow message retention, pins follow pin retention, and the refresh itself is stateless.

## What this doesn't decide

- **A continuous cadence while a widget is visible.** Explicitly out of scope per the amended PRD — the mount-time, freshness-gated trigger plus the manual button is the whole contract. Interval and visibility-driven re-runs stay unbuilt.
- **A pause/resume control**, which is moot without a cadence.
- **Real-time push / websockets.** Refresh stays pull-based.
- **The map's per-pan tile re-query**, which is already live and is not being rebuilt.
- **Consolidating the two rate-limit call sites** into the service layer. They're duplicated across the two routers but correct; folding them in is a tidy-up with no user-visible effect.
- **Whether `INLINE_ROWS_THRESHOLD` is still the right number.** This work makes the threshold stop mattering for freshness, which is the point — retuning it is a separate question.

## Next step

Write `docs/QUERY_BACKED_VIZ.spec.md` (the contract: the new table block schema, the widened refresh allowlist and its response variant, the `WidgetFreshnessBar` prop surface, and the acceptance criteria restated as tests) and `docs/QUERY_BACKED_VIZ.plan.md`. The plan slices roughly along the recommendation's own seams, back to front so each commit is independently green: (1) sink attaches the pipeline + guard test; (2) projection stops dropping it + the d3 fallback fix; (3) the core table contract; (4) the refresh-service allowlist + response variant; (5) `WidgetFreshnessBar` extracted and adopted by map/d3/pin; (6) the `TableWidget` module, which is the only slice that changes what a user sees.
