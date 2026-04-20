import type {
  ClassifierCandidate,
  ColumnDefinitionCatalogEntry,
} from "../types.js";

/**
 * Maximum number of axis labels forwarded to the axis-name recommender.
 * Keeps the sub-call's prompt cost bounded regardless of how wide a pivoted
 * region is.
 */
export const MAX_AXIS_LABELS = 30;

/**
 * Default cap on the sampled region a consumer forwards to the classifier.
 * 200 rows × 30 cols keeps the prompt under a typical model context budget
 * for the classification pass. Consumers may override when composing their
 * own prompt — this is the parser module's recommendation, not a hard limit.
 */
export const MAX_SHEET_SAMPLE = { rows: 200, cols: 30 } as const;

/** Maximum sample values emitted per candidate column in the prompt body. */
const MAX_SAMPLES_PER_CANDIDATE = 8;

function formatCandidate(c: ClassifierCandidate): string {
  const samples = c.samples.slice(0, MAX_SAMPLES_PER_CANDIDATE);
  return [
    `- sourceHeader: ${JSON.stringify(c.sourceHeader)}`,
    `  sourceCol: ${c.sourceCol}`,
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

/**
 * Pure template. Builds the prompt the consumer sends to the LLM for column
 * classification. The parser module owns this string; consumers (api
 * services) call `generateObject(..., { prompt, schema: ClassifierResponseSchema })`.
 *
 * Deterministic: same input → same output. No randomness, no I/O.
 */
export function buildClassifierPrompt(args: {
  candidates: ClassifierCandidate[];
  catalog: ColumnDefinitionCatalogEntry[];
}): string {
  const { candidates, catalog } = args;
  const catalogSection =
    catalog.length === 0
      ? "(no catalog supplied — reply with columnDefinitionId: null for every candidate)"
      : catalog.map(formatCatalogEntry).join("\n");
  const candidatesSection = candidates.map(formatCandidate).join("\n");

  return [
    "You are matching spreadsheet source columns to a catalog of ColumnDefinitions.",
    "For each candidate, choose the single best ColumnDefinition id, or null if none fits.",
    "Emit confidence in [0, 1] and a short rationale.",
    "",
    "## Candidates",
    candidatesSection,
    "",
    "## Catalog",
    catalogSection,
    "",
    "Return JSON that validates `ClassifierResponseSchema`: { classifications: [{ sourceHeader, columnDefinitionId, confidence, rationale? }] }.",
  ].join("\n");
}

/**
 * Pure template for the narrow axis-name recommender sub-call. Caps the
 * input at `MAX_AXIS_LABELS` to keep the cost envelope small and independent
 * of how wide the pivoted region is.
 */
export function buildAxisNameRecommenderPrompt(args: {
  axisLabels: string[];
}): string {
  const labels = args.axisLabels.slice(0, MAX_AXIS_LABELS);
  return [
    "These are the labels on the records axis of a pivoted spreadsheet region:",
    "",
    JSON.stringify(labels),
    "",
    "Propose a short, user-facing name for the dimension these labels describe",
    "(e.g. 'Month' for Jan/Feb/Mar; 'Region' for North/South/East/West).",
    "Return JSON that validates `AxisNameRecommenderResponseSchema`: { name, confidence }.",
  ].join("\n");
}
