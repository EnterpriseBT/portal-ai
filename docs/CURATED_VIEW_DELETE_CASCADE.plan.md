# Curated views in the delete cascades — Plan

**This plan implements the #802 spec as test-first slices:**
- org delete that tolerates views
- one shared view-delete service, cascaded from the entity and connector deletes, with impact counts and web invalidation
- the field-mapping "in use by a view" refusal, for both a direct delete and a layout-plan re-commit
- the repair migration for already-orphaned views
- the two-phase delete: an `entity_data_delete` job, plus a "stranded" purge backstop

Spec: `docs/CURATED_VIEW_DELETE_CASCADE.spec.md`. Discovery: `docs/CURATED_VIEW_DELETE_CASCADE.discovery.md`. Issue: #802.

There are 11 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/802-curated-views-survive-connector-delete`**: one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly, per `feedback_use_npm_test_scripts`), filtering to the touched files locally (`feedback_test_only_touched_files_locally`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
```

Each slice follows the same loop:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary. When a slice touches `packages/core`, run the root `npm run build` instead, per `feedback_core_model_change_run_full_build`.
5. Move to the next slice.

**Sequencing rationale.** The view fixes land first and stand alone, and the job work lands last:

- **Slice 1:** org delete with views. It is independent of everything else and the most severe bug (an org can't be deleted at all), so it goes first.
- **Slice 2:** `CuratedViewDeleteService` and the view route refactor. Later cascades need this primitive, and the view route's own tests prove parity.
- **Slices 3–4:** the entity cascade, then the instance cascade. Each adds `curatedViews` to its impact and response contracts. Records are still deleted inline at this point, so behavior only grows.
- **Slice 5:** web dialogs and invalidation, which consume the fields from slices 3–4.
- **Slices 6–7:** the field-mapping refusal (direct delete, then layout-plan commit). These are independent of slices 3–5 but share nothing with the job slices, so they sit here.
- **Slice 8:** migration 0121. It needs the cascade semantics from slices 2–4, so it repairs exactly what the cascade now prevents.
- **Slice 9:** the `entity_data_delete` job type, processor and batch repository method. Nothing enqueues it yet.
- **Slice 10:** the "stranded" purge backstop. It lands **before** the switch, so no commit ever has a two-phase delete without its safety net.
- **Slice 11:** both cascades switch to two-phase, with the response contract changes and the tool and docs updates.

---

## Slice 1 — Org delete removes the view tables

Org delete must hard-delete `curated_view_field_mappings`, `station_views` and `curated_views` before their parent rows. A schema-introspected assertion guards against the next missed table.

**Files**

- Edit: `apps/api/src/services/organization-delete.service.ts`: three org-scoped `tx.delete(...)` calls before the `entityGroupMembers` delete (~:171), in the order links, attachments, views.
- Edit: `apps/api/src/__tests__/__integration__/services/organization-delete.service.integration.test.ts`:
  - `seedPopulatedOrg` gains a view over the seeded entity, with one projection link, one `station_views` row on the seeded station, a `curated_view` resource grant and an `in_curated_view` field grant.
  - Add the "every org-id table" case.

**Steps**

1. **Tests (spec: org-delete, 2 cases).**
   - Extend the seed. The existing `beforeAll` delete should now **fail** with 23503, which confirms the bug the discovery found by code read. Record the failure in the commit message.
   - Add the case that walks every exported `pgTable` with an `organizationId` column and asserts zero target rows, except a `RETAINED` map whose entries each carry a reason (`usage`, `tool_usage_ledger`, audit log, `organization_users`, policies/statements…). Seed `RETAINED` from the tables the current suite already asserts are retained.
   - Run both; they fail.
2. **Implement** the three deletes. Green.
3. Lint + type-check.

**Done when:** an org with a view deletes successfully, every non-retained org-scoped table is empty for it, and the control org is intact (the existing case 8).

**Risk:** the introspection may surface *other* tables org delete misses. If so, either fix them in this slice (same bug class) or list them in `RETAINED` with a reason. Don't widen scope silently: note any such finding in the PR body.

---

## Slice 2 — `CuratedViewDeleteService` and the view route refactor

The shared primitive, plus the plural repository methods it needs. The view DELETE route is moved onto it with no behavior change.

**Files**

- New: `apps/api/src/services/curated-view-delete.service.ts`, containing `CuratedViewCascadeCounts`, `deleteByIds` and `findIdsByConnectorEntityIds` (spec Surface).
- Edit: `curated-views.repository.ts`, to add `findIdsByConnectorEntityIds` and `countByConnectorEntityIds`.
- Edit: `curated-view-field-mappings.repository.ts` and `station-views.repository.ts`, to add `softDeleteByCuratedViewIds`.
- Edit: `permission-grants.repository.ts`, to add `hardDeleteByResources` and `hardDeleteFieldGrantsByCuratedViews`. The singular forms become wrappers.
- Edit: `routes/curated-view.router.ts:771`, so the transaction body calls `deleteByIds(org, [id], userId, tx)` and maps the result to the unchanged `cascaded` shape.
- New: `__integration__/services/curated-view-delete.service.integration.test.ts`.

**Steps**

1. **Tests (spec: curated-view-delete service, 5 cases).** Two views, each with full dependents, are deleted and the counts match. `[]` is a no-op. A foreign-org id is ignored. A sibling view is untouched. The service joins the caller's transaction, so a rollback leaves everything live. Run; fail.
2. **Implement** the repository methods and the service. Green.
3. **Refactor** the route. Run `curated-view.router.integration.test.ts` unchanged; it stays green (the parity check).
4. Lint + type-check.

**Done when:** the 5 service cases and the existing view-route delete cases pass. No other caller exists yet.

**Risk:** the order matters for FK validity. The links must be soft-deleted before the view; soft deletes don't trip FKs, but the order is kept to mirror the route. The grant deletes are hard deletes with no FK to the view, so they are order-free.

---

## Slice 3 — Entity delete cascades into views

`executeDelete` deletes the entity's views, and the entity delete response and impact gain `curatedViews`. Records are still soft-deleted inline in this slice.

**Files**

- Edit: `services/connector-entity-validation.service.ts:64`:
  - The signature gains `organizationId`.
  - `ConnectorEntityCascadeCounts` gains `curatedViews`.
  - The body calls `CuratedViewDeleteService.deleteByIds(org, findIdsByConnectorEntityIds(org, [id]), …)` before the entity soft-delete.

  *In this slice the outcome is still the flat counts (with `entityRecords`). Slice 11 reshapes it into `{ cascaded, recordsJob }`.*
- Edit: `routes/connector-entity.router.ts:1027`: pass `organizationId`. The impact endpoint (:881) adds `curatedViews: countByConnectorEntityIds`. Update the `@openapi` blocks.
- Edit: `tools/connector-entity-delete.tool.ts:86`: pass `organizationId`.
- Edit (core): `contracts/connector-entity.contract.ts`, adding `curatedViews` to `ConnectorEntityDeleteResponsePayloadSchema.cascaded` (:148) and to `ConnectorEntityImpactResponsePayloadSchema` (:164).
- Edit: `config/swagger.config.ts`, if the payloads are registered components.

**Steps**

1. **Tests.**
   - **Integration** (spec: connector-entity router cases 1 and 4). Delete an entity whose view has an attachment and grants. The view, links, attachment and grants are gone; the station's view list omits the view; `/api/curated-views/<id>` answers 404. The impact includes `curatedViews`, counting a view the caller can't read.
   - **Unit** (`connector-entity-validation.service.test.ts`, 1 case): the view cascade runs before the entity soft-delete.
   - **Tool unit:** `organizationId` is passed.
   - Run; fail.
2. **Implement.** Green.
3. Root `npm run build` (core contract change), lint, type-check.

**Done when:** the cases above pass, and the existing entity delete and impact cases stay green, with `cascaded` now carrying `curatedViews`.

**Risk:** web fixtures typed against `ConnectorEntityImpactResponsePayload` need `curatedViews` added. The root build catches these (`feedback_core_model_change_run_full_build`).

---

## Slice 4 — Instance delete cascades into views

**Files**

- Edit: `routes/connector-instance.router.ts:1413`. After the entity load, call `deleteByIds` over `findIdsByConnectorEntityIds(org, entityIds)`, inside the existing `withUnlocked`. The impact endpoint (:491) adds `curatedViews`. Update `@openapi`.
- Edit (core): `contracts/connector-instance.contract.ts:190`: add `curatedViews` to `ConnectorInstanceImpactResponseSchema`.

**Steps**

1. **Integration tests** (spec: connector-instance router cases 1 and 5). Delete across two entities, each with views: every view and its dependents are gone, and the station lists none. The impact includes `curatedViews`. Run; fail.
2. **Implement.** Green.
3. Root build, lint, type-check.

**Done when:** the instance delete and impact cases pass. The existing #423 wide-table-drop case still passes, because the drop is still inline at this point.

**Risk:** none beyond slice 3's fixture ripple.

---

## Slice 5 — Web dialogs and cache invalidation

**Files**

- Edit: `apps/web/src/components/DeleteConnectorInstanceDialog.component.tsx:30` and `DeleteConnectorEntityDialog.component.tsx:30`: add `{ key: "curatedViews", label: "curated views" }` to `IMPACT_LABELS`.
- Edit: the delete success handlers in `views/Connector.view.tsx:108`, `views/ConnectorInstance.view.tsx:280`, `views/Entities.view.tsx:301` and `views/EntityDetail.view.tsx:852`. Each adds `queryKeys.curatedViews.root`. The two entity handlers also add `queryKeys.stations.root`, since views detach from stations.
- Edit: `CLAUDE.md` → Mutation Cache Invalidation (the connector instance delete list, plus a new "Entity delete" line) and its mirror, `.github/copilot-instructions.md`.

**Steps**

1. **Tests** (spec: web cases).
   - Each dialog test gets 1 case: the views count renders when it is above 0.
   - One invalidation case per view (4 total), spying on `invalidateQueries` with the shared test `queryClient`.
   - Run; fail.
2. **Implement.** Green.
3. Lint (zero-warning) and type-check.

**Done when:** the 6 web cases pass.

**Risk:** the view tests may need SDK mocks extended for the delete path. Reuse each view's existing delete test scaffolding where it exists.

---

## Slice 6 — Field-mapping delete is refused while a view uses it

**Files**

- Edit (core): `contracts/filter.contract.ts`: add `collectFilterFields(expression)` next to `countConditions` (:149). Edit `contracts/field-mapping.contract.ts:186`: `FieldMappingImpactResponsePayloadSchema` gains `curatedViews: {id,label}[]` and `hiddenCuratedViews`.
- Edit: `constants/api-codes.constants.ts`: add `FIELD_MAPPING_DELETE_IN_VIEW` beside :242.
- New: `services/curated-view-dependency.service.ts`, with `findViewsUsingMappings` and `assertMappingsNotInViews` (spec Surface).
- Edit: `services/field-mapping-validation.service.ts:114`. `validateDelete` asserts after the records check; this covers both the route and the `field_mapping_delete` tool.
- Edit: `routes/field-mapping.router.ts:932`. The impact endpoint returns the readable views (filtered by `PermissionService.loadSet(...).can("resource.read", {type:"curated_view", …})`) and the hidden count.
- Edit (web): `components/DeleteFieldMappingDialog.component.tsx`. List the views and the "+N you can't see" count, and disable delete when either is non-zero (extending :101–110).
- Edit: the `field_mapping_delete` tool `description` (`tools/field-mapping-delete.tool.ts`) and its mirror (`packages/core/src/registries/builtin-toolpacks.ts:1006`): say that a mapping used by a view can't be deleted.

**Steps**

1. **Tests.**
   - **Core unit:** `collectFilterFields` gets 2 cases (nested groups; an empty group).
   - **Dependency service unit:** 3 cases (a projection hit, a nested-filter hit, a miss on another entity).
   - **Integration** (`field-mapping.router.integration.test.ts`, 5 cases): a 409 when a view projects the mapping; a 409 when a nested filter names its key; allowed once the view is deleted; the impact lists readable views and counts hidden ones; the 409 body carries no labels.
   - **Tool unit:** 1 case.
   - **Web dialog:** 3 cases.
   - Run; fail.
2. **Implement**, in this order: core, the code, the service, the validation hook, the impact, the dialog, the descriptions. Green.
3. Root build, lint, type-check.

**Done when:** the 15 cases above pass, and `builtin-toolpacks.test.ts` and `system.prompt.test.ts` stay green.

**Risk:** the integration fixtures must create the view *before* any records exist, because mapping delete is already refused when records exist and that 409 would mask this one. Assert the code, not just the status.

---

## Slice 7 — A layout-plan re-commit can't drop a mapping a view uses

**Files**

- Edit: `services/layout-plan-commit.service.ts`. Add a private pre-flight `assertNoViewMappingsDropped(plan, organizationId, connectorInstanceId)`, called beside `assertUniqueEntityTargets` (:133), before any write. For each plan target whose entity already exists, the dropped mappings are the live mappings whose `normalizedKey` the plan's bindings no longer produce, using `resolveNormalizedKey` from `field-mappings/reconcile.ts:99`. They then go through `CuratedViewDependencyService.assertMappingsNotInViews`.
- Edit: `routes/connector-instance-layout-plans.router.ts:634` and `routes/layout-plans.router.ts:222`: call the same pre-flight before `enqueueExclusive`. The pre-flight is exposed as `LayoutPlanCommitService.assertCommitKeepsViewMappings(...)`.

**Steps**

1. **Integration tests** (spec: layout-plan commit, 2 cases).
   - A re-commit that drops a projected mapping gets a 409 `FIELD_MAPPING_DELETE_IN_VIEW` from the route, and no `jobs` row is created.
   - A re-commit that drops an unused mapping succeeds.
   - Run; fail.
2. **Implement.** Green.
3. Lint, type-check.

**Done when:** both cases pass, and the existing commit and layout-plan suites stay green.

**Risk:**
- Computing "dropped" must reuse reconcile's own key derivation, or the pre-check and the actual reconcile could disagree. Importing `resolveNormalizedKey` keeps them on one implementation.
- The in-job re-check (inside `commit`) is the race backstop. A view created between the pre-check and the job fails the job with the same message, which is acceptable.

---

## Slice 8 — Migration 0121 repairs views orphaned by earlier deletes

**Files**

- New: `apps/api/drizzle/0121_delete-orphaned-curated-views.sql`, generated with `npm run db:generate -- --custom --name delete-orphaned-curated-views`, then hand-written per the spec's Migration section. Commit it with `meta/_journal.json` and its snapshot (`project_drizzle_journal_must_be_committed`).
- New: `__integration__/db/delete-orphaned-curated-views.integration.test.ts`. It follows the existing data-migration test pattern in `__integration__/db/scrub-raw-db-job-errors.integration.test.ts` (0119) and `job-lock-scopes-backfill.integration.test.ts`: seed rows, execute the migration's SQL, assert.

**Steps**

1. **Tests** (spec: migration, 3 cases).
   - The orphaned view's links, attachments and both grant shapes are repaired.
   - A view over a live entity is untouched.
   - A second run is a no-op.
   - Run; fail.
2. **Write the SQL.** Green. Run `npm run lint:migrations`.
3. Verify against a scratch DB that has seeded orphans (`project_migration_enum_added_value_unsafe` practice), then run `npm run db:migrate` locally.

**Done when:** the 3 cases pass and `lint:migrations` is clean.

**Risk:** `deleted` is epoch-ms `bigint`. Mirror 0116's expression exactly.

---

## Slice 9 — The `entity_data_delete` job type and processor

**Files**

- Edit (core): `models/job.model.ts`:
  - `JobTypeEnum` gains `entity_data_delete`.
  - Add `EntityDataDeleteMetadataSchema` and `EntityDataDeleteResultSchema`, plus the type-map entries (~:619 and ~:671).
  - Add the `JOB_TYPE_LABELS` entry "Delete connector data", and `JOB_LOCK_SCOPES.entity_data_delete = () => []`, with the JSDoc rationale from the spec.
- Edit: `db/schema/jobs.table.ts:23`: `jobTypeEnum` gains the value. Generate `drizzle/0122_entity-data-delete-job-type.sql` with `npm run db:generate -- --name entity-data-delete-job-type`, and commit it with the journal and snapshot.
- Edit: `db/repositories/entity-records.repository.ts`: add `softDeleteBatchByConnectorEntityId`.
- New: `services/entity-data-delete.service.ts`, with `insertJob` and `dispatch`. `dispatch` catches errors and logs them.
- New: `queues/processors/entity-data-delete.processor.ts`, registered in `queues/processors/index.ts:28`.
- New: `__integration__/queues/entity-data-delete.processor.integration.test.ts`.

**Steps**

1. **Tests.**
   - **Core unit:** 1 case (the scopes are `[]`; metadata requires at least one id).
   - **Processor integration:** 5 cases.
     - Records are soft-deleted in batches (batch 2 over 5) and the wide table is dropped.
     - A re-run yields `recordsDeleted: 0`.
     - A non-deleted entity is skipped.
     - Missing metadata throws `UnrecoverableError`.
     - Record counts are invalidated.
   - Run; fail.
2. **Implement**, in this order: core, the enum, the migration, the repository, the service, the processor. Green.
3. Root build, lint, type-check, `lint:migrations`.

**Done when:** all 6 cases pass. Nothing enqueues the job yet.

**Risk:**
- Type-check fails until all three places know the type (#777): `JOB_TYPE_LABELS`, `JOB_LOCK_SCOPES` and the processor map. That is expected, which is why they land together.
- 0122 must not share a migration with any SQL that names the new value.

---

## Slice 10 — Purge backstop for stranded records

**Files**

- Edit: `db/repositories/entity-records.repository.ts:461`: `purgeTombstonedBefore` takes `scope: "orphan" | "live" | "stranded"`. Update the JSDoc's exhaustiveness note: there are now three scopes, and "stranded" covers *live* rows.
- Edit: `db/repositories/wide-table-columns.repository.ts`: add `findEntityIdsOfDeletedEntitiesBefore(cutoffMs, limit)`.
- Edit: `queues/processors/entity-record-retention-purge.processor.ts`: drain `"stranded"` at the orphan cutoff, then drop leftover wide tables. The summary gains `purgedStranded` and `wideTablesDropped`.

**Steps**

1. **Tests.**
   - **Repository** (`entity-records-purge.integration.test.ts`, 4 cases): "stranded" reaps live records under an entity deleted before the cutoff; it ignores an entity deleted after the cutoff; it ignores live entities; the scopes don't overlap.
   - **Processor:** 1 case (a leftover wide table is dropped and reported).
   - Run; fail.
2. **Implement.** Green.
3. Lint, type-check.

**Done when:** the 5 cases pass, and the existing purge cases stay green.

**Risk:** the purge summary is the job's `returnvalue`. Adding fields is additive.

---

## Slice 11 — Switch both cascades to two-phase

**Files**

- Edit: `services/connector-entity-validation.service.ts`:
  - Return `ConnectorEntityDeleteOutcome { cascaded, recordsJob }`.
  - Drop `entityRecords` from the `Promise.all` and from the counts.
  - Insert the job via `EntityDataDeleteService.insertJob` on the transaction.
- Edit: `routes/connector-entity.router.ts`:
  - Dispatch after `withUnlocked` resolves.
  - The response is `{ id, cascaded, recordsJobId }`, and the audit metadata gains `recordsJobId`.
  - Update `@openapi`.
- Edit: `routes/connector-instance.router.ts`:
  - Remove `entityRecords` from the `Promise.all` and remove the `dropTable` loop; the job does both.
  - Insert the job when there are entities, then dispatch after commit.
  - The response is `{ id, recordsJobId }`. Update `@openapi`.
- Edit (core):
  - `connector-entity.contract.ts`: `ConnectorEntityDeleteResponsePayloadSchema` per the spec, dropping `cascaded.entityRecords` and adding `recordsJobId`.
  - `connector-instance.contract.ts`: add `ConnectorInstanceDeleteResponsePayloadSchema`.
- Edit: `tools/connector-entity-delete.tool.ts`: dispatch per item and add `recordsJobId` to the result. Update its `description` and the mirror at `builtin-toolpacks.ts:948`, which should now say the records are removed in the background.
- Edit: `CLAUDE.md` → Async Job State, adding `entity_data_delete` to the examples, plus the copilot mirror.
- Update the existing instance-delete test that asserted the inline `er__` drop (#423). It now asserts the table still exists until the job runs, then is gone after the processor runs.

**Steps**

1. **Tests.**
   - **Entity router** (spec cases 2, 3, 5 and 6): the response has `recordsJobId` and the records are still live; the job row exists; a mocked dispatch failure still returns 200; the audit carries `recordsJobId`.
   - **Instance router** (spec cases 2–4): `recordsJobId` is present; an instance with no entities returns `null`; the wide tables still exist until the job runs.
   - **Unit:** `executeDelete` inserts the job (1 case), and the tool dispatches per item (1 case).
   - Run; fail.
2. **Implement.** Green.
3. **End to end** (integration): delete an entity, run the processor through the queue test util, and assert the records are soft-deleted and the wide table is gone.
4. Root build, lint, type-check.

**Done when:** all cases pass, and slices 2–4's cascade cases stay green under the new shape.

**Risk:**
- **Dispatch-after-commit inside the agent tool's lock gate.** `dispatch` touches only Redis and the jobs row, and takes no advisory locks, so it can't deadlock against the gate's open transaction. Assert this with the tool test running under `wrapWithLockGate` if the harness allows it.
- **Org delete with an `entity_data_delete` job in flight.** Org delete cancels queued jobs, and an active one blocks it with a 409 (#197). That's acceptable, since the job is short-lived. Note it in the smoke.

---

## Sequence summary

| # | Slice | Gate |
|---|---|---|
| 1 | Org delete removes the view tables, plus the every-table guard | Org-delete integration suite |
| 2 | `CuratedViewDeleteService` and the view route refactor | 5 service cases + view route parity |
| 3 | Entity cascade, response and impact `curatedViews` | Entity router + unit; root build |
| 4 | Instance cascade and impact `curatedViews` | Instance router; root build |
| 5 | Web dialogs and invalidation, CLAUDE.md list | 6 web cases |
| 6 | Field-mapping delete refusal, impact, dialog and tool description | 15 cases; root build |
| 7 | Layout-plan commit refusal | 2 integration cases |
| 8 | Migration 0121 | 3 cases + `lint:migrations` |
| 9 | `entity_data_delete` type, processor and 0122 | 6 cases; root build |
| 10 | Stranded purge backstop | 5 cases |
| 11 | Two-phase switch: contracts, tool, docs | Router, unit and end-to-end cases; root build |

That is about 59 cases in total, matching the spec.

## Cross-slice notes

- **Migration ordering.** 0121 (slice 8) is data only. 0122 (slice 9) is the enum `ADD VALUE` alone. If `main` gains a migration before this merges, renumber both, and their journal entries, on rebase.
- **The contract changes ripple into web fixtures** (slices 3, 4, 6, 11). Always run the root build at those boundaries; per-package type-check misses them.
- **Doc sync is done in the slices that change behavior**, not as a separate slice:
  - CLAUDE.md invalidation list in slice 5
  - `field_mapping_delete` description and mirror in slice 6
  - `connector_entity_delete` description and mirror, and CLAUDE.md async jobs, in slice 11
  - `system.prompt.ts` only needs a change if it describes delete semantics; check it in slices 6 and 11.
- **Records stay deleted inline until slice 11.** That keeps every earlier slice's tests valid against current behavior. Slice 11 is the only one that changes what a delete leaves behind.
- **Local dev:** `npm run dev` seeds but doesn't migrate (`project_dev_seeds_not_migrates`), so run `db:migrate` after slices 8–9 before any manual check.
- **Smoke and adversarial:** after slice 11, `/smoke 802` and `/adversarial-review 802`. Probes worth seeding:
  - delete during a running sync (expect the existing 409)
  - a view created mid-commit
  - an orphan-window purge run
  - org delete with a pending `entity_data_delete` job

## Next step

Once discovery, spec and plan are reviewed and confirmed, implementation begins on this branch with slice 1, tests first, one commit per slice. Open the draft PR (`Closes #802`) alongside the first implementation commit if it isn't open yet.
