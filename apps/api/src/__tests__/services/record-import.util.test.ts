import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindBySourceIds = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockUpsertManyBySourceId = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockFieldMappingsFindMany = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        findBySourceIds: mockFindBySourceIds,
        upsertManyBySourceId: mockUpsertManyBySourceId,
      },
      fieldMappings: {
        findMany: mockFieldMappingsFindMany,
      },
    },
  },
}));

jest.unstable_mockModule("../../db/schema/index.js", () => ({
  fieldMappings: { connectorEntityId: "connectorEntityId" },
}));

const { importRows } = await import("../../services/record-import.util.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTITY_ID = "ce-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";

const FIELD_MAPPINGS = [
  {
    connectorEntityId: ENTITY_ID,
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
  },
  {
    connectorEntityId: ENTITY_ID,
    sourceField: "Email",
    normalizedKey: "email",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: {
      key: "email",
      type: "string",
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
    },
  },
];

function params() {
  return {
    connectorEntityId: ENTITY_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
  };
}

async function* asyncFrom<T>(arr: T[]): AsyncIterable<T> {
  for (const item of arr) yield item;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("importRows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindBySourceIds.mockResolvedValue([]);
    mockUpsertManyBySourceId.mockResolvedValue([]);
    mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS);
  });

  it("consumes an async iterable and upserts rows to DB", async () => {
    const rows = asyncFrom([
      { Name: "Alice", Email: "a@x.com" },
      { Name: "Bob", Email: "b@x.com" },
    ]);

    const result = await importRows(rows, params());

    expect(result).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      invalid: 0,
    });
    expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(1);
    const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(upserted).toHaveLength(2);
    expect(upserted[0].data).toEqual({ Name: "Alice", Email: "a@x.com" });
    expect(upserted[0].sourceId).toBe("0");
    expect(upserted[1].sourceId).toBe("1");
    expect(upserted[0].origin).toBe("sync");
  });

  it("uses row index as sourceId", async () => {
    const rows = asyncFrom([
      { Name: "A", Email: "a@x.com" },
      { Name: "B", Email: "b@x.com" },
      { Name: "C", Email: "c@x.com" },
    ]);
    await importRows(rows, params());
    const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(upserted.map((r) => r.sourceId)).toEqual(["0", "1", "2"]);
  });

  it("computes SHA-256 checksums that are deterministic per row", async () => {
    const row = { Name: "Alice", Email: "a@x.com" };
    await importRows(asyncFrom([row]), params());
    const first = (
      mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >
    )[0].checksum;

    jest.clearAllMocks();
    mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS);
    mockFindBySourceIds.mockResolvedValue([]);
    mockUpsertManyBySourceId.mockResolvedValue([]);

    await importRows(asyncFrom([row]), params());
    const second = (
      mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >
    )[0].checksum;

    expect(first).toBe(second);
    expect(typeof first).toBe("string");
    expect((first as string).length).toBeGreaterThan(0);
  });

  it("flushes batches of 500 rows (calls upsert once per batch)", async () => {
    const big: Record<string, string>[] = [];
    for (let i = 0; i < 1200; i++)
      big.push({ Name: `n${i}`, Email: `${i}@x.com` });

    const result = await importRows(asyncFrom(big), params());

    expect(result.created).toBe(1200);
    // 1200 rows → 500 + 500 + 200 → 3 upsert calls
    expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(3);
    const sizes = mockUpsertManyBySourceId.mock.calls.map(
      (c) => (c[0] as unknown[]).length
    );
    expect(sizes).toEqual([500, 500, 200]);
  });

  it("flushes the final partial batch after the iterable ends", async () => {
    const rows = asyncFrom([
      { Name: "Alice", Email: "a@x.com" },
      { Name: "Bob", Email: "b@x.com" },
      { Name: "Carol", Email: "c@x.com" },
    ]);
    await importRows(rows, params());
    expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(1);
    expect(
      (mockUpsertManyBySourceId.mock.calls[0][0] as unknown[]).length
    ).toBe(3);
  });

  it("handles empty iterable (no DB calls, all-zero counts)", async () => {
    const result = await importRows(asyncFrom([]), params());
    expect(result).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
    });
    expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
  });

  it("skips unchanged rows (matching checksum, counted as unchanged)", async () => {
    const row = { Name: "Alice", Email: "a@x.com" };

    // First import to discover the real checksum
    await importRows(asyncFrom([row]), params());
    const checksum = (
      mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >
    )[0].checksum as string;

    jest.clearAllMocks();
    mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS);
    mockUpsertManyBySourceId.mockResolvedValue([]);
    mockFindBySourceIds.mockResolvedValue([
      { sourceId: "0", checksum, id: "existing" },
    ]);

    const result = await importRows(asyncFrom([row]), params());
    expect(result.unchanged).toBe(1);
    expect(result.created).toBe(0);
    expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
  });

  it("marks rows as updated when checksum differs from existing", async () => {
    mockFindBySourceIds.mockResolvedValue([
      { sourceId: "0", checksum: "old", id: "existing" },
    ]);
    const rows = asyncFrom([{ Name: "Alice", Email: "a@x.com" }]);
    const result = await importRows(rows, params());
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it("persists validationErrors and isValid from normalization", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([
      {
        connectorEntityId: ENTITY_ID,
        sourceField: "Name",
        normalizedKey: "name",
        required: true,
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
      },
    ]);

    const rows = asyncFrom([
      { Name: "Alice", Other: "x" },
      { Name: "", Other: "y" },
    ]);

    const result = await importRows(rows, params());
    expect(result.invalid).toBe(1);

    const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(upserted[0].isValid).toBe(true);
    expect(upserted[1].isValid).toBe(false);
  });

  it("fetches field mappings exactly once regardless of row count", async () => {
    const rows = asyncFrom(
      Array.from({ length: 100 }, (_, i) => ({
        Name: `n${i}`,
        Email: `${i}@x.com`,
      }))
    );
    await importRows(rows, params());
    expect(mockFieldMappingsFindMany).toHaveBeenCalledTimes(1);
  });

  it("propagates DB errors (does not swallow upsert failures)", async () => {
    mockUpsertManyBySourceId.mockRejectedValueOnce(
      new Error("DB connection lost")
    );
    const rows = asyncFrom([{ Name: "A", Email: "a@x.com" }]);
    await expect(importRows(rows, params())).rejects.toThrow(
      "DB connection lost"
    );
  });

  it("does not pre-materialize the full iterable (verifies streaming)", async () => {
    let yieldedBeforeFlush = 0;
    let upsertCalled = false;
    mockUpsertManyBySourceId.mockImplementation(async () => {
      upsertCalled = true;
      return [];
    });

    async function* spyIter(): AsyncIterable<Record<string, string>> {
      for (let i = 0; i < 700; i++) {
        if (!upsertCalled) yieldedBeforeFlush++;
        yield { Name: `n${i}`, Email: `${i}@x.com` };
      }
    }

    await importRows(spyIter(), params());
    // The first batch flushes at 500; rows yielded before that must be <=500 (not the full 700)
    expect(yieldedBeforeFlush).toBeLessThanOrEqual(500);
    expect(yieldedBeforeFlush).toBeGreaterThan(0);
  });
});
