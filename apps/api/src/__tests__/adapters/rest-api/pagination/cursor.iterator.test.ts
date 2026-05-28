import { describe, it, expect } from "@jest/globals";
import type { PaginationCursor } from "@portalai/core/models";

import { ApiCode } from "../../../../constants/api-codes.constants.js";
import { cursorIterator } from "../../../../adapters/rest-api/pagination/cursor.iterator.js";
import type { FetchedPage } from "../../../../adapters/rest-api/pagination/types.js";

const CONFIG: PaginationCursor = {
  strategy: "cursor",
  cursorParam: "cursor",
  cursorPlacement: "query",
  cursorResponsePath: "meta.next",
};

function page(body: unknown): FetchedPage {
  return { body, headers: {}, status: 200, records: [] };
}

describe("cursorIterator", () => {
  it("yields cursor='' on page 1; lifts the cursor from cursorResponsePath; terminates on null", async () => {
    const iter = cursorIterator(CONFIG);
    const cursors: string[] = [];

    let r = await iter.next();
    while (!r.done) {
      cursors.push(r.value.cursor);
      if (cursors.length === 1) {
        r = await iter.next(page({ meta: { next: "c2" } }));
      } else if (cursors.length === 2) {
        r = await iter.next(page({ meta: { next: null } }));
      } else {
        throw new Error("should have terminated");
      }
    }

    expect(cursors).toEqual(["", "c2"]);
  });

  it("terminates when cursorResponsePath resolves to an empty string", async () => {
    const iter = cursorIterator(CONFIG);
    await iter.next();
    const r = await iter.next(page({ meta: { next: "" } }));
    expect(r.done).toBe(true);
  });

  it("terminates when cursorResponsePath resolves to undefined (explicit undefined value)", async () => {
    const iter = cursorIterator(CONFIG);
    await iter.next();
    const r = await iter.next(page({ meta: { next: undefined } }));
    expect(r.done).toBe(true);
  });

  it("throws REST_API_CURSOR_NOT_FOUND when the path is missing on page 1", async () => {
    const iter = cursorIterator(CONFIG);
    await iter.next();
    await expect(iter.next(page({ data: [] }))).rejects.toMatchObject({
      code: ApiCode.REST_API_CURSOR_NOT_FOUND,
      details: expect.objectContaining({
        cursorResponsePath: "meta.next",
      }),
    });
  });

  it("terminates (no error) when the path is missing on page ≥ 2", async () => {
    const iter = cursorIterator(CONFIG);

    await iter.next();
    // Page 1 produces the cursor.
    let r = await iter.next(page({ meta: { next: "c2" } }));
    expect(r.done).toBe(false);
    // Page 2 omits the cursor field entirely → terminate without error.
    r = await iter.next(page({ data: [] }));
    expect(r.done).toBe(true);
  });
});
