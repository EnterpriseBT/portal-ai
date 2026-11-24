import { z } from "zod";

import {
  FavoriteListQueryFields,
  FavoriteParamsSchema,
  FavoriteResponsePayloadSchema,
  FavoriteRowFields,
} from "../../contracts/favorite.contract.js";

describe("FavoriteParamsSchema (#1072)", () => {
  it("accepts each favoritable type", () => {
    for (const type of [
      "station",
      "pin",
      "curated_view",
      "connector_instance",
    ]) {
      expect(FavoriteParamsSchema.safeParse({ type, id: "x-1" }).success).toBe(
        true
      );
    }
  });

  it("rejects an unknown type", () => {
    expect(
      FavoriteParamsSchema.safeParse({ type: "entity", id: "e-1" }).success
    ).toBe(false);
  });

  it("rejects an extra key", () => {
    expect(
      FavoriteParamsSchema.safeParse({ type: "station", id: "s-1", x: 1 })
        .success
    ).toBe(false);
  });
});

describe("FavoriteResponsePayloadSchema", () => {
  it("carries isFavorite", () => {
    expect(
      FavoriteResponsePayloadSchema.safeParse({ isFavorite: true }).success
    ).toBe(true);
    expect(FavoriteResponsePayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe("FavoriteListQueryFields", () => {
  const Query = z.object(FavoriteListQueryFields).strict();

  it('accepts favorite="true" or nothing', () => {
    expect(Query.safeParse({ favorite: "true" }).success).toBe(true);
    expect(Query.safeParse({}).success).toBe(true);
  });

  it('rejects favorite="false"', () => {
    expect(Query.safeParse({ favorite: "false" }).success).toBe(false);
  });
});

describe("FavoriteRowFields", () => {
  it("is an optional boolean", () => {
    const Row = z.object(FavoriteRowFields);
    expect(Row.safeParse({ isFavorite: false }).success).toBe(true);
    expect(Row.safeParse({}).success).toBe(true);
    expect(Row.safeParse({ isFavorite: "yes" }).success).toBe(false);
  });
});
