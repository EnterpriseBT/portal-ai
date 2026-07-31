# Pinning refactor: pin any durable block, live data in the detail view — Discovery

**Issue:** [EnterpriseBT/portal-ai#312](https://github.com/EnterpriseBT/portal-ai/issues/312)

**Why this exists.** Only `text` and `data-table` blocks are pinnable; viz blocks were deliberately gated out when a pin could only store static content (`docs/GATE_VIZ_PINNING.md`, #273). The durable pipeline (#270/#280) made that constraint obsolete — every viz block carries `{ sql, stationId, organizationId }` and is re-executable server-side. Meanwhile the survey found the existing pin model is quietly *worse* than static: a pin copies block content verbatim with zero validation, handle-backed data-tables are silently un-pinnable in the UI, and a pinned handle envelope would render an **empty table with no notice** once its 24h Redis TTL lapses — there is no persisted snapshot to fall back to. This is the refactor that makes a pin a durable, self-contained, re-executable artifact: any durable block kind pins, and the detail view shows live data with the stored snapshot as the fallback.

## The current shape

### Data model + API

| Concern | Where | Note |
|---|---|---|
| Pinnable enum | `packages/core/src/models/portal-result.model.ts:13` | `z.enum(["text","data-table"])`; `PINNABLE_BLOCK_TYPES` is derived from it (`portal.contract.ts:178`) — widening starts here |
| DB enum + row | `apps/api/src/db/schema/portal-results.table.ts:10,19-33` | enum migration precedents `drizzle/0027,0028,0073`; row = org/station, nullable `portalId`, nullable `messageId`+`blockIndex` (provenance only, added by `0029`), `name`, `type`, untyped `content: jsonb` |
| Pin = copy | `apps/api/src/routes/portal-results.router.ts:157-193` | resolves target message, bounds-checks `blockIndex` (`:147`), rejects non-pinnable types (`:162-170` → `PORTAL_RESULT_TYPE_NOT_PINNABLE`), then writes `block.content` verbatim — **zero payload validation**; `:182` stores `messageId ?? null` |
| Lifecycle | `portal.router.ts:638-650`, `station.router.ts:834-846` | portal/station delete **detaches** (`portalId = null`) while hard-deleting `portal_messages` → pins survive as tombstoned copies with dangling `messageId` (no FK); org delete/reset hard-delete (`organization-delete.service.ts:183`) |
| Routes | `portal-results.router.ts:93,265,328,431,532` | pin / org-scoped list / detail / rename / soft-delete; auth = org equality only, no tier checks |

### Web flow + surfaces

`hasPinnableContent` (`PortalMessage.component.tsx:84-86`) gates the pin affordance (`:243-283`) — but `shouldRenderViaWeb` (`:107-118`) short-circuits at `:203-211` **before** the affordance for any `data-table` carrying a `queryHandle`, so handle-backed tables are un-pinnable silently, not via the typed rejection. Dialog: `PinResultDialog.component.tsx` on the house form pattern (#285); SDK `api/portal-results.api.ts` with keys `api/keys.ts:175-180`. Surfaces: list (`views/PinnedResultsListView.view.tsx`) and detail (`views/PinnedResultDetail.view.tsx`) — the detail view rebuilds a block (`:54-58`) and renders through core `ContentBlockRenderer` **with no `blockRef` and no `dataUpdatedAt`** (`:169`); the type chip is a hardcoded `data-table ? "Table" : "Text"` ternary (`:156`); "Open Source Portal" (`:132-141`) links on the `portalId` that delete nulls. Two SDK bypasses remain: raw `fetchWithAuth` unpins in `Dashboard.view.tsx:180-193` and `PinnedResultsListView.view.tsx:66-76` (recorded out-of-scope in `docs/UNPIN_SDK_BYPASS.md`).

### Handles, snapshots, refresh

Handle-backed content pins as the bare envelope `{ queryHandle, rowCount, truncated }` — no rows (`QueryResultDataBlock.component.tsx:16-20`, `result-sink.ts:79-95`). Handles live in Redis with a 24h TTL (`READ_HANDLE_TTL_MS`, `large-data-ops.constants.ts:22`; expiry → `READ_HANDLE_EXPIRED`, `portal-sql-handle.service.ts:476`). The core `renderDataTable` reads `content.rows` only (`ContentBlockRenderer.tsx:46-54`) → a pinned envelope renders an empty table, silently. Widget refresh: `portal-sql-handle.router.ts:164-217` takes `{messageId, blockIndex}`, applies a per-org window (`VIZ_REFRESH_RATE_PER_MIN = 120`, fail-open on Redis errors `:199-205`), and `portal-viz-refresh.service.ts:53-93` loads the **message**, requires `block.type === "d3"` (`:62`), parses `content.pipeline` (`D3PipelineSchema`; absent → 422 `VIZ_WIDGET_NOT_REFRESHABLE`), re-runs read-only through `resolveSqlDelivery`. Client-side, `use-widget-refresh.util.ts:19-21` keys freshness by `` `${messageId}:${blockIndex}` `` with `VIZ_REFRESH_FRESHNESS_MS = 3min` (`:91-101`) and **already implements keep-last-data-plus-notice on failure** (`:76-85`; `D3Widget.component.tsx:337-345`). Refresh is documented "Free and unmetered" (`portal-sql-handle.router.ts:125`) — confirmed no toolpack/tier checks anywhere on the path.

### Rendering outside chat

`BlockRenderContext` = `{ blockRef?: {messageId, blockIndex}, dataUpdatedAt? }` (`ContentBlockRenderer.tsx:26-32`); the registry is open with `d3` registered at web bootstrap (`main.tsx:10` → `register.util.tsx:11-16`), so a pinned `d3` already *routes* correctly — but with no context it mounts with `canRefresh = false` (`D3Widget.component.tsx:376`), hydrates only from the (expiring) handle, and breaks after 24h. `blockRef` is used **only for refresh addressing, never hydration** — widening it is a contained change (`BlockRenderContext`, `register.util.tsx`, `D3WidgetGate`, `D3Widget`, `use-widget-refresh`). GATE_VIZ_PINNING explicitly anticipates this ticket: its regression tests are "the thing it will deliberately update," and migration `0073` hard-deleted pinned viz rows, so **no viz back-compat is owed**.

## The design space

### Decision 1 — What a pin persists (the snapshot model)

- **A — pin-time server-side materialization, persist-back on refresh.** The pin route stops copying verbatim: it validates the block, resolves live data (inline rows, or a bounded snapshot drawn from the handle before it expires), and stores `content = { …block, rows: snapshot, pipeline? }`. A successful pin-addressed refresh UPDATEs the stored snapshot, so the fallback is always the last-known-good data. Pins become deletion-proof and TTL-proof.
- **B — copy verbatim (today), fallback only client-side.** Minimal write path, but the fallback data is whatever the handle still serves — after 24h there is nothing; the empty-table bug persists for legacy-shaped content.
- **C — reference, don't copy.** Rejected by the existing architecture: messages are hard-deleted on portal/station delete; pins deliberately survive as copies.

| | A — materialize + persist-back | B — verbatim copy | C — reference |
|---|---|---|---|
| Fallback after handle TTL / source delete | always (last good snapshot) | none | none |
| Write cost | 1 INSERT + 1 UPDATE per successful refresh (rate-capped) | 1 INSERT | 1 INSERT |
| Fixes the empty-table gap | yes | no | no |
| Content validated at pin time | yes | no (today's hole) | n/a |

**Lean: A.** The PRD's "last snapshot + notice" is only implementable if a snapshot durably exists; materialization also closes the unvalidated-`content` hole and makes handle-backed tables pinnable at all.

### Decision 2 — How refresh addresses a pin

- **A — dedicated `POST /api/portal-results/:id/refresh`.** Reads the pipeline from the pin row's own `content`, scopes on the row's `organizationId`/`stationId` (the "authoritative owned row" pattern), shares the same per-org rate window and a `PortalVizRefreshService` generalized to take a pipeline source instead of loading a message. Message deletion becomes irrelevant to pinned refresh.
- **B — widen the existing widget-refresh body** to `{messageId, blockIndex} | {portalResultId}`. One route, but it grafts pin semantics onto a message-block route whose auth model is "load the message" — the two lookups share almost nothing.

**Lean: A.** REST-consistent with the portal-results resource, cleaner auth, and the service split (pipeline-execution core + two thin addressers) is the natural refactor. Client side, `blockRef` widens to a discriminated ref — `{kind:"message", messageId, blockIndex} | {kind:"pin", portalResultId}` — and the freshness map keys off it.

### Decision 3 — Contract widening mechanics

- **A — widen `PortalResultTypeSchema` to `["text","data-table","d3","geo"]` in one migration.** `PINNABLE_BLOCK_TYPES` stays derived; GATE_VIZ_PINNING's regression tests flip as that doc anticipates; `geo` is admitted preemptively so #84 lands with zero pinning-side change (its PRD criterion says exactly that).
- **B — widen to `d3` only; `geo` in a follow-up migration.** Two migrations, and #84 would need a pinning-side edit after all — contradicting its amended PRD.

**Lean: A.** One migration, and the parallel #84 branch stays decoupled. Transient kinds (`bulk-job-progress`) remain outside `PortalResultTypeSchema` by construction — the typed rejection continues to fire for them.

### Decision 4 — Detail view: live-data behavior

The detail view passes `blockRef={kind:"pin", portalResultId}` + `dataUpdatedAt` (last successful refresh, else pin time) into `ContentBlockRenderer`; the existing freshness hook auto-fires one refresh per stale mount (3-min window) and a manual refresh control appears in the widget chrome — the same model as chat, no new UX vocabulary. Failure keeps the stored snapshot and shows the existing notice path (the #286 persistent-toast precedent covers non-widget failures). Static kinds (`text`) get no refresh affordance; legacy pinned envelopes with no stored rows render an explicit "data expired — refresh unavailable" notice instead of today's silent empty table. **Lean: this shape** — it is almost entirely reuse; the alternative (a bespoke detail-view refresh UI) duplicates the widget chrome for no gain.

## Tradeoff comparison

| | D1: materialize + persist-back | D2: pin-addressed refresh route | D3: one-migration widening | D4: reuse chat refresh UX |
|---|---|---|---|---|
| Spread to spec | Yes — content schema per type, snapshot bound | Yes — route contract, service split | Yes — enum + migration + flipped tests | Yes — blockRef union, freshness keying |
| New pattern introduced | No (snapshot = existing handle-snapshot shape) | No (authoritative-row auth exists) | No | No |
| Back-compat surface | legacy rows render + notice | none | none (viz rows were purged by 0073) | none |

## Recommendation

1. Widen `PortalResultTypeSchema` to `["text","data-table","d3","geo"]` (+ drizzle enum migration), keep `PINNABLE_BLOCK_TYPES` derived, and deliberately update GATE_VIZ_PINNING's regression tests per that doc's own instruction.
2. Rework the pin route to **materialize**: validate the block against a per-type content schema, resolve a bounded snapshot server-side (inline rows as-is; handle-backed content snapshotted before TTL), persist `{ …content, rows, pipeline }`; reject only transient kinds via the existing typed error.
3. Make the pin affordance follow pinnability, not render path: remove the `shouldRenderViaWeb` short-circuit that hides pinning for handle-backed tables (`PortalMessage.component.tsx:203-211`).
4. Add `POST /api/portal-results/:id/refresh`: same per-org `viz-refresh` rate window, pipeline read from the pin row, org-scoped on the row, successful result UPDATEs the stored snapshot; generalize `PortalVizRefreshService` into a pipeline-execution core with message-block and pin addressers.
5. Widen `BlockRenderContext.blockRef` to the discriminated message/pin ref; key the freshness map by it; the detail view passes the pin ref + `dataUpdatedAt` so widgets auto-refresh when stale and expose the manual control.
6. Detail-view hardening in the same pass: derive the type chip from the block registry (drop the hardcoded ternary), hide "Open Source Portal" when `portalId` is null with a tombstone note, and render the explicit expired-data notice for legacy snapshot-less rows.
7. Route the two remaining raw-`fetchWithAuth` unpins (`Dashboard.view.tsx:180-193`, `PinnedResultsListView.view.tsx:66-76`) through the SDK while these views are open — closing the bypasses `UNPIN_SDK_BYPASS.md` recorded.
8. Doc-sync: mark `GATE_VIZ_PINNING.md` superseded by this ticket, refresh pin-related glossary/FAQ copy, and update #92's deferral comment if the pin-affordance rework moves it.

## Open questions

1. **Persist-back on every successful refresh, or snapshot only at pin time?** Persist-back costs one UPDATE per successful refresh (bounded by the 120/min org window) and keeps the fallback fresh; pin-time-only is cheaper but the fallback ages forever. **Lean: persist-back** — the pin row is the record of truth and the write is rate-capped.
2. **Snapshot row bound.** The stored snapshot needs a cap so a million-row handle doesn't bloat `portal_results.content`. **Lean: reuse the existing handle snapshot page cap** (the same bound `QueryResultDataBlock` hydrates by) and record `truncated` so the UI can say "showing first N — refresh for live data."
3. **Does pinning a `text` block change at all?** Materialization is a no-op for text. **Lean: no change beyond passing through the new validation** — text pins stay exactly as they are.
4. **Where does `geo`'s per-type content schema come from before #84 lands?** The enum admits `geo` now, but its content schema ships with #84. **Lean: the pin route validates per-type schemas from a registry that #84 extends** — until then a `geo` pin attempt can't occur (no geo blocks exist), so no dead code path is exposed.

## Enterprise-scale considerations

- **Concurrency & correctness** — Two tabs refreshing the same pin race on the persist-back UPDATE: last-write-wins is acceptable (both writes are fresh executions of the same pipeline); the rate window is already atomic in Redis. Lean: no new machinery.
- **Accuracy & auditability** — N/A beyond existing soft-delete: pins are user artifacts, refresh is deliberately free/unmetered (standing policy: the core viz/refresh loop is never charged or entitlement-gated), so no ledger surface.
- **Failure modes** — Refresh failure degrades to the stored snapshot + notice (fail-graceful by design); the rate window keeps its existing fail-open posture (stated, acceptable: refresh is free, the limit is load protection not billing); Redis outage now degrades to the stored snapshot rather than an empty table — a strict improvement.
- **Scale & unbounded growth** — Stored snapshots bounded per Open Q2; per-org refresh rate capped at 120/min (existing); list endpoints already paginate. Lean: cap recorded in the contract, not implicit.
- **Multi-tenancy** — Pin-addressed refresh scopes on the row's own `organizationId` (same 404-for-cross-org shape the message path uses at `portal-viz-refresh.service.ts:58`). Lean: mirror that exactly.
- **Contract stability** — The discriminated `blockRef` and the pipeline-execution service split are precisely the seams the future dashboards epic (arrangement/layout) and #84's geo widget plug into without re-plumbing; pinnability stays derived from one enum.
- **Data lifecycle** — Pins keep their detach-don't-cascade semantics (survive portal/station delete as self-contained artifacts — now genuinely self-contained thanks to materialization); org delete still hard-deletes; stored snapshots have no TTL by design, replacing the accidental 24h-handle dependence.

## What this doesn't decide

- **Dashboard-style arrangement** of pinned results (layout, resizing, grouping) — the dashboards epic; this ticket only hands it the addressing seams.
- **Pinning transient blocks** (`bulk-job-progress`, codegen-failure fallbacks) — nothing durable to return to; #92 remains the job-progress deferral.
- **Sharing/export of pinned results** — separate capability, separate ticket.
- **The geo widget itself** — #84 builds it; this ticket guarantees the contract admits it (Open Q4's schema-registry seam).
- **Refresh parameterization** (changing the SQL/date-range from the detail view) — scope creep into saved-query territory; pins re-execute their pipeline verbatim.

## Next step

`/spec 312` writes `docs/PINNING_REFACTOR.spec.md`: the widened enum + migration, the per-type pinned-content schemas and snapshot bound, the pin-route materialization contract, the `POST /api/portal-results/:id/refresh` contract (rate window, persist-back, error codes), and the discriminated `blockRef`. `/plan 312` then slices roughly: (1) enum widening + migration + flipped GATE_VIZ_PINNING tests; (2) pin-route materialization + per-type validation; (3) pipeline-execution service split + pin refresh route; (4) web `blockRef` union + freshness keying + detail-view live data; (5) detail-view hardening + SDK-bypass cleanup + affordance fix; (6) docs + smoke. Slices are independent of #84; the shared seam is only the schema registry Open Q4 names.
