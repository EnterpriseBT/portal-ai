import {
  ColumnDefinitionListRequestQuerySchema,
  ColumnDefinitionListResponsePayloadSchema,
  ColumnDefinitionGetResponsePayloadSchema,
  ColumnDefinitionCreateRequestBodySchema,
  ColumnDefinitionCreateResponsePayloadSchema,
  ColumnDefinitionUpdateRequestBodySchema,
  ColumnDefinitionUpdateResponsePayloadSchema,
} from "../../contracts/column-definition.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validColumnDefinition = {
  id: "cd-1",
  organizationId: "org-1",
  key: "email",
  label: "Email",
  type: "string",
  description: "Primary email",
  validationPattern: null,
  validationMessage: null,
  canonicalFormat: null,
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("ColumnDefinitionListRequestQuerySchema", () => {
  it("should accept an empty query (pagination defaults only)", () => {
    const result = ColumnDefinitionListRequestQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should apply pagination defaults", () => {
    const result = ColumnDefinitionListRequestQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });

  it("should accept optional type filter", () => {
    const result = ColumnDefinitionListRequestQuerySchema.parse({
      type: "string",
    });
    expect(result.type).toBe("string");
  });

  it("should accept any string as type filter (multi-type support)", () => {
    const result = ColumnDefinitionListRequestQuerySchema.safeParse({
      type: "string,number",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("string,number");
    }
  });

  it("should cap limit at 100", () => {
    const result = ColumnDefinitionListRequestQuerySchema.parse({
      limit: "500",
    });
    expect(result.limit).toBe(100);
  });

  it("should accept search, sortBy, and sortOrder", () => {
    const result = ColumnDefinitionListRequestQuerySchema.parse({
      search: "email",
      sortBy: "key",
      sortOrder: "desc",
    });
    expect(result.search).toBe("email");
    expect(result.sortBy).toBe("key");
    expect(result.sortOrder).toBe("desc");
  });
});

// ── List response ────────────────────────────────────────────────────

describe("ColumnDefinitionListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = ColumnDefinitionListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      columnDefinitions: [validColumnDefinition],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array of column definitions", () => {
    const result = ColumnDefinitionListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      columnDefinitions: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = ColumnDefinitionListResponsePayloadSchema.safeParse({
      columnDefinitions: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Get response ─────────────────────────────────────────────────────

describe("ColumnDefinitionGetResponsePayloadSchema", () => {
  it("should accept a valid get response", () => {
    const result = ColumnDefinitionGetResponsePayloadSchema.safeParse({
      columnDefinition: validColumnDefinition,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing columnDefinition", () => {
    const result = ColumnDefinitionGetResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("ColumnDefinitionCreateRequestBodySchema", () => {
  it("should accept a valid create body with required fields only", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      key: "email",
      label: "Email",
      type: "string",
    });
    expect(result.success).toBe(true);
  });

  it("should apply defaults for optional fields", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.parse({
      key: "email",
      label: "Email",
      type: "string",
    });
    expect(result.description).toBeNull();
    expect(result.validationPattern).toBeNull();
    expect(result.validationMessage).toBeNull();
    expect(result.canonicalFormat).toBeNull();
  });

  it("should accept all optional fields", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      key: "status",
      label: "Status",
      type: "enum",
      description: "Account status",
      validationPattern: "^(active|inactive)$",
      validationMessage: "Must be active or inactive",
      canonicalFormat: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing key", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      label: "Email",
      type: "string",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid key format", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      key: "Invalid-Key",
      label: "Email",
      type: "string",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty label", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      key: "email",
      label: "",
      type: "string",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid type", () => {
    const result = ColumnDefinitionCreateRequestBodySchema.safeParse({
      key: "email",
      label: "Email",
      type: "bigint",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("ColumnDefinitionCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = ColumnDefinitionCreateResponsePayloadSchema.safeParse({
      columnDefinition: validColumnDefinition,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("ColumnDefinitionUpdateRequestBodySchema", () => {
  it("should accept a partial update with label only", () => {
    const result = ColumnDefinitionUpdateRequestBodySchema.safeParse({
      label: "Updated Label",
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty object (no-op update)", () => {
    const result = ColumnDefinitionUpdateRequestBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept all updatable fields", () => {
    const result = ColumnDefinitionUpdateRequestBodySchema.safeParse({
      label: "New Label",
      type: "enum",
      description: "Updated description",
      validationPattern: "^(active|inactive)$",
      validationMessage: "Must be active or inactive",
      canonicalFormat: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid type value", () => {
    const result = ColumnDefinitionUpdateRequestBodySchema.safeParse({
      type: "bigint",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty label", () => {
    const result = ColumnDefinitionUpdateRequestBodySchema.safeParse({
      label: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("ColumnDefinitionUpdateResponsePayloadSchema", () => {
  it("should accept a valid update response", () => {
    const result = ColumnDefinitionUpdateResponsePayloadSchema.safeParse({
      columnDefinition: validColumnDefinition,
    });
    expect(result.success).toBe(true);
  });
});
