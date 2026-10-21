import type {
  CuratedViewUpdateRequestBody,
  FilterExpression,
} from "@portalai/core/contracts";

/**
 * The update body for an edited curated view (#801). The label and the
 * description go only when they changed, so a view saved before the length
 * limits stays editable (an unchanged value isn't held to a limit it predates).
 * The filter (FilterGroup or, #644, SQL: one of them null) and the projected
 * field mappings are always sent, as before.
 */
export function curatedViewUpdateBody(
  view: { label: string; description: string | null },
  form: {
    label: string;
    description: string;
    filter: FilterExpression | null;
    /** #644: the SQL filter; exclusive with `filter`. */
    filterSql: string | null;
    fieldMappingIds: string[];
  }
): CuratedViewUpdateRequestBody {
  const label = form.label.trim();
  const description = form.description.trim();
  return {
    ...(label !== view.label ? { label } : {}),
    ...(description !== (view.description ?? "")
      ? { description: description || null }
      : {}),
    filter: form.filter,
    filterSql: form.filterSql,
    fieldMappingIds: form.fieldMappingIds,
  };
}
