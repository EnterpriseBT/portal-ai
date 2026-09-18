import { DbService } from "../../services/db.service.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "audit-log-retention-purge" });

/** Rows deleted per DELETE statement — bounds each statement's lock time;
 *  the loop drains the backlog batch by batch. */
export const AUDIT_LOG_PURGE_BATCH_SIZE = 10_000;

/** The run summary — the BullMQ return value surfaced verbatim by
 *  `GET /api/admin/maintenance` as `recentRuns[].returnvalue`. */
export interface AuditLogRetentionPurgeSummary {
  purged: number;
  batches: number;
  /** ISO timestamp of the retention cutoff this run enforced. */
  cutoff: string;
}

/**
 * Daily retention purge for `audit_log` (#575 slice 5): hard-delete rows older
 * than `AUDIT_LOG_RETENTION_MONTHS` (env, default 24), in batches, until
 * drained. `auditLogRepo.deleteOlderThan` sets the `app.audit_retention_purge`
 * flag inside its transaction so the append-only trigger permits these — the
 * only sanctioned delete path for the table. A pure DELETE loop, safe to
 * double-run; the maintenance worker's `concurrency: 1` is guard enough.
 */
export const auditLogRetentionPurgeProcessor = async (opts?: {
  /** Test seam — production runs use AUDIT_LOG_PURGE_BATCH_SIZE. */
  batchSize?: number;
  /** Test seam — production runs use the wall clock. */
  now?: number;
}): Promise<AuditLogRetentionPurgeSummary> => {
  const batchSize = opts?.batchSize ?? AUDIT_LOG_PURGE_BATCH_SIZE;
  const now = opts?.now ?? Date.now();
  const retentionMs =
    environment.AUDIT_LOG_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;
  const cutoffMs = now - retentionMs;

  logger.info(
    { cutoff: new Date(cutoffMs).toISOString(), batchSize },
    "Audit-log retention purge started"
  );

  let purged = 0;
  let batches = 0;
  for (;;) {
    const deleted = await DbService.repository.auditLog.deleteOlderThan(
      cutoffMs,
      batchSize
    );
    if (deleted === 0) break;
    purged += deleted;
    batches += 1;
  }

  const summary: AuditLogRetentionPurgeSummary = {
    purged,
    batches,
    cutoff: new Date(cutoffMs).toISOString(),
  };
  logger.info(summary, "Audit-log retention purge finished");
  return summary;
};
