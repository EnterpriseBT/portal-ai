# Pinning refactor: pin any durable block, live data in the detail view — Spec

**Issue:** [EnterpriseBT/portal-ai#312](https://github.com/EnterpriseBT/portal-ai/issues/312) · **Discovery:** `docs/PINNING_REFACTOR.discovery.md`

Pins become durable, self-contained, re-executable artifacts: the pinnable enum widens to all durable block kinds (`text`, `data-table`, `d3`, `geo`), the pin route **materializes** a validated snapshot into the row instead of copying verbatim, a pin-addressed refresh route re-executes the stored pipeline with **persist-back**, and the detail view reuses the chat widgets' freshness/refresh UX through a discriminated `blockRef`.

## Key decisions (flag for review)

1. **Materialize + persist-back** (discovery D1, Open Q1 confirmed): the pin route resolves live data into the row at pin time; each successful refresh UPDATEs the stored snapshot. The row is the record of truth and the offline fallback.
2. **Pin-addressed refresh** (D2): `POST /api/portal-results/:id/refresh`, scoped on the row's own `organizationId`, sharing the `viz-refresh:<orgId>` rate window; `PortalVizRefreshService` splits into a pipeline-execution core + two addressers.
3. **One-migration widening** (D3): `PortalResultTypeSchema` gains `d3` **and** `geo` now; `geo` pins are impossible until #84 emits geo blocks, and its content schema arrives with #84 via the registry (Open Q4) — an unregistered type gets the typed rejection.
4. **Snapshot bound** (Open Q2): new `PIN_SNAPSHOT_ROW_CAP = TABLE_DISPLAY_ROW_LIMIT` (5 000) — the stored snapshot cap, with `truncated`/`rowCount` recorded so the UI can say "showing first N".
5. **Data-table pins become refreshable when possible**: handle-backed tables derive a `pipeline` from the envelope's retained `sql` (null for `produceFromRows` handles → snapshot-only pin). Inline tables carry no SQL and stay static.
6. **`useWidgetRefresh` is promoted** from `modules/D3Widget/utils/` to `apps/web/src/utils/` — two consumers now (D3Widget internals + the pinned-detail data-table path), per the module-promotion rule. Clean cut, no re-export shim.
7. Scope-adds confirmed: SDK-bypass unpin cleanup (Dashboard + list view) rides along; text pins are unchanged beyond validation (Open Q3).

## Scope

### In scope

1. Core: widened `PortalResultTypeSchema` + `snapshotUpdatedAt` field; new `pinned-result.contract.ts` (per-type stored-content schemas + registry).
2. DB: enum migration + `snapshot_updated_at` column; drizzle-zod + type-checks refresh.
3. API: pin-route materialization (new `portal-result-pin.service.ts`), pin refresh route, `PortalVizRefreshService` split, `PORTAL_RESULT_CONTENT_EXPIRED` code, OpenAPI components.
4. Web: discriminated `blockRef`, promoted `useWidgetRefresh`, SDK `portalResults.refresh`, pin-affordance fix in `PortalMessage`, detail-view live data + hardening, list icons, SDK-bypass cleanup.
5. Flipping the GATE_VIZ_PINNING regression assertions; doc-sync (`GATE_VIZ_PINNING.md` superseded note, glossary/FAQ pin copy).

### Out of scope

- Dashboard arrangement/layout; sharing/export of pins; pinning transient kinds (`bulk-job-progress` — #92); the geo widget itself (#84 — only the enum slot + registry seam land here); refresh parameterization (pipelines re-execute verbatim).

## Surface

### `packages/core/src/models/portal-result.model.ts`

```ts
export const PortalResultTypeSchema = z.enum(["text", "data-table", "d3", "geo"]);

export const PortalResultSchema = CoreSchema.extend({
  // …existing fields unchanged…
  /** Epoch ms of the last successful snapshot write (pin time, then each
   *  persist-back). Seeds the web freshness clock. Null on legacy rows. */
  snapshotUpdatedAt: z.number().int().nullable(),
});
```

`PINNABLE_BLOCK_TYPES` (`portal.contract.ts:178`) stays derived — no change to its definition; its membership widens automatically. `PortalBlockTypeSchema` is **not** touched (the `geo` message-block type is #84's).

### `packages/core/src/contracts/pinned-result.contract.ts` (new)

```ts
/** Stored content of a pinned data-table (post-materialization). */
export const PinnedDataTableContentSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),        // ≤ PIN_SNAPSHOT_ROW_CAP
  rowCount: z.number().int().nonnegative().optional(),      // source total (lower bound when truncated)
  truncated: z.boolean().optional(),
  pipeline: D3PipelineSchema.optional(),                    // present ⇢ refreshable
});

/** Stored content of a pinned d3 widget: always the inline shape. */
export const PinnedD3ContentSchema = D3InlineContentSchema; // { program, title?, params?, pipeline?, rows }

/** Per-type stored-content validators. #84 adds the `geo` entry. A pin
 *  attempt for a type without an entry is rejected with
 *  PORTAL_RESULT_TYPE_NOT_PINNABLE — same code as a non-durable type. */
export const PINNED_CONTENT_SCHEMAS: Partial<Record<PortalResultType, z.ZodType>> = {
  text: z.string().min(1),
  "data-table": PinnedDataTableContentSchema,
  d3: PinnedD3ContentSchema,
};

/** Refresh response — identical union to the widget-refresh endpoint. */
export const PinRefreshResponseSchema = WidgetRefreshResponseSchema;
```

`D3PipelineSchema` keeps its name and home (`d3-widget.contract.ts:27`) — it is already the generic `{ sql, stationId, organizationId, transform? }` descriptor; renaming it would churn the #270 surface for cosmetics.

### `packages/core/src/constants/large-data-ops.constants.ts`

```ts
/** Max rows persisted into a pinned result's stored snapshot (#312). */
export const PIN_SNAPSHOT_ROW_CAP = TABLE_DISPLAY_ROW_LIMIT; // 5_000
```

### DB: `apps/api/src/db/schema/portal-results.table.ts`

- `portalResultTypeEnum` gains `"d3"`, `"geo"` (pgEnum `portal_result_type`).
- New column: `snapshotUpdatedAt` — nullable, same epoch-ms storage type as `baseColumns.created`, mapped `snapshot_updated_at`.
- `apps/api/src/db/schema/zod.ts` + `type-checks.ts:603-609` re-derive; build fails if either side drifts.

### `apps/api/src/constants/api-codes.constants.ts`

- New: `PORTAL_RESULT_CONTENT_EXPIRED = "PORTAL_RESULT_CONTENT_EXPIRED"` (422) — pin attempt where the block's handle has expired **and** no pipeline exists to re-materialize from. Message text registered alongside the enum as usual.

### Pin route materialization — `apps/api/src/routes/portal-results.router.ts` + `apps/api/src/services/portal-result-pin.service.ts` (new)

`POST /api/portal-results` keeps its request contract (`PinResultBodySchema`, unchanged) and flow through the type check at `:162`. After it, the verbatim `content` copy (`:174`) is replaced by:

```ts
// portal-result-pin.service.ts
export interface MaterializedPin {
  content: Record<string, unknown> | string;
  snapshotUpdatedAt: number;
}
export class PortalResultPinService {
  /** Validates the block content against PINNED_CONTENT_SCHEMAS[type] and
   *  resolves it to a self-contained snapshot (≤ PIN_SNAPSHOT_ROW_CAP rows). */
  static async materialize(
    type: PortalResultType,
    blockContent: unknown,
    scope: { stationId: string; organizationId: string },
    deps?: MaterializeDeps                     // DI seam: handle reader + resolveSqlDelivery
  ): Promise<MaterializedPin>;
}
```

Behavior by type:

- **`text`** — validate `z.string().min(1)`; pass through.
- **`data-table` / `d3`, inline rows present** — validate; store as-is (rows already ≤ inline threshold). For handle-backed **data-table**, derive `pipeline = { sql: envelope.sql, stationId, organizationId }` when `envelope.sql !== null`.
- **Handle-backed (queryHandle in content)** — read up to `PIN_SNAPSHOT_ROW_CAP` rows from the handle store; store the inline shape + `rowCount`/`truncated` + `pipeline`. If the handle is **expired**: with a pipeline, re-execute it (same `resolveSqlDelivery` funnel) to materialize; without one, throw 422 `PORTAL_RESULT_CONTENT_EXPIRED`.
- **No schema registered for `type`** — throw the existing 400 `PORTAL_RESULT_TYPE_NOT_PINNABLE`.

The route persists `content` and `snapshotUpdatedAt` from the returned `MaterializedPin`. The `@openapi` block's request/response `$ref`s update accordingly (components in `src/config/swagger.config.ts`).

### Refresh route + service split

**`apps/api/src/services/portal-viz-refresh.service.ts`** — refactor into:

```ts
export class PortalVizRefreshService {
  /** Shared core: parse + execute a pipeline read-only, return the delivery union. */
  private static async executePipeline(pipeline: D3Pipeline, organizationId: string, deps): Promise<WidgetRefreshResponse>;
  /** Existing message-block addresser — behavior byte-identical to today. */
  static async refresh(params: VizRefreshParams, deps?): Promise<WidgetRefreshResponse>;
  /** Pin addresser (#312): loads the portal_results row, org-gates (cross-org
   *  → 404 PORTAL_RESULT_NOT_FOUND, no existence leak), parses content.pipeline
   *  (absent → 422 VIZ_WIDGET_NOT_REFRESHABLE), executes, then PERSISTS BACK:
   *  rows (≤ PIN_SNAPSHOT_ROW_CAP, hydrated from the handle when the delivery
   *  is a handle), rowCount, truncated, snapshotUpdatedAt = now. Persist-back
   *  failure is logged and does NOT fail the response (the live delivery
   *  already succeeded; the stale snapshot self-heals next refresh). */
  static async refreshPinnedResult(params: { portalResultId: string; organizationId: string }, deps?): Promise<WidgetRefreshResponse>;
}
```

**`portal-results.router.ts`** — new route:

- `POST /api/portal-results/:id/refresh` (`getApplicationMetadata`) — same rate-limit block as `portal-sql-handle.router.ts:188-205` verbatim (`viz-refresh:<orgId>` window, `VIZ_REFRESH_RATE_PER_MIN`, 429 `VIZ_REFRESH_RATE_LIMITED`, fail-open on Redis errors), then `PortalVizRefreshService.refreshPinnedResult`. Responses: 200 `WidgetRefreshResponse` · 404 · 422 · 429 — `@openapi` block reuses the registered `WidgetRefreshResponse` component.

### Web — discriminated `blockRef`

**`packages/core/src/ui/ContentBlockRenderer.tsx:26-32`:**

```ts
export type BlockRef =
  | { kind: "message"; messageId: string; blockIndex: number }
  | { kind: "pin"; portalResultId: string };
export interface BlockRenderContext {
  blockRef?: BlockRef;
  dataUpdatedAt?: number;
}
```

Clean cut — all current producers (`PortalMessage.component.tsx:236-239`) add `kind: "message"`; no legacy shape accepted.

**`apps/web/src/utils/use-widget-refresh.util.ts`** (moved from `modules/D3Widget/utils/`): `WidgetRef` becomes `BlockRef`; the module-level freshness map keys by `message:<id>:<idx>` / `pin:<id>`; `refresh()` dispatches to `sdk.portalSql.widgetRefresh({ messageId, blockIndex })` or `sdk.portalResults.refresh({ id })` by `kind`. All other semantics (single auto-fire per stale mount, `VIZ_REFRESH_FRESHNESS_MS`, keep-last-data on failure, `notRefreshable` on 422) unchanged. D3Widget imports move to the new path.

**`apps/web/src/api/portal-results.api.ts`** — new endpoint (id-in-variables, like `remove`):

```ts
refresh: () =>
  useAuthMutation<WidgetRefreshResponse, { id: string }>({
    url: ({ id }) => `/api/portal-results/${encodeURIComponent(id)}/refresh`,
    body: () => undefined,           // POST, no body
  }),
```

`onSuccess` in the consuming container invalidates `queryKeys.portalResults.get(id)` (persist-back changed the row).

### Web — surfaces

- **`PortalMessage.component.tsx`** — the `shouldRenderViaWeb` short-circuit (`:203-211`) no longer bypasses the pin affordance: the pin/unpin `IconButton` renders for every `PINNABLE_BLOCK_TYPES` member with non-empty content, including handle-backed tables and `d3` blocks. Web-rendered blocks keep their existing render path.
- **`PinnedResultDetail.view.tsx`** — passes `blockRef={{ kind: "pin", portalResultId }}` + `dataUpdatedAt={snapshotUpdatedAt ?? created}` into `ContentBlockRenderer` (d3 widgets self-refresh via context). For `data-table` pins with `content.pipeline`, the container uses the promoted `useWidgetRefresh` and renders fresh rows over stored rows, with the manual refresh control and a "showing first N — refresh for live data" note when `truncated`. Failure keeps stored rows + a notice naming the failure. Hardening: type chip derives from a `type → label` map (no ternary); "Open Source Portal" hidden with a tombstone note when `portalId` is null; legacy content carrying `queryHandle` with no `rows` renders an explicit "data expired" notice instead of an empty table.
- **`PinnedResultsList.component.tsx`** — icon map gains `d3`/`geo` entries.
- **SDK-bypass cleanup** — `Dashboard.view.tsx:180-193` and `PinnedResultsListView.view.tsx:66-76` route through `sdk.portalResults.remove()` with the house toast-on-error pattern; raw `fetchWithAuth` calls deleted.

## Migration

`npm run db:generate -- --name widen-portal-result-type-live-pins` — adds `d3`/`geo` to `portal_result_type` (enum-alter precedents: `drizzle/0027`, `0028`, `0073`) and `snapshot_updated_at` (nullable). No backfill: legacy rows keep `snapshotUpdatedAt = null` (detail view falls back to `created` for the freshness seed). No seed changes.

## TDD test plan

Run per package: `npm run test:unit` (and `npm run test:integration` in `apps/api`). Never raw jest.

### `packages/core` — `src/__tests__/contracts/pinned-result.contract.test.ts` (new), `portal.contract.test.ts`, `models/portal-result.model.test.ts` (extend)

- enum widened; `PINNABLE_BLOCK_TYPES` contains `d3`/`geo`; GATE_VIZ_PINNING's derivation pin flipped deliberately.
- `PinnedDataTableContentSchema` accepts snapshot ± pipeline; rejects rows-less content; `PINNED_CONTENT_SCHEMAS` has no `geo` entry (yet). `PinRefreshResponseSchema` ≡ `WidgetRefreshResponseSchema`. ≈ 8 cases.

### `apps/api` unit — `src/__tests__/services/portal-result-pin.service.test.ts` (new), `portal-viz-refresh.service.test.ts` (extend)

- materialize: text pass-through; inline table/d3 stored as-is; handle-backed hydrates ≤ cap with `truncated`; pipeline derived from envelope `sql` (and not from `sql: null`); expired handle + pipeline → re-execute; expired + no pipeline → `PORTAL_RESULT_CONTENT_EXPIRED`; unregistered type → `PORTAL_RESULT_TYPE_NOT_PINNABLE`. ≈ 9 cases.
- `refreshPinnedResult`: happy inline + handle; cross-org → 404; no pipeline → 422; persist-back writes rows/`snapshotUpdatedAt`; persist-back failure still returns 200; message-block `refresh` regression-pinned unchanged. ≈ 7 cases.

### `apps/api` integration — `src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` (extend)

- pin a `d3` block end-to-end (was the GATE_VIZ_PINNING rejection case — flipped); pin handle-backed table; `POST /:id/refresh` happy/404/422/429 path; `bulk-job-progress` still rejected. ≈ 6 cases.

### `apps/web` — `src/__tests__/{PortalMessage,PinnedResultDetail,PinnedResultsList,PinnedResultsListView}.test.tsx`, `src/utils/__tests__` or module tests for the moved hook (new `apps/web/src/__tests__/use-widget-refresh.util.test.ts`)

- pin affordance on d3 + handle-backed table blocks; detail view: pin-ref threading, auto-refresh when stale, manual refresh, failure keeps stored rows + notice, truncated note, tombstoned portal link, legacy expired-data notice, type-chip map; hook: key discrimination, pin-branch dispatch to `sdk.portalResults.refresh`, invalidation of `portalResults.get(id)`; SDK-cleanup: both views unpin via SDK (spy) with toast on error. ≈ 14 cases.

**Totals ≈ 44 cases.** Migration itself needs no dedicated test — the dual-schema type-checks + integration suite cover it.

## Acceptance criteria

- A `d3` block shows the pin affordance; pinning succeeds; the widget appears in pinned results and renders interactively in the detail view.
- A handle-backed data-table is pinnable; its pin survives handle expiry (stored snapshot) and refreshes to live data via its derived pipeline.
- Opening a stale pinned viz auto-refreshes once (freshness window) with a visible status; manual refresh always available; refreshes 429 past the per-org window.
- Refresh failure (deleted source, SQL error) leaves last-known rows + a notice; a pipeline-less pin shows no refresh affordance; legacy snapshot-less pins show an explicit expired-data notice.
- `bulk-job-progress` pin attempts return `PORTAL_RESULT_TYPE_NOT_PINNABLE`; geo pin attempts are impossible pre-#84 and admitted post-#84 with zero pinning-side change.
- Pre-existing pinned text/data-table rows render exactly as before; unpin works from Dashboard and the list view through the SDK.

## Risks & rollback

- **Enum migration is one-way** (PG enum values can't be dropped without a rewrite); rollback = revert code, leave the extra enum values inert — harmless, matching #273's clean-cut precedent (0073 purged viz pins; none exist to strand).
- **Persist-back write amplification** — bounded by the 120/min per-org rate window; failure is non-fatal by contract (logged, response still 200), so a DB blip degrades to a staler fallback, never a failed view. Fail-open posture of the rate limiter is inherited deliberately (refresh is free load-protection, not billing).
- **Materialization latency at pin time** — hydrating ≤ 5 000 rows adds one handle read (or one bounded re-execution) to a user-initiated action; acceptable and visible in the dialog's pending state. Detected by existing route logging.
- **`blockRef` clean cut** — compile-time: every consumer updates in the same commit; no runtime legacy shape.

## Files touched

- **core:** `models/portal-result.model.ts` · `contracts/pinned-result.contract.ts` (new) · `contracts/index` barrel · `constants/large-data-ops.constants.ts` · `ui/ContentBlockRenderer.tsx` · contract/model tests
- **api:** `db/schema/portal-results.table.ts` · `db/schema/zod.ts` · `db/schema/type-checks.ts` · `drizzle/<new migration>` · `constants/api-codes.constants.ts` · `services/portal-result-pin.service.ts` (new) · `services/portal-viz-refresh.service.ts` · `routes/portal-results.router.ts` · `config/swagger.config.ts` · unit + integration tests
- **web:** `utils/use-widget-refresh.util.ts` (moved) · `modules/D3Widget/*` (import updates) · `api/portal-results.api.ts` · `components/PortalMessage.component.tsx` · `components/PinnedResultsList.component.tsx` · `views/PinnedResultDetail.view.tsx` · `views/PinnedResultsListView.view.tsx` · `views/Dashboard.view.tsx` · web tests
- **docs:** `GATE_VIZ_PINNING.md` (superseded note) · glossary/FAQ pin copy (`apps/web/src/utils/glossary.util.ts`, `faq.util.ts`) if they describe the old gate

## Next step

`/plan 312` slices this into TDD commits on this branch — roughly: (1) core contract + enum + migration + flipped derivation pins; (2) materialization service + pin route; (3) refresh service split + pin refresh route; (4) web `blockRef` union + hook promotion + SDK endpoint; (5) detail view live data + hardening + affordance fix; (6) SDK-bypass cleanup + list icons + doc-sync + smoke doc.
