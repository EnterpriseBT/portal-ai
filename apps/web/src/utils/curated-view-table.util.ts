import React from "react";

import type { ResolvedColumn } from "@portalai/core/contracts";

import {
  usePagination,
  type PaginationPersistedState,
} from "../components/PaginationToolbar.component";
import {
  isFilterExpressionEmpty,
  stripInvalidColumns,
} from "./advanced-filter-builder.util";
import { useStorage } from "./storage.util";

/**
 * #678: the curated view detail table's paging + filter state, set up like
 * the entity records page's (`EntityDetail.view.tsx`):
 *
 * - remembered per view under `pagination:curated-view:<viewId>`, including
 *   the advanced filters;
 * - the advanced filter builder is offered over `columns`, the caller's
 *   readable projected columns from the records response, and only once they
 *   are known;
 * - a persisted filter that references a column the view no longer gives the
 *   caller is stripped on load (and the cleaned state saved), so a stale
 *   filter never reaches the server, which would refuse it anyway.
 *
 * Offset paging (keyset for views is #649). Kept out of the view so it can be
 * tested without a route match.
 */
export function useCuratedViewTablePagination(
  viewId: string,
  columns: ResolvedColumn[],
  opts: {
    /**
     * The records request was refused with CURATED_VIEW_INVALID_FILTER. The
     * columns arrive with the records response, so a stale saved filter is
     * sent before they're known; without this, a filter on a column that left
     * the view would 400 every request and the page could never load its
     * columns to strip it.
     */
    invalidFilter?: boolean;
  } = {}
) {
  const { value: storedPagination, setValue: persistPagination } =
    useStorage<PaginationPersistedState>({
      key: `pagination:curated-view:${viewId}`,
      defaultValue: {
        search: "",
        filters: {},
        sortBy: "created",
        sortOrder: "asc",
        limit: 10,
      },
    });

  const cleanedInitialValue = React.useMemo(() => {
    if (
      !storedPagination.advancedFilters ||
      isFilterExpressionEmpty(storedPagination.advancedFilters) ||
      columns.length === 0
    ) {
      return storedPagination;
    }
    const validKeys = new Set(columns.map((c) => c.normalizedKey));
    const [cleaned, removed] = stripInvalidColumns(
      storedPagination.advancedFilters,
      validKeys
    );
    if (removed.length > 0) {
      console.warn(
        `[AdvancedFilters] Stripped filters for columns no longer in this view: ${removed.join(", ")}`
      );
      persistPagination({ ...storedPagination, advancedFilters: cleaned });
    }
    return { ...storedPagination, advancedFilters: cleaned };
  }, [storedPagination, columns, persistPagination]);

  const pagination = usePagination({
    sortFields: [],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    initialValue: cleanedInitialValue,
    onPersist: persistPagination,
    columnDefinitions: columns,
  });

  // The server refused the filter: clear it (and its saved copy), so the next
  // request runs unfiltered and the view's columns load.
  const { advancedFilters, clearAdvancedFilters } = pagination;
  React.useEffect(() => {
    if (opts.invalidFilter && !isFilterExpressionEmpty(advancedFilters)) {
      clearAdvancedFilters();
    }
  }, [opts.invalidFilter, advancedFilters, clearAdvancedFilters]);

  return pagination;
}
