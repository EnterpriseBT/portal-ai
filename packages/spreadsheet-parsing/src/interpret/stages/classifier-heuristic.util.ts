import type {
  ClassifierCandidate,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
} from "../types.js";

const DEFAULT_FALLBACK_RATIONALE = "default-text-fallback";

/**
 * Normalise a label for name-equality matching. Lower-case, alphanumeric-only,
 * collapses runs of separators into single underscores and strips leading /
 * trailing underscores. Kept symmetric between the source header and the
 * catalog's `label` / `normalizedKey` so heuristic matches are order-agnostic.
 */
export function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Same as `normalise` but coerces the result into a valid `normalizedKey`
 * (`/^[a-z][a-z0-9_]*$/`). When the normalised form starts with a digit
 * (e.g. user-typed override `"2020"`) we prepend `f_` so the result begins
 * with a letter, matching the schema's `NORMALIZED_KEY_PATTERN`. Returns
 * `null` when the input has no alphanumeric content at all.
 */
export function toNormalizedKey(text: string): string | null {
  const base = normalise(text);
  if (!base) return null;
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

/**
 * Shared built-in classifier — used both by `classify-field-segments` (per
 * header-line position) and `classify-logical-fields` (per pivot axisName /
 * cellValueField.name). Returns a concrete classification so downstream
 * stages don't need to guard on `undefined`.
 */
export function heuristicMatch(
  candidate: ClassifierCandidate,
  catalog: ColumnDefinitionCatalogEntry[]
): ColumnClassification {
  const needle = normalise(candidate.sourceHeader);
  for (const entry of catalog) {
    const label = normalise(entry.label);
    const key = entry.normalizedKey ? normalise(entry.normalizedKey) : null;
    if (label === needle || key === needle) {
      return {
        sourceHeader: candidate.sourceHeader,
        sourceCol: candidate.sourceCol,
        columnDefinitionId: entry.id,
        confidence: 0.75,
        rationale: "heuristic-exact-or-normalized-match",
      };
    }
  }
  return {
    sourceHeader: candidate.sourceHeader,
    sourceCol: candidate.sourceCol,
    columnDefinitionId: null,
    confidence: 0,
    rationale: "heuristic-no-match",
  };
}

/**
 * Rewrite null `columnDefinitionId` entries to the fallback id so the review
 * step never shows an unbound field. Confidence drops to 0 and the rationale
 * is annotated with `default-text-fallback`, preserving any prior rationale
 * (e.g. `heuristic-no-match`) so traces stay informative. Pass-through when
 * no fallback is supplied — legacy callers see no behavior change.
 */
export function applyDefaultColumnDefinition(
  classifications: ColumnClassification[],
  fallbackId: string | undefined
): ColumnClassification[] {
  if (!fallbackId) return classifications;
  return classifications.map((c) => {
    if (c.columnDefinitionId !== null) return c;
    const rationale = c.rationale
      ? `${c.rationale}; ${DEFAULT_FALLBACK_RATIONALE}`
      : DEFAULT_FALLBACK_RATIONALE;
    return {
      ...c,
      columnDefinitionId: fallbackId,
      confidence: 0,
      rationale,
    };
  });
}
