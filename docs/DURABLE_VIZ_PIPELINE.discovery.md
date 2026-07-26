# Durable re-executable visualization pipeline — Discovery

**Issue:** [EnterpriseBT/portal-ai#270](https://github.com/EnterpriseBT/portal-ai/issues/270) (epic [#267](https://github.com/EnterpriseBT/portal-ai/issues/267); blocked-by #269, now merged into `epic/d3-dashboard-widgets`)

**Why this exists.** A `visualize_d3` widget's large data lives only behind a 24h-TTL Redis handle. When it expires — a session reopened the next day, or a flushed cache — the widget dead-ends on *"The chart's data has expired from cache. Re-run the original query to refresh."* The re-execution substrate already exists server-side (`PortalSqlHandleService` retains `sql` + station/org in handle meta; `streamHandle`/`aggregateOverHandle` re-run it), but nothing **durable** records the pipeline: the persisted block and any pin hold only the ephemeral handle pointer, and for *inline* d3 blocks not even the SQL is persisted. This child makes a `d3` widget's data pipeline — its originating SQL, station/org scope, and any transform — a durable, re-executable property of the persisted block, and adds an authenticated refresh endpoint that re-runs it. This is the "live dashboard widget" half of the epic's reframing.

## The current shape

### The `d3` block content contract (`packages/core`)

| Piece | Location | Note |
|---|---|---|
| `D3BaseContentSchema` | `contracts/d3-widget.contract.ts:20-25` | Shared base: `program`, optional `title`, optional `params`. **No pipeline fields.** |
| Inline variant | `contracts/d3-widget.contract.ts:31-34` | base + `rows`. **Carries no `sql`, no scope.** |
| Handle variant | `contracts/d3-widget.contract.ts:41-43` | base `.extend(QueryHandleEnvelopeFieldsSchema.shape)`; union tries handle first (`:52-56`). |
| Envelope fields | `contracts/portal-sql.contract.ts:23-55` | `queryHandle`, `rowCount`, `schema`, `sampled`, `truncated`, `samplePeek`, and `sql: z.string().nullable()`. |

So `sql` rides the block **only on the handle branch**; `stationId`/`organizationId`/`_transform` are nowhere in the block — they live only in Redis meta.

### How `visualize_d3` mints the block (`apps/api`)

`tools/visualize-d3.tool.ts`: the agent supplies intent (`sql`, `instruction`, `title` — `:19-28`), not a program. `execute` calls `resolveSqlDelivery({sql})` (`:101-104`), derives the result shape (`:105`), runs the Opus codegen sub-call `generateCode(...)` with `visualize-d3.prompt` (`:112-120`), validates via `visualize-d3.validate.ts` (`:133`), then returns `{ type:"d3", program, ...title, ...delivery.envelope }` (handle, `:135-142`) or `{ type:"d3", program, ...title, rows }` (inline, `:143`). **The program is already persisted in the block.** `stationId`/`organizationId` are passed to `resolveSqlDelivery` but not placed on the block.

### The query-handle service (`apps/api`)

`services/portal-sql-handle.service.ts`: `produce` (`:117-212`) runs the SELECT via `PortalSqlService.runSqlQuery` with caps lifted, stages batches in Redis, retains `sql` on the envelope (`:202`). `stage` (`:402-460`) writes `StoredHandleMeta` = envelope + `_stationId` + `_organizationId` + optional `_transform` (`:83-91`, `:413-418`) under `READ_HANDLE_TTL_MS`. Re-execution today: `streamHandle` (`:573-654`, keyset re-run of `meta.sql` under the same station/org) and `aggregateOverHandle` (`:518-538`, wraps `meta.sql` as a subquery). `getMeta`/`getSnapshot` throw `READ_HANDLE_EXPIRED` when meta is gone (`:473-479`, `:546-553`). Constants: `packages/core/src/constants/large-data-ops.constants.ts:22` (`READ_HANDLE_TTL_MS` = 24h), `:48` (`HANDLE_ROW_CAP` = 100k).

### Read-only SQL execution path (`apps/api`)

`services/portal-sql.service.ts`: `runSqlQuery` (`:338-427`) is the safe entry — `validatePortalSql` deny-list + multi-statement scan (`:348`), implicit LIMIT (`:351`), transaction with `statement_timeout` (`:368`), per-call temp views scoped by embedding the `organizationId` literal in each view's WHERE (`buildSessionViews`, `:138-332`, esp. `:212`), then `transaction_read_only = on` (`:383`) before executing. Station scope: `resolveEntityCapabilities(stationId)` filters readable entities (`:151-155`). **A refresh re-execution must go through this exact function** — the same funnel `produce` uses.

### API router + `@openapi` pattern (`apps/api`)

`routes/portal-sql-handle.router.ts`: `portalSqlHandleRouter` (snapshot GET `:79-106`, `getApplicationMetadata` middleware) mounted at `protected.router.ts:54` (`/portal-sql`, behind `jwtCheck`). `@openapi` JSDoc with swagger `$ref` components sit inline (`:35-78`). **The snapshot route reads a handle by ID only — no org/station re-scope.** A refresh endpoint must derive org/station from `req.application.metadata` (`metadata.middleware.ts:41-55`) and cross-check the persisted block's org. Relevant `ApiCode`s (`constants/api-codes.constants.ts`): `READ_HANDLE_EXPIRED` (`:515`), `PORTAL_SQL_FORBIDDEN` (`:340`), `PORTAL_SQL_TIMEOUT` (`:342`).

### Frontend widget + expired-handle handling (`apps/web`)

The `d3` renderer is registered at `modules/D3Widget/utils/register.util.tsx:12` (`registerBlockRenderer("d3", …)` → `D3Widget`). `D3Widget.component.tsx:128-135` picks handle vs inline and drives `useProgressiveHandleRows` (pages `sdk.portalSql.handleSnapshotPage`); fetch errors surface via `progressive.error` (`:161`, `:179`). SDK snapshot methods: `api/portal-sql.api.ts:20-58`, exported via `api/sdk.ts:21,51`. (The `QueryResultDataBlock` dead-end copy at `:109-111` is the **data-table** path — out of scope here; #270 is the viz widget.)

### Cost gate (`apps/api`)

`visualize_d3` is `costHint: "expensive"` (the Opus codegen is the cost). The gate wraps each tool's `execute` in `services/tools.service.ts:721-748` via `wrapWithCostGate`; `cost-gate.service.ts` makes `free` immune (`:147`). A refresh is **SQL-only (no codegen)** and sits **outside the tool registry** (a plain HTTP route), so it bypasses the tool cost gate entirely.

## The design space

### Decision 1 — Refresh execution model (the crux)

| | A — SQL-only, reuse program | B — full re-codegen | C — SQL-only + shape guard |
|---|---|---|---|
| Cost | free (like `sql_query`) | expensive (Opus every refresh) | free |
| Handles column drift | no (program may misrender) | yes | surfaces typed error, no misrender |
| Complexity | lowest | high (re-runs the whole tool) | low |

**Decided: A (SQL-only), confirmed.** The whole point is to view *the same chart* with live data hydrating it — re-run the persisted SELECT, feed fresh rows into the persisted D3 program, re-render. **Drift is an explicit non-goal:** if the user wants a differently-shaped chart they issue a new prompt (a fresh `visualize_d3` call), not a refresh. We build **no** shape-diff machinery; a re-execution that fails (e.g. a projected column was removed from the entity, so `runSqlQuery` errors) simply surfaces as a typed error state with the prior render intact. Re-codegen (B) is **not** part of refresh — it's the ordinary agent round-trip, and refresh stays free precisely because it never calls Opus.

### Decision 2 — Where the durable pipeline lives

| | A — on `D3BaseContentSchema` | B — side table |
|---|---|---|
| Survives Redis loss | yes (in the persisted block) | yes |
| New migration/table | no | yes (`portal_widget_pipelines`) |
| Covers inline + handle variants | yes (base is shared) | yes |
| Couples to message lifecycle | yes (dies with the message — desired) | needs its own cascade |

**Decided (confirmed): A.** Add `sql`, `stationId`, `organizationId`, and an optional `transform` descriptor to `D3BaseContentSchema` so **both** variants carry the pipeline (today inline blocks carry no SQL at all). Self-contained in the persisted block, no new table, lifecycle already tied to the message. `sql` graduates from envelope-only to a first-class pipeline field. (If the dashboards epic later needs server-side cross-widget enumeration, a side table can be added and backfilled from the blocks — no data loss.)

### Decision 3 — Refresh endpoint shape + input trust boundary

| | A — client sends SQL | B — client sends a block reference |
|---|---|---|
| Attack surface | **arbitrary read-SQL exfiltration** within the caller's org | none beyond what was already minted |
| Server work | validate + run client SQL | load persisted block, extract its pipeline, run |
| Ties refresh to a real widget | no | yes |

**Decided: B — reference-only, confirmed.** The endpoint takes `{ messageId, blockIndex }` (the same identity the pin path uses), the server **loads the persisted block**, reads its durable pipeline, cross-checks the block's `organizationId` against `req.application.metadata`, and re-executes via `PortalSqlService.runSqlQuery`. **The client never supplies SQL** — keeping the infiltration surface as small as possible is the explicit goal. This is a conscious exception to "accept values from the payload": the SQL is a *server-held* property of the widget, never caller input; a client-SQL endpoint would be a raw read-SQL exfiltration surface scoped only by org.

### Decision 4 — What refresh returns + in-place re-render

**Decided (confirmed): same delivery shape.** Refresh returns exactly what `visualize_d3` produces (a fresh handle envelope, or inline rows, per the same size thresholds). The `D3Widget` already reads `handleContent.queryHandle` and branches handle-vs-inline; the returned fresh delivery swaps in and the persisted program re-renders in place — zero new rendering path, identical behavior to first mint, and a result that shrinks below the threshold cleanly switches handle→inline. On failure, the widget shows a typed error state and keeps the prior render (PRD requirement).

### Decision 5 — Refresh cost/limits

**Decided (confirmed): free, never metered, never entitlement-gated — rate-limited only for abuse.** A refresh does no Opus codegen and no third-party-paid work. Beyond cost-model consistency (`sql_query` is free), this is a **product principle**: saving widgets, arranging them into a live-data dashboard, and refreshing them (auto or manual) is the app's core loop and is **never** charged per call nor gated behind a tier entitlement. Monetization is **capability tiering** — toolpack availability and custom webhook integrations (`project_tier_two_axes`), not the viz/refresh loop. This also closes the loop with D6: auto-refresh on visibility is only sane because refresh is free (you can never silently drain credits for *viewing* a dashboard). The only guard is a lightweight per-org rate limit (reuse the cost-gate's Redis fixed-window limiter) as an abuse backstop; the read-only transaction + `statement_timeout` + implicit LIMIT already bound a single call. Genuine DB-load hotspots are handled by per-org concurrency caps in #271's render-load management, not by billing.

### Decision 6 — Auto-refresh freshness gate

Auto-refresh-on-visibility (Open Q3) must not re-run SQL every time a widget scrolls into view — on a dashboard of N widgets that is an N-way SQL fan-out on every load. The widget tracks when its rows were last hydrated and only auto-refreshes when **stale**.

| | A — always refresh on view | B — freshness-gated | C — only when handle expired |
|---|---|---|---|
| Live-ness | freshest | fresh within window | can show 24h-old data until expiry |
| SQL fan-out | worst (every scroll) | bounded by window | lowest |
| UX on reopen | always current | current within window | stale-but-present until expiry |

**Lean: B — freshness-gated.** Auto-refresh fires when the handle is **expired** *or* the last hydration is older than a **freshness threshold** (a new constant alongside `READ_HANDLE_TTL_MS`; a few minutes is a sane default, tunable). Within the window, render the rows already in hand. This gives "live data when you look at it" without hammering, and the per-org rate limit (D5) is the backstop. The exact threshold value is an open question (Q5).

## Tradeoff comparison

|  | D1: SQL-only | D2: on block schema | D3: reference-only | D4: same delivery shape | D5: free + rate-limit | D6: freshness gate |
|---|---|---|---|---|---|---|
| Spread to spec | Yes (endpoint + error states) | Yes (core schema + drizzle-zod, no DB migration) | Yes (endpoint contract + scope check) | Yes (response schema) | Yes (rate-limit rule) | Yes (freshness constant + widget staleness state) |

## Recommendation

1. Add `sql`, `stationId`, `organizationId`, and optional `transform` to `D3BaseContentSchema`; `visualize_d3` populates them on both inline and handle blocks at mint time.
2. Add an authenticated, org/station-scoped `POST /api/portal-sql/widget-refresh` (name TBD in spec) taking `{ messageId, blockIndex }`; the server loads the persisted block, cross-checks its org against the request, and re-executes the persisted SQL via `PortalSqlService.runSqlQuery`, returning a fresh delivery envelope/rows.
3. Reuse the persisted D3 program with fresh rows — no re-codegen, no shape-diff machinery. Result-shape drift is a non-goal (the user re-prompts for a new chart); a re-execution failure surfaces as a typed error state with the prior render intact.
4. Widget refresh in `D3Widget`: **freshness-gated auto-refresh** on mount/visibility (re-hydrate live data when the widget is viewable, gated so it doesn't re-run SQL on every scroll) plus a **manual refresh affordance**; the expired-handle state auto-recovers instead of dead-ending; re-render in place from the returned envelope. The viewport-observer + multi-widget render-load management is #271; #270 exposes refresh as the hook it drives.
5. Refresh is `free` — never metered, never entitlement-gated (core product loop; monetization is capability tiering, not the viz loop) — guarded only by a per-org rate limit; org isolation enforced server-side (cross-org → 4xx).

## Open questions

1. **Block reference identity. — Decided (confirmed): `{ messageId, blockIndex }`** (the pin path's identity); reuse it, no new id to mint or migrate. Safe because persisted messages are immutable — block indices don't shift.
2. **Write-back the fresh handle to the persisted block? — Decided (confirmed): no.** With freshness-gated auto-refresh (D6) the widget re-hydrates itself on view; write-back adds a message mutation on every refresh for marginal gain and fights the "live data" model. The durable pipeline, not the handle pointer, is the source of truth; a stale persisted handle simply doesn't matter.
3. **Auto-refresh vs. explicit button? — Decided: auto-refresh, freshness-gated.** Manually clicking every widget (in chat, and especially on the coming widget dashboard) is tedious; a widget should hydrate itself with live data when it becomes viewable. So the primary trigger is **automatic** — on mount / when the widget is on screen — with a **manual refresh affordance retained** as a fallback and for force-refresh. To stop this re-running SQL on every scroll, auto-refresh is gated by a **freshness window** (Decision 6): refresh only when the handle is expired *or* the last hydration is older than the freshness threshold; otherwise render the rows already in hand. **Scope line:** #270 builds the freshness-gated auto-refresh for a *single* widget (on mount/visibility) plus the endpoint; the **viewport-observer + lazy mount/teardown + render-load management across many widgets** is #271's job — #270 exposes refresh as the hook #271's lifecycle drives.
4. **`transform` descriptor presence. — Decided (confirmed): include it as an optional pipeline field.** `visualize_d3` has no aggregate transform today (that's the bulk-aggregate path), so it's usually absent; reserving it now gives contract stability for aggregate-backed widgets and the dashboards epic without a later schema change. Refresh applies it only when present.
5. **Freshness-window value (D6). — Decided (confirmed): a few minutes (2–5 min) as a tunable constant** beside `READ_HANDLE_TTL_MS`; short enough to read as "live", long enough that scrolling past a widget repeatedly costs no SQL. Spec pins the exact number within that range.

## Enterprise-scale considerations

- **Concurrency & correctness.** Concurrent refreshes of the same widget are read-only and idempotent — each `runSqlQuery` is independent, no check-then-act, no shared mutable state. Safe with no locking. **Lean: no lock; document idempotency.**
- **Accuracy & auditability.** The durable pipeline on the block *is* the record-of-truth for how the widget's data is produced; refresh is a pure read-only re-execution. No ledger needed. **Lean: block-embedded pipeline is the durable record.**
- **Failure modes.** Fail-safe on data: SQL error / removed column / expired entity / Redis-down → typed error state, previous render intact (never corrupt). Fail-closed on auth: org mismatch or missing metadata → 4xx, never data. **Lean: split — fail-safe on render, fail-closed on scope.**
- **Scale & unbounded growth.** A single refresh re-runs a bounded SELECT (implicit LIMIT + `HANDLE_ROW_CAP` 100k). The real fan-out risk is auto-refresh across **many** widgets (a dashboard load, or a long chat scrolled through): naively that's an N-way SQL burst. The **freshness gate (D6)** collapses repeat views to zero SQL within the window, the **per-org rate limit (D5)** is the hard backstop, and the **viewport-driven staggering / lazy mount** that bounds concurrent hydration is **#271's** render-load management. **Lean: freshness gate + rate limit here; concurrent-hydration staggering in #271.**
- **Multi-tenancy.** Org/station scope enforced server-side from `req.application.metadata`, cross-checked against the persisted block's `organizationId`; the read-only temp views already embed the org literal. Cross-org → 4xx. **Lean: server-derived scope, never client-asserted.**
- **Contract stability.** Pipeline fields on the block schema are shaped so the dashboards epic (pinned widgets, scheduled refresh) plugs in without re-plumbing — `transform` is the forward-looking hook. **Lean: additive, optional-forward fields.**
- **Data lifecycle.** The durable pipeline lives as long as the message/block (no TTL); the Redis handle stays a 24h ephemeral cache regenerated from the pipeline on refresh. This inversion — durable pipeline, ephemeral handle — is the ticket's core. **Lean: pipeline = message-lifetime, handle = 24h cache.**

## What this doesn't decide

- **Scheduled/automatic refresh** — explicitly out of scope (epic: on-demand only).
- **Backfilling pipelines onto pre-existing Vega blocks** — superseded by #272; their SQL remains readable in persisted tool-call blocks.
- **Pinned-widget dashboards** — the next epic; this child is what makes them possible.
- **Viewport-observer, lazy mount/teardown, and render-load management across many widgets** — #271. #270 delivers freshness-gated auto-refresh for a single widget and exposes it as the hook #271's lifecycle drives; the staggering/concurrency control for a full dashboard is #271's.
- **The data-table (`QueryResultDataBlock`) expired dead-end** — same class of problem but a different (non-viz) surface; not in this ticket.

## Next step

Write `docs/DURABLE_VIZ_PIPELINE.spec.md` (contract: the `D3BaseContentSchema` field additions + drizzle-zod round-trip, the freshness-window constant, the refresh endpoint method/path/`@openapi`/scope-check/response shape and new `ApiCode`s, the `visualize_d3` mint changes, the widget refresh + staleness props) and `.plan.md`. The plan will likely slice as: (1) core schema + freshness constant + mint the durable fields; (2) the refresh service + endpoint (server-side pipeline load + scope check + re-execute, free + rate-limited); (3) the web widget freshness-gated auto-refresh + manual affordance + expired-state auto-recovery; each green-testable on `feat/durable-viz-pipeline`, PRing into `epic/d3-dashboard-widgets`.
