import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";

// ── DbService mock ───────────────────────────────────────────────────

const findByInstanceMock =
  jest.fn<
    (
      connectorInstanceId: string
    ) => Promise<
      Array<{
        entity: { id: string; key: string; label: string };
        config: {
          path: string;
          method: "GET" | "POST";
          recordsPath: string;
          idField: string | null;
        };
      }>
    >
  >();
const findBySourceIdsMock =
  jest.fn<
    (
      connectorEntityId: string,
      sourceIds: string[]
    ) => Promise<Array<{ id: string; checksum: string; createdBy: string; created: number }>>
  >();
const upsertBySourceIdMock = jest.fn<(data: unknown) => Promise<unknown>>();
const bulkUpdateSyncedAtMock =
  jest.fn<(ids: string[], syncedAt: number) => Promise<number>>();
const softDeleteBeforeWatermarkMock =
  jest.fn<
    (
      connectorEntityId: string,
      runStartedAt: number,
      userId: string
    ) => Promise<string[]>
  >();
const updateInstanceMock =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      apiEndpoints: { findByInstance: findByInstanceMock },
      entityRecords: {
        findBySourceIds: findBySourceIdsMock,
        upsertBySourceId: upsertBySourceIdMock,
        bulkUpdateSyncedAt: bulkUpdateSyncedAtMock,
        softDeleteBeforeWatermark: softDeleteBeforeWatermarkMock,
      },
      connectorInstances: { update: updateInstanceMock },
    },
  },
}));

const {
  restApiAdapter,
  walkRecordsPath,
  assertRecordsArray,
  buildUrl,
  deriveSourceId,
} = await import("../../../adapters/rest-api/rest-api.adapter.js");

const INSTANCE = {
  id: "ci-rest-1",
  organizationId: "org-1",
  connectorDefinitionId: "def-rest-api",
  name: "My REST API",
  status: "active" as const,
  config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
  credentials: null,
  lastSyncAt: null,
  lastErrorMessage: null,
  enabledCapabilityFlags: null,
  created: 1,
  createdBy: "u1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

beforeEach(() => {
  findByInstanceMock.mockReset();
  findBySourceIdsMock.mockReset();
  upsertBySourceIdMock.mockReset();
  bulkUpdateSyncedAtMock.mockReset();
  softDeleteBeforeWatermarkMock.mockReset();
  updateInstanceMock.mockReset();
});

// ── Pure helpers ─────────────────────────────────────────────────────

describe("walkRecordsPath", () => {
  it("returns the body when path is empty", () => {
    expect(walkRecordsPath([1, 2, 3], "")).toEqual([1, 2, 3]);
  });

  it("walks single-level path", () => {
    expect(walkRecordsPath({ data: [1, 2] }, "data")).toEqual([1, 2]);
  });

  it("walks nested dotted path", () => {
    expect(
      walkRecordsPath({ a: { b: { c: "x" } } }, "a.b.c")
    ).toBe("x");
  });

  it("throws REST_API_RECORDS_PATH_NOT_FOUND when segment is missing", () => {
    expect(() => walkRecordsPath({ a: 1 }, "a.b")).toThrow(
      expect.objectContaining({ code: ApiCode.REST_API_RECORDS_PATH_NOT_FOUND })
    );
  });

  it("throws REST_API_RECORDS_PATH_NOT_FOUND when top-level key is missing", () => {
    expect(() => walkRecordsPath({ a: 1 }, "b")).toThrow(
      expect.objectContaining({ code: ApiCode.REST_API_RECORDS_PATH_NOT_FOUND })
    );
  });
});

describe("assertRecordsArray", () => {
  it("returns the array when value is an array", () => {
    expect(assertRecordsArray([1, 2], "x")).toEqual([1, 2]);
  });

  it("throws REST_API_RECORDS_PATH_NOT_ARRAY when value is an object", () => {
    expect(() => assertRecordsArray({}, "data")).toThrow(
      expect.objectContaining({ code: ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY })
    );
  });

  it("throws REST_API_RECORDS_PATH_NOT_ARRAY when value is a primitive", () => {
    expect(() => assertRecordsArray("hello", "data")).toThrow(
      expect.objectContaining({ code: ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY })
    );
  });
});

describe("buildUrl", () => {
  it("joins baseUrl + path cleanly", () => {
    expect(buildUrl("https://api.example.com", "/users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("trims trailing slash on baseUrl", () => {
    expect(buildUrl("https://api.example.com/", "/users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("ensures leading slash on path", () => {
    expect(buildUrl("https://api.example.com", "users")).toBe(
      "https://api.example.com/users"
    );
  });

  it("appends query params", () => {
    expect(
      buildUrl("https://api.example.com", "/users", { active: "true", limit: "10" })
    ).toBe("https://api.example.com/users?active=true&limit=10");
  });
});

describe("deriveSourceId", () => {
  it("uses record[idField] when set and non-empty", () => {
    expect(deriveSourceId({ id: "abc" }, "id", 1, 0)).toBe("abc");
  });

  it("coerces numeric idField to string", () => {
    expect(deriveSourceId({ id: 42 }, "id", 1, 0)).toBe("42");
  });

  it("falls back to synthetic when idField is unset", () => {
    expect(deriveSourceId({ id: "abc" }, null, 1234, 5)).toBe("api:1234:5");
  });

  it("falls back to synthetic when record[idField] is null", () => {
    expect(deriveSourceId({ id: null }, "id", 1234, 5)).toBe("api:1234:5");
  });

  it("falls back to synthetic when record[idField] is empty string", () => {
    expect(deriveSourceId({ id: "" }, "id", 1234, 5)).toBe("api:1234:5");
  });
});

// ── Adapter surface ──────────────────────────────────────────────────

describe("restApiAdapter.discoverColumns", () => {
  it("returns empty array in phase 1 (probe lands in phase 4)", async () => {
    const cols = await restApiAdapter.discoverColumns(INSTANCE, "users");
    expect(cols).toEqual([]);
  });
});

describe("restApiAdapter.discoverEntities", () => {
  it("returns one DiscoveredEntity per configured endpoint", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id" },
      },
      {
        entity: { id: "e2", key: "posts", label: "Posts" },
        config: { path: "/posts", method: "GET", recordsPath: "data", idField: null },
      },
    ]);

    const entities = await restApiAdapter.discoverEntities(INSTANCE);
    expect(entities).toEqual([
      { key: "users", label: "Users" },
      { key: "posts", label: "Posts" },
    ]);
  });

  it("returns empty array when no endpoints are configured", async () => {
    findByInstanceMock.mockResolvedValueOnce([]);
    const entities = await restApiAdapter.discoverEntities(INSTANCE);
    expect(entities).toEqual([]);
  });
});

describe("restApiAdapter.assertSyncEligibility", () => {
  it("returns ok: false REST_API_NO_ENDPOINTS_CONFIGURED when no endpoints", async () => {
    findByInstanceMock.mockResolvedValueOnce([]);
    const result = await restApiAdapter.assertSyncEligibility!(INSTANCE);
    expect(result).toEqual({
      ok: false,
      reasonCode: ApiCode.REST_API_NO_ENDPOINTS_CONFIGURED,
      reason: expect.any(String),
    });
  });

  it("returns ok: true when at least one endpoint exists (none-auth)", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id" },
      },
    ]);
    const result = await restApiAdapter.assertSyncEligibility!(INSTANCE);
    expect(result).toEqual({ ok: true });
  });
});
