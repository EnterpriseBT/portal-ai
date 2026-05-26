/**
 * Pagination strategy `linkBody` — follow the upstream-supplied next
 * URL from a dotted path in the response body. Mirrors `linkHeader`
 * in mechanism (`overrideUrl` on the `PageContext`) but reads from
 * `page.body` instead of `page.headers.link`. The extracted value is
 * expected to be a complete URL; the next request is dispatched
 * against it verbatim — query templating + pagination param injection
 * are bypassed (the upstream chose the params already).
 *
 * Termination policies (parallel to the cursor iterator):
 *   1. `nextUrlPath` resolves to null / undefined / empty string → done.
 *   2. Missing path on page 1 → `REST_API_NEXT_URL_NOT_FOUND` (the
 *      config is wrong; fail loud).
 *   3. Missing path on page ≥ 2 → done (upstream signals end-of-list
 *      by omitting the field).
 *   4. Extracted value is not a string → `REST_API_NEXT_URL_INVALID`.
 *   5. `MAX_PAGES` exceeded → `REST_API_PAGINATION_EXCEEDED`.
 */
import type { PaginationLinkBody } from "@portalai/core/models";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
import { MAX_PAGES, type PageContext, type PageIterator } from "./types.js";

const PATH_MISSING = Symbol("path-missing");

/**
 * Soft-walk: returns the value at `path`, `null`, or `PATH_MISSING`
 * (when any segment doesn't exist on its parent). Same shape as the
 * cursor iterator's helper so the two paths terminate identically on
 * missing-vs-null. Kept inline here to avoid cross-iterator imports.
 */
function softWalk(body: unknown, path: string): unknown | typeof PATH_MISSING {
  if (path === "") return body;
  const segments = path.split(".");
  let current: unknown = body;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return PATH_MISSING;
    const next = (current as Record<string, unknown>)[seg];
    if (next === undefined && !(seg in (current as object))) return PATH_MISSING;
    current = next;
  }
  return current;
}

export async function* linkBodyIterator(
  config: PaginationLinkBody
): PageIterator {
  let pageNumber = 1;
  let overrideUrl: string | undefined = undefined;

  for (let count = 0; count < MAX_PAGES; count++) {
    const ctx: PageContext = {
      pageNumber,
      cursor: "",
      isFirstPage: count === 0,
      isLastPage: false,
      ...(overrideUrl !== undefined ? { overrideUrl } : {}),
    };
    const page = yield ctx;

    const value = softWalk(page.body, config.nextUrlPath);

    if (value === PATH_MISSING) {
      if (count === 0) {
        throw new ApiError(
          502,
          ApiCode.REST_API_NEXT_URL_NOT_FOUND,
          `Next-URL path "${config.nextUrlPath}" not found in first-page response`,
          { strategy: "linkBody", nextUrlPath: config.nextUrlPath }
        );
      }
      return;
    }
    if (value === null || value === undefined || value === "") return;
    if (typeof value !== "string") {
      throw new ApiError(
        502,
        ApiCode.REST_API_NEXT_URL_INVALID,
        `Next-URL path "${config.nextUrlPath}" resolved to ${typeof value}, expected string`,
        { strategy: "linkBody", nextUrlPath: config.nextUrlPath }
      );
    }

    overrideUrl = value;
    pageNumber += 1;
  }

  throw new ApiError(
    502,
    ApiCode.REST_API_PAGINATION_EXCEEDED,
    `linkBody pagination exceeded MAX_PAGES (${MAX_PAGES}); upstream may be misbehaving`,
    { strategy: "linkBody", maxPages: MAX_PAGES }
  );
}
