import {
  StationToolpackModel,
  StationToolpackModelFactory,
  StationToolpackSchema,
} from "../../models/station-toolpack.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function validBase() {
  return {
    id: "stp-1",
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    stationId: "station-1",
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("StationToolpackSchema", () => {
  it("accepts a row with only builtinSlug", () => {
    const result = StationToolpackSchema.safeParse({
      ...validBase(),
      builtinSlug: "data_query",
      organizationToolpackId: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row with only organizationToolpackId", () => {
    const result = StationToolpackSchema.safeParse({
      ...validBase(),
      builtinSlug: null,
      organizationToolpackId: "otp-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a row where both fields are set (XOR)", () => {
    const result = StationToolpackSchema.safeParse({
      ...validBase(),
      builtinSlug: "data_query",
      organizationToolpackId: "otp-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a row where neither field is set (XOR)", () => {
    const result = StationToolpackSchema.safeParse({
      ...validBase(),
      builtinSlug: null,
      organizationToolpackId: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("StationToolpackModelFactory", () => {
  it("creates a model with a generated id and stamps createdBy", () => {
    const factory = new StationToolpackModelFactory();
    const model = factory.create("user-2");
    expect(model).toBeInstanceOf(StationToolpackModel);
    const parsedBase = model.toJSON();
    expect(typeof parsedBase.id).toBe("string");
    expect((parsedBase.id ?? "").length).toBeGreaterThan(0);
    expect(parsedBase.createdBy).toBe("user-2");
  });
});
