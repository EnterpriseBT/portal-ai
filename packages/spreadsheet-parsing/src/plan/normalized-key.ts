import type { ColumnBinding } from "./strategies.schema.js";

/**
 * Derive the human-readable "source field" string for a binding — the header
 * cell's text for `byHeaderName`, a synthetic `<axis>_<index>` for
 * `byPositionIndex`. Used everywhere a binding's value needs a stable,
 * binding-unique key (extract-records' `record.fields`,
 * `FieldMapping.sourceField`, the commit pipeline's `recordFieldKey`). Two
 * bindings on the same region can share a `columnDefinitionId` (the AI may
 * map two source columns to the same target type), but their source fields
 * are unique because `byHeaderName` keys are deduped by the header layout
 * resolver and `byPositionIndex` indices are unique per axis — so this
 * function gives the per-binding identity that `columnDefinitionId` cannot.
 */
export function sourceFieldFromBinding(binding: ColumnBinding): string {
  if (binding.sourceLocator.kind === "byHeaderName") {
    return binding.sourceLocator.name;
  }
  return `${binding.sourceLocator.axis}_${binding.sourceLocator.index}`;
}

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

const AXIS_SEGMENTS = new Set(["row", "column"]);

/**
 * Derive the source field name a binding refers to, then normalise it — the
 * one-call convenience for frontend callers that only have the serialised
 * `ColumnBindingDraft.sourceLocator` string.
 *
 * Recognises the current frontend serialisation forms emitted by
 * `serializeLocator` in `apps/web/src/workflows/.../layout-plan-mapping.util.ts`:
 *   - `header:<axis>:<name>`        — `byHeaderName` locator (current)
 *   - `pos:<axis>:<index>`          — `byPositionIndex` locator (current)
 * plus the legacy `header:<name>` / `col:<index>` shapes a few callers and
 * tests still use. The axis word is stripped so the derived key reflects
 * the source column's own name (`Email` → `email`), not its axis (`row`
 * → `row_email`).
 */
export function sourceLocatorToNormalizedKey(sourceLocator: string): string {
  if (sourceLocator.startsWith("header:")) {
    const rest = sourceLocator.slice("header:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx >= 0 && AXIS_SEGMENTS.has(rest.slice(0, colonIdx))) {
      return sourceFieldToNormalizedKey(rest.slice(colonIdx + 1));
    }
    return sourceFieldToNormalizedKey(rest);
  }
  if (sourceLocator.startsWith("pos:")) {
    const rest = sourceLocator.slice("pos:".length);
    const colonIdx = rest.indexOf(":");
    const idx =
      colonIdx >= 0 && AXIS_SEGMENTS.has(rest.slice(0, colonIdx))
        ? rest.slice(colonIdx + 1)
        : rest;
    return sourceFieldToNormalizedKey(`col_${idx}`);
  }
  if (sourceLocator.startsWith("col:")) {
    return sourceFieldToNormalizedKey(`col_${sourceLocator.slice("col:".length)}`);
  }
  return sourceFieldToNormalizedKey(sourceLocator);
}
