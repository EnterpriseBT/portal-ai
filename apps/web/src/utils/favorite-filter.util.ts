import type { BooleanFilterConfig } from "../components/PaginationToolbar.component";

/**
 * #1072: the "Favorites only" toggle the station, pinned-result, view and
 * connector lists put in their toolbar. Pressed, the list asks for
 * `favorite=true`; unpressed, the filter is cleared. A list shows its
 * favorites explainer on an empty page when
 * `pagination.isOnlyFilter(FAVORITE_FILTER.field)`.
 */
export const FAVORITE_FILTER: BooleanFilterConfig = {
  type: "boolean",
  field: "favorite",
  label: "Favorites only",
  placement: "toolbar",
};
