import {
  StationViewModel,
  StationViewModelFactory,
  StationViewSchema,
} from "../../models/station-view.model.js";
import { StubIDFactory, buildCoreModelFactory } from "../test-utils.js";

const validBase = {
  id: "sv-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

describe("StationViewSchema", () => {
  it("accepts a valid attachment row", () => {
    const result = StationViewSchema.safeParse({
      ...validBase,
      organizationId: "org-1",
      stationId: "station-1",
      curatedViewId: "cv-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing curatedViewId", () => {
    const result = StationViewSchema.safeParse({
      ...validBase,
      organizationId: "org-1",
      stationId: "station-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("StationViewModelFactory", () => {
  it("stamps id and createdBy", () => {
    const factory = new StationViewModelFactory({
      coreModelFactory: buildCoreModelFactory(new StubIDFactory("sv")),
    });
    const model = factory.create("admin-1");
    expect(model).toBeInstanceOf(StationViewModel);
    expect(model.toJSON().id).toBe("sv-1");
    expect(model.toJSON().createdBy).toBe("admin-1");
  });
});
