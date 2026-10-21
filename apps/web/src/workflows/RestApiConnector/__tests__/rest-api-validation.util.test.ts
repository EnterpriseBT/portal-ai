import { describe, it, expect } from "@jest/globals";

import {
  EMPTY_CREDENTIALS_DRAFT,
  EMPTY_PAGINATION_DRAFT,
  paginationDraftToConfig,
  previewRequestUrl,
  queryParamsConfig,
  splitPathQuery,
  withSplitPath,
  totalCountDraftToConfig,
  validateBasics,
  validateEndpoint,
  validateEndpointsList,
  validatePlaceholders,
} from "../utils/rest-api-validation.util";
import { newKeyValueRow } from "../../../utils/key-value-rows.util";

const rows = (...pairs: Array<[string, string]>) =>
  pairs.map(([k, v]) => newKeyValueRow(k, v));

describe("validateBasics — common", () => {
  it("returns no errors for valid name + baseUrl + none auth", () => {
    const errors = validateBasics({
      name: "Acme API",
      baseUrl: "https://api.example.com",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors).toEqual({});
  });

  it("flags empty name", () => {
    const errors = validateBasics({
      name: "",
      baseUrl: "https://x.test",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.name).toMatch(/required/i);
  });

  it("flags empty baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.baseUrl).toMatch(/required/i);
  });

  it("flags invalid baseUrl", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "not-a-url",
      authMode: "none",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.baseUrl).toMatch(/valid URL/i);
  });
});

describe("validateBasics — apiKey mode", () => {
  it("flags missing keyName and value", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "apiKey",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.keyName).toMatch(/required/i);
    expect(errors.value).toMatch(/required/i);
  });

  it("returns no credential errors when keyName and value are both populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "apiKey",
      credentials: {
        ...EMPTY_CREDENTIALS_DRAFT,
        keyName: "X-API-Key",
        placement: "header",
        apiKeyValue: "secret",
      },
    });
    expect(errors.keyName).toBeUndefined();
    expect(errors.value).toBeUndefined();
  });
});

describe("validateBasics — bearer mode", () => {
  it("flags missing token", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "bearer",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.token).toMatch(/required/i);
  });

  it("returns no token error when token is populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "bearer",
      credentials: { ...EMPTY_CREDENTIALS_DRAFT, bearerToken: "tok" },
    });
    expect(errors.token).toBeUndefined();
  });
});

describe("validateBasics — basic mode", () => {
  it("flags missing username and password", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "basic",
      credentials: EMPTY_CREDENTIALS_DRAFT,
    });
    expect(errors.username).toMatch(/required/i);
    expect(errors.password).toMatch(/required/i);
  });

  it("returns no credential errors when both fields are populated", () => {
    const errors = validateBasics({
      name: "Acme",
      baseUrl: "https://x.test",
      authMode: "basic",
      credentials: {
        ...EMPTY_CREDENTIALS_DRAFT,
        basicUsername: "u",
        basicPassword: "p",
      },
    });
    expect(errors.username).toBeUndefined();
    expect(errors.password).toBeUndefined();
  });
});

describe("validateEndpoint", () => {
  it("returns no errors for a valid endpoint draft", () => {
    const errors = validateEndpoint({
      key: "users",
      label: "Users",
      path: "/users",
      method: "GET",
      recordsPath: "",
      idField: "id",
    });
    expect(errors).toEqual({});
  });

  it("flags empty key", () => {
    const errors = validateEndpoint({
      key: "",
      label: "X",
      path: "/x",
      method: "GET",
      recordsPath: "",
      idField: "",
    });
    expect(errors.key).toMatch(/required/i);
  });

  it("flags invalid method", () => {
    const errors = validateEndpoint({
      key: "x",
      label: "X",
      path: "/x",
      method: "PATCH",
      recordsPath: "",
      idField: "",
    });
    // method violation comes back from the Zod schema with the message
    // text mentioning the enum options.
    expect(Object.keys(errors)).toContain("method");
  });

  it("flags empty path", () => {
    const errors = validateEndpoint({
      key: "x",
      label: "X",
      path: "",
      method: "GET",
      recordsPath: "",
      idField: "",
    });
    expect(Object.keys(errors)).toContain("path");
  });
});

