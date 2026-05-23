/**
 * Pagination factory + barrel.
 *
 * `resolveIterator(config)` returns the per-strategy iterator for a
 * `PaginationConfig`. The adapter's per-endpoint loop is identical
 * across strategies — the iterator owns the strategy-specific math
 * (page counter, cursor extraction, Link header parsing).
 */
import type { PaginationConfig } from "@portalai/core/models";

import { noneIterator } from "./none.iterator.js";
import { pageOffsetIterator } from "./page-offset.iterator.js";
import { cursorIterator } from "./cursor.iterator.js";
import { linkHeaderIterator } from "./link-header.iterator.js";
import { type PageIterator } from "./types.js";

export { MAX_PAGES, type PageContext, type FetchedPage, type PageIterator } from "./types.js";
export { noneIterator } from "./none.iterator.js";
export { pageOffsetIterator } from "./page-offset.iterator.js";
export { cursorIterator } from "./cursor.iterator.js";
export { linkHeaderIterator, parseLinkHeader } from "./link-header.iterator.js";

export function resolveIterator(config: PaginationConfig): PageIterator {
  switch (config.strategy) {
    case "none":
      return noneIterator();
    case "pageOffset":
      return pageOffsetIterator(config);
    case "cursor":
      return cursorIterator(config);
    case "linkHeader":
      return linkHeaderIterator();
  }
}
