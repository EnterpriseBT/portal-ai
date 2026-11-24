import { jest } from "@jest/globals";

import type { FavoriteTargetType } from "@portalai/core/models";

type Config = {
  url: (t: { type: string; id: string }) => string;
  method: string;
  body: (t: unknown) => unknown;
  onPermissionDenied: {
    invalidate: (t: { type: FavoriteTargetType; id: string }) => unknown[];
  };
};

jest.unstable_mockModule("../utils/api.util", () => ({
  useAuthMutation: jest.fn((config: Config) => config),
}));

const { queryKeys } = await import("../api/keys");
const { favoriteKeys } = await import("../utils/favorite-invalidation.util");
const { favorites } = await import("../api/favorites.api");

describe("favoriteKeys (#1072)", () => {
  it("refreshes a station's lists and its detail read, prefix-matched", () => {
    expect(favoriteKeys({ type: "station", id: "s1" })).toEqual([
      ["stations", "list"],
      ["stations", "get", "s1"],
    ]);
  });

  it("never refreshes a pin's live data or a view's records", () => {
    const pin = favoriteKeys({ type: "pin", id: "p1" });
    expect(pin).toEqual([
      ["portalResults", "list"],
      queryKeys.portalResults.get("p1"),
    ]);
    expect(pin).not.toContainEqual(queryKeys.portalResults.data("p1"));
    expect(favoriteKeys({ type: "curated_view", id: "v1" })).toEqual([
      ["curatedViews", "list"],
      queryKeys.curatedViews.get("v1"),
    ]);
  });

  it("covers connectors the same way", () => {
    expect(favoriteKeys({ type: "connector_instance", id: "c1" })).toEqual([
      ["connectorInstances", "list"],
      queryKeys.connectorInstances.get("c1"),
    ]);
  });
});

describe("sdk.favorites (#1072)", () => {
  const target = { type: "curated_view" as const, id: "v 1" };

  it.each([
    ["set", "PUT"],
    ["unset", "DELETE"],
  ] as const)(
    "%s sends %s to the object's favorite URL, no body",
    (name, method) => {
      const config = favorites[name]() as unknown as Config;
      expect(config.method).toBe(method);
      expect(config.url(target)).toBe("/api/favorites/curated_view/v%201");
      expect(config.body(target)).toBeUndefined();
    }
  );

  it("refetches the object's type on a 403 or 404", () => {
    const config = favorites.unset() as unknown as Config;
    expect(config.onPermissionDenied.invalidate(target)).toEqual(
      favoriteKeys(target)
    );
  });
});
