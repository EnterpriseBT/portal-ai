import React from "react";

import type { ResolvedColumn } from "@portalai/core/contracts";

import {
  usePagination,
  type PaginationPersistedState,
} from "../components/PaginationToolbar.component";
import {
  createEmptyExpression,
  isFilterExpressionEmpty,
  stripInvalidColumns,
} from "./advanced-filter-builder.util";
import { useStorage } from "./storage.util";

/** What the hook reset after the server refused it. */
export type CuratedViewTableRecovery = "filter" | "sort";

const DEFAULT_SORT_BY = "created";
const DEFAULT_SORT_ORDER = "asc";

/**
 * #678: the curated view detail table's paging + filter state, set up like
 * the entity records page's (`EntityDetail.view.tsx`):
 *
 * - **Remembered per view** under `pagination:curated-view:<viewId>`,
 *   including the advanced filters.
 * - **The builder** is offered over `columns`, the caller's readable projected
 *   columns from the records response, once they are known.
 * - **Saved filters wait for the columns.** `usePagination` reads its initial
 *   value only once, and the columns arrive with the first records response.
 *   So the hook starts with no advanced filters, then applies the saved filter
 *   **stripped against the columns** once they're known (saving the cleaned
 *   copy). A stale condition is dropped on its own, instead of the server
 *   refusing the whole filter. Until then, anything else saved (search, sort)
 *   carries the saved filter through, so it isn't lost.
 * - **A refused filter or sort is reset** (`errorCode`) so it can't lock the
 *   page in an error. That covers a filter on a column that left the view while
 *   the page was open, and a saved sort on a column whose type became
 *   unsortable. `onRecovered` reports it so the page can say why. A refused
 *   filter counts only when one is applied: a view whose own stored filter
 *   fails to render shares the code, and there's nothing for the reader to
 *   clear.
 *
 * Offset paging (keyset for views is #649). Kept out of the view so it can be
 * tested without a route match.
 */
export function useCuratedViewTablePagination(
  viewId: string,
  columns: ResolvedColumn[],
  opts: {
    /** The records request's error code, if it failed. */
    errorCode?: string | null;
    onRecovered?: (what: CuratedViewTableRecovery) => void;
  } = {}
) {
  const { value: storedPagination, setValue: persistPagination } =
    useStorage<PaginationPersistedState>({
      key: `pagination:curated-view:${viewId}`,
      defaultValue: {
        search: "",
        filters: {},
        sortBy: DEFAULT_SORT_BY,
        sortOrder: DEFAULT_SORT_ORDER,
        limit: 10,
      },
    });

  // The saved filter, held back until the columns are known.
  const savedFilterRef = React.useRef(storedPagination.advancedFilters);
  const appliedRef = React.useRef(false);

  // Start without the saved filter (applied below, once it can be cleaned).
  const [initialValue] = React.useState<PaginationPersistedState>(() => ({
    ...storedPagination,
    advancedFilters: createEmptyExpression(),
  }));

  // While the saved filter is pending, keep it in whatever gets saved.
  const onPersist = React.useCallback(
    (state: PaginationPersistedState) =>
      persistPagination(
        appliedRef.current
          ? state
          : { ...state, advancedFilters: savedFilterRef.current }
      ),
    [persistPagination]
  );

  const pagination = usePagination({
    sortFields: [],
    defaultSortBy: DEFAULT_SORT_BY,
    defaultSortOrder: DEFAULT_SORT_ORDER,
    initialValue,
    onPersist,
    columnDefinitions: columns,
  });

  const { setAdvancedFilters } = pagination;
  React.useEffect(() => {
    if (appliedRef.current || columns.length === 0) return;
    appliedRef.current = true;
    const saved = savedFilterRef.current;
    if (!saved || isFilterExpressionEmpty(saved)) return;
    const [cleaned, removed] = stripInvalidColumns(
      saved,
      new Set(columns.map((c) => c.normalizedKey))
    );
    if (removed.length > 0) {
      console.warn(
        `[AdvancedFilters] Stripped filters for columns no longer in this view: ${removed.join(", ")}`
      );
    }
    // Applies and saves the cleaned filter (an empty one clears the saved copy).
    setAdvancedFilters(cleaned);
  }, [columns, setAdvancedFilters]);

  const { advancedFilters, clearAdvancedFilters, setSortBy, setSortOrder } =
    pagination;
  const { errorCode, onRecovered } = opts;
  React.useEffect(() => {
    if (
      errorCode === "CURATED_VIEW_INVALID_FILTER" &&
      !isFilterExpressionEmpty(advancedFilters)
    ) {
      clearAdvancedFilters();
      onRecovered?.("filter");
    } else if (errorCode === "CURATED_VIEW_INVALID_SORT") {
      setSortBy(DEFAULT_SORT_BY);
      setSortOrder(DEFAULT_SORT_ORDER);
      onRecovered?.("sort");
    }
    // Run once per error, not on every filter change while it's showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacting to a new error code only; the setters are stable and advancedFilters is read at that moment.
  }, [errorCode]);

  return pagination;
}
