import {
  ToolpackSchema,
  ToolpackListRequestQuerySchema,
  ToolpackListResponsePayloadSchema,
  ToolpackGetResponsePayloadSchema,
  RegisterToolpackBodySchema,
  UpdateToolpackBodySchema,
} from "../../contracts/toolpack.contract.js";

const VALID_BUILTIN = {
  id: "builtin:data_query",
  kind: "builtin" as const,
  slug: "data_query",
  name: "Data Query",
  description: "Run SQL queries and visualize results.",
  iconSlug: "Database",
  tools: [
    {
      name: "sql_query",
      description: "Execute a SQL query.",
      parameterSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
  ],
};

const VALID_CUSTOM = {
  id: "otp-1",
  kind: "custom" as const,
  slug: "customer_intel",
  name: "customer_intel",
  description: "External customer intelligence calls.",
  iconSlug: "Extension",
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
  endpoints: {
    schema: "https://example.com/schema",
    runtime: "https://example.com/runtime",
  },
  authHeadersStatus: { has: false },
  signingSecretStatus: { has: true },
  schemaFetchedAt: Date.now(),
  metadataFetchedAt: null,
};

describe("ToolpackSchema", () => {
  // Case 11
  it("parses a valid built-in record", () => {
    const result = ToolpackSchema.safeParse(VALID_BUILTIN);
    expect(result.success).toBe(true);
  });

  // Case 12
  it("rejects records missing the kind field", () => {
    const { kind: _kind, ...withoutKind } = VALID_BUILTIN;
    const result = ToolpackSchema.safeParse(withoutKind);
    expect(result.success).toBe(false);
  });

  // Case 13
  it("rejects unknown kind values", () => {
    const result = ToolpackSchema.safeParse({
      ...VALID_BUILTIN,
      kind: "future",
    });
    expect(result.success).toBe(false);
  });
});

describe("ToolpackListResponsePayloadSchema", () => {
  // Case 14
  it("accepts an array of records and a numeric total", () => {
    const result = ToolpackListResponsePayloadSchema.safeParse({
      toolpacks: [VALID_BUILTIN],
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  // Case 16
  it("accepts an empty array", () => {
    const result = ToolpackListResponsePayloadSchema.safeParse({
      toolpacks: [],
      total: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when total is missing", () => {
    const result = ToolpackListResponsePayloadSchema.safeParse({
      toolpacks: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ToolpackGetResponsePayloadSchema", () => {
  it("accepts a valid get response", () => {
    const result = ToolpackGetResponsePayloadSchema.safeParse({
      toolpack: VALID_BUILTIN,
    });
    expect(result.success).toBe(true);
  });
});

describe("ToolpackSchema (custom arm)", () => {
  // Case 68
  it("accepts a kind: 'custom' record", () => {
    const result = ToolpackSchema.safeParse(VALID_CUSTOM);
    expect(result.success).toBe(true);
  });

  // Case 69
  it("rejects a custom record without endpoints", () => {
    const { endpoints: _e, ...withoutEndpoints } = VALID_CUSTOM;
    const result = ToolpackSchema.safeParse(withoutEndpoints);
    expect(result.success).toBe(false);
  });
});

describe("RegisterToolpackBodySchema", () => {
  // Case 70
  it("accepts a minimal payload", () => {
    const result = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed name", () => {
    const result = RegisterToolpackBodySchema.safeParse({
      name: "Bad Name",
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed endpoint URL", () => {
    const result = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      endpoints: {
        schema: "not-a-url",
        runtime: "https://example.com/runtime",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional metadata endpoint and authHeaders", () => {
    const result = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      description: "x",
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
        metadata: "https://example.com/metadata",
      },
      authHeaders: { "X-Api-Key": "secret" },
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateToolpackBodySchema", () => {
  // Case 71
  it("rejects an empty object", () => {
    const result = UpdateToolpackBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // Case 72
  it("accepts a partial subset", () => {
    expect(
      UpdateToolpackBodySchema.safeParse({ description: "new" }).success
    ).toBe(true);
    expect(
      UpdateToolpackBodySchema.safeParse({
        endpoints: {
          schema: "https://example.com/s",
          runtime: "https://example.com/r",
        },
      }).success
    ).toBe(true);
  });
});

describe("ToolpackListRequestQuerySchema", () => {
  // Case 15
  it("rejects unknown kind values", () => {
    const result = ToolpackListRequestQuerySchema.safeParse({
      kind: "garbage",
    });
    expect(result.success).toBe(false);
  });

  it("accepts builtin and custom kind values", () => {
    expect(
      ToolpackListRequestQuerySchema.safeParse({ kind: "builtin" }).success
    ).toBe(true);
    expect(
      ToolpackListRequestQuerySchema.safeParse({ kind: "custom" }).success
    ).toBe(true);
  });

  it("accepts a search string", () => {
    const result = ToolpackListRequestQuerySchema.safeParse({
      search: "correl",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty query object", () => {
    expect(ToolpackListRequestQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe("ToolpackEndpointsSchema URL refinement (phase 6)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // Case 148
  it("rejects http URLs in production but accepts http://localhost in non-production", () => {
    process.env.NODE_ENV = "production";
    const prodResult = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      endpoints: {
        schema: "http://example.com/schema",
        runtime: "http://example.com/runtime",
      },
    });
    expect(prodResult.success).toBe(false);
    if (!prodResult.success) {
      const codes = prodResult.error.issues
        .map((i) => (i as { params?: { code?: string } }).params?.code)
        .filter(Boolean);
      expect(codes).toContain("TOOLPACK_URL_NOT_HTTPS");
    }

    process.env.NODE_ENV = "development";
    const devResult = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      endpoints: {
        schema: "http://localhost:4100/schema",
        runtime: "http://localhost:4100/runtime",
      },
    });
    expect(devResult.success).toBe(true);

    // Raw IP literal in private range — rejected regardless of env.
    process.env.NODE_ENV = "production";
    const privateIp = RegisterToolpackBodySchema.safeParse({
      name: "customer_intel",
      endpoints: {
        schema: "https://10.0.0.5/schema",
        runtime: "https://10.0.0.5/runtime",
      },
    });
    expect(privateIp.success).toBe(false);
    if (!privateIp.success) {
      const codes = privateIp.error.issues
        .map((i) => (i as { params?: { code?: string } }).params?.code)
        .filter(Boolean);
      expect(codes).toContain("TOOLPACK_URL_PRIVATE_HOST");
    }
  });
});