describe("validatePlaceholders", () => {
  it("accepts known placeholders", () => {
    expect(validatePlaceholders("c={{cursor}}")).toEqual({ ok: true });
    expect(validatePlaceholders("p={{pageNumber}}")).toEqual({ ok: true });
    expect(validatePlaceholders("p={{pageNumber}}&c={{cursor}}")).toEqual({
      ok: true,
    });
  });

  it("accepts strings with no placeholders", () => {
    expect(validatePlaceholders("static")).toEqual({ ok: true });
    expect(validatePlaceholders("")).toEqual({ ok: true });
  });

  it("rejects unknown placeholders with a typed error", () => {
    const result = validatePlaceholders("{{lastSyncAt}}");
    expect(result).toMatchObject({
      ok: false,
      name: "lastSyncAt",
      message: expect.stringMatching(/unknown template variable "lastSyncAt"/i),
    });
  });

  it("rejects empty placeholders", () => {
    const result = validatePlaceholders("{{}}");
    expect(result).toMatchObject({
      ok: false,
      name: "",
      message: expect.stringMatching(/empty template placeholder/i),
    });
  });

  it("reports the first unknown placeholder when several appear", () => {
    const result = validatePlaceholders("{{cursor}}-{{nope}}-{{also}}");
    expect(result).toMatchObject({ ok: false, name: "nope" });
  });
});

describe("paginationDraftToConfig", () => {
  it("projects the none strategy", () => {
    expect(paginationDraftToConfig(EMPTY_PAGINATION_DRAFT)).toEqual({
      strategy: "none",
    });
  });

  it("projects pageOffset and omits pageSizeParam when blank", () => {
    expect(
      paginationDraftToConfig({
        ...EMPTY_PAGINATION_DRAFT,
        strategy: "pageOffset",
        style: "page",
        param: "page",
        pageSize: 25,
        pageSizeParam: "",
        startPage: 0,
        stopOnShortPage: false,
      })
    ).toEqual({
      strategy: "pageOffset",
      style: "page",
      param: "page",
      pageSize: 25,
      startPage: 0,
      stopOnShortPage: false,
    });
  });

  it("projects cursor with all required fields", () => {
    expect(
      paginationDraftToConfig({
        ...EMPTY_PAGINATION_DRAFT,
        strategy: "cursor",
        cursorParam: "cursor",
        cursorPlacement: "query",
        cursorResponsePath: "meta.next",
      })
    ).toEqual({
      strategy: "cursor",
      cursorParam: "cursor",
      cursorPlacement: "query",
      cursorResponsePath: "meta.next",
    });
  });

  it("projects linkHeader with no extra fields", () => {
    expect(
      paginationDraftToConfig({
        ...EMPTY_PAGINATION_DRAFT,
        strategy: "linkHeader",
      })
    ).toEqual({ strategy: "linkHeader" });
  });
});

describe("validateEndpointsList", () => {
  it("requires at least one endpoint", () => {
    expect(validateEndpointsList([])).toEqual({
      endpoints: expect.stringMatching(/at least one/i),
    });
  });

  it("accepts non-empty list", () => {
    expect(validateEndpointsList([{ key: "x" }])).toEqual({});
  });
});

import {
  adoptSuggestion,
  validateColumnRows,
} from "../utils/rest-api-validation.util";
import type { ColumnRowDraft } from "../utils/rest-api-validation.util";

function row(overrides: Partial<ColumnRowDraft> = {}): ColumnRowDraft {
  return {
    sourceField: "id",
    normalizedKey: "id",
    required: true,
    samples: [],
    columnDefinitionId: "cd-1",
    ...overrides,
  };
}

describe("validateColumnRows", () => {
  it("returns no errors for valid rows with unique snake_case keys", () => {
    expect(
      validateColumnRows([
        row({ normalizedKey: "id" }),
        row({ normalizedKey: "user_email" }),
      ])
    ).toEqual({});
  });

  it("flags empty normalizedKey", () => {
    const errors = validateColumnRows([row({ normalizedKey: "" })]);
    expect(errors["row-0-normalizedKey"]).toMatch(/required/i);
  });

  it("flags non-snake_case normalizedKey", () => {
    const errors = validateColumnRows([row({ normalizedKey: "UserEmail" })]);
    expect(errors["row-0-normalizedKey"]).toMatch(/snake_case/i);
  });

  it("flags duplicate normalizedKey on both offending rows", () => {
    const errors = validateColumnRows([
      row({ normalizedKey: "email" }),
      row({ normalizedKey: "name" }),
      row({ normalizedKey: "email" }),
    ]);
    expect(errors["row-0-normalizedKey"]).toMatch(/duplicate/i);
    expect(errors["row-2-normalizedKey"]).toMatch(/duplicate/i);
    expect(errors["row-1-normalizedKey"]).toBeUndefined();
  });

  // #838: an endpoint maps existing column definitions; it never creates one.
  it("flags a row without a column definition, and only that row", () => {
    const errors = validateColumnRows([
      row({ normalizedKey: "id" }),
      row({ normalizedKey: "email", columnDefinitionId: null }),
      row({ normalizedKey: "name", columnDefinitionId: undefined }),
    ]);
    expect(errors).toEqual({
      "row-1-columnDefinitionId": "Pick a column definition",
      "row-2-columnDefinitionId": "Pick a column definition",
    });
  });

  it("flags a missing column definition alongside a key error", () => {
    const errors = validateColumnRows([
      row({ normalizedKey: "", columnDefinitionId: null }),
    ]);
    expect(errors["row-0-normalizedKey"]).toMatch(/required/i);
    expect(errors["row-0-columnDefinitionId"]).toBe("Pick a column definition");
  });
});

