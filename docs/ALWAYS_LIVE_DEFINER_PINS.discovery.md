# Always-live definer's-rights pins — Discovery

**Issue:** [EnterpriseBT/portal-ai#640](https://github.com/EnterpriseBT/portal-ai/issues/640)

**Why this exists.** A data pin today is a snapshot plus a recipe. `PortalResultPinService.materialize` (`apps/api/src/services/portal-result-pin.service.ts:139`) writes up to `PIN_SNAPSHOT_ROW_CAP` rows into `portal_results.content`, alongside a `pipeline` when one can be derived. `GET /api/portal-results[/:id]` returns those rows to anyone who can read the pin, including sharees. Only a caller with **write** can refresh it (`portal-results.router.ts:353`), and the refresh runs under *that caller's* views and writes the result back into the row (`portal-viz-refresh.service.ts:203-228`). So a shared pin shows whatever its last writer could see, as of whenever they last opened it. The rows survive the sharer losing access, even being removed from the org (`SeatService.removeMember`, `seat.service.ts:483-560`, never touches `portal_results`). The map path is the opposite and also wrong: tiles render under the **viewer's** session (`portal-map.router.ts:158`), so a shared map and its own table disagree.

Under "sharing = grant" (#621), a shared pin must convey **current** data **as the definer sees it**, hold **no rows the definer can't see now**, and **empty when the definer loses access**. This ticket makes the pin a recipe only: no stored rows, a first-class definer, and execution on render under the definer's per-user session. It covers tables, charts and maps, and existing pins migrate to it. The code already marks the spot: `portal-result-pin.service.ts:45-46` reads "#640 will rebind this to the pin's definer; for now it is the caller."

## The current shape

### Storage and content

| Piece | Location | Note |
|---|---|---|
| Table | `apps/api/src/db/schema/portal-results.table.ts:28-45` | `type` ∈ `text \| data-table \| d3 \| geo` (`:17`); `content` jsonb; `snapshotUpdatedAt`; no definer column, `createdBy` from `baseColumns` |
| Core model | `packages/core/src/models/portal-result.model.ts:15-37` | `content` is `z.record` |
| Content contract | `packages/core/src/contracts/pinned-result.contract.ts:22-63` | `PINNED_CONTENT_SCHEMAS`: data-table `{columns, rows, rowCount?, truncated?, pipeline?}` |
| Chart / map content | `d3-widget.contract.ts:45-59`, `map-spec.contract.ts:197-224` | both carry `rows` + optional `pipeline` |
| Pipeline | `d3-widget.contract.ts:32-42` | `VizPipelineSchema = {sql, stationId, organizationId, transform?}`, optional on every data kind |

Not every data pin has a pipeline: blocks with externally supplied rows (`sql: null`) pin as static (`portal-result-pin.service.ts:67-69`), a failed handle-meta read degrades to static (`:209-211`), pre-#270/#349 pins predate pipelines, and pre-#312 pins hold only a bare `queryHandle` (the web's "expired" notice, `PinnedResultDetail.view.tsx:61-64`).

### Create, read, refresh

| Path | Location | Behavior |
|---|---|---|
| Create | `POST /api/portal-results`, `portal-results.router.ts:118-250` | only creator of pins; `createdBy` = pinning user (`:225`); geo enqueues a dissolve (`:239`) |
| List / get | `:455-537`, `:570-610` | org + `visibilityPredicate("pin")` / `can("resource.read")`; **return full `content` incl. rows**; `capabilities` attached |
| Refresh | `POST /:id/refresh`, `:322-399` | `viz-refresh:<org>` window (120/min); `loadForVerb(..., "write")`; `refreshPinnedResult` under the **caller**; persists rows back; re-enqueues dissolve under caller |
| Executor | `PortalVizRefreshService.runPipeline` / `executePipeline` (`portal-viz-refresh.service.ts:245-306`) | `resolveSqlDelivery` (`tools/result-sink.ts:71`) → inline rows or a Redis handle; `STALE_REFERENCE` → 422 |
| Share | `GrantService.share` (`grant.service.ts:118`) | `pin` ∈ `SHAREABLE_RESOURCE_TYPES` (`permission.model.ts:95-97`) |

### The per-user session seam

`PortalSqlServiceImpl.resolveViewsForSession(stationId, organizationId, userId)` (`portal-sql.service.ts:756`) is request-memoized per `(station, user, org)` (`:776-779`) and feeds the #660 gate chain in `runSqlQuery` (`:958`): `validatePortalSql` → views → `assertRelationsAllowed` → reader-role check → `openSqlSession` under `portalai_sql_reader`. `userId` is a plain parameter, never checked against the request caller, so running as another user is mechanically possible today. `DissolvePrecomputeService.reenqueueAllDissolvable` already does it, running each pin "under its creator's scope" (`dissolve-precompute.service.ts:208-228`).

For a removed member it resolves empty rather than throwing: `findEffectiveRoleNames` returns `[]` once the membership is tombstoned (`user-role.repository.ts:77-95`), and `removeMember` hard-deletes their grants (`seat.service.ts:537`). **One gap:** `removeMember` doesn't delete user-principal `policy_attachments`, so a policy attached directly to the user could keep resolving views after removal.

**Handles are user-bound.** `PortalSqlHandleService.produce` stamps `_userId` (`portal-sql-handle.service.ts:56,99-107`), and `GET /handle/:id` 404s for anyone else (`portal-sql-handle.router.ts`, #685). A large result produced as the definer is unreadable by the viewer.

### Map tiles and dissolve

`GET /api/portal-map/tiles/pin/:portalResultId/:z/:x/:y` (`portal-map.router.ts:281`) → `handle()` (`:137-165`, `setDbCancelPolicy("always")`, `authorizeSource` checks pin read). `PortalMapTileService.resolvePipeline` (`portal-map-tile.service.ts:581-666`) already loads `row.createdBy`. Everything after (`renderTile` `:1472`, `scopeHash` `:1499-1509`, `runSessionViewTile` `:1156-1215`, `enqueueLazyFill` `:913-933`) runs as the **viewer**. The ETag hashes `sql|z|x|y|snapshotUpdatedAt|AGG_TILE_VERSION|scopeHash` (`:1545-1551`). `layerTotal` comes from stored `content.matchedCount`/`rowCount` (`layerCountFromContent`, `:377-392`), which a rows-free pin loses. Dissolve output in `map_dissolve_geometries` is keyed by owner + `scope_hash`, so it is already per-scope.

### Frontend

| Piece | Location | Note |
|---|---|---|
| Detail (only data surface) | `apps/web/src/views/PinnedResultDetail.view.tsx` (`UI :89`, container `:223`) | `blockRef={{kind:"pin", portalResultId, canRefresh: canWrite}}` (`:202-207`); expired notice `:191-195` |
| Cards | `components/PinnedResultsList.component.tsx:44` | metadata only, no data: dashboard (limit 5) and the pins index |
| Refresh hook | `utils/use-widget-refresh.util.ts` | module freshness map keyed `pin:<id>`; auto-refresh on mount when stale; skipped when `canRefresh===false` (`:61-63`) |
| Widgets | `TableWidget`, `D3Widget`, `MapWidget` modules; core `WidgetFreshnessBar.tsx` | read `content.rows`; Table may fetch a handle snapshot; tile URL `tile-source.util.ts:50-57` carries the pin id only |
| Query keys | `api/keys.ts:221-225` | `portalResults.root/list/get`; no data key |

## The design space

### Decision 1 — Where execution happens and how results reach the viewer

**A. A read-verb data endpoint, no persist-back.** `GET /api/portal-results/:id/data` checks pin **read** for the viewer, then runs the pipeline as the definer through the existing `executePipeline` and returns the delivery. `POST /:id/refresh` and the write-back are removed. **B. Keep refresh, run it as definer, persist.** The smallest diff, but rows are stored again: the stored copy is exactly what goes stale and outlives revocation. **C. Client asks a generic SQL endpoint with a pin token.** This needs a new auth concept for no gain.

| | A | B | C |
|---|---|---|---|
| No stored rows | ✓ | ✗ | ✓ |
| Read-only sharee sees live data | ✓ | needs read-verb refresh anyway | ✓ |
| New concepts | one route | none | pin token |

**Lean: A.** It's the only option where nothing gated is ever written down, and the route is read-only, so it can opt into `setDbCancelPolicy("always")` like tiles do.

### Decision 2 — Large results (handles)

The viewer can't read a handle produced as the definer. **A. Inline only**, capped at `PIN_SNAPSHOT_ROW_CAP` with `truncated`. **B. Pin-bound handles:** `produce` takes an owner `{kind:"pin", portalResultId}` instead of `_userId`, and `GET /handle/:id` authorizes a pin-owned handle by **pin read** for the caller. **C. Stamp the handle with the viewer** while running as the definer. That works, but it confuses who a handle belongs to.

| | A | B | C |
|---|---|---|---|
| Table paging past the cap | ✗ (regression) | ✓ | ✓ |
| Handle ownership stays coherent | ✓ | ✓ | ✗ |
| Revocation reaches an open handle | n/a | re-checked per read | ✗ |

**Lean: B.** It keeps today's large-table paging, and every handle read re-checks pin read, so an unshare closes an open handle.

### Decision 3 — Definer storage

**A. Columns** `definer_principal_type` (`user` | `role`, text + core const, no CHECK) and `definer_principal_id`, backfilled from `created_by`, plus a partial index `(organization_id, definer_principal_type, definer_principal_id) WHERE deleted IS NULL`. **B. Inside `content` jsonb.** **C. Reuse `createdBy`.**

**Lean: A.** Offboarding and revocation must query it (#599 OQ2). Keeping it separate from `createdBy` lets the later role rebind change the definer without rewriting authorship, and keeps #641's `createdBy` semantics untouched.

### Decision 4 — Detecting access loss

**A. Live check at render:** before executing, assert the definer is an **active member** of the pin's org, else refuse with `PIN_DEFINER_ACCESS_LOST`. A pipeline naming a view the definer can no longer read (today's `STALE_REFERENCE` / relation refusal) maps to the same code. **B. Sweep on offboard:** mark pins unavailable when the member is removed. This is a write the render path must still back up, and it misses grant/view revocations.

**Lean: A**, with no sweep. Revocation is free and fail-closed, and the membership assertion also closes the surviving-`policy_attachments` hole above. A definer whose views now return zero rows is **not** revoked; that's a normal empty result.

The response is caller-aware. Callers with pin **write** (the definer and anyone who can manage it) get the reason. Other viewers get a neutral `PIN_DATA_UNAVAILABLE` ("This pin's data isn't available."). Both are 4xx on the data route; the pin itself stays readable.

### Decision 5 — Maps

Re-key the pin tile path to the definer. `resolvePipeline` returns `definerId`, and `renderTile`, `scopeHash`, the session tile, the dissolve probe/serve and `enqueueLazyFill` use it. `authorizeSource` stays on the viewer. Every viewer then shares one dissolve set and one ETag per definer scope. Pin create and the operator re-enqueue pass the definer. The ETag drops `snapshotUpdatedAt` and relies on `scopeHash` plus the existing `max-age=60`. `layerTotal` is recomputed as a `COUNT` under the definer and cached in Redis by `(pin, scopeHash)` for 60 s.

**Lean: as stated.** Anything else would make a shared map disagree with its own table.

### Decision 6 — Non-re-executable blocks

**At create:** refuse with `422 PIN_NOT_REEXECUTABLE` when a data block has no derivable pipeline. The chat's Pin toggle gets a `disable` gate naming why ("This result can't be re-run, so it can't be pinned."). **Existing ones:** the migration leaves them with no rows, and the data route answers `422 PIN_NOT_REEXECUTABLE`, which the detail view renders as "This pin can't refresh — re-pin it." **Lean: refuse at create.** A static pin is exactly the snapshot this ticket removes.

### Decision 7 — Migration (0124)

Add the definer columns, backfill `definer_principal_type='user', definer_principal_id=created_by`, strip `rows`, `rowCount`, `matchedCount`, `matchedCountExact` and `truncated` from data-type `content`, and drop the bare `queryHandle` from pre-#312 pins. `snapshot_updated_at` is dropped (`-- destructive-ok: snapshots no longer exist`). Text pins are untouched. **Lean: one forward migration.** No compat path; the destroyed rows are exactly the stale/gated data the ticket exists to remove.

### Decision 8 — Web

Add a `portalResults.data(id)` query key, read through `useAuthQuery` (declarative, keyed, invalidated with `portalResults.root`). The pin variant of `useWidgetRefresh` becomes a refetch of that query, gated on **read** rather than write, and the widgets read rows from it instead of `content`. The GET payload gains `definer: {id, displayName}` and `viewerIsDefiner`. The caption ("Data as <name> sees it") renders in the detail metadata list and the pin card when `!viewerIsDefiner`, and is **hidden in the unavailable state** (with the name, the neutral message would reveal the definer lost access). Map tile 4xx with these codes surfaces the same state, not "A map tile failed to load."

## Tradeoff comparison

| | D1 data route | D2 pin handles | D3 columns | D4 live check | D5 maps→definer | D6 refuse | D7 strip | D8 query |
|---|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Contract change | new route, refresh removed | handle owner | model + table | 2 codes | ETag/count | 1 code | content shape | payload fields |

## Recommendation

1. Data pins store only `pipeline` (plus spec/program/columns metadata); `rows`, counts, `truncated`, `queryHandle` and `snapshotUpdatedAt` are gone. Text pins are unchanged.
2. `portal_results` gains `definer_principal_type` + `definer_principal_id` (user first; role admitted by the type), indexed for sweep queries, backfilled from `created_by`.
3. `GET /api/portal-results/:id/data` authorizes the **viewer** for pin read, asserts the definer's active membership, executes the pipeline as the **definer** via `executePipeline`, persists nothing, and runs under `setDbCancelPolicy("always")`. `POST /:id/refresh` is removed.
4. Large results return a **pin-owned handle**, readable by anyone with pin read, re-checked on every handle read.
5. Access loss answers `PIN_DEFINER_ACCESS_LOST` with the reason for callers with pin write, else neutral `PIN_DATA_UNAVAILABLE`; zero rows is a normal empty result.
6. Pin create refuses a data block with no derivable pipeline (`422 PIN_NOT_REEXECUTABLE`); legacy pipeline-less pins answer the same code from the data route.
7. Pin map tiles, dissolve and lazy fill run under the definer; the viewer is only authorized. The ETag drops `snapshotUpdatedAt`; `layerTotal` is a Redis-cached definer `COUNT`.
8. Web renders pin data from `portalResults.data(id)` gated on read, with the definer caption and the two unavailable states.
9. Execution stays free and unmetered, under the existing `viz-refresh:<org>` window.

## Open questions

1. **Delete user-principal `policy_attachments` in `removeMember` here?** The membership assertion already makes pins safe, but a surviving attachment is a latent hole elsewhere. Lean: verify it in slice 1; if it reproduces, fix it here as its own commit, since it's the same revocation guarantee.
2. **Should the `viz-refresh:<org>` window stay per-org now that viewers trigger execution?** Lean: yes. Only the detail view executes (cards show no data), so one view costs one execution; add a per-user key only if metrics show contention.
3. **Does the agent's `station_context` / pin listing ever expose pin rows to the agent?** Lean: verify in the spec survey. If any agent path reads `content.rows`, it moves to the data route as the definer, or drops rows.
4. **Who can see the definer's name?** Lean: any pin reader. They already know the sharer, and #694's member-label rule allows a name on an object you can read.
5. **The handle router's per-user 404 (#685):** is pin-owned the only new owner kind, or do message blocks want it too? Lean: pin only; message blocks stay user-owned.

## Enterprise-scale considerations

- **Concurrency & correctness.** The data route is read-only and writes nothing, so there's no check-then-act. The membership assertion and the view resolution run in the same request, and a revocation landing mid-request is answered by the next render. Lean: no locking needed. A dissolve job enqueued under the definer is deduped per `(owner, user)` as today.
- **Accuracy & auditability.** The definer is a durable, queryable column, and a pin's data is always reproducible from its pipeline and the definer's current grants. Lean: no new audit events; sharing and member removal are already audited (#575).
- **Failure modes.** Fail-closed throughout: an unresolvable definer, a missing pipeline or an unusable reader role refuses rather than serving anything stored, because nothing is stored. Redis down: the rate window and the count cache fail open (a recount), but handles need Redis, so a large table degrades to the inline cap.
- **Scale & unbounded growth.** Execute-on-render moves cost from pin time to view time. It's bounded: only the detail view executes, under `statement_timeout`, the tile `AdmissionGate` and the per-org window. Sharing dissolve per definer scope *reduces* precompute (N viewers → 1 scope). Caching/TTL is recorded, not built (out of scope per the PRD).
- **Multi-tenancy.** The pin's own `organizationId` scopes the definer session, never the viewer's. A cross-org definer is impossible because the membership assertion is against the pin's org. Lean: an integration test covers a viewer in org A against a pin in org B → 404.
- **Contract stability.** `definer_principal_type` admits `role` without re-plumbing; the rebind UI is a later increment. The data route is the one seam a future cache sits behind.
- **Data lifecycle.** Snapshots are destroyed by the migration, by design. Dissolve scopes for definers who lose access age out through the existing `dissolve-scope-retention-purge`.

## What this doesn't decide

- **Definer = role rebind UI.** The schema admits it; the flip ships later (PRD).
- **Result caching / TTL** for execute-on-render. Built only if metrics show fan-out pressure.
- **#641's `createdBy` semantics.** The definer column deliberately decouples from it.
- **Message-block (unpinned) execution.** It stays under the caller; only pins change.

## Next step

`/spec 640` turns the recommendation into the contract: the data route and its codes, the pin-owned handle, the content schemas without rows, the tile changes and the 0124 migration. `/plan 640` then slices it roughly as follows: (1) definer columns, migration, model; (2) the definer executor, data route and access-loss codes, with refresh removed; (3) pin-owned handles; (4) tiles, dissolve and count under the definer; (5) create-time refusal; (6) web data query, states and caption; (7) docs and help copy.
