import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";

// ── DbService mock ───────────────────────────────────────────────────

type EndpointFixture = {
  entity: {
    id: string;
    key: string;
    label: string;
    connectorInstanceId?: string;
  };
  config: {
    path: string;
    method: "GET" | "POST";
    recordsPath: string;
    idField: string | null;
    headers?: Record<string, string> | null;
    queryParams?: Record<string, string> | null;
  };
};

const findByInstanceMock =
  jest.fn<(connectorInstanceId: string) => Promise<EndpointFixture[]>>();
const findByEntityIdMock =
  jest.fn<(connectorEntityId: string) => Promise<EndpointFixture | null>>();
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
      apiEndpoints: {
        findByInstance: findByInstanceMock,
        findByEntityId: findByEntityIdMock,
      },
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
  findByEntityIdMock.mockReset();
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

  it("returns ok: false REST_API_MISSING_CREDENTIALS for bearer mode with no credentials", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id" },
      },
    ]);
    const result = await restApiAdapter.assertSyncEligibility!({
      ...INSTANCE,
      config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
      credentials: null,
    });
    expect(result).toEqual({
      ok: false,
      reasonCode: ApiCode.REST_API_MISSING_CREDENTIALS,
      reason: expect.any(String),
    });
  });

  it("returns ok: true for bearer mode with a populated token", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id" },
      },
    ]);
    const result = await restApiAdapter.assertSyncEligibility!({
      ...INSTANCE,
      config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
      credentials: { mode: "bearer", token: "tok" } as never,
    });
    expect(result).toEqual({ ok: true });
  });
});

// ── syncInstance auth wiring ─────────────────────────────────────────

