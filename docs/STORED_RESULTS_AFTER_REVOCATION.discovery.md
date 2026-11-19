# Stored results after revocation — Discovery

**Issue:** [EnterpriseBT/portal-ai#1038](https://github.com/EnterpriseBT/portal-ai/issues/1038) · Bug · sizing `full`

**Why this exists.** A portal answer stays readable after the reader loses access to the curated view behind it. A member asks "List the rows in smoke_all", gets a table, and the owner then revokes the member's read on the view (or detaches it from the station). The member can still read every row: through the stored message on reload, labelled "Updated just now", and through `GET /api/portal-sql/handle/:id` for 24 hours. Live paths already refuse: the view's records route answers 404, and a new prompt is refused. Pinned results don't have the problem, because a pin stores a recipe and re-runs it on every read (#640).

The proposed direction is to stop persisting result rows at all. A stored answer keeps only what is needed to re-run it, and every render is a **live read** under the reader's current access. This is the change that makes revocation reach what was already shown, by making portal messages work the way pins already do.

## The current shape

### Where a result's rows come from

| Piece | Location | Behavior |
|---|---|---|
| Inline or handle | `apps/api/src/tools/result-sink.ts:74-95` (`resolveSqlDelivery`) | At most `INLINE_ROWS_THRESHOLD` = 100 rows go inline; more are staged as a Redis handle via `PortalSqlHandleService.produce` |
| Re-run recipe | `result-sink.ts:172-191` | the `{sql}` sink attaches `pipeline {sql, stationId, organizationId}` to both shapes (#349); `sql_query` uses it (`sql-query.tool.ts:181`) |
| **The failing tool** | `apps/api/src/tools/display-entity-records.tool.ts:64-81` | builds `SELECT … FROM "<entity>"`, always stages a handle, and returns **no `pipeline`** |
| Charts / maps | `visualize-d3.tool.ts:150-228`, `visualize-map.tool.ts:296-374` | build their own pipeline; d3's codegen fallback is a `data-table` with rows + pipeline |
| No recipe at all | `result-sink.ts:178-182` | the `value` / `rows` / `transform` sinks; derived outputs (`technical-indicator.tool.ts:74`, cluster, logistic regression) read handle metadata |
| Constants | `packages/core/src/constants/large-data-ops.constants.ts:22,56,79` | `READ_HANDLE_TTL_MS` 24h, `INLINE_ROWS_THRESHOLD` 100, `VIZ_REFRESH_FRESHNESS_MS` 3 min; `HANDLE_ROW_CAP` 100k |

### What a message stores

- **Two copies of every result.** `handleToolResult` (`apps/api/src/services/portal.service.ts:178-214`) saves the raw `tool-result` block (inline rows, or the envelope with `samplePeek` ≤ 10 rows and `sql`). It also saves the display block from `resolveDisplayBlock` (`:300-400`), which keeps `samplePeek` and `pipeline` (`:356-378`).
- **Untyped storage.** `portal_messages.blocks` is an untyped record array (`packages/core/src/models/portal-message.model.ts:21`). The typed shapes are `data-table` (`contracts/data-table-widget.contract.ts:20-66`) and `d3` (`contracts/d3-widget.contract.ts:32-87`), each a union of handle envelope | inline rows, with an optional `pipeline`.

### Handles

- **Storage.** `PortalSqlHandleService` stages `:meta` + `:batches:<n>` keys with a 24h TTL (`portal-sql-handle.service.ts:92-97, 437-480`). `StoredHandleMeta` (`:79-94`) holds station, org, user and an optional pin id, with no view set.
- **Router auth** (`routes/portal-sql-handle.router.ts:105-131`): the org match, then either `PinDefinerService.authorizeHandleRead` for a pin's handle or `_userId` equality. Nothing re-checks view access.
- **Other handle readers:** bulk/transform inputs (`tools/record-source.ts:100,173-179`), transform re-fold (`result-sink.ts:201-212`), webhooks (`webhook-handle.router.ts:112-131`, `webhook.tool.ts:343,378`), and `AnalyticsService.aggregateOverHandle`. All of these use a handle **inside** a turn, not from a stored message.

### The live-read machinery that already exists

| Piece | Location | What it does |
|---|---|---|
| Pin read | `portal-viz-refresh.service.ts:156-230` (`executePin`) | re-runs `pipeline.sql` through `resolveSqlDelivery` as the pin's definer |
| Pin handle re-auth | `pin-definer.service.ts:119-175` | each handle read re-runs `explainSqlQuery` as the definer; `STALE_REFERENCE` reads as unavailable |
| Widget refresh | `routes/portal-sql-handle.router.ts:200-268` → `portal-viz-refresh.service.ts:85-140` | `{messageId, blockIndex}` → re-runs the block's `pipeline` **as the caller**, rate-limited per org; no pipeline → `422 VIZ_WIDGET_NOT_REFRESHABLE` |
| View scope | `portal-sql.service.ts:1209-1235` (`resolveViewsForSession`), `:591-670` | the station's attached views ∩ the caller's `read curated_view` grants, emitted as temp-view DDL; no views fails closed |
| Scope hash (#643) | `portal-sql.service.ts:342-351` | sha256 of the sorted DDL, keying map-tile coverage |
| Map tiles | `portal-map-tile.service.ts:589-640` | message-block tiles already re-run the pipeline as the caller: a live read today |

### The web

- **Tables** (`apps/web/src/modules/TableWidget/TableWidget.component.tsx:222-245`): a refresh result wins; otherwise inline `rows`, else the stored handle. `D3Widget` (`:250-270`) and `MapWidget` (`:965-972`) follow the same order.
- **Refresh hook** (`apps/web/src/utils/use-widget-refresh.util.ts`):
  - It seeds the clock from `message.created` (`PortalMessage.component.tsx:253`).
  - It refreshes on mount when the result is older than 3 min (`:113-124`), so a fresh reload paints the stored copy under "Updated just now" (`packages/core/src/ui/WidgetFreshnessBar.tsx:63-120`).
  - On a 422 it keeps showing the stored copy.
- **Turn replay** (`portal.service.ts:996-1030`): reconnecting to a turn re-sends stored `tool-result` content.

### The model's history

- **Recent turns.** `reconstructModelMessages` (`portal.service.ts:~1150-1230`) replays the last `RECENT_TURNS_FULL_RESULTS` = 2 turns' results with up to `MAX_RESULT_ROWS` = 50 rows (`:1048-1055`).
- **Older turns** get `summarizeToolResult`: column names plus one sample row, with cells cut at 120 chars.
- **Consequence.** Stored rows feed the model as well as the screen.

## The design space

### Decision 1 — What a stored result holds

- **A. A recipe only.** The message keeps the `pipeline` plus display metadata (columns, title, chart program, map style) and a `rowCount`. No row values and no `samplePeek`.
- **B. Rows, gated.** Keep the rows, and record the view scope on the block and the handle. Before serving the stored copy, check that the reader's current scope still covers it.
- **C. Handles only.** Re-check the handle on read (the issue's suggestion), and accept inline rows in messages as already-delivered data.

| | A | B | C |
|---|---|---|---|
| Revocation reaches what was shown | yes, by construction | yes, if every path checks | handles only; inline stays |
| New state to keep in sync | none (pins' model) | scope on every block + handle | scope on handles |
| A missed path leaks | no (there is nothing to leak) | yes | yes |
| Cost per render | a query | a scope check | a scope check |
| Data at rest in `portal_messages` | none | all of it | inline rows |

**Lean: A.** Pins already prove the model, and with no stored rows a forgotten code path has nothing to serve. B and C each add a check that every reader has to remember.

### Decision 2 — How a render reads

- **A. The widget-refresh endpoint becomes the read.** A stored block always renders through `POST /api/portal-sql/widget-refresh` as the caller. That returns inline rows (≤ 100) or a fresh handle the caller owns; nothing paints until it answers.
- **B. A new `GET` result endpoint per block.** Same behavior, with a cleaner name and verb.

| | A | B |
|---|---|---|
| Reuses the rate limit, portal-access check and service | yes | through a refactor |
| Web change | the order in `TableWidget` / `D3Widget` / `MapWidget` | the same, plus a new SDK call |

**Lean: A.** The behavior is the same either way. Rename the route in the spec if a read wants a `GET`.

### Decision 3 — The handles a live read creates

A handle stays the paging cursor for results over 100 rows. It now lives as long as a page view, not a message.

- **A. Re-authorize each handle read** the way pin handles are: `explainSqlQuery` as the caller on every `GET /api/portal-sql/handle/:id`, reusing `PinDefinerService.authorizeHandleRead`'s shape. A refusal answers the same 404 as an expired handle.
- **B. Shorten the TTL** (for example to 15 min), and accept a revocation taking effect within that window.
- **C. Both.**

**Lean: A.** One `EXPLAIN` per page read is cheap, and it closes the window instead of narrowing it. Keep the 24h TTL for the in-turn readers (bulk, transform, analytics), which run inside one request.

### Decision 4 — Results with no recipe

The `value` / `rows` / `transform` sinks and derived analytics outputs (regression, clustering, indicators) have no SQL that reproduces them. Re-running the whole tool would re-incur cost-gated work (#169) on every render.

- **A. Store the input recipe, gate on it.** Keep the computed output (an aggregate, not source rows), plus the pipeline of the data it read. Render it only while `explainSqlQuery` of that input passes for the caller; otherwise show "no longer available".
- **B. Drop them on revocation.** No gate: treat derived outputs as already-delivered data.
- **C. Re-run the tool.**

**Lean: A.** A model fit or an aggregate can still disclose rows (a group-by over a few records), so it follows the same rule. The check is the same `EXPLAIN`, so it adds no cost-gate charge.

### Decision 5 — The model's history

With no stored rows, `reconstructModelMessages` has nothing to replay for the last two turns.

- **A. A summary only.** Persist `columns` + `rowCount` (and the SQL) in the tool result. The model sees what was asked and its shape, and re-queries when a follow-up needs values.
- **B. Re-run on history rebuild.** Re-execute recent pipelines as the caller each turn.
- **C. Keep model-only rows.** Store rows for the model but never serve them to the browser.

**Lean: A.** C reintroduces the stored copy this ticket removes. B multiplies query load per turn. The model loses row values across turns, which is a real follow-up-quality cost ("sum those"). The system prompt can say that results don't persist between turns and should be re-queried.

## Tradeoff comparison

| | D1 recipe only | D2 refresh is the read | D3 re-auth handles | D4 gate derived on input | D5 summary history |
|---|---|---|---|---|---|
| Closes the leak | yes | yes | yes | yes | yes |
| New persisted state | none | none | none | input pipeline | none |
| Added cost per render | one query | — | one EXPLAIN per page | one EXPLAIN | none |
| Spread to spec | yes | yes | yes | yes | yes |

## Recommendation

1. A persisted result block holds a `pipeline` and display metadata, never row values or a `samplePeek`; the raw `tool-result` block keeps `columns`, `rowCount` and the SQL only.
2. `display_entity_records` attaches a `pipeline` like `sql_query` does (its SQL is already built at `display-entity-records.tool.ts:72`).
3. Every stored widget renders by re-running its pipeline as the caller through widget-refresh, and paints nothing until that answers; a refusal or a missing pipeline renders a "no longer available" state, never a stored copy.
4. `GET /api/portal-sql/handle/:id` re-authorizes each read with `explainSqlQuery` as the caller and answers `404 READ_HANDLE_EXPIRED` when the caller can no longer read what it reads.
5. Derived outputs keep their computed value plus their input's pipeline, and render only while that input still passes `explainSqlQuery` for the caller.
6. Model history replays `columns` + `rowCount`, not rows; the system prompt says prior results aren't kept and to re-query.
7. "Updated …" shows the time of the live read that drew it; a stored block never shows a time it wasn't read at.
8. Existing messages: the API strips rows and `samplePeek` from stored blocks on serve, and a data migration removes them at rest.

## Open questions

1. **Does a live read of every widget on reload overload the shared pool?** A portal with ten tables runs ten queries per page view. Today the 3-min auto-refresh already does this for any portal older than three minutes, so the change is mostly for portals reopened soon after. Lean: reuse widget-refresh's per-org rate limit, and read a widget only when it scrolls into view.
2. **What does turn replay (`replayTurn`) send on reconnect?** Lean: the display block without rows, the same as a reload; the widget reads live.
3. **Is stripping rows at rest a destructive migration under `lint:migrations`?** It is a `jsonb` update, not DDL, but it deletes data. Lean: do it as a forward data migration with a `-- destructive-ok:` reason. There's no production data that depends on it yet.
4. **Exports and "Show data".** `VisualDataTable` pages the same handle. Lean: it gets the live handle from the read, and shows its existing "expired, Refresh" state on 404.
5. **Results an agent created inside a session that the user then can't read** (a view detached mid-session, #1036). Lean: same rule; the next render shows "no longer available".

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: no new shared state; a read authorizes at its own execution. The DB is the only arbiter, so there's no check-then-act gap beyond a single query.
- **Accuracy & auditability.** Lean: no ledger needed. What a user saw is reproducible from the stored recipe, at the cost of reproducing it with today's data. The grant change is the audit event.
- **Failure modes.** Lean: fail closed. If the read fails (DB down, admission timeout), show an error state with Retry, never the stored copy. That's the safety posture, and the UX cost is a retry.
- **Scale & unbounded growth.** Lean: shrinks storage (`portal_messages` stops holding rows) and trades it for queries per render. Those go through widget-refresh's rate limit and the #698 admission gate; lazy per-viewport reads bound the fan-out.
- **Multi-tenancy.** Lean: per-org rate limit on reads, as today; each read is scoped by the caller's own grants.
- **Contract stability.** Lean: the block contract gains "recipe-only". Pins, messages and map tiles converge on one read path, so a future row-level policy plugs into `resolveViewsForSession` once.
- **Data lifecycle.** Lean: no rows at rest means no retention policy to add for message data. Handles become page-scoped caches with the existing TTL.

## What this doesn't decide

- **Row-level freshness semantics** (a re-run shows today's data, not the data at answer time). That's accepted as the meaning of a live read and stated in Help, not engineered around.
- **Changing pins.** They already work this way.
- **Webhook-tool outputs** (org-hosted, #169's "who pays"). These are tools whose input isn't a station view. Whether they get the D4 gate is a spec question, since some read no view at all.
- **A "snapshot" feature** for users who want a frozen copy. That would be an explicit, separately authorized artifact, not a side effect of chat history.

## Next step

`docs/STORED_RESULTS_AFTER_REVOCATION.spec.md` would pin the recipe-only block contract, the handle re-auth and the unavailable state. `docs/STORED_RESULTS_AFTER_REVOCATION.plan.md` would slice it roughly as:
1. `display_entity_records` gets a pipeline.
2. Handle reads re-authorize.
3. Results stop persisting rows (API + history).
4. Widgets read live, with an unavailable state.
5. Derived-output gating.
6. The data migration and serve-time strip.
