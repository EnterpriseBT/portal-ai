import {
  ConnectorInstanceListRequestQuerySchema,
  CuratedViewListRequestQuerySchema,
  CuratedViewListItemSchema,
  PortalResultListRequestQuerySchema,
  StationListRequestQuerySchema,
  StationWithToolpacksSchema,
} from "../../contracts/index.js";

const QUERIES = [
  ["stations", StationListRequestQuerySchema],
  ["pins", PortalResultListRequestQuerySchema],
  ["connector instances", ConnectorInstanceListRequestQuerySchema],
  ["curated views", CuratedViewListRequestQuerySchema],
] as const;

describe("tag list filter (#1070)", () => {
  it.each(QUERIES)("the %s list query accepts tagIds", (_name, schema) => {
    const parsed = schema.parse({ tagIds: "t1,t2" });
    expect(parsed.tagIds).toBe("t1,t2");
  });

  it.each(QUERIES)("the %s list query leaves tagIds unset", (_name, schema) => {
    expect(schema.parse({}).tagIds).toBeUndefined();
  });
});

describe("tagged list rows (#1070)", () => {
  const tag = {
    id: "tag-1",
    created: 1,
    createdBy: "u",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    name: "Finance",
    color: null,
    description: null,
  };

  it("a station row may carry its tags", () => {
    const row = StationWithToolpacksSchema.shape.tags.parse([tag]);
    expect(row).toHaveLength(1);
  });

  it("a curated view row's tags are optional", () => {
    expect(CuratedViewListItemSchema.shape.tags.parse(undefined)).toBe(
      undefined
    );
  });
});
