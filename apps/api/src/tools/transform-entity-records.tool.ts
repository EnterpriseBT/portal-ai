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
import { wideTableStatementCache } from "../services/wide-table-statement.cache.js";
import {
  CostAcknowledgementService,
  computeJobSignature,
} from "../services/cost-acknowledgement.service.js";
import { createLogger } from "../utils/logger.util.js";
import { MAX_BULK_RECORDS } from "@portalai/core/constants";

const logger = createLogger({ module: "transform-entity-records-tool" });

const ValueFromSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool_result") }),
  z.object({
    kind: z.literal("tool_path"),
    path: z
      .string()
      .describe(
        "Lodash-style path into the tool's per-record output, e.g. " +
          "`diameter.km.avg` or `matches[0].score`. Empty string " +
          "resolves to the whole tool result — useful for primitive " +
          "outputs (e.g. `z.number()`)."
      ),
  }),
  z.object({
    kind: z.literal("sql_alias"),
    alias: z
      .string()
      .describe(
        "Alias declared in the SQL-kind `expression.value` projection " +
          "(the name after `AS`). Only valid when `expression.kind === 'sql'`."
      ),
  }),
  z.object({
    kind: z.literal("source_column"),
    column: z
      .string()
      .describe(
        "Wide-column name on the SOURCE entity. The per-record value " +
          "is read from the source row and copied to the target column."
      ),
  }),
  z.object({
    kind: z.literal("constant"),
    value: z
      .unknown()
      .describe(
        "Literal value written to every per-record row. Pre-flight " +
          "validates the value casts to the target column's pgType."
      ),
  }),
]);

const WriteSchema = z.object({
  targetConnectorEntityId: z
    .string()
    .describe(
      "Connector entity to write into; locked while the job runs. Look " +
        "up the id via `station_context`. The aggregate set of " +
        "`targetConnectorEntityId` across all writes is the lock set."
    ),
  column: z
    .string()
    .describe(
      "Wide-column name on the target entity (e.g. `c_diameter_avg_km`). " +
        "Look up via `station_context` (`columns[].wideColumnName`). " +
        "Pre-flight rejects names that aren't wide-columns on the target."
    ),
  valueFrom: ValueFromSchema.describe(
    "How this column's value is sourced for each record. Five kinds: " +
      "`tool_result` (whole tool output), `tool_path` (sub-value via " +
      "Lodash path), `sql_alias` (named alias in the SQL projection), " +
      "`source_column` (passthrough from the source row), `constant` " +
      "(literal value)."
  ),
});

const ExpressionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql"),
    value: z
      .string()
      .describe(
        "SQL projection expression containing ONLY the derived columns " +
          "you want to write into the target. Every segment MUST use " +
          "`<expr> AS <alias>` syntax — bare column references are " +
          "rejected. Aliases are referenced by `writes[].valueFrom` of " +
          "kind `sql_alias`. Do NOT include the key field here (it's " +
          "passed separately via `keyField` and written to the target's " +
          "`source_id` automatically). " +
          'Example: `("c_diameter_km_min" + "c_diameter_km_max") / 2.0 ' +
          "AS diameter_avg_km`."
      ),
    writes: z
      .array(WriteSchema)
      .min(1)
      .describe(
        "One or more (column, valueFrom) mappings. Each write lands a " +
          "per-record value into a target wide-column. Multiple writes " +
          "can target the same entity (multi-column landing) or " +
          "different entities (cross-entity writes)."
      ),
  }),
  z.object({
    kind: z.literal("tool"),
    ref: z
      .string()
      .describe(
        "Exact tool name from `station_context` (e.g. " +
          "'nasa_diameter_avg_fast'). Must declare bulkDispatch metadata."
      ),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Optional tool-wide static arguments passed alongside every " +
          "per-record call. Use this for invariants like a model name, " +
          "a unit system, or an API version. The source row's columns " +
          "arrive at the top level of the tool's input automatically " +
          "(plus `sourceKey` and `sourceRow`); don't repeat them here. " +
          "Leave undefined unless you have a real tool-wide setting."
      ),
    writes: z
      .array(WriteSchema)
      .min(1)
      .describe(
        "One or more (column, valueFrom) mappings. The tool returns one " +
          "value per record; `writes[]` decides where that value (or " +
          "sub-values via `tool_path`) lands. Multiple writes from a " +
          "single tool call land per-record values into N target columns " +
          "without re-dispatching the tool."
      ),
  }),
]);

