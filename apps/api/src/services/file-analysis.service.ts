/**
 * File Analysis Service — orchestrates AI-powered and heuristic-based
 * column/entity recommendations for CSV file uploads.
 *
 * Delegates prompt construction to `prompts/file-analysis.prompt.ts`,
 * heuristic inference to `heuristic-analyzer.util.ts`, and uses the
 * Vercel AI SDK for structured LLM output.
 */

import { generateText, Output } from "ai";

import type {
  FileParseResult,
  FileUploadRecommendationEntity,
} from "@portalai/core/models";
import { FileUploadRecommendationEntitySchema } from "@portalai/core/models";
import type {
  ColumnDefinitionCatalogEntry,
  LayoutPlan,
  RegionHint,
  WorkbookData,
} from "@portalai/core/contracts";
import { interpret } from "@portalai/spreadsheet-parsing";

import { AiService } from "./ai.service.js";
import { DbService } from "./db.service.js";
import {
  createInterpretDeps,
  type CreateInterpretDepsOptions,
} from "./spreadsheet-parsing-llm.service.js";
import {
  heuristicAnalyze,
  inferType,
} from "../utils/heuristic-analyzer.util.js";
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
  description: string | null;
  validationPattern: string | null;
  canonicalFormat: string | null;
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

async function aiAnalyze(
  input: AnalyzeFileInput
): Promise<FileUploadRecommendationEntity> {
  const prompt = buildFileAnalysisPrompt(input);

  const result = await generateText({
    model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
    output: Output.object({ schema: FileUploadRecommendationEntitySchema }),
    prompt,
    abortSignal: globalThis.AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  return result.output!;
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Maps inferred type to the seed column definition key to use as fallback.
 */
function typeFallbackKey(inferredType: string, sampleValues: string[]): string {
  switch (inferredType) {
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "number": {
      const nonEmpty = sampleValues.filter((v) => v.trim() !== "");
      const hasDecimals = nonEmpty.some((v) => v.includes("."));
      return hasDecimals ? "decimal" : "integer";
    }
    case "string":
    default:
      return "text";
  }
}

/**
 * Resolve existingColumnDefinitionId values from AI output.
 *
 * The LLM sometimes returns the column key or label instead of the UUID.
 * This function looks up the correct ID from the existing columns list,
 * and falls back to type-based matching when the reference is unresolvable.
 */
function resolveColumnDefinitionIds(
  recommendation: FileUploadRecommendationEntity,
  existingColumns: ExistingColumnDefinition[]
): FileUploadRecommendationEntity {
  const byId = new Map(existingColumns.map((c) => [c.id, c]));
  const byKey = new Map(existingColumns.map((c) => [c.key, c]));
  const byLabel = new Map(
    existingColumns.map((c) => [c.label.toLowerCase(), c])
  );

  return {
    ...recommendation,
    columns: recommendation.columns.map((col) => {
      const rawId = col.existingColumnDefinitionId;

      // Already a valid ID
      const existing = byId.get(rawId);
      if (existing) {
        return { ...col, existingColumnDefinitionKey: existing.key };
      }

      // LLM returned a key instead of UUID — resolve it
      const matchByKey = byKey.get(rawId);
      if (matchByKey) {
        logger.debug(
          { sourceField: col.sourceField, rawId, resolvedId: matchByKey.id },
          "Resolved column definition ID from key"
        );
        return {
          ...col,
          existingColumnDefinitionId: matchByKey.id,
          existingColumnDefinitionKey: matchByKey.key,
        };
      }

      // LLM returned a label instead of UUID — resolve it
      const matchByLabel = byLabel.get(rawId.toLowerCase());
      if (matchByLabel) {
        logger.debug(
          { sourceField: col.sourceField, rawId, resolvedId: matchByLabel.id },
          "Resolved column definition ID from label"
        );
        return {
          ...col,
          existingColumnDefinitionId: matchByLabel.id,
          existingColumnDefinitionKey: matchByLabel.key,
        };
      }

      // Unresolvable — attempt type-based fallback
      logger.warn(
        { sourceField: col.sourceField, rawId },
        "Could not resolve existingColumnDefinitionId — attempting type-based fallback"
      );
      const { type: inferredType } = inferType(col.sampleValues);
      const fallbackKey = typeFallbackKey(inferredType, col.sampleValues);
      const fallbackDef = byKey.get(fallbackKey);
      if (fallbackDef) {
        return {
          ...col,
          existingColumnDefinitionId: fallbackDef.id,
          existingColumnDefinitionKey: fallbackDef.key,
          confidence: 0.5,
        };
      }

      // Last resort — pick "text" if available
      const textDef = byKey.get("text");
      if (textDef) {
        return {
          ...col,
          existingColumnDefinitionId: textDef.id,
          existingColumnDefinitionKey: textDef.key,
          confidence: 0.5,
        };
      }

      // Absolute fallback: use the first existing column definition
      const firstDef = existingColumns[0];
      return {
        ...col,
        existingColumnDefinitionId: firstDef?.id ?? "",
        existingColumnDefinitionKey: firstDef?.key ?? "",
        confidence: 0,
      };
    }),
  };
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
  static async getRecommendations(
    input: AnalyzeFileInput
  ): Promise<FileUploadRecommendationEntity> {
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
            {
              fileName: input.parseResult.fileName,
              errors: parsed.error.issues,
              attempt,
            },
            "AI result failed Zod validation"
          );
          lastError = parsed.error;
          continue;
        }

        const resolved = resolveColumnDefinitionIds(
          parsed.data,
          input.existingColumns
        );

        logger.info(
          {
            fileName: input.parseResult.fileName,
            columnCount: resolved.columns.length,
          },
          "AI analysis completed"
        );
        return resolved;
      } catch (err) {
        lastError = err;
        const isTimeout =
          err instanceof Error &&
          (err.name === "AbortError" ||
            err.name === "TimeoutError" ||
            err.message.includes("abort") ||
            err.message.includes("timeout"));

        logger.warn(
          {
            fileName: input.parseResult.fileName,
            error: err instanceof Error ? err.message : String(err),
            isTimeout,
            attempt,
          },
          isTimeout ? "AI analysis timed out" : "AI analysis failed"
        );

        // On timeout, skip retry and go straight to fallback
        if (isTimeout) break;
      }
    }

    logger.info(
      {
        fileName: input.parseResult.fileName,
        error:
          lastError instanceof Error ? lastError.message : String(lastError),
      },
      "Falling back to heuristic analysis"
    );

    return heuristicAnalyze(input);
  }

  /**
   * Heuristic-only analysis. Exposed for testing and as a direct fallback.
   */
  static heuristicAnalyze(
    input: AnalyzeFileInput
  ): FileUploadRecommendationEntity {
    return heuristicAnalyze(input);
  }

  /**
   * Parser-driven interpretation (new plan-driven path).
   *
   * Thin adapter: loads the org's `ColumnDefinition` catalog, builds
   * `InterpretDeps` via `createInterpretDeps`, then calls the parser
   * module's `interpret()`. The parser itself never calls a model — the
   * factory wires an Anthropic-backed classifier + axis-name recommender
   * behind the DI slots the parser exposes.
   *
   * Legacy `getRecommendations` path is unaffected; both coexist until the
   * upload-deprecation plan retires the legacy flow.
   */
  static async analyze(
    workbook: WorkbookData,
    hints: RegionHint[],
    orgId: string,
    userId: string,
    depsOverrides?: Omit<CreateInterpretDepsOptions, "columnDefinitionCatalog">
  ): Promise<LayoutPlan> {
    const catalog = await FileAnalysisService.loadCatalog(orgId);
    const deps = createInterpretDeps({
      ...depsOverrides,
      columnDefinitionCatalog: catalog,
      logger:
        depsOverrides?.logger ??
        createLogger({ module: "interpret", orgId, userId }),
    });
    return interpret({ workbook, regionHints: hints }, deps);
  }

  /**
   * Load the org's `ColumnDefinition` catalog in the shape the parser's
   * classifier expects. Exposed separately so tests can override it via
   * module mocks without stubbing the whole `analyze` pipeline.
   */
  static async loadCatalog(
    orgId: string
  ): Promise<ColumnDefinitionCatalogEntry[]> {
    const rows =
      await DbService.repository.columnDefinitions.findByOrganizationId(orgId);
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      normalizedKey: row.key,
      description: row.description ?? undefined,
      type: row.type,
    }));
  }
}
