import { sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { environment } from "../../environment.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "dissolve-scope-retention-purge" });

/** Rows deleted per DELETE statement — bounds each statement's lock time; the
 *  loop drains the backlog batch by batch. */
export const PURGE_BATCH_SIZE = 10_000;

/** The run summary — the BullMQ return value surfaced verbatim by
 *  `GET /api/admin/maintenance` as `recentRuns[].returnvalue`. */
export interface DissolveScopeRetentionPurgeSummary {
  purged: number;
  batches: number;
  cutoff: string;
}

/**
 * Orphan **per-scope** dissolve reap (#643).
 *
 * Per-user view-scoping makes `map_dissolve_geometries` content-addressed by
 * `scope_hash` (one scope per distinct curated-view entitlement), so entitlement
 * churn — a grant added/removed, a view's filter edited — re-hashes and leaves
 * the *old* scope's coverage behind as an orphan nothing will serve again. This
 * reap drops any scope whose last serve (or, if never served, its creation) is
 * older than `DISSOLVE_SCOPE_TTL_MS`, **except** the most-recently-served scope
 * of each `(owner, column, band)` — so a live pin always keeps at least its
 * current scope and never serves raw because the reap got ahead of it.
 *
 * The winner-per-group guard is why this is not the plain age purge that
 * `message-dissolve-retention-purge` runs: there, a whole owner ages out
 * together; here, only the *superseded* scopes of a still-live owner do.
 *
 * A pure DELETE loop over server-selected `ctid`s (no ids marshal through Node),
 * idempotent and safe to double-run, so the maintenance worker's `concurrency: 1`
 * is guard enough. The winner (rank 1 per group) is never in the loser set, so
 * draining losers never changes the ranking and the loop terminates.
 */
export const dissolveScopeRetentionPurgeProcessor = async (opts?: {
  /** Test seam — production runs use PURGE_BATCH_SIZE. */
  batchSize?: number;
  /** Test seam — production runs use the wall clock. */
  now?: number;
}): Promise<DissolveScopeRetentionPurgeSummary> => {
  const batchSize = opts?.batchSize ?? PURGE_BATCH_SIZE;
  const now = opts?.now ?? Date.now();
  const cutoffMs = now - environment.DISSOLVE_SCOPE_TTL_MS;

  logger.info(
    { cutoff: new Date(cutoffMs).toISOString(), batchSize },
    "Dissolve-scope retention purge started"
  );

  let purged = 0;
  let batches = 0;
  for (;;) {
    // Losers = scopes that are NOT the freshest for their (owner, column, band)
    // group AND whose recency (last serve, else creation) is past the cutoff.
    // Recency uses COALESCE(last_served_at, created) so a freshly precomputed but
    // not-yet-served scope isn't reaped until it ages out on its own.
    const r = (await db.execute(sql`
      DELETE FROM map_dissolve_geometries
      WHERE ctid IN (
        SELECT mdg.ctid
        FROM map_dissolve_geometries mdg
        JOIN (
          SELECT
            portal_result_id, message_id, block_index, column_name,
            zoom_band, scope_hash
          FROM (
            SELECT
              portal_result_id, message_id, block_index, column_name,
              zoom_band, scope_hash,
              MAX(COALESCE(last_served_at, created)) AS scope_recency,
              ROW_NUMBER() OVER (
                PARTITION BY portal_result_id, message_id, block_index,
                             column_name, zoom_band
                ORDER BY MAX(COALESCE(last_served_at, created)) DESC, scope_hash
              ) AS rn
            FROM map_dissolve_geometries
            WHERE deleted IS NULL
            GROUP BY portal_result_id, message_id, block_index, column_name,
                     zoom_band, scope_hash
          ) ranked
          WHERE ranked.rn > 1
            AND ranked.scope_recency < ${cutoffMs}
        ) losers
          ON mdg.portal_result_id IS NOT DISTINCT FROM losers.portal_result_id
          AND mdg.message_id      IS NOT DISTINCT FROM losers.message_id
          AND mdg.block_index     IS NOT DISTINCT FROM losers.block_index
          AND mdg.column_name      = losers.column_name
          AND mdg.zoom_band        = losers.zoom_band
          AND mdg.scope_hash       = losers.scope_hash
        WHERE mdg.deleted IS NULL
        LIMIT ${batchSize}
      )
    `)) as unknown as { count?: number };
    const deleted = Number(r?.count ?? 0);
    if (deleted === 0) break;
    purged += deleted;
    batches += 1;
  }

  const summary: DissolveScopeRetentionPurgeSummary = {
    purged,
    batches,
    cutoff: new Date(cutoffMs).toISOString(),
  };
  logger.info(summary, "Dissolve-scope retention purge finished");
  return summary;
};