const InputSchema = z.object({
  sourceConnectorEntityId: z
    .string()
    .describe(
      "Connector entity to scan; read-only during the job. Use the " +
        "`connectorEntityId` listed next to the entity in `## Available " +
        "Data`, or query `SELECT id FROM _meta_entities WHERE key = '<entity_key>'`. " +
        "Do NOT ask the user — the value is in your context."
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
      "User-confirmation gate for expensive tools. The server enforces " +
        "the gate: on a first call without this flag against a " +
        "`costHint: \"expensive\"` tool, the API rejects with " +
        "`BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` and records a pending " +
        "acknowledgement. To retry with `acknowledgeCost: true`, the " +
        "user must send a new message between the rejection and the " +
        "retry — that's the objective signal that they consented. " +
        "Setting this flag on a first attempt or in the same turn as " +
        "the rejection is rejected with " +
        "`BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID`."
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

export class TransformEntityRecordsTool extends Tool<typeof InputSchema> {
  slug = "transform_entity_records";
  name = "Transform Entity Records";
  description =
    "Run a per-record transform across a source entity and upsert the results into a target entity. " +
    "Use this for high-cardinality writes (≥100 records) where calling `entity_record_create` " +
    "in a loop would exhaust the agent's context. The job runs asynchronously: this tool returns " +
    "immediately with a jobId and an ETA, the user sees a live progress widget, and the chat is " +
    "locked from new input until the job completes. " +
    "Express the per-record derivation as a SQL projection in `expression.value` whose aliases match " +
    "target wide-column names (e.g. `ST_Area(geometry::geography) / 4047 AS c_acreage`).\n\n" +
    "**Expensive-tool confirmation gate.** When `expression.kind === 'tool'` and the tool declared " +
    "`costHint: \"expensive\"`, the API rejects the first call with " +
    "`BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`. You MUST ask the user to confirm and WAIT for their next " +
    "message before retrying with `acknowledgeCost: true`.\n\n" +
    "Worked example — user prompts \"Run nasa_diameter_avg_expensive against every NEO\":\n\n" +
    "  Good (two turns, user confirms in between):\n" +
    "    Turn 1 (your turn):\n" +
    "      [transform_entity_records — NO acknowledgeCost field at all]\n" +
    "      → API returns BULK_DISPATCH_COST_NOT_ACKNOWLEDGED with the cost estimate\n" +
    "      You say: \"This tool is declared expensive. With 10,299 records at 50ms each over\n" +
    "       10 concurrent calls, it'll take ~52 seconds. Should I proceed?\"\n" +
    "      [you stop — no more tool calls this turn]\n\n" +
    "    Turn 2 (user's turn): \"yes, proceed\"\n\n" +
    "    Turn 3 (your turn):\n" +
    "      [transform_entity_records with acknowledgeCost: true]\n\n" +
    "  Bad (skipping the user's turn):\n" +
    "    Turn 1:\n" +
    "      [tool call without acknowledgeCost]\n" +
    "      → rejection\n" +
    "      You: \"This is expensive but I'll proceed.\"\n" +
    "      [tool call WITH acknowledgeCost: true] ← WRONG. User never consented.\n\n" +
    "  Bad (asking but retrying same turn):\n" +
    "    Turn 1:\n" +
    "      [...rejection...]\n" +
    "      You: \"Should I proceed?\"\n" +
    "      [tool call with acknowledgeCost: true] ← WRONG. Question wasn't answered yet.\n\n" +
    "The user MUST respond between the rejection and the retry. The two tool calls live in " +
    "different turns. If you find yourself about to make the second call in the same turn, stop " +
    "and end the turn instead.";

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

          // Slice 0 (#99): writes[] is the agent's per-column mapping.
          // Slice 0 keeps single-write behavior — read writes[0] where
          // the prior `targetConnectorEntityId` / `targetColumn` lived.
          // Slice 2 expands pre-flight to validate every entry; slice 3
          // expands the lock check to the array; slice 4 expands the
          // processor's write path.
          const writes = parsed.expression.writes;
          const targetConnectorEntityIds = Array.from(
            new Set(writes.map((w) => w.targetConnectorEntityId))
          ).sort();
          // Slice 0 (#99) used `primaryTargetId` for the legacy
          // single-target lock + signature paths. Slice 3 generalizes
          // the lock to the full array; until then, `writes[0]`'s
          // target stands in.
          const primaryTargetId = writes[0].targetConnectorEntityId;

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
              primaryTargetId
            );
          if (!target) {
            throw new ApiError(
              404,
              ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
              `Target entity not found: ${primaryTargetId}`
            );
          }

          // Step 2 — target lock. Slice 3 (#99): passes the full union
          // of write targets, not just `primaryTargetId`. A locked
          // entity anywhere in the set surfaces in the 409 details so
          // the agent (and UI) see every blocked target at once.
          await JobLockService.assertConnectorEntityUnlocked(
            targetConnectorEntityIds,
            organizationId
          );

          // Step 2a — validate keyField exists on the source's wide
          // table. Catches the case where the agent invents a friendly
          // name (e.g. `asteroid_id` instead of `c_id`) — the SQL
          // would only blow up at runtime otherwise, and the job
          // would consume the target lock + sit failed in the queue.
          const sourceStmt = await wideTableStatementCache.get(
            parsed.sourceConnectorEntityId
          );
          const sourceWideColumns = sourceStmt.columns.map(
            (c) => c.columnName
          );
          if (!sourceWideColumns.includes(parsed.keyField)) {
            throw new ApiError(
              400,
              ApiCode.BULK_JOB_KEY_FIELD_INVALID,
              `keyField '${parsed.keyField}' is not a wide-column on the source entity.`,
              {
                recommendation:
                  ApiCodeDefaultRecommendation[
                    ApiCode.BULK_JOB_KEY_FIELD_INVALID
                  ],
                details: {
                  availableColumns: sourceWideColumns.slice().sort(),
                },
              }
            );
          }

          // Step 2b — slice 2 (#99): per-write validation pipeline.
          // For each unique target id load its wide-column map (one
          // cache.get per target); validate every write's column
          // exists on its target; per-kind sub-checks (constant cast,
          // source_column existence, sql_alias declared); for SQL kind,
          // reject declared aliases that no write references (catches
          // the agent projecting the keyField under an invented name).
          const targetColumnMaps = new Map<
            string,
            Map<string, string>
          >();
          for (const tid of targetConnectorEntityIds) {
            const stmt = await wideTableStatementCache.get(tid);
            const colMap = new Map<string, string>();
            for (const c of stmt.columns) colMap.set(c.columnName, c.pgType);
            targetColumnMaps.set(tid, colMap);
          }

          for (const [i, write] of writes.entries()) {
            const targetCols = targetColumnMaps.get(
              write.targetConnectorEntityId
            )!;

            // 2b.1 — target column exists.
            if (!targetCols.has(write.column)) {
              throw new ApiError(
                400,
                ApiCode.BULK_JOB_EXPRESSION_INVALID,
                `writes[${i}]: column '${write.column}' is not a wide-column on target entity '${write.targetConnectorEntityId}'.`,
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_JOB_EXPRESSION_INVALID
                    ],
                  details: {
                    write: {
                      targetConnectorEntityId: write.targetConnectorEntityId,
                      column: write.column,
                    },
                    availableTargetColumns: Array.from(targetCols.keys()).sort(),
                  },
                }
              );
            }

            // 2b.2 — constant cast check against the target column's
            // PG type. Uses `BulkTransformService.canCastConstant` so
            // tests can mock the round-trip.
            if (write.valueFrom.kind === "constant") {
              const pgType = targetCols.get(write.column)!;
              const ok = await BulkTransformService.canCastConstant(
                write.valueFrom.value,
                pgType
              );
              if (!ok) {
                throw new ApiError(
                  400,
                  ApiCode.BULK_JOB_EXPRESSION_INVALID,
                  `writes[${i}]: constant value cannot be cast to '${pgType}' for column '${write.column}'.`,
                  {
                    recommendation:
                      ApiCodeDefaultRecommendation[
                        ApiCode.BULK_JOB_EXPRESSION_INVALID
                      ],
                    details: {
                      write: {
                        targetConnectorEntityId:
                          write.targetConnectorEntityId,
                        column: write.column,
                      },
                      pgType,
                    },
                  }
                );
              }
            }

            // 2b.3 — source_column existence on the source wide table.
            if (write.valueFrom.kind === "source_column") {
              if (!sourceWideColumns.includes(write.valueFrom.column)) {
                throw new ApiError(
                  400,
                  ApiCode.BULK_JOB_EXPRESSION_INVALID,
                  `writes[${i}]: source_column '${write.valueFrom.column}' is not a wide-column on the source entity.`,
                  {
                    recommendation:
                      ApiCodeDefaultRecommendation[
                        ApiCode.BULK_JOB_EXPRESSION_INVALID
                      ],
                    details: {
                      write: {
                        targetConnectorEntityId:
                          write.targetConnectorEntityId,
                        column: write.column,
                      },
                      availableSourceColumns: sourceWideColumns
                        .slice()
                        .sort(),
                    },
                  }
                );
              }
            }
          }

          // 2b.4 — SQL-kind only: parse projection aliases, validate
          // each `sql_alias` write references a declared alias, and
          // flag declared aliases that no write picks up (the agent
          // projected something the writes[] map doesn't use — often
          // the keyField under an invented name).
          if (parsed.expression.kind === "sql") {
            const { parseProjections } = await import(
              "../utils/sql-projection.util.js"
            );
            let declaredAliases: string[];
            try {
              declaredAliases = parseProjections(
                parsed.expression.value
              ).map((p) => p.alias);
            } catch (err) {
              throw new ApiError(
                400,
                ApiCode.BULK_JOB_EXPRESSION_INVALID,
                err instanceof Error
                  ? err.message
                  : "Could not parse expression aliases.",
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_JOB_EXPRESSION_INVALID
                    ],
                }
              );
            }
            const declaredSet = new Set(declaredAliases);
            const referencedAliases = new Set<string>();
            for (const [i, write] of writes.entries()) {
              if (write.valueFrom.kind !== "sql_alias") continue;
              const alias = write.valueFrom.alias;
              if (!declaredSet.has(alias)) {
                throw new ApiError(
                  400,
                  ApiCode.BULK_JOB_EXPRESSION_INVALID,
                  `writes[${i}]: sql_alias '${alias}' is not declared in expression.value's projection.`,
                  {
                    recommendation:
                      ApiCodeDefaultRecommendation[
                        ApiCode.BULK_JOB_EXPRESSION_INVALID
                      ],
                    details: {
                      alias,
                      declaredAliases,
                    },
                  }
                );
              }
              referencedAliases.add(alias);
            }
            const unreferenced = declaredAliases.filter(
              (a) => !referencedAliases.has(a)
            );
            if (unreferenced.length > 0) {
              throw new ApiError(
                400,
                ApiCode.BULK_JOB_EXPRESSION_INVALID,
                `expression.value declares alias(es) ${unreferenced
                  .map((a) => `'${a}'`)
                  .join(", ")} that no writes[] entry references. Either drop the alias from the projection or add a writes[] entry with valueFrom.kind === 'sql_alias' that references it.`,
                {
                  recommendation:
                    ApiCodeDefaultRecommendation[
                      ApiCode.BULK_JOB_EXPRESSION_INVALID
                    ],
                  details: {
                    unreferencedAliases: unreferenced,
                  },
                }
              );
            }
          }

          // Step 3 — expression kind: sql + tool both supported in
          // Phase 4. Tool kind has its own pre-flight chain (lookup,
          // cost-gate, ETA); sql kind continues to the EXPLAIN path.
          let toolMetadata:
            | import("@portalai/core/registries").BulkDispatchMetadata
            | undefined;
          let estimatedSecondsOverride: number | undefined;
          if (parsed.expression.kind === "tool") {
            // Step 2b above already validated each write's column on
            // its target — including the writes[0] case the prior
            // narrow Step 3a covered.

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

            // Cost gate — server-enforced. Two-step:
            //   1) No acknowledgeCost + expensive tool → record a
            //      pending entry tagged with `now`, reject with
            //      COST_NOT_ACKNOWLEDGED.
            //   2) acknowledgeCost: true on an expensive tool →
            //      validate against the recorded entry. The retry
            //      passes only if the user has sent a new message
            //      since the rejection (objective server-knowable
            //      signal). Otherwise reject with
            //      COST_ACKNOWLEDGEMENT_INVALID.
            //
            // Tool description's prompt-side flow is now belt-and-
            // suspenders; the agent CAN'T bypass this gate by setting
            // the flag unilaterally.
            if (toolMetadata.costHint === "expensive") {
              const signature = computeJobSignature({
                sourceConnectorEntityId: parsed.sourceConnectorEntityId,
                targetConnectorEntityId: primaryTargetId,
                expression: parsed.expression,
                keyField: parsed.keyField,
                batchSize: parsed.batchSize ?? 1_000,
              });

              if (parsed.acknowledgeCost !== true) {
                await CostAcknowledgementService.recordRejection(
                  portalId,
                  signature,
                  Date.now()
                );
                throw new ApiError(
                  400,
                  ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED,
                  `Tool '${parsed.expression.ref}' is declared expensive. Surface the cost to the user, then retry with acknowledgeCost: true AFTER they reply.`,
                  {
                    recommendation:
                      ApiCodeDefaultRecommendation[
                        ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
                      ],
                  }
                );
              }

              const ack = await CostAcknowledgementService.validate(
                portalId,
                signature
              );
              if (!ack.ok) {
                const message =
                  ack.reason === "missing"
                    ? `No prior cost rejection on file for this operation. Call without acknowledgeCost first to surface the cost to the user.`
                    : `User has not replied since the cost rejection. Wait for their next message before retrying with acknowledgeCost: true.`;
                throw new ApiError(
                  400,
                  ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID,
                  message,
                  {
                    recommendation:
                      ApiCodeDefaultRecommendation[
                        ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID
                      ],
                    details: { reason: ack.reason },
                  }
                );
              }
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
              targetConnectorEntityIds,
              expression: parsed.expression,
              keyField: parsed.keyField,
              batchSize,
              acknowledgeCost: parsed.acknowledgeCost,
              sourceFilter: parsed.sourceFilter,
              organizationId,
              portalId,
              userId,
              // The worker reads this back via `bullJob.data.stationId`
              // and threads it into `lookupBulkDispatchable` so the
              // org-toolpack scan (#85 Phase 4 webhook bulkDispatch
              // wiring) can resolve the same tool the pre-flight just
              // resolved. Without it the worker uses "" and the lookup
              // fails — pre-flight passes but the worker throws
              // BULK_DISPATCH_TOOL_NOT_FOUND.
              stationId,
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
            "transform_entity_records enqueued"
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
