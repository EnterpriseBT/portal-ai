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

const ROOTS: Record<FavoriteTargetType, readonly unknown[]> = {
  station: queryKeys.stations.root,
  pin: queryKeys.portalResults.root,
  curated_view: queryKeys.curatedViews.root,
  connector_instance: queryKeys.connectorInstances.root,
};

describe("favoriteKeys (#1072)", () => {
  it.each(Object.keys(ROOTS) as FavoriteTargetType[])(
    "refreshes the %s root (its lists and detail)",
    (type) => {
      expect(favoriteKeys(type)).toEqual([ROOTS[type]]);
    }
  );
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
    expect(config.onPermissionDenied.invalidate(target)).toEqual([
      queryKeys.curatedViews.root,
    ]);
  });
});
