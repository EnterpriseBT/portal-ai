import {
  EntityGroupListRequestQuerySchema,
  EntityGroupListResponsePayloadSchema,
  EntityGroupGetResponsePayloadSchema,
  EntityGroupCreateRequestBodySchema,
  EntityGroupCreateResponsePayloadSchema,
  EntityGroupUpdateRequestBodySchema,
  EntityGroupUpdateResponsePayloadSchema,
} from "../../contracts/entity-group.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validEntityGroup = {
  id: "eg-1",
  organizationId: "org-1",
  name: "People",
  description: "Cross-source identity group for people",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const validMemberWithDetails = {
  id: "egm-1",
  organizationId: "org-1",
  entityGroupId: "eg-1",
  connectorEntityId: "ce-1",
  linkFieldMappingId: "fm-1",
  isPrimary: true,
  connectorEntityLabel: "Employees",
  linkFieldMappingSourceField: "email",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── List request query ───────────────────────────────────────────────

describe("EntityGroupListRequestQuerySchema", () => {
  it("should accept valid pagination + search params", () => {
    const result = EntityGroupListRequestQuerySchema.safeParse({
      search: "people",
      sortBy: "name",
      sortOrder: "asc",
      limit: "10",
      offset: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe("people");
      expect(result.data.sortBy).toBe("name");
    }
  });

  it("should apply defaults", () => {
    const result = EntityGroupListRequestQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortBy).toBe("created");
    expect(result.sortOrder).toBe("asc");
  });

  it("should cap limit at 100", () => {
    const result = EntityGroupListRequestQuerySchema.parse({ limit: "200" });
    expect(result.limit).toBe(100);
  });

  it("should accept sortBy name", () => {
    const result = EntityGroupListRequestQuerySchema.parse({ sortBy: "name" });
    expect(result.sortBy).toBe("name");
  });
});

// ── List response ────────────────────────────────────────────────────

describe("EntityGroupListResponsePayloadSchema", () => {
  it("should accept a valid response payload", () => {
    const result = EntityGroupListResponsePayloadSchema.safeParse({
      total: 1,
      limit: 20,
      offset: 0,
      entityGroups: [validEntityGroup],
    });
    expect(result.success).toBe(true);
  });

  it("should accept an empty array", () => {
    const result = EntityGroupListResponsePayloadSchema.safeParse({
      total: 0,
      limit: 20,
      offset: 0,
      entityGroups: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing pagination fields", () => {
    const result = EntityGroupListResponsePayloadSchema.safeParse({
      entityGroups: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── Get response ─────────────────────────────────────────────────────

describe("EntityGroupGetResponsePayloadSchema", () => {
  it("should accept a valid get response with members", () => {
    const result = EntityGroupGetResponsePayloadSchema.safeParse({
      entityGroup: {
        ...validEntityGroup,
        members: [validMemberWithDetails],
      },
    });
    expect(result.success).toBe(true);
  });

  it("should accept a group with empty members array", () => {
    const result = EntityGroupGetResponsePayloadSchema.safeParse({
      entityGroup: {
        ...validEntityGroup,
        members: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing entityGroup", () => {
    const result = EntityGroupGetResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Create request body ──────────────────────────────────────────────

describe("EntityGroupCreateRequestBodySchema", () => {
  it("should accept valid input", () => {
    const result = EntityGroupCreateRequestBodySchema.safeParse({
      name: "People",
      description: "Identity group",
    });
    expect(result.success).toBe(true);
  });

  it("should accept name only (description optional)", () => {
    const result = EntityGroupCreateRequestBodySchema.safeParse({
      name: "People",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const result = EntityGroupCreateRequestBodySchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing name", () => {
    const result = EntityGroupCreateRequestBodySchema.safeParse({
      description: "A group",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("EntityGroupCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = EntityGroupCreateResponsePayloadSchema.safeParse({
      entityGroup: validEntityGroup,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("EntityGroupUpdateRequestBodySchema", () => {
  it("should accept partial update with name only", () => {
    const result = EntityGroupUpdateRequestBodySchema.safeParse({
      name: "Renamed",
    });
    expect(result.success).toBe(true);
  });

  it("should accept partial update with description only", () => {
    const result = EntityGroupUpdateRequestBodySchema.safeParse({
      description: "New desc",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty object (at least one field required)", () => {
    const result = EntityGroupUpdateRequestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = EntityGroupUpdateRequestBodySchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("EntityGroupUpdateResponsePayloadSchema", () => {
  it("should accept a valid update response", () => {
    const result = EntityGroupUpdateResponsePayloadSchema.safeParse({
      entityGroup: validEntityGroup,
    });
    expect(result.success).toBe(true);
  });
});
