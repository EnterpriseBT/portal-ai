# Always-live definer's-rights pins — Spec

**Issue:** [EnterpriseBT/portal-ai#640](https://github.com/EnterpriseBT/portal-ai/issues/640) · **Epic:** #578 · **Discovery:** `docs/ALWAYS_LIVE_DEFINER_PINS.discovery.md` · **PR:** #819

This spec pins the contract that makes a data pin a recipe with a definer: it stores no rows, and it executes on render under the definer's current access. That covers tables, charts and maps; existing pins are migrated.

## Key decisions (flag for review)

1. **One read route, no persist-back.** `GET /api/portal-results/:id/data` authorizes the **viewer** for pin read and executes as the **definer**. `POST /:id/refresh` is deleted outright (no alias).
2. **Definer columns** `definer_principal_type` / `definer_principal_id` (user only for now; `role` admitted by the type), backfilled from `created_by`.
3. **Access loss is checked live and fails closed.** Before every execution the definer must be an active member of the pin's org. A pipeline naming a view the definer can no longer read counts as access loss. There is no offboard sweep.
4. **The response depends on who is asking.** A caller with pin `write` gets `PORTAL_RESULT_DEFINER_ACCESS_LOST`. Anyone else gets `PORTAL_RESULT_DATA_UNAVAILABLE`. A zero-row result is a normal success.
5. **Large results come back as a pin-owned handle.** It's stamped with the definer (`_userId`) and the pin (`_portalResultId`). Every read re-checks the caller's pin read and the definer's membership, so unsharing or offboarding closes a handle that's already open.
6. **Non-re-executable data blocks are refused at create** (`PORTAL_RESULT_NOT_REEXECUTABLE`). Legacy pipeline-less pins get the same code from the data route.
7. **Map pins run as the definer:** tiles, dissolve and lazy fill. The viewer is only authorized. The ETag drops `snapshotUpdatedAt` and, for a pin, turns over with the widget freshness window.
8. **Revocation hardening:** `removeMember` also soft-deletes user-principal `policy_attachments` (discovery OQ1). No writer creates such a row today, so this is defence in depth.
9. **Execution stays free and unmetered**, under the existing `viz-refresh:<org>` window (OQ2). No agent path reads pin content (OQ3 verified), so no tool changes.

## Scope

### In scope

1. Core: pinned content schemas without rows, a required `pipeline` on data kinds, the definer on `PortalResultSchema`, and a new response contract.
2. API: the table columns + migration 0124, the definer executor, the data route, pin-owned handles, create-time refusal, tile/dissolve re-keying, removal of the refresh route, the `removeMember` hardening, and OpenAPI.
3. Web: a data query replacing pin refresh, the unavailable/not-re-executable/definer-caption states, a Pin toggle gate in chat, and map tile states.
4. Docs: Help/FAQ copy on shared pins, and the `CLAUDE.md` cascade note if the pin delete list changes (it doesn't, so only Help/FAQ).

### Out of scope

The role-definer rebind UI; caching/TTL for execute-on-render; #641 `createdBy` semantics; execution of message (unpinned) blocks, which stays under the caller.

## Surface

### Core — `packages/core/src/models/portal-result.model.ts`

`PortalResultSchema` (`:24`) gains two fields and drops `snapshotUpdatedAt`:

```ts
export const PinDefinerPrincipalTypeSchema = z.enum(["user", "role"]);
definerPrincipalType: PinDefinerPrincipalTypeSchema,
definerPrincipalId: z.string(),
```

### Core — `packages/core/src/contracts/pinned-result.contract.ts`

- Export the base schemas `D3BaseContentSchema` (`d3-widget.contract.ts:45`) and `GeoBaseContentSchema` (`map-spec.contract.ts:196`); today they're module-private.
- `PinnedDataTableContentSchema` = `{ columns: string[], pipeline: VizPipelineSchema }`. `columns` is a display-order hint; live rows are authoritative.
- `PinnedD3ContentSchema` = `D3BaseContentSchema.extend({ pipeline: VizPipelineSchema })`.
- `PinnedGeoContentSchema` = `GeoBaseContentSchema.extend({ pipeline: VizPipelineSchema, tiled: z.boolean().optional() })`.
- `PINNED_CONTENT_SCHEMAS.text` is unchanged.
- **Read-side tolerance:** the GET/list payloads validate `content` as `z.record` (unchanged). A migrated legacy pin with no `pipeline` must still list and open; only the *write* path uses the strict schemas.
- `PinRefreshResponseSchema` is renamed to `PinDataResponseSchema = WidgetRefreshResponseSchema` (`portal-sql.contract.ts:85`: `inline {rows}` | `handle` envelope).

### Core — `packages/core/src/contracts/portal.contract.ts`

`PortalResultGetResponsePayloadSchema` (`:179`) and the list item (`:161`) gain:

```ts
definer: z.object({ id: z.string(), displayName: z.string() }),
viewerIsDefiner: z.boolean(),
```

`displayName` is `users.name ?? users.email ?? id`, the same source as the grant labels (`grant.service.ts:108-112`) but name-first for a caption. Any pin reader gets it (OQ4).

### API — table `apps/api/src/db/schema/portal-results.table.ts`

```ts
definerPrincipalType: text("definer_principal_type").notNull().$type<"user" | "role">(),
definerPrincipalId: text("definer_principal_id").notNull(),
// snapshotUpdatedAt removed
```

Index `portal_results_definer_idx` on `(organization_id, definer_principal_type, definer_principal_id) WHERE deleted IS NULL`. `zod.ts` and `type-checks.ts` are updated so both schemas agree.

### API — `ApiCode` (`apps/api/src/constants/api-codes.constants.ts`)

| Code | Status | When | Default recommendation |
|---|---|---|---|
| `PORTAL_RESULT_NOT_REEXECUTABLE` | 422 | create: data block has no derivable pipeline; data route: stored pin has none | "Re-run the prompt and pin the new result." |
| `PORTAL_RESULT_DEFINER_ACCESS_LOST` | 422 | data route/handle, caller has pin `write`, definer not an active member or a view refusal | "You no longer have access to the data behind this pin." |
| `PORTAL_RESULT_DATA_UNAVAILABLE` | 422 | same condition, caller without pin `write`; also every tile refusal of this kind | none (neutral) |

`VIZ_WIDGET_NOT_REFRESHABLE` stays for message blocks.

### API — `PinDefinerService` (new, `apps/api/src/services/pin-definer.service.ts`)

```ts
static async assertDefinerActive(row: PortalResultSelect): Promise<{ userId: string }>
static async describe(row: PortalResultSelect, viewerId: string): Promise<{ definer: { id: string; displayName: string }; viewerIsDefiner: boolean }>
static async describeMany(rows: PortalResultSelect[], viewerId: string): Promise<Map<string, …>>   // one users query for a list page
```

`assertDefinerActive` behaves as follows:
- A definer type other than `user` throws 500. That's an invariant: no role definer is writable yet.
- It looks the definer up with `DbService.repository.organizationUsers.findByOrganizationAndUser(row.organizationId, userId)`. If there's no live membership, it throws an internal `DefinerAccessLostError`.

The pin's own `organizationId` is the scope, never the viewer's.

### API — `PortalVizRefreshService` (`apps/api/src/services/portal-viz-refresh.service.ts`)

- `refreshPinnedResult` (`:156`) and the write-back (`:203-228`) are deleted.
- New method:
  ```ts
  static async executePin(params: { portalResultId: string; organizationId: string; viewerId: string; viewerCanWrite: boolean }, deps?: PinRefreshDeps): Promise<WidgetRefreshResponse>
  ```
  It loads the row (cross-org → 404 `PORTAL_RESULT_NOT_FOUND`), then runs these steps in order:
  1. No parseable `pipeline` → 422 `PORTAL_RESULT_NOT_REEXECUTABLE`.
  2. `assertDefinerActive`.
  3. `executePipeline(pipeline, row.organizationId, definerId, …, { handleOwner: { portalResultId } })`.

  `DefinerAccessLostError` and the `STALE_REFERENCE` refusal (`:256`) map to `DEFINER_ACCESS_LOST` when `viewerCanWrite`, else `DATA_UNAVAILABLE`.
- `runPipeline` / `executePipeline` take an optional `handleOwner` and forward it to `resolveSqlDelivery` → `produce`.

### API — handles (`portal-sql-handle.service.ts`, `tools/result-sink.ts`, `routes/portal-sql-handle.router.ts`)

- `ProduceOptions` (`:52`) and `ResultSinkContext` (`result-sink.ts:39`) gain `portalResultId?: string`.
- `StoredHandleMeta` (`:79`) gains `_portalResultId?: string`, written by `stage()` beside `_userId` (`:442`). `_userId` is the definer, so `requireHandleUser` re-executes pages under the definer unchanged.
- The owner check (`portal-sql-handle.router.ts:103`) becomes:
  - **`_portalResultId` set:** load the pin with the caller's org; it must be readable (`can("resource.read", pin)`), else 404 `READ_HANDLE_EXPIRED`. Then `pin.definerPrincipalId` must still equal `_userId`, and `assertDefinerActive(pin)` must pass; otherwise 422 with the same caller-dependent code.
  - **Otherwise:** today's `_userId === caller` rule.
- The same check guards every handle read route (snapshot/page) that reads `getMeta`.

### API — routes `apps/api/src/routes/portal-results.router.ts`

- **`GET /:id/data`** (new):
  - Applies the `viz-refresh:<org>` window (moved from refresh, still fail-open).
  - Org-scoped load and `can("resource.read", {type:"pin", id, createdBy})`, else 404.
  - `viewerCanWrite = set.can("resource.write", …)`.
  - Calls `setDbCancelPolicy("always")`, then `executePin`.
  - `200 PinDataResponse`.
  - `@openapi` references the registered `PinDataResponse` component and lists the 404/422/429 responses.
- **`POST /:id/refresh`** and its `@openapi` block are **deleted**. `route-authorization.map.ts` loses the refresh entry and gains `GET /api/portal-results/:id/data` (read).
- **`POST /`** (create, `:118-250`):
  - `materialize` returns `{ content, pipeline }` with no rows.
  - A data type with no derivable pipeline → 422 `PORTAL_RESULT_NOT_REEXECUTABLE`.
  - The insert sets `definerPrincipalType: "user", definerPrincipalId: userId`.
  - The dissolve enqueue passes the definer.
- **`GET /` and `GET /:id`** attach `definer` + `viewerIsDefiner` via `describeMany` / `describe`. Content is returned as stored, with no rows.

### API — `PortalResultPinService.materialize` (`portal-result-pin.service.ts:139`)

- Same signature. `MaterializedPin` drops rows/counts/`snapshotUpdatedAt`, and the `#640` comment (`:45-46`) is resolved.
- `derivePipeline` (`:70`) is unchanged.
- A handle-meta read failure (`:209-211`) no longer degrades to a static snapshot; it yields "no pipeline", so the create is refused.
- `PIN_SNAPSHOT_ROW_CAP` is now used only by `geo.tiled` (whether the source exceeded the inline cap at pin time).

### API — map tiles (`portal-map-tile.service.ts`, `routes/portal-map.router.ts`)

- `resolvePipeline` (`:581`) takes the caller and returns `executeAs: string`:
  - pin: `assertDefinerActive(row).userId`, and `DefinerAccessLostError` → 422 `PORTAL_RESULT_DATA_UNAVAILABLE`;
  - message: the caller.
- It no longer returns `snapshotUpdatedAt`. A pin returns `layerTotal: null`: it stores no count, and the per-tile probe at `cap + 1` already is the raw serve when the tile fits, so the whole-layer fast path saves no query for a pin. (The discovery's Redis-cached `countLayer` was dropped for that reason.) Message blocks keep `layerCountFromContent`.
- `renderTile` (`:1472`) uses `executeAs` for `resolveViewsForSession`, `runTileQuery` (the session tile, the dissolve probe/serve and `enqueueLazyFill`). `authorizeSource` stays on the viewer.
- ETag input drops `snapshotUpdatedAt`. For a pin it adds a freshness bucket, `floor(now / VIZ_REFRESH_FRESHNESS_MS)`: a live pin's tiles must revalidate when its data changes, and without a stored snapshot clock the hash would otherwise never turn over. Message blocks are unchanged.
- `DissolvePrecomputeService.enqueueForPin` callers pass the definer; `reenqueueAllDissolvable` selects `definer_principal_id` instead of `created_by`.

### API — `SeatService.removeMember` (`seat.service.ts:482-563`)

In the same transaction, after the grant delete (`:537`):

```ts
await DbService.repository.policyAttachments.softDeleteByPrincipal("user", target.userId, caller.userId, tx);
```

### Web

- **SDK** (`apps/web/src/api/portal-results.api.ts`): `refresh` (`:95`) is replaced by `data(id)`, a `useAuthQuery` on `queryKeys.portalResults.data(id)` (new in `api/keys.ts:221`, under `.root` so pin invalidation covers it). It sets `staleTime: VIZ_REFRESH_FRESHNESS_MS` and `retry: false` for the three 422 codes.
- **`useWidgetRefresh`** (`utils/use-widget-refresh.util.ts`):
  - For `blockRef.kind === "pin"` it reads the data query: `fresh` = the query data, `dataUpdatedAt` = the query's, and the refresh button calls `refetch()`.
  - `allowed` is true for every reader.
  - `canRefresh` is removed from the pin variant of `BlockRef` (`ContentBlockRenderer.tsx:27-37`).
  - The message branch is unchanged.
- **`PinnedResultDetailView`**:
  - It subscribes to the same query (React Query dedupes to one request) and renders, in place of the block:
    - `PORTAL_RESULT_NOT_REEXECUTABLE` → Alert `pinned-not-reexecutable`: "This pin can't refresh — re-pin it."
    - `DEFINER_ACCESS_LOST` → Alert `pinned-definer-access-lost`: "You no longer have access to the data behind this pin."
    - `DATA_UNAVAILABLE` → Alert `pinned-data-unavailable`: "This pin's data isn't available."
  - `isSnapshotless` and the expired notice are deleted.
  - The metadata list shows the caption "Data as {displayName} sees it" when `!viewerIsDefiner` and the data isn't in an unavailable state.
- **`PinnedResultCardUI`** shows the same caption (props `definerName?: string`), hidden when `viewerIsDefiner`.
- **Chat Pin toggle** (`PortalMessage.component.tsx:199-265`): a block with no `pipeline`, no `sql` and no `queryHandle` gets a `disable` gate: "This result can't be re-run, so it can't be pinned." A handle-only block stays enabled; a server 422 then raises `toast.error(serverErrorMessage(…))`.
- **MapWidget** (`readTileStatus`, `:63`): a tile 422 with `PORTAL_RESULT_DATA_UNAVAILABLE` sets `unavailable`, which renders "This pin's data isn't available." instead of "A map tile failed to load."

### Docs

`faq.util.ts`: one entry, "What do people see when I share a pin?" The answer explains that it's live, shown as you see it, and empties if you lose access. `glossary.util.ts`: the "Pin" definition gets the same note. `system.prompt.ts` doesn't change; the agent never reads pins.

## Migration

Two forward migrations, each generated with `npm run db:generate -- --name <name>` and committed with its `meta/_journal.json` + `<n>_snapshot.json`. They're split because slices 2–5 need the definer columns while the old snapshot path still runs (see the plan).

**0124 `pin-definer-columns`** (slice 1), hand-ordered:

1. `ADD COLUMN definer_principal_type text`, `ADD COLUMN definer_principal_id text`.
2. `UPDATE portal_results SET definer_principal_type = 'user', definer_principal_id = created_by;` (soft-deleted rows included).
3. `SET NOT NULL` on both, then `portal_results_definer_idx`.

**0125 `strip-pin-snapshots`** (slice 6, the cutover):

1. `UPDATE portal_results SET content = content - 'rows' - 'rowCount' - 'matchedCount' - 'matchedCountExact' - 'truncated' - 'queryHandle' WHERE type IN ('data-table','d3','geo');`
2. `ALTER TABLE portal_results DROP COLUMN snapshot_updated_at; -- destructive-ok: snapshots no longer exist (#640)`

Rows are stripped from soft-deleted pins too: a tombstoned pin must not retain gated data. Expand-only otherwise.

## Seed

None. No seeded pins; `demo-seed.service.ts:296` only deletes.

## TDD test plan

API tests are run from `apps/api` with `npm run test:unit` and `npm run test:integration`. Core and web tests are run from their own package with `npm run test:unit`.

### Core — `packages/core/src/__tests__/`

- `contracts/pinned-result.contract.test.ts`: each data kind rejects `rows` (strict) and requires `pipeline`; text is unchanged; geo keeps `tiled`. (6)
- `models/portal-result.model.test.ts`: definer fields required; `snapshotUpdatedAt` gone (replace the 12 existing references). (4)

### API unit — `apps/api/src/__tests__/`

- `services/pin-definer.service.test.ts` (new): active member → userId; no membership → `DefinerAccessLostError`; role type → 500; `describe` name/email/id fallback; `viewerIsDefiner`; `describeMany` issues one query. (7)
- `services/portal-viz-refresh.service.test.ts`: `executePin` runs as the definer, not the viewer; no pipeline → NOT_REEXECUTABLE; lost definer → ACCESS_LOST for a writer, DATA_UNAVAILABLE for a reader; `STALE_REFERENCE` maps the same way; nothing is persisted; a handle delivery carries `portalResultId`. (8)
- `services/portal-result-pin.service.test.ts`: no rows in the output; null sql → no pipeline; a meta failure → no pipeline (not static). (4)
- `services/portal-map-tile.service.test.ts`: a pin tile resolves scope and runs as the definer; a pin's ETag turns over with the freshness window and a message block's doesn't; a lost definer → 422. (3)
- `routes/portal-sql-handle.router.test.ts`: a pin-owned handle is readable by a pin reader who isn't the definer; 404 after unshare; 422 after definer removal; a user handle keeps the old rule. (5)

### API integration — `apps/api/src/__integration__/`

- `routes/portal-results.router.integration.test.ts`:
  - create stores no rows and sets the definer;
  - a static block → 422;
  - GET/list carry `definer` + `viewerIsDefiner`;
  - `POST /:id/refresh` → 404.
  
  (6)
- `routes/portal-pin-data.integration.test.ts` (new; replaces `portal-viz-refresh.integration.test.ts`):
  - a sharee with read-only access sees the **definer's** rows, including columns the sharee's own views hide, and none of the definer's hidden ones;
  - the definer's view filter narrowed → the sharee sees fewer rows on the next call;
  - `removeMember(definer)` → the sharee gets DATA_UNAVAILABLE and an owner gets ACCESS_LOST;
  - zero rows → 200 `[]`;
  - a viewer in org B → 404;
  - the rate window → 429.
  
  (8)
- `services/seat.service.integration.test.ts`: `removeMember` soft-deletes a user-principal attachment, and a later `loadSet` yields nothing from it. (2)
- `routes/portal-map.router.integration.test.ts`: two viewers with different views get identical pin tiles (the definer's); a revoked definer → 422; the 9 `snapshotUpdatedAt` references are updated. (4)
- `queues/dissolve-precompute.processor.integration.test.ts`: the pin enqueue runs under the definer's scopeHash. (2)
- `db/pin-definer-columns.integration.test.ts` (new, 0124): the backfill sets every definer (deleted included) to `created_by`; both columns NOT NULL. (2)
- `db/strip-pin-snapshots.integration.test.ts` (new, 0125): no data row keeps `rows`/counts/`queryHandle`; text untouched; soft-deleted stripped. (4)
- The route-authorization guard picks up the new GET and the deleted POST automatically.

### Web — `apps/web/src/__tests__/` and modules

- `use-widget-refresh.util.test.ts`: the pin branch reads the data query, refetch on refresh, allowed for a read-only viewer; the message branch is unchanged. (5)
- `PinnedResultDetail.test.tsx`: the three state Alerts per code; caption shown for a sharee, hidden for the definer, hidden while unavailable; expired-notice tests removed. (7)
- `PinnedResultsList.test.tsx`: card caption shown/hidden. (2)
- `PortalMessage` test: a static block's Pin is disabled with the reason; a handle-only block is enabled; a 422 toasts. (3)
- `modules/MapWidget/__tests__/MapWidget.test.tsx`: a 422 tile shows the unavailable notice. (1)
- `api/portal-results.api.test.ts` + `cache-invalidation.test.tsx`: the data key is under root. (2)

**Totals ≈ 96 cases.**

## Acceptance criteria

- [ ] No `portal_results` row of a data type holds `rows`, counts or `queryHandle`, before or after any read.
- [ ] A read-only sharee opening a pin sees the definer's current data, live; their own broader or narrower access doesn't change it.
- [ ] Removing the definer from the org, or revoking their access to the pin's views, empties the pin on the next render. Viewers see the neutral message; the definer and managers see the reason.
- [ ] A shared map pin's tiles match its definer's data for every viewer.
- [ ] Pinning a block that can't be re-run is refused (disabled in chat with a reason where the client can tell, else a 422 toast). Legacy ones show "can't refresh — re-pin it".
- [ ] A large pinned table pages for a sharee, and stops after unshare or definer removal.
- [ ] Viewing pins is never charged against tool usage.

## Risks & rollback

- **Destructive migration.** Stored snapshots and `snapshot_updated_at` are gone; a rollback is a forward migration plus a re-pin, never a restore. This is intended: those rows are the gated data. It's detected by the 0125 migration test.
- **Execution cost moves to view time.** Bounded: only the detail view executes, under `statement_timeout`, `viz-refresh:<org>` and the tile `AdmissionGate`. Caching is the recorded follow-up.
- **Fail-closed by construction.** A definer, pipeline, reader role or Redis-backed handle that can't be resolved refuses; nothing stored can be served, because nothing is stored. Only the rate window and the layer-count cache fail open, and neither serves data.
- **Pin-owned handle misuse.** A handle id is a bearer reference: anyone with a pin-owned handle id must still be a pin reader in the pin's org. The unit and integration tests cover a reader who isn't the definer, a non-reader (404) and a cross-org caller.

## Files touched

- **core:** `models/portal-result.model.ts`, `contracts/pinned-result.contract.ts`, `contracts/portal.contract.ts`, `contracts/d3-widget.contract.ts`, `contracts/map-spec.contract.ts`, `ui/ContentBlockRenderer.tsx`, `content/faq.util.ts`, `content/glossary.util.ts`, plus tests.
- **api:**
  - schema and database: `db/schema/portal-results.table.ts`, `zod.ts`, `type-checks.ts`, `drizzle/0124_*`, `drizzle/0125_*` + `meta/*`;
  - services: new `services/pin-definer.service.ts`, `portal-viz-refresh.service.ts`, `portal-result-pin.service.ts`, `portal-sql-handle.service.ts`, `portal-map-tile.service.ts`, `dissolve-precompute.service.ts`, `seat.service.ts`;
  - other: `tools/result-sink.ts`, `routes/portal-results.router.ts`, `routes/portal-sql-handle.router.ts`, `constants/api-codes.constants.ts`, `config/swagger.config.ts`, `__tests__/config/route-authorization.map.ts`, plus tests.
- **web:** `api/portal-results.api.ts`, `api/keys.ts`, `utils/use-widget-refresh.util.ts`, `views/PinnedResultDetail.view.tsx`, `components/PinnedResultsList.component.tsx`, `components/PortalMessage.component.tsx`, `modules/MapWidget/MapWidget.component.tsx`, plus tests.

## Next step

`/plan 640` writes `docs/ALWAYS_LIVE_DEFINER_PINS.plan.md`, about seven TDD slices on this branch:

1. core contracts + table + migration 0124
2. `PinDefinerService` + `removeMember` hardening
3. `executePin` + the data route + refresh removal
4. pin-owned handles
5. tiles/dissolve/count under the definer
6. web data query, states, caption, Pin gate
7. Help/FAQ copy
