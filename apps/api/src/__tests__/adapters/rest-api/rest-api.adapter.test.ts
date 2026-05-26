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
    transform?: string | null;
    idField: string | null;
    headers?: Record<string, string> | null;
    queryParams?: Record<string, string> | null;
    bodyTemplate?: string | null;
    pagination: string;
    paginationConfig?: Record<string, unknown> | null;
  };
};

const NONE_PAGINATION = { pagination: "none" as const, paginationConfig: null };

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
const findColumnDefinitionsMock =
  jest.fn<
    (orgId: string) => Promise<
      Array<{
        id: string;
        label: string;
        key: string;
        description: string | null;
        type: string;
      }>
    >
  >();

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
      columnDefinitions: { findByOrganizationId: findColumnDefinitionsMock },
    },
  },
}));

const {
  restApiAdapter,
  walkRecordsPath,
  assertRecordsArray,
  buildUrl,
  deriveSourceId,
  configureRestApiAdapterDeps,
  __resetRestApiAdapterDepsForTests,
} = await import("../../../adapters/rest-api/rest-api.adapter.js");
const { ProbeCache } = await import(
  "../../../adapters/rest-api/probe-cache.util.js"
);
const { createStubClassifier, createThrowingClassifier } = await import(
  "../../../adapters/rest-api/classifier.stub.js"
);

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
  findColumnDefinitionsMock.mockReset();
  findColumnDefinitionsMock.mockResolvedValue([]);
  __resetRestApiAdapterDepsForTests();
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

describe("restApiAdapter.discoverEntities", () => {
  it("returns one DiscoveredEntity per configured endpoint", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id", ...NONE_PAGINATION },
      },
      {
        entity: { id: "e2", key: "posts", label: "Posts" },
        config: { path: "/posts", method: "GET", recordsPath: "data", idField: null, ...NONE_PAGINATION },
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
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id", ...NONE_PAGINATION },
      },
    ]);
    const result = await restApiAdapter.assertSyncEligibility!(INSTANCE);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false REST_API_MISSING_CREDENTIALS for bearer mode with no credentials", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id", ...NONE_PAGINATION },
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
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id", ...NONE_PAGINATION },
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
        config: { path: "/users", method: "GET", recordsPath: "", idField: "id", ...NONE_PAGINATION },
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

// ── syncInstance pagination + templating ─────────────────────────────

