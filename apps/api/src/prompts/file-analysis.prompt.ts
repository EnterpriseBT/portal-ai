/**
 * Prompt builder for AI-powered file analysis.
 *
 * Constructs a structured prompt from parse results, existing column
 * definitions, and prior recommendations so that the LLM can produce
 * entity/column recommendations.
 */

import type { FileUploadRecommendationEntity } from "@portalai/core/models";

import type { AnalyzeFileInput } from "../services/file-analysis.service.js";

// ---------------------------------------------------------------------------

export function buildFileAnalysisPrompt(input: AnalyzeFileInput): string {
  const { parseResult, existingColumns, priorRecommendations } = input;

  let prompt = `You are a data schema analyst. Analyze the following CSV file and recommend a connector entity with column mappings.

## File: ${parseResult.fileName}
- Rows: ${parseResult.rowCount}
- Delimiter: "${parseResult.delimiter}"
- Encoding: ${parseResult.encoding}
- Headers: ${parseResult.headers.join(", ")}

## Column Statistics
${parseResult.columnStats.map((s) => `- **${s.name}**: ${s.totalCount} values, ${(s.nullRate * 100).toFixed(1)}% null, ${s.uniqueCount} unique${s.uniqueCapped ? " (capped)" : ""}, sample: [${s.sampleValues.slice(0, 5).join(", ")}]`).join("\n")}

## Sample Rows (first 5)
${parseResult.sampleRows.slice(0, 5).map((r) => r.join(" | ")).join("\n")}
`;

  if (existingColumns.length > 0) {
    prompt += `
## Existing Column Definitions (match these when appropriate)
${existingColumns.map((c) => `- id: "${c.id}", key: "${c.key}", label: "${c.label}", type: ${c.type}`).join("\n")}

When a CSV column clearly maps to an existing column definition, set action to "match_existing" and set existingColumnDefinitionId to the id value from the list above (e.g., "${existingColumns[0]?.id ?? "uuid-here"}"). Set confidence based on how strong the match is (1.0 for exact key/label match, 0.8-0.99 for semantic match).
`;
  }

  if (priorRecommendations.length > 0) {
    prompt += `
## Prior Recommendations (from earlier files in this batch)
${priorRecommendations.map((e: FileUploadRecommendationEntity) => `Entity "${e.entityKey}" from "${e.sourceFileName}": columns [${e.columns.map((c: FileUploadRecommendationEntity["columns"][number]) => c.key).join(", ")}]`).join("\n")}

If this file shares columns with prior files (e.g., both have "email"), use action "match_existing" referencing the same key from the prior recommendation.
`;
  }

  prompt += `
## Instructions
1. Recommend an entity key (snake_case) and human-readable label for this file's data
2. For each column, recommend: key (snake_case), label, data type, format (if applicable), whether it's a primary key candidate, whether it's required, and whether to match an existing column or create a new one
3. Set confidence scores: 1.0 for exact matches, 0.8-0.99 for strong semantic matches, 0.5-0.79 for moderate matches, below 0.5 for weak guesses
4. Identify primary key candidates (columns with 0% null rate and high uniqueness)
`;

  return prompt;
}