describe("adoptSuggestion (#838)", () => {
  const suggestion = (columnDefinitionId: string | null) => ({
    columnDefinitionId,
    suggestedNormalizedKey: "user_email",
    suggestedSemanticType: "string" as const,
    confidence: 0.9,
    rationale: "looks like an email",
  });

  it("takes the suggested key and definition", () => {
    expect(
      adoptSuggestion(
        row({ columnDefinitionId: null, suggestion: suggestion("cd-email") })
      )
    ).toMatchObject({
      normalizedKey: "user_email",
      columnDefinitionId: "cd-email",
    });
  });

  it("keeps the picked definition when the suggestion matched none", () => {
    expect(
      adoptSuggestion(
        row({ columnDefinitionId: "cd-picked", suggestion: suggestion(null) })
      )
    ).toMatchObject({
      normalizedKey: "user_email",
      columnDefinitionId: "cd-picked",
    });
  });
});

// #458 — totalCount probe draft handling.
describe("totalCountDraftToConfig", () => {
  it("parses a query string + path into the config block", () => {
    expect(
      totalCountDraftToConfig(
        rows(["returnCountOnly", "true"], ["f", "json"]),
        "count"
      )
    ).toEqual({
      queryParams: { returnCountOnly: "true", f: "json" },
      responsePath: "count",
    });
  });

  it("allows a path with no extra params (count field on the plain response)", () => {
    expect(totalCountDraftToConfig([], "meta.totalCount")).toEqual({
      queryParams: {},
      responsePath: "meta.totalCount",
    });
  });

  it("returns undefined when the section is untouched", () => {
    expect(totalCountDraftToConfig([], "")).toBeUndefined();
    expect(totalCountDraftToConfig(rows(["", ""]), " ")).toBeUndefined();
  });
});

describe("validateEndpoint — totalCount (#458)", () => {
  const base = {
    key: "parcels",
    label: "Parcels",
    path: "/query",
    method: "GET",
    recordsPath: "",
    idField: "",
  };

  it("errors when count params are set without a response path", () => {
    const errors = validateEndpoint({
      ...base,
      totalCountParams: rows(["returnCountOnly", "true"]),
      totalCountPath: "",
    });
    expect(errors.totalCountPath).toMatch(/response path is required/i);
  });

  it("accepts a fully configured probe", () => {
    const errors = validateEndpoint({
      ...base,
      totalCountParams: rows(["returnCountOnly", "true"]),
      totalCountPath: "count",
    });
    expect(errors).toEqual({});
  });

  it("accepts an untouched probe section", () => {
    expect(validateEndpoint(base)).toEqual({});
  });
});

// #801: the endpoint's key, label and column keys carry the request
// contract's limits.
describe("length limits (#801)", () => {
  const endpoint = (over: { key?: string; label?: string }) =>
    validateEndpoint({
      key: "users",
      label: "Users",
      path: "/users",
      method: "GET",
      recordsPath: "",
      idField: "id",
      ...over,
    });

  it("validateEndpoint flags a key over 58 and a label over 120", () => {
    expect(endpoint({ key: "k".repeat(59) }).key).toBe(
      "Key must be 58 characters or fewer"
    );
    expect(endpoint({ label: "a".repeat(121) }).label).toBe(
      "Label must be 120 characters or fewer"
    );
    expect(endpoint({ key: "k".repeat(58), label: "a".repeat(120) })).toEqual(
      {}
    );
  });

  it("validateBasics flags a name over 120", () => {
    expect(
      validateBasics({
        name: "a".repeat(121),
        baseUrl: "https://x.test",
        authMode: "none",
        credentials: EMPTY_CREDENTIALS_DRAFT,
      }).name
    ).toBe("Name must be 120 characters or fewer");
  });

  it("validateColumnRows flags a normalized key over 58", () => {
    expect(
      validateColumnRows([row({ normalizedKey: "k".repeat(59) })])[
        "row-0-normalizedKey"
      ]
    ).toBe("Normalized key must be 58 characters or fewer");
  });
});

