import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import type {
  ApiAuthConfig,
  PaginationConfig,
} from "@portalai/core/models";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  fetchFirstPage,
  fetchOnePage,
  streamFetchOnePage,
} from "../../../adapters/rest-api/fetch-first-page.util.js";

const NONE_AUTH: ApiAuthConfig = { mode: "none" };

function makeEndpoint(overrides: {
  path?: string;
  method?: "GET" | "POST";
  recordsPath?: string;
  transform?: string | null;
  bodyTemplate?: string | null;
  headers?: Record<string, string> | null;
  queryParams?: Record<string, string> | null;
} = {}) {
  return {
    entity: {
      id: "ent-users",
      key: "users",
      label: "Users",
      organizationId: "org-1",
      connectorInstanceId: "ci-1",
      created: 1,
      createdBy: "u",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    },
    config: {
      id: "cfg-1",
      organizationId: "org-1",
      connectorEntityId: "ent-users",
      path: "/users",
      method: "GET" as const,
      recordsPath: "",
      idField: "id",
      headers: null,
      queryParams: null,
      bodyTemplate: null,
      pagination: "none",
      paginationConfig: null,
      created: 1,
      createdBy: "u",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    },
  } as never;
}

const okResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

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

describe("fetchFirstPage — per-strategy single fetch", () => {
  it("none: fetches once and returns the records", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }, { id: "b" }]));
    const fetched = await fetchFirstPage(
      makeEndpoint(),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "none" }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetched.records).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("pageOffset: fetches only page 1 (?page=1); no second fetch", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }, { id: "b" }]));
    const pagination: PaginationConfig = {
      strategy: "pageOffset",
      style: "page",
      param: "page",
      pageSize: 50,
      startPage: 1,
      stopOnShortPage: false,
    };
    await fetchFirstPage(
      makeEndpoint(),
      "https://api.example.com",
      NONE_AUTH,
      null,
      pagination
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("pageOffset offset-style: page 1 sends ?<param>=<startPage>&<pageSizeParam>=<pageSize>", async () => {
    // Smoke target from #81 — the ArcGIS-style "?resultOffset=0&
    // resultRecordCount=1000" sequence. We assert page 1 only here;
    // multi-page increment is pinned in the iterator's own suite.
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    const pagination: PaginationConfig = {
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSize: 1000,
      pageSizeParam: "resultRecordCount",
      startPage: 0,
      stopOnShortPage: false,
    };
    await fetchFirstPage(
      makeEndpoint(),
      "https://api.example.com",
      NONE_AUTH,
      null,
      pagination
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("resultOffset")).toBe("0");
    expect(url.searchParams.get("resultRecordCount")).toBe("1000");
  });

  it("cursor: fetches page 1 (no cursor param) and discards the page-2 iteration", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        items: [{ id: "a" }],
        meta: { next: "c2" },
      })
    );
    const pagination: PaginationConfig = {
      strategy: "cursor",
      cursorParam: "cursor",
      cursorPlacement: "query",
      cursorResponsePath: "meta.next",
    };
    await fetchFirstPage(
      makeEndpoint({ recordsPath: "items" }),
      "https://api.example.com",
      NONE_AUTH,
      null,
      pagination
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("cursor")).toBeNull();
  });

  it("cursor: throws REST_API_CURSOR_NOT_FOUND when page 1's response is missing cursorResponsePath", async () => {
    // The iterator's response inspection still runs on the page we
    // feed back, so a malformed response surfaces.
    fetchMock.mockResolvedValueOnce(okResponse({ items: [{ id: "a" }] }));
    const pagination: PaginationConfig = {
      strategy: "cursor",
      cursorParam: "cursor",
      cursorPlacement: "query",
      cursorResponsePath: "meta.next",
    };
    await expect(
      fetchFirstPage(
        makeEndpoint({ recordsPath: "items" }),
        "https://api.example.com",
        NONE_AUTH,
        null,
        pagination
      )
    ).rejects.toMatchObject({ code: ApiCode.REST_API_CURSOR_NOT_FOUND });
  });

  it("linkHeader: fetches page 1; doesn't follow the rel=next URL", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([{ id: "a" }], {
        link: '<https://api.example.com/users?page=2>; rel="next"',
      })
    );
    await fetchFirstPage(
      makeEndpoint(),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "linkHeader" }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchFirstPage — auth + templating", () => {
  it("applies bearer auth on the first request", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    await fetchFirstPage(
      makeEndpoint(),
      "https://api.example.com",
      { mode: "bearer" },
      { mode: "bearer", token: "tok" },
      { strategy: "none" }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });

  it("substitutes {{pageNumber}}: 1 and {{cursor}}: '' into headers + queryParams", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    await fetchFirstPage(
      makeEndpoint({
        headers: { "X-Cursor": "{{cursor}}", "X-Page": "{{pageNumber}}" },
        queryParams: { since: "{{pageNumber}}" },
      }),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "none" }
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get("since")).toBe("1");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Page"]).toBe("1");
    expect(headers["X-Cursor"]).toBe("");
  });
});

