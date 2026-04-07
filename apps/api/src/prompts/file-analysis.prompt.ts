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
${existingColumns.map((c) => `- id: "${c.id}", key: "${c.key}", label: "${c.label}", type: ${c.type}${c.description ? `, description: "${c.description}"` : ""}${c.validationPattern ? `, validationPattern: "${c.validationPattern}"` : ""}${c.canonicalFormat ? `, canonicalFormat: "${c.canonicalFormat}"` : ""}`).join("\n")}

**IMPORTANT**: For every CSV column, you MUST first check whether any existing column definition above is a match before considering "create_new". The **type** is the most important signal — a CSV column with dates should match an existing \`date\` definition, a column with email addresses should match an existing \`string\` definition for emails, etc. Also match on key, label, or semantic meaning. Note that the column definition key and the field mapping's normalizedKey are independent — a CSV header "Customer Email" can match an existing column definition with key "email" while having normalizedKey "customer_email". Prefer "match_existing" whenever there is a reasonable match. Only use "create_new" when no existing definition fits the data's type and meaning. When matching, set existingColumnDefinitionId to the id value from the list above (e.g., "${existingColumns[0]?.id ?? "uuid-here"}"). Set confidence based on how strong the match is (1.0 for exact key/label match, 0.8-0.99 for semantic match, 0.5-0.79 for partial match).
`;
  }

  if (priorRecommendations.length > 0) {
    prompt += `
## Prior Recommendations (from earlier files in this batch)
${priorRecommendations.map((e: FileUploadRecommendationEntity) => `Entity "${e.entityKey}" from "${e.sourceFileName}": columns [${e.columns.map((c: FileUploadRecommendationEntity["columns"][number]) => c.sourceField).join(", ")}]`).join("\n")}

If this file shares columns with prior files (e.g., both have "email"), reuse the same existingColumnDefinitionId from the prior recommendation.
`;
  }

  prompt += `
## Instructions
1. Recommend an entity key (snake_case) and human-readable label for this file's data.
2. For each column, recommend:
   - **existingColumnDefinitionId** (required): the ID of the matched existing column definition. You MUST match every CSV column to an existing column definition from the list above. The type of the existing definition is the strongest signal — a CSV column with dates should match an existing \`date\` definition, email addresses should match an existing \`string\` definition for emails, etc. Also match on key, label, or semantic meaning. Do NOT use \`currency\` — use \`number\` instead. The column definition's validationPattern and canonicalFormat (e.g. "lowercase", "USD") are inherited from the matched definition.
   - **normalizedKey**: the key to use in \`normalizedData\` for this entity-column pair (snake_case). This is source-specific and often differs from the column definition key — e.g. a CSV header "Customer Email" might use normalizedKey "customer_email" while matching an existing column definition with key "email".
   - **format**: per-source parse instructions (e.g. "YYYY-MM-DD", "email"). This is a mapping-level attribute.
   - **required**: whether this column is required for this source. This is a mapping-level attribute.
   - **enumValues**: if the column has a small set of known values, list them here. This is a mapping-level attribute.
   - **defaultValue**: default fill value when the source value is missing. This is a mapping-level attribute (usually null).
   - **isPrimaryKey**: whether this is a primary key candidate
   - **confidence**: match confidence score
3. Set confidence scores: 1.0 for exact matches, 0.8-0.99 for strong semantic matches, 0.5-0.79 for moderate matches, below 0.5 for weak guesses.
4. Identify primary key candidates (columns with 0% null rate and high uniqueness).
`;

  return prompt;
}
