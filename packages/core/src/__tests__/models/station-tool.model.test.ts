import { StationToolSchema } from "../../models/station-tool.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validData = {
  id: "st-1",
  stationId: "station-1",
  organizationToolId: "ot-1",
  created: Date.now(),
};

// ── Tests ────────────────────────────────────────────────────────────

describe("StationToolSchema", () => {
  it("should accept valid data with all fields", () => {
    const result = StationToolSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should reject missing id", () => {
    const { id: _, ...data } = validData;
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing stationId", () => {
    const { stationId: _, ...data } = validData;
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing organizationToolId", () => {
    const { organizationToolId: _, ...data } = validData;
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing created", () => {
    const { created: _, ...data } = validData;
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject non-number created", () => {
    const result = StationToolSchema.safeParse({
      ...validData,
      created: "not-a-number",
    });
    expect(result.success).toBe(false);
  });

  it("should accept minimal valid data", () => {
    const minimal = {
      id: "x",
      stationId: "s",
      organizationToolId: "o",
      created: 0,
    };
    const result = StationToolSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});
