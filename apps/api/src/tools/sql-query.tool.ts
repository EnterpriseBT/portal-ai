import { z } from "zod";
import { tool } from "ai";

import { PortalSqlService } from "../services/portal-sql.service.js";
import { JobsService } from "../services/jobs.service.js";
import { ApiError } from "../services/http.service.js";
import {
  CostAcknowledgementService,
  computeSqlQuerySignature,
} from "../services/cost-acknowledgement.service.js";
import { awaitJobTerminal } from "../utils/await-job-terminal.util.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { Tool } from "../types/tools.js";
import { resolveResultSink } from "./result-sink.js";
import { environment } from "../environment.js";

const logger = createLogger({ module: "sql-query-tool" });

const InputSchema = z.object({
  sql: z.string().describe("The SQL query to execute"),
  acknowledgeCost: z
    .boolean()
    .optional()
    .describe(
      "User-confirmation gate for the async job tier. A long/expensive " +
        "query (EXPLAIN cost over threshold, or one that hits the 30s " +
        "synchronous timeout) can't run inline — it must run as a " +
        "background job. The server enforces the gate: the first call " +
        "without this flag is rejected with " +
        "`SQL_QUERY_COST_NOT_ACKNOWLEDGED`. Tell the user it'll run in the " +
        "background, then retry with `acknowledgeCost: true` AFTER they " +
        "reply. Setting it on a first attempt, or in the same turn as the " +
        "rejection, is rejected with `SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID`."
    ),
});

export class SqlQueryTool extends Tool<typeof InputSchema> {
  slug = "sql_query";
  name = "SQL Query Tool";
  description =
    "Executes a SQL query and returns the results to the user. Result-set size is handled automatically: small results come back inline, larger results return a handle envelope `{queryHandle, rowCount, schema, samplePeek}` and the full rows stream to the UI without entering your context. Either way the user sees every row. **Do not add a LIMIT clause to optimize for inline delivery** — pass the user's query through unbounded. `samplePeek` is a small slice for your own follow-up reasoning, NOT a 'sample for the user'. Use aggregations (COUNT, AVG, GROUP BY) only when the user explicitly asked a summary question.\n\nA genuinely long or expensive query (a multi-minute aggregate scan) is escalated automatically to a background job, gated on user confirmation: the first call is rejected with `SQL_QUERY_COST_NOT_ACKNOWLEDGED`, you tell the user it'll run in the background, and after they reply you retry with `acknowledgeCost: true`. The result comes back as the same handle envelope, just asynchronously.";

  get schema() {
    return InputSchema;
  }