describe("restApiAdapter.syncInstance — pagination + templating", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<typeof globalThis.fetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    findBySourceIdsMock.mockResolvedValue([]);
    upsertBySourceIdMock.mockResolvedValue(undefined);
    bulkUpdateSyncedAtMock.mockResolvedValue(0);
    softDeleteBeforeWatermarkMock.mockResolvedValue([]);
    updateInstanceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const okResponse = (records: unknown[], headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(records), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });

  it("pageOffset: walks pages 1, 2, 3 with ?page=N and terminates on an empty page", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          pagination: "pageOffset",
          paginationConfig: {
            style: "page",
            param: "page",
            pageSize: 2,
            startPage: 1,
            stopOnShortPage: false,
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(okResponse([{ id: "c" }, { id: "d" }]))
      .mockResolvedValueOnce(okResponse([]));

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(new URL(urls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(urls[1]).searchParams.get("page")).toBe("2");
    expect(new URL(urls[2]).searchParams.get("page")).toBe("3");
    expect(upsertBySourceIdMock).toHaveBeenCalledTimes(4);
  });

  it("cursor: page 1 has no cursor; page 2 carries ?cursor=a; terminates on null", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "items",
          idField: "id",
          pagination: "cursor",
          paginationConfig: {
            cursorParam: "cursor",
            cursorPlacement: "query",
            cursorResponsePath: "meta.next",
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [{ id: "a" }], meta: { next: "c2" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [{ id: "b" }], meta: { next: null } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(new URL(urls[0]).searchParams.get("cursor")).toBeNull();
    expect(new URL(urls[1]).searchParams.get("cursor")).toBe("c2");
  });

  it("linkHeader: page 2's URL comes from the Link header (overrideUrl)", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          pagination: "linkHeader",
          paginationConfig: null,
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "a" }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.example.com/users?page=2>; rel="next"',
          },
        })
      )
      .mockResolvedValueOnce(okResponse([{ id: "b" }]));

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toBe("https://api.example.com/users");
    expect(urls[1]).toBe("https://api.example.com/users?page=2");
  });

  it("templates {{pageNumber}} into a queryParams value per page", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          queryParams: { since: "{{pageNumber}}" },
          pagination: "pageOffset",
          paginationConfig: {
            style: "page",
            param: "page",
            pageSize: 1,
            startPage: 1,
            stopOnShortPage: true,
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([]));

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    const u1 = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(u1.searchParams.get("since")).toBe("1");
  });

  it("templates {{pageNumber}} into a POST bodyTemplate per page", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "POST",
          recordsPath: "",
          idField: "id",
          bodyTemplate: '{"page":{{pageNumber}}}',
          pagination: "pageOffset",
          paginationConfig: {
            style: "page",
            param: "page",
            pageSize: 1,
            startPage: 1,
            stopOnShortPage: true,
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([]));

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    const init1 = fetchMock.mock.calls[0]![1];
    expect(init1?.body).toBe('{"page":1}');
    const init2 = fetchMock.mock.calls[1]![1];
    expect(init2?.body).toBe('{"page":2}');
  });

  it("propagates REST_API_PAGINATION_INVALID when paginationConfig fails Zod", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          // cursor needs cursorResponsePath
          pagination: "cursor",
          paginationConfig: { cursorParam: "cursor" },
        },
      },
    ]);

    await expect(
      restApiAdapter.syncInstance!(INSTANCE, "u1")
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_PAGINATION_INVALID,
    });
  });

  // ── transform-bearing sync (slice 5) ────────────────────────────────

  it("transform-bearing endpoint: sync yields transformed records page-by-page", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          transform:
            'data.{ "id": id, "user_name": user.name, "user_email": user.email }',
          idField: "id",
          pagination: "pageOffset",
          paginationConfig: {
            style: "page",
            param: "page",
            pageSize: 2,
            startPage: 1,
            stopOnShortPage: false,
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          data: [
            { id: 1, user: { name: "Ada", email: "ada@x.test" } },
            { id: 2, user: { name: "Grace", email: "grace@x.test" } },
          ],
        } as unknown as unknown[])
      )
      .mockResolvedValueOnce(
        okResponse({ data: [] } as unknown as unknown[])
      );

    await restApiAdapter.syncInstance!(INSTANCE, "u1");

    // Two outbound requests (page 1 with records, page 2 empty → stop).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The reconciler saw the flat records — assert via upsert calls.
    expect(upsertBySourceIdMock).toHaveBeenCalledTimes(2);
    const upsertedDatas = upsertBySourceIdMock.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data
    );
    for (const data of upsertedDatas) {
      expect(Object.keys(data).sort()).toEqual([
        "id",
        "user_email",
        "user_name",
      ]);
    }
  });

  it("transform parse error during sync fails the page with REST_API_TRANSFORM_FAILED", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: { id: "e1", key: "users", label: "Users" },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          transform: "data.{ unclosed",
          idField: "id",
          pagination: "none",
          paginationConfig: null,
        },
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      okResponse({ data: [{ id: 1 }] } as unknown as unknown[])
    );

    await expect(
      restApiAdapter.syncInstance!(INSTANCE, "u1")
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_TRANSFORM_FAILED,
    });
    expect(upsertBySourceIdMock).not.toHaveBeenCalled();
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
      ...NONE_PAGINATION,
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
        config: { path: "/users", method: "GET", recordsPath: "data", idField: null, ...NONE_PAGINATION },
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

// ── toPublicAccountInfo ──────────────────────────────────────────────

describe("restApiAdapter.toPublicAccountInfo", () => {
  it("returns the instance's baseUrl as the identity label", () => {
    const out = restApiAdapter.toPublicAccountInfo!(null, INSTANCE as never);
    expect(out).toEqual({
      identity: "https://api.example.com",
      metadata: {},
    });
  });

  it("ignores credentials — only baseUrl drives the label", () => {
    const out = restApiAdapter.toPublicAccountInfo!(
      { mode: "bearer", token: "tok" } as Record<string, unknown>,
      INSTANCE as never
    );
    expect(out.identity).toBe("https://api.example.com");
  });

  it("falls back to a generic label when config.baseUrl is missing", () => {
    const out = restApiAdapter.toPublicAccountInfo!(null, {
      ...INSTANCE,
      config: { auth: { mode: "none" } },
    } as never);
    expect(out.identity).toBe("REST API");
  });

  it("falls back to a generic label when instance is not provided", () => {
    const out = restApiAdapter.toPublicAccountInfo!(null);
    expect(out.identity).toBe("REST API");
  });
});

