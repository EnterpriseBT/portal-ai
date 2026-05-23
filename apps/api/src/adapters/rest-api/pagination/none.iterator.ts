/**
 * Pagination strategy `none` — exactly one page.
 *
 * Phase-1 behavior preserved as a strategy: yield once, await the
 * caller's fetched page, return. The caller's loop is identical
 * across strategies so this is the zero-config arm of the
 * discriminated union.
 */
import type { PageIterator } from "./types.js";

export async function* noneIterator(): PageIterator {
  yield { pageNumber: 1, cursor: "", isFirstPage: true, isLastPage: true };
}
