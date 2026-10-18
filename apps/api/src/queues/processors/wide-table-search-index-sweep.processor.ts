import { sql } from "drizzle-orm";

import { entityLockKey } from "../../db/advisory-lock.util.js";
import { db, reserveConnection } from "../../db/client.js";
import { environment } from "../../environment.js";
import { trgmIndexName } from "../../services/wide-table-reconciler.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "wide-table-search-index-sweep" });

/** The run summary — the BullMQ return value, kept on the completed job. */
export interface WideTableSearchIndexSweepSummary {
  tablesScanned: number;
  /** Missing indexes created. */
  built: number;
  /** INVALID indexes (a failed concurrent build) dropped and created again. */
  rebuilt: number;
  /** Indexes on retired columns dropped. */
  dropped: number;
  /** Table or column gone mid-sweep (an entity delete, a reconcile). */
  skipped: number;
  /** Columns left for the next run because a reconcile or a write held the
   *  entity's lock. */
  busy: number;
  /** Builds left for the next run because the budget was spent. */
  deferred: number;
  /** Anything else that failed; logged at warn, retried next run. */
  failed: number;
  durationMs: number;
}

/** Postgres errors meaning the table or column vanished under the sweep. */
const VANISHED_CODES = new Set(["42P01", "42703"]);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * Converges wide-table trigram indexes (#649): one valid `_trgm` GIN index per
 * live text column, and none on a retired one.
 *
 * The reconciler builds a text column's index when it adds the column, inside
 * its transaction, while the table is empty. This sweep covers everything
 * that can't be done there: columns that predate #649 on populated tables,
 * an index a failed build left INVALID, and indexes on columns since retired
 * (the reconciler only marks `retired_at`; it never drops a column).
 *
 * Every build and drop is `CONCURRENTLY`, so a sync writing the table is never
 * blocked, which also means no statement here can run inside a transaction.
 * Statements run one at a time on one reserved connection, so the sweep holds
 * one connection of the shared pool.
 *
 * Each statement runs under the entity's advisory lock (`withEntityLock`'s
 * key, taken session-scoped with `pg_try_advisory_lock`), and an entity whose
 * lock is held is left for the next run (`busy`). A concurrent build holds a
 * lock the reconciler's `ALTER TABLE` conflicts with. Without the advisory
 * lock a reconcile would queue behind a minutes-long build on a large table,
 * and every read of the table would queue behind the reconcile. With it, the
 * reconcile waits on the advisory lock before it touches the table, so reads
 * carry on. A build also waits for every older transaction, so starting one
 * while a reconcile's transaction is open would only stall both. `maxBuilds` caps builds plus rebuilds per run, so a large
 * backlog spreads over several hourly runs instead of holding the maintenance
 * worker's single slot. Idempotent: a second run over a converged table does
 * nothing.
 */
