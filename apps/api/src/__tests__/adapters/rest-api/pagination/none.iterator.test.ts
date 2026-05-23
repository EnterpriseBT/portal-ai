import { describe, it, expect } from "@jest/globals";

import { noneIterator } from "../../../../adapters/rest-api/pagination/none.iterator.js";
import type {
  FetchedPage,
  PageContext,
} from "../../../../adapters/rest-api/pagination/types.js";

const EMPTY_PAGE: FetchedPage = {
  body: [],
  headers: {},
  status: 200,
  records: [],
};

describe("noneIterator", () => {
  it("yields exactly one page context with both flags true", async () => {
    const iter = noneIterator();
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value as PageContext).toEqual({
      pageNumber: 1,
      cursor: "",
      isFirstPage: true,
      isLastPage: true,
    });
  });

  it("returns done after the first .next(page)", async () => {
    const iter = noneIterator();
    await iter.next();
    const second = await iter.next(EMPTY_PAGE);
    expect(second.done).toBe(true);
  });
});
