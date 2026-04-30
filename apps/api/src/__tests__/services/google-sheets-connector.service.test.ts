import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();

jest.unstable_mockModule(
  "../../services/google-access-token-cache.service.js",
  () => ({
    GoogleAccessTokenCacheService: { getOrRefresh: getOrRefreshMock },
  })
);

class MockGoogleAuthError extends Error {
  override readonly name = "GoogleAuthError" as const;
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

const exchangeCodeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const fetchUserEmailMock =
  jest.fn<(...args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("../../services/google-auth.service.js", () => ({
  GoogleAuthService: {
    buildConsentUrl: jest.fn(),
    exchangeCode: exchangeCodeMock,
    fetchUserEmail: fetchUserEmailMock,
    refreshAccessToken: jest.fn(),
  },
  GoogleAuthError: MockGoogleAuthError,
}));

const verifyStateMock =
  jest.fn<(token: string) => { userId: string; organizationId: string }>();

class MockOAuthStateError extends Error {
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

jest.unstable_mockModule("../../utils/oauth-state.util.js", () => ({
  verifyState: verifyStateMock,
  OAuthStateError: MockOAuthStateError,
  // signState is unused by handleCallback but exported by the real
  // module; provide a stub so any incidental import resolves.
  signState: jest.fn(),
  STATE_TTL_MS: 5 * 60 * 1000,
}));

// Hoisted-before-import db mock — fetchWorkbookForSync looks up the
// instance by id, so the service module must see this mocked version
// of DbService at import time. Adding the mock below the dynamic
// `await import` is too late (ESM module graph already loaded the real
// db.service).
const findInstanceMock = jest.fn<(id: string) => Promise<unknown>>();
const updateInstanceMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const createInstanceMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const findByOrgAndDefinitionMock =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const findDefinitionBySlugMock =
  jest.fn<(slug: string) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: {
        findById: findInstanceMock,
        update: updateInstanceMock,
        create: createInstanceMock,
        findByOrgAndDefinition: findByOrgAndDefinitionMock,
      },
      connectorDefinitions: { findBySlug: findDefinitionBySlugMock },
    },
  },
}));

// Mock the workbook cache too — selectSheet writes to it; in tests we
// only care that it gets called, not what it does.
jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    set: jest.fn(async () => undefined),
    get: jest.fn(async () => null),
    delete: jest.fn(async () => undefined),
  },
}));

const { GoogleSheetsConnectorService } = await import(
  "../../services/google-sheets-connector.service.js"
);

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function mockFetchResponse({ status = 200, body = {} }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as unknown as Response;
}

