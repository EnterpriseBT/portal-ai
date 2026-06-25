import type { TypedJobProcessor } from "../jobs.worker.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { BulkTransformService } from "../../services/bulk-transform.service.js";
import { JobEventsService } from "../../services/job-events.service.js";
import { ToolService } from "../../services/tools.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { BATCH_ROW_PAYLOAD_LIMIT } from "@portalai/core/constants";
import { dispatchBatch } from "./bulk-transform-tool.dispatcher.js";
import { shapeWritesForRecord } from "./bulk-transform-writes.util.js";
import type {
  BulkTransformResult,
  BulkTransformWrite,
} from "@portalai/core/models";

const logger = createLogger({ module: "bulk-transform-processor" });

/**
 * Processor for `bulk_transform` jobs (#85, #99).
 *
 * Slice 4 (#99): per-batch flow ends with a write-fan-out across the
 * union of `writes[].targetConnectorEntityId`. One `upsertSuccesses`
 * call per unique target, each in its own transaction so a failing
 * target doesn't roll back the others (per-target failure isolation
 * per the spec). Per-record per-target write failures surface as
 * `partialFailures[]` entries tagged with `{ targetConnectorEntityId,
 * column }`.
 *
 * Tool-kind: `dispatchBatch` runs the tool against each source row →
 * `shapeWritesForRecord(writes, toolResult, sourceRow, null)` per
 * success → fan-out.
 *
 * SQL-kind: `runBatch` SELECTs the source rows with the agent's
 * projection applied → `shapeWritesForRecord(writes, null, sourceRow,
 * sqlAliasValues)` per row → fan-out.
 */
export const bulkTransformProcessor: TypedJobProcessor<
  "bulk_transform"
> = async (bullJob) => {
  const {
    jobId,
    sourceConnectorEntityId,
    targetConnectorEntityIds,
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
  // Stamped into the entity_records audit columns on each batch insert.
  // Defaults to "SYSTEM" for back-compat with jobs enqueued before the
  // tool started forwarding userId in metadata.
  const userId =
    (bullJob.data as unknown as { userId?: string }).userId ?? "SYSTEM";

  logger.info(
    {
      jobId,
      sourceConnectorEntityId,
      targetConnectorEntityIds,
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
      organizationId,
      toolRef: expression.ref,
      toolArgs: expression.args,
      writes: expression.writes,
      keyField,
      batchSize,
      whereSqlFragment: sourceFilter?.whereSqlFragment,
      userId,
    });
  }

  return await runSqlBatchLoop(bullJob, {
    jobId,
    sourceConnectorEntityId,
    organizationId,
    expression: expression.value,
    writes: expression.writes,
    keyField,
    batchSize,
    userId,
  });
};

// ── Tool-kind branch ─────────────────────────────────────────────────

