import { FAVORITE_FILTER } from "../utils/favorite-filter.util";

describe("FAVORITE_FILTER (#1072)", () => {
  it("is a toolbar toggle on the favorite field, labelled Favorites", () => {
    expect(FAVORITE_FILTER).toMatchObject({
      type: "boolean",
      field: "favorite",
      label: "Favorites",
      placement: "toolbar",
    });
  });

  it("leads with the favorite star", () => {
    expect(FAVORITE_FILTER.icon).toBeTruthy();
  });
});
