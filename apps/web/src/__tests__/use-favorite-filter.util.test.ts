import {
  FAVORITE_FILTER,
  isFavoritesOnly,
} from "../utils/use-favorite-filter.util";

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

describe("isFavoritesOnly (#1072)", () => {
  it("is true when Favorites only is the one narrowing", () => {
    expect(isFavoritesOnly({ favorite: ["true"], tagIds: [] }, "")).toBe(true);
  });

  it("is false with Favorites only off", () => {
    expect(isFavoritesOnly({ favorite: [] }, "")).toBe(false);
    expect(isFavoritesOnly({}, "")).toBe(false);
  });

  it("is false with a search or another filter too", () => {
    expect(isFavoritesOnly({ favorite: ["true"] }, "sales")).toBe(false);
    expect(isFavoritesOnly({ favorite: ["true"], tagIds: ["t1"] }, "")).toBe(
      false
    );
  });
});
