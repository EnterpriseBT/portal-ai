import { describe, it, expect } from "@jest/globals";

import {
  linkHeaderIterator,
  parseLinkHeader,
} from "../../../../adapters/rest-api/pagination/link-header.iterator.js";
import type { FetchedPage } from "../../../../adapters/rest-api/pagination/types.js";

function page(headers: Record<string, string>): FetchedPage {
  return { body: [], headers, status: 200, records: [] };
}

describe("parseLinkHeader", () => {
  it("parses a single rel=next entry", () => {
    expect(parseLinkHeader('<https://x.test/?page=2>; rel="next"')).toEqual([
      { url: "https://x.test/?page=2", rel: "next" },
    ]);
  });

  it("parses multiple comma-separated entries", () => {
    const parsed = parseLinkHeader(
      '<https://x.test/?page=2>; rel="next", <https://x.test/?page=10>; rel="last"'
    );
    expect(parsed).toEqual([
      { url: "https://x.test/?page=2", rel: "next" },
      { url: "https://x.test/?page=10", rel: "last" },
    ]);
  });

  it("does not split on commas inside URL brackets", () => {
    const parsed = parseLinkHeader(
      '<https://x.test/items?ids=1,2,3&p=2>; rel="next"'
    );
    expect(parsed).toEqual([
      { url: "https://x.test/items?ids=1,2,3&p=2", rel: "next" },
    ]);
  });

  it("ignores entries missing a URL or rel", () => {
    expect(parseLinkHeader("garbage; no-url-here")).toEqual([]);
  });
});

describe("linkHeaderIterator", () => {
  it("yields page 1 with no overrideUrl; page 2 with the rel=next URL", async () => {
    const iter = linkHeaderIterator();

    const yielded: Array<{ pageNumber: number; overrideUrl?: string }> = [];
    let r = await iter.next();
    while (!r.done) {
      yielded.push({
        pageNumber: r.value.pageNumber,
        overrideUrl: r.value.overrideUrl,
      });
      if (yielded.length === 1) {
        r = await iter.next(
          page({ link: '<https://x.test/items?page=2>; rel="next"' })
        );
      } else {
        // No link header on page 2 → terminate.
        r = await iter.next(page({}));
      }
    }

    expect(yielded).toEqual([
      { pageNumber: 1, overrideUrl: undefined },
      { pageNumber: 2, overrideUrl: "https://x.test/items?page=2" },
    ]);
  });

  it("terminates immediately when page 1 has no Link header", async () => {
    const iter = linkHeaderIterator();
    await iter.next();
    const r = await iter.next(page({}));
    expect(r.done).toBe(true);
  });

  it("terminates when the Link header has no rel=next entry", async () => {
    const iter = linkHeaderIterator();
    await iter.next();
    const r = await iter.next(
      page({ link: '<https://x.test/?page=99>; rel="last"' })
    );
    expect(r.done).toBe(true);
  });

  it("parses multi-link headers and picks the rel=next URL", async () => {
    const iter = linkHeaderIterator();
    await iter.next();
    const r = await iter.next(
      page({
        link:
          '<https://x.test/?page=2>; rel="next", ' +
          '<https://x.test/?page=99>; rel="last", ' +
          '<https://x.test/?page=1>; rel="first"',
      })
    );
    expect(r.done).toBe(false);
    expect(r.value!.overrideUrl).toBe("https://x.test/?page=2");
  });
});
