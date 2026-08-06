# Wide-table reap orphans — Condensed design (#327)

**Issue:** [EnterpriseBT/portal-ai#327](https://github.com/EnterpriseBT/portal-ai/issues/327) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A REST connector re-sync soft-deletes the prior run's `entity_records` (watermark reap) but never removes their `er__<connectorEntityId>` wide rows, so the wide table + its GiST/index grow by N on **every** re-sync of a synthetic-sourceId connector (each run mints fresh source ids → full-replacement diff). Reads stay correct — the session views and `fetchProjectedRows` both `JOIN entity_records … WHERE er.deleted IS NULL`, so orphans are filtered out — so this is unbounded storage/bloat, not wrong output (which is why it went unnoticed). Found during #316 smoke; not caused by #316. Single-package (`apps/api`).

**The key fact:** the wide-clean already exists and is the *established* pattern — the Google Sheets, Excel, and layout-plan-draft sync paths all call it right after the reap. **Only the REST adapter omits it.** So this is bringing REST in line, not inventing anything.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Reap (soft-delete transactional rows) | `db/repositories/entity-records.repository.ts:287` `softDeleteBeforeWatermark` | updates `entity_records.deleted`; returns reaped ids; **does not touch the wide table** (by design — it's a repo primitive) |
| Wide-clean primitive | `db/repositories/wide-table.repository.ts:358` `softDeleteByEntityRecordIds(entityId, ids)` | hard-`DELETE`s `er__<id>` rows for the given ids — *"for the watermark-sweep path where the transactional row stays soft-deleted but the wide row should disappear"* |
| ✅ correct: Google Sheets | `adapters/google-sheets/google-sheets.adapter.ts:152–162` | reap → `if (reaped.length) softDeleteByEntityRecordIds(...)` |
| ✅ correct: Excel | `adapters/microsoft-excel/microsoft-excel.adapter.ts:154–160` | same pattern |
| ✅ correct: layout-plan draft | `services/layout-plan-draft.service.ts:541–547` | same pattern |
| ❌ **the gap: REST** | `adapters/rest-api/rest-api.adapter.ts:432–438` (`syncOneEndpoint`) | reaps, uses `reaped.length` only for the `deleted` count — **never cleans the wide rows** |

## Decision — mirror the established pattern

Add the wide-clean the other three adapters already do. In `syncOneEndpoint`, right after the reap:

```ts
const reaped = await DbService.repository.entityRecords.softDeleteBeforeWatermark(
  endpoint.entity.id, runStartedAt, userId
);
if (reaped.length > 0) {
  await DbService.repository.wideTable.softDeleteByEntityRecordIds(endpoint.entity.id, reaped);
}
```

Rejected alternatives: (a) an `ON DELETE CASCADE`-style trigger — the reap is a soft-delete (UPDATE), not a DELETE, so a FK cascade never fires; (b) filtering orphans only on read — already done, but leaves the bloat. The primitive exists precisely for this; use it.

**One-time backfill of already-orphaned rows is out of scope** (below) — the fix stops new orphans; existing ones are harmless (filtered on read) and get swept the next time their record is reaped, or by a separate cleanup.

## Plan — one slice

- **Files:** edit `apps/api/src/adapters/rest-api/rest-api.adapter.ts` (`syncOneEndpoint`, the reap block) — add the guarded `softDeleteByEntityRecordIds` call.
- **Tests:** extend `apps/api/src/__tests__/__integration__/connectors/rest-api.end-to-end.integration.test.ts` — sync a synthetic-sourceId endpoint, assert `er__<id>` has N rows; re-sync (new run watermark), assert `er__<id>` still has **N** (not 2N) and that the reaped rows are gone from the wide table. Run via `cd apps/api && npm run test:integration`.

## Smoke (manual, against your dev stack)

1. Add a REST connector whose entity has **no `idField`** (synthetic source ids), map a couple of fields, and sync. In `db:studio` (or `psql`) note the row count of `er__<connectorEntityId>`.
2. **Re-sync** the same connector.
3. Confirm `SELECT count(*) FROM "er__<connectorEntityId>"` is **unchanged** (the current run's N), not doubled — and `SELECT count(*) FROM "er__<id>" w JOIN entity_records er ON er.id=w.entity_record_id WHERE er.deleted IS NOT NULL` is **0** (no orphans).
4. Sanity: the entity view / an agent `sql_query` count is unchanged and correct across the re-sync.

## Out of scope

- **Backfilling** wide tables that already carry orphans (a one-off `DELETE … WHERE entity_record_id IN (soft-deleted)` maintenance pass) — the fix prevents new orphans; existing ones are read-filtered and low-harm.
- Revisiting whether synthetic-sourceId connectors *should* full-replace every sync (that's the intended REST behavior; this bug is only about cleaning up after it).
- The other adapters — already correct; no change.
