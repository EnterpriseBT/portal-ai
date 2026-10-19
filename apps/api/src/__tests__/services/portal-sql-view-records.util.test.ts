/**
 * `readViewSortValue` (#649): the curated-view records table mints its keyset
 * cursor from the last row's sort value, as raw-SQL rows return it. A value
 * the cursor can't carry must yield no cursor at all (the client stays on
 * offset paging) rather than a `null` anchor, which would seek into the NULL
 * region and skip the rest of the walk.
 */

import { describe, it, expect } from "@jest/globals";

import { readViewSortValue } from "../../services/portal-sql-view-records.util.js";

describe("readViewSortValue (#649)", () => {
  it("passes a string through", () => {
    expect(readViewSortValue("Boston")).toEqual({ value: "Boston" });
  });

  it("passes a number through", () => {
    expect(readViewSortValue(42)).toEqual({ value: 42 });
  });

  it("serializes a Date as ISO", () => {
    const d = new Date("2026-10-17T12:00:00.000Z");
    expect(readViewSortValue(d)).toEqual({ value: "2026-10-17T12:00:00.000Z" });
  });

  it("keeps a real NULL as a null anchor", () => {
    expect(readViewSortValue(null)).toEqual({ value: null });
  });

  it("refuses a value it can't carry", () => {
    expect(readViewSortValue({ a: 1 })).toBeNull();
    expect(readViewSortValue(undefined)).toBeNull();
  });
});
