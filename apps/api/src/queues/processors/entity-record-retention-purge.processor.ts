import { DbService } from "../../services/db.service.js";
import { wideTableReconcilerService } from "../../services/wide-table-reconciler.service.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "entity-record-retention-purge" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows deleted per DELETE statement — bounds each statement's lock time;
 *  the loop drains the backlog batch by batch. Smaller than the ledger's
 *  10,000 would be safer still, but each batch here also cascades to the
 *  per-entity wide table, and 10,000 measured fine against an 8 GB table. */
export const PURGE_BATCH_SIZE = 10_000;

/** The run summary — the BullMQ return value, kept on the completed job. Reports both
 *  cutoffs so an operator can tell which windows were actually in effect
 *  without reading the env off the task. */
export interface EntityRecordRetentionPurgeSummary {
  purgedOrphan: number;
  purgedLive: number;
  /** #802: live records hard-deleted from under entities deleted before the
   *  orphan cutoff — an `entity_data_delete` job that never finished. */
  purgedStranded: number;
  /** #802: `er__<id>` tables dropped for such entities. */
  wideTablesDropped: number;
  batches: number;
  orphanCutoff: string;
  liveCutoff: string;
}

/**
 * Daily retention purge for soft-deleted `entity_records` (#442).
 *
 * `entity_records` rows are only ever soft-deleted, and until this existed
 * nothing purged them — 77% of a 5.1M-row table on one dev box. The cost is
 * not disk. Tombstones count toward `reltuples`, which sets the autoanalyze
 * threshold at `50 + 0.1 × reltuples`, so a bloated table spends most of a
 * sync on stale statistics — and stale statistics are what made the sync's
 * per-record lookup mis-plan at 36ms/record before #440 batched it. The loop
 * was self-reinforcing: tombstones → mis-planned syncs → longer runs → a
 * wider window for the transient failure #435 fixed → a failed retry adds
 * another ~400K tombstones.
 *
 * Two windows, one per retention class (see the repository method for why the
 * discriminator is the parent entity rather than a `deleted_reason` column).
 * Each drains independently, so a huge orphan backlog cannot starve the live
 * scope of its run.
 *
 * #450 makes this the drain for wide-table tombstones too. Since #450 the wide
 * row is soft-deleted in place (`er__<id>."deleted"`) rather than physically
 * removed, so it persists until this purge hard-deletes its parent
 * `entity_records` row — the wide table's `ON DELETE CASCADE` then removes the
 * wide tombstone with it. No separate wide-table purge is needed; the two
 * share one retention window by construction.
 *
 * A pure DELETE loop — safe to double-run by construction, so scheduler
 * concurrency needs no guard beyond the maintenance worker's `concurrency: 1`.
 */
/** Leftover wide tables dropped per run — bounds the run; the rest go next
 *  time. Also the page size of each lookup. */
const WIDE_TABLE_DROP_LIMIT = 100;

/**
 * #802: drop the `er__<id>` tables of entities deleted before `cutoffMs`.
 * Their records are gone by now (the stranded drain ran first), so this only
 * reclaims the empty tables. A table that won't drop (a lock timeout) is
 * logged and excluded from the rest of the run, which keeps paging, so a few
 * stuck tables can't hold back the newer ones behind them; they're retried
 * next run.
 */
async function dropLeftoverWideTables(cutoffMs: number): Promise<number> {
  const failed: string[] = [];
  let dropped = 0;
  while (dropped < WIDE_TABLE_DROP_LIMIT) {
    const entityIds =
      await DbService.repository.wideTable.findEntityIdsWithTableDeletedBefore(
        cutoffMs,
        WIDE_TABLE_DROP_LIMIT,
        [...failed]
      );
    if (entityIds.length === 0) break;
    for (const connectorEntityId of entityIds) {
      try {
        await wideTableReconcilerService.dropTable(connectorEntityId);
        dropped += 1;
      } catch (error) {
        failed.push(connectorEntityId);
        logger.warn(
          {
            connectorEntityId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Could not drop a deleted entity's wide table; next run retries"
        );
      }
    }
  }
  return dropped;
}

export const entityRecordRetentionPurgeProcessor = async (opts?: {
  /** Test seam — production runs use PURGE_BATCH_SIZE. */
  batchSize?: number;
  /** Test seam — production runs use the wall clock. */
  now?: number;
}): Promise<EntityRecordRetentionPurgeSummary> => {
  const batchSize = opts?.batchSize ?? PURGE_BATCH_SIZE;
  const now = opts?.now ?? Date.now();

  const orphanCutoffMs =
    now - environment.ENTITY_RECORD_ORPHAN_RETENTION_DAYS * DAY_MS;
  const liveCutoffMs = now - environment.ENTITY_RECORD_RETENTION_DAYS * DAY_MS;

  logger.info(
    {
      orphanCutoff: new Date(orphanCutoffMs).toISOString(),
      liveCutoff: new Date(liveCutoffMs).toISOString(),
      batchSize,
    },
    "Entity-record retention purge started"
  );

  let batches = 0;

  /** Drain one scope to zero. The terminating zero is a real call — that is
   *  what makes the loop safe to re-enter rather than reliant on a count. */
  const drain = async (
    scope: "orphan" | "live" | "stranded",
    cutoffMs: number
  ): Promise<number> => {
    let purged = 0;
    for (;;) {
      const deleted =
        await DbService.repository.entityRecords.purgeTombstonedBefore(
          cutoffMs,
          batchSize,
          scope
        );
      if (deleted === 0) break;
      purged += deleted;
      batches += 1;
    }
    return purged;
  };

  const purgedOrphan = await drain("orphan", orphanCutoffMs);
  const purgedLive = await drain("live", liveCutoffMs);
  // #802: the backstop for a two-phase delete whose `entity_data_delete` job
  // never finished — live records under an entity deleted longer ago than
  // the orphan window, then that entity's leftover wide table.
  const purgedStranded = await drain("stranded", orphanCutoffMs);
  const wideTablesDropped = await dropLeftoverWideTables(orphanCutoffMs);

  const summary: EntityRecordRetentionPurgeSummary = {
    purgedOrphan,
    purgedLive,
    purgedStranded,
    wideTablesDropped,
    batches,
    orphanCutoff: new Date(orphanCutoffMs).toISOString(),
    liveCutoff: new Date(liveCutoffMs).toISOString(),
  };
  logger.info(summary, "Entity-record retention purge finished");
  return summary;
};
