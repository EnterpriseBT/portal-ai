/**
 * Normalise a spreadsheet source-field name (typically a header cell's text
 * or a synthetic column-index label like `col_3`) into the snake_case key
 * format that `FieldMapping.normalizedKey` enforces.
 *
 * Used as the **default** normalized key for a binding when the user hasn't
 * supplied an explicit override. The `normalizedKey` regex is
 * `^[a-z][a-z0-9_]*$` (see `strategies.schema.ts`); when normalisation
 * produces a string starting with a digit or empty, we prefix `f_` so the
 * result always parses.
 */
export function sourceFieldToNormalizedKey(source: string): string {
  const base = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "field";
  if (/^[a-z]/.test(base)) return base;
  return `f_${base}`;
}

/**
 * Derive the source field name a binding refers to, then normalise it — the
 * one-call convenience for frontend callers that only have the serialised
 * `ColumnBindingDraft.sourceLocator` string.
 */
export function sourceLocatorToNormalizedKey(sourceLocator: string): string {
  if (sourceLocator.startsWith("header:")) {
    return sourceFieldToNormalizedKey(sourceLocator.slice("header:".length));
  }
  if (sourceLocator.startsWith("col:")) {
    return sourceFieldToNormalizedKey(`col_${sourceLocator.slice("col:".length)}`);
  }
  return sourceFieldToNormalizedKey(sourceLocator);
}