async function runToolDispatchLoop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bullJob: any,
  opts: {
    jobId: string;
    sourceConnectorEntityId: string;
    organizationId: string;
    toolRef: string;
    toolArgs?: Record<string, unknown>;
    /** Agent-supplied write mapping (#99 slice 4). The processor fans
     *  out to every unique `targetConnectorEntityId` per batch. */
    writes: BulkTransformWrite[];
    keyField: string;
    batchSize: number;
    whereSqlFragment?: string;
    userId: string;
  }
): Promise<BulkTransformResult> {
  const startedAt = Date.now();
  // Both ids are persisted into the job metadata by
  // transform_entity_records.tool. A missing stationId was a
  // silent footgun: the worker would call lookupBulkDispatchable
  // with stationId="" and the org-toolpack scan would find no
  // attached packs → BULK_DISPATCH_TOOL_NOT_FOUND, even though the
  // tool's pre-flight (with the real stationId) had just succeeded.
  // Fail fast if the metadata didn't carry it.
  const stationId = (bullJob.data as { stationId?: string }).stationId;
  if (!stationId) {
    throw new ApiError(
      500,
      ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND,
      "bulk_transform job is missing `stationId` in metadata — re-enqueue from a current portal session."
    );
  }

  const lookup = await ToolService.lookupBulkDispatchable(
    opts.toolRef,
    opts.organizationId,
    stationId,
    opts.userId
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
  const partialFailures: NonNullable<
    BulkTransformResult["partialFailures"]
  > = [];
  const droppedAcc = new DroppedAccumulator();
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

    const sourceRowsByKey = new Map<string, Record<string, unknown>>();
    for (const row of sourceBatch) {
      const key = String(row[opts.keyField]);
      sourceRowsByKey.set(key, row);
    }

    const dispatched = await dispatchBatch({
      toolMetadata: lookup.metadata,
      staticArgs: opts.toolArgs,
      keyField: opts.keyField,
      batch: sourceBatch,
      toolExecutor: lookup.executor,
    });

    // Shape each success per writes[]; group by target; fan out to
    // upsertSuccesses (one call per target). Per-target failures
    // surface in `fanOut.failures` with sourceKey + target + column.
    const fanOut = await fanOutBatch({
      records: dispatched.successes.map((s) => ({
        sourceKey: s.sourceKey,
        toolResult: s.value,
        sourceRow: sourceRowsByKey.get(s.sourceKey) ?? {},
        sqlAliasValues: null,
      })),
      writes: opts.writes,
      organizationId: opts.organizationId,
      jobId: opts.jobId,
      userId: opts.userId,
    });
    droppedAcc.absorb(fanOut.droppedByTarget);

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
    for (const wf of fanOut.failures) partialFailures.push(wf);

    // SSE row payload — the union of per-target shaped values per
    // record so the live chart sees the multi-target writes.
    const sseRows = dispatched.successes.map((s) => {
      const shaped = shapeWritesForRecord(
        opts.writes,
        s.value,
        sourceRowsByKey.get(s.sourceKey) ?? {},
        null
      );
      const merged: Record<string, unknown> = {};
      for (const cols of shaped.values()) {
        for (const [k, v] of Object.entries(cols)) merged[k] = v;
      }
      return merged;
    });
    const serializedRows = JSON.stringify(sseRows);
    const includeRows =
      serializedRows.length <= BATCH_ROW_PAYLOAD_LIMIT && sseRows.length > 0;

    await JobEventsService.publishCustomEvent(opts.jobId, "batch", {
      recordsProcessed,
      totalRecords,
      batchDurationMs: dispatched.batchDurationMs,
      failureCount: dispatched.failures.length + fanOut.failures.length,
      ...(includeRows ? { rows: sseRows } : {}),
    });

    if (sourceBatch.length < opts.batchSize) break;
  }

  return finalize({
    startedAt,
    recordsProcessed,
    partialFailures,
    droppedAcc,
  });
}

// ── SQL-kind branch ──────────────────────────────────────────────────

async function runSqlBatchLoop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bullJob: any,
  opts: {
    jobId: string;
    sourceConnectorEntityId: string;
    organizationId: string;
    expression: string;
    writes: BulkTransformWrite[];
    keyField: string;
    batchSize: number;
    userId: string;
  }
): Promise<BulkTransformResult> {
  const startedAt = Date.now();

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
  const partialFailures: NonNullable<
    BulkTransformResult["partialFailures"]
  > = [];
  const droppedAcc = new DroppedAccumulator();
  const maxIterations = Math.ceil(totalRecords / opts.batchSize) + 1;
  let iter = 0;

  while (recordsProcessed < totalRecords && iter < maxIterations) {
    iter += 1;

    const state = await bullJob.getState();
    if (state === "failed") {
      logger.info(
        { jobId: opts.jobId, recordsProcessed, totalRecords },
        "bulk_transform cancel detected; exiting loop"
      );
      break;
    }

    const batchStart = Date.now();
    // runBatch (#99 slice 4) returns the projected rows; the actual
    // wide-table write happens below via the fan-out.
    const { rowsCommitted, rows } = await BulkTransformService.runBatch({
      sourceConnectorEntityId: opts.sourceConnectorEntityId,
      // Carried for back-compat; runBatch ignores it under the
      // SELECT-only contract.
      targetConnectorEntityId: opts.writes[0].targetConnectorEntityId,
      organizationId: opts.organizationId,
      expression: opts.expression,
      keyField: opts.keyField,
      batchSize: opts.batchSize,
      offset,
      jobId: opts.jobId,
      userId: opts.userId,
    });
    const batchDurationMs = Date.now() - batchStart;
    if (rows.length === 0) break;

    const fanOut = await fanOutBatch({
      records: rows.map((row) => {
        const sourceRow =
          (row["__source_row"] as Record<string, unknown> | undefined) ?? {};
        // Strip the framing keys; the rest is the projection's aliases.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { __src_key, __source_row, ...aliasValues } = row;
        return {
          sourceKey: String(row["__src_key"]),
          toolResult: null as unknown,
          sourceRow,
          sqlAliasValues: aliasValues as Record<string, unknown>,
        };
      }),
      writes: opts.writes,
      organizationId: opts.organizationId,
      jobId: opts.jobId,
      userId: opts.userId,
    });
    droppedAcc.absorb(fanOut.droppedByTarget);

    recordsProcessed += rowsCommitted;
    offset += opts.batchSize;

    for (const wf of fanOut.failures) partialFailures.push(wf);

    // SSE rows: just the projection aliases (drop the framing keys).
    const sseRows = rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { __src_key, __source_row, ...aliasValues } = row;
      return aliasValues;
    });
    const serializedRows = JSON.stringify(sseRows);
    const includeRows =
      serializedRows.length <= BATCH_ROW_PAYLOAD_LIMIT && sseRows.length > 0;

    await JobEventsService.publishCustomEvent(opts.jobId, "batch", {
      recordsProcessed,
      totalRecords,
      batchDurationMs,
      failureCount: fanOut.failures.length,
      ...(includeRows ? { rows: sseRows } : {}),
    });

    if (rowsCommitted < opts.batchSize) break;
  }

  return finalize({
    startedAt,
    recordsProcessed,
    partialFailures,
    droppedAcc,
  });
}

