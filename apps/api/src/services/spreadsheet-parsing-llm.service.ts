/**
 * LLM-backed deps factory for `@portalai/spreadsheet-parsing`.
 *
 * The parser module is a pure, leaf library — it never calls a model
 * directly. This service builds `InterpretDeps` that close over the
 * Anthropic client, the api's pino logger, and the selected model id, then
 * hand them to `interpret()` via the parser's `ClassifierFn` /
 * `AxisNameRecommenderFn` DI slots. Swapping provider, tuning retries,
 * changing the logger, or switching model families is a one-file change here.
 *
 * See Phase 4 of `docs/SPREADSHEET_PARSING.backend.plan.md`.
 */

import { generateObject as defaultGenerateObject } from "ai";

import type {
  AxisNameRecommenderFn,
  ClassifierFn,
  ColumnClassification,
  InterpretDeps,
} from "@portalai/core/contracts";
import { LlmBridge } from "@portalai/core/contracts";

type ClassifierResponse = LlmBridge.ClassifierResponse;

import { AiService } from "./ai.service.js";
import { createLogger } from "../utils/logger.util.js";

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

export interface CreateInterpretDepsOptions {
  /**
   * Back-compat shortcut: sets both `classifierModel` and
   * `axisNameRecommenderModel`. Prefer the per-stage options when the two
   * stages should run on different models.
   */
  model?: string;
  /**
   * Anthropic model id for the header-to-column-definition classifier.
   * Defaults to Haiku 4.5 — the task is a narrow schema-constrained match
   * that doesn't need Sonnet, and per-call latency drops ~4× at Haiku.
   */
  classifierModel?: string;
  /**
   * Anthropic model id for the pivoted-region axis-name recommender.
   * Defaults to Haiku 4.5 for the same reason.
   */
  axisNameRecommenderModel?: string;
  /**
   * Test seam — lets tests inject a mocked `generateObject`.
   */
  generateObject?: GenerateObjectFn;
  /**
   * Scoped pino logger. When omitted, a fresh logger is created with
   * `module: "interpret-llm"`.
   */
  logger?: ReturnType<typeof createLogger>;
  /**
   * Forwarded to the returned `InterpretDeps` so the parser's
   * `classify-columns` stage sees the catalog. The parser never fetches it
   * itself — always injected.
   */
  columnDefinitionCatalog?: InterpretDeps["columnDefinitionCatalog"];
  defaultColumnDefinitionId?: InterpretDeps["defaultColumnDefinitionId"];
}

const DEFAULT_INTERPRET_MODEL = "claude-haiku-4-5-20251001";

export class LlmResponseError extends Error {
  override readonly name = "LlmResponseError" as const;
  readonly stage: "classify" | "recommend-axis-name";

  constructor(
    stage: "classify" | "recommend-axis-name",
    message: string,
    options?: ErrorOptions
  ) {
    super(`[${stage}] ${message}`, options);
    this.stage = stage;
  }
}

/**
 * Build `InterpretDeps` that route the parser's `ClassifierFn` and
 * `AxisNameRecommenderFn` slots through Anthropic's `generateObject` behind
 * the prompts + schemas the parser's `LlmBridge` exposes. Pure factory — no
 * side effects at construction time; network calls happen only when the
 * parser invokes the returned functions.
 */
export function createInterpretDeps(
  opts: CreateInterpretDepsOptions = {}
): InterpretDeps {
  const anthropic = AiService.providers.anthropic;
  const classifierModelId =
    opts.classifierModel ?? opts.model ?? DEFAULT_INTERPRET_MODEL;
  const axisNameModelId =
    opts.axisNameRecommenderModel ?? opts.model ?? DEFAULT_INTERPRET_MODEL;
  const gen: GenerateObjectFn = opts.generateObject ?? defaultGenerateObject;
  const logger = opts.logger ?? createLogger({ module: "interpret-llm" });

  const classifier: ClassifierFn = async (candidates, catalog) => {
    const prompt = LlmBridge.buildClassifierPrompt({ candidates, catalog });
    const started = Date.now();
    const result = await gen({
      model: anthropic(classifierModelId),
      prompt,
      schema: LlmBridge.ClassifierResponseSchema,
    });

    const parsed = LlmBridge.ClassifierResponseSchema.safeParse(result.object);
    if (!parsed.success) {
      logger.warn(
        {
          event: "interpret.llm.error",
          stage: "classify",
          issues: parsed.error.issues,
          modelId: classifierModelId,
        },
        "classifier response failed schema validation"
      );
      throw new LlmResponseError(
        "classify",
        `model response failed ClassifierResponseSchema: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`
      );
    }

    const latencyMs = Date.now() - started;
    logger.info(
      {
        event: "interpret.llm.call",
        stage: "classify",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        modelId: classifierModelId,
        latencyMs,
      },
      "interpret classifier call completed"
    );

    // Return the rich `ClassifierResult` form so the parser's `interpret()`
    // can roll usage into `interpret.stage.completed` + `interpret.cost.summary`
    // (Phase 9 observability).
    return {
      classifications: mapClassifierResponse(parsed.data, candidates),
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        latencyMs,
        modelId: classifierModelId,
      },
    };
  };

  const axisNameRecommender: AxisNameRecommenderFn = async (axisLabels) => {
    if (axisLabels.length === 0) return null;

    const prompt = LlmBridge.buildAxisNameRecommenderPrompt({ axisLabels });
    const started = Date.now();
    const result = await gen({
      model: anthropic(axisNameModelId),
      prompt,
      schema: LlmBridge.AxisNameRecommenderResponseSchema,
    });

    const parsed = LlmBridge.AxisNameRecommenderResponseSchema.safeParse(
      result.object
    );
    if (!parsed.success) {
      logger.warn(
        {
          event: "interpret.llm.error",
          stage: "recommend-axis-name",
          issues: parsed.error.issues,
          modelId: axisNameModelId,
        },
        "axis-name recommender response failed schema validation"
      );
      throw new LlmResponseError(
        "recommend-axis-name",
        `model response failed AxisNameRecommenderResponseSchema: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`
      );
    }

    const latencyMs = Date.now() - started;
    logger.info(
      {
        event: "interpret.llm.call",
        stage: "recommend-axis-name",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        modelId: axisNameModelId,
        latencyMs,
      },
      "interpret axis-name recommender call completed"
    );

    return {
      suggestion: {
        ...parsed.data,
        confidence: clampConfidence(parsed.data.confidence),
      },
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        latencyMs,
        modelId: axisNameModelId,
      },
    };
  };

  return {
    classifier,
    axisNameRecommender,
    columnDefinitionCatalog: opts.columnDefinitionCatalog,
    defaultColumnDefinitionId: opts.defaultColumnDefinitionId,
    logger,
  };
}

function mapClassifierResponse(
  response: ClassifierResponse,
  candidates: Parameters<ClassifierFn>[0]
): ColumnClassification[] {
  const byHeader = new Map(candidates.map((c) => [c.sourceHeader, c]));
  return response.classifications.map((entry) => {
    const candidate = byHeader.get(entry.sourceHeader);
    return {
      sourceHeader: entry.sourceHeader,
      sourceCol: candidate?.sourceCol ?? 0,
      columnDefinitionId: entry.columnDefinitionId,
      confidence: clampConfidence(entry.confidence),
      rationale: entry.rationale,
    };
  });
}

// Anthropic's structured-output schema rejects min/max on numbers, so the
// schemas advertise `confidence: number` and the [0, 1] contract is enforced
// here. Out-of-range values from the model are pulled back into the band
// rather than thrown — a stray 1.05 shouldn't fail the whole interpret run.
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