describe("splitPathQuery (#808)", () => {
  const pairs = (r: { rows: Array<{ key: string; value: string }> }) =>
    r.rows.map((row) => [row.key, row.value]);

  it("leaves a path with no query alone", () => {
    expect(splitPathQuery("/foo/bar")).toEqual({ path: "/foo/bar", rows: [] });
  });

  it("splits the query into decoded rows", () => {
    const out = splitPathQuery("/foo/bar?fooz=baz&foot=b%26t&q=a+b%20c");
    expect(out.path).toBe("/foo/bar");
    expect(pairs(out)).toEqual([
      ["fooz", "baz"],
      ["foot", "b&t"],
      ["q", "a b c"],
    ]);
  });

  it("drops a fragment and an empty query", () => {
    expect(pairs(splitPathQuery("/x?a=1#frag"))).toEqual([["a", "1"]]);
    // A `?` inside the fragment isn't a query string; it's never sent.
    expect(splitPathQuery("/items#section?x=1")).toEqual({
      path: "/items",
      rows: [],
    });
    expect(splitPathQuery("/x?").path).toBe("/x");
    expect(splitPathQuery("/x?").rows).toEqual([]);
  });
});

describe("previewRequestUrl (#808)", () => {
  it("returns the path when there are no params", () => {
    expect(previewRequestUrl("/users", [])).toBe("/users");
    expect(previewRequestUrl("/users", rows(["", ""]))).toBe("/users");
  });

  it("encodes reserved characters the way buildUrl sends them", () => {
    expect(
      previewRequestUrl("/q", rows(["q", "a&b=c d#e"], ["pct", "100%"]))
    ).toBe("/q?q=a%26b%3Dc+d%23e&pct=100%25");
  });

  it("round-trips through splitPathQuery", () => {
    const original = rows(["q", "a&b=c d#e"], ["k=1", "+x"]);
    const back = splitPathQuery(previewRequestUrl("/q", original));
    expect(back.rows.map((r) => [r.key, r.value])).toEqual([
      ["q", "a&b=c d#e"],
      ["k=1", "+x"],
    ]);
  });

  it("keeps pagination tokens readable", () => {
    expect(
      previewRequestUrl(
        "/items",
        rows(["after", "{{cursor}}"], ["page", "{{pageNumber}}"])
      )
    ).toBe("/items?after={{cursor}}&page={{pageNumber}}");
    // The server allows spaces inside the braces; so does the preview.
    expect(previewRequestUrl("/items", rows(["after", "{{ cursor }}"]))).toBe(
      "/items?after={{ cursor }}"
    );
  });
});

describe("validateEndpoint — query params (#808)", () => {
  const base = {
    key: "users",
    label: "Users",
    path: "/users",
    method: "GET",
    recordsPath: "",
    idField: "",
  };

  it("accepts rows and drops fully empty ones", () => {
    expect(
      validateEndpoint({
        ...base,
        queryParams: rows(["a", "1"], ["", ""], ["b", ""]),
      })
    ).toEqual({});
  });

  it("flags a value with no key, and a duplicate key on the later row", () => {
    const queryParams = rows(["a", "1"], ["", "orphan"], [" a ", "2"]);
    const totalCountParams = rows(["x", "1"], ["x", "2"]);
    const errors = validateEndpoint({
      ...base,
      queryParams,
      totalCountParams,
      totalCountPath: "count",
    });
    // Keyed by each row's stable id, not its position.
    expect(errors).toEqual({
      [`queryParams.${queryParams[1].id}.key`]: "Key is required",
      [`queryParams.${queryParams[2].id}.key`]: "Duplicate key",
      [`totalCountParams.${totalCountParams[1].id}.key`]: "Duplicate key",
    });
  });

  it("flags an unknown or empty template placeholder on that row's value", () => {
    const queryParams = rows(
      ["page", "{{pageNumber}}"],
      ["filter", "{{page}}"],
      ["x", "{{ }}"]
    );
    const errors = validateEndpoint({ ...base, queryParams });
    expect(errors).toEqual({
      [`queryParams.${queryParams[1].id}.value`]: expect.stringMatching(
        /unknown template variable "page"/i
      ),
      [`queryParams.${queryParams[2].id}.value`]: expect.stringMatching(
        /empty template placeholder/i
      ),
    });
  });
});

describe("queryParamsConfig (#808)", () => {
  it("is the config's queryParams when any row survives", () => {
    expect(
      queryParamsConfig(rows(["a", "1"], ["", ""], [" b ", "x y"]))
    ).toEqual({ queryParams: { a: "1", b: "x y" } });
  });

  it("leaves the field absent when no row survives", () => {
    expect(queryParamsConfig([])).toEqual({});
    expect(queryParamsConfig(rows(["", ""]))).toEqual({});
  });
});

describe("withSplitPath (#808)", () => {
  it("appends the path's query after existing rows and cleans the path", () => {
    const existing = rows(["a", "1"]);
    const out = withSplitPath({ path: "/x?b=2", queryParams: existing });
    expect(out.path).toBe("/x");
    expect(out.queryParams.map((r) => [r.key, r.value])).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });
});
