# Delete-all-records via a server-side join — Condensed design (#451)

**Issue:** [EnterpriseBT/portal-ai#451](https://github.com/EnterpriseBT/portal-ai/issues/451) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The "delete all records for this entity" route reads **every** live record id into a JS array (`SELECT id …`) purely to hand them back to the wide-table cascade as an id list. On a routine ~400K-record ArcGIS entity that materialises ~40 MB of UUID strings for the duration of a transaction on a 512 MB app-dev task, and (post-#436) issues ~800 chunked statements where a single join would do. The rows are locatable by a join against the just-soft-deleted set, so the id list is unnecessary. Single-package (`apps/api`), no schema or external-contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The route | `apps/api/src/routes/entity-record.router.ts:1472-1494` | `SELECT id … liveIds` → `ids` array → `softDeleteByConnectorEntityId` + `markDeletedByEntityRecordIds(ids)` in one tx |
| Record soft-delete | `apps/api/src/db/repositories/entity-records.repository.ts:266-285` | `softDeleteByConnectorEntityId` — **needs no ids** (`WHERE connector_entity_id = ?`) and already **returns `result.count`** from the driver (no row materialisation, #423) |
| Wide cascade (id-list) | `apps/api/src/db/repositories/wide-table.repository.ts:646-665` | `markDeletedByEntityRecordIds(ids, deletedAt)` — the bounded primitive the route currently feeds the whole id set |
| Wide cascade (join, reap) | `wide-table.repository.ts:683-710` | `markDeletedFromRecords` — a chunked `UPDATE … FROM entity_records` join, ids never leave Postgres; but documented as the **out-of-transaction self-healing reap**, deliberately separate from the request path (#440/#441/#456) |
| #450 intent | `wide-table.repository.ts:635-644` | the **bounded request path** marks record + wide in one tx (zero orphan window); the reap path stays out of a giant tx |

## Decision — add a scoped join primitive `markDeletedByConnectorEntity`

The issue proposes a `DELETE … USING` join; since #450 the wide cascade is a **soft mark** (`SET deleted = …`, tombstone the view filters on), so it must be an `UPDATE … FROM` join, not a `DELETE`. Two ways to get the join without an id list: (a) reuse `markDeletedFromRecords`, or (b) add a purpose-built primitive.

**Chosen: (b) — add `markDeletedByConnectorEntity(connectorEntityId, client)`** to `wide-table.repository.ts`. It runs one `UPDATE er__<id> w SET "deleted" = er."deleted" FROM entity_records er WHERE er.id = w.entity_record_id AND er.connector_entity_id = $1 AND er.deleted IS NOT NULL AND w.deleted IS NULL` — scoped to the entity, inheriting `er.deleted` so record and wide tombstones carry the **same** timestamp, ids never materialised, one statement. Reusing `markDeletedFromRecords` was rejected: its documented contract is the *out-of-transaction* reap, and calling it inside the request tx repurposes it against its own docstring. The new primitive mirrors #450's existing split (`markDeletedByEntityRecordIds` bounded vs `markDeletedFromRecordsBestEffort` reap) — this is the bounded, id-less member of that family. A single unbounded statement (no chunk) matches the record side, whose `softDeleteByConnectorEntityId` is already one unbounded `UPDATE`. `markDeletedByEntityRecordIds` stays — the five watermark-reap/layout callers legitimately have a bounded id list.

## Plan — 1 slice

**Slice 1 — join primitive + route rework.**
- **Files:**
  - `apps/api/src/db/repositories/wide-table.repository.ts` — add `markDeletedByConnectorEntity(connectorEntityId, client = db): Promise<void>` (the single-statement `UPDATE … FROM` above), documented as the bounded delete-all cascade that commits in the caller's tx alongside the record soft-delete.
  - `apps/api/src/routes/entity-record.router.ts` — in the `DELETE "/"` tx, drop the `SELECT id … liveIds` and `ids` array; `const count = await …entityRecords.softDeleteByConnectorEntityId(connectorEntityId, userId, tx)`; `if (count === 0) return 0;` then `await …wideTable.markDeletedByConnectorEntity(connectorEntityId, tx)`; `return count`.
- **Tests:**
  - `apps/api/src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts` — new case: given N records with wide rows, soft-delete the records then `markDeletedByConnectorEntity` marks exactly the wide rows (`deleted` set = `er.deleted`), leaves an unrelated entity's wide table untouched, and is a no-op when nothing is orphaned.
  - `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` — extend/add: `DELETE` on an entity with records + wide rows clears both `entity_records` (`deleted IS NOT NULL`) and its `er__<id>` rows, returns `deleted === <record count>`, and a second `DELETE` returns `0`.
  - Run `npm run test:integration -- --testPathPattern "wide-table.repository|entity-record.router"` from `apps/api/`.

## Smoke (manual, against your dev stack)

1. Sync (or seed) a connector entity with a non-trivial record count so `entity_records` and its `er__<id>` wide table both have rows.
2. `DELETE /api/connector-entities/{id}/records` (via the API or the entity view) → 200 with `deleted` = the live record count.
3. In `db:studio` / psql: `SELECT count(*) FROM entity_records WHERE connector_entity_id = '<id>' AND deleted IS NULL` → `0`; `SELECT count(*) FROM "er__<id>" WHERE deleted IS NULL` → `0`. Both tombstoned, sharing the same `deleted` timestamp.
4. Re-issue the same `DELETE` → 200 with `deleted: 0` (idempotent no-op).
5. The entity view record count reads `0`; an unrelated entity in the same instance is unaffected.
6. (Scale sanity) On a large entity (~100K+ rows) the delete completes without the memory footprint of the old id-array path.

## Out of scope

- **#453** (the entity-view "Delete records" UI action) — this ticket unblocks it by removing the latent inefficiency; the affordance itself is #453.
- **`markDeletedByEntityRecordIds` and the watermark-reap callers** — they keep the id-list primitive; it is correct for a bounded set.
- **Generalising the "materialise an unbounded id array" pattern across #436/#440** — the epic (#444) may fold these; this ticket fixes only the delete-all route.
