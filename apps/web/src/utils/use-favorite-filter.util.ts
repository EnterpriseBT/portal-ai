import type { BooleanFilterConfig } from "../components/PaginationToolbar.component";

/** The `favorite` filter field, as each favoritable list's query names it. */
export const FAVORITE_FILTER_FIELD = "favorite";

/**
 * #1072: the "Favorites only" toggle the station, pinned-result, view and
 * connector lists put in their toolbar. Pressed, the list asks for
 * `favorite=true`; unpressed, the filter is cleared.
 */
export const FAVORITE_FILTER: BooleanFilterConfig = {
  type: "boolean",
  field: FAVORITE_FILTER_FIELD,
  label: "Favorites only",
  placement: "toolbar",
};

/** The list's Favorites only filter. */
export function useFavoriteFilter(): BooleanFilterConfig {
  return FAVORITE_FILTER;
}

/**
 * Whether Favorites only is the list's one active narrowing: on, with no
 * search and no other filter set. Then an empty page means "nothing
 * starred" and shows the favorites explainer; with anything else on, it's
 * the generic "no results".
 */
export function isFavoritesOnly(
  filters: Record<string, string[]>,
  search: string
): boolean {
  if ((filters[FAVORITE_FILTER_FIELD] ?? [])[0] !== "true") return false;
  if (search.trim() !== "") return false;
  return Object.entries(filters).every(
    ([field, values]) => field === FAVORITE_FILTER_FIELD || values.length === 0
  );
}
