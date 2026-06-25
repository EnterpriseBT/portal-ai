import type { TypedJobProcessor } from "../jobs.worker.js";
import { PortalSqlHandleService } from "../../services/portal-sql-handle.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { SQL_QUERY_JOB_TIMEOUT_MS } from "@portalai/core/constants";

const logger = createLogger({ module: "sql-query-processor" });

/**
 * Processor for `sql_query` JOB-tier reads (#130 child E1a).
 *
 * The runtime escalates a long/expensive `sql_query` here (D8a) so the scan
 * runs **off the request thread** at `SQL_QUERY_JOB_TIMEOUT_MS` (vs the 30s
 * synchronous ceiling). It stages the result as a handle via `produce` — the
 * same Redis-staging path `sql_query` uses synchronously — and returns the
 * handle envelope as the job's terminal payload, so the awaiting tool (E1b)
 * hands it back like any `sql_query` result. Read-only: no lock, no write.
 *
 * Rehomes `bulk_aggregate`'s 120s off-thread scan as the read op's job mode.
 */
export const sqlQueryProcessor: TypedJobProcessor<"sql_query"> = async (
  bullJob
) => {
  const { jobId, sql, stationId, organizationId } = bullJob.data;

  logger.info({ jobId, stationId }, "sql_query job started");
  const start = Date.now();

  const { envelope } = await PortalSqlHandleService.produce({
    stationId,
    organizationId,
    sql,
    statementTimeoutMs: SQL_QUERY_JOB_TIMEOUT_MS,
  });

  logger.info(
    {
      jobId,
      queryHandle: envelope.queryHandle,
      rowCount: envelope.rowCount,
      durationMs: Date.now() - start,
    },
    "sql_query job completed"
  );

  return envelope;
};
