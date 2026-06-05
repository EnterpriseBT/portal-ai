import type { TypedJobProcessor } from "../jobs.worker.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { BulkTransformService } from "../../services/bulk-transform.service.js";
import { JobEventsService } from "../../services/job-events.service.js";
import { ToolService } from "../../services/tools.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { BATCH_ROW_PAYLOAD_LIMIT } from "@portalai/core/constants";
import { dispatchBatch } from "./bulk-transform-tool.dispatcher.js";
import type { BulkTransformResult } from "@portalai/core/models";

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
    const sourceFilter = (bullJob.data as unknown as {
      sourceFilter?: { whereSqlFragment: string };
    }).sourceFilter;
    return await runToolDispatchLoop(bullJob, {
      jobId,
      sourceConnectorEntityId,
      targetConnectorEntityId,
      organizationId,
      toolRef: expression.ref,
      toolArgs: expression.args,
      keyField,
      batchSize,
      whereSqlFragment: sourceFilter?.whereSqlFragment,
    });
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

/**
 * Tool-dispatch processor loop (#85 Phase 4).
 *
 * Branched from the main processor when `expression.kind === "tool"`.
 * Per batch: read source rows → dispatch tool calls → UPSERT successes
 * → accumulate failures. Emits per-batch SSE events with the
 * dispatcher's `successes[]` rows when payload fits the cap. Returns
 * a BulkTransformResult with the accumulated `partialFailures`.
 *
 * `userId` defaults to `"SYSTEM"` here — the calling job stores its
 * actor on the job row; for processor-side tool lookups we only need
 * "a user the station authorizes," and the bulk job's actor is the
 * canonical choice. (Future: thread the job's createdBy through.)
 */
async function runToolDispatchLoop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bullJob: any,
  opts: {
    jobId: string;
    sourceConnectorEntityId: string;
    targetConnectorEntityId: string;
    organizationId: string;
    toolRef: string;
    toolArgs?: Record<string, unknown>;
    keyField: string;
    batchSize: number;
    whereSqlFragment?: string;
  }
): Promise<BulkTransformResult> {
  const startedAt = Date.now();
  const stationId = (bullJob.data as { stationId?: string }).stationId ?? "";
  const userId = (bullJob.data as { userId?: string }).userId ?? "SYSTEM";

  const lookup = await ToolService.lookupBulkDispatchable(
    opts.toolRef,
    opts.organizationId,
    stationId,
    userId
  );
  if (!lookup) {
    throw new ApiError(
      400,
      ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND,
      `Tool '${opts.toolRef}' is not bulk-dispatchable on this station`
    );
  }

  const totalRecords = await BulkTransformService.countSourceRows(
    opts.sourceConnectorEntityId,
    opts.organizationId
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
  const partialFailures: BulkTransformResult["partialFailures"] = [];
  const maxIterations = Math.ceil(totalRecords / opts.batchSize) + 1;
  let iter = 0;

  while (recordsProcessed < totalRecords && iter < maxIterations) {
    iter += 1;
    const state = await bullJob.getState();
    if (state === "failed") {
      logger.info(
        { jobId: opts.jobId, recordsProcessed, totalRecords },
        "bulk_transform (tool) cancel detected; exiting loop"
      );
      break;
    }

    const sourceBatch = await BulkTransformService.fetchSourceBatch({
      sourceConnectorEntityId: opts.sourceConnectorEntityId,
      organizationId: opts.organizationId,
      keyField: opts.keyField,
      batchSize: opts.batchSize,
      offset,
      whereSqlFragment: opts.whereSqlFragment,
    });
    if (sourceBatch.length === 0) break;

    const dispatched = await dispatchBatch({
      toolMetadata: lookup.metadata,
      staticArgs: opts.toolArgs,
      keyField: opts.keyField,
      batch: sourceBatch,
      toolExecutor: lookup.executor,
    });

    await BulkTransformService.upsertSuccesses({
      targetConnectorEntityId: opts.targetConnectorEntityId,
      organizationId: opts.organizationId,
      jobId: opts.jobId,
      successes: dispatched.successes,
    });

    recordsProcessed += dispatched.successes.length + dispatched.failures.length;
    offset += opts.batchSize;

    for (const f of dispatched.failures) {
      partialFailures.push({
        sourceKey: f.sourceKey,
        error: {
          success: false,
          code: f.error.code,
          message: f.error.message,
          ...(f.error.recommendation
            ? { recommendation: f.error.recommendation }
            : {}),
        },
      });
    }

    const serializedRows = JSON.stringify(
      dispatched.successes.map((s) => s.value)
    );
    const includeRows =
      serializedRows.length <= BATCH_ROW_PAYLOAD_LIMIT &&
      dispatched.successes.length > 0;

    await JobEventsService.publishCustomEvent(opts.jobId, "batch", {
      recordsProcessed,
      totalRecords,
      batchDurationMs: dispatched.batchDurationMs,
      failureCount: dispatched.failures.length,
      ...(includeRows ? { rows: dispatched.successes.map((s) => s.value) } : {}),
    });

    if (sourceBatch.length < opts.batchSize) break;
  }

  return {
    recordsProcessed,
    recordsFailed: partialFailures.length,
    durationMs: Date.now() - startedAt,
    ...(partialFailures.length > 0 ? { partialFailures } : {}),
  };
}
