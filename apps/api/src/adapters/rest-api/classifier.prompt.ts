/**
 * Pure prompt builder for the REST API connector's column classifier.
 *
 * Mirrors the spreadsheet pipeline's `buildClassifierPrompt`
 * (`packages/spreadsheet-parsing/src/interpret/llm/prompt.ts:53`)
 * but column-shaped: input is API record-key candidates carrying
 * their heuristic type + sample values, output asks the model for
 * `{ sourceField, columnDefinitionId, suggestedNormalizedKey,
 * suggestedSemanticType, confidence, rationale }` per candidate.
 *
 * Deterministic — same input always produces the same string. No
 * randomness, no I/O. Catalog entries are sorted by `normalizedKey`
 * for a stable order regardless of repository fetch order.
 */
import type {
  ApiClassifierCandidate,
  ColumnDefinitionCatalogEntry,
} from "./classifier.types.js";

/**
 * Per-value JSON length cap inside the rendered samples. Long string
 * values (URLs, opaque blobs, base64) blow up prompt tokens without
 * helping the classifier; truncate aggressively.
 */
const MAX_SAMPLE_VALUE_LENGTH = 80;
const MAX_SAMPLES_PER_CANDIDATE = 5;

function truncate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_SAMPLE_VALUE_LENGTH) return value;
  return value.slice(0, MAX_SAMPLE_VALUE_LENGTH) + "…";
}

function formatCandidate(c: ApiClassifierCandidate): string {
  const samples = c.samples.slice(0, MAX_SAMPLES_PER_CANDIDATE).map(truncate);
  return [
    `- sourceField: ${JSON.stringify(c.sourceField)}`,
    `  inferredType: ${JSON.stringify(c.inferredType)}`,
    `  samples: ${JSON.stringify(samples)}`,
  ].join("\n");
}

function formatCatalogEntry(e: ColumnDefinitionCatalogEntry): string {
  const parts = [
    `- id: ${JSON.stringify(e.id)}`,
    `  label: ${JSON.stringify(e.label)}`,
  ];
  if (e.normalizedKey)
    parts.push(`  normalizedKey: ${JSON.stringify(e.normalizedKey)}`);
  if (e.description)
    parts.push(`  description: ${JSON.stringify(e.description)}`);
  if (e.type) parts.push(`  type: ${JSON.stringify(e.type)}`);
  return parts.join("\n");
}

export function buildApiClassifierPrompt(args: {
  candidates: ApiClassifierCandidate[];
  catalog: ColumnDefinitionCatalogEntry[];
}): string {
  const { candidates, catalog } = args;

  const sortedCatalog = [...catalog].sort((a, b) => {
    const ak = a.normalizedKey ?? a.label;
    const bk = b.normalizedKey ?? b.label;
    return ak.localeCompare(bk);
  });

  const catalogSection =
    sortedCatalog.length === 0
      ? "(no catalog supplied — reply with columnDefinitionId: null for every candidate)"
      : sortedCatalog.map(formatCatalogEntry).join("\n");
  const candidatesSection = candidates.map(formatCandidate).join("\n");

  return [
    "You are matching REST API record fields to a catalog of ColumnDefinitions.",
    "For each candidate, choose the single best ColumnDefinition id, or null if none fits.",
    "Also propose a snake_case `suggestedNormalizedKey` and an optional refinement of the heuristic type",
    "to a more specific ColumnDataType (e.g. string → date when the samples look like ISO timestamps).",
    "Emit confidence in [0, 1] and a short rationale.",
    "",
    "## Candidates",
    candidatesSection,
    "",
    "## Catalog",
    catalogSection,
    "",
    "Return JSON: { classifications: [{ sourceField, columnDefinitionId, suggestedNormalizedKey, suggestedSemanticType, confidence, rationale }] }.",
    "Emit one classification per candidate. Use the candidate's `sourceField` verbatim so the caller can re-merge with the heuristic columns.",
  ].join("\n");
}