// ── discoverColumnsWithSamples (slice 5) ─────────────────────────────

describe("restApiAdapter.discoverColumnsWithSamples", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<typeof globalThis.fetch>;

  function okResponse(body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  function withEndpoint() {
    findByInstanceMock.mockResolvedValue([
      {
        entity: {
          id: "ent-users",
          key: "users",
          label: "Users",
          connectorInstanceId: INSTANCE.id,
        },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          ...NONE_PAGINATION,
        },
      },
    ]);
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns heuristic columns + suggestions when the classifier is wired", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(
      okResponse(
        Array.from({ length: 10 }, (_, i) => ({
          id: `u${i}`,
          name: `User ${i}`,
        }))
      )
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: createStubClassifier([
        {
          sourceField: "id",
          columnDefinitionId: "cd-id",
          suggestedNormalizedKey: "user_id",
          suggestedSemanticType: "string",
          confidence: 0.9,
          rationale: "ID-shaped",
        },
        {
          sourceField: "name",
          columnDefinitionId: "cd-name",
          suggestedNormalizedKey: "user_name",
          suggestedSemanticType: "string",
          confidence: 0.7,
          rationale: "Name-shaped",
        },
      ]),
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.source).toBe("live");
    expect(result.degradation).toBeNull();
    expect(result.recordsScanned).toBe(10);
    expect(result.columns).toHaveLength(2);
    const byKey = Object.fromEntries(result.columns.map((c) => [c.key, c]));
    expect(byKey.id.suggestion?.suggestedNormalizedKey).toBe("user_id");
    expect(byKey.name.suggestion?.suggestedNormalizedKey).toBe("user_name");
  });

  it("marks degradation: 'llm-disabled' when no classifier is wired", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }, { id: "b" }]));
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.degradation).toBe("llm-disabled");
    expect(result.columns[0].suggestion).toBeUndefined();
  });

  it("marks degradation: 'llm-failed' when the classifier throws (heuristic columns still returned)", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: createThrowingClassifier("network-error", "boom"),
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.degradation).toBe("llm-failed");
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].key).toBe("id");
    expect(result.columns[0].suggestion).toBeUndefined();
  });

  it("drops classifications for unknown sourceFields (hallucinations)", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a", email: "x@y" }]));
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: createStubClassifier([
        {
          sourceField: "id",
          columnDefinitionId: null,
          suggestedNormalizedKey: "id",
          suggestedSemanticType: "string",
          confidence: 0.5,
          rationale: "ok",
        },
        {
          sourceField: "not-a-field",
          columnDefinitionId: null,
          suggestedNormalizedKey: "nope",
          suggestedSemanticType: "string",
          confidence: 0.9,
          rationale: "hallucination",
        },
      ]),
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.columns.find((c) => c.key === "id")?.suggestion).toBeDefined();
    expect(result.columns.find((c) => c.key === "email")?.suggestion).toBeUndefined();
    // The hallucinated sourceField doesn't appear as a column either.
    expect(result.columns.map((c) => c.key).sort()).toEqual(["email", "id"]);
  });

  it("serves the second call from cache (no second fetch, no second classifier call)", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    const stub = jest.fn(async () => [
      {
        sourceField: "id",
        columnDefinitionId: null,
        suggestedNormalizedKey: "id",
        suggestedSemanticType: "string" as const,
        confidence: 0.5,
        rationale: "ok",
      },
    ]);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: { classify: stub as never },
    });

    const first = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    const second = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("re-probes both layers when forceRefresh is true", async () => {
    withEndpoint();
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([{ id: "b" }]));
    const stub = jest.fn(async () => []);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: { classify: stub as never },
    });

    await restApiAdapter.discoverColumnsWithSamples(INSTANCE, "users");
    await restApiAdapter.discoverColumnsWithSamples(INSTANCE, "users", {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("returns no columns and skips the classifier when records are empty", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(okResponse([]));
    const stub = jest.fn(async () => []);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: { classify: stub as never },
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.columns).toEqual([]);
    expect(result.degradation).toBeNull();
    expect(stub).not.toHaveBeenCalled();
  });

  it("propagates REST_API_AUTH_FAILED on 401 without populating the cache or calling the classifier", async () => {
    withEndpoint();
    fetchMock.mockResolvedValueOnce(
      new Response("nope", {
        status: 401,
        headers: { "content-type": "text/plain" },
      })
    );
    const stub = jest.fn(async () => []);
    const cache = new ProbeCache<never>();
    configureRestApiAdapterDeps({
      cache: cache as never,
      classifier: { classify: stub as never },
    });

    await expect(
      restApiAdapter.discoverColumnsWithSamples(
        {
          ...INSTANCE,
          config: {
            baseUrl: "https://api.example.com",
            auth: { mode: "bearer" },
          },
          credentials: { mode: "bearer", token: "tok" } as never,
        },
        "users"
      )
    ).rejects.toMatchObject({ code: ApiCode.REST_API_AUTH_FAILED });

    expect(stub).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it("slices to MAX_RECORDS_SCANNED (25) before running the heuristic", async () => {
    withEndpoint();
    // 100 records — heuristic should run over 25.
    fetchMock.mockResolvedValueOnce(
      okResponse(Array.from({ length: 100 }, (_, i) => ({ id: `u${i}` })))
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );

    expect(result.recordsScanned).toBe(25);
  });

  it("returns 404 REST_API_ENDPOINT_NOT_FOUND when the entity key isn't configured", async () => {
    findByInstanceMock.mockResolvedValueOnce([]);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    await expect(
      restApiAdapter.discoverColumnsWithSamples(INSTANCE, "missing")
    ).rejects.toMatchObject({ code: ApiCode.REST_API_ENDPOINT_NOT_FOUND });
  });

  // ── transform-bearing endpoints (slice 5) ────────────────────────

  function withTransformEndpoint(transform: string) {
    findByInstanceMock.mockResolvedValue([
      {
        entity: {
          id: "ent-users",
          key: "users",
          label: "Users",
          connectorInstanceId: INSTANCE.id,
        },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          transform,
          idField: "id",
          ...NONE_PAGINATION,
        },
      },
    ]);
  }

  it("extracts records via transform when set (basic recordsPath-equivalent)", async () => {
    withTransformEndpoint("data.items");
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: { items: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }] },
      })
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    expect(result.degradation).toBe("llm-disabled");
    expect(result.recordsScanned).toBe(2);
    expect(result.columns.map((c) => c.key).sort()).toEqual(["id", "name"]);
  });

  it("flattens nested records via transform projection so the classifier sees flat candidates", async () => {
    withTransformEndpoint(
      'data.{ "id": id, "user_name": user.name, "user_email": user.email }'
    );
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          { id: 1, user: { name: "Ada", email: "ada@x.test" } },
          { id: 2, user: { name: "Grace", email: "grace@x.test" } },
        ],
      })
    );
    const classifyMock =
      jest.fn<(candidates: unknown[], catalog: unknown) => Promise<unknown[]>>()
        .mockResolvedValue([]);
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: { classify: classifyMock as never },
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    expect(result.recordsScanned).toBe(2);
    expect(result.columns.map((c) => c.key).sort()).toEqual([
      "id",
      "user_email",
      "user_name",
    ]);
    // Classifier saw the flat candidate set, not the nested original shape.
    expect(classifyMock).toHaveBeenCalledTimes(1);
    const candidates = classifyMock.mock.calls[0][0] as unknown as Array<{
      sourceField: string;
    }>;
    expect(candidates.map((c) => c.sourceField).sort()).toEqual([
      "id",
      "user_email",
      "user_name",
    ]);
  });

  it("returns degradation 'transform-failed' + transformError on a parse error", async () => {
    withTransformEndpoint("data.{ unclosed");
    fetchMock.mockResolvedValueOnce(
      okResponse({ data: [{ id: 1 }] })
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    expect(result.degradation).toBe("transform-failed");
    expect(result.recordsScanned).toBe(0);
    expect(result.columns).toEqual([]);
    expect(result.transformError?.kind).toBe("parse");
    expect(result.transformError?.message).toBeTruthy();
  });

  it("returns degradation 'transform-failed' on a runtime error", async () => {
    withTransformEndpoint("$undefinedFn(items)");
    fetchMock.mockResolvedValueOnce(okResponse({ items: [1, 2, 3] }));
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    expect(result.degradation).toBe("transform-failed");
    expect(result.recordsScanned).toBe(0);
    expect(result.transformError?.kind).toBe("runtime");
  });

  it("treats an empty transform result as a valid 0-record probe (no degradation)", async () => {
    withTransformEndpoint("data[active = true]");
    fetchMock.mockResolvedValueOnce(
      okResponse({ data: [{ id: 1, active: false }] })
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.discoverColumnsWithSamples(
      INSTANCE,
      "users"
    );
    expect(result.recordsScanned).toBe(0);
    expect(result.columns).toEqual([]);
    expect(result.degradation).toBeNull();
  });
});