describe("GoogleSheetsConnectorService.listSheets", () => {
  beforeEach(() => {
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
  });

  it("calls Drive files.list with the spreadsheet mimeType filter and Bearer auth", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: { files: [], nextPageToken: undefined },
      })
    );

    await GoogleSheetsConnectorService.listSheets(
      { connectorInstanceId: "ci-1", search: "", pageToken: undefined },
      fetchMock
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(calledUrl);
    expect(url.host).toBe("www.googleapis.com");
    expect(url.pathname).toBe("/drive/v3/files");
    const q = url.searchParams.get("q") ?? "";
    expect(q).toContain(
      "mimeType='application/vnd.google-apps.spreadsheet'"
    );
    expect(q).toContain("trashed=false");
    expect(q).not.toContain("name contains");
    expect(url.searchParams.get("pageSize")).toBe("25");
    expect(url.searchParams.get("fields")).toContain("files");
    expect(url.searchParams.get("fields")).toContain("nextPageToken");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.access"
    );
  });

  it("appends a name-contains clause when search is non-empty", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(mockFetchResponse({ body: { files: [] } }));
    await GoogleSheetsConnectorService.listSheets(
      { connectorInstanceId: "ci-1", search: "Q3 forecast" },
      fetchMock
    );
    const url = new URL(
      (fetchMock.mock.calls[0] as [string, RequestInit])[0]
    );
    const q = url.searchParams.get("q") ?? "";
    expect(q).toContain("name contains 'Q3 forecast'");
  });

  it("escapes single quotes in the search term", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(mockFetchResponse({ body: { files: [] } }));
    await GoogleSheetsConnectorService.listSheets(
      { connectorInstanceId: "ci-1", search: "O'Brien" },
      fetchMock
    );
    const url = new URL(
      (fetchMock.mock.calls[0] as [string, RequestInit])[0]
    );
    const q = url.searchParams.get("q") ?? "";
    // Drive's `q` syntax escapes single-quote with backslash.
    expect(q).toContain(`name contains 'O\\'Brien'`);
  });

  it("forwards pageToken on subsequent pages", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(mockFetchResponse({ body: { files: [] } }));
    await GoogleSheetsConnectorService.listSheets(
      {
        connectorInstanceId: "ci-1",
        search: "",
        pageToken: "next-page-token-abc",
      },
      fetchMock
    );
    const url = new URL(
      (fetchMock.mock.calls[0] as [string, RequestInit])[0]
    );
    expect(url.searchParams.get("pageToken")).toBe("next-page-token-abc");
  });

  it("maps Drive's `id` to `spreadsheetId` and surfaces ownerEmail in the slim shape", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          files: [
            {
              id: "1abcXYZ",
              name: "Q3 Forecast",
              modifiedTime: "2026-04-29T10:00:00Z",
              owners: [
                {
                  emailAddress: "alice@example.com",
                  displayName: "Alice Example",
                },
              ],
            },
          ],
          nextPageToken: "next-page-789",
        },
      })
    );

    const out = await GoogleSheetsConnectorService.listSheets(
      { connectorInstanceId: "ci-1", search: "" },
      fetchMock
    );

    expect(out).toEqual({
      items: [
        {
          spreadsheetId: "1abcXYZ",
          name: "Q3 Forecast",
          modifiedTime: "2026-04-29T10:00:00Z",
          ownerEmail: "alice@example.com",
        },
      ],
      nextPageToken: "next-page-789",
    });
  });

  it("throws GoogleAuthError('listSheets_failed') on a Drive 4xx", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 403,
        body: { error: { message: "Insufficient Permission" } },
      })
    );

    try {
      await GoogleSheetsConnectorService.listSheets(
        { connectorInstanceId: "ci-1", search: "" },
        fetchMock
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as MockGoogleAuthError).name).toBe("GoogleAuthError");
      expect((err as MockGoogleAuthError).kind).toBe("listSheets_failed");
    }
  });
});

// ── fetchWorkbookForSync (Phase D Slice 3) ─────────────────────────

describe("GoogleSheetsConnectorService.fetchWorkbookForSync", () => {
  beforeEach(() => {
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    findInstanceMock.mockReset();
  });

  function instanceWithConfig(spreadsheetId: string | null): unknown {
    return {
      id: "ci-1",
      organizationId: "org-1",
      config: spreadsheetId ? { spreadsheetId, title: "x" } : null,
    };
  }

  it("reads spreadsheetId from instance.config and calls spreadsheets.get with Bearer auth", async () => {
    findInstanceMock.mockResolvedValue(instanceWithConfig("1abcXYZ"));
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          properties: { title: "Q3 Forecast" },
          sheets: [
            {
              properties: {
                title: "Sheet1",
                gridProperties: { rowCount: 1, columnCount: 1 },
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        {
                          effectiveValue: { stringValue: "alpha" },
                          formattedValue: "alpha",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    );

    const out = await GoogleSheetsConnectorService.fetchWorkbookForSync(
      "ci-1",
      "org-1",
      fetchMock
    );

    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]?.cells[0]?.value).toBe("alpha");
    expect(getOrRefreshMock).toHaveBeenCalledWith("ci-1");
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(
      "https://sheets.googleapis.com/v4/spreadsheets/1abcXYZ"
    );
    expect(calledUrl).toContain("includeGridData=true");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.access"
    );
  });

  it("throws when the instance does not exist", async () => {
    findInstanceMock.mockResolvedValue(undefined);
    await expect(
      GoogleSheetsConnectorService.fetchWorkbookForSync(
        "missing",
        "org-1",
        jest.fn<typeof fetch>()
      )
    ).rejects.toThrow(/not found/i);
  });

  it("throws when the instance belongs to a different organization", async () => {
    findInstanceMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "different-org",
      config: { spreadsheetId: "1abc" },
    });
    await expect(
      GoogleSheetsConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1",
        jest.fn<typeof fetch>()
      )
    ).rejects.toThrow(/different organization/i);
  });

  it("throws when the instance has no spreadsheetId in config (selectSheet never called)", async () => {
    findInstanceMock.mockResolvedValue(instanceWithConfig(null));
    await expect(
      GoogleSheetsConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1",
        jest.fn<typeof fetch>()
      )
    ).rejects.toThrow(/spreadsheetId/i);
  });

  it("throws GoogleAuthError('fetchSheet_failed') on a Sheets 4xx", async () => {
    findInstanceMock.mockResolvedValue(instanceWithConfig("1abc"));
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 404,
        body: { error: { message: "Not found" } },
      })
    );
    try {
      await GoogleSheetsConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1",
        fetchMock
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as MockGoogleAuthError).name).toBe("GoogleAuthError");
      expect((err as MockGoogleAuthError).kind).toBe("fetchSheet_failed");
    }
  });
});

