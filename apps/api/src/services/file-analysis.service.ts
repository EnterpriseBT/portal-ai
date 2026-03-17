/**
 * File Analysis Service — orchestrates AI-powered and heuristic-based
 * column/entity recommendations for CSV file uploads.
 *
 * Delegates prompt construction to `prompts/file-analysis.prompt.ts`,
 * heuristic inference to `heuristic-analyzer.util.ts`, and uses the
 * Vercel AI SDK for structured LLM output.
 */

import { generateObject } from "ai";

import type {
  FileParseResult,
  FileUploadRecommendationEntity,
} from "@portalai/core/models";
import { FileUploadRecommendationEntitySchema } from "@portalai/core/models";

import { AiService } from "./ai.service.js";
import { heuristicAnalyze } from "../utils/heuristic-analyzer.util.js";
import { buildFileAnalysisPrompt } from "../prompts/file-analysis.prompt.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "file-analysis" });

/** AI analysis timeout in milliseconds. */
const AI_TIMEOUT_MS = 30_000;

/** Maximum retries on Zod validation failure before heuristic fallback. */
const MAX_AI_RETRIES = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExistingColumnDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
}

export interface AnalyzeFileInput {
  /** Parse result for the current file. */
  parseResult: FileParseResult;
  /** Existing org-level column definitions to match against. */
  existingColumns: ExistingColumnDefinition[];
  /** Cumulative recommendations from prior files in this upload batch. */
  priorRecommendations: FileUploadRecommendationEntity[];
}

// ---------------------------------------------------------------------------
// AI analysis (private)
// ---------------------------------------------------------------------------

async function aiAnalyze(input: AnalyzeFileInput): Promise<FileUploadRecommendationEntity> {
  const prompt = buildFileAnalysisPrompt(input);

  const { object } = await generateObject({
    model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
    schema: FileUploadRecommendationEntitySchema,
    prompt,
    abortSignal: globalThis.AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  return object;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class FileAnalysisService {
  /**
   * Analyze a parsed CSV file and produce entity/column recommendations.
   *
   * Attempts AI analysis first. Falls back to heuristic on:
   * - AI timeout (30s)
   * - AI error
   * - Zod validation failure (after 1 retry)
   */
  static async analyzeFile(input: AnalyzeFileInput): Promise<FileUploadRecommendationEntity> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
      try {
        logger.info(
          { fileName: input.parseResult.fileName, attempt },
          "Attempting AI analysis"
        );

        const result = await aiAnalyze(input);

        // Validate the result against our schema
        const parsed = FileUploadRecommendationEntitySchema.safeParse(result);
        if (!parsed.success) {
          logger.warn(
            { fileName: input.parseResult.fileName, errors: parsed.error.issues, attempt },
            "AI result failed Zod validation"
          );
          lastError = parsed.error;
          continue;
        }

        logger.info(
          { fileName: input.parseResult.fileName, columnCount: parsed.data.columns.length },
          "AI analysis completed"
        );
        return parsed.data;
      } catch (err) {
        lastError = err;
        const isTimeout = err instanceof Error && (
          err.name === "AbortError" ||
          err.name === "TimeoutError" ||
          err.message.includes("abort") ||
          err.message.includes("timeout")
        );

        logger.warn(
          { fileName: input.parseResult.fileName, error: err instanceof Error ? err.message : String(err), isTimeout, attempt },
          isTimeout ? "AI analysis timed out" : "AI analysis failed"
        );

        // On timeout, skip retry and go straight to fallback
        if (isTimeout) break;
      }
    }

    logger.info(
      { fileName: input.parseResult.fileName, error: lastError instanceof Error ? lastError.message : String(lastError) },
      "Falling back to heuristic analysis"
    );

    return heuristicAnalyze(input);
  }

  /**
   * Heuristic-only analysis. Exposed for testing and as a direct fallback.
   */
  static heuristicAnalyze(input: AnalyzeFileInput): FileUploadRecommendationEntity {
    return heuristicAnalyze(input);
  }
}
