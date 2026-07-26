# Durable re-executable visualization pipeline — Spec

The contract for #270. Makes a `d3` widget's data pipeline (SQL + station/org scope + optional transform) a durable property of the persisted block, and adds a reference-based, org-scoped refresh endpoint that re-executes it. Discovery: `docs/DURABLE_VIZ_PIPELINE.discovery.md`. Issue: [#270](https://github.com/EnterpriseBT/portal-ai/issues/270) (epic #267, branch `feat/durable-viz-pipeline` → `epic/d3-dashboard-widgets`).

## Key decisions (confirmed in discovery — flag for review)

1. **SQL-only refresh** (D1): re-run the persisted SELECT, feed fresh rows into the *persisted* D3 program. No re-codegen, no shape-diff machinery; a failed re-execution is a typed error state with the prior render intact.
2. **Pipeline on the block schema** (D2): a nested `pipeline` object on `D3BaseContentSchema` — not a side table, no migration (`blocks` is already `jsonb`).
3. **Reference-only endpoint** (D3): the client sends `{ messageId, blockIndex }`; the server loads the persisted block and re-executes *its* SQL. **The client never supplies SQL.**
4. **Same delivery shape** (D4): refresh returns what `visualize_d3` produces (handle envelope for large, inline rows for small); the widget swaps it into its existing render branch.
5. **Free, never metered/entitlement-gated, rate-limited only** (D5): refresh does no Opus codegen; it is the core product loop, guarded only by a per-org rate limit ([[feedback_monetization_is_capability_tiering]]).
6. **Freshness-gated auto-refresh** (D6): a widget auto-refreshes when its data is stale (handle expired *or* older than `VIZ_REFRESH_FRESHNESS_MS`), else renders rows in hand. #270 does mount-time auto-refresh for a single widget + exposes the hook; the viewport-observer + multi-widget render-load management is **#271**.

## Scope

### In scope
- Durable `pipeline` fields on the `d3` block content; `visualize_d3` populates them at mint.
- `POST /api/portal-sql/widget-refresh` — reference-based, org-scoped, rate-limited re-execution.
- Web: freshness-gated auto-refresh on mount + manual refresh affordance + expired-state auto-recovery; threading `{messageId, blockIndex}` to the widget.

