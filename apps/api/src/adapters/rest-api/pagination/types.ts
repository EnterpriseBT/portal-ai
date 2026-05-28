/**
 * Pagination iterator contract.
 *
 * Each strategy implements an async generator that yields a
 * `PageContext` per HTTP request the adapter should make. The adapter
 * fetches the page, walks `recordsPath`, and feeds the resulting
 * `FetchedPage` back via `.next(page)`. The iterator inspects the
 * response (its own per-strategy logic) and either yields the next
 * context or returns.
 *
 * `MAX_PAGES` is the safety cap that protects against misbehaving
 * upstreams that never terminate — every iterator throws
 * `REST_API_PAGINATION_EXCEEDED` past it.
 */

export const MAX_PAGES = 1000;

export interface PageContext {
  /** 1-based by default; can be customized via pageOffset's startPage. */
  pageNumber: number;
  /**
   * Cursor value to splice into the request (empty on the first page).
   * Only the cursor strategy populates it; other strategies leave it
   * empty for `{{cursor}}` substitution which renders to "".
   */
  cursor: string;
  isFirstPage: boolean;
  /**
   * Best-effort flag. The `none` iterator sets it true on its single
   * yield; other iterators leave it false because they can't know
   * before inspecting the response. Callers should treat the
   * generator's `done: true` as the canonical end-of-pagination
   * signal.
   */
  isLastPage: boolean;
  /**
   * When set, the caller uses this URL verbatim instead of building
   * one from baseUrl/path/queryParams. Used by `linkHeader` to follow
   * the upstream-supplied next-page URL.
   */
  overrideUrl?: string;
}

export interface FetchedPage {
  body: unknown;
  headers: Record<string, string>;
  status: number;
  /** Caller-pre-walked records array (`recordsPath` already applied). */
  records: unknown[];
}

export type PageIterator = AsyncGenerator<PageContext, void, FetchedPage>;
