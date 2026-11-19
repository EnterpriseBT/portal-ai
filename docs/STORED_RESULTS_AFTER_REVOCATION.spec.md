# Stored results after revocation — Spec

This spec pins the contract for serving portal results as live reads: a stored answer keeps only the recipe that re-runs it, every render re-runs it under the reader's current view access, and handle reads re-check that access. It builds on [`STORED_RESULTS_AFTER_REVOCATION.discovery.md`](STORED_RESULTS_AFTER_REVOCATION.discovery.md) for [#1038](https://github.com/EnterpriseBT/portal-ai/issues/1038).

## Key decisions (flag for review)

1. **A stored result keeps its recipe, not its rows.**
   - A persisted `data-table` / `d3` / `geo` block keeps its `pipeline` and display metadata (columns, schema, `rowCount`, program, title, summary, map spec).
   - It drops `rows`, `samplePeek`, `sample` and `queryHandle`.
   - The live stream during the turn is unchanged: `sseResult` still carries rows, because that delivery happened under the reader's access at that moment.
2. **`display_entity_records` gets a pipeline** (the defect behind the repro).
3. **`technical_indicator` gets a real recipe.** Its large-input path folds a deterministic transform over a source handle, so its pipeline is `{ sql: <the source handle's sql>, stationId, organizationId, transform: <the descriptor minus sourceHandle> }`, filling `VizPipelineSchema`'s reserved `transform` slot. Its small path (`{dates, values}`) never produced a block.
4. **A change from discovery's Decision 4 lean, for confirmation: a block with no recipe isn't kept.** These are custom webhook tools returning a `data-table`, and any rows-sink table without a pipeline.
   - The persisted block becomes `{ type, notKept: true, columns, rowCount }`, and it renders "This result isn't kept after the conversation. Ask again to see it."
   - Discovery leaned toward storing such outputs and gating them on their input's recipe. The survey found the only display-producing derived tools are `technical_indicator` (now re-runnable) and custom webhooks. Gating webhooks would mean threading input SQL through three kinds of handle (SQL, transform, staged rows).
   - "Not kept" is the simpler rule you asked for, and it leaves nothing to gate.
5. **Every stored widget reads live.** It renders by calling widget-refresh as the caller, paints nothing until that answers, and never paints a stored copy. A caller who has lost access gets **`422 VIZ_WIDGET_DATA_UNAVAILABLE`**, shown as "no longer available". The access loss is a `PORTAL_SQL_FORBIDDEN` whose `details.reason` is `STALE_REFERENCE`, which is what a revoked or detached view produces (`portal-sql-validation.util.ts:380-394`, `portal-sql.service.ts:2050-2077`).
6. **Handle reads re-authorize.** Each `GET /api/portal-sql/handle/:id` runs `explainSqlQuery` as the caller over the handle's SQL (for a transform handle, its root source's SQL). A failure answers the existing `404 READ_HANDLE_EXPIRED`. A staged-rows handle (no SQL, no transform; webhook output, in-turn bulk) keeps today's owner check, a residual named under Risks. *(Code review)* A passed check covers the same reader's further pages of that handle for `HANDLE_READ_DECISION_TTL_MS` (30s, in-process, size-bounded; refusals aren't remembered), so a large chart doesn't EXPLAIN per page; a revocation reaches an open handle within 30s.
7. **Model history is a summary.** A persisted raw `tool-result` with rows keeps `columns`, `rowCount`, the SQL and *(code review)* the `queryHandle` id, not rows; the id isn't data, and handle reads re-check access, so a follow-up can reuse a live handle instead of re-running an expensive query. A bare array counts as rows only when every element is an object. The system prompt says earlier rows aren't kept: pass a live `queryHandle`, or re-query.
8. **Existing data.** `getPortal` and `replayTurn` strip stored rows on serve, and a data migration removes them at rest.
9. **Reads on mount, not per viewport.** Every widget reads when it mounts, under widget-refresh's existing per-org rate limit and the #698 admission gate. Viewport-driven reads stay #271's. *(Code review)* A remount within `VIZ_REFRESH_FRESHNESS_MS` reuses the tab's last read of that block from memory (never stored; evicted on "unavailable"), so scrolling back doesn't spend the org's 120/min refresh budget.
10. **Accepted at code review.** A result's query runs twice per turn (live, then the persisted widget's first read), and a transform pipeline's refresh re-stages its source and fold. Both are bounded by the session read cache and the rate limit.

## Scope

### In scope
- API: the stored-result shaping (persist + serve), `display_entity_records` and `technical_indicator` pipelines, transform re-runs in `runPipeline`, refresh's access-loss code, handle re-auth, history summaries, the migration.
- Core: block contracts (recipe-only and not-kept), the new `ApiCode`'s web mirror if any, the FAQ entry.
- Web: `useWidgetRefresh` and the three widgets render only live data, with unavailable and not-kept states.

