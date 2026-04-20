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

  let prompt = `You are a data schema analyst. Analyze the following file and recommend a connector entity with column mappings.

XLSX uploads use the convention \`<workbook>.xlsx[<SheetName>]\` in \`File:\` below — when you see this format, treat each sheet as its own entity and derive \`entityKey\` and \`entityLabel\` from the sheet name (not the workbook name). Plain CSVs have no bracketed suffix.

## File: ${parseResult.fileName}
- Rows: ${parseResult.rowCount}
- Delimiter: "${parseResult.delimiter}"
- Encoding: ${parseResult.encoding}
- Headers: ${parseResult.headers.join(", ")}

## Column Statistics
${parseResult.columnStats.map((s) => `- **${s.name}**: ${s.totalCount} values, ${(s.nullRate * 100).toFixed(1)}% null, ${s.uniqueCount} unique${s.uniqueCapped ? " (capped)" : ""}, sample: [${s.sampleValues.slice(0, 5).join(", ")}]`).join("\n")}

## Sample Rows (first 5)
${parseResult.sampleRows
  .slice(0, 5)
  .map((r) => r.join(" | "))
  .join("\n")}
`;

  if (existingColumns.length > 0) {
    prompt += `
## Existing Column Definitions (match these when appropriate)
${existingColumns.map((c) => `- id: "${c.id}", key: "${c.key}", label: "${c.label}", type: ${c.type}${c.description ? `, description: "${c.description}"` : ""}${c.validationPattern ? `, validationPattern: "${c.validationPattern}"` : ""}${c.canonicalFormat ? `, canonicalFormat: "${c.canonicalFormat}"` : ""}`).join("\n")}

**IMPORTANT**: You MUST match every CSV column to an existing column definition from the list above. Set existingColumnDefinitionId to the id value (e.g., "${existingColumns[0]?.id ?? "uuid-here"}").

**Matching strategy** — use semantic meaning AND data patterns to pick the best-fit definition. Consider the column name, its description, and the sample values together:

- **ID / identifier fields** (e.g. "account_id", "user_id", "id", "order_number"): Use \`string_id\` for alphanumeric IDs, \`number_id\` for purely numeric IDs, \`uuid\` for UUID-formatted values.
- **Contact fields** (e.g. "email", "contact_email"): Use \`email\`. For phone/mobile/fax: use \`phone\`. For website/url/link: use \`url\`.
- **Name fields** (e.g. "first_name", "company_name", "full_name"): Use \`name\`.
- **Descriptive text** (e.g. "description", "notes", "bio", "summary"): Use \`description\`. For generic text: use \`text\`.
- **Code / abbreviation fields** (e.g. "sku", "country_code", "isbn"): Use \`code\`.
- **Address fields** (e.g. "address", "street", "city", "zip"): Use \`address\`.
- **Status / state fields** (e.g. "status", "order_status"): Use \`status\`.
- **Category / tag fields** (e.g. "category", "tag", "label", "group"): Use \`tag\`.
- **Monetary fields** (e.g. "price", "amount", "total", "cost"): Use \`currency\`.
- **Percentage fields** (e.g. "rate", "percent", "discount_pct"): Use \`percentage\`.
- **Quantity / count fields** (e.g. "quantity", "count", "qty"): Use \`quantity\`.
- **Date / time fields**: Use \`date\` for dates, \`datetime\` for timestamps.
- **Boolean fields** (e.g. "is_active", "has_account"): Use \`boolean\`.
- **Enum-like fields** (small set of repeated values): Use \`enum\`.

The column definition key and the field mapping's normalizedKey are independent — a CSV header "Customer Email" can match definition key "email" while having normalizedKey "customer_email".

Set confidence: 1.0 for exact key/label match, 0.8-0.99 for strong semantic match (name + data clearly fit), 0.5-0.79 for weaker semantic match.
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
   - **existingColumnDefinitionId** (required): the ID of the best-matching existing column definition from the list above. Use the matching strategy described earlier — match by semantic meaning first (name + description), then by data type. Always prefer a specific definition (e.g. \`string_id\`, \`email\`, \`currency\`) over a generic one (e.g. \`text\`, \`decimal\`).
   - **normalizedKey**: the key to use in \`normalizedData\` for this entity-column pair (snake_case). This is source-specific and often differs from the column definition key — e.g. a CSV header "Customer Email" might use normalizedKey "customer_email" while matching an existing column definition with key "email".
   - **format**: per-source parse instructions that tell the system how to interpret raw values. Set based on the matched column definition type:
     - **boolean**: "trueLabel/falseLabel" describing how the source represents true/false (e.g. "yes/no", "1/0", "active/inactive", "true/false"). Infer from sample values.
     - **date**: the date format pattern (e.g. "YYYY-MM-DD", "MM/DD/YYYY", "DD.MM.YYYY"). Infer from sample values.
     - **datetime**: the datetime format pattern (e.g. "YYYY-MM-DD HH:mm:ss", "MM/DD/YYYY hh:mm a"). Infer from sample values.
     - **number**: parsing hint (e.g. "currency" for 2 decimals, "precision:N" for N decimals, "eu" for European format like 1.234,56).
     - **array** / **reference-array**: the delimiter character used to separate values (e.g. "|" for pipe-delimited, ";" for semicolons). Defaults to comma if omitted.
     - **string**, **enum**, **json**, **reference**: format is not used — set to null.
     This is a mapping-level attribute.
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
