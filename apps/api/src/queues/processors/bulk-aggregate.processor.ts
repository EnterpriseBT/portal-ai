import type { TypedJobProcessor } from "../jobs.worker.js";
import { ApiCode, ApiCodeDefaultRecommendation } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { BulkAggregateService } from "../../services/bulk-aggregate.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { BULK_AGGREGATE_RESULT_LIMIT } from "@portalai/core/constants";

const logger = createLogger({ module: "bulk-aggregate-processor" });

/**
 * Processor for `bulk_aggregate` jobs (#100).
 *
 * Runs ONE SQL aggregate over the source wide table (read-only, no
 * lock, no target write) and returns the computed value in the job's
 * terminal envelope. The heavy scan + `statement_timeout` live in
 * `BulkAggregateService.runAggregate`; this processor adds the
 * result-size guard and the `durationMs` measurement, then returns —
 * the worker persists the envelope via `JobEventsService.transition`.
 */
export const bulkAggregateProcessor: TypedJobProcessor<
  "bulk_aggregate"
> = async (bullJob) => {
  const { jobId, sourceConnectorEntityId, organizationId, expression } =
    bullJob.data;
  const sourceFilter = (
    bullJob.data as unknown as {
      sourceFilter?: { whereSqlFragment: string };
    }
  ).sourceFilter;

  logger.info({ jobId, sourceConnectorEntityId }, "bulk_aggregate started");

  const start = Date.now();
  const { result, recordsProcessed } = await BulkAggregateService.runAggregate({
    sourceConnectorEntityId,
    organizationId,
    expression,
    whereSqlFragment: sourceFilter?.whereSqlFragment,
  });
  const durationMs = Date.now() - start;

  // Guard the envelope — an unbounded ARRAY_AGG / JSON_AGG could
  // otherwise write a multi-MB job row.
  const serializedSize = JSON.stringify(result ?? null).length;
  if (serializedSize > BULK_AGGREGATE_RESULT_LIMIT) {
    throw new ApiError(
      400,
      ApiCode.BULK_AGGREGATE_RESULT_TOO_LARGE,
      `The aggregate result (${serializedSize} bytes) exceeds the ${BULK_AGGREGATE_RESULT_LIMIT}-byte cap.`,
      {
        recommendation:
          ApiCodeDefaultRecommendation[ApiCode.BULK_AGGREGATE_RESULT_TOO_LARGE],
        details: { serializedSize, limit: BULK_AGGREGATE_RESULT_LIMIT },
      }
    );
  }

  logger.info(
    { jobId, recordsProcessed, durationMs, serializedSize },
    "bulk_aggregate completed"
  );

  return { result, recordsProcessed, durationMs };
};
