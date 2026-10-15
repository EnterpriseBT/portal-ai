# Curated views in the connector/entity delete cascade — Discovery

**Issue:** [EnterpriseBT/portal-ai#802](https://github.com/EnterpriseBT/portal-ai/issues/802)

**Why this exists.** A curated view sits over exactly one connector entity. Neither entity-level delete knows that. Deleting a connector instance or a single entity soft-deletes the entity's field mappings, records, tag assignments and group members, but leaves its views live. Those views stay listed, stay attached to stations, and answer `500 CURATED_VIEW_FETCH_FAILED` when opened, because the entity is gone and, for an instance delete, so is its `er__<id>` wide table. A station's SQL session is built from every attached view, so one orphan probably degrades the whole station, not just itself. The delete dialogs never mention views, so users can't see what a delete takes with it.

Three related failures in the same domain were folded in during discovery (user-confirmed, 2026-10-14):
- Entity and connector deletes run a minutes-long record UPDATE inside the request (D5).
- Org delete never removes view rows, so it should FK-fail (D6).
- Field-mapping delete leaves views pointing at a deleted column (D7).

This change makes curated views part of the entity's delete cascade, in both delete paths and in their impact counts. It uses one implementation of "delete these views", and a forward migration repairs the views earlier deletes left behind.

## The current shape

### The three delete paths

| Path | Location | Cascade today | Lock / tx |
|---|---|---|---|
| Connector instance delete | `apps/api/src/routes/connector-instance.router.ts:1413` | 1. Hard-deletes `stationInstances.hardDeleteByConnectorInstanceId` (:1443).<br>2. Soft-deletes group members, tag assignments, field mappings and records via `softDeleteByConnectorEntityIds` (:1457–1478).<br>3. Calls `wideTableReconcilerService.dropTable` per entity (:1491).<br>4. Soft-deletes the entities (:1495), then the instance (:1503). | `ObjectAccessService.loadForVerb` (:1421), then `JobLockService.withUnlocked({kind:"connectorInstance"})` (:1438). No audit record. |
| Entity delete | `routes/connector-entity.router.ts:1027` → `ConnectorEntityValidationService.executeDelete` (`services/connector-entity-validation.service.ts:64`) | 1. Soft-deletes the same four children.<br>2. Soft-deletes the entity.<br>3. Returns the four counts.<br>It does **not** drop the wide table. | `loadForVerb` (:1038), `validateDelete` (`refEntityKey` 422), then `withUnlocked({kind:"connectorEntity"})` (:1055). Audit `data.delete` records `{cascaded}`. |
| Entity delete (agent tool) | `tools/connector-entity-delete.tool.ts:86` | Calls `executeDelete(id, userId)` with no tx, so it opens its own. | Runs under the tool's `wrapWithLockGate`. |
| Curated view delete | `routes/curated-view.router.ts:771` | Runs in this order:<br>1. Soft-deletes `curated_view_field_mappings`.<br>2. Soft-deletes `station_views`.<br>3. Hard-deletes `permissionGrants.hardDeleteByResource(org, "curated_view", id)`.<br>4. Hard-deletes `hardDeleteFieldGrantsByCuratedView` (`permission-grants.repository.ts:173`).<br>5. Soft-deletes the view.<br>Returns `cascaded:{fieldMappings, stationViews, grants}`. | `loadForVerb`, then `DbService.transaction`. All of it is inline in the route, and no service exists. |

### Schema

- **`curated_views`** (`db/schema/curated-views.table.ts`) has a NOT NULL `connector_entity_id` FK. The partial index `curated_views_entity_idx` (`WHERE deleted IS NULL`) means "views over these entities" is one indexed `connector_entity_id = ANY(…)`. There are no joins and no secondary source entities, so a view belongs to exactly one entity.
- **`curated_view_field_mappings`** has a view FK and a field-mapping FK. **`station_views`** has a station FK and a view FK. None of these FKs has `onDelete`.
- **Repositories:**
  - `curated-views.repository.ts:53` has `findByConnectorEntityId` (single id); there is no plural variant.
  - `station-views.repository.ts` has `softDeleteByStation` and `softDeleteByStationAndViews`.
  - `curated-view-field-mappings.repository.ts` has `findByCuratedViewId`.

### Readers that break on an orphan

- **The records endpoint:** `curated-view.router.ts:1055` runs `PortalSqlService.queryCuratedViewRecords` → `statementCache.get(view.connectorEntityId)` (`portal-sql.service.ts:365`, :404–443). Any error that isn't an `ApiError` becomes a 500 (:1084).
- **The station SQL session:** it resolves every attached readable view (`portal-sql.service.ts:303–350`). The `station_context` tool reads through it (`tools/station-context.tool.ts:235–251`).
- **Permission expansion:** `in_curated_view` grants are expanded through `curatedViews.findById` (`permission.service.ts:220–239`), so a live grant on an orphan keeps resolving.
- **The views list:** it already tolerates a missing entity (`entity: null`).

### Impact contracts and dialogs

| Piece | Location |
|---|---|
| Instance impact | `GET /:id/impact`, `connector-instance.router.ts:491` → `ConnectorInstanceImpactResponseSchema` (`packages/core/src/contracts/connector-instance.contract.ts:190`): entities, records, field mappings, tag assignments, group members, stations |
| Entity impact | `connector-entity.router.ts:881` → `ConnectorEntityImpactResponsePayloadSchema` (`connector-entity.contract.ts:164`): the four counts + `refFieldMappings` |
| Entity delete response | `ConnectorEntityDeleteResponsePayloadSchema.cascaded` (`connector-entity.contract.ts:148`) |
| Dialogs | `IMPACT_LABELS` arrays in `DeleteConnectorInstanceDialog.component.tsx:30–37` and `DeleteConnectorEntityDialog.component.tsx:~32–39` |
| Web invalidation | Lives at the call sites, not the SDK: `views/Connector.view.tsx:112`, `views/ConnectorInstance.view.tsx:~194–213`, `views/Entities.view.tsx:~305–315`, `views/EntityDetail.view.tsx:~749–808`. None invalidates `queryKeys.curatedViews.root` (`api/keys.ts:180`). |

### Migrations and tests

- **Migrations:** the latest is `drizzle/0120_job-lock-scopes.sql`, so this one is 0121. Data-repair precedents:
  - `0119_scrub-raw-db-job-errors.sql`: an idempotent UPDATE.
  - `0116_backfill-views-page-grant.sql`: epoch-ms `deleted`, `deleted_by='system'`.
  - `lint:migrations` (`scripts/check-migrations.mjs:46–54`) flags DROP, TRUNCATE and type changes, and allows `UPDATE` and `DELETE FROM`.
- **Integration tests:**
  - `__integration__/routes/connector-instance.router.integration.test.ts`: DELETE at :789, impact at :1011.
  - `connector-entity.router.integration.test.ts`: DELETE at :916, impact at :1259.
  - `curated-view.router.integration.test.ts`.
- **Unit tests:** `__tests__/services/connector-entity-validation.service.test.ts` and `__tests__/tools/connector-entity-delete.tool.test.ts`.

## The design space

### Decision 1 — Where the shared view cascade lives

- **A. A service:** `CuratedViewDeleteService.deleteByIds(ctx, viewIds, tx)`. It runs the five steps over a list of ids in batched statements, returns `{curatedViews, fieldMappings, stationViews, grants}`, and is called by all three paths.
- **B. Repository methods:** `softDeleteByConnectorEntityIds` on each view-side repo, called like the existing four children.
- **C. DB `ON DELETE` / triggers:** these don't apply to soft delete.

| | A | B | C |
|---|---|---|---|
| One implementation for all three paths | Yes | No: the view route keeps its own sequence | n/a |
| Grants (hard delete, two shapes) covered | Yes | Each caller must remember to call them | No |
| Batched (no per-view loop) | Yes (`ANY(ids)`) | Yes | n/a |

**Lean: A.** The grants are the step that drifts. A service that owns the whole sequence, including grants, is the only shape where the three paths can't diverge again. The view's own DELETE route calls it with `[id]`.

### Decision 2 — Where the entity-level cascade calls it

- **A.** Inside `ConnectorEntityValidationService.executeDelete`, so the route and the agent tool both get it. The instance route resolves its entities' view ids and calls the service directly in its own sequence.
- **B.** The instance route calls `executeDelete` per entity instead of its own batched sequence.

**Lean: A.** It covers the agent tool for free and keeps the instance delete batched. B would also start dropping the wide table inside a per-entity loop, a change this ticket has no reason to make.

### Decision 3 — Soft- or hard-delete the views' `station_views`

The issue says views are detached "the same way the connector is detached". The connector's `station_instances` rows are **hard**-deleted. The view's own DELETE **soft**-deletes `station_views`, and so does station delete (`station.router.ts:931`).

- **A.** Soft-delete, which is the view-delete behavior, via the shared service.
- **B.** Hard-delete in entity cascades only. This needs a second code path, or a flag on the service.
- **C.** Hard-delete everywhere, including the view route.

**Decided: A** (confirmed by the user, 2026-10-14). Every read excludes soft-deleted `station_views`, so the station stops listing the view either way. Two behaviors for "remove this view" is exactly the drift Decision 1 closes. "The same way" means *in the same step, in the same transaction*.

### Decision 4 — Repairing views already orphaned

- **A. Forward SQL migration 0121.** It soft-deletes live views whose entity is soft-deleted, along with their live `curated_view_field_mappings` and `station_views`. It hard-deletes their `curated_view` resource grants and their `in_curated_view` field grants. It is idempotent and keyed on `connector_entities.deleted IS NOT NULL`.
- **B. A `portalops` one-off.** Every install must remember to run it.
- **C. Lazy:** the records endpoint answers 404 for a view whose entity is gone.

**Lean: A.** It reaches every install through `db:upgrade` (#581) with no operator step, and it is expand-only. Per-table UPDATEs and DELETE FROM pass `lint:migrations`. C would hide the symptom but leave grants and station attachments live, so it is out unless Open question 3 says otherwise.

### Decision 5 — Take the record soft-delete off the request

This was raised during discovery: deleting an entity or connector with many records can take minutes.

**Why it is slow:**
- Both cascades run `entityRecords.softDeleteByConnectorEntityIds` (`entity-records.repository.ts:506`) inline. That is one UPDATE over every record.
- The same body measured 66s at 400K rows when it was the clear route, which is why #453 moved clearing to the `entity_record_clear` job (`queues/processors/entity-record-clear.processor.ts`). 1.5M-row entities are a real target.
- The web gives up at `WRITE_TIMEOUT_MS` (30s) with `REQUEST_TIMEOUT`, saying the write "may still finish". The dialog then shows an ambiguous outcome for an operation that probably committed.
- Every other cascade step is small, user-authored data: mappings, tags, group members, views, attachments and grants.

**Options:**
- **A. Fully async.** The route `enqueueExclusive`s a delete job, and the job runs the whole cascade. The object stays visible, locked, with a "Deleting…" alert, until the job finishes.
- **B. Two-phase.**
  - **Synchronous part:** in the existing `withUnlocked` transaction, the route tombstones everything user-visible: the instance and/or entities, mappings, tags, group members, `station_instances`, and views via the D1 service. The connector/entity disappears and returns 404 at once.
  - **Off-request:** a new job (for example `entity_data_delete`, with metadata `{connectorEntityIds, dropWideTables}`, modeled on `entity_record_clear`) soft-deletes the records and drops each `er__<id>` wide table, for both paths.
  - **Backstop:** the orphan class of `purgeTombstonedBefore` (:461) is extended to also reap *live* records whose entity is soft-deleted. A job that exhausts its retries then self-heals at the orphan retention window, instead of stranding live rows under a dead parent.
- **C. No job.** Tombstone the parent synchronously and never touch the records. The extended purge alone reclaims them after the orphan window.

| | A | B | C |
|---|---|---|---|
| Request time | Enqueue only | Small tables only | Small tables only |
| User sees delete take effect | When the job ends (needs lock alert + "Deleting…" state on a doomed object) | Immediately | Immediately |
| Invariant "no live record under a deleted entity" | Holds after job | Brief gap; job closes it, purge backstops | Gap until purge window |
| New job type + `JOB_LOCK_SCOPES` + label | Yes | Yes | No |
| Wide table reclaimed | Job | Job | Purge window (or still sync drop) |
| Response contract | 202 + job | 200, `cascaded.entityRecords` → job id | 200, `entityRecords` count dropped |

**Lean: B.** The delete reads as done the moment the user confirms. That avoids a lingering "Deleting…" state on an object they've already decided to discard, and avoids the lock UI A needs. Records under a deleted entity are unreachable through every read path anyway, because reads are entity-scoped.

The job keeps the time-to-reclaim short, and it also fixes a pre-existing gap: entity delete never drops its wide table. The purge extension makes a failed job self-heal rather than strand rows. C is the leaner fallback if a new job type isn't wanted, at the price of reclaim waiting for the orphan retention window.

Two things the job must get right:
- **Re-delivery is safe.** It soft-deletes *everything* under a deleted entity, so a stall re-delivery is idempotent, as `entity_record_clear` already argues. No `SyncLockService` lock is needed.
- **Lock scopes.** The job locks its entities' scopes (the instance scope for an instance delete), even though nothing can target a deleted object. That keeps `JOB_LOCK_SCOPES` honest and refuses the job if a straggling write is still in flight.

**Scope: folded into #802** (confirmed by the user, 2026-10-14). The issue body has been amended to match.

### Decision 6 — Org delete with views (now in scope)

`OrganizationDeleteService` (`apps/api/src/services/organization-delete.service.ts`) hard-deletes the org's data table by table in one transaction. It deletes `field_mappings` (~:181), `stations` (~:211) and `connector_entities` (~:232), but never `curated_view_field_mappings`, `station_views` or `curated_views`. Those three tables have plain FKs, with no `onDelete`, to field mappings, stations, entities and views respectively. Soft-deleted rows still hold their FK too. So **any org that has ever had a view should fail to delete with a 23503 FK violation**, and the transaction rolls back. This was found by code read and is not yet reproduced; slice 1 reproduces it with a failing integration test first.

- **A.** Hard-delete the three view tables, org-scoped (all three carry `organization_id`), before `field_mappings` and `stations`. Order: `curated_view_field_mappings`, then `station_views`, then `curated_views`. This mirrors how the service already treats every other table. The view grants are already covered by the trailing org-wide `permission_grants` delete.
- **B.** Call the shared `CuratedViewDeleteService`. It soft-deletes, and a soft-deleted row still blocks the parent's hard delete, so it doesn't fix the bug.

**Lean: A.** Org delete is a hard-delete sweep by design. Add a guard so the next table can't repeat the bug: an integration test that seeds one row in every org-scoped table, then asserts org delete succeeds and leaves nothing behind. The existing `organization-delete.service.integration.test.ts` is where it goes.

### Decision 7 — Field-mapping delete with views (now in scope)

`FieldMappingValidationService.executeDelete` (`services/field-mapping-validation.service.ts:183`) cascades only to group members and the reference counterpart. A view that projects the mapping keeps a live `curated_view_field_mappings` row pointing at a soft-deleted mapping. A view whose `filter` names the column keeps a clause that no longer resolves; `renderFilterGroupToSql` fails closed (`portal-sql.service.ts` ~:464–477). Mapping delete is already refused while the entity has records (`validateDelete`, :114, `409 FIELD_MAPPING_DELETE_HAS_RECORDS`), so this only applies to an empty entity. That is rare, but views over empty entities are real (built before a first sync).

One hazard rules out a naive cascade. **An empty projection means "every column"** (`resolveOneViewColumns`, `portal-sql.service.ts` ~:375–377). Dropping the last projected link therefore silently *widens* the view. Views back `in_curated_view` field grants, so that widening is a permission escalation.

- **A. Refuse.** A new `409 FIELD_MAPPING_DELETE_IN_VIEW` while any live view projects the mapping or filters on its column, naming the views. The field-mapping impact endpoint (`field-mapping.router.ts:932`) gains `curatedViews`.
- **B. Cascade.** Drop the projection link and strip the filter clause, deleting the view when it was the last projected column. This never widens, but it silently rewrites a user's view.
- **C. Mixed.** Cascade the link when other projected columns remain; refuse when it is the last projected column or the filter names it.

| | A | B | C |
|---|---|---|---|
| Can widen a view | No | No | No |
| Rewrites a user's view without asking | No | Yes (and may delete it) | Yes (projection only) |
| User friction | Edit or delete the view first | None | Sometimes |
| Matches existing mapping-delete guards | Yes (`HAS_RECORDS` is a refusal too) | No | Partly |

**Decided: A** (confirmed by the user, 2026-10-15: a field mapping in use shouldn't be deletable). Mapping delete already refuses rather than cascades when data depends on the mapping, and a view is a user-authored object that shouldn't be edited or deleted as a side effect of a column change. This applies only to deleting a single mapping; entity and connector deletes still cascade into their views (D1–D4).

Two more pieces either way:
- The **column-definition delete** path should be checked in the spec for the same gap, if it can delete mappings.
- **Migration 0121** also repairs live `curated_view_field_mappings` rows that already point at a soft-deleted mapping, by soft-deleting the link. A view widened that way today is already widened, so the repair doesn't make it worse. The spec should decide whether to report such views.

## Tradeoff comparison

| | D1: service (A) | D2: in `executeDelete` (A) | D3: soft `station_views` (A) | D4: migration (A) | D5: two-phase (B) | D6: org delete (A) | D7: mapping delete (A) |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (decided) | Yes | Yes (in scope) | Yes | Yes (decided) |
| Contract change | No | `cascaded.curatedViews` | No | No | Delete responses carry `jobId`; record counts move to the job result | No | New 409 code; mapping impact gains `curatedViews` |

## Recommendation

1. **Add `CuratedViewDeleteService.deleteByIds(organizationId, viewIds, userId, tx)`.** It runs, in one transaction-joined sequence:
   1. Soft-deletes the views' `curated_view_field_mappings`.
   2. Soft-deletes their `station_views`.
   3. Hard-deletes their `curated_view` resource grants.
   4. Hard-deletes their `in_curated_view` field grants.
   5. Soft-deletes the views.

   It batches over `viewIds`, is a no-op on `[]`, and returns per-kind counts.
2. **`DELETE /api/curated-views/:id` calls it with `[id]`.** The response shape is unchanged.
3. **`ConnectorEntityValidationService.executeDelete` cascades into it.** It resolves views by `connector_entity_id` before the entity soft-delete, so the route and the `connector_entity_delete` tool both cascade. The response and audit `cascaded` gain `curatedViews`.
4. **The connector-instance DELETE resolves views across all its entities** and calls the service in the same `withUnlocked` transaction, next to `stationInstances.hardDeleteByConnectorInstanceId`.
5. **Add `curatedViewsRepository.findIdsByConnectorEntityIds` and `countByConnectorEntityIds`.** Both are org-scoped and use `deleted IS NULL`.
6. **Contracts:**
   - Add `curatedViews: number` to `ConnectorInstanceImpactResponseSchema`, `ConnectorEntityImpactResponsePayloadSchema` and `ConnectorEntityDeleteResponsePayloadSchema.cascaded`.
   - Both impact endpoints compute it.
   - Update the swagger components.
7. **Web:**
   - Add a `curatedViews` label to both dialogs' `IMPACT_LABELS`.
   - Every success path of both deletes also invalidates `curatedViews.root` and `stations.root`.
   - Fix the CLAUDE.md → Mutation Cache Invalidation list, plus its copilot mirror.
8. **Migration `0121_delete-orphaned-curated-views.sql`.** It is an idempotent forward repair of views whose entity is soft-deleted, covering the views, their links, their attachments and both grant shapes, with a header citing #802.
9. **Two-phase delete (D5).**
   - Both delete paths stop soft-deleting records inline. In the same transaction they enqueue an `entity_data_delete` job through `JobLockService.enqueueExclusive`; the route map's `locks` gains `enqueues`.
   - The job soft-deletes the records and drops the wide tables.
   - `purgeTombstonedBefore`'s orphan class also reaps live records under a soft-deleted entity.
   - The impact endpoints still count records, because the user should know what goes.
   - The delete responses return the `jobId`.
   - The web toasts the outcome as soon as the delete returns. Per the job-trigger toast convention, nothing waits on the job.
10. **Org delete (D6).** Hard-delete `curated_view_field_mappings`, `station_views` and `curated_views` by `organization_id`, before `field_mappings` and `stations`. Add an every-org-scoped-table integration guard.
11. **Field-mapping delete (D7).**
    - `validateDelete` refuses with `409 FIELD_MAPPING_DELETE_IN_VIEW` while a live view projects the mapping or filters on its column. The message names the views.
    - The mapping impact endpoint and its dialog list `curatedViews`.
    - Migration 0121 soft-deletes view links that already point at a deleted mapping.
12. **Tests:**
   - Integration: instance delete and entity delete (route and tool), each with a view that has a station attachment, a resource grant and an `in_curated_view` field grant. Assert the view, links, attachment and grants are gone, the station no longer lists the view, and the impact counts include it.
   - Service unit tests.
   - The migration verified against a scratch DB with seeded orphans.

## Open questions

1. **Impact counts and unreadable views.** The delete removes every view on the entity, including views the deleter can't read (owned, shared narrowly). Should the count include them? **Lean: count all.** The other impact counts (records, mappings) are already unfiltered aggregates. A number reveals no view's identity. An undercount would misstate what the delete does.
2. **Should the records endpoint also 404 when a view's entity is gone, as defense in depth?** **Lean: no.** After this change, and with the migration, no live view can point at a deleted entity, because every entity delete path goes through the cascade. Masking a broken invariant as a 404 would hide the next regression.
3. **Pins whose SQL names a deleted view's key** (`scripts/scan-pinned-pipelines.ts:126`) have no FK and will fail on refresh. **Lean: out of scope.** That is the same failure as deleting a view directly today, and it belongs to pin-dependency tracking, not this cascade.

4. **Should the agent tool `connector_entity_delete` also go two-phase?** **Lean: yes, automatically.** It calls `executeDelete`, so the two-phase split lands in the service and the tool's result reports the `jobId`. Its description then needs the three-surface tool-contract update (CLAUDE.md → Keeping Documentation in Sync).
5. **Is the org-delete FK failure real today?** It was found by code read, not reproduced. **Lean: assume yes.** Slice 1 opens with a failing integration test. If it passes, the investigation goes in the spec, and the fix becomes the guard test alone.

## Enterprise-scale considerations

- **Concurrency & correctness:** the cascade runs inside the existing `withUnlocked` transaction, so it is atomic with the entity delete. No running job can interleave, and a concurrent view create on a deleted entity fails the entity's org/readable load. Lean: no new locking.
- **Accuracy & auditability:**
  - The entity delete audit's `cascaded` gains `curatedViews`.
  - The instance delete still writes no audit record. That is pre-existing, and noted below.
  - Grants are hard-deleted, as the view route already does, so no grant outlives its object.
- **Failure modes:** fail-closed. Any cascade error rolls back the whole delete.
- **Scale:**
  - View cascades use batched `ANY(ids)` statements, not a per-view loop. Views per entity are user-authored, so they are small.
  - The unbounded part, records, moves off-request (D5) so request time no longer scales with entity size.
  - The job's UPDATE should batch, as the retention purge's drain loop does, so one statement doesn't hold row locks across 1.5M rows. That is for the spec to settle.
  - Deletes no longer compete for the shared 10-connection pool (#698) for minutes inside a request.
- **Multi-tenancy:** every lookup and grant delete is keyed by `organization_id`, matching the view route. The migration is org-agnostic but driven only by each row's own entity.
- **Contract stability:** the change adds additive fields to three response schemas. Web consumers read them by key.
- **Data lifecycle:** soft-deleted views fall under existing soft-delete retention, and no new window is introduced.

## What this doesn't decide

- **Audit on instance delete.** The instance delete writes no audit record.
- **Pin breakage (OQ4).**

## Next step

`/spec 802` writes `docs/CURATED_VIEW_DELETE_CASCADE.spec.md` and `/plan 802` writes `.plan.md`. Expected slices:

1. Org delete with views (D6): a failing test, then the fix and the every-table guard. It is independent of the rest and the most severe item.
2. The `CuratedViewDeleteService` plus the view route refactor, with unchanged behavior and the view's tests green.
3. The entity cascade (`executeDelete`), with contract `cascaded` and impact counts.
4. The instance cascade and impact.
5. The field-mapping delete guard (D7), its impact count and its dialog.
6. The web dialogs and invalidation.
7. Migration 0121: orphaned views, and view links to deleted mappings.
8. The `entity_data_delete` job type, its processor and the purge backstop.
9. Both cascades switched to two-phase, with their contracts and web/tool feedback.
