import {
  CreateApiEndpointColumnDraftSchema,
  CreateApiEndpointRequestBodySchema,
  SuggestTransformRequestBodySchema,
  SuggestTransformResponseSchema,
} from "../../contracts/api-connector.contract.js";

// ── Suggest-transform request body ───────────────────────────────────

describe("SuggestTransformRequestBodySchema", () => {
  it("accepts a body with only sampleResponse", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      sampleResponse: { data: [1, 2, 3] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.promptHint).toBeUndefined();
      expect(result.data.sampleResponse).toEqual({ data: [1, 2, 3] });
    }
  });

  it("accepts a body with both promptHint and sampleResponse", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      promptHint: "one row per line item",
      sampleResponse: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.promptHint).toBe("one row per line item");
    }
  });

  it("rejects a promptHint over 2000 characters", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      promptHint: "x".repeat(2001),
      sampleResponse: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const promptHintIssue = result.error.issues.find(
        (i: { path: PropertyKey[] }) => i.path.includes("promptHint")
      );
      expect(promptHintIssue).toBeDefined();
    }
  });

  it("accepts a promptHint of exactly 2000 characters", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      promptHint: "x".repeat(2000),
      sampleResponse: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing sampleResponse", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      promptHint: "anything",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i: { path: PropertyKey[] }) =>
        i.path.includes("sampleResponse")
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts a body with sampleResponse: null (null is a valid response)", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      sampleResponse: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sampleResponse).toBeNull();
    }
  });

  it("accepts a body with a primitive sampleResponse", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      sampleResponse: 42,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a body with an array sampleResponse", () => {
    const result = SuggestTransformRequestBodySchema.safeParse({
      sampleResponse: [{ id: 1 }, { id: 2 }],
    });
    expect(result.success).toBe(true);
  });
});

// ── Suggest-transform response ───────────────────────────────────────

describe("SuggestTransformResponseSchema", () => {
  it("accepts a success response with warning: null", () => {
    const result = SuggestTransformResponseSchema.safeParse({
      expression: "data.items",
      warning: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a success response with a validation-failed warning", () => {
    const result = SuggestTransformResponseSchema.safeParse({
      expression: "data.items.{ id }",
      warning: {
        kind: "validation-failed",
        message: "the expression returned 0 records",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warning?.kind).toBe("validation-failed");
    }
  });

  it("rejects a warning with an unknown kind", () => {
    const result = SuggestTransformResponseSchema.safeParse({
      expression: "data.items",
      warning: { kind: "something-else", message: "..." },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response missing the warning field", () => {
    const result = SuggestTransformResponseSchema.safeParse({
      expression: "data.items",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response missing the expression field", () => {
    const result = SuggestTransformResponseSchema.safeParse({
      warning: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── Create-endpoint column draft (#838) ──────────────────────────────

describe("CreateApiEndpointColumnDraftSchema", () => {
  const column = {
    sourceField: "email",
    normalizedKey: "email",
    columnDefinitionId: "cd-1",
  };

  it("accepts a column naming its column definition", () => {
    const result = CreateApiEndpointColumnDraftSchema.safeParse(column);
    expect(result.success).toBe(true);
  });

  it("requires a column definition: an endpoint never creates one", () => {
    const { columnDefinitionId: _omit, ...rest } = column;
    expect(CreateApiEndpointColumnDraftSchema.safeParse(rest).success).toBe(
      false
    );
    expect(
      CreateApiEndpointColumnDraftSchema.safeParse({
        ...column,
        columnDefinitionId: null,
      }).success
    ).toBe(false);
    expect(
      CreateApiEndpointColumnDraftSchema.safeParse({
        ...column,
        columnDefinitionId: "",
      }).success
    ).toBe(false);
  });

  it("refuses the retired type field", () => {
    const result = CreateApiEndpointColumnDraftSchema.safeParse({
      ...column,
      type: "string",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateApiEndpointRequestBodySchema columns (#838)", () => {
  const body = (columns: unknown[]) => ({
    key: "users",
    label: "Users",
    config: {
      path: "/users",
      method: "GET",
      recordsPath: "",
      pagination: { strategy: "none" },
    },
    columns,
  });
  const column = (normalizedKey: string) => ({
    sourceField: normalizedKey,
    normalizedKey,
    columnDefinitionId: "cd-1",
  });

  it("names a missing column definition", () => {
    const result = CreateApiEndpointRequestBodySchema.safeParse(
      body([{ sourceField: "email", normalizedKey: "email" }])
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["columns", 0, "columnDefinitionId"],
      message: "Column definition is required",
    });
  });

  it("refuses a repeated normalized key", () => {
    const result = CreateApiEndpointRequestBodySchema.safeParse(
      body([column("id"), column("name"), column("id")])
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["columns", 2, "normalizedKey"],
      message: 'Duplicate normalized key "id"',
    });
  });

  it("accepts two columns mapping one definition under different keys", () => {
    expect(
      CreateApiEndpointRequestBodySchema.safeParse(
        body([column("id"), column("alt_id")])
      ).success
    ).toBe(true);
  });
});
