/**
 * Pagination strategy `pageOffset` — emit `{{pageNumber}}` per page,
 * incrementing by 1 for page-style (`?page=1, 2, 3, …`) and by
 * `pageSize` for offset-style (`?resultOffset=0, 1000, 2000, …`).
 *
 * Termination policies:
 *   1. Records array is empty → done.
 *   2. `stopOnShortPage` is on and `records.length < pageSize` → done
 *      (saves the no-op last fetch).
 *   3. `MAX_PAGES` exceeded → `REST_API_PAGINATION_EXCEEDED`.
 *
 * The iterator doesn't touch the request itself — it just publishes
 * `pageNumber` (the caller substitutes it into headers / queryParams /
 * bodyTemplate via the templating util).
 */
import type { PaginationPageOffset } from "@portalai/core/models";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
import { MAX_PAGES, type PageIterator } from "./types.js";

export async function* pageOffsetIterator(
  config: PaginationPageOffset
): PageIterator {
  let pageNumber = config.startPage;
  // page-style → +1 per page; offset-style → +pageSize per page (the
  // URL parameter counts rows, not page numbers). See #81.
  const step = config.style === "offset" ? config.pageSize : 1;
  for (let count = 0; count < MAX_PAGES; count++) {
    const page = yield {
      pageNumber,
      cursor: "",
      isFirstPage: count === 0,
      isLastPage: false,
    };
    if (page.records.length === 0) return;
    if (config.stopOnShortPage && page.records.length < config.pageSize) return;
    pageNumber += step;
  }
  throw new ApiError(
    502,
    ApiCode.REST_API_PAGINATION_EXCEEDED,
    `pageOffset pagination exceeded MAX_PAGES (${MAX_PAGES}); upstream may be misbehaving`,
    { strategy: "pageOffset", maxPages: MAX_PAGES }
  );
}
