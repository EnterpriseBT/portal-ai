/**
 * Pagination factory + barrel.
 *
 * `resolveIterator(config)` returns the per-strategy iterator for a
 * `PaginationConfig`. The adapter's per-endpoint loop is identical
 * across strategies — the iterator owns the strategy-specific math
 * (page counter, cursor extraction, Link header parsing).
 */
import {
  PaginationConfigSchema,
  type PaginationConfig,
} from "@portalai/core/models";
import { z } from "zod";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
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

/**
 * Reconstruct the structured `PaginationConfig` from the flattened
 * table shape (`pagination` text column + `pagination_config` jsonb).
 * Throws `REST_API_PAGINATION_INVALID` when the merged blob fails Zod
 * validation — typically the per-strategy config is missing a
 * required field.
 */
export function reconstructPagination(
  paginationStrategy: string,
  paginationConfig: Record<string, unknown> | null
): PaginationConfig {
  const parsed = PaginationConfigSchema.safeParse({
    strategy: paginationStrategy,
    ...(paginationConfig ?? {}),
  });
  if (!parsed.success) {
    throw new ApiError(
      400,
      ApiCode.REST_API_PAGINATION_INVALID,
      `Pagination config malformed for strategy "${paginationStrategy}"`,
      {
        strategy: paginationStrategy,
        issues: (parsed.error as z.ZodError).issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      }
    );
  }
  return parsed.data;
}