export const wideTableSearchIndexSweepProcessor = async (opts?: {
  /** Default `WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS`. 0 builds nothing
   *  (drops of retired-column indexes still run). */
  maxBuilds?: number;
  /** Test seam: restrict the sweep to these entities. */
  entityIds?: string[];
}): Promise<WideTableSearchIndexSweepSummary> => {
  const started = Date.now();
  const maxBuilds =
    opts?.maxBuilds ?? environment.WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS;
  const summary: WideTableSearchIndexSweepSummary = {
    tablesScanned: 0,
    built: 0,
    rebuilt: 0,
    dropped: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
    durationMs: 0,
    busy: 0,
  };

  // Desired state: every registered text column of a live entity whose table
  // exists. The entity filter mirrors the reconciler's (a deleted entity's
  // table is on its way out through entity_data_delete).
  const scope = opts?.entityIds
    ? sql`AND wtc.connector_entity_id IN (${sql.join(
        opts.entityIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    : sql``;
  const columns = (await db.execute(sql`
    SELECT wtc.connector_entity_id AS entity_id,
           wtc.column_name,
           wtc.retired_at IS NOT NULL AS retired,
           to_regclass(quote_ident('er__' || wtc.connector_entity_id))
             IS NOT NULL AS table_exists
    FROM wide_table_columns wtc
    JOIN connector_entities ce
      ON ce.id = wtc.connector_entity_id AND ce.deleted IS NULL
    WHERE wtc.pg_type = 'text' AND wtc.deleted IS NULL ${scope}
    ORDER BY wtc.connector_entity_id, wtc.column_name
  `)) as unknown as Array<{
    entity_id: string;
    column_name: string;
    retired: boolean;
    table_exists: boolean;
  }>;

  // Actual state: every trigram index on a wide table, by name.
  const existing = new Map(
    (
      (await db.execute(sql`
        SELECT c.relname AS name, x.indisvalid AS valid
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indexrelid
        WHERE c.relname LIKE 'er\\_\\_%\\_trgm'
      `)) as unknown as Array<{ name: string; valid: boolean }>
    ).map((r) => [r.name, r.valid])
  );

  summary.tablesScanned = new Set(columns.map((c) => c.entity_id)).size;
  let builds = 0;

  const reserved = await reserveConnection();
  /** Runs `statement` holding the entity's lock; false when it's held. */
  const underEntityLock = async (
    entityId: string,
    statement: string
  ): Promise<boolean> => {
    const key = entityLockKey(entityId).toString();
    const rows = (await reserved.unsafe(
      `SELECT pg_try_advisory_lock($1::bigint) AS locked`,
      [key]
    )) as unknown as Array<{ locked: boolean }>;
    if (rows[0]?.locked !== true) return false;
    try {
      await reserved.unsafe(statement);
      return true;
    } finally {
      await reserved.unsafe(`SELECT pg_advisory_unlock($1::bigint)`, [key]);
    }
  };

  try {
    for (const col of columns) {
      const table = `"er__${col.entity_id}"`;
      const name = trgmIndexName(col.entity_id, col.column_name);
      const quotedName = `"${name}"`;
      const state = existing.get(name);

      try {
        if (col.retired) {
          if (state === undefined) continue;
          const dropped = await underEntityLock(
            col.entity_id,
            `DROP INDEX CONCURRENTLY IF EXISTS ${quotedName}`
          );
          if (dropped) summary.dropped += 1;
          else summary.busy += 1;
          continue;
        }
        if (!col.table_exists) {
          summary.skipped += 1;
          continue;
        }
        if (state === true) continue;

        if (builds >= maxBuilds) {
          summary.deferred += 1;
          continue;
        }
        // Counted before the attempt so a failing build still spends budget;
        // handed back when the entity was busy and nothing ran.
        builds += 1;
        if (state === false) {
          const dropped = await underEntityLock(
            col.entity_id,
            `DROP INDEX CONCURRENTLY IF EXISTS ${quotedName}`
          );
          if (!dropped) {
            builds -= 1;
            summary.busy += 1;
            continue;
          }
        }
        const built = await underEntityLock(
          col.entity_id,
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quotedName} ON ${table} ` +
            `USING GIN ("${col.column_name}" gin_trgm_ops)`
        );
        if (!built) {
          builds -= 1;
          summary.busy += 1;
          continue;
        }
        if (state === false) summary.rebuilt += 1;
        else summary.built += 1;
      } catch (error) {
        if (VANISHED_CODES.has(pgCode(error) ?? "")) {
          summary.skipped += 1;
          continue;
        }
        summary.failed += 1;
        logger.warn(
          {
            index: name,
            code: pgCode(error),
            error: error instanceof Error ? error.message : String(error),
          },
          "Search index build failed; the next sweep retries it"
        );
      }
    }
  } finally {
    reserved.release();
  }

  summary.durationMs = Date.now() - started;
  logger.info(summary, "Wide-table search-index sweep finished");
  return summary;
};
