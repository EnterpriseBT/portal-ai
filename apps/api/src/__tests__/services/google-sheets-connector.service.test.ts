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

// We don't import the real google-auth.service in these listSheets tests
// (the cache service is mocked end-to-end), but we DO need the
// GoogleAuthError shape exported for `instanceof` checks to line up.
jest.unstable_mockModule("../../services/google-auth.service.js", () => ({
  GoogleAuthService: {
    buildConsentUrl: jest.fn(),
    exchangeCode: jest.fn(),
    fetchUserEmail: jest.fn(),
    refreshAccessToken: jest.fn(),
  },
  GoogleAuthError: MockGoogleAuthError,
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
