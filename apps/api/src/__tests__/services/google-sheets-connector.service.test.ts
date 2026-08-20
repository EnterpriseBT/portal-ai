import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

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
  /** Mirrors the real class — the retry branches on it (#408). */
  readonly status?: number;
  constructor(
    kind: string,
    message?: string,
    options?: ErrorOptions & { status?: number }
  ) {
    super(message ?? kind, options);
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
  }
}

const exchangeCodeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const fetchUserEmailMock = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("../../services/google-auth.service.js", () => ({
  GoogleAuthService: {
    buildConsentUrl: jest.fn(),
    exchangeCode: exchangeCodeMock,
    fetchUserEmail: fetchUserEmailMock,
    refreshAccessToken: jest.fn(),
  },
  GoogleAuthError: MockGoogleAuthError,
}));

const verifyStateMock = jest.fn<
  (token: string) => {
    userId: string;
    organizationId: string;
    connectorInstanceId?: string;
  }
>();

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
const findDefinitionBySlugMock = jest.fn<(slug: string) => Promise<unknown>>();

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

// The chunked-session API `selectSheet` writes through. `set`/`get`/`delete`
// predate it and are kept for the callers that still use them; the session
// members were missing until #408 needed a selectSheet path under test.
// `getSessionMeta` returns a workbook with no sheets so the preview loop is
// a no-op — these tests are about the fetch, not about inflation.
jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    set: jest.fn(async () => undefined),
    get: jest.fn(async () => null),
    delete: jest.fn(async () => undefined),
    deleteSession: jest.fn(async () => undefined),
    beginSession: jest.fn(async () => ({
      appendRows: jest.fn(async () => undefined),
      finishSheet: jest.fn(async () => undefined),
      finalize: jest.fn(async () => undefined),
      fail: jest.fn(async () => undefined),
    })),
    getSessionMeta: jest.fn(async () => ({ sheets: [] })),
  },
}));

const { GoogleSheetsConnectorService } =
  await import("../../services/google-sheets-connector.service.js");

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function mockFetchResponse({ status = 200, body = {} }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

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
    expect(out.sheets[0]?.cell(1, 1)?.value).toBe("alpha");
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

// ── The bounded 404 retry (#408 slice 2) ───────────────────────────
//
// A freshly Picker-granted spreadsheet is readable server-side — G1 proved
// that on the first attempt, with no propagation delay observed. This retry
// is insurance on the unobserved case: on the sync path the cost of a
// too-early read is a dead job, not a click the user can repeat. Bounded to
// one extra attempt and to 404 alone, because a 403 is a rejected scope and
// retrying it only doubles the latency of the failure that matters most.

describe("GoogleSheetsConnectorService — 404 retry on the Sheets read", () => {
  const OK_BODY = {
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
  };

  beforeEach(() => {
    jest.useFakeTimers();
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    findInstanceMock.mockReset();
    findInstanceMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-1",
      config: { spreadsheetId: "1abc", title: "x" },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries a 404 once and succeeds", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        mockFetchResponse({ status: 404, body: { error: { message: "gone" } } })
      )
      .mockResolvedValueOnce(mockFetchResponse({ body: OK_BODY }));

    const promise = GoogleSheetsConnectorService.fetchWorkbookForSync(
      "ci-1",
      "org-1",
      fetchMock
    );
    await jest.advanceTimersByTimeAsync(1_000);
    const out = await promise;

    expect(out.sheets).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exactly two attempts when the 404 persists", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        mockFetchResponse({ status: 404, body: { error: { message: "gone" } } })
      );

    const promise = GoogleSheetsConnectorService.fetchWorkbookForSync(
      "ci-1",
      "org-1",
      fetchMock
    );
    const assertion = expect(promise).rejects.toMatchObject({
      name: "GoogleAuthError",
      kind: "fetchSheet_failed",
      status: 404,
    });
    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a 403 — a rejected scope is not a race", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 403,
        body: { error: { message: "insufficient scope" } },
      })
    );

    await expect(
      GoogleSheetsConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1",
        fetchMock
      )
    ).rejects.toMatchObject({
      name: "GoogleAuthError",
      kind: "fetchSheet_failed",
      status: 403,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies on the selectSheet path too, not only sync", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        mockFetchResponse({ status: 404, body: { error: { message: "gone" } } })
      )
      .mockResolvedValueOnce(mockFetchResponse({ body: OK_BODY }));

    const promise = GoogleSheetsConnectorService.selectSheet(
      {
        connectorInstanceId: "ci-1",
        spreadsheetId: "1abc",
        organizationId: "org-1",
        userId: "u-1",
      },
      fetchMock
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── handleCallback (Phase E Slice 1: reconnect resets error state) ─

describe("GoogleSheetsConnectorService.handleCallback", () => {
  const stubTokens = {
    accessToken: "ya29.access",
    refreshToken: "1//refresh",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
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
    // Reconnect path: the signed state carries the target instance id;
    // the callback hits findById on that id (not findByEmail).
    verifyStateMock.mockReturnValue({
      userId: "user-1",
      organizationId: "org-1",
      connectorInstanceId: "ci-existing",
    });
    findInstanceMock.mockResolvedValue({
      id: "ci-existing",
      organizationId: "org-1",
      connectorDefinitionId: "def-gs",
      status: "error",
      lastErrorMessage: "invalid_grant: Token has been expired or revoked",
      credentials: { googleAccountEmail: "alice@example.com" },
    });
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
    verifyStateMock.mockReturnValue({
      userId: "user-1",
      organizationId: "org-1",
      connectorInstanceId: "ci-existing",
    });
    findInstanceMock.mockResolvedValue({
      id: "ci-existing",
      organizationId: "org-1",
      connectorDefinitionId: "def-gs",
      status: "active",
      lastErrorMessage: null,
      credentials: { googleAccountEmail: "alice@example.com" },
    });
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
    // No `connectorInstanceId` in the signed state → always create new,
    // regardless of whether the same email already has instances.
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

  it("creates a new instance even when the same email already has one (add-connector flow)", async () => {
    // Bare state (no connectorInstanceId) bypasses the email lookup
    // entirely — every authorize without a reconnect target gets a
    // fresh row. Regresses if the old findByEmail path comes back.
    createInstanceMock.mockResolvedValue({ id: "ci-new-2" });

    await GoogleSheetsConnectorService.handleCallback({
      code: "auth-code",
      state: "signed-state",
    });

    expect(updateInstanceMock).not.toHaveBeenCalled();
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
  });
});
