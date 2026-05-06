import {
  ToolpackSchema,
  ToolpackListRequestQuerySchema,
  ToolpackListResponsePayloadSchema,
  ToolpackGetResponsePayloadSchema,
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
