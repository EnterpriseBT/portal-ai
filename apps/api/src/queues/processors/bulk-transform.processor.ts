import type { TypedJobProcessor } from "../jobs.worker.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { BulkTransformService } from "../../services/bulk-transform.service.js";
import { JobEventsService } from "../../services/job-events.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { BATCH_ROW_PAYLOAD_LIMIT } from "@portalai/core/constants";

const logger = createLogger({ module: "bulk-transform-processor" });

/**
 * Processor for `bulk_transform` jobs (#85, Phase 2).
 *
 * Cursors the source wide table in batches, runs the agent's
 * expression as a SQL projection per batch, UPSERTs the results into
 * the target wide table. Emits a `job:batch` SSE event after each
 * batch commits so the `bulk-job-progress` widget can update its
 * counter in real time.
 *
 * Phase 2 covers `expression.kind === "sql"` only. The
 * `expression.kind === "tool"` path throws `BULK_DISPATCH_TOOL_NOT_FOUND`
 * until Phase 4 wires the dispatcher.
 *
 * Cancellation is checked between batches via the BullMQ job state
 * (BullMQ surfaces a discarded job as "failed" during processing).
 * Committed batches stay in the target wide table; a re-run is
 * idempotent because the per-batch UPSERT keys on `source_id`.
 */
export const bulkTransformProcessor: TypedJobProcessor<
  "bulk_transform"
> = async (bullJob) => {
  const {
    jobId,
    sourceConnectorEntityId,
    targetConnectorEntityId,
    expression,
    keyField,
    batchSize,
  } = bullJob.data;
  // `organizationId` lives on the Job row metadata; threaded through
  // the BullMQ payload for SQL scoping. (`JobData` widens metadata to
  // a Record, so the field arrives as part of `bullJob.data`.)
  const organizationId = (
    bullJob.data as unknown as { organizationId: string }
  ).organizationId;

  logger.info(
    {
      jobId,
      sourceConnectorEntityId,
      targetConnectorEntityId,
      expressionKind: expression.kind,
    },
    "bulk_transform started"
  );

  if (expression.kind === "tool") {
    // Phase 4 handles this branch. Fail fast with a typed error so the
    // tool's pre-flight (which also rejects this in Phase 2) is the
    // only path agents can use before Phase 4 lands.
    throw new ApiError(
      400,
      ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND,
      "Tool-kind dispatch is not yet implemented (Phase 4)."
    );
  }

  const startedAt = Date.now();

  const totalRecords = await BulkTransformService.countSourceRows(
    sourceConnectorEntityId,
    organizationId
  );

  if (totalRecords === 0) {
    return {
      recordsProcessed: 0,
      recordsFailed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  let recordsProcessed = 0;
  let offset = 0;

  // Loop guard — even if runBatch returns unexpected counts, bound the
  // iterations to totalRecords / batchSize + 1.
  const maxIterations = Math.ceil(totalRecords / batchSize) + 1;
  let iter = 0;

  while (recordsProcessed < totalRecords && iter < maxIterations) {
    iter += 1;

    // Cancel check between batches. BullMQ marks a discarded job's
    // state as "failed"; the processor exits with the so-far results.
    const state = await bullJob.getState();
    if (state === "failed") {
      logger.info(
        { jobId, recordsProcessed, totalRecords },
        "bulk_transform cancel detected; exiting loop"
      );
      break;
    }

    const batchStart = Date.now();
    const { rowsCommitted, rows } = await BulkTransformService.runBatch({
      sourceConnectorEntityId,
      targetConnectorEntityId,
      organizationId,
      expression: expression.value,
      keyField,
      batchSize,
      offset,
      jobId,
    });
    const batchDurationMs = Date.now() - batchStart;

    recordsProcessed += rowsCommitted;
    offset += batchSize;

    // Row payload selection: inline rows when serialized JSON fits the
    // 256 KB cap, otherwise degrade to counters-only. The `rowIds`
    // fallback path (per-entity row-fetch endpoint) lands in Phase 3.
    const serializedRows = JSON.stringify(rows);
    const includeRows =
      serializedRows.length <= BATCH_ROW_PAYLOAD_LIMIT && rows.length > 0;

    await JobEventsService.publishCustomEvent(jobId, "batch", {
      recordsProcessed,
      totalRecords,
      batchDurationMs,
      failureCount: 0,
      ...(includeRows ? { rows } : {}),
    });

    // Safety: if a batch returned fewer rows than requested, we've
    // run past the end of the source. Stop.
    if (rowsCommitted < batchSize) break;
  }

  return {
    recordsProcessed,
    recordsFailed: 0,
    durationMs: Date.now() - startedAt,
  };
};