// ── Fan-out helper ──────────────────────────────────────────────────

interface FanOutRecord {
  sourceKey: string;
  toolResult: unknown;
  sourceRow: Record<string, unknown>;
  sqlAliasValues: Record<string, unknown> | null;
}

interface FanOutResult {
  failures: NonNullable<BulkTransformResult["partialFailures"]>;
  droppedByTarget: Map<string, Set<string>>;
}

/**
 * Per-batch fan-out: shape each record's `writes[]` into per-target
 * column maps, group by target, run one `upsertSuccesses` per target.
 * Each per-target call runs independently — a thrown target rolls
 * back only its own statement; sibling targets are unaffected.
 *
 * Per-target failures surface in `failures[]` (one entry per
 * source-key × failing-target pair) with `column` set to the first
 * write that targets that entity (good-enough attribution; the spec
 * notes a single-column attribution is sufficient).
 *
 * Dropped columns (defense-in-depth — wide-column disappeared between
 * pre-flight and execution) surface in `droppedByTarget` keyed by
 * target.
 */
async function fanOutBatch(args: {
  records: FanOutRecord[];
  writes: BulkTransformWrite[];
  organizationId: string;
  jobId: string;
  userId: string;
}): Promise<FanOutResult> {
  // Group successes by target.
  const perTarget = new Map<
    string,
    Array<{ sourceKey: string; value: Record<string, unknown> }>
  >();
  for (const record of args.records) {
    const shaped = shapeWritesForRecord(
      args.writes,
      record.toolResult,
      record.sourceRow,
      record.sqlAliasValues
    );
    for (const [targetId, columnValues] of shaped) {
      let bucket = perTarget.get(targetId);
      if (!bucket) {
        bucket = [];
        perTarget.set(targetId, bucket);
      }
      bucket.push({ sourceKey: record.sourceKey, value: columnValues });
    }
  }

  // First write per target — used to attribute per-target failures
  // back to a representative column name.
  const firstWriteColumnByTarget = new Map<string, string>();
  for (const w of args.writes) {
    if (!firstWriteColumnByTarget.has(w.targetConnectorEntityId)) {
      firstWriteColumnByTarget.set(w.targetConnectorEntityId, w.column);
    }
  }

  const failures: NonNullable<BulkTransformResult["partialFailures"]> = [];
  const droppedByTarget = new Map<string, Set<string>>();

  for (const [targetId, successes] of perTarget) {
    try {
      const result = await BulkTransformService.upsertSuccesses({
        targetConnectorEntityId: targetId,
        organizationId: args.organizationId,
        jobId: args.jobId,
        successes,
        userId: args.userId,
      });
      if (result.droppedKeys.length > 0) {
        let bucket = droppedByTarget.get(targetId);
        if (!bucket) {
          bucket = new Set();
          droppedByTarget.set(targetId, bucket);
        }
        for (const k of result.droppedKeys) bucket.add(k);
        logger.warn(
          {
            jobId: args.jobId,
            targetConnectorEntityId: targetId,
            droppedKeys: result.droppedKeys,
          },
          "bulk_transform: upsert dropped keys despite pre-flight — investigate"
        );
      }
    } catch (err) {
      // Extract the underlying PG cause's message — drizzle wraps PG
      // errors as DrizzleQueryError whose `.message` is the full SQL
      // text + params dump (tens of KB). The `.cause` is the
      // PostgresError with the actual short reason (e.g. "invalid
      // input syntax for type numeric"). Persisting the wrapper's
      // message would bloat the jobs.result column by N × that size.
      const message = extractShortErrorMessage(err);
      const fullMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          jobId: args.jobId,
          targetConnectorEntityId: targetId,
          err: fullMessage,
        },
        "bulk_transform: per-target upsert failed; other targets in batch unaffected"
      );
      const column = firstWriteColumnByTarget.get(targetId);
      for (const s of successes) {
        failures.push({
          sourceKey: s.sourceKey,
          targetConnectorEntityId: targetId,
          ...(column !== undefined ? { column } : {}),
          error: {
            success: false,
            code: "BULK_TRANSFORM_TARGET_UPSERT_FAILED",
            message,
          },
        });
      }
    }
  }

  return { failures, droppedByTarget };
}