describe("restApiAdapter.syncInstance — auth", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<typeof globalThis.fetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    findByInstanceMock.mockResolvedValue([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id" },
      },
    ]);
    findBySourceIdsMock.mockResolvedValue([]);
    upsertBySourceIdMock.mockResolvedValue(undefined);
    bulkUpdateSyncedAtMock.mockResolvedValue(0);
    softDeleteBeforeWatermarkMock.mockResolvedValue([]);
    updateInstanceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const okBody = () =>
    new Response(JSON.stringify([{ id: "u1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("applies apiKey/header auth to every outbound request", async () => {
    fetchMock.mockResolvedValueOnce(okBody());

    await restApiAdapter.syncInstance!(
      {
        ...INSTANCE,
        config: {
          baseUrl: "https://api.example.com",
          auth: { mode: "apiKey", keyName: "X-API-Key", placement: "header" },
        },
        credentials: { mode: "apiKey", value: "secret" } as never,
      },
      "u1"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("secret");
  });

  it("applies apiKey/query auth by appending the param to the url", async () => {
    fetchMock.mockResolvedValueOnce(okBody());

    await restApiAdapter.syncInstance!(
      {
        ...INSTANCE,
        config: {
          baseUrl: "https://api.example.com",
          auth: { mode: "apiKey", keyName: "api_key", placement: "query" },
        },
        credentials: { mode: "apiKey", value: "abc" } as never,
      },
      "u1"
    );

    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get("api_key")).toBe("abc");
  });

  it("applies bearer auth as Authorization: Bearer <token>", async () => {
    fetchMock.mockResolvedValueOnce(okBody());

    await restApiAdapter.syncInstance!(
      {
        ...INSTANCE,
        config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
        credentials: { mode: "bearer", token: "tok" } as never,
      },
      "u1"
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });

  it("applies basic auth as Authorization: Basic <base64(user:pass)>", async () => {
    fetchMock.mockResolvedValueOnce(okBody());

    await restApiAdapter.syncInstance!(
      {
        ...INSTANCE,
        config: { baseUrl: "https://api.example.com", auth: { mode: "basic" } },
        credentials: {
          mode: "basic",
          username: "u",
          password: "p",
        } as never,
      },
      "u1"
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const expected = "Basic " + Buffer.from("u:p", "utf8").toString("base64");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      expected
    );
  });

  it("remaps a 401 from upstream to REST_API_AUTH_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: { "content-type": "text/plain" },
      })
    );

    await expect(
      restApiAdapter.syncInstance!(
        {
          ...INSTANCE,
          config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
          credentials: { mode: "bearer", token: "tok" } as never,
        },
        "u1"
      )
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_AUTH_FAILED,
      details: expect.objectContaining({ status: 401 }),
    });
  });

  it("remaps a 403 from upstream to REST_API_AUTH_FAILED", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("forbidden", {
        status: 403,
        headers: { "content-type": "text/plain" },
      })
    );

    await expect(
      restApiAdapter.syncInstance!(
        {
          ...INSTANCE,
          config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
          credentials: { mode: "bearer", token: "tok" } as never,
        },
        "u1"
      )
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_AUTH_FAILED,
      details: expect.objectContaining({ status: 403 }),
    });
  });

  it("leaves non-auth fetch failures unchanged (500 stays REST_API_FETCH_FAILED)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("oops", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );

    await expect(
      restApiAdapter.syncInstance!(
        {
          ...INSTANCE,
          config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
          credentials: { mode: "bearer", token: "tok" } as never,
        },
        "u1"
      )
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
    });
  });

  it("throws REST_API_AUTH_FAILED on config / credentials mode mismatch", async () => {
    // No fetch should fire — applyAuth rejects before the request.
    fetchMock.mockResolvedValue(okBody());

    await expect(
      restApiAdapter.syncInstance!(
        {
          ...INSTANCE,
          config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
          credentials: { mode: "apiKey", value: "x" } as never,
        },
        "u1"
      )
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_AUTH_FAILED,
      details: expect.objectContaining({
        mismatch: { configMode: "bearer", credentialsMode: "apiKey" },
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── testConnection ────────────────────────────────────────────────────

describe("restApiAdapter.testConnection", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<typeof globalThis.fetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const endpointFixture = (overrides: Partial<EndpointFixture> = {}): EndpointFixture => ({
    entity: {
      id: "ent-users",
      key: "users",
      label: "Users",
      connectorInstanceId: INSTANCE.id,
      ...(overrides.entity ?? {}),
    },
    config: {
      path: "/users",
      method: "GET",
      recordsPath: "",
      idField: "id",
      ...(overrides.config ?? {}),
    },
  });

  it("returns { ok: true, sample } with the first 5 records when more are returned", async () => {
    findByEntityIdMock.mockResolvedValueOnce(endpointFixture());
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: "1" },
          { id: "2" },
          { id: "3" },
          { id: "4" },
          { id: "5" },
          { id: "6" },
          { id: "7" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await restApiAdapter.testConnection!(INSTANCE as never, {
      endpointEntityId: "ent-users",
    });

    expect(result).toEqual({
      ok: true,
      sample: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }],
    });
  });

  it("returns all records as the sample when fewer than 5 are returned", async () => {
    findByEntityIdMock.mockResolvedValueOnce(endpointFixture());
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "1" }, { id: "2" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await restApiAdapter.testConnection!(INSTANCE as never, {
      endpointEntityId: "ent-users",
    });

    expect(result).toEqual({ ok: true, sample: [{ id: "1" }, { id: "2" }] });
  });

  it("returns { ok: false, code: REST_API_AUTH_FAILED } on 401", async () => {
    findByEntityIdMock.mockResolvedValueOnce(endpointFixture());
    fetchMock.mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
        headers: { "content-type": "text/plain" },
      })
    );

    const result = await restApiAdapter.testConnection!(
      {
        ...INSTANCE,
        config: { baseUrl: "https://api.example.com", auth: { mode: "bearer" } },
        credentials: { mode: "bearer", token: "tok" } as never,
      },
      { endpointEntityId: "ent-users" }
    );

    expect(result).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_AUTH_FAILED,
    });
  });

  it("returns { ok: false, code: REST_API_RECORDS_PATH_NOT_ARRAY } when recordsPath resolves to a non-array", async () => {
    findByEntityIdMock.mockResolvedValueOnce(
      endpointFixture({
        config: { path: "/users", method: "GET", recordsPath: "data", idField: null },
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { not: "an array" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await restApiAdapter.testConnection!(INSTANCE as never, {
      endpointEntityId: "ent-users",
    });

    expect(result).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY,
    });
  });

  it("returns { ok: false, code: REST_API_ENDPOINT_NOT_FOUND } when the endpoint isn't configured on the instance", async () => {
    findByEntityIdMock.mockResolvedValueOnce(null);

    const result = await restApiAdapter.testConnection!(INSTANCE as never, {
      endpointEntityId: "missing",
    });

    expect(result).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns { ok: false, code: REST_API_ENDPOINT_NOT_FOUND } when the endpoint belongs to a different instance", async () => {
    findByEntityIdMock.mockResolvedValueOnce(
      endpointFixture({
        entity: {
          id: "ent-users",
          key: "users",
          label: "Users",
          connectorInstanceId: "other-instance",
        },
      })
    );

    const result = await restApiAdapter.testConnection!(INSTANCE as never, {
      endpointEntityId: "ent-users",
    });

    expect(result).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns { ok: false, code: REST_API_ENDPOINT_NOT_FOUND } when endpointEntityId is missing from params", async () => {
    const result = await restApiAdapter.testConnection!(INSTANCE as never, {});
    expect(result).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
    });
    expect(findByEntityIdMock).not.toHaveBeenCalled();
  });
});
