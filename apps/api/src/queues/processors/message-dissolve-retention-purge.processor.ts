import { sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "message-dissolve-retention-purge" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows deleted per DELETE statement — bounds each statement's lock time; the
 *  loop drains the backlog batch by batch. */
export const PURGE_BATCH_SIZE = 10_000;

/** The run summary — the BullMQ return value surfaced verbatim by
 *  `GET /api/admin/maintenance` as `recentRuns[].returnvalue`. */
export interface MessageDissolveRetentionPurgeSummary {
  purged: number;
  batches: number;
  cutoff: string;
}

/**
 * Daily age-only retention purge for **message-block** dissolve coverage (#542).
 *
 * Message-block maps are transient (#542): their `map_dissolve_geometries` rows
 * are keyed by `message_id`, which FK-cascades — so a deleted message/portal
 * cleans its coverage for free. This purge is only the **age window** for
 * messages that *survive*: coverage for a message older than
 * `MESSAGE_DISSOLVE_RETENTION_DAYS` is dropped, and an aged-out map serves raw
 * (or re-precomputes) on re-view; pinning stays the durable path.
 *
 * Pin-owned rows (`message_id IS NULL`) are never touched — they keep their own
 * FK cascade and have no age window.
 *
 * A pure DELETE loop — safe to double-run by construction, so scheduler
 * concurrency needs no guard beyond the maintenance worker's `concurrency: 1`.
 * The batch is selected + deleted server-side by `ctid`, so no ids marshal
 * through Node.
 */
export const messageDissolveRetentionPurgeProcessor = async (opts?: {
  /** Test seam — production runs use PURGE_BATCH_SIZE. */
  batchSize?: number;
  /** Test seam — production runs use the wall clock. */
  now?: number;
}): Promise<MessageDissolveRetentionPurgeSummary> => {
  const batchSize = opts?.batchSize ?? PURGE_BATCH_SIZE;
  const now = opts?.now ?? Date.now();
  const cutoffMs = now - environment.MESSAGE_DISSOLVE_RETENTION_DAYS * DAY_MS;

  logger.info(
    { cutoff: new Date(cutoffMs).toISOString(), batchSize },
    "Message-dissolve retention purge started"
  );

  let purged = 0;
  let batches = 0;
  for (;;) {
    const r = (await db.execute(sql`
      DELETE FROM map_dissolve_geometries
      WHERE ctid IN (
        SELECT mdg.ctid
        FROM map_dissolve_geometries mdg
        JOIN portal_messages pm ON pm.id = mdg.message_id
        WHERE mdg.message_id IS NOT NULL
          AND pm.created < ${cutoffMs}
        LIMIT ${batchSize}
      )
    `)) as unknown as { count?: number };
    const deleted = Number(r?.count ?? 0);
    if (deleted === 0) break;
    purged += deleted;
    batches += 1;
  }

  const summary: MessageDissolveRetentionPurgeSummary = {
    purged,
    batches,
    cutoff: new Date(cutoffMs).toISOString(),
  };
  logger.info(summary, "Message-dissolve retention purge finished");
  return summary;
};