// ── Error-message helpers ───────────────────────────────────────────

/**
 * Extract a short, jobs.result-friendly message from a thrown error.
 * Drizzle-orm wraps Postgres failures in `DrizzleQueryError` whose
 * `.message` is the full SQL + params dump (often tens of KB).
 * Persisting that per failure × thousands of records would balloon
 * the jobs.result jsonb column. The PG cause's own message — plus
 * its code prefix — is the short, actionable form.
 */
function extractShortErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${code}: ${cause.message}` : cause.message;
  }
  return err.message;
}

/**
 * Per-job cap on `partialFailures[]` entries. A pathological run
 * where every record fails (e.g. a column-type mismatch) would
 * otherwise produce one entry per source row — N entries times the
 * per-entry overhead bloats the result row. Capping at 100 keeps
 * the job detail page scrollable and the result row bounded; the
 * `partialFailuresOmitted` field carries the dropped count.
 */
const MAX_PARTIAL_FAILURES = 100;

// ── Result finalization ─────────────────────────────────────────────

class DroppedAccumulator {
  private byTarget = new Map<string, Set<string>>();

  absorb(batch: Map<string, Set<string>>): void {
    for (const [targetId, cols] of batch) {
      let bucket = this.byTarget.get(targetId);
      if (!bucket) {
        bucket = new Set();
        this.byTarget.set(targetId, bucket);
      }
      for (const c of cols) bucket.add(c);
    }
  }

  toResult(): {
    droppedByTarget?: NonNullable<BulkTransformResult["droppedByTarget"]>;
    droppedRecords?: number;
  } {
    if (this.byTarget.size === 0) return {};
    const entries = Array.from(this.byTarget.entries())
      .map(([targetConnectorEntityId, cols]) => ({
        targetConnectorEntityId,
        droppedColumns: Array.from(cols).sort(),
      }))
      .sort((a, b) =>
        a.targetConnectorEntityId.localeCompare(b.targetConnectorEntityId)
      );
    // recordsDropped count: best-effort sum of column-drop occurrences.
    // The number isn't load-bearing — the agent reads `droppedByTarget`
    // for the actionable list.
    const droppedRecords = entries.reduce(
      (acc, e) => acc + e.droppedColumns.length,
      0
    );
    return { droppedByTarget: entries, droppedRecords };
  }
}

function finalize(args: {
  startedAt: number;
  recordsProcessed: number;
  partialFailures: NonNullable<BulkTransformResult["partialFailures"]>;
  droppedAcc: DroppedAccumulator;
}): BulkTransformResult {
  const dropped = args.droppedAcc.toResult();
  // Cap partialFailures so a pathological run can't bloat the jobs
  // result row (and the job-details page) without bound. We keep
  // recordsFailed at the true total so the user still sees the
  // headline count; `partialFailuresOmitted` carries the dropped
  // tail count for the entries-array.
  const totalFailed = args.partialFailures.length;
  const partialFailures =
    totalFailed > MAX_PARTIAL_FAILURES
      ? args.partialFailures.slice(0, MAX_PARTIAL_FAILURES)
      : args.partialFailures;
  const partialFailuresOmitted =
    totalFailed > MAX_PARTIAL_FAILURES
      ? totalFailed - MAX_PARTIAL_FAILURES
      : 0;
  return {
    recordsProcessed: args.recordsProcessed,
    recordsFailed: totalFailed,
    durationMs: Date.now() - args.startedAt,
    ...(partialFailures.length > 0 ? { partialFailures } : {}),
    ...(partialFailuresOmitted > 0 ? { partialFailuresOmitted } : {}),
    ...dropped,
  };
}