// ── handleCallback (Phase E Slice 1: reconnect resets error state) ─

describe("GoogleSheetsConnectorService.handleCallback", () => {
  const stubTokens = {
    accessToken: "ya29.access",
    refreshToken: "1//refresh",
    scope: "openid email drive.readonly spreadsheets.readonly",
  };
  const stubDefinition = {
    id: "def-gs",
    slug: "google-sheets",
    capabilityFlags: { sync: true, read: true, write: false, push: false },
  };

  beforeEach(() => {
    verifyStateMock.mockReset();
    verifyStateMock.mockReturnValue({
      userId: "user-1",
      organizationId: "org-1",
    });
    exchangeCodeMock.mockReset();
    exchangeCodeMock.mockResolvedValue(stubTokens);
    fetchUserEmailMock.mockReset();
    fetchUserEmailMock.mockResolvedValue("alice@example.com");
    findDefinitionBySlugMock.mockReset();
    findDefinitionBySlugMock.mockResolvedValue(stubDefinition);
    findByOrgAndDefinitionMock.mockReset();
    findByOrgAndDefinitionMock.mockResolvedValue([]);
    updateInstanceMock.mockReset();
    createInstanceMock.mockReset();
  });

  it("resets status to 'active' and clears lastErrorMessage when reconnecting an instance currently in error", async () => {
    findByOrgAndDefinitionMock.mockResolvedValue([
      {
        id: "ci-existing",
        organizationId: "org-1",
        connectorDefinitionId: "def-gs",
        status: "error",
        lastErrorMessage: "invalid_grant: Token has been expired or revoked",
        credentials: { googleAccountEmail: "alice@example.com" },
      },
    ]);
    updateInstanceMock.mockResolvedValue({ id: "ci-existing" });

    await GoogleSheetsConnectorService.handleCallback({
      code: "auth-code",
      state: "signed-state",
    });

    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, calledData] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe("ci-existing");
    expect(calledData.status).toBe("active");
    expect(calledData.lastErrorMessage).toBeNull();
    expect(calledData.credentials).toBeDefined();
  });

  it("does NOT downgrade an already-active instance (reconnect is idempotent)", async () => {
    findByOrgAndDefinitionMock.mockResolvedValue([
      {
        id: "ci-existing",
        organizationId: "org-1",
        connectorDefinitionId: "def-gs",
        status: "active",
        lastErrorMessage: null,
        credentials: { googleAccountEmail: "alice@example.com" },
      },
    ]);
    updateInstanceMock.mockResolvedValue({ id: "ci-existing" });

    await GoogleSheetsConnectorService.handleCallback({
      code: "auth-code",
      state: "signed-state",
    });

    const [, calledData] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledData.status).toBe("active");
    expect(calledData.lastErrorMessage).toBeNull();
  });

  it("first-time authorize creates a new instance with status='pending' (regression)", async () => {
    findByOrgAndDefinitionMock.mockResolvedValue([]);
    createInstanceMock.mockResolvedValue({ id: "ci-new" });

    await GoogleSheetsConnectorService.handleCallback({
      code: "auth-code",
      state: "signed-state",
    });

    expect(updateInstanceMock).not.toHaveBeenCalled();
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    const [calledData] = createInstanceMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(calledData.status).toBe("pending");
    expect(calledData.lastErrorMessage).toBeNull();
  });
});
