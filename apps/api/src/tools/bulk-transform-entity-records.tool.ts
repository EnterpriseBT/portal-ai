import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import { ApiError } from "../services/http.service.js";
import { DbService } from "../services/db.service.js";
import { JobLockService } from "../services/job-lock.service.js";
import { BulkTransformService } from "../services/bulk-transform.service.js";
import { JobsService } from "../services/jobs.service.js";
import { ToolService } from "../services/tools.service.js";
import { createLogger } from "../utils/logger.util.js";
import { MAX_BULK_RECORDS } from "@portalai/core/constants";

const logger = createLogger({ module: "bulk-transform-entity-records-tool" });

const ExpressionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql"),
    value: z
      .string()
      .describe(
        "SQL projection expression containing ONLY the derived columns " +
          "you want to write into the target. Every segment MUST use " +
          "`<expr> AS c_<column_name>` syntax — bare column references " +
          "are rejected. Do NOT include the key field here (it's passed " +
          "separately via `keyField` and written to the target's " +
          "`source_id` automatically). " +
          'Example: `("c_diameter_km_min" + "c_diameter_km_max") / 2.0 ' +
          "AS c_diameter_avg_km`. Multi-column example: " +
          '`UPPER("c_name") AS c_name_upper, "c_a" + "c_b" AS c_sum`.'
      ),
  }),
  z.object({
    kind: z.literal("tool"),
    ref: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const InputSchema = z.object({
  sourceConnectorEntityId: z
    .string()
    .describe("Connector entity to scan; read-only during the job."),
  targetConnectorEntityId: z
    .string()
    .describe(
      "Connector entity to write into; locked while the job is non-terminal."
    ),
  expression: ExpressionSchema,
  keyField: z
    .string()
    .describe(
      "Wide-column name on the source row used as the upsert key on the " +
        "target's `source_id` column. The key value is read from the source " +
        "and written to the target automatically — do NOT also include this " +
        "column in `expression.value`. Example: `c_id`, `c_parcel_id`."
    ),
  batchSize: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .optional()
    .describe("Per-batch UPSERT count; defaults to 1000."),
  acknowledgeCost: z
    .boolean()
    .optional()
    .describe(
      "Required when the dispatched tool declared costHint: 'expensive' (Phase 4)."
    ),
  sourceFilter: z
    .object({
      whereSqlFragment: z
        .string()
        .describe(
          "PostgreSQL WHERE fragment injected into the source-side cursor. " +
            "Used for retry-failed-only flows: pass a fragment like " +
            "\"c_parcel_id IN ('p-99','p-499','p-999')\" to scope the run " +
            "to those source keys. Validated via EXPLAIN at pre-flight."
        ),
    })
    .optional()
    .describe(
      "Optional source-side filter. Use this for retry-failed-only and " +
        "any other case where only a subset of source rows should run."
    ),
});

/**
 * Convert any thrown error into the tool-result error envelope shape so
 * the agent can react. Wraps `ApiError` and unknown errors uniformly.
 */
function toEnvelope(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) {
    return {
      success: false,
      message: err.message,
      code: err.code,
      ...(err.recommendation
        ? { recommendation: err.recommendation }
        : {}),
      ...(err.details ? { details: err.details } : {}),
    };
  }
  const e = err as Error;
  return {
    success: false,
    message: e?.message ?? "Unknown failure during bulk_transform pre-flight.",
    code: "BULK_JOB_PREFLIGHT_FAILED",
  };
}

export class BulkTransformEntityRecordsTool extends Tool<typeof InputSchema> {
  slug = "bulk_transform_entity_records";
  name = "Bulk Transform Entity Records";
  description =
    "Run a per-record transform across a source entity and upsert the results into a target entity. " +
    "Use this for high-cardinality writes (≥100 records) where calling `entity_record_create` " +
    "in a loop would exhaust the agent's context. The job runs asynchronously: this tool returns " +
    "immediately with a jobId and an ETA, the user sees a live progress widget, and the chat is " +
    "locked from new input until the job completes. " +
    "Express the per-record derivation as a SQL projection in `expression.value` whose aliases match " +
    "target wide-column names (e.g. `ST_Area(geometry::geography) / 4047 AS c_acreage`).";

  get schema() {
    return InputSchema;
  }

  build(
    portalId: string,
    stationId: string,
    organizationId: string,
    userId: string
  ) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const parsed = this.validate(input);

          // Step 1 — source + target exist + org-scoped.
          const source =
            await DbService.repository.connectorEntities.findById(
              parsed.sourceConnectorEntityId
            );
          if (!source) {
            throw new ApiError(
              404,
              ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
              `Source entity not found: ${parsed.sourceConnectorEntityId}`
            );
          }
          const target =
            await DbService.repository.connectorEntities.findById(
              parsed.targetConnectorEntityId
            );
          if (!target) {
            throw new ApiError(
              404,
              ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
              `Target entity not found: ${parsed.targetConnectorEntityId}`
            );
          }

          // Step 2 — target lock.
          await JobLockService.assertConnectorEntityUnlocked(
            parsed.targetConnectorEntityId,
            organizationId
          );

          // Step 3 — expression kind: sql + tool both supported in
          // Phase 4. Tool kind has its own pre-flight chain (lookup,
          // cost-gate, ETA); sql kind continues to the EXPLAIN path.
          let toolMetadata:
            | import("@portalai/core/registries").BulkDispatchMetadata
            | undefined;
          let estimatedSecondsOverride: number | undefined;
          if (parsed.expression.kind === "tool") {
            const lookup = await ToolService.lookupBulkDispatchable(
              parsed.expression.ref,
              organizationId,
              stationId,
              userId
            );
            if (!lookup) {
              throw new ApiError(
                400,
                ApiCode.BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE,
                `Tool '${parsed.expression.ref}' isn't bulk-dispatchable. Add a 'bulkDispatch' metadata block to its toolpack descriptor.`,
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE
                    ],
                }
              );
            }
            toolMetadata = lookup.metadata;

            // Cost gate — `expensive` requires explicit acknowledge.
            if (
              toolMetadata.costHint === "expensive" &&
              parsed.acknowledgeCost !== true
            ) {
              throw new ApiError(
                400,
                ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED,
                `Tool '${parsed.expression.ref}' is declared expensive. Confirm with the user, then retry with acknowledgeCost: true.`,
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
                    ],
                }
              );
            }
          } else {
            // Step 4 — EXPLAIN the assembled SQL (sql-kind only).
            try {
              await BulkTransformService.explainExpression(
                parsed.sourceConnectorEntityId,
                organizationId,
                parsed.expression.value
              );
            } catch (err) {
              throw new ApiError(
                400,
                ApiCode.BULK_JOB_EXPRESSION_INVALID,
                "The SQL expression failed validation against the source.",
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_JOB_EXPRESSION_INVALID
                    ],
                  details: {
                    pgError: err instanceof Error ? err.message : String(err),
                  },
                }
              );
            }
          }

          // Step 5 — max-records guard.
          const expectedRecords = await BulkTransformService.countSourceRows(
            parsed.sourceConnectorEntityId,
            organizationId
          );

          // Phase 4 ETA: when toolMetadata.estimatedMsPerCall is set,
          // override the generic 5ms/record estimate with the actual
          // tool-declared cost.
          if (
            toolMetadata?.estimatedMsPerCall &&
            toolMetadata.maxConcurrency > 0
          ) {
            estimatedSecondsOverride = Math.max(
              5,
              Math.ceil(
                (expectedRecords * toolMetadata.estimatedMsPerCall) /
                  (toolMetadata.maxConcurrency * 1000)
              )
            );
          }
          if (expectedRecords > MAX_BULK_RECORDS) {
            throw new ApiError(
              400,
              ApiCode.BULK_JOB_MAX_RECORDS_EXCEEDED,
              `Source has ${expectedRecords} records; max allowed is ${MAX_BULK_RECORDS}.`,
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.BULK_JOB_MAX_RECORDS_EXCEEDED
                  ],
              }
            );
          }

          // Step 6 — enqueue. Metadata threads through to the
          // processor (organizationId + portalId so the worker hook
          // in slice 3 can notify the right portal on terminal).
          const batchSize = parsed.batchSize ?? 1_000;
          const job = await JobsService.create(userId, {
            organizationId,
            type: "bulk_transform",
            metadata: {
              sourceConnectorEntityId: parsed.sourceConnectorEntityId,
              targetConnectorEntityId: parsed.targetConnectorEntityId,
              expression: parsed.expression,
              keyField: parsed.keyField,
              batchSize,
              acknowledgeCost: parsed.acknowledgeCost,
              sourceFilter: parsed.sourceFilter,
              organizationId,
              portalId,
            },
          });

          // Rough ETA — tool-kind paths use the tool's
          // estimatedMsPerCall when set; sql-kind falls back to the
          // generic 5ms/record heuristic. Either way, this is a hint
          // for the user before the job starts.
          const estimatedSeconds =
            estimatedSecondsOverride ??
            Math.max(5, Math.ceil((expectedRecords * 5) / 1000));

          logger.info(
            {
              jobId: job.id,
              portalId,
              expectedRecords,
              batchSize,
            },
            "bulk_transform_entity_records enqueued"
          );

          return {
            jobId: job.id,
            expectedRecords,
            estimatedSeconds,
            message: `Importing ${expectedRecords} records. ETA ${estimatedSeconds}s.`,
            blockKind: "bulk-job-progress",
            blockContent: {
              jobId: job.id,
              expectedRecords,
              viewKind: "histogram",
            },
          };
        } catch (err) {
          // Surface as a structured envelope so the agent reads the
          // recommendation rather than a stringified throw.
          return toEnvelope(err);
        } finally {
          // Avoid leaking the unused `stationId` arg; the variable is
          // closed over for future per-station scope checks.
          void stationId;
        }
      },
    });
  }
}
