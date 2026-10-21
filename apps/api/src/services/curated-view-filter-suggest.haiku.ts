/**
 * #644: the Haiku-4.5-backed suggester for advanced (SQL) curated-view row
 * filters. One call in, one call out, like the REST connector's JSONata
 * suggester (`adapters/rest-api/jsonata-suggest.haiku.ts`).
 *
 * The suggestion is never trusted: the caller puts it through the same
 * validator and dry-run as a hand-written filter.
 *
 * Egress: the prompt carries the entity's column keys and types, the
 * top-level key names of its JSON columns, and the author's own words. No
 * record value is sent (`docs/DEPLOYMENT_SECURITY_REVIEW.md`).
 *
 * Failure handling mirrors the JSONata suggester: every model exception is a
 * `FilterSqlSuggestError` with a `reason` for telemetry; the caller maps any
 * of them to `502 CURATED_VIEW_FILTER_SUGGEST_FAILED`.
 */
import { generateObject as defaultGenerateObject } from "ai";
import { z } from "zod";

import { AiService } from "./ai.service.js";
import { createLogger } from "../utils/logger.util.js";

export interface FilterSqlSuggesterColumn {
  /** The column key the filter references (`normalizedKey`). */
  key: string;
  /** The column definition type (`string`, `number`, `json`, `geometry`…). */
  type: string;
  /** For a JSON column: top-level key names seen in sampled rows. */
  jsonKeys?: string[];
}

export interface FilterSqlSuggesterInput {
  /** What rows the author wants, in their words. */
  prompt: string;
  columns: FilterSqlSuggesterColumn[];
  /** The filter being edited, if any. */
  currentSql?: string;
  /** A previous suggestion and why it was refused, for one revision. */
  previousAttempt?: { filterSql: string; error: string };
}

export interface FilterSqlSuggester {
  suggest(input: FilterSqlSuggesterInput): Promise<{ filterSql: string }>;
}

export type FilterSqlSuggestFailureReason =
  | "malformed-response"
  | "timeout"
  | "network-error";

export class FilterSqlSuggestError extends Error {
  constructor(
    readonly reason: FilterSqlSuggestFailureReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "FilterSqlSuggestError";
  }
}

/** The instructions and context sent to the model. Pure, for tests. */
export function buildFilterSqlSuggestPrompt(
  input: FilterSqlSuggesterInput
): string {
  const columns = input.columns
    .map((c) => {
      const keys = c.jsonKeys?.length
        ? ` (top-level keys: ${c.jsonKeys.join(", ")})`
        : "";
      return `- ${c.key}: ${c.type}${keys}`;
    })
    .join("\n");
  return [
    "Write a PostgreSQL boolean expression to use as a row filter (the body of a WHERE clause) for one table.",
    "",
    "Rules:",
    "- Output only the expression: no SELECT, no WHERE keyword, no semicolon, no comments.",
    "- Reference columns only by the keys listed below, unqualified. Double-quote a key that is a SQL keyword.",
    "- No subqueries, no other tables, no parameters, no aggregate or window functions.",
    "- JSON columns are jsonb: use ->, ->>, #>, #>>, @>, ? to read them.",
    "- Geometry columns are geometry(Geometry, 4326) in longitude/latitude. For a distance, prefer ST_DWithin(column, ST_SetSRID(ST_MakePoint(lng, lat), 4326), degrees), which can use the column's index; cast both sides to geography only when the distance must be in metres.",
    "- Compare dates and timestamps with ISO-8601 literals.",
    "",
    "Columns:",
    columns,
    "",
    ...(input.currentSql
      ? ["The current filter, to revise:", input.currentSql, ""]
      : []),
    ...(input.previousAttempt
      ? [
          "Your previous suggestion was refused:",
          input.previousAttempt.filterSql,
          `Reason: ${input.previousAttempt.error}`,
          "Correct it.",
          "",
        ]
      : []),
    "The rows wanted:",
    input.prompt,
  ].join("\n");
}

type GenerateObjectArgs = Parameters<typeof defaultGenerateObject>[0];
type GenerateObjectResult = {
  object: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
};
type GenerateObjectFn = (
  args: GenerateObjectArgs
) => Promise<GenerateObjectResult>;
type AnthropicProviderFn = (modelId: string) => unknown;

export interface CreateFilterSqlSuggesterOptions {
  /** Defaults to Haiku 4.5, as the JSONata suggester. */
  model?: string;
  /** Test seam. */
  generateObject?: GenerateObjectFn;
  /** Test seam. Defaults to `AiService.providers.anthropic`. */
  anthropic?: AnthropicProviderFn;
  logger?: ReturnType<typeof createLogger>;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const SuggesterResponseSchema = z.object({
  filterSql: z.string().min(1),
});

let _suggester: FilterSqlSuggester | null = null;

/** The process singleton, built on first use. */
export function getFilterSqlSuggester(): FilterSqlSuggester {
  if (!_suggester) _suggester = createDefaultFilterSqlSuggester();
  return _suggester;
}

/** Test-only: swap the singleton; `null` restores the default. */
export function __setFilterSqlSuggesterForTesting(
  impl: FilterSqlSuggester | null
): void {
  _suggester = impl;
}

export function createDefaultFilterSqlSuggester(
  opts: CreateFilterSqlSuggesterOptions = {}
): FilterSqlSuggester {
  const anthropic =
    opts.anthropic ??
    (AiService.providers.anthropic as unknown as AnthropicProviderFn);
  const modelId = opts.model ?? DEFAULT_MODEL;
  const gen: GenerateObjectFn = opts.generateObject ?? defaultGenerateObject;
  const logger =
    opts.logger ?? createLogger({ module: "curated-view-filter-suggester" });

  return {
    async suggest(input) {
      const started = Date.now();
      let result: GenerateObjectResult;
      try {
        result = await gen({
          model: anthropic(modelId) as never,
          prompt: buildFilterSqlSuggestPrompt(input),
          schema: SuggesterResponseSchema,
        } as GenerateObjectArgs);
      } catch (err) {
        const reason =
          (err as Error).name === "AbortError" ? "timeout" : "network-error";
        logger.warn(
          {
            event: "curated-view.filter-suggest.error",
            reason,
            modelId,
            cause: (err as Error).message,
          },
          "filter SQL suggester call failed"
        );
        throw new FilterSqlSuggestError(reason, (err as Error).message, {
          cause: err,
        });
      }
      const parsed = SuggesterResponseSchema.safeParse(result.object);
      if (!parsed.success) {
        logger.warn(
          {
            event: "curated-view.filter-suggest.error",
            reason: "malformed-response",
            modelId,
          },
          "filter SQL suggester response failed schema validation"
        );
        throw new FilterSqlSuggestError(
          "malformed-response",
          "model response had no filterSql"
        );
      }
      logger.info(
        {
          event: "curated-view.filter-suggest.call",
          modelId,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          latencyMs: Date.now() - started,
          revision: !!input.previousAttempt,
        },
        "filter SQL suggester call completed"
      );
      return { filterSql: parsed.data.filterSql.trim() };
    },
  };
}
