import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
  PaginationConfigSchema,
  RestApiInstanceConfigSchema,
  ApiEndpointConfigSchema,
} from "../../models/api-connector.model.js";

const NONE_PAGINATION = { strategy: "none" as const };

describe("ApiAuthConfigSchema", () => {
  it("accepts the `none` mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "none" });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with header placement", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with query placement", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "api_key",
      placement: "query",
    });
    expect(result.success).toBe(true);
  });

  it("rejects apiKey with empty keyName", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "",
      placement: "header",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with invalid placement enum", () => {
    const result = ApiAuthConfigSchema.safeParse({
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "form",
    });
    expect(result.success).toBe(false);
  });

  it("accepts bearer mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "bearer" });
    expect(result.success).toBe(true);
  });

  it("accepts basic mode", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "basic" });
    expect(result.success).toBe(true);
  });

  it("rejects payloads with no mode", () => {
    const result = ApiAuthConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown auth modes", () => {
    const result = ApiAuthConfigSchema.safeParse({ mode: "oauth2" });
    expect(result.success).toBe(false);
  });
});

describe("ApiCredentialsSchema", () => {
  it("accepts none mode", () => {
    const result = ApiCredentialsSchema.safeParse({ mode: "none" });
    expect(result.success).toBe(true);
  });

  it("accepts apiKey mode with a value", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "apiKey",
      value: "abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects apiKey with empty value", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "apiKey",
      value: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey without a value", () => {
    const result = ApiCredentialsSchema.safeParse({ mode: "apiKey" });
    expect(result.success).toBe(false);
  });

  it("accepts bearer mode with a token", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "bearer",
      token: "tok",
    });
    expect(result.success).toBe(true);
  });

  it("rejects bearer with empty token", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "bearer",
      token: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts basic mode with username + password", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "u",
      password: "p",
    });
    expect(result.success).toBe(true);
  });

  it("rejects basic mode with empty username", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "",
      password: "p",
    });
    expect(result.success).toBe(false);
  });

  it("rejects basic mode with empty password", () => {
    const result = ApiCredentialsSchema.safeParse({
      mode: "basic",
      username: "u",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("RestApiInstanceConfigSchema", () => {
  it("accepts a valid base URL with none auth", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
      auth: { mode: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid base URL with apiKey auth", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
      auth: { mode: "apiKey", keyName: "X-API-Key", placement: "header" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-URL baseUrl", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "not-a-url",
      auth: { mode: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when auth is missing", () => {
    const result = RestApiInstanceConfigSchema.safeParse({
      baseUrl: "https://api.example.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("PaginationConfigSchema", () => {
  it("accepts the none strategy", () => {
    const result = PaginationConfigSchema.safeParse({ strategy: "none" });
    expect(result.success).toBe(true);
  });

  it("accepts pageOffset page-style with just param + applies defaults (pageSize: 1)", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "page",
      param: "page",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.strategy === "pageOffset") {
      expect(result.data.pageSize).toBe(1);
      if (result.data.style === "page") {
        expect(result.data.startPage).toBe(1);
        expect(result.data.stopOnShortPage).toBe(true);
      }
    }
  });

  it("rejects pageOffset missing param", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "page",
    });
    expect(result.success).toBe(false);
  });

  // ── offset-style — every field required, no defaults ───────────────

  it("accepts pageOffset offset-style with all required fields", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSize: 1000,
      pageSizeParam: "resultRecordCount",
      startPage: 0,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.strategy === "pageOffset") {
      expect(result.data.style).toBe("offset");
      expect(result.data.pageSize).toBe(1000);
      if (result.data.style === "offset") {
        expect(result.data.pageSizeParam).toBe("resultRecordCount");
        expect(result.data.startPage).toBe(0);
      }
    }
  });

  it("rejects pageOffset offset-style missing pageSize", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSizeParam: "resultRecordCount",
      startPage: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects pageOffset offset-style missing pageSizeParam", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSize: 1000,
      startPage: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects pageOffset offset-style missing startPage", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSize: 1000,
      pageSizeParam: "resultRecordCount",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pageOffset offset-style with empty pageSizeParam", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "pageOffset",
      style: "offset",
      param: "resultOffset",
      pageSize: 1000,
      pageSizeParam: "",
      startPage: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts cursor with cursorParam + cursorResponsePath", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "cursor",
      cursorParam: "cursor",
      cursorResponsePath: "meta.next",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.strategy === "cursor") {
      expect(result.data.cursorPlacement).toBe("query");
    }
  });

  it("rejects cursor missing cursorResponsePath", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "cursor",
      cursorParam: "cursor",
    });
    expect(result.success).toBe(false);
  });

  it("accepts linkHeader (no further config)", () => {
    const result = PaginationConfigSchema.safeParse({ strategy: "linkHeader" });
    expect(result.success).toBe(true);
  });

  it("accepts linkBody with a nextUrlPath", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "linkBody",
      nextUrlPath: "links.next",
    });
    expect(result.success).toBe(true);
  });

  it("rejects linkBody missing nextUrlPath", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "linkBody",
    });
    expect(result.success).toBe(false);
  });

  it("rejects linkBody with empty nextUrlPath", () => {
    const result = PaginationConfigSchema.safeParse({
      strategy: "linkBody",
      nextUrlPath: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown strategy", () => {
    const result = PaginationConfigSchema.safeParse({ strategy: "rfc5988" });
    expect(result.success).toBe(false);
  });
});

describe("ApiEndpointConfigSchema", () => {
  it("accepts a minimal GET endpoint and defaults recordsPath to ''", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recordsPath).toBe("");
    }
  });

  it("accepts a fully-populated POST endpoint", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/search",
      method: "POST",
      recordsPath: "data.results",
      idField: "id",
      headers: { "X-Tenant": "acme" },
      queryParams: { active: "true" },
      bodyTemplate: '{"q":1}',
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
  });

  it("rejects bodyTemplate on GET endpoints", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "GET",
      bodyTemplate: '{"q":1}',
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(false);
  });

  it("requires pagination", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "GET",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a non-none pagination strategy", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "GET",
      pagination: {
        strategy: "cursor",
        cursorParam: "cursor",
        cursorResponsePath: "meta.next",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty path", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "",
      method: "GET",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(false);
  });

  it("rejects methods other than GET / POST", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "PATCH",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(false);
  });

  it("allows idField to be null", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/x",
      method: "GET",
      idField: null,
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
  });

  // ── transform ↔ recordsPath mutual exclusion ───────────────────────

  it("accepts an endpoint with transform set and no recordsPath", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      transform: "data.items",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
  });

  it("accepts transform alongside an empty-string recordsPath", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      transform: "data.items",
      recordsPath: "",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
  });

  it("rejects endpoints with both transform and recordsPath non-empty", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      transform: "data.items",
      recordsPath: "items",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.length === 1 && i.path[0] === "transform"
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/transform/i);
      expect(issue?.message).toMatch(/recordsPath/i);
    }
  });

  it("treats an empty-string transform as unset (recordsPath alone is fine)", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      transform: "",
      recordsPath: "data.items",
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(true);
  });

  it("rejects transform expressions longer than 4096 characters", () => {
    const result = ApiEndpointConfigSchema.safeParse({
      path: "/users",
      method: "GET",
      transform: "x".repeat(4097),
      pagination: NONE_PAGINATION,
    });
    expect(result.success).toBe(false);
  });
});