  /**
   * @param stationId       station scope for the query's temp views
   * @param organizationId  org scope embedded in the views' WHERE
   * @param userId          enqueuer of the escalated job; omit for
   *                        non-portal callers (tests/scripts)
   * @param portalId        portal whose cost-ack flow gates escalation;
   *                        omit for non-portal callers
   *
   * Job-tier escalation (#130 E1b) is wired only when BOTH `userId` and
   * `portalId` are supplied (production always supplies them). Without
   * them the tool runs the synchronous-only path — today's behavior — so
   * tests and scratch scripts need no portal context.
   */
  build(
    stationId: string,
    organizationId: string,
    userId?: string,
    portalId?: string
  ) {
    const escalationEnabled = userId != null && portalId != null;

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input, options) => {
        const { sql, acknowledgeCost } = this.validate(input);
        const abortSignal = (
          options as { abortSignal?: AbortSignal } | undefined
        )?.abortSignal;

        // ── Escalation: retry-with-ack path. The user confirmed the
        //    async job; validate the acknowledgement against the recorded
        //    rejection, then enqueue the job and await its handle envelope.
        if (acknowledgeCost === true) {
          if (!escalationEnabled) {
            throw new ApiError(
              400,
              ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID,
              "Cost acknowledgement is not available in this context.",
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID
                  ],
              }
            );
          }
          const signature = computeSqlQuerySignature({ sql, stationId });
          const ack = await CostAcknowledgementService.validate(
            portalId,
            signature
          );
          if (!ack.ok) {
            const message =
              ack.reason === "missing"
                ? "No prior escalation on file for this query. Call without acknowledgeCost first so the cost is surfaced to the user."
                : "User has not replied since the escalation. Wait for their next message before retrying with acknowledgeCost: true.";
            throw new ApiError(
              400,
              ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID,
              message,
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID
                  ],
                details: { reason: ack.reason },
              }
            );
          }
          return await this.runAsJob({
            sql,
            stationId,
            organizationId,
            userId,
            abortSignal,
          });
        }

        // ── Escalation: predictive EXPLAIN trigger (spec D8a, hybrid).
        //    EXPLAIN the validated query (non-executing); if PG's estimated
        //    plan cost crosses the threshold, escalate up front — no wasted
        //    synchronous attempt. EXPLAIN failures degrade to the sync path
        //    (the 30s backstop below still protects us), so swallow here.
        if (escalationEnabled) {
          const estimate = await PortalSqlService.explainSqlQuery({
            sql,
            stationId,
            organizationId,
          }).catch((err) => {
            logger.info(
              { stationId, err: err instanceof Error ? err.message : err },
              "sql_query EXPLAIN probe failed; falling back to sync path"
            );
            return null;
          });
          if (
            estimate &&
            estimate.totalCost >= environment.SQL_QUERY_JOB_COST_THRESHOLD
          ) {
            logger.info(
              {
                stationId,
                totalCost: estimate.totalCost,
                estimatedRows: estimate.estimatedRows,
                threshold: environment.SQL_QUERY_JOB_COST_THRESHOLD,
              },
              "sql_query escalating to job tier (EXPLAIN cost over threshold)"
            );
            return await this.rejectForCostAck({
              sql,
              stationId,
              portalId,
              estimate,
            });
          }
        }

        // ── Synchronous path (today's behavior) with the timeout backstop.
        try {
          // Inline-vs-handle is the shared output-sink decision (#164): small
          // results return inline, larger ones stage a cursor-backed SQL
          // handle (`{ type: "data-table", ...envelope }`) so the rows never
          // thread through the agent's context. Either way the user sees all.
          return await resolveResultSink(
            { kind: "rows", onLarge: "handle" },
            { sql },
            { stationId, organizationId }
          );
        } catch (err) {
          // Backstop (spec D8a): the predictive EXPLAIN under-estimated and
          // the query hit the 30s synchronous statement_timeout. Escalate
          // it to the job tier through the same cost-ack gate.
          if (escalationEnabled && isPortalSqlTimeout(err)) {
            logger.info(
              { stationId },
              "sql_query escalating to job tier (30s timeout backstop)"
            );
            return await this.rejectForCostAck({ sql, stationId, portalId });
          }
          throw err;
        }
      },
    });
  }

  /**
   * Record the escalation and reject with `SQL_QUERY_COST_NOT_ACKNOWLEDGED`,
   * stashing a pending acknowledgement keyed by `(portalId, query)`. The
   * agent surfaces the cost; the retry with `acknowledgeCost: true` only
   * passes once the user has sent a new message (server-knowable consent).
   */
  private async rejectForCostAck(opts: {
    sql: string;
    stationId: string;
    portalId: string;
    estimate?: { totalCost: number; estimatedRows: number };
  }): Promise<never> {
    const signature = computeSqlQuerySignature({
      sql: opts.sql,
      stationId: opts.stationId,
    });
    await CostAcknowledgementService.recordRejection(
      opts.portalId,
      signature,
      Date.now()
    );
    throw new ApiError(
      400,
      ApiCode.SQL_QUERY_COST_NOT_ACKNOWLEDGED,
      "This query is too long/expensive to run inline; it must run as a background job. Tell the user it'll run in the background, then retry with acknowledgeCost: true AFTER they reply.",
      {
        recommendation:
          ApiCodeDefaultRecommendation[ApiCode.SQL_QUERY_COST_NOT_ACKNOWLEDGED],
        ...(opts.estimate
          ? {
              details: {
                estimatedCost: opts.estimate.totalCost,
                estimatedRows: opts.estimate.estimatedRows,
              },
            }
          : {}),
      }
    );
  }

  /**
   * Enqueue the `sql_query` job (E1a's 120s off-thread processor), await
   * its terminal envelope, and hand the staged handle back exactly like
   * the synchronous handle path. Read-only: no lock.
   */
  private async runAsJob(opts: {
    sql: string;
    stationId: string;
    organizationId: string;
    userId: string;
    abortSignal?: AbortSignal;
  }): Promise<Record<string, unknown>> {
    const job = await JobsService.create(opts.userId, {
      organizationId: opts.organizationId,
      type: "sql_query",
      metadata: {
        sql: opts.sql,
        stationId: opts.stationId,
        organizationId: opts.organizationId,
      },
    });

    logger.info(
      { jobId: job.id, stationId: opts.stationId },
      "sql_query escalated job enqueued; awaiting terminal"
    );

    const outcome = await awaitJobTerminal(job.id, {
      signal: opts.abortSignal,
    });

    if (outcome.status === "completed") {
      // The processor's terminal payload is the handle envelope; tag it
      // with `type: "data-table"` to match the synchronous handle path.
      return { type: "data-table", ...(outcome.result ?? {}) };
    }
    if (outcome.status === "cancelled") {
      throw new ApiError(
        409,
        ApiCode.SQL_QUERY_JOB_CANCELLED,
        "The query was cancelled before it finished.",
        {
          recommendation:
            ApiCodeDefaultRecommendation[ApiCode.SQL_QUERY_JOB_CANCELLED],
        }
      );
    }
    throw new ApiError(
      400,
      ApiCode.SQL_QUERY_JOB_FAILED,
      outcome.error ?? "The query job failed.",
      {
        recommendation:
          ApiCodeDefaultRecommendation[ApiCode.SQL_QUERY_JOB_FAILED],
        details: { jobId: job.id, error: outcome.error },
      }
    );
  }
}

/** True when an error is the portal SQL 30s `statement_timeout` (the
 *  synchronous ceiling). Used to trigger the job-tier backstop. */
function isPortalSqlTimeout(err: unknown): boolean {
  return err instanceof ApiError && err.code === ApiCode.PORTAL_SQL_TIMEOUT;
}
