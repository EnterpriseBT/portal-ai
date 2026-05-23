/**
 * Pagination strategy `linkHeader` — follow the upstream-supplied
 * `rel="next"` URL from the response `Link` header (RFC 5988).
 *
 * The next URL replaces the caller's URL building entirely
 * (`PageContext.overrideUrl`), so query-param templating doesn't apply
 * on follow-up fetches — the upstream chose the params already.
 *
 * Termination policies:
 *   1. Response has no `Link` header → done (the upstream returned a
 *      single page).
 *   2. `Link` header has no `rel="next"` member → done.
 *   3. `MAX_PAGES` exceeded → `REST_API_PAGINATION_EXCEEDED`.
 */
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
import { MAX_PAGES, type PageContext, type PageIterator } from "./types.js";

interface LinkEntry {
  url: string;
  rel: string;
}

/**
 * Parse an RFC 5988 `Link` header value into its entries. Splits on
 * commas not inside angle brackets, then extracts the URL + rel
 * parameter from each segment.
 */
export function parseLinkHeader(value: string): LinkEntry[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      segments.push(value.slice(start, i));
      start = i + 1;
    }
  }
  if (start <= value.length) segments.push(value.slice(start));

  const entries: LinkEntry[] = [];
  for (const seg of segments) {
    const urlMatch = seg.match(/<([^>]*)>/);
    const relMatch = seg.match(/rel\s*=\s*"?([^";\s]+)"?/);
    const url = urlMatch?.[1];
    const rel = relMatch?.[1];
    if (url && rel) entries.push({ url, rel });
  }
  return entries;
}

export async function* linkHeaderIterator(): PageIterator {
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

    const linkHeader = page.headers.link;
    if (!linkHeader) return;
    const next = parseLinkHeader(linkHeader).find((e) => e.rel === "next");
    if (!next) return;
    overrideUrl = next.url;
    pageNumber += 1;
  }

  throw new ApiError(
    502,
    ApiCode.REST_API_PAGINATION_EXCEEDED,
    `linkHeader pagination exceeded MAX_PAGES (${MAX_PAGES}); upstream may be misbehaving`,
    { strategy: "linkHeader", maxPages: MAX_PAGES }
  );
}
