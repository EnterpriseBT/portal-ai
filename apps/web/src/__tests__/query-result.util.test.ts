/**
 * #713: `freshData` is what a page should render from a query. React Query
 * keeps the last good `data` when a refetch fails, so a page that renders
 * `data` whenever it's present shows an object that has since gone (deleted,
 * or access revoked) under a page that's still open, Edit included. The
 * latest result wins, as in `DataResult`.
 */
import { freshData } from "../utils/query-result.util";

describe("freshData (#713)", () => {
  it("returns the data of a successful query", () => {
    expect(freshData({ data: { id: "cv-1" }, isError: false })).toEqual({
      id: "cv-1",
    });
  });

  it("returns nothing when the latest fetch failed, even with data cached", () => {
    expect(freshData({ data: { id: "cv-1" }, isError: true })).toBeUndefined();
  });

  it("returns nothing while there's no data yet", () => {
    expect(freshData({ data: undefined, isError: false })).toBeUndefined();
  });
});
