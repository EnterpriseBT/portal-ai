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

const { NormalizationService } = await import(
  "../../services/normalization.service.js"
);

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
  it("normalizes data through field mappings", async () => {
    mockFindMany.mockResolvedValue([
      {
        connectorEntityId: "ce-1",
        sourceField: "Full Name",
        columnDefinition: { key: "name" },
      },
      {
        connectorEntityId: "ce-1",
        sourceField: "Email Address",
        columnDefinition: { key: "email" },
      },
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      "Full Name": "Jane Doe",
      "Email Address": "jane@example.com",
    });

    expect(result).toEqual({ name: "Jane Doe", email: "jane@example.com" });
  });

  it("omits unmapped source fields", async () => {
    mockFindMany.mockResolvedValue([
      {
        connectorEntityId: "ce-1",
        sourceField: "Name",
        columnDefinition: { key: "name" },
      },
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      Name: "Jane",
      Extra: "should be omitted",
    });

    expect(result).toEqual({ name: "Jane" });
    expect(result).not.toHaveProperty("Extra");
  });

  it("passes through data when no field mappings exist", async () => {
    mockFindMany.mockResolvedValue([]);

    const data = { foo: "bar", baz: 42 };
    const result = await NormalizationService.normalize("ce-1", data);

    expect(result).toEqual(data);
  });

  it("handles missing source fields gracefully", async () => {
    mockFindMany.mockResolvedValue([
      {
        connectorEntityId: "ce-1",
        sourceField: "Name",
        columnDefinition: { key: "name" },
      },
      {
        connectorEntityId: "ce-1",
        sourceField: "Missing",
        columnDefinition: { key: "missing_col" },
      },
    ]);

    const result = await NormalizationService.normalize("ce-1", {
      Name: "Jane",
    });

    expect(result).toEqual({ name: "Jane" });
    expect(result).not.toHaveProperty("missing_col");
  });
});
