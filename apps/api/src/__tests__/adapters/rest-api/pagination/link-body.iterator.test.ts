import { describe, it, expect } from "@jest/globals";
import type { PaginationLinkBody } from "@portalai/core/models";

import { ApiCode } from "../../../../constants/api-codes.constants.js";
import { linkBodyIterator } from "../../../../adapters/rest-api/pagination/link-body.iterator.js";
import type { FetchedPage } from "../../../../adapters/rest-api/pagination/types.js";

const CONFIG: PaginationLinkBody = {
  strategy: "linkBody",
  nextUrlPath: "links.next",
};

function page(body: unknown): FetchedPage {
  return { body, headers: {}, status: 200, records: [] };
}

describe("linkBodyIterator", () => {
  it("page 1 has no overrideUrl; lifts the next URL from nextUrlPath and uses it verbatim on page 2; terminates on null", async () => {
    const iter = linkBodyIterator(CONFIG);

    const first = await iter.next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error("page 1 missing");
    expect(first.value.overrideUrl).toBeUndefined();
    expect(first.value.pageNumber).toBe(1);

    const second = await iter.next(
      page({ links: { next: "https://api.example.com/page-2" } })
    );
    expect(second.done).toBe(false);
    if (second.done) throw new Error("page 2 missing");
    expect(second.value.overrideUrl).toBe("https://api.example.com/page-2");
    expect(second.value.pageNumber).toBe(2);

    const third = await iter.next(page({ links: { next: null } }));
    expect(third.done).toBe(true);
  });

  it("terminates when nextUrlPath resolves to an empty string", async () => {
    const iter = linkBodyIterator(CONFIG);
    await iter.next();
    const r = await iter.next(page({ links: { next: "" } }));
    expect(r.done).toBe(true);
  });

  it("terminates when nextUrlPath resolves to undefined", async () => {
    const iter = linkBodyIterator(CONFIG);
    await iter.next();
    const r = await iter.next(page({ links: { next: undefined } }));
    expect(r.done).toBe(true);
  });

  it("throws REST_API_NEXT_URL_NOT_FOUND when the path is missing on page 1", async () => {
    const iter = linkBodyIterator(CONFIG);
    await iter.next();
    await expect(iter.next(page({ data: [] }))).rejects.toMatchObject({
      code: ApiCode.REST_API_NEXT_URL_NOT_FOUND,
      details: expect.objectContaining({
        nextUrlPath: "links.next",
      }),
    });
  });

  it("terminates (no error) when the path is missing on page ≥ 2", async () => {
    const iter = linkBodyIterator(CONFIG);

    await iter.next();
    // Page 1 produces the next URL.
    let r = await iter.next(
      page({ links: { next: "https://api.example.com/page-2" } })
    );
    expect(r.done).toBe(false);
    // Page 2 omits `links.next` entirely → terminate without error.
    r = await iter.next(page({ data: [] }));
    expect(r.done).toBe(true);
  });

  it("throws REST_API_NEXT_URL_INVALID when the path resolves to a non-string value", async () => {
    const iter = linkBodyIterator(CONFIG);
    await iter.next();
    await expect(
      iter.next(page({ links: { next: { href: "https://x" } } }))
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_NEXT_URL_INVALID,
    });
  });
});
