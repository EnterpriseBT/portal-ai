/**
 * Default Haiku-4.5-backed `ColumnDefinitionClassifier` for the REST
 * API connector.
 *
 * Mirrors the spreadsheet pipeline's LLM factory
 * (`apps/api/src/services/spreadsheet-parsing-llm.service.ts:101`):
 * `generateObject` + Anthropic client + per-call telemetry. The
 * prompt is column-shaped (`buildApiClassifierPrompt`) and the
 * response schema mirrors `ApiColumnClassification`.
 *
 * Concurrency: `pLimit(8)` per-call so a 50-column endpoint runs as
 * ~7 batches instead of bursting against the model's rate limit.
 * Mirrors `DEFAULT_INTERPRET_CONCURRENCY`.
 *
 * Failure handling: every model exception is mapped to a
 * `ClassifierError` carrying a `reason` discriminator. The adapter
 * catches `ClassifierError` regardless of reason and degrades to
 * heuristic-only output — the reason is for telemetry, not branching.
 */
import { generateObject as defaultGenerateObject } from "ai";
import { z } from "zod";

import { ColumnDataTypeEnum, type ColumnDataType } from "@portalai/core/models";

import { AiService } from "../../services/ai.service.js";
import { createLogger } from "../../utils/logger.util.js";

import { buildApiClassifierPrompt } from "./classifier.prompt.js";
import { pLimit } from "./p-limit.util.js";
import {
  ClassifierError,
  type ApiClassifierCandidate,
  type ApiColumnClassification,
  type ColumnDefinitionCatalogEntry,
  type ColumnDefinitionClassifier,
} from "./classifier.types.js";

type GenerateObjectArgs = Parameters<typeof defaultGenerateObject>[0];
type GenerateObjectResult = {
  object: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};
type GenerateObjectFn = (
  args: GenerateObjectArgs
) => Promise<GenerateObjectResult>;

export interface CreateClassifierOptions {
  /**
   * Anthropic model id. Defaults to Haiku 4.5 — the task is a narrow
   * schema-constrained match that doesn't need Sonnet, and per-call
   * latency drops ~4× at Haiku. Matches the spreadsheet pipeline's
   * `DEFAULT_INTERPRET_MODEL`.
   */
  model?: string;
  /** Test seam — lets unit tests inject a mocked `generateObject`. */
  generateObject?: GenerateObjectFn;
  /** Per-call concurrency cap. Defaults to 8. */
  concurrency?: number;
  /** Scoped pino logger. Defaults to module: "api-classifier". */
  logger?: ReturnType<typeof createLogger>;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CONCURRENCY = 8;
const BATCH_SIZE = 8;

const ClassificationResponseSchema = z.object({
  classifications: z.array(
    z.object({
      sourceField: z.string(),
      columnDefinitionId: z.string().nullable(),
      suggestedNormalizedKey: z.string(),
      suggestedSemanticType: ColumnDataTypeEnum,
      confidence: z.number(),
      rationale: z.string(),
    })
  ),
});

export function createDefaultClassifier(
  opts: CreateClassifierOptions = {}
): ColumnDefinitionClassifier {
  const anthropic = AiService.providers.anthropic;
  const modelId = opts.model ?? DEFAULT_MODEL;
  const gen: GenerateObjectFn = opts.generateObject ?? defaultGenerateObject;
  const logger = opts.logger ?? createLogger({ module: "api-classifier" });
  const limit = pLimit(opts.concurrency ?? DEFAULT_CONCURRENCY);

  return {
    async classify(
      candidates: ApiClassifierCandidate[],
      catalog: ColumnDefinitionCatalogEntry[]
    ): Promise<ApiColumnClassification[]> {
      if (candidates.length === 0) return [];

      // Batch candidates so a 50-column endpoint doesn't try to send
      // a single 50-column prompt — keeps prompt sizes bounded and
      // lets the concurrency cap parallelize batches.
      const batches: ApiClassifierCandidate[][] = [];
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        batches.push(candidates.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(
        batches.map((batch) =>
          limit(() =>
            runOneBatch(batch, catalog, anthropic, modelId, gen, logger)
          )
        )
      );

      const merged: ApiColumnClassification[] = [];
      const candidateFields = new Set(candidates.map((c) => c.sourceField));
      for (const batch of batchResults) {
        for (const entry of batch) {
          // Silent drop on hallucinated sourceFields — the model
          // occasionally returns extras; the adapter has nowhere to
          // merge them so we discard.
          if (candidateFields.has(entry.sourceField)) {
            merged.push(entry);
          }
        }
      }
      return merged;
    },
  };
}

async function runOneBatch(
  batch: ApiClassifierCandidate[],
  catalog: ColumnDefinitionCatalogEntry[],
  anthropic: ReturnType<
    typeof AiService.providers.anthropic.toString
  > extends string
    ? typeof AiService.providers.anthropic
    : typeof AiService.providers.anthropic,
  modelId: string,
  gen: GenerateObjectFn,
  logger: ReturnType<typeof createLogger>
): Promise<ApiColumnClassification[]> {
  const prompt = buildApiClassifierPrompt({ candidates: batch, catalog });
  const started = Date.now();
  let result: GenerateObjectResult;
  try {
    result = await gen({
      model: anthropic(modelId),
      prompt,
      schema: ClassificationResponseSchema,
    });
  } catch (err) {
    const reason =
      (err as Error).name === "AbortError" ? "timeout" : "network-error";
    logger.warn(
      {
        event: "interpret.llm.error",
        stage: "api-classify",
        reason,
        modelId,
        cause: (err as Error).message,
      },
      "api classifier call failed"
    );
    throw new ClassifierError(reason, (err as Error).message, { cause: err });
  }

  const parsed = ClassificationResponseSchema.safeParse(result.object);
  if (!parsed.success) {
    logger.warn(
      {
        event: "interpret.llm.error",
        stage: "api-classify",
        reason: "malformed-response",
        modelId,
        issues: parsed.error.issues,
      },
      "api classifier response failed schema validation"
    );
    throw new ClassifierError(
      "malformed-response",
      `model response failed ApiClassificationResponseSchema: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`
    );
  }

  const latencyMs = Date.now() - started;
  logger.info(
    {
      event: "interpret.llm.call",
      stage: "api-classify",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      modelId,
      latencyMs,
      candidateCount: batch.length,
    },
    "api classifier batch completed"
  );

  return parsed.data.classifications.map((entry) => ({
    sourceField: entry.sourceField,
    columnDefinitionId: entry.columnDefinitionId,
    suggestedNormalizedKey: entry.suggestedNormalizedKey,
    suggestedSemanticType: entry.suggestedSemanticType as ColumnDataType,
    confidence: clampConfidence(entry.confidence),
    rationale: entry.rationale,
  }));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
