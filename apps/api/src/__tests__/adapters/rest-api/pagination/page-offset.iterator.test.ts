import { describe, it, expect } from "@jest/globals";
import type { PaginationPageOffset } from "@portalai/core/models";

import { ApiCode } from "../../../../constants/api-codes.constants.js";
import { pageOffsetIterator } from "../../../../adapters/rest-api/pagination/page-offset.iterator.js";
import {
  MAX_PAGES,
  type FetchedPage,
} from "../../../../adapters/rest-api/pagination/types.js";

/**
 * Page-style fixture: forgiving defaults, every field optional in
 * the schema (param has no default but the test always supplies one).
 */
function fixtureConfig(
  overrides: Partial<
    Extract<PaginationPageOffset, { style: "page" }>
  > = {}
): PaginationPageOffset {
  return {
    strategy: "pageOffset",
    style: "page",
    param: "page",
    pageSize: 50,
    startPage: 1,
    stopOnShortPage: true,
    ...overrides,
  };
}

/**
 * Offset-style fixture: every field required per schema, so callers
 * must spell out the offset/size param names + pageSize. Defaults
 * here match a typical ArcGIS-style endpoint.
 */
function offsetFixtureConfig(
  overrides: Partial<
    Extract<PaginationPageOffset, { style: "offset" }>
  > = {}
): PaginationPageOffset {
  return {
    strategy: "pageOffset",
    style: "offset",
    param: "resultOffset",
    pageSize: 1000,
    pageSizeParam: "resultRecordCount",
    startPage: 0,
    stopOnShortPage: true,
    ...overrides,
  };
}

function page(records: unknown[]): FetchedPage {
  return { body: records, headers: {}, status: 200, records };
}

describe("pageOffsetIterator", () => {
  it("yields pageNumber=1, 2, 3 and terminates on an empty array", async () => {
    const iter = pageOffsetIterator(
      fixtureConfig({ stopOnShortPage: false, pageSize: 2 })
    );
    const yielded: number[] = [];

    let r = await iter.next();
    while (!r.done) {
      yielded.push(r.value.pageNumber);
      if (yielded.length === 1) r = await iter.next(page([{ id: "a" }, { id: "b" }]));
      else if (yielded.length === 2) r = await iter.next(page([{ id: "c" }, { id: "d" }]));
      else r = await iter.next(page([])); // empty terminates
    }

    expect(yielded).toEqual([1, 2, 3]);
  });

  it("terminates early on a short page when stopOnShortPage is true", async () => {
    const iter = pageOffsetIterator(
      fixtureConfig({ stopOnShortPage: true, pageSize: 50 })
    );
    const yielded: number[] = [];
    let r = await iter.next();
    while (!r.done) {
      yielded.push(r.value.pageNumber);
      // 30 < pageSize → terminate after page 1
      r = await iter.next(page(new Array(30).fill({})));
    }
    expect(yielded).toEqual([1]);
  });

  it("continues past a short page when stopOnShortPage is false", async () => {
    const iter = pageOffsetIterator(
      fixtureConfig({ stopOnShortPage: false, pageSize: 50 })
    );
    const yielded: number[] = [];
    let r = await iter.next();
    while (!r.done) {
      yielded.push(r.value.pageNumber);
      if (yielded.length === 1) r = await iter.next(page(new Array(30).fill({})));
      else r = await iter.next(page([]));
    }
    expect(yielded).toEqual([1, 2]);
  });

  it("honors startPage (e.g. 0-indexed)", async () => {
    const iter = pageOffsetIterator(fixtureConfig({ startPage: 0 }));
    const first = await iter.next();
    expect(first.value!.pageNumber).toBe(0);
  });

  it("isFirstPage is true on the first yield only", async () => {
    const iter = pageOffsetIterator(
      fixtureConfig({ stopOnShortPage: false, pageSize: 2 })
    );
    const flags: boolean[] = [];
    let r = await iter.next();
    while (!r.done) {
      flags.push(r.value.isFirstPage);
      if (flags.length === 1) r = await iter.next(page([{}, {}]));
      else r = await iter.next(page([]));
    }
    expect(flags).toEqual([true, false]);
  });

  it("throws REST_API_PAGINATION_EXCEEDED past MAX_PAGES", async () => {
    const iter = pageOffsetIterator(
      fixtureConfig({ stopOnShortPage: false, pageSize: 1 })
    );

    // Always return a full page → never terminate naturally.
    let r = await iter.next();
    let pages = 0;
    try {
      while (!r.done) {
        pages++;
        r = await iter.next(page([{ id: pages }]));
      }
      // Should never get here.
      throw new Error("iterator returned without throwing");
    } catch (err) {
      expect(err).toMatchObject({
        code: ApiCode.REST_API_PAGINATION_EXCEEDED,
      });
      expect(pages).toBe(MAX_PAGES);
    }
  });
});
