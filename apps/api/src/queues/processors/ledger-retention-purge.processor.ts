import { DbService } from "../../services/db.service.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "ledger-retention-purge" });

/** OQ2: rows deleted per DELETE statement — bounds each statement's
 *  lock time; the loop drains the backlog batch by batch. */
export const PURGE_BATCH_SIZE = 10_000;

/** The run summary — the BullMQ return value surfaced verbatim by
 *  `GET /api/admin/maintenance` as `recentRuns[].returnvalue`. */
export interface LedgerRetentionPurgeSummary {
  purged: number;
  batches: number;
  /** ISO timestamp of the retention cutoff this run enforced. */
  cutoff: string;
}

/**
 * Daily retention purge for `tool_usage_ledger` (#179 D5): hard-delete
 * rows older than `LEDGER_RETENTION_MONTHS` (env, default 24), in
 * batches, until drained. A pure DELETE loop — safe to double-run by
 * construction, so scheduler concurrency needs no guard beyond the
 * maintenance worker's `concurrency: 1`.
 */
export const ledgerRetentionPurgeProcessor = async (opts?: {
  /** Test seam — production runs use PURGE_BATCH_SIZE. */
  batchSize?: number;
  /** Test seam — production runs use the wall clock. */
  now?: number;
}): Promise<LedgerRetentionPurgeSummary> => {
  const batchSize = opts?.batchSize ?? PURGE_BATCH_SIZE;
  const now = opts?.now ?? Date.now();
  const retentionMs =
    environment.LEDGER_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;
  const cutoffMs = now - retentionMs;

  logger.info(
    { cutoff: new Date(cutoffMs).toISOString(), batchSize },
    "Ledger retention purge started"
  );

  let purged = 0;
  let batches = 0;
  for (;;) {
    const deleted = await DbService.repository.toolUsageLedger.deleteOlderThan(
      cutoffMs,
      batchSize
    );
    if (deleted === 0) break;
    purged += deleted;
    batches += 1;
  }

  const summary: LedgerRetentionPurgeSummary = {
    purged,
    batches,
    cutoff: new Date(cutoffMs).toISOString(),
  };
  logger.info(summary, "Ledger retention purge finished");
  return summary;
};
