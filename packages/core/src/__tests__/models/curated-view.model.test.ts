import {
  CuratedViewModel,
  CuratedViewModelFactory,
  CuratedViewSchema,
} from "../../models/curated-view.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

const validBase = {
  id: "cv-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const validFields = {
  organizationId: "org-1",
  connectorEntityId: "ce-1",
  key: "ne_accounts",
  label: "NE Accounts",
  description: null,
  whereClause: null,
};

describe("CuratedViewSchema", () => {
  it("accepts a valid unrestricted view (null whereClause)", () => {
    const result = CuratedViewSchema.safeParse({
      ...validBase,
      ...validFields,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a view with a whereClause and description", () => {
    const result = CuratedViewSchema.safeParse({
      ...validBase,
      ...validFields,
      description: "North-east accounts",
      whereClause: "c_region = 'NE'",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty key", () => {
    const result = CuratedViewSchema.safeParse({
      ...validBase,
      ...validFields,
      key: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const result = CuratedViewSchema.safeParse({
      ...validBase,
      ...validFields,
      label: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing whereClause key (required-nullable)", () => {
    const { whereClause: _omit, ...rest } = { ...validBase, ...validFields };
    void _omit;
    const result = CuratedViewSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a missing connectorEntityId", () => {
    const { connectorEntityId: _omit, ...rest } = {
      ...validBase,
      ...validFields,
    };
    void _omit;
    const result = CuratedViewSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("CuratedViewModelFactory", () => {
  it("stamps a generated id and createdBy", () => {
    const factory = new CuratedViewModelFactory({
      coreModelFactory: buildCoreModelFactory(new StubIDFactory("cv")),
    });
    const model = factory.create("admin-9");
    expect(model).toBeInstanceOf(CuratedViewModel);
    expect(model.toJSON().id).toBe("cv-1");
    expect(model.toJSON().createdBy).toBe("admin-9");
    expect(model.toJSON().deleted).toBeNull();
  });

  it("produces UUID ids with the default factory", () => {
    const factory = new CuratedViewModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    expect(factory.create("u").toJSON().id).toMatch(UUID_REGEX);
  });

  it("round-trips through update + parse", () => {
    const factory = new CuratedViewModelFactory({
      coreModelFactory: buildCoreModelFactory(new StubIDFactory("cv")),
    });
    const model = factory.create("admin-9").update(validFields);
    const parsed = model.parse();
    expect(parsed.key).toBe("ne_accounts");
    expect(parsed.whereClause).toBeNull();
  });
});
