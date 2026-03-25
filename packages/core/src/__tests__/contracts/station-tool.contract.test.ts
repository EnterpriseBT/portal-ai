import {
  AssignStationToolBodySchema,
  StationToolListResponsePayloadSchema,
  StationToolAssignResponsePayloadSchema,
  StationToolWithDefinitionSchema,
} from "../../contracts/station-tool.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validOrgTool = {
  id: "ot-1",
  organizationId: "org-1",
  name: "Custom Webhook",
  description: "Calls external API",
  parameterSchema: { type: "object" },
  implementation: { type: "webhook", url: "https://api.example.com/hook" },
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const validStationTool = {
  id: "st-1",
  stationId: "station-1",
  organizationToolId: "ot-1",
  created: Date.now(),
};

// ── Assign request body ─────────────────────────────────────────────

describe("AssignStationToolBodySchema", () => {
  it("should accept valid input", () => {
    const result = AssignStationToolBodySchema.safeParse({
      organizationToolId: "ot-1",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing organizationToolId", () => {
    const result = AssignStationToolBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty organizationToolId", () => {
    const result = AssignStationToolBodySchema.safeParse({
      organizationToolId: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── List response ───────────────────────────────────────────────────

describe("StationToolListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = StationToolListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      stationTools: [{ ...validStationTool, organizationTool: validOrgTool }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = StationToolListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      stationTools: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = StationToolListResponsePayloadSchema.safeParse({
      stationTools: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Assign response ─────────────────────────────────────────────────

describe("StationToolAssignResponsePayloadSchema", () => {
  it("should accept a valid response with stationTool", () => {
    const result = StationToolAssignResponsePayloadSchema.safeParse({
      stationTool: validStationTool,
    });
    expect(result.success).toBe(true);
  });
});

// ── StationToolWithDefinition ───────────────────────────────────────

describe("StationToolWithDefinitionSchema", () => {
  it("should accept valid data with nested organizationTool", () => {
    const result = StationToolWithDefinitionSchema.safeParse({
      ...validStationTool,
      organizationTool: validOrgTool,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing organizationTool", () => {
    const result = StationToolWithDefinitionSchema.safeParse(validStationTool);
    expect(result.success).toBe(false);
  });
});
