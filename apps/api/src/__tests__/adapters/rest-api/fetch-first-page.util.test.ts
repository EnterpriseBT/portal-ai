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
} from "../../../adapters/rest-api/fetch-first-page.util.js";

const NONE_AUTH: ApiAuthConfig = { mode: "none" };

function makeEndpoint(overrides: {
  path?: string;
  method?: "GET" | "POST";
  recordsPath?: string;
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