describe("fetchFirstPage — surfaced FetchedPage", () => {
  it("returns body, headers, status, and the walked records", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ items: [{ id: "x" }] }, { "x-rate-limit": "100" })
    );
    const fetched = await fetchFirstPage(
      makeEndpoint({ recordsPath: "items" }),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "none" }
    );
    expect(fetched.status).toBe(200);
    expect(fetched.records).toEqual([{ id: "x" }]);
    expect(fetched.body).toEqual({ items: [{ id: "x" }] });
    expect(fetched.headers["x-rate-limit"]).toBe("100");
  });
});

describe("fetchOnePage — regression coverage of the moved primitive", () => {
  it("is exported and callable with a hand-built PageContext", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: "a" }]));
    const fetched = await fetchOnePage(
      makeEndpoint(),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "none" },
      { pageNumber: 1, cursor: "", isFirstPage: true, isLastPage: true }
    );
    expect(fetched.records).toEqual([{ id: "a" }]);
  });
});

// ── streamFetchOnePage ───────────────────────────────────────────────

/** Drain an AsyncIterable to an array — small fixture helper. */
async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("streamFetchOnePage — URL / auth / template routing", () => {
  it("builds the same URL fetchOnePage would for an unpaginated endpoint", async () => {
    // Record what fetchOnePage requests for comparison.
    fetchMock.mockResolvedValueOnce(okResponse({ items: [{ id: "a" }] }));
    await fetchOnePage(
      makeEndpoint({
        recordsPath: "items",
        queryParams: { since: "{{pageNumber}}" },
      }),
      "https://api.example.com",
      NONE_AUTH,
      null,
      { strategy: "none" },
      { pageNumber: 1, cursor: "", isFirstPage: true, isLastPage: true }
    );
    const expectedUrl = fetchMock.mock.calls[0]![0] as string;

    // Now the streaming counterpart against the same endpoint shape.
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse({ items: [{ id: "a" }] }));
    const result = await streamFetchOnePage(
      makeEndpoint({
        recordsPath: "items",
        queryParams: { since: "{{pageNumber}}" },
      }),
      "https://api.example.com",
      NONE_AUTH,
      null
    );
    expect(fetchMock.mock.calls[0]![0]).toBe(expectedUrl);
    // Drain so the underlying stream closes cleanly.
    await drain(result.recordsStream);
  });

  it("applies bearer auth on the request", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ items: [] }));
    const result = await streamFetchOnePage(
      makeEndpoint({ recordsPath: "items" }),
      "https://api.example.com",
      { mode: "bearer" },
      { mode: "bearer", token: "tok" }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
    await drain(result.recordsStream);
  });

  it("substitutes {{pageNumber}}: 1 and {{cursor}}: '' into headers + queryParams", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ items: [] }));
    const result = await streamFetchOnePage(
      makeEndpoint({
        recordsPath: "items",
        headers: { "X-Cursor": "{{cursor}}", "X-Page": "{{pageNumber}}" },
        queryParams: { since: "{{pageNumber}}" },
      }),
      "https://api.example.com",
      NONE_AUTH,
      null
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).searchParams.get("since")).toBe("1");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Page"]).toBe("1");
    expect(headers["X-Cursor"]).toBe("");
    await drain(result.recordsStream);
  });

  it("emits records under the configured recordsPath", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ items: [{ id: "a" }, { id: "b" }] })
    );
    const result = await streamFetchOnePage(
      makeEndpoint({ recordsPath: "items" }),
      "https://api.example.com",
      NONE_AUTH,
      null
    );
    expect(result.status).toBe(200);
    const records = await drain(result.recordsStream);
    expect(records).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("rejects with REST_API_INVALID_CONFIG when recordsPath is empty and transform is set", async () => {
    // The misconfiguration is caller-detected; no fetch should happen.
    await expect(
      streamFetchOnePage(
        makeEndpoint({ recordsPath: "", transform: "$.items" }),
        "https://api.example.com",
        NONE_AUTH,
        null
      )
    ).rejects.toMatchObject({ code: ApiCode.REST_API_INVALID_CONFIG });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-2xx upstream as REST_API_FETCH_FAILED before iteration", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"oops"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(
      streamFetchOnePage(
        makeEndpoint({ recordsPath: "items" }),
        "https://api.example.com",
        NONE_AUTH,
        null
      )
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ status: 500 }),
    });
  });
});
