import { describe, it, expect } from "@jest/globals";
import type { PaginationConfig } from "@portalai/core/models";

import { resolveIterator } from "../../../../adapters/rest-api/pagination/index.js";
import type { FetchedPage } from "../../../../adapters/rest-api/pagination/types.js";

const EMPTY: FetchedPage = { body: [], headers: {}, status: 200, records: [] };

describe("resolveIterator", () => {
  it("dispatches `none` to noneIterator (single yield)", async () => {
    const iter = resolveIterator({ strategy: "none" });
    const first = await iter.next();
    expect(first.value!.isLastPage).toBe(true);
    const second = await iter.next(EMPTY);
    expect(second.done).toBe(true);
  });

  it("dispatches `pageOffset` to pageOffsetIterator (terminates on empty)", async () => {
    const cfg: PaginationConfig = {
      strategy: "pageOffset",
      style: "page",
      param: "page",
      pageSize: 50,
      startPage: 1,
      stopOnShortPage: true,
    };
    const iter = resolveIterator(cfg);
    await iter.next();
    const done = await iter.next(EMPTY);
    expect(done.done).toBe(true);
  });

  it("dispatches `cursor` to cursorIterator (yields cursor=''; terminates on null)", async () => {
    const cfg: PaginationConfig = {
      strategy: "cursor",
      cursorParam: "cursor",
      cursorPlacement: "query",
      cursorResponsePath: "next",
    };
    const iter = resolveIterator(cfg);
    const first = await iter.next();
    expect(first.value!.cursor).toBe("");
    const done = await iter.next({
      body: { next: null },
      headers: {},
      status: 200,
      records: [],
    });
    expect(done.done).toBe(true);
  });

  it("dispatches `linkHeader` to linkHeaderIterator", async () => {
    const iter = resolveIterator({ strategy: "linkHeader" });
    await iter.next();
    const done = await iter.next(EMPTY);
    expect(done.done).toBe(true);
  });
});