// ── probeEndpointDraft (slice 6) ─────────────────────────────────────

describe("restApiAdapter.probeEndpointDraft", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<typeof globalThis.fetch>;

  const ORG_ID = "org-1";

  function okResponse(body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  const baseBody = {
    baseUrl: "https://api.example.com",
    auth: { mode: "none" as const },
    credentials: null,
    endpoint: {
      path: "/users",
      method: "GET" as const,
      recordsPath: "",
      idField: "id",
      pagination: { strategy: "none" as const },
    },
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns DiscoverColumnsResult from a draft body — no DB lookup", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }])
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.probeEndpointDraft(ORG_ID, baseBody);

    expect(result.source).toBe("live");
    expect(result.recordsScanned).toBe(2);
    expect(result.columns.map((c) => c.key).sort()).toEqual(["id", "name"]);
    // The findByInstance DB mock must NOT have been called — the
    // pre-commit path does not touch the DB.
    expect(findByInstanceMock).not.toHaveBeenCalled();
  });

  it("surfaces transform failures as degradation: 'transform-failed'", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: [{ id: 1 }] }));
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const result = await restApiAdapter.probeEndpointDraft(ORG_ID, {
      ...baseBody,
      endpoint: { ...baseBody.endpoint, transform: "data.{ unclosed" },
    });

    expect(result.degradation).toBe("transform-failed");
    expect(result.recordsScanned).toBe(0);
    expect(result.transformError?.kind).toBe("parse");
  });

  it("hits the cache on a second identical call (cache key = probeInputHash)", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    const cache = new ProbeCache<never>();
    configureRestApiAdapterDeps({ cache: cache as never, classifier: null });

    const first = await restApiAdapter.probeEndpointDraft(ORG_ID, baseBody);
    const second = await restApiAdapter.probeEndpointDraft(ORG_ID, baseBody);

    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("misses the cache when a probe-relevant field changes", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([{ id: "b" }]));
    configureRestApiAdapterDeps({ cache: new ProbeCache(), classifier: null });

    await restApiAdapter.probeEndpointDraft(ORG_ID, baseBody);
    await restApiAdapter.probeEndpointDraft(ORG_ID, {
      ...baseBody,
      endpoint: { ...baseBody.endpoint, path: "/admins" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh: true bypasses the cache and re-fires", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([{ id: "a" }]));
    configureRestApiAdapterDeps({ cache: new ProbeCache(), classifier: null });

    await restApiAdapter.probeEndpointDraft(ORG_ID, baseBody);
    await restApiAdapter.probeEndpointDraft(ORG_ID, {
      ...baseBody,
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("scopes the cache key to organizationId (no cross-org collisions)", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse([{ id: "a" }]))
      .mockResolvedValueOnce(okResponse([{ id: "b" }]));
    configureRestApiAdapterDeps({ cache: new ProbeCache(), classifier: null });

    await restApiAdapter.probeEndpointDraft("org-1", baseBody);
    await restApiAdapter.probeEndpointDraft("org-2", baseBody);

    // Two different orgs with identical bodies — both fire.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── discoverColumns (the slim DiscoveredColumn[] view) ──────────────

describe("restApiAdapter.discoverColumns", () => {
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

  it("returns DiscoveredColumn[] (no samples or suggestions) derived from the rich method", async () => {
    findByInstanceMock.mockResolvedValueOnce([
      {
        entity: {
          id: "ent-users",
          key: "users",
          label: "Users",
          connectorInstanceId: INSTANCE.id,
        },
        config: {
          path: "/users",
          method: "GET",
          recordsPath: "",
          idField: "id",
          ...NONE_PAGINATION,
        },
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "a", name: "Alice" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    configureRestApiAdapterDeps({
      cache: new ProbeCache(),
      classifier: null,
    });

    const cols = await restApiAdapter.discoverColumns(INSTANCE, "users");
    expect(cols).toEqual([
      { key: "id", label: "id", type: "string", required: true },
      { key: "name", label: "name", type: "string", required: true },
    ]);
  });
});

