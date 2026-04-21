import type { ColumnBindingDraft } from "./region-editor.types";

/**
 * Apply a user edit to a live `ColumnBindingDraft`. When the patch swaps the
 * column definition, the previous definition's cached display fields
 * (`columnDefinitionType`, `columnDefinitionLabel`) and its type-dependent
 * overrides (`refEntityKey`, `refNormalizedKey`, `enumValues`) no longer
 * describe the new definition — carry them through and the binding editor
 * surfaces the wrong sub-fields (e.g. a reference picker for a text column)
 * and Apply would commit orphan reference values for a non-reference type.
 *
 * All other patches merge normally.
 */
export function applyBindingDraftPatch(
  draft: ColumnBindingDraft,
  patch: Partial<ColumnBindingDraft>
): ColumnBindingDraft {
  const columnDefChanged =
    "columnDefinitionId" in patch &&
    patch.columnDefinitionId !== draft.columnDefinitionId;
  if (!columnDefChanged) {
    return { ...draft, ...patch };
  }
  return {
    ...draft,
    columnDefinitionType: undefined,
    columnDefinitionLabel: undefined,
    refEntityKey: null,
    refNormalizedKey: null,
    enumValues: null,
    ...patch,
  };
}
