import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      fieldMappings: {
        findMany: mockFindMany,
      },
    },
  },
}));

// Mock the schema import used by the service for the `eq()` call
jest.unstable_mockModule("../../db/schema/index.js", () => ({
  fieldMappings: { connectorEntityId: "connectorEntityId" },
}));

const { NormalizationService } = await import(
  "../../services/normalization.service.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    connectorEntityId: "ce-1",
    sourceField: "Name",
    normalizedKey: "name",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: {
      key: "name",
      type: "string",
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NormalizationService.normalize", () => {
  it("normalizes data through field mappings using normalizedKey", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Full Name", normalizedKey: "full_name" }),
      mapping({
        sourceField: "Email Address",
        normalizedKey: "email",
        columnDefinition: { key: "email", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null },
      }),
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      "Full Name": "Jane Doe",
      "Email Address": "jane@example.com",
    });

    expect(result.normalizedData).toEqual({ full_name: "Jane Doe", email: "jane@example.com" });
    expect(result.isValid).toBe(true);
    expect(result.validationErrors).toBeNull();
  });

  it("omits unmapped source fields", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Name", normalizedKey: "name" }),
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      Name: "Jane",
      Extra: "should be omitted",
    });

    expect(result.normalizedData).toEqual({ name: "Jane" });
    expect(result.normalizedData).not.toHaveProperty("Extra");
  });

  it("passes through data when no field mappings exist", async () => {
    mockFindMany.mockResolvedValue([]);

    const data = { foo: "bar", baz: 42 };
    const result = await NormalizationService.normalize("ce-1", data);

    expect(result.normalizedData).toEqual(data);
    expect(result.isValid).toBe(true);
    expect(result.validationErrors).toBeNull();
  });

  it("sets null for missing non-required source fields", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Name", normalizedKey: "name" }),
      mapping({ sourceField: "Missing", normalizedKey: "missing_col", columnDefinition: { key: "missing_col", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      Name: "Jane",
    });

    expect(result.normalizedData).toEqual({ name: "Jane", missing_col: null });
    expect(result.isValid).toBe(true);
  });

  it("records validation error for missing required field", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Email", normalizedKey: "email", required: true, columnDefinition: { key: "email", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", {});

    expect(result.isValid).toBe(false);
    expect(result.validationErrors).toEqual([
      { field: "email", error: "Required field is missing" },
    ]);
    expect(result.normalizedData.email).toBeNull();
  });

  it("applies defaultValue when source is null", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Status", normalizedKey: "status", defaultValue: "active", columnDefinition: { key: "status", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Status: null });

    expect(result.normalizedData.status).toBe("active");
    expect(result.isValid).toBe(true);
  });

  it("applies defaultValue for required field — no error", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Status", normalizedKey: "status", required: true, defaultValue: "pending", columnDefinition: { key: "status", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", {});

    expect(result.normalizedData.status).toBe("pending");
    expect(result.isValid).toBe(true);
  });

  it("coerces number from string", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Amount", normalizedKey: "amount", columnDefinition: { key: "amount", type: "number", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Amount: "$1,234" });

    expect(result.normalizedData.amount).toBe(1234);
    expect(result.isValid).toBe(true);
  });

  it("records coercion error for invalid number", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Amount", normalizedKey: "amount", columnDefinition: { key: "amount", type: "number", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Amount: "abc" });

    expect(result.isValid).toBe(false);
    expect(result.validationErrors![0].field).toBe("amount");
    expect(result.normalizedData.amount).toBeNull();
  });

  it("coerces boolean from string", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Active", normalizedKey: "active", columnDefinition: { key: "active", type: "boolean", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Active: "yes" });

    expect(result.normalizedData.active).toBe(true);
  });

  it("coerces boolean with custom format labels", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Active", normalizedKey: "active", format: "active:inactive", columnDefinition: { key: "active", type: "boolean", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Active: "inactive" });

    expect(result.normalizedData.active).toBe(false);
  });

  it("coerces date with format hint", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "DOB", normalizedKey: "dob", format: "MM/dd/yyyy", columnDefinition: { key: "dob", type: "date", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { DOB: "01/15/2024" });

    expect(result.normalizedData.dob).toBe("2024-01-15");
  });

  it("validates enum values", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Status", normalizedKey: "status", enumValues: ["active", "inactive"], columnDefinition: { key: "status", type: "enum", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Status: "unknown" });

    expect(result.isValid).toBe(false);
    expect(result.validationErrors![0].field).toBe("status");
    expect(result.validationErrors![0].error).toContain("not one of");
  });

  it("validates pattern with custom message", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Email", normalizedKey: "email", columnDefinition: { key: "email", type: "string", validationPattern: "^.+@.+\\..+$", validationMessage: "Must be a valid email", canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Email: "bad" });

    expect(result.isValid).toBe(false);
    expect(result.validationErrors![0]).toEqual({ field: "email", error: "Must be a valid email" });
  });

  it("applies canonicalFormat for string type", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Email", normalizedKey: "email", columnDefinition: { key: "email", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: "lowercase" } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Email: "JANE@EXAMPLE.COM" });

    expect(result.normalizedData.email).toBe("jane@example.com");
  });

  it("collects multiple errors across fields", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Email", normalizedKey: "email", required: true, columnDefinition: { key: "email", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
      mapping({ sourceField: "Amount", normalizedKey: "amount", columnDefinition: { key: "amount", type: "number", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Amount: "abc" });

    expect(result.isValid).toBe(false);
    expect(result.validationErrors).toHaveLength(2);
    expect(result.validationErrors!.map((e) => e.field).sort()).toEqual(["amount", "email"]);
  });

  it("stores coerced value even when validation fails (enum/pattern)", async () => {
    mockFindMany.mockResolvedValue([
      mapping({ sourceField: "Code", normalizedKey: "code", enumValues: ["A", "B"], columnDefinition: { key: "code", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null } }),
    ]);

    const result = await NormalizationService.normalize("ce-1", { Code: "C" });

    // Value is stored even though enum validation failed
    expect(result.normalizedData.code).toBe("C");
    expect(result.isValid).toBe(false);
  });
});
