import {
  FieldMappingListRequestQuerySchema,
  FieldMappingListResponsePayloadSchema,
  FieldMappingGetResponsePayloadSchema,
  FieldMappingCreateRequestBodySchema,
  FieldMappingCreateResponsePayloadSchema,
  FieldMappingUpdateRequestBodySchema,
  FieldMappingUpdateResponsePayloadSchema,
  FieldMappingDeleteResponsePayloadSchema,
  FieldMappingImpactResponsePayloadSchema,
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
  refBidirectionalFieldMappingId: null,
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

  it("should default refBidirectionalFieldMappingId to null when omitted", () => {
    const result = FieldMappingCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "account_name",
    });
    expect(result.refBidirectionalFieldMappingId).toBeNull();
  });

  it("should accept refBidirectionalFieldMappingId as a string ID", () => {
    const result = FieldMappingCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "account_name",
      refBidirectionalFieldMappingId: "fm-42",
    });
    expect(result.refBidirectionalFieldMappingId).toBe("fm-42");
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
  it("should accept an update with required fields", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "new_field",
      columnDefinitionId: "cd-1",
    });
    expect(result.success).toBe(true);
  });

  it("should allow update with refBidirectionalFieldMappingId set to a string", () => {
    const result = FieldMappingUpdateRequestBodySchema.parse({
      sourceField: "email",
      columnDefinitionId: "cd-1",
      refBidirectionalFieldMappingId: "fm-42",
    });
    expect(result.refBidirectionalFieldMappingId).toBe("fm-42");
  });

  it("should allow update clearing refBidirectionalFieldMappingId to null", () => {
    const result = FieldMappingUpdateRequestBodySchema.parse({
      sourceField: "email",
      columnDefinitionId: "cd-1",
      refBidirectionalFieldMappingId: null,
    });
    expect(result.refBidirectionalFieldMappingId).toBeNull();
  });

  it("should accept update with isPrimaryKey", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "email",
      columnDefinitionId: "cd-1",
      isPrimaryKey: true,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing required fields", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject missing columnDefinitionId", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "email",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty sourceField", () => {
    const result = FieldMappingUpdateRequestBodySchema.safeParse({
      sourceField: "",
      columnDefinitionId: "cd-1",
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

// ── Delete response ─────────────────────────────────────────────────

describe("FieldMappingDeleteResponsePayloadSchema", () => {
  it("should accept a valid delete response with cascaded counts", () => {
    const result = FieldMappingDeleteResponsePayloadSchema.safeParse({
      id: "fm-1",
      cascaded: { entityGroupMembers: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("should accept zero cascaded entity group members", () => {
    const result = FieldMappingDeleteResponsePayloadSchema.safeParse({
      id: "fm-1",
      cascaded: { entityGroupMembers: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing cascaded object", () => {
    const result = FieldMappingDeleteResponsePayloadSchema.safeParse({
      id: "fm-1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing id", () => {
    const result = FieldMappingDeleteResponsePayloadSchema.safeParse({
      cascaded: { entityGroupMembers: 0 },
    });
    expect(result.success).toBe(false);
  });
});

// ── Impact response ─────────────────────────────────────────────────

describe("FieldMappingImpactResponsePayloadSchema", () => {
  it("should accept a valid impact response", () => {
    const result = FieldMappingImpactResponsePayloadSchema.safeParse({
      entityGroupMembers: 5,
    });
    expect(result.success).toBe(true);
  });

  it("should accept zero entity group members", () => {
    const result = FieldMappingImpactResponsePayloadSchema.safeParse({
      entityGroupMembers: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing entityGroupMembers", () => {
    const result = FieldMappingImpactResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