### Out of scope
- Scheduled/automatic refresh; viewport-observer + lazy mount/teardown + cross-widget staggering (**#271**); backfilling pipelines onto pre-#270 `d3` blocks or superseded Vega blocks; pinned-widget dashboards (next epic); the data-table (`QueryResultDataBlock`) expired dead-end.

## Surface

### `packages/core` — block content contract

`contracts/d3-widget.contract.ts` — add a durable pipeline descriptor and hang it (optional) off the shared base:

```ts
/** The durable, re-executable data pipeline of a d3 widget (#270). Present on
 *  every block minted by visualize_d3 from #270 on; optional so pre-#270 blocks
 *  and mid-stream (unpersisted) blocks still parse and render (fail-safe). */
export const D3PipelineSchema = z.object({
  sql: z.string().min(1),
  stationId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Forward-looking (Q4): mirrors the api `TransformDescriptor` for
   *  aggregate-backed widgets. visualize_d3 never sets it today. Opaque at
   *  the core layer. */
  transform: z.record(z.string(), z.unknown()).optional(),
});
export type D3Pipeline = z.infer<typeof D3PipelineSchema>;
```

`D3BaseContentSchema` gains `pipeline: D3PipelineSchema.optional()`. Both variants (`D3InlineContentSchema`, `D3HandleContentSchema`) inherit it; the union is unchanged. Note the handle envelope's existing nullable `sql` is untouched (it serves the cursor tier); `pipeline.sql` is the authoritative durable copy.

### `packages/core` — refresh response contract + constant

`contracts/portal-sql.contract.ts` — the refresh response mirrors `SqlDelivery`:

```ts
export const WidgetRefreshResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), rows: z.array(z.record(z.string(), z.unknown())) }),
  z.object({ kind: z.literal("handle") }).and(QueryHandleEnvelopeFieldsSchema),
]);
export type WidgetRefreshResponse = z.infer<typeof WidgetRefreshResponseSchema>;
```

`constants/large-data-ops.constants.ts` — add:

```ts
/** A d3 widget auto-refreshes when its data is older than this (#270 D6).
 *  Short enough to read as "live", long enough that re-viewing costs no SQL. */
export const VIZ_REFRESH_FRESHNESS_MS = 3 * 60 * 1000; // 3 min (2–5 min band)
/** Per-org ceiling on widget refreshes per minute (#270 D5 abuse backstop). */
export const VIZ_REFRESH_RATE_PER_MIN = 120;
```

### `apps/api` — ApiCodes

`constants/api-codes.constants.ts` — add (with `ApiCodeMessages` entries):
- `VIZ_WIDGET_NOT_FOUND = "VIZ_WIDGET_NOT_FOUND"` (404) — no refreshable `d3` widget at `{messageId, blockIndex}` visible to the caller. **Covers missing message, out-of-range/ non-`d3` block, and cross-org — one code, so existence never leaks across orgs.**
- `VIZ_WIDGET_NOT_REFRESHABLE = "VIZ_WIDGET_NOT_REFRESHABLE"` (422) — the block exists but carries no durable `pipeline` (pre-#270 mint); the widget shows "re-run the prompt", not a refresh.
- `VIZ_REFRESH_RATE_LIMITED = "VIZ_REFRESH_RATE_LIMITED"` (429) — per-org rate limit tripped.

Re-execution failures reuse existing `PORTAL_SQL_FORBIDDEN` / `PORTAL_SQL_TIMEOUT`.

### `apps/api` — refresh service

New `services/portal-viz-refresh.service.ts`, `PortalVizRefreshService.refresh`:

```ts
static async refresh(params: {
  messageId: string;
  blockIndex: number;
  organizationId: string;   // from req.application.metadata — the caller's org
}): Promise<WidgetRefreshResponse>
```

Behavior, in order:
1. Load the message via `repo.portalMessages.findById(messageId)` (base `Repository.findById`); `blocks[blockIndex]` must exist and be `type === "d3"` → else `VIZ_WIDGET_NOT_FOUND` (404).
2. Parse the block's `pipeline` (`D3PipelineSchema`); absent → `VIZ_WIDGET_NOT_REFRESHABLE` (422).
3. **Scope check:** `pipeline.organizationId === params.organizationId` → else `VIZ_WIDGET_NOT_FOUND` (404, no leak).
4. Re-execute: `resolveSqlDelivery({ sql: pipeline.sql }, { stationId: pipeline.stationId, organizationId: params.organizationId })` (`tools/result-sink.ts`). Map its `SqlDelivery` to `WidgetRefreshResponse` (`inline` → `{kind:"inline", rows}` from the inline result's rows; `handle` → `{kind:"handle", ...envelope}`).
5. Errors from `runSqlQuery` (deny-list / timeout) propagate as their existing `ApiError`s.

No write-back to the persisted block (Q2). Idempotent + read-only, so concurrent refreshes are safe (no lock).

### `apps/api` — route

`routes/portal-sql-handle.router.ts` (same router mounted at `/portal-sql`, behind `jwtCheck`) — add:

```
POST /api/portal-sql/widget-refresh
  middleware: getApplicationMetadata
  body: { messageId: string, blockIndex: integer ≥ 0 }   // NO sql
  200: { success: true, payload: WidgetRefreshResponse }
  404 VIZ_WIDGET_NOT_FOUND · 422 VIZ_WIDGET_NOT_REFRESHABLE · 429 VIZ_REFRESH_RATE_LIMITED
```

`@openapi` JSDoc references registered components (`swagger.config.ts`): `WidgetRefreshRequest`, `WidgetRefreshResponse` (both `z.toJSONSchema` of the core schemas), plus the existing `ApiErrorResponse`. A per-org fixed-window rate limit (`VIZ_REFRESH_RATE_PER_MIN`) via the cost-gate's Redis limiter; over-limit → 429 `VIZ_REFRESH_RATE_LIMITED`. Infra (Redis) failure on the limiter **fails open** (the read-only query is already bounded).

### `apps/api` — mint change

`tools/visualize-d3.tool.ts` `execute`: both return branches gain
`pipeline: { sql, stationId, organizationId }` (`sql` from input, `stationId`/`organizationId` from the `build(...)` closure; no `transform`). The data-table fallback branches are unchanged (a failed codegen produces no widget to refresh).

### `apps/web` — SDK

`api/portal-sql.api.ts` — add `portalSql.widgetRefresh` as an imperative `useAuthMutation` (POST):

```ts
widgetRefresh: () =>
  useAuthMutation<WidgetRefreshResponse, { messageId: string; blockIndex: number }>({
    url: () => `/api/portal-sql/widget-refresh`,
    method: "POST",
    body: (vars) => vars,
  })
```

### `apps/web` — block-render threading

The reference must reach the widget. Extend the open renderer dispatch **additively**:
- `packages/core/src/ui/ContentBlockRenderer.tsx`: `BlockRenderer` gains an optional 2nd arg `ctx?: { blockRef?: { messageId: string; blockIndex: number } }`; `ContentBlockRenderer` gains an optional `blockRef` prop and forwards it. Existing renderers ignore the arg (no behavior change).
- `apps/web/src/components/PortalMessage.component.tsx`: when rendering a persisted assistant block via `ContentBlockRenderer`, pass `blockRef={{ messageId: message.id, blockIndex: i }}`. Streaming/unpersisted blocks pass none (already fresh → no refresh).

### `apps/web` — widget

`modules/D3Widget/D3Widget.component.tsx` (+ a `utils/use-widget-refresh.util.ts` hook):
- `D3WidgetProps` gains optional `blockRef?: { messageId: string; blockIndex: number }`.
- **Auto-refresh (D6):** on mount, when `blockRef` is present and the data is stale — the handle errored `READ_HANDLE_EXPIRED`, **or** no hydration within `VIZ_REFRESH_FRESHNESS_MS` (tracked per `blockRef` in a small session map so re-renders inside the window don't re-fetch) — call `widgetRefresh({messageId, blockIndex})` and swap the returned delivery in place.
- **Manual affordance (always present):** a refresh `IconButton` (`aria-label="Refresh chart"`) is a **guaranteed, first-class control** on every persisted widget (`blockRef` present) — shown regardless of auto-refresh, freshness, or handle state — and forces an immediate refresh when clicked. Paired with a lightweight **"Updated ⟨relative time⟩ ago"** caption (peace-of-mind freshness cue) that updates on each successful hydration; while a refresh is in flight the button shows a spinner and is disabled to prevent double-fire.
- **Expired-state auto-recovery:** the `READ_HANDLE_EXPIRED` fetch error no longer dead-ends — it triggers auto-refresh; only a *refresh* failure surfaces the typed `D3WidgetUI` error state (prior render kept until the swap succeeds).
- `VIZ_WIDGET_NOT_REFRESHABLE` → a distinct inline note ("This chart can't auto-refresh — re-run the prompt for live data.").

## Migration
None. `portal_messages.blocks` is already a `jsonb` column; the pipeline rides the block JSON, so there is no Drizzle/DB schema change and no drizzle-zod regeneration. (Pinned `d3` results in `portal_results` inherit the pipeline for free when a widget is pinned — sets up the dashboards epic; not exercised here.)

## Seed
None.

## TDD test plan

### `packages/core` — `npm run test:unit`
- `__tests__/contracts/d3-widget.contract.test.ts`: `pipeline` optional (block without it still parses); a valid `pipeline` validates; inline + handle both accept `pipeline`; `D3PipelineSchema` rejects empty `sql`/`stationId`/`organizationId`. (~5)
- `__tests__/contracts/portal-sql.contract.test.ts`: `WidgetRefreshResponseSchema` accepts inline + handle variants, rejects a mixed/kind-less shape. (~3)
- constant presence/shape assertion for `VIZ_REFRESH_FRESHNESS_MS` / `VIZ_REFRESH_RATE_PER_MIN` (fold into an existing constants test). (~1)

### `apps/api` — `npm run test:unit`
- `__tests__/services/portal-viz-refresh.service.test.ts`: loads block + re-executes (inline + handle mapping); missing message/block/non-d3 → `VIZ_WIDGET_NOT_FOUND`; cross-org → `VIZ_WIDGET_NOT_FOUND`; no pipeline → `VIZ_WIDGET_NOT_REFRESHABLE`; `resolveSqlDelivery` injected/mocked. (~7)
- `__tests__/tools/visualize-d3.tool.test.ts` (extend): mint populates `pipeline` on both inline and handle returns; data-table fallback carries none. (~2)

### `apps/api` — `npm run test:integration`
- `__tests__/__integration__/routes/portal-viz-refresh.integration.test.ts`: real route + metadata middleware — happy path returns a fresh delivery; cross-org member → 404; non-existent → 404; over rate limit → 429; body with `sql` is ignored (only `{messageId,blockIndex}` honored). (~5)

### `apps/web` — `npm run test:unit`
- `D3Widget.test.tsx` (drive `D3WidgetUI` + the container with a mocked `widgetRefresh`): auto-refresh fires on mount when stale/expired and swaps data; within the freshness window it does **not** refetch; the manual button is **always rendered** for a persisted widget and forces refresh on click; the button is disabled + shows a spinner while a refresh is in flight; the "Updated ⟨time⟩ ago" caption updates after a successful hydration; refresh failure shows the typed error with prior render intact; `VIZ_WIDGET_NOT_REFRESHABLE` shows the re-run note; no `blockRef` → no auto-refresh and no button. (~9)
- `ContentBlockRenderer.test.tsx` (extend): `blockRef` is forwarded to the renderer; omitting it is a no-op for existing renderers. (~2)
- `PortalMessage.test.tsx` (extend): a persisted `d3` block is rendered with `blockRef={{messageId, blockIndex}}`. (~1)

**Totals ≈ 35 cases** (unit + 5 integration). Migration: none, so no migration test.

## Acceptance criteria

- A `d3` widget whose handle has expired (>24h or flushed) re-renders with fresh data via refresh — no agent round-trip — including a session reopened days later.
- Refresh re-executes only the persisted pipeline: org-scoped, station-scoped, read-only; a member of another org gets a 4xx and never data; the endpoint ignores any client-supplied SQL.
- Refresh updates the rendered widget in place; a refresh failure surfaces a typed error state without corrupting the previous render.
- Newly minted `d3` blocks contain the durable `pipeline` (`D3PipelineSchema`-valid), independent of Redis state.
- A widget on screen hydrates automatically when stale (past `VIZ_REFRESH_FRESHNESS_MS` or expired) and does not re-run SQL when fresh.
- Every persisted widget shows a **manual refresh button at all times** (forces an immediate refresh on click) and an "Updated ⟨time⟩ ago" freshness cue; the button disables + shows a spinner while a refresh is in flight.
- Refresh is never charged and never tier-gated; a hammering client is bounded by the per-org rate limit (429), not by billing.

## Risks & rollback

- **Fail policy is split (matches discovery):** *fail-safe on render* (refresh/exec failure → typed error, prior render intact — never a corrupt chart), *fail-closed on scope* (org mismatch/missing metadata → 4xx, never data). The rate limiter itself **fails open** (a bounded read-only query is not worth denying on a Redis blip).
- **Auto-refresh fan-out** across many widgets is the real scale risk; the freshness gate + per-org rate limit bound it here, and #271 owns concurrent-hydration staggering. If #271 slips, the rate limit is still the hard ceiling.
- **Legacy d3 blocks** (pre-#270, from #269) have no pipeline → `VIZ_WIDGET_NOT_REFRESHABLE`, not a crash; acceptable (no production data; ephemeral QA).
- **Rollback:** the `pipeline` field is additive-optional and the endpoint is new — reverting the web wiring leaves old widgets rendering exactly as today (handle snapshot, expired dead-end). No data migration to unwind.

## Files touched

- **New:** `apps/api/src/services/portal-viz-refresh.service.ts`; `apps/api/src/__tests__/services/portal-viz-refresh.service.test.ts`; `apps/api/src/__tests__/__integration__/routes/portal-viz-refresh.integration.test.ts`; `apps/web/src/modules/D3Widget/utils/use-widget-refresh.util.ts`.
- **Edit (core):** `contracts/d3-widget.contract.ts`, `contracts/portal-sql.contract.ts`, `constants/large-data-ops.constants.ts`, `ui/ContentBlockRenderer.tsx` (+ their tests).
- **Edit (api):** `constants/api-codes.constants.ts`, `routes/portal-sql-handle.router.ts`, `config/swagger.config.ts`, `tools/visualize-d3.tool.ts` (+ tool test).
- **Edit (web):** `api/portal-sql.api.ts`, `api/keys.ts` (if a key is needed), `components/PortalMessage.component.tsx`, `modules/D3Widget/D3Widget.component.tsx` (+ tests).

## Next step

`/plan 270` on this branch. The plan will carve ~4 TDD slices: (1) core contract — `pipeline` fields + response schema + constants (+ mint populates them); (2) api — refresh service + route + rate limit + `@openapi`; (3) web — SDK + block-render `blockRef` threading; (4) web — `D3Widget` freshness-gated auto-refresh + manual affordance + expired auto-recovery. Each green-testable, each a commit on `feat/durable-viz-pipeline`, PRing into `epic/d3-dashboard-widgets`.
