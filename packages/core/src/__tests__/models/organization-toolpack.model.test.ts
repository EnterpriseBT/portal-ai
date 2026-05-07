import {
  OrganizationToolpackModel,
  OrganizationToolpackModelFactory,
  OrganizationToolpackSchema,
} from "../../models/organization-toolpack.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function validBase() {
  return {
    id: "otp-1",
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    name: "customer_intel",
    description: "External customer intelligence calls.",
    endpoints: {
      schema: "https://example.com/schema",
      runtime: "https://example.com/runtime",
    },
    authHeaders: null,
    signingSecret: "whsec_test_fixture",
    tools: [
      {
        name: "lookup_company",
        description: "Look up a company by domain.",
        parameterSchema: {
          type: "object",
          properties: { domain: { type: "string" } },
        },
      },
    ],
    metadata: null,
    schemaFetchedAt: Date.now(),
    metadataFetchedAt: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OrganizationToolpackSchema", () => {
  // Case 58
  it("accepts a valid record", () => {
    const result = OrganizationToolpackSchema.safeParse(validBase());
    expect(result.success).toBe(true);
  });

  // Case 59
  it("rejects names that fail the slug regex", () => {
    for (const bad of ["Camel_Case", "1leading", "with-hyphen", "UPPER", ""]) {
      const result = OrganizationToolpackSchema.safeParse({
        ...validBase(),
        name: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  // Case 60
  it("rejects an empty tools array", () => {
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      tools: [],
    });
    expect(result.success).toBe(false);
  });

  // Case 61
  it("rejects more than 32 tools", () => {
    const tool = validBase().tools[0];
    const tools = Array.from({ length: 33 }, (_, i) => ({
      ...tool,
      name: `tool_${i}`,
    }));
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      tools,
    });
    expect(result.success).toBe(false);
  });

  // Case 62
  it("accepts metadata = null", () => {
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      metadata: null,
    });
    expect(result.success).toBe(true);
  });

  // Case 63
  it("rejects schemaFetchedAt as a non-number", () => {
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      schemaFetchedAt: "now",
    });
    expect(result.success).toBe(false);
  });

  // Case 64
  it("rejects malformed endpoint URLs", () => {
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      endpoints: {
        schema: "not a url",
        runtime: "https://example.com/runtime",
      },
    });
    expect(result.success).toBe(false);
  });

  // Case 65
  it("rejects tool names that fail the regex", () => {
    const result = OrganizationToolpackSchema.safeParse({
      ...validBase(),
      tools: [
        {
          name: "Bad-Tool-Name",
          description: "x",
          parameterSchema: { type: "object", properties: {} },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  // Case 66
  it("rejects parameterSchema that is not a plain object", () => {
    for (const bad of [null, "string", 42]) {
      const result = OrganizationToolpackSchema.safeParse({
        ...validBase(),
        tools: [
          {
            name: "ok",
            description: "x",
            parameterSchema: bad as never,
          },
        ],
      });
      expect(result.success).toBe(false);
    }
  });

  // Case 67
  it("factory produces a model instance with a generated id and stamped createdBy", () => {
    const factory = new OrganizationToolpackModelFactory();
    const model = factory.create("user-2");
    expect(model).toBeInstanceOf(OrganizationToolpackModel);
    const json = model.toJSON();
    expect(typeof json.id).toBe("string");
    expect((json.id ?? "").length).toBeGreaterThan(0);
    expect(json.createdBy).toBe("user-2");
  });
});
