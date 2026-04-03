import {
  ColumnDefinitionSummarySchema,
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
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── ColumnDefinitionSummarySchema ────────────────────────────────────

describe("ColumnDefinitionSummarySchema", () => {
  it("should accept enriched fields", () => {
    const result = ColumnDefinitionSummarySchema.safeParse({
      key: "name",
      label: "Name",
      type: "string",
      required: true,
      enumValues: null,
      defaultValue: null,
    });
    expect(result.success).toBe(true);
  });

  it("should accept non-null enumValues and defaultValue", () => {
    const result = ColumnDefinitionSummarySchema.safeParse({
      key: "status",
      label: "Status",
      type: "enum",
      required: false,
      enumValues: ["active", "inactive"],
      defaultValue: "active",
    });
    expect(result.success).toBe(true);
  });

  it("should reject payload missing required field", () => {
    const result = ColumnDefinitionSummarySchema.safeParse({
      key: "name",
      label: "Name",
      type: "string",
      enumValues: null,
      defaultValue: null,
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
