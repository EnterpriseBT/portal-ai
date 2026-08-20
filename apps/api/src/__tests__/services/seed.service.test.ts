/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { ColumnDataType } from "@portalai/core/models";

const VALID_COLUMN_DATA_TYPES: ColumnDataType[] = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "array",
  "reference",
  "reference-array",
  "geometry",
];

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// Mock DbService before importing SeedService
const mockUpsertByKey = jest.fn<any>().mockResolvedValue({});
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: {
        upsertByKey: mockUpsertByKey,
      },
      connectorDefinitions: {
        upsertManyBySlug: jest.fn<any>().mockResolvedValue(undefined),
      },
    },
    createTransactionClient: jest.fn<any>().mockResolvedValue({
      tx: {},
      commit: jest.fn(),
      rollback: jest.fn(),
    }),
  },
}));

const { SYSTEM_COLUMN_DEFINITIONS, SeedService } =
  await import("../../services/seed.service.js");

describe("SYSTEM_COLUMN_DEFINITIONS", () => {
  it("should have 29 entries", () => {
    expect(SYSTEM_COLUMN_DEFINITIONS).toHaveLength(29);
  });

  it("should have required fields on every entry", () => {
    for (const entry of SYSTEM_COLUMN_DEFINITIONS) {
      expect(entry).toHaveProperty("key");
      expect(entry).toHaveProperty("label");
      expect(entry).toHaveProperty("type");
      expect(entry).toHaveProperty("description");
      expect(entry).toHaveProperty("validationPattern");
      expect(entry).toHaveProperty("validationMessage");
      expect(entry).toHaveProperty("canonicalFormat");

      expect(typeof entry.key).toBe("string");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.description).toBe("string");
    }
  });

  it("should have all unique keys", () => {
    const keys = SYSTEM_COLUMN_DEFINITIONS.map((d: { key: string }) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("should have keys matching /^[a-z][a-z0-9_]*$/", () => {
    for (const entry of SYSTEM_COLUMN_DEFINITIONS) {
      expect(entry.key).toMatch(KEY_PATTERN);
    }
  });

  it("should have valid ColumnDataType values for all types", () => {
    for (const entry of SYSTEM_COLUMN_DEFINITIONS) {
      expect(VALID_COLUMN_DATA_TYPES).toContain(entry.type);
    }
  });
});

describe("SeedService.seedSystemColumnDefinitions", () => {
  let seedService: InstanceType<typeof SeedService>;
  const fakeDb = {} as never;

  beforeEach(() => {
    mockUpsertByKey.mockClear();
    seedService = new SeedService();
  });

  it("should call upsertByKey for each definition", async () => {
    await seedService.seedSystemColumnDefinitions("org-123", fakeDb);

    expect(mockUpsertByKey).toHaveBeenCalledTimes(29);
  });

  it("marks every seeded row with system: true", async () => {
    await seedService.seedSystemColumnDefinitions("org-123", fakeDb);

    const calls = mockUpsertByKey.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [arg] of calls) {
      expect((arg as { system: boolean }).system).toBe(true);
    }
  });

  // #414: the geospatial trio is the set that stranded on pre-#316 orgs, and
  // `geoRole` is the field `upsertByKey` used to drop. Pin the payload here;
  // the `set`-clause convergence is covered in the integration suite.
  it("sends an explicit geoRole on every definition, keyed correctly for the geo trio", async () => {
    await seedService.seedSystemColumnDefinitions("org-123", fakeDb);

    const payloads = mockUpsertByKey.mock.calls.map(
      ([arg]) => arg as { key: string; type: string; geoRole: string | null }
    );
    const byKey = new Map(payloads.map((p) => [p.key, p]));

    // Never undefined — an absent key and an explicit null are different
    // instructions to the upsert.
    for (const p of payloads) {
      expect(p.geoRole === null || typeof p.geoRole === "string").toBe(true);
    }

    expect(byKey.get("geometry")).toMatchObject({
      type: "geometry",
      geoRole: null,
    });
    expect(byKey.get("latitude")).toMatchObject({
      type: "number",
      geoRole: "lat",
    });
    expect(byKey.get("longitude")).toMatchObject({
      type: "number",
      geoRole: "lng",
    });
  });
});
