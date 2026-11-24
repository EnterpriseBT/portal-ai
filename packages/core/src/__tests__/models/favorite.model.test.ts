import {
  FAVORITE_TARGET_COLUMNS,
  FAVORITE_TARGET_TYPES,
  FavoriteModelFactory,
  FavoriteSchema,
  FavoriteTargetSchema,
} from "../../models/favorite.model.js";
import { TAG_TARGET_TYPES } from "../../models/tag-target.model.js";

const base = {
  id: "fav-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  userId: "user-1",
};

const noTargets = {
  stationId: null,
  portalResultId: null,
  curatedViewId: null,
  connectorInstanceId: null,
};

describe("FavoriteSchema (#1072)", () => {
  it.each(Object.values(FAVORITE_TARGET_COLUMNS))(
    "accepts a row whose only target is %s",
    (column) => {
      const result = FavoriteSchema.safeParse({
        ...base,
        ...noTargets,
        [column]: "target-1",
      });
      expect(result.success).toBe(true);
    }
  );

  it("rejects a row with no target", () => {
    expect(FavoriteSchema.safeParse({ ...base, ...noTargets }).success).toBe(
      false
    );
  });

  it("rejects a row with two targets", () => {
    const result = FavoriteSchema.safeParse({
      ...base,
      ...noTargets,
      stationId: "s-1",
      curatedViewId: "v-1",
    });
    expect(result.success).toBe(false);
  });

  it("requires the user", () => {
    const { userId: _userId, ...rest } = base;
    void _userId;
    expect(
      FavoriteSchema.safeParse({ ...rest, ...noTargets, stationId: "s-1" })
        .success
    ).toBe(false);
  });
});

describe("favorite targets", () => {
  it("are the four favoritable types, each also a tag target type", () => {
    expect([...FAVORITE_TARGET_TYPES].sort()).toEqual(
      ["connector_instance", "curated_view", "pin", "station"].sort()
    );
    for (const type of FAVORITE_TARGET_TYPES) {
      expect(TAG_TARGET_TYPES).toContain(type);
    }
  });

  it("map every type to its own column", () => {
    expect(Object.keys(FAVORITE_TARGET_COLUMNS).sort()).toEqual(
      [...FAVORITE_TARGET_TYPES].sort()
    );
    expect(new Set(Object.values(FAVORITE_TARGET_COLUMNS)).size).toBe(
      FAVORITE_TARGET_TYPES.length
    );
  });

  it("reject an unknown type", () => {
    expect(
      FavoriteTargetSchema.safeParse({ type: "entity", id: "e-1" }).success
    ).toBe(false);
    expect(
      FavoriteTargetSchema.safeParse({ type: "station", id: "s-1" }).success
    ).toBe(true);
  });
});

describe("FavoriteModelFactory", () => {
  it("starts with every target null", () => {
    const model = new FavoriteModelFactory().create("user-1").toJSON();
    expect(model).toMatchObject(noTargets);
    expect(model.createdBy).toBe("user-1");
  });
});
