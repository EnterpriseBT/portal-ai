import { z } from "zod";
import { tool } from "ai";

import { TERMINAL_JOB_STATUSES } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";
import type { JobUpdateEvent } from "@portalai/core/contracts";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { JobsService } from "../services/jobs.service.js";
import { JobEventsService } from "../services/job-events.service.js";
import { BulkAggregateService } from "../services/bulk-aggregate.service.js";
import { ApiError } from "../services/http.service.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "bulk-aggregate-tool" });

/** How often the await falls back to reading the job row, covering the
 *  subscribe race (job finished before we subscribed) or a missed
 *  publish. The `statement_timeout` in the processor bounds the total
 *  wait regardless. */
const TERMINAL_POLL_INTERVAL_MS = 1_000;

const InputSchema = z.object({
  sourceConnectorEntityId: z
    .string()
    .describe("The source entity whose records are aggregated."),
  expression: z
    .string()
    .describe(
      "SQL aggregate projection over the source's wide columns (`c_*`), e.g. " +
        '"COUNT(*) AS total" or "SUM(c_area) AS total, AVG(c_age) AS avg_age". ' +
        "Use aggregate functions; the result is one row."
    ),
  sourceFilter: z
    .object({
      whereSqlFragment: z
        .string()
        .describe("SQL WHERE fragment scoping which rows are aggregated."),
    })
    .optional()
    .describe("Optional filter on the source rows before aggregating."),
});

interface TerminalOutcome {
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Resolve when the job reaches a terminal status. Subscribes to the
 * job-events Redis channel (the established convention) and falls back
 * to polling the job row. If `signal` aborts (the agent turn is
 * cancelled), the job is cancelled via the same `JobsService.cancel`
 * path the write tools use — keeping cancel consistent across job types.
 */
function awaitJobTerminal(
  jobId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<TerminalOutcome> {
  return new Promise<TerminalOutcome>((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    let poll: ReturnType<typeof setInterval> | undefined;

    const onAbort = () => {
      void JobsService.cancel(jobId).catch(() => undefined);
    };

    const finish = (outcome: TerminalOutcome) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (poll) clearInterval(poll);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    unsubscribe = JobEventsService.subscribe(jobId, (event: JobUpdateEvent) => {
      if (TERMINAL_JOB_STATUSES.includes(event.status)) {
        finish({
          status: event.status,
          result: (event.result as Record<string, unknown> | null) ?? null,
          error: event.error ?? null,
        });
      }
    });

    const checkRow = async () => {
      const job = await DbService.repository.jobs
        .findById(jobId)
        .catch(() => null);
      if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
        finish({
          status: job.status,
          result: (job.result as Record<string, unknown> | null) ?? null,
          error: job.error ?? null,
        });
      }
    };
    poll = setInterval(() => void checkRow(), TERMINAL_POLL_INTERVAL_MS);
    // Immediate check in case the job is already terminal before the
    // subscription is wired (fast aggregate / subscribe race).
    void checkRow();

    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort);
    }
  });
}

/**
 * bulk_aggregate_records (#100) — reduce N source records to a single
 * value via one SQL aggregate, run as a job so the heavy scan is off
 * the request thread, cancellable, and audited. The tool awaits the
 * terminal envelope and returns it inline so the agent answers in the
 * same turn. No entity writes, no lock (reads-only). SQL-only by design.
 */
export class BulkAggregateEntityRecordsTool extends Tool<typeof InputSchema> {
  slug = "bulk_aggregate_records";
  name = "Bulk Aggregate Records";
  description =
    "Compute a single aggregate value — or a small grouped object — across ALL matching records of a source entity, asynchronously, without writing anything. Use for 'how many / total / average / min / max' questions over large datasets where an inline sql_query would be too slow. Provide a SQL aggregate `expression` over the source's `c_*` wide columns (e.g. `COUNT(*) AS total`, `SUM(c_area) AS total, AVG(c_age) AS avg_age`) and an optional `sourceFilter.whereSqlFragment`. Returns `{ result, recordsProcessed, durationMs }`; `result` is the aggregate row. For per-row values SQL can't compute, derive them first with bulk_transform, then aggregate the derived column.";

  get schema() {
    return InputSchema;
  }

  build(organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input, options) => {
        const parsed = this.validate(input);
        const abortSignal = (
          options as { abortSignal?: AbortSignal } | undefined
        )?.abortSignal;

        // Step 1 — source entity exists + org-scoped.
        const source = await DbService.repository.connectorEntities.findById(
          parsed.sourceConnectorEntityId
        );
        if (!source || source.organizationId !== organizationId) {
          throw new ApiError(
            404,
            ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
            `Source entity not found: ${parsed.sourceConnectorEntityId}`
          );
        }

        // Step 2 — EXPLAIN the aggregate (no lock check; reads-only).
        await BulkAggregateService.explainExpression({
          sourceConnectorEntityId: parsed.sourceConnectorEntityId,
          organizationId,
          expression: parsed.expression,
          whereSqlFragment: parsed.sourceFilter?.whereSqlFragment,
        });

        // Step 3 — enqueue.
        const job = await JobsService.create(userId, {
          organizationId,
          type: "bulk_aggregate",
          metadata: {
            sourceConnectorEntityId: parsed.sourceConnectorEntityId,
            organizationId,
            expression: parsed.expression,
            sourceFilter: parsed.sourceFilter,
          },
        });

        logger.info(
          { jobId: job.id, sourceConnectorEntityId: parsed.sourceConnectorEntityId },
          "bulk_aggregate_records enqueued; awaiting terminal"
        );

        // Step 4 — await terminal (subscribe + poll fallback; abort
        // cancels the job).
        const outcome = await awaitJobTerminal(job.id, { signal: abortSignal });

        // Step 5 — return the envelope, or surface the failure.
        if (outcome.status === "completed") {
          return outcome.result;
        }
        if (outcome.status === "cancelled") {
          throw new ApiError(
            409,
            ApiCode.BULK_JOB_CANCELLED,
            "The aggregate was cancelled before it finished.",
            {
              recommendation:
                ApiCodeDefaultRecommendation[ApiCode.BULK_JOB_CANCELLED],
            }
          );
        }
        // failed — surface the worker's error message (it already
        // carries the specific code's recommendation text).
        throw new ApiError(
          400,
          ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
          outcome.error ?? "The aggregate job failed.",
          { details: { jobId: job.id, error: outcome.error } }
        );
      },
    });
  }
}
