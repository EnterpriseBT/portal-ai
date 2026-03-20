import {
  FieldMappingListRequestQuerySchema,
  FieldMappingListResponsePayloadSchema,
  FieldMappingGetResponsePayloadSchema,
  FieldMappingCreateRequestBodySchema,
  FieldMappingCreateResponsePayloadSchema,
  FieldMappingUpdateRequestBodySchema,
  FieldMappingUpdateResponsePayloadSchema,
} from "../../contracts/field-mapping.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validFieldMapping = {
  id: "fm-1",
  organizationId: "org-1",
  connectorEntityId: "ce-1",
  columnDefinitionId: "cd-1",
  sourceField: "account_name",
  isPrimaryKey: false,
  refColumnDefinitionId: null,
  refEntityKey: null,
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("FieldMappingListRequestQuerySchema", () => {
  it("should accept a valid query with connectorEntityId", () => {
    const result = FieldMappingListRequestQuerySchema.safeParse({
      connectorEntityId: "ce-1",
    });
    expect(result.success).toBe(true);
  });

  it("should apply pagination defaults", () => {
    const result = FieldMappingListRequestQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });

  it("should accept optional columnDefinitionId filter", () => {
    const result = FieldMappingListRequestQuerySchema.parse({
      columnDefinitionId: "cd-1",
    });
    expect(result.columnDefinitionId).toBe("cd-1");
  });

  it("should accept a query without connectorEntityId", () => {
    const result = FieldMappingListRequestQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should cap limit at 100", () => {
    const result = FieldMappingListRequestQuerySchema.parse({
      limit: "200",
    });
    expect(result.limit).toBe(100);
  });

  it("should accept search, sortBy, and sortOrder", () => {
    const result = FieldMappingListRequestQuerySchema.parse({
      connectorEntityId: "ce-1",
      search: "account",
      sortBy: "sourceField",
      sortOrder: "desc",
    });
    expect(result.search).toBe("account");
    expect(result.sortBy).toBe("sourceField");
    expect(result.sortOrder).toBe("desc");
  });
});

// ── List response ────────────────────────────────────────────────────

describe("FieldMappingListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = FieldMappingListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      fieldMappings: [validFieldMapping],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = FieldMappingListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      fieldMappings: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = FieldMappingListResponsePayloadSchema.safeParse({
      fieldMappings: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Get response ─────────────────────────────────────────────────────

describe("FieldMappingGetResponsePayloadSchema", () => {
  it("should accept a valid get response", () => {
    const result = FieldMappingGetResponsePayloadSchema.safeParse({
      fieldMapping: validFieldMapping,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing fieldMapping", () => {
    const result = FieldMappingGetResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("FieldMappingCreateRequestBodySchema", () => {
  it("should accept a valid create body with required fields only", () => {
    const result = FieldMappingCreateRequestBodySchema.safeParse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "account_name",
    });
    expect(result.success).toBe(true);
  });

  it("should default isPrimaryKey to false", () => {
    const result = FieldMappingCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "account_name",
    });
    expect(result.isPrimaryKey).toBe(false);
  });

  it("should accept isPrimaryKey override", () => {
    const result = FieldMappingCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "user_id",
      isPrimaryKey: true,
    });
    expect(result.isPrimaryKey).toBe(true);
  });

  it("should reject missing connectorEntityId", () => {
    const result = FieldMappingCreateRequestBodySchema.safeParse({
      columnDefinitionId: "cd-1",
      sourceField: "account_name",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing columnDefinitionId", () => {
    const result = FieldMappingCreateRequestBodySchema.safeParse({
      connectorEntityId: "ce-1",
      sourceField: "account_name",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty sourceField", () => {
    const result = FieldMappingCreateRequestBodySchema.safeParse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("FieldMappingCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = FieldMappingCreateResponsePayloadSchema.safeParse({
      fieldMapping: validFieldMapping,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("FieldMappingUpdateRequestBodySchema", () => {
  it("should accept a partial update with sourceField only", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "new_field",
    });
    expect(result.success).toBe(true);
  });

  it("should accept a partial update with isPrimaryKey only", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      isPrimaryKey: true,
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty object (no-op update)", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should reject empty sourceField", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("FieldMappingUpdateResponsePayloadSchema", () => {
  it("should accept a valid update response", () => {
    const result = FieldMappingUpdateResponsePayloadSchema.safeParse({
      fieldMapping: validFieldMapping,
    });
    expect(result.success).toBe(true);
  });
});
