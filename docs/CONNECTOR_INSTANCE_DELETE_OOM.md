# Connector-instance delete OOM — Condensed design (#423)

**Issue:** [EnterpriseBT/portal-ai#423](https://github.com/EnterpriseBT/portal-ai/issues/423) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Deleting a connector instance whose entities hold a large record volume OOM-kills the API task (`exit 137`), which with `DesiredCount: 1` is a full app-dev outage — confirmed five times on 2026-08-20. The cascade soft-deletes with `UPDATE … RETURNING *` and uses the result *only* for `result.length`, so 200K `entity_records` rows — each carrying its `data` JSONB — are streamed into Node, decoded, and discarded. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Delete route + cascade | `apps/api/src/routes/connector-instance.router.ts:1255` | one `DbService.transaction`; the four record-scale cascades fan out at `:1294` |
| `entity_records` cascade (plural) | `entity-records.repository.ts:311` | `UPDATE … RETURNING *` → `return result.length`. **The primary offender** |
| `entity_records` cascade (singular) | `entity-records.repository.ts:252` | same shape, same defect; used by `entity-record.router.ts:1168` |
| Sibling cascades | `entity-group-members.repository.ts:313`, `entity-tag-assignments.repository.ts:164`, `field-mappings.repository.ts:378` | all record-scale (one row per record), all `RETURNING *`-to-count |
| Entity cascade | `connector-entities.repository.ts:199` | same shape but entity-scale (a handful of rows) — harmless, fix for consistency |
| **Second caller of the same four** | `connector-entity-validation.service.ts:78-93` | `executeDelete` — deleting one *entity* hits the identical path, so a repository-level fix covers both routes |
| The counts are consumed | `connector-entity.router.ts:849`, `connector-entity-delete.tool.ts:86` | returned as `ConnectorEntityCascadeCounts` to an API response and an agent tool result — the numeric return **must** be preserved |
| Wide-table rows | never touched by this route | `wideTable.softDeleteByEntityRecordIds` (`wide-table.repository.ts:549`) is called by every *other* delete path but not this one |
| Wide-table drop primitive | `wide-table-reconciler.service.ts:284` (`dropTable`) | precedent callers `reset.service.ts:92`, `organization-delete.service.ts:164` — both inside a transaction |

## Decision 1 — count without materializing

Three options: (a) `.returning({ id })` — still 200K rows over the wire; (b) drop the return value to `void` — breaks the two consumers above; (c) drop `.returning()` entirely and read the driver's affected-row count.

**Decision: (c).** Drizzle + postgres-js resolves an `UPDATE` without `.returning()` to a result carrying an affected-row count, so the numeric contract is preserved at zero row transfer. The driver's exact accessor is the one thing here not already proven in-repo (`base.repository.ts:172` reads `.count` from a `select count()`, which is a different shape), so **slice 1's test asserts the returned number against a known row count** — that test is what pins the accessor, not this doc.

**Chunking is *not* needed, contrary to the ticket's fix direction.** The `IN (…)` list holds *connector-entity* ids — a handful — not record ids, so there is no parameter-cap exposure. The 200K lives in the *result set*, which is exactly what we are deleting. One statement, server-side, is both correct and cheapest; `BULK_CHUNK_SIZE` (`entity-records.repository.ts:55`) stays for the paths that genuinely bind per-record parameters.

## Decision 2 — wide-table cleanup

`wideTable.softDeleteByEntityRecordIds` is the wrong tool here: it takes an explicit id array and builds an `IN` list from it, so feeding it 200K ids reintroduces the parameter cap *and* requires the id materialization Decision 1 just removed.

**Decision: call `wideTableReconcilerService.dropTable(entityId, tx)` per entity inside the existing transaction**, matching `reset.service.ts:92` and `organization-delete.service.ts:164`. The whole `er__<entityId>` table belongs to the entity being deleted, so a table-scoped drop needs no id list and is O(1) work. It also clears the `wide_table_columns` metadata rows, which the id-list method does not.

The drop is physical while the instance is only soft-deleted. Accepted: there is no restore path for a connector instance (no `restore`/`undelete` in the router or repository), the raw `entity_records.data` audit trail survives soft-deleted, and both existing callers of `dropTable` make the same trade in equally destructive contexts.

## Enterprise-scale

- **Scale & unbounded growth** — the point of the ticket: row transfer stops scaling with record count. Wall-clock still does (one large `UPDATE` + index maintenance inside the request), so the request stays synchronous; if wall-clock later becomes the ceiling, moving the cascade onto the `jobs` queue is the escalation, deliberately out of scope here.
- **Multi-tenancy** — today one org's delete kills the shared task, i.e. a cross-tenant outage. This removes that blast radius rather than isolating it; per-org throttling is not in scope.
- **Failure modes** — unchanged: one transaction, so a mid-cascade failure still rolls back whole. No partial-delete state is introduced.
- **Concurrency & correctness** — unchanged: `JobLockService.assertConnectorInstanceUnlocked` (`:1275`) still gates the route, and the cascade keeps its single-transaction atomicity.
- Accuracy/auditability, contract stability, data lifecycle — **N/A**: no contract, response shape, or retention semantics change; the cascade counts keep their exact meaning.

## Plan — 2 slices

### Slice 1 — stop materializing rows to count them

**Files** — edit `apps/api/src/db/repositories/`: `entity-records.repository.ts` (both `:252` and `:311`), `entity-group-members.repository.ts:313`, `entity-tag-assignments.repository.ts:164`, `field-mappings.repository.ts:378`, `connector-entities.repository.ts:199` — drop `.returning()`, return the driver's affected-row count. Signatures unchanged (`Promise<number>`).

**Tests** — new `apps/api/src/__tests__/__integration__/db/repositories/entity-records-cascade.repository.integration.test.ts`: seed N records across two entities, assert the returned count equals the rows actually soft-deleted, that only the targeted entities are touched, that already-deleted rows are excluded (the `notDeleted()` predicate), and that a zero-match call returns `0`. Existing `connector-entity-validation.service.test.ts` must stay green — it mocks these methods and asserts the counts surface in `ConnectorEntityCascadeCounts`.

### Slice 2 — drop the wide table in the instance cascade

**Files** — edit `apps/api/src/routes/connector-instance.router.ts:1255`: inside the transaction, after the record cascades and before `connectorEntities.softDeleteByConnectorInstanceId`, loop `entityIds` calling `wideTableReconcilerService.dropTable(id, tx)`. Edit `wide-table-reconciler.service.ts:282` — its JSDoc still reads "Phase-1 caller: tests only", already false for two services and now three (docs-sync rule, `CLAUDE.md`).

**Tests** — extend the delete-route integration coverage: after a delete, assert `er__<entityId>` no longer exists and its `wide_table_columns` rows are gone, and that the route still returns `200 { id }`.

Both slices: `npm run test:unit`, `npm run type-check`, `npm run lint` from `apps/api`.

## Smoke (manual, in app-dev)

**Why not local.** The failure is volume-dependent and the only entity at reported scale — `parcels`, 200K+ records — lives in app-dev. `main` auto-deploys there, so this walk runs post-merge against the deployed stack rather than a local one. app-dev is also the *harshest* available test: its task runs at 512 MB with `--max-old-space-size=7000` (#424), so a pass there is stronger evidence than a local pass with 8 GB would be.

1. Record the pre-state: `aws ecs describe-tasks` for the running `portalai-api-dev` task — note its `startedAt`, so a restart during the walk is unambiguous. Note the record count from `GET /api/connector-instances/:id/impact`.
2. Delete the large instance. **Expect:** `200 { success: true }` — no 502, no app-wide failure, and **no new task**: the `startedAt` from step 1 is unchanged and no task carries `exitCode: 137` / `OutOfMemoryError`. This is the acceptance criterion; everything else is corroboration.
3. Check `AWS/ECS MemoryUtilization` across the delete. **Expect:** no spike tracking the record count — the pre-fix signature was a sharp inflection in the crash minute (38.9% → 52.5% on the last sample before the kill).
4. Confirm the cascade in `portalops db psql --env app-dev`: the instance, its entities and its records all read `deleted IS NOT NULL`, and `\dt er__*` no longer lists the deleted entities' tables.
5. Delete a single connector *entity* (the second caller of the same cascade) and confirm the response's counts report real numbers — not `0`, not `undefined`.
6. Delete an instance with **zero** records: still `200`, counts `0`.
7. With a running job on an instance, confirm the delete still refuses with `409 ENTITY_LOCKED_BY_JOB`.

Steps 5–7 are cheap to run against small instances and are the regression surface for the count contract; step 2 is the bug itself.

## Out of scope

- **The app-dev task-size drift** (#424) — 256 CPU / 512 MB against a template claiming 1024 / 8192, with `--max-old-space-size=7000` inside a 512 MB cgroup. Compounds this bug's severity; neither ticket blocks the other.
- Moving the cascade onto the `jobs` queue with `ENTITY_LOCKED_BY_JOB` + SSE progress — the right answer if wall-clock becomes the ceiling, but it spans api + web + the core job model.
- The `/impact` endpoint's own latency (1.9 s on the 200K entity, vs 9–11 ms on small ones). A read path, not part of the outage.
- The possible "200 having deleted nothing" observation in #423's body — needs its own reproduction before it can be scoped.