### Out of scope
- **Assistant prose, a d3 block's agent-written `title`/`summary`, and a map spec's `colorBy.categories`/bounds.** These are authored or derived text kept with the conversation and aren't redacted (Risks).
- **Scalar tool results** (hypothesis tests, regressions, entity writes). They're never rendered as widgets and stay in the raw `tool-result` for history, as their values already sit in the assistant's prose.
- **Pins** (already live, #640).
- **Viewport-lazy reads** (#271).

## Surface

### `apps/api/src/services/stored-result.util.ts` (new)
```ts
/** The persisted form of a display block's content: recipe + metadata, no rows. */
export function toStoredBlockContent(
  type: "data-table" | "d3" | "geo",
  content: Record<string, unknown>
): Record<string, unknown>;
/** The persisted form of a raw tool-result's content (history). */
export function toStoredToolResult(content: unknown): unknown;
/** Serve-time: apply toStoredBlockContent / toStoredToolResult to every block of a stored message. */
export function stripStoredMessage<M extends { blocks: unknown }>(message: M): M;
```
- **`toStoredBlockContent`:**
  - With a parseable `pipeline`, it returns the content minus `rows`, `samplePeek`, `sample` and `queryHandle`, keeping every other key.
  - Without one, it returns `{ type, notKept: true, columns, rowCount }`. `columns` comes from `columns`, from `schema[].name`, or from the first row's keys; `rowCount` from `rowCount` or `rows.length`.
- **`toStoredToolResult`:**
  - For an object with `rows`/`sample` or a `queryHandle`, or a bare row array, it returns `{ rowsNotKept: true, columns, rowCount, sql? }`, where `sql` is `pipeline.sql`, else the envelope's `sql`. The `rowsNotKept` tag tells the summary apart from a scalar result that happens to have `columns`.
  - Anything else (a scalar result) is returned unchanged.
- **Idempotence.** All three are idempotent, so stripping an already-stripped block changes nothing.

### `portal.service.ts`
- **Persisting.** `handleToolResult` (`:178-214`) persists `content: toStoredToolResult(toolResult)` and `displayBlock.block` with `content: toStoredBlockContent(...)`. `sseResult` is unchanged, so the in-turn stream keeps rows.
- **Serving.** `getPortal` (`:~529`) returns `messages.map(stripStoredMessage)`, and `replayTurn` (`:995-1030`) re-sends stripped content.
- **History.** `reconstructModelMessages` reads the stripped `{rowsNotKept, columns, rowCount, sql}` form, and applies `toStoredToolResult` itself, so an unstripped caller replays no rows either:
  - `replayResult` and `summarizeToolResult` render it as `[Previous <tool> result: <rowCount> rows, columns: [...]; re-run to see values]`, with no sample row.
  - `SUMMARY_CELL_CHARS` and the sample code go away.
- **System prompt** (`apps/api/src/prompts/system.prompt.ts`): one line saying results from earlier turns aren't kept, and to re-run the query when a follow-up needs their values.

### `display-entity-records.tool.ts` (`:64-81`)
Returns `{ type: "data-table", ...envelope, pipeline: { sql, stationId, organizationId } }`, using the `sql` it already builds.

### `technical-indicator.tool.ts` (`:86-95`)
The transform path returns the envelope plus `pipeline`:
- `sql` is `(await PortalSqlHandleService.getMeta(queryHandle)).sql`, and `stationId`/`organizationId` come from the build context.
- `transform` is the `TransformDescriptor` without `sourceHandle`.

If the source handle has no `sql` (a staged-rows source), there's no pipeline, and the block is stored not-kept.

### `portal-viz-refresh.service.ts`
- **Transform re-runs.** `runPipeline` (`:257-295`), when `pipeline.transform` is set, delivers `pipeline.sql` as a handle, then returns `produceFromTransform({ transform: { ...pipeline.transform, sourceHandle }, … })`'s envelope as `{ kind: "handle" }`.
- **Access loss.** `refresh` (`:85-140`) maps a `PORTAL_SQL_FORBIDDEN` with `details.reason === STALE_REFERENCE` from the run to `new ApiError(422, ApiCode.VIZ_WIDGET_DATA_UNAVAILABLE, "This result is no longer available to you.")`.
- **Not-kept blocks.** `{ notKept: true }` keeps answering `422 VIZ_WIDGET_NOT_REFRESHABLE` (no pipeline).

### `api-codes.constants.ts`
`VIZ_WIDGET_DATA_UNAVAILABLE = "VIZ_WIDGET_DATA_UNAVAILABLE"` beside `VIZ_WIDGET_NOT_REFRESHABLE` (`:865`), with a recommendation entry beside `:996` ("Ask for access to the view this result reads, or ask again.").

### `routes/portal-sql-handle.router.ts`
- **Handle read (`:105-131`).** After the org check, in the non-pin branch and for a handle with `_userId`, it calls `PortalSqlHandleService.authorizeCallerRead(meta, ctx)`:
  - It resolves the SQL: `meta.sql`, else walk `meta._transform.sourceHandle` metas to the root's `sql`.
  - It runs `PortalSqlService.explainSqlQuery({ sql, stationId: meta._stationId, organizationId, userId })`.
  - A `STALE_REFERENCE` refusal, or a source handle that has expired, throws `404 READ_HANDLE_EXPIRED`.
  - A handle with no resolvable SQL skips the explain.
- **The `@openapi` block** adds that 404 case. **Widget-refresh's `@openapi`** (`:200-268`) adds the 422 `VIZ_WIDGET_DATA_UNAVAILABLE`, with its response referencing the existing error component.

### `packages/core/src/contracts/`
- **Stored base shape.** `data-table-widget.contract.ts`, `d3-widget.contract.ts` and `map-spec.contract.ts` (`GeoBlockContentSchema`) each add a stored shape: the base content with `pipeline` required and none of `rows` / `samplePeek` / `queryHandle`. `columns` stays optional on tables.
- **Not-kept shape.** A shared `NotKeptContentSchema = z.object({ type, notKept: z.literal(true), columns: z.array(z.string()), rowCount: z.number().int().nonnegative() })` in `contracts/stored-result.contract.ts`. It is **not** a branch of the block unions (found in slice 4: as a branch it stripped `program`/`spec`/`title` from every widget's parsed type). A widget checks it first and renders the not-kept state instead of parsing the block.
- **Union order.** The block unions become `[Handle, Inline, Stored]`: in-turn SSE shapes first, the persisted shape after. Pins' schemas are untouched.

### `apps/web`
- **`utils/use-widget-refresh.util.ts`:**
  - For a `message` ref, it reads on every mount; the 3-min freshness skip goes away for messages but stays for pins.
  - It exposes `unavailable: boolean`, set on `VIZ_WIDGET_DATA_UNAVAILABLE`.
  - `lastUpdatedAt` is set only from a completed read, never from `message.created`.
- **`TableWidget` (`:222-245`), `D3Widget` (`:250-270`), `MapWidget` (`:965-972`):**
  - Data comes from `fresh` only, or from in-turn content that carries rows/handle (the live stream).
  - A persisted block shows a loading state until `fresh` arrives.
  - `unavailable` renders a `StatusMessage`: "This result is no longer available to you."
  - `notKept` renders "This result isn't kept after the conversation. Ask again to see it."
  - The freshness bar renders only with a `lastUpdatedAt`.
- **`VisualDataTable`** keeps paging the live handle from `fresh`, and its existing "expired, Refresh" state covers a 404.

### Help
`packages/core/src/content/faq.util.ts`: an entry saying that charts and tables in a conversation re-read their data each time they're shown, so they follow the viewer's current access and show current data.

## Migration
`npm run db:generate -- --name strip-stored-result-rows` produces an empty migration, which is then hand-written as a data-only `UPDATE portal_messages`:
- It rewrites `blocks` so that every `data-table`/`d3`/`geo` element's `content` loses `rows`, `samplePeek`, `sample` and `queryHandle` when it has a `pipeline`. Without one it becomes `{type, notKept: true, columns, rowCount}`.
- Every `tool-result` element's row payload becomes `{rowsNotKept: true, columns, rowCount, sql}`.
- It's carried in SQL (`jsonb_path` / `jsonb_set` over `jsonb_array_elements`), batched by `id` ranges, and marked `-- destructive-ok: removes stored result rows; the recipe that re-runs them is kept (#1038)`.

No schema change and no seed. The serve-time strip covers any row the migration hasn't reached.

## TDD test plan

### api — unit (`apps/api`, `npm run test:unit`)
- **`stored-result.util.test.ts`** (new), ≈ 12 cases:
  - per block type (table/d3/geo), with a pipeline: rows, samplePeek and handle dropped, metadata kept;
  - without a pipeline: not-kept, with columns derived from rows, from schema and from columns;
  - tool-result rows: `{rowsNotKept, columns, rowCount, sql}`;
  - a scalar result passes through;
  - idempotence;
  - `stripStoredMessage` over mixed blocks.
- **`portal.service.test.ts`**, ≈ 6:
  - persisted blocks carry no rows while the SSE `tool_result` does;
  - `resolveDisplayBlock` is unchanged;
  - the history summary uses `rowCount`/`columns` with no sample;
  - `getPortal` strips a legacy message.
- **`display-entity-records` tool test**, ≈ 1: the pipeline is present.
- **`technical-indicator` tool test**, ≈ 2: the pipeline carries the source SQL + transform; a staged-rows source gives no pipeline.
- **`portal-viz-refresh.service.test.ts`**, ≈ 4:
  - a transform pipeline re-folds;
  - `STALE_REFERENCE` → 422 `VIZ_WIDGET_DATA_UNAVAILABLE`;
  - not-kept → 422 `NOT_REFRESHABLE`;
  - other errors pass through.
- **`system.prompt.test.ts`**, ≈ 1: the re-query line is pinned.

### api — integration (`apps/api`, `npm run test:integration`)
- **`portal-sql-handle.router.integration.test.ts`**, ≈ 5:
  - the owner reads their handle (200);
  - after the view grant is revoked → 404;
  - after the view is detached → 404;
  - a transform handle whose source view is revoked → 404;
  - a staged-rows handle keeps the owner check.
- **Widget refresh integration**, ≈ 3: revoked → 422 `VIZ_WIDGET_DATA_UNAVAILABLE`; access restored → 200 with rows; a stored block has no rows on `GET` portal.
- **Migration test**, ≈ 2: a seeded legacy message is stripped by the migration, and a re-run is a no-op.

### core (`packages/core`, `npm run test:unit`)
- **Contract tests**, ≈ 6: stored and not-kept shapes parse per type; the handle and inline shapes still win for in-turn content.
- **`faq.util.test.ts`**, ≈ 1.

### web (`apps/web`, `npm run test:unit`)
- **`useWidgetRefresh` tests**, ≈ 4: a message reads on every mount; unavailable on 422; `lastUpdatedAt` only after a read; pins still use the freshness skip.
- **`TableWidget` / `D3Widget` / `MapWidget` tests**, ≈ 3 each:
  - a persisted block paints nothing before `fresh`;
  - the unavailable state, with axe;
  - the not-kept state, with axe.

**Totals ≈ 56 cases.**

## Acceptance criteria
- [ ] After a member's read on a view is revoked, or the view is detached from the station, reloading a portal where they queried it shows "This result is no longer available to you", and no row of it.
- [ ] Their `GET /api/portal-sql/handle/:id` for that query answers `404 READ_HANDLE_EXPIRED`.
- [ ] With access intact, the same table renders its current rows, and "Updated …" shows the time of that read.
- [ ] `display_entity_records` tables refresh like `sql_query` tables.
- [ ] No `portal_messages.blocks` row holds result rows or a `samplePeek` after the migration, and new turns persist none.
- [ ] A custom webhook's table shows "isn't kept" after a reload.
- [ ] A follow-up question about an earlier answer works by re-querying.

## Risks & rollback
- **Load.** Every mounted widget re-runs on every reload. It's bounded by widget-refresh's per-org rate limit and the admission gate, which answers `503` with Retry. The widget shows an error with Retry, never a stored copy (fail closed).
- **Follow-up quality.** The model loses row values from earlier turns and has to re-query. That's watched in smoke §7-style walks. The fix is prompt wording, not stored rows.
- **Residuals.** Assistant prose, d3 titles/summaries, map categories/bounds, and staged-rows handles for 24h (webhook outputs, in-turn bulk) aren't cut off by a revocation. They're named in the Help entry's scope and in the PR.
- **Data loss.** The migration deletes stored rows. That's intentional, and the recipe survives. Rolling back the code doesn't restore rows; re-running a pipeline does. No production data depends on stored rows yet.
- **Rollback.** Revert the code. Blocks without rows still render through refresh on the old code (inline-or-handle-or-refresh), so a revert is safe after the migration.

## Files touched
- **New:** `apps/api/src/services/stored-result.util.ts`; its test; the migration `.sql` + journal + snapshot.
- **Edit (api):** `services/portal.service.ts`, `services/portal-viz-refresh.service.ts`, `services/portal-sql-handle.service.ts`, `routes/portal-sql-handle.router.ts`, `tools/display-entity-records.tool.ts`, `tools/technical-indicator.tool.ts`, `prompts/system.prompt.ts`, `constants/api-codes.constants.ts`, and the related tests.
- **Edit (core):** `contracts/data-table-widget.contract.ts`, `contracts/d3-widget.contract.ts`, `contracts/map-spec.contract.ts`, `content/faq.util.ts`, and their tests.
- **Edit (web):** `utils/use-widget-refresh.util.ts`, `modules/TableWidget/TableWidget.component.tsx`, `modules/D3Widget/D3Widget.component.tsx`, `modules/MapWidget/MapWidget.component.tsx`, and their tests.

## Next step
`docs/STORED_RESULTS_AFTER_REVOCATION.plan.md` slices this into about six TDD commits on this branch:
1. The `display_entity_records` pipeline.
2. Handle re-auth.
3. The stored-result util + persist/serve strip + history.
4. Refresh's access-loss code + transform re-run + the `technical_indicator` pipeline.
5. The web live-read states.
6. The migration + FAQ.
