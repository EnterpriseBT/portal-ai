import {
  OrganizationToolListRequestQuerySchema,
  OrganizationToolListResponsePayloadSchema,
  CreateOrganizationToolBodySchema,
  OrganizationToolCreateResponsePayloadSchema,
  UpdateOrganizationToolBodySchema,
  OrganizationToolUpdateResponsePayloadSchema,
} from "../../contracts/organization-tool.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validOrgTool = {
  id: "ot-1",
  organizationId: "org-1",
  name: "Custom Webhook",
  description: "Calls external API",
  parameterSchema: {
    type: "object",
    properties: { query: { type: "string" } },
  },
  implementation: { type: "webhook", url: "https://api.example.com/hook" },
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("OrganizationToolListRequestQuerySchema", () => {
  it("should accept valid params with search", () => {
    const result = OrganizationToolListRequestQuerySchema.safeParse({
      search: "webhook",
      sortBy: "created",
      sortOrder: "asc",
      limit: "10",
      offset: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("webhook");
    }
  });

  it("should apply defaults", () => {
    const result = OrganizationToolListRequestQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });
});

// ── List response ────────────────────────────────────────────────────

describe("OrganizationToolListResponsePayloadSchema", () => {
  it("should accept a valid response", () => {
    const result = OrganizationToolListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      organizationTools: [validOrgTool],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = OrganizationToolListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      organizationTools: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination", () => {
    const result = OrganizationToolListResponsePayloadSchema.safeParse({
      organizationTools: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("CreateOrganizationToolBodySchema", () => {
  it("should accept valid input with all fields", () => {
    const result = CreateOrganizationToolBodySchema.safeParse({
      name: "Custom Webhook",
      description: "Calls external API",
      parameterSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
      implementation: {
        type: "webhook",
        url: "https://api.example.com/hook",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const result = CreateOrganizationToolBodySchema.safeParse({
      name: "",
      parameterSchema: {},
      implementation: { type: "webhook", url: "https://api.example.com/hook" },
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing name", () => {
    const result = CreateOrganizationToolBodySchema.safeParse({
      parameterSchema: {},
      implementation: { type: "webhook", url: "https://api.example.com/hook" },
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing implementation", () => {
    const result = CreateOrganizationToolBodySchema.safeParse({
      name: "Custom Webhook",
      parameterSchema: {},
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid implementation url", () => {
    const result = CreateOrganizationToolBodySchema.safeParse({
      name: "Custom Webhook",
      parameterSchema: {},
      implementation: { type: "webhook", url: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("OrganizationToolCreateResponsePayloadSchema", () => {
  it("should accept a valid response", () => {
    const result = OrganizationToolCreateResponsePayloadSchema.safeParse({
      organizationTool: validOrgTool,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("UpdateOrganizationToolBodySchema", () => {
  it("should accept partial with name only", () => {
    const result = UpdateOrganizationToolBodySchema.safeParse({
      name: "Renamed Tool",
    });
    expect(result.success).toBe(true);
  });

  it("should accept partial with implementation only", () => {
    const result = UpdateOrganizationToolBodySchema.safeParse({
      implementation: {
        type: "webhook",
        url: "https://api.example.com/new-hook",
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty object", () => {
    const result = UpdateOrganizationToolBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = UpdateOrganizationToolBodySchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("OrganizationToolUpdateResponsePayloadSchema", () => {
  it("should accept a valid response", () => {
    const result = OrganizationToolUpdateResponsePayloadSchema.safeParse({
      organizationTool: validOrgTool,
    });
    expect(result.success).toBe(true);
  });
});
