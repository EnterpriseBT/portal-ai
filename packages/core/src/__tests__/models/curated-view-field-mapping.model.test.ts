import {
  CuratedViewFieldMappingModel,
  CuratedViewFieldMappingModelFactory,
  CuratedViewFieldMappingSchema,
} from "../../models/curated-view-field-mapping.model.js";
import { StubIDFactory, buildCoreModelFactory } from "../test-utils.js";

const validBase = {
  id: "cvfm-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

describe("CuratedViewFieldMappingSchema", () => {
  it("accepts a valid projection row", () => {
    const result = CuratedViewFieldMappingSchema.safeParse({
      ...validBase,
      organizationId: "org-1",
      curatedViewId: "cv-1",
      fieldMappingId: "fm-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing fieldMappingId", () => {
    const result = CuratedViewFieldMappingSchema.safeParse({
      ...validBase,
      organizationId: "org-1",
      curatedViewId: "cv-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("CuratedViewFieldMappingModelFactory", () => {
  it("stamps id and createdBy", () => {
    const factory = new CuratedViewFieldMappingModelFactory({
      coreModelFactory: buildCoreModelFactory(new StubIDFactory("cvfm")),
    });
    const model = factory.create("admin-1");
    expect(model).toBeInstanceOf(CuratedViewFieldMappingModel);
    expect(model.toJSON().id).toBe("cvfm-1");
    expect(model.toJSON().createdBy).toBe("admin-1");
  });
});
