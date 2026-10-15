# Curated views in the delete cascades — Spec

**Issue:** [EnterpriseBT/portal-ai#802](https://github.com/EnterpriseBT/portal-ai/issues/802) · **Discovery:** `docs/CURATED_VIEW_DELETE_CASCADE.discovery.md`

This spec pins the contract for four fixes, all in the curated-view / connector-data delete domain:

- **Delete cascades include views.** Connector-instance and entity deletes delete every view over their entities. They do it through one shared view-delete service, which also detaches the views from stations and removes their grants. Both impact counts include the views.
- **Records are deleted off the request.** The record soft-delete and wide-table drop move into a post-commit `entity_data_delete` job. The retention purge reaps anything that job leaves behind.
- **Org delete stops FK-failing on views.**
- **A field mapping that a view uses can't be deleted.** This holds for the direct delete and for a layout-plan re-commit that would drop it.
- **A forward migration repairs views that earlier deletes orphaned.**

## Key decisions (flag for review)

1. **D1: one service owns "delete these views".** `CuratedViewDeleteService.deleteByIds` is called by the view's own DELETE, `executeDelete`, and the instance DELETE. Station links (`station_views`) are **soft**-deleted, matching the view's own delete (D3, user-confirmed).
2. **D2: the entity cascade lives in `ConnectorEntityValidationService.executeDelete`.** The route and the `connector_entity_delete` tool both get it.
3. **D5: the delete runs in two phases.**
   - **In the request:** everything user-visible is tombstoned in the existing `withUnlocked` transaction.
   - **In that same transaction:** an `entity_data_delete` job row is inserted, then **dispatched after commit**. The job soft-deletes records in batches and drops each `er__<id>` table.
   - **Changed from discovery: the job declares `JOB_LOCK_SCOPES: []`.** Discovery had it lock its entities' scopes.
     - **Why:** `enqueueExclusive` opens its own transaction. It can't join the delete's transaction, and inside the agent tool's lock gate it would self-deadlock: it requests exclusive keys that the gate's open transaction already holds shared, from another connection.
     - **Why `[]` is still honest:** the job only writes data of soft-deleted entities. No route or tool can target those (each answers 404 first), and `JobLockService.resolveScopeKeys` already skips deleted entities, so a scope on them would lock nothing.
     - **What follows:** the job is created with `JobsService.insertRow` (in the transaction) and `JobsService.dispatch` (after commit), not `enqueueExclusive`. The route map's `locks` stays `{ target: … }`.
4. **D5 backstop: the purge gains a third scope, `"stranded"`.** It reaps *live* records under an entity soft-deleted longer ago than the orphan window, and drops that entity's wide table if it still exists. It covers a dispatch that failed after commit, a job that exhausted its retries, and the ~400K records already stranded this way. With it, a failed or never-run job reclaims space late; nothing is lost and nothing is exposed.
5. **D6: org delete hard-deletes the three view tables first.** They are deleted org-scoped, before `field_mappings` and `stations`. An introspected every-org-table assertion guards against the next missed table.
6. **D7: refuse, don't cascade (user-confirmed).**
   - A field mapping can't be deleted while a live view projects it or filters on its `normalizedKey`: `409 FIELD_MAPPING_DELETE_IN_VIEW`.
   - **Extended beyond discovery:** a **layout-plan commit** that would drop such a mapping (`reconcileFieldMappings`, `services/field-mappings/reconcile.ts:231–251`) is refused the same way. This is a third mapping-delete path the discovery survey missed.
   - **Where the check runs:** in `LayoutPlanCommitService.commit`'s pre-flight, and as a pre-check in both commit-enqueue routes, so the user gets a 409, not a failed job.
7. **Changed from discovery: migration 0121 does not touch view links that already point at deleted mappings.**
   - **Why they're harmless:** `resolveOneViewColumns` intersects projection ids with live columns (`portal-sql.service.ts` ~:375–384), so such a link projects nothing.
   - **Why removing them is dangerous:** removing a view's last link would turn "no columns" into "all columns", which widens it.
   - Only views over **deleted entities** are repaired.
8. **Impact counts include every view the delete removes**, readable or not. This matches the other unfiltered aggregates. The **field-mapping** impact, by contrast, **names** views, so it lists only views the caller can read and adds a hidden count for the rest.

## Scope

### In scope

1. `CuratedViewDeleteService` and the refactor of the view DELETE route onto it.
2. View cascade in `executeDelete` (entity route + tool) and in the instance DELETE.
3. `curatedViews` on both impact payloads and both dialogs; web invalidation of `curatedViews.root` + `stations.root` on both deletes.
4. Two-phase delete: the `entity_data_delete` job type (enum migration, metadata/result, label, scopes, processor) and the batched repository method. Delete responses carry `recordsJobId`.
5. Purge `"stranded"` scope.
6. Org delete: the three view tables, plus a guard assertion.
7. `FIELD_MAPPING_DELETE_IN_VIEW`: the field-mapping delete (route + tool), the layout-plan commit pre-flight and enqueue pre-checks, the field-mapping impact and its dialog.
8. Migration 0121 repairing views over deleted entities.
9. Docs: CLAUDE.md, plus the `.github/copilot-instructions.md` mirror (Mutation Cache Invalidation list and the job list), and the descriptions of the `connector_entity_delete` and `field_mapping_delete` tools.

### Out of scope

- **Pins whose SQL names a deleted view's key:** no FK, and the same failure exists today on a direct view delete.
- **An audit record for the instance delete:** pre-existing.
- **A "Deleting…" UI state:** the object is gone on return. Nothing waits on the job.
- **Dangling view links to deleted mappings:** inert (decision 7).
- **Reset (`reset.service.ts`):** wipes everything already, and is local-only.

## Surface

### `CuratedViewDeleteService` (new)

**File: `apps/api/src/services/curated-view-delete.service.ts`**

```ts
export interface CuratedViewCascadeCounts {
  curatedViews: number;      // views soft-deleted
  fieldMappings: number;     // curated_view_field_mappings soft-deleted
  stationViews: number;      // station_views soft-deleted
  grants: number;            // curated_view resource grants + in_curated_view field grants, hard-deleted
}

export class CuratedViewDeleteService {
  /** Delete views and everything that hangs off them, on the caller's tx.
   *  No-op (all zeros) on []. Org-scoped: ids outside `organizationId`
   *  are ignored. Order: links → attachments → grants → views. */
  static async deleteByIds(
    organizationId: string,
    viewIds: string[],
    userId: string,
    tx: DbClient
  ): Promise<CuratedViewCascadeCounts>;

  /** Live view ids over these entities (org-scoped), for the cascades. */
  static async findIdsByConnectorEntityIds(
    organizationId: string,
    connectorEntityIds: string[],
    client?: DbClient
  ): Promise<string[]>;
}
```

All writes are batched: `ANY(viewIds)` statements, not a per-view loop.

**Repository additions:**

| Repository | Method | Notes |
|---|---|---|
| `curated-views.repository.ts` | `findIdsByConnectorEntityIds(organizationId, ids, client)`, `countByConnectorEntityIds(organizationId, ids, client)` | Both use `deleted IS NULL`; served by `curated_views_entity_idx` |
| `curated-view-field-mappings.repository.ts` | `softDeleteByCuratedViewIds(ids, deletedBy, client): Promise<number>` | |
| `station-views.repository.ts` | `softDeleteByCuratedViewIds(ids, deletedBy, client): Promise<number>` | |
| `permission-grants.repository.ts` | `hardDeleteByResources(organizationId, "curated_view", ids, client)`, `hardDeleteFieldGrantsByCuratedViews(organizationId, ids, client)` | The plural forms of `hardDeleteByResource` (:75) and `hardDeleteFieldGrantsByCuratedView` (:173); the singulars become thin wrappers |

**View DELETE** (`routes/curated-view.router.ts:771`): the transaction body becomes `CuratedViewDeleteService.deleteByIds(organizationId, [existing.id], userId, tx)`. The response `cascaded: {fieldMappings, stationViews, grants}` is unchanged (`CuratedViewDeleteResponsePayload`, `curated-view.contract.ts:166`).

### Entity delete

**`ConnectorEntityValidationService.executeDelete`** (`services/connector-entity-validation.service.ts:64`):

```ts
export interface ConnectorEntityCascadeCounts {
  fieldMappings: number;
  entityTagAssignments: number;
  entityGroupMembers: number;
  curatedViews: number;            // new
}
export interface ConnectorEntityDeleteOutcome {
  cascaded: ConnectorEntityCascadeCounts;
  recordsJob: JobSelect;           // inserted in this tx; caller dispatches after commit
}
static async executeDelete(
  connectorEntityId: string,
  organizationId: string,          // new: the view lookup and job are org-scoped
  userId: string,
  client?: DbClient
): Promise<ConnectorEntityDeleteOutcome>;
```

**Body:**
1. Run `CuratedViewDeleteService.deleteByIds` over `findIdsByConnectorEntityIds([id])`.
2. Soft-delete group members, tag assignments and field mappings, as today.
3. Soft-delete the entity.
4. Insert the job with `EntityDataDeleteService.insertJob({organizationId, userId, connectorEntityIds: [id]}, tx)`.

Records are **no longer** soft-deleted here, and `cascaded.entityRecords` is removed.

**Route** (`routes/connector-entity.router.ts:1027`):
- After `withUnlocked` resolves, it calls `EntityDataDeleteService.dispatch(outcome.recordsJob)`.
- A dispatch failure is **logged at error and swallowed**. The delete has committed, and the stranded purge (decision 4) covers it.
- Audit `metadata: { cascaded, recordsJobId }`.

**Tool** (`tools/connector-entity-delete.tool.ts:86`): passes `organizationId`, dispatches each item's job after its `executeDelete` returns, and reports `cascaded` + `recordsJobId` per item.

### Instance delete (`routes/connector-instance.router.ts:1413`)

Inside `withUnlocked`:
1. Hard-delete `station_instances`, as today.
2. Load the entities.
3. Call `CuratedViewDeleteService.deleteByIds` over all their view ids.
4. Soft-delete group members, tag assignments and field mappings (`Promise.all` minus `entityRecords`).
5. Soft-delete the entities, then the instance.
6. Insert the job with `insertJob({organizationId, userId, connectorEntityIds, connectorInstanceId: id}, tx)`. It is skipped when there are no entities.

The `dropTable` loop moves into the job. After commit, the route dispatches the job (failure logged and swallowed). The response becomes `{ id, recordsJobId: string | null }`.

### Impact payloads (`packages/core/src/contracts`)

```ts
// connector-instance.contract.ts:190
ConnectorInstanceImpactResponseSchema = z.object({ …existing, curatedViews: z.number() });
// connector-entity.contract.ts:164
ConnectorEntityImpactResponsePayloadSchema = z.object({ …existing, curatedViews: z.number() });
// connector-entity.contract.ts:148
ConnectorEntityDeleteResponsePayloadSchema = z.object({
  id: z.string(),
  cascaded: z.object({
    fieldMappings: z.number(), entityTagAssignments: z.number(),
    entityGroupMembers: z.number(), curatedViews: z.number(),
  }),
  recordsJobId: z.string(),
});
// connector-instance.contract.ts: new ConnectorInstanceDeleteResponsePayloadSchema
//   = z.object({ id: z.string(), recordsJobId: z.string().nullable() })
```

Both impact endpoints add `curatedViewsRepository.countByConnectorEntityIds(orgId, entityIds)` to their `Promise.all`. The impact still counts `entityRecords`, because the user is told what goes. Swagger components and `@openapi` blocks are updated to match.

### `entity_data_delete` job

**`packages/core/src/models/job.model.ts`:**

```ts
// JobTypeEnum += "entity_data_delete"
/** entity_data_delete (#802) — soft-deletes the records of already
 *  soft-deleted entities in batches and drops their er__<id> tables. Locks
 *  nothing (JOB_LOCK_SCOPES []): every entity it touches is soft-deleted
 *  before it is enqueued, so no route or tool can target them. */
export const EntityDataDeleteMetadataSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  connectorEntityIds: z.array(z.string()).min(1),
  connectorInstanceId: z.string().nullable(),
});
export const EntityDataDeleteResultSchema = z.object({
  recordsDeleted: z.number().int().nonnegative(),
  wideTablesDropped: z.number().int().nonnegative(),
});
// JOB_TYPE_LABELS.entity_data_delete = "Delete connector data"
// JOB_LOCK_SCOPES.entity_data_delete = () => []
```

**Also new:**
- `jobs.table.ts` `jobTypeEnum` += `"entity_data_delete"`, with migration `ALTER TYPE job_type ADD VALUE` (see Migration).
- `processors/index.ts` registers `entity_data_delete: entityDataDeleteProcessor`.

**`EntityDataDeleteService`** (`apps/api/src/services/entity-data-delete.service.ts`, new):
- `insertJob(metadata, tx)` → `JobsService.insertRow(metadata.userId, { type: "entity_data_delete", organizationId, metadata }, tx)`.
- `dispatch(job)` → `JobsService.dispatch(job)`, catching and logging any error.

**Processor** (`queues/processors/entity-data-delete.processor.ts`):
- **Missing metadata:** throws `UnrecoverableError`.
- **Unexpected entity state:** an entity that is *not* soft-deleted is skipped and logged at warn, never touched.
- **Per entity:**
  1. `wideTableReconcilerService.dropTable(entityId)`, which is idempotent (`DROP TABLE IF EXISTS`).
  2. Loop `entityRecords.softDeleteBatchByConnectorEntityId(entityId, userId, PURGE_BATCH_SIZE)` until 0. Each batch is its own statement and transaction.
  3. Invalidate record counts once.
- **Progress:** `processed entities / total`.
- **Re-delivery** is idempotent. There is no `SyncLockService` lock, for the same reasoning as `entity_record_clear`.

**Repository** (`entity-records.repository.ts`, new):

```ts
/** Soft-delete up to `batchSize` live records of one entity; returns the
 *  count (0 terminates the caller's drain). `IN (<subquery> LIMIT n)`. */
async softDeleteBatchByConnectorEntityId(
  connectorEntityId: string, deletedBy: string, batchSize: number, client?: DbClient
): Promise<number>;
```

### Purge backstop

- **`purgeTombstonedBefore`** (`entity-records.repository.ts:461`) becomes `scope: "orphan" | "live" | "stranded"`.
  - **`"stranded"` selects:** `deleted IS NULL` records whose entity has `deleted IS NOT NULL AND deleted < cutoffMs`.
  - **Execution:** a hard delete by `IN (<subquery> LIMIT n)`. The wide rows go via the FK cascade.
  - **Index:** served by the existing `(connector_entity_id, …) WHERE deleted IS NULL` index.
- **The processor** (`entity-record-retention-purge.processor.ts`) drains `"stranded"` with the orphan cutoff. It then calls `dropTable` for each soft-deleted entity past that cutoff that still has `wide_table_columns` rows (`wideTableColumns.findEntityIdsOfDeletedEntitiesBefore(cutoffMs, limit 100)`).
- **The summary** gains `purgedStranded` and `wideTablesDropped`.

### Org delete (`services/organization-delete.service.ts`)

Before the `entityGroupMembers` delete (~:171), hard-delete, each `WHERE organization_id = $org`: `curated_view_field_mappings`, then `station_views`, then `curated_views`. Grants are already covered by the trailing `permission_grants` delete (~:261).

### Field-mapping delete under a view

**`ApiCode.FIELD_MAPPING_DELETE_IN_VIEW`**, in `src/constants/api-codes.constants.ts`, beside `FIELD_MAPPING_DELETE_HAS_RECORDS` (:242).

**`CuratedViewDependencyService`** (`apps/api/src/services/curated-view-dependency.service.ts`, new):

```ts
/** Live views over the mappings' entities that project a mapping id, or whose
 *  `filter` names a mapping's normalizedKey (anywhere in the FilterGroup tree). */
static async findViewsUsingMappings(
  organizationId: string,
  mappings: { id: string; connectorEntityId: string; normalizedKey: string }[],
  client?: DbClient
): Promise<{ id: string; label: string; createdBy: string }[]>;

/** Throws 409 FIELD_MAPPING_DELETE_IN_VIEW when the above is non-empty.
 *  Message: "Cannot delete field mapping "<sourceField>": N curated view(s)
 *  use it. Edit or delete those views first." details: { curatedViewCount }.
 *  No view ids or labels in the error (the caller may not read them). */
static async assertMappingsNotInViews(…same args, sourceLabel: string, client?): Promise<void>;
```

**Core** (`packages/core/src/contracts/filter.contract.ts`): add `collectFilterFields(expression: FilterGroup): Set<string>`, alongside `countConditions`.

**Callers:**
- `FieldMappingValidationService.validateDelete` (:114), after the records check. This covers the route and `field_mapping_delete` tool.
- **Layout-plan commit:** `LayoutPlanCommitService.commit` (pre-flight, beside `assertUniqueEntityTargets` at :133) computes, per existing target entity, the live mappings whose `normalizedKey` the plan no longer binds, and asserts. The same check runs as a pre-check in `connector-instance-layout-plans.router.ts:634` and `layout-plans.router.ts:222` before `enqueueExclusive`. In-job, the processor's existing ApiError handling fails the job with the message.

**Impact** (`field-mapping.contract.ts:186`): `FieldMappingImpactResponsePayloadSchema` gains:

```ts
curatedViews: z.array(z.object({ id: z.string(), label: z.string() })),  // readable only
hiddenCuratedViews: z.number(),                                           // unreadable count
```

### Web

- **Delete dialogs:**
  - `DeleteConnectorInstanceDialog.component.tsx:30` and `DeleteConnectorEntityDialog.component.tsx:30`: add `{ key: "curatedViews", label: "curated views" }` to `IMPACT_LABELS`.
  - `DeleteFieldMappingDialog.component.tsx`: lists the readable views ("Used by view "<label>"") and "+N views you can't see". Delete is disabled when either is non-zero, as it already is when the entity has records (:101–110).
- **Delete success handlers:** each also invalidates `queryKeys.curatedViews.root` (and `stations.root` where it's missing). They are:
  - `views/Connector.view.tsx:108`
  - `views/ConnectorInstance.view.tsx:280`
  - `views/Entities.view.tsx:301`
  - `views/EntityDetail.view.tsx:852`
- **Feedback:** no new UI; the existing navigation and close are unchanged.

## Migration

1. **`0121_delete-orphaned-curated-views.sql`**, a hand-written custom migration (`npm run db:generate -- --custom --name delete-orphaned-curated-views`). It is idempotent, with a header citing #802.
   - **The orphan set:** `curated_views` with `deleted IS NULL` whose entity has `deleted IS NOT NULL`.
   - **Steps, in order:**
     1. `DELETE FROM permission_grants` for `resource_type='curated_view'` and the `resource_id`s in the set.
     2. `DELETE FROM permission_grants` for `resource_type='field_mapping' AND condition='in_curated_view'` and the `condition_param`s in the set.
     3. `UPDATE curated_view_field_mappings` to soft-delete the set's links.
     4. `UPDATE station_views` to soft-delete the set's attachments.
     5. `UPDATE curated_views` to soft-delete the set.
   - **Stamp:** soft deletes use `deleted = (extract(epoch from now())*1000)::bigint` and `deleted_by = 'system'`.
   - **Lint:** passes `lint:migrations` (no DROP, TRUNCATE or type change).
2. **`0122_entity-data-delete-job-type.sql`**, generated: `ALTER TYPE "job_type" ADD VALUE 'entity_data_delete'`. No migration references the new value, so the one-transaction fresh-DB CI run is safe.
3. Commit each `.sql` together with `meta/_journal.json` and its snapshot.

## Seed

No seed change.

## TDD test plan

All commands run from the package: `npm run test:unit` / `npm run test:integration` (api), `npm run test:unit` (core, web).

### api: integration (`apps/api/src/__tests__/__integration__/`)

- **`services/curated-view-delete.service.integration.test.ts` (new): 5 cases.**
  - Two views, each with links, attachments and both grant shapes, are deleted, and the counts match.
  - `[]` is a no-op.
  - A foreign-org id is ignored.
  - A sibling view is untouched.
  - It joins the caller's transaction: a rollback leaves everything live.
- **`routes/curated-view.router.integration.test.ts`:** the existing delete cases stay green (refactor parity).
- **`routes/connector-entity.router.integration.test.ts`: 6 cases.**
  - Delete with a view (attachment + grants): the view, links, attachment and grants are gone, and the station's view list omits it.
  - The response has `cascaded.curatedViews` and `recordsJobId`, and records are still live until the job runs.
  - The job row exists with the entity id.
  - Impact includes `curatedViews` (counting an unreadable view too).
  - A dispatch failure (mocked) still returns 200.
  - The audit metadata carries `recordsJobId`.
- **`routes/connector-instance.router.integration.test.ts`: 5 cases.**
  - Delete across two entities, each with views.
  - The response carries `recordsJobId`.
  - An instance with no entities gives `recordsJobId: null`.
  - The wide tables still exist until the job runs.
  - Impact includes `curatedViews`.
- **`queues/entity-data-delete.processor.integration.test.ts` (new): 5 cases.**
  - Records are soft-deleted in batches (batch size 2 over 5 rows) and the wide table is dropped.
  - Re-running yields `recordsDeleted: 0`.
  - A live (non-deleted) entity id is skipped.
  - Missing metadata throws `UnrecoverableError`.
  - Record counts are invalidated.
- **`db/repositories/entity-records-purge.integration.test.ts`: 4 cases.**
  - `"stranded"` reaps live records under an entity deleted before the cutoff.
  - It ignores an entity deleted after the cutoff.
  - It ignores live entities.
  - The three scopes are exhaustive and don't overlap.
- **`queues/entity-record-retention-purge…` (processor): 1 case.** The stranded drain drops a leftover wide table and reports it.
- **`services/organization-delete.service.integration.test.ts`: 2 cases.**
  - `seedPopulatedOrg` gains a view (link, station attachment, resource grant, field grant). Org delete succeeds; this case fails before the fix.
  - Every `pgTable` exported from `db/schema` that has an `organizationId` column holds zero rows for the target, except a `RETAINED` list with reasons (usage, ledgers, audit, memberships, policies…).
- **`routes/field-mapping.router.integration.test.ts`: 5 cases.**
  - Delete is refused with 409 when a view projects the mapping.
  - It is refused when a view's nested filter names the key.
  - It is allowed once the view is deleted.
  - Impact lists readable views and counts hidden ones.
  - The 409 body carries no view labels.
- **Layout-plan commit (`routes/connector-instance-layout-plans.router.integration.test.ts`): 2 cases.**
  - A re-commit dropping a projected mapping gets a 409 before enqueue, with no job created.
  - A re-commit dropping an unused mapping succeeds.
- **`db/delete-orphaned-curated-views.integration.test.ts` (new, the 0119 test pattern): 3 cases**, run on a scratch DB seeded pre-migration.
  - Orphan views and their links, attachments and grants are repaired.
  - A view over a live entity is untouched.
  - A second run is a no-op.

### api: unit

- `services/connector-entity-validation.service.test.ts`: 2 cases (call order; job inserted with the entity id).
- `tools/connector-entity-delete.tool.test.ts`: 2 cases (dispatch per item; result shape).
- `tools/field-mapping-delete.tool.test.ts`: 1 case (the refusal surfaces as a failure item).
- `services/curated-view-dependency.service.test.ts`: 3 cases (projection hit, nested filter hit, other-entity miss).

### core: unit

- `contracts/filter.contract.test.ts`: 2 cases for `collectFilterFields` (nested groups; empty group).
- `models/job.model.test.ts`: 1 case (`entity_data_delete` scopes are `[]`; metadata requires ≥1 entity id).

### web: unit (`apps/web/src/__tests__/`)

- `DeleteConnectorInstanceDialog.test.tsx` / `DeleteConnectorEntityDialog.test.tsx`: 1 case each (the views count renders when > 0).
- `DeleteFieldMappingDialog.test.tsx`: 3 cases (lists readable views; shows the hidden count; delete disabled).
- **Views:** for each of the 4 delete success paths, one invalidation case spying on `invalidateQueries` (`curatedViews.root`).

**Totals ≈ 59 cases.**

## Acceptance criteria

- [ ] **Entity delete removes its views.** Deleting an entity that has a view attached to a station removes the view from Views and from the station. `/views/<id>` answers 404, not 500, and no grant on that view survives.
- [ ] **Connector delete does the same for every entity's views.** The station's connector link and view links are gone.
- [ ] **Both delete dialogs show a curated-views count** when views exist.
- [ ] **Large deletes return promptly.** Deleting a 400K-record entity returns well under the 30s web timeout. The records are soft-deleted, and the wide table dropped, by an `entity_data_delete` job that appears in Jobs and completes.
- [ ] **Stranded data is reclaimed.** Records stranded by a never-dispatched job are hard-deleted by the next retention purge after the orphan window.
- [ ] **An org with views deletes successfully** and leaves no org-scoped rows outside the retained list.
- [ ] **A field mapping a view uses can't be deleted.** Deleting it is refused with `FIELD_MAPPING_DELETE_IN_VIEW`, and the dialog names the readable views. A layout-plan re-commit that would drop it is refused before any job starts.
- [ ] **After upgrade, no live view points at a deleted entity.** App-dev's existing orphaned views are gone from Views and stations.

## Risks & rollback

- **The job is dispatched after commit**, so the request and the job aren't atomic. **Fail mode:** a missed dispatch leaves live records under a deleted entity. They're unreachable, because every read is entity-scoped, and the stranded purge reclaims them after `ENTITY_RECORD_ORPHAN_RETENTION_DAYS` (7). This is fail-safe for data exposure, at a storage cost only. It's detected by the purge summary's `purgedStranded > 0`.
- **The job has no lock scopes.** If a future path could write to a soft-deleted entity, it would race the job. That's mitigated by the invariant that every write route and tool loads its target with `deleted IS NULL`, and by the scopes rationale recorded in the JSDoc.
- **Contract changes:**
  - Removing `cascaded.entityRecords` and adding `recordsJobId` breaks any external consumer of the entity-delete response. There are none in the repo; web doesn't read `cascaded`.
  - The new 409 can surprise agent flows; the tool descriptions are updated.
- **Commit refusal:** a re-commit refused for a view-used mapping is new friction. The message tells the user to edit or delete the view.
- **Migrations:**
  - 0121 is forward-only and data-only. Rollback is a forward migration, though there's nothing to restore: the repaired views were already broken.
  - 0122's enum value can't be removed. That's harmless.
- **Rollback overall:** revert the PR. Jobs already queued with the type then have no processor and fail via `UnrecoverableError`, and the stranded purge still reclaims their records.

## Files touched

**New:**
- `apps/api/src/services/curated-view-delete.service.ts`
- `apps/api/src/services/curated-view-dependency.service.ts`
- `apps/api/src/services/entity-data-delete.service.ts`
- `apps/api/src/queues/processors/entity-data-delete.processor.ts`
- `apps/api/drizzle/0121_delete-orphaned-curated-views.sql`, `0122_entity-data-delete-job-type.sql`, plus the journal and snapshots
- The new test files above

**Edit (api):**
- Routes: `routes/curated-view.router.ts`, `routes/connector-entity.router.ts`, `routes/connector-instance.router.ts`, `routes/field-mapping.router.ts`, `routes/connector-instance-layout-plans.router.ts`, `routes/layout-plans.router.ts`
- Services: `services/connector-entity-validation.service.ts`, `services/field-mapping-validation.service.ts`, `services/layout-plan-commit.service.ts`, `services/organization-delete.service.ts`
- Repositories: `db/repositories/{curated-views,curated-view-field-mappings,station-views,permission-grants,entity-records,wide-table-columns}.repository.ts`
- `db/schema/jobs.table.ts`, `queues/processors/index.ts`, `queues/processors/entity-record-retention-purge.processor.ts`
- Tools: `tools/connector-entity-delete.tool.ts`, `tools/field-mapping-delete.tool.ts`
- `constants/api-codes.constants.ts`, `config/swagger.config.ts`

**Edit (core):**
- `models/job.model.ts`
- `contracts/{connector-instance,connector-entity,field-mapping,filter}.contract.ts`

**Edit (web):**
- `components/Delete{ConnectorInstance,ConnectorEntity,FieldMapping}Dialog.component.tsx`
- `views/{Connector,ConnectorInstance,Entities,EntityDetail}.view.tsx`

**Docs:**
- `CLAUDE.md`, `.github/copilot-instructions.md`
- The tool `description`s (`connector_entity_delete`, `field_mapping_delete`) and their mirror in `packages/core/src/registries/builtin-toolpacks.ts` (:948, :1006)

## Next step

`/plan 802` writes `docs/CURATED_VIEW_DELETE_CASCADE.plan.md`. It should carve about nine TDD slices on this branch:

1. Org delete with views. This is independent and the most severe, so it starts with its failing test.
2. `CuratedViewDeleteService` and the view route refactor.
3. The entity cascade and impact.
4. The instance cascade and impact.
5. Web dialogs and invalidation.
6. The field-mapping guard (delete, impact, dialog) and the commit pre-flight.
7. Migration 0121.
8. The `entity_data_delete` job type, processor and repository batch method.
9. Both cascades switched to two-phase, plus the stranded purge.

Slices 8–9 land last so the view fixes stand alone if the job work runs long.
