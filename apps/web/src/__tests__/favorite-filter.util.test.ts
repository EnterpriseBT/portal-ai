import { FAVORITE_FILTER } from "../utils/favorite-filter.util";

describe("FAVORITE_FILTER (#1072)", () => {
  it("is a toolbar toggle on the favorite field", () => {
    expect(FAVORITE_FILTER).toEqual({
      type: "boolean",
      field: "favorite",
      label: "Favorites only",
      placement: "toolbar",
    });
  });
});
