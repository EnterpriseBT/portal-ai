import {
  ResolvedColumnSchema,
  EntityRecordCreateRequestBodySchema,
  EntityRecordCreateResponsePayloadSchema,
} from "../../contracts/entity-record.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validRecord = {
  id: "rec-1",
  organizationId: "org-1",
  connectorEntityId: "ce-1",
  data: { name: "Alice" },
  normalizedData: { name: "Alice" },
  sourceId: "src-1",
  checksum: "abc123",
  syncedAt: Date.now(),
  validationErrors: null,
  isValid: true,
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── ResolvedColumnSchema ────────────────────────────────────

describe("ResolvedColumnSchema", () => {
  it("should accept all fields including normalizedKey and format", () => {
    const result = ResolvedColumnSchema.safeParse({
      key: "name",
      label: "Name",
      type: "string",
      normalizedKey: "name",
      required: true,
      enumValues: null,
      defaultValue: null,
      format: null,
      validationPattern: null,
      canonicalFormat: null,
    });
    expect(result.success).toBe(true);
  });

  it("should accept non-null enumValues, defaultValue, and format", () => {
    const result = ResolvedColumnSchema.safeParse({
      key: "status",
      label: "Status",
      type: "enum",
      normalizedKey: "account_status",
      required: false,
      enumValues: ["active", "inactive"],
      defaultValue: "active",
      format: "lowercase",
      validationPattern: null,
      canonicalFormat: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject payload missing required field", () => {
    const result = ResolvedColumnSchema.safeParse({
      key: "name",
      label: "Name",
      type: "string",
      normalizedKey: "name",
      enumValues: null,
      defaultValue: null,
      format: null,
      validationPattern: null,
      canonicalFormat: null,
    });
    // missing 'required'
    expect(result.success).toBe(false);
  });

  it("should reject payload missing normalizedKey", () => {
    const result = ResolvedColumnSchema.safeParse({
      key: "name",
      label: "Name",
      type: "string",
      required: true,
      enumValues: null,
      defaultValue: null,
      format: null,
      validationPattern: null,
      canonicalFormat: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── EntityRecordCreateRequestBodySchema ──────────────────────────────

describe("EntityRecordCreateRequestBodySchema", () => {
  it("should accept normalizedData only", () => {
    const result = EntityRecordCreateRequestBodySchema.safeParse({
      normalizedData: { name: "Alice" },
    });
    expect(result.success).toBe(true);
  });

  it("should accept normalizedData with sourceId", () => {
    const result = EntityRecordCreateRequestBodySchema.safeParse({
      normalizedData: { name: "Alice" },
      sourceId: "custom-123",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty body", () => {
    const result = EntityRecordCreateRequestBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── EntityRecordCreateResponsePayloadSchema ──────────────────────────

describe("EntityRecordCreateResponsePayloadSchema", () => {
  it("should validate full record shape", () => {
    const result = EntityRecordCreateResponsePayloadSchema.safeParse({
      record: validRecord,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing record", () => {
    const result = EntityRecordCreateResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
