/**
 * Pagination strategy `cursor` — read the next cursor from a dotted
 * path on each response, substitute via `{{cursor}}` on the request.
 *
 * Termination policies:
 *   1. `cursorResponsePath` resolves to null / undefined / empty
 *      string → done.
 *   2. Missing path on page 1 → `REST_API_CURSOR_NOT_FOUND` (the
 *      config is wrong; fail loud).
 *   3. Missing path on page ≥ 2 → done (the upstream is signaling
 *      end-of-list by omitting the cursor field).
 *   4. `MAX_PAGES` exceeded → `REST_API_PAGINATION_EXCEEDED`.
 */
import type { PaginationCursor } from "@portalai/core/models";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
import { MAX_PAGES, type PageIterator } from "./types.js";

const PATH_MISSING = Symbol("path-missing");

/**
 * Soft-walk: returns the value at `path`, `null`, or `PATH_MISSING`
 * (when any segment doesn't exist on its parent). Distinguishing
 * "missing" from "null" lets the iterator treat the former as an
 * error on page 1 and the latter as the standard termination signal.
 */
function softWalk(body: unknown, path: string): unknown | typeof PATH_MISSING {
  if (path === "") return body;
  const segments = path.split(".");
  let current: unknown = body;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return PATH_MISSING;
    const next = (current as Record<string, unknown>)[seg];
    if (next === undefined && !(seg in (current as object)))
      return PATH_MISSING;
    current = next;
  }
  return current;
}

export async function* cursorIterator(config: PaginationCursor): PageIterator {
  let cursor = "";
  let pageNumber = 1;

  for (let count = 0; count < MAX_PAGES; count++) {
    const page = yield {
      pageNumber,
      cursor,
      isFirstPage: count === 0,
      isLastPage: false,
    };

    const value = softWalk(page.body, config.cursorResponsePath);

    if (value === PATH_MISSING) {
      if (count === 0) {
        throw new ApiError(
          502,
          ApiCode.REST_API_CURSOR_NOT_FOUND,
          `Cursor path "${config.cursorResponsePath}" not found in first-page response`,
          { strategy: "cursor", cursorResponsePath: config.cursorResponsePath }
        );
      }
      return;
    }
    if (value === null || value === undefined || value === "") return;

    cursor = String(value);
    pageNumber += 1;
  }

  throw new ApiError(
    502,
    ApiCode.REST_API_PAGINATION_EXCEEDED,
    `cursor pagination exceeded MAX_PAGES (${MAX_PAGES}); upstream may be misbehaving`,
    { strategy: "cursor", maxPages: MAX_PAGES }
  );
}
