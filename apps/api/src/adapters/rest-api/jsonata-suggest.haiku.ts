/**
 * Default Haiku-4.5-backed `JsonataSuggester` for the REST API
 * connector's transform-suggest route.
 *
 * Mirrors `classifier.haiku.ts` (the column classifier) but is a
 * single-shot dep: no batch loop, no `pLimit`, no per-batch fanout.
 * One call in, one call out. Truncation of the sample is the route's
 * job — the suggester accepts whatever sample its caller passes and
 * runs it through the prompt builder unchanged.
 *
 * Failure handling: every model exception becomes a
 * `JsonataSuggestError` carrying a `reason` discriminator
 * (`malformed-response` / `timeout` / `network-error`). The route
 * catches `JsonataSuggestError` regardless of reason and maps to
 * `ApiError(502, REST_API_TRANSFORM_SUGGEST_FAILED)`; the reason is
 * for telemetry, not branching.
 */
import { generateObject as defaultGenerateObject } from "ai";
import { z } from "zod";

import { AiService } from "../../services/ai.service.js";
import { createLogger } from "../../utils/logger.util.js";

import { buildJsonataSuggestPrompt } from "./jsonata-suggest.prompt.js";
import {
  JsonataSuggestError,
  type JsonataSuggester,
  type JsonataSuggesterInput,
  type JsonataSuggesterOutput,
} from "./jsonata-suggest.types.js";

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
  args: GenerateObjectArgs,
) => Promise<GenerateObjectResult>;

/**
 * The minimal shape we use from the Anthropic provider: a function
 * that takes a model id and returns an opaque model handle the `ai`
 * SDK consumes. Lifted to an option so tests can stub it.
 */
type AnthropicProviderFn = (modelId: string) => unknown;

export interface CreateJsonataSuggesterOptions {
  /**
   * Anthropic model id. Defaults to Haiku 4.5 — the task is a narrow,
   * schema-constrained text generation that doesn't need a larger
   * model. Mirrors the classifier's default.
   */
  model?: string;
  /** Test seam — lets unit tests inject a mocked `generateObject`. */
  generateObject?: GenerateObjectFn;
  /**
   * Test seam — lets unit tests inject a stub Anthropic provider so
   * the model-id wiring can be asserted without booting the real
   * provider. Defaults to `AiService.providers.anthropic`.
   */
  anthropic?: AnthropicProviderFn;
  /** Scoped pino logger. Defaults to module: "jsonata-suggester". */
  logger?: ReturnType<typeof createLogger>;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const SuggesterResponseSchema = z.object({
  expression: z.string().min(1),
});

/**
 * Process singleton consumed by the suggest-transform route. Built
 * lazily on first read so module load doesn't touch the Anthropic
 * provider in tests that never invoke the route.
 *
 * Mutable so tests can swap in a stub via
 * `__setJsonataSuggesterForTesting`. Mirrors the `probeCache` /
 * `columnClassifier` deps on `rest-api.adapter.ts`.
 */
let _suggester: JsonataSuggester | null = null;

export function getJsonataSuggester(): JsonataSuggester {
  if (!_suggester) _suggester = createDefaultJsonataSuggester();
  return _suggester;
}

/** Test-only — swap or clear the process-singleton suggester. Pass
 *  `null` to drop the override and let the next read build a fresh
 *  default. */
export function __setJsonataSuggesterForTesting(
  impl: JsonataSuggester | null,
): void {
  _suggester = impl;
}

export function createDefaultJsonataSuggester(
  opts: CreateJsonataSuggesterOptions = {},
): JsonataSuggester {
  const anthropic =
    opts.anthropic ??
    (AiService.providers.anthropic as unknown as AnthropicProviderFn);
  const modelId = opts.model ?? DEFAULT_MODEL;
  const gen: GenerateObjectFn = opts.generateObject ?? defaultGenerateObject;
  const logger =
    opts.logger ?? createLogger({ module: "jsonata-suggester" });

  return {
    async suggest(
      input: JsonataSuggesterInput,
    ): Promise<JsonataSuggesterOutput> {
      const prompt = buildJsonataSuggestPrompt(input);
      const started = Date.now();

      let result: GenerateObjectResult;
      try {
        result = await gen({
          model: anthropic(modelId) as never,
          prompt,
          schema: SuggesterResponseSchema,
        } as GenerateObjectArgs);
      } catch (err) {
        const reason =
          (err as Error).name === "AbortError" ? "timeout" : "network-error";
        logger.warn(
          {
            event: "rest-api.transform-suggest.error",
            reason,
            modelId,
            cause: (err as Error).message,
          },
          "jsonata suggester call failed",
        );
        throw new JsonataSuggestError(reason, (err as Error).message, {
          cause: err,
        });
      }

      const parsed = SuggesterResponseSchema.safeParse(result.object);
      if (!parsed.success) {
        logger.warn(
          {
            event: "rest-api.transform-suggest.error",
            reason: "malformed-response",
            modelId,
            issues: parsed.error.issues,
          },
          "jsonata suggester response failed schema validation",
        );
        throw new JsonataSuggestError(
          "malformed-response",
          `model response failed SuggesterResponseSchema: ${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}`,
        );
      }

      const latencyMs = Date.now() - started;
      logger.info(
        {
          event: "rest-api.transform-suggest.call",
          modelId,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          latencyMs,
          hadHint: !!input.promptHint,
          hadPreviousAttempt: !!input.previousAttempt,
        },
        "jsonata suggester call completed",
      );

      return { expression: parsed.data.expression };
    },
  };
}
