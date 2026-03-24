import {
  EntityGroupMemberCreateRequestBodySchema,
  EntityGroupMemberCreateResponsePayloadSchema,
  EntityGroupMemberUpdateRequestBodySchema,
  EntityGroupMemberUpdateResponsePayloadSchema,
  EntityGroupMemberOverlapResponsePayloadSchema,
  EntityGroupResolveResponsePayloadSchema,
} from "../../contracts/entity-group-member.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validMember = {
  id: "egm-1",
  organizationId: "org-1",
  entityGroupId: "eg-1",
  connectorEntityId: "ce-1",
  linkFieldMappingId: "fm-1",
  isPrimary: false,
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const validRecord = {
  id: "er-1",
  organizationId: "org-1",
  connectorEntityId: "ce-1",
  data: { email: "test@example.com" },
  normalizedData: { email: "test@example.com" },
  sourceId: "src-1",
  checksum: "abc123",
  syncedAt: Date.now(),
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Create request body ──────────────────────────────────────────────

describe("EntityGroupMemberCreateRequestBodySchema", () => {
  it("should accept valid input", () => {
    const result = EntityGroupMemberCreateRequestBodySchema.safeParse({
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
    });
    expect(result.success).toBe(true);
  });

  it("should default isPrimary to false", () => {
    const result = EntityGroupMemberCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
    });
    expect(result.isPrimary).toBe(false);
  });

  it("should accept isPrimary true", () => {
    const result = EntityGroupMemberCreateRequestBodySchema.parse({
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
      isPrimary: true,
    });
    expect(result.isPrimary).toBe(true);
  });

  it("should reject missing connectorEntityId", () => {
    const result = EntityGroupMemberCreateRequestBodySchema.safeParse({
      linkFieldMappingId: "fm-1",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing linkFieldMappingId", () => {
    const result = EntityGroupMemberCreateRequestBodySchema.safeParse({
      connectorEntityId: "ce-1",
    });
    expect(result.success).toBe(false);
  });
});

// ── Create response ──────────────────────────────────────────────────

describe("EntityGroupMemberCreateResponsePayloadSchema", () => {
  it("should accept a valid create response", () => {
    const result = EntityGroupMemberCreateResponsePayloadSchema.safeParse({
      entityGroupMember: validMember,
    });
    expect(result.success).toBe(true);
  });
});

// ── Update request body ──────────────────────────────────────────────

describe("EntityGroupMemberUpdateRequestBodySchema", () => {
  it("should accept partial update with linkFieldMappingId", () => {
    const result = EntityGroupMemberUpdateRequestBodySchema.safeParse({
      linkFieldMappingId: "fm-2",
    });
    expect(result.success).toBe(true);
  });

  it("should accept partial update with isPrimary", () => {
    const result = EntityGroupMemberUpdateRequestBodySchema.safeParse({
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty object (at least one field required)", () => {
    const result = EntityGroupMemberUpdateRequestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Update response ──────────────────────────────────────────────────

describe("EntityGroupMemberUpdateResponsePayloadSchema", () => {
  it("should accept a valid update response", () => {
    const result = EntityGroupMemberUpdateResponsePayloadSchema.safeParse({
      entityGroupMember: validMember,
    });
    expect(result.success).toBe(true);
  });
});

// ── Overlap response ─────────────────────────────────────────────────

describe("EntityGroupMemberOverlapResponsePayloadSchema", () => {
  it("should accept valid overlap data", () => {
    const result = EntityGroupMemberOverlapResponsePayloadSchema.safeParse({
      overlapPercentage: 72.5,
      sourceRecordCount: 200,
      targetRecordCount: 300,
      matchingRecordCount: 145,
    });
    expect(result.success).toBe(true);
  });

  it("should accept 0% overlap", () => {
    const result = EntityGroupMemberOverlapResponsePayloadSchema.safeParse({
      overlapPercentage: 0,
      sourceRecordCount: 100,
      targetRecordCount: 100,
      matchingRecordCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should accept 100% overlap", () => {
    const result = EntityGroupMemberOverlapResponsePayloadSchema.safeParse({
      overlapPercentage: 100,
      sourceRecordCount: 50,
      targetRecordCount: 50,
      matchingRecordCount: 50,
    });
    expect(result.success).toBe(true);
  });

  it("should reject percentage above 100", () => {
    const result = EntityGroupMemberOverlapResponsePayloadSchema.safeParse({
      overlapPercentage: 101,
      sourceRecordCount: 50,
      targetRecordCount: 50,
      matchingRecordCount: 50,
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative percentage", () => {
    const result = EntityGroupMemberOverlapResponsePayloadSchema.safeParse({
      overlapPercentage: -1,
      sourceRecordCount: 50,
      targetRecordCount: 50,
      matchingRecordCount: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ── Resolve response ─────────────────────────────────────────────────

describe("EntityGroupResolveResponsePayloadSchema", () => {
  it("should accept valid resolve response with nested records", () => {
    const result = EntityGroupResolveResponsePayloadSchema.safeParse({
      results: [
        {
          connectorEntityId: "ce-1",
          connectorEntityLabel: "Employees",
          isPrimary: true,
          records: [validRecord],
        },
        {
          connectorEntityId: "ce-2",
          connectorEntityLabel: "HubSpot Contacts",
          isPrimary: false,
          records: [validRecord],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty results array", () => {
    const result = EntityGroupResolveResponsePayloadSchema.safeParse({
      results: [],
    });
    expect(result.success).toBe(true);
  });

  it("should accept results with empty records arrays", () => {
    const result = EntityGroupResolveResponsePayloadSchema.safeParse({
      results: [
        {
          connectorEntityId: "ce-1",
          connectorEntityLabel: "Employees",
          isPrimary: true,
          records: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing connectorEntityLabel in result", () => {
    const result = EntityGroupResolveResponsePayloadSchema.safeParse({
      results: [
        {
          connectorEntityId: "ce-1",
          isPrimary: true,
          records: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
