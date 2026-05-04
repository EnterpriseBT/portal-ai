import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();
const searchWorkbooksMock =
  jest.fn<
    (
      accessToken: string,
      query: string
    ) => Promise<
      Array<{
        driveItemId: string;
        name: string;
        lastModifiedDateTime: string;
        lastModifiedBy: string | null;
      }>
    >
  >();

jest.unstable_mockModule(
  "../../services/microsoft-access-token-cache.service.js",
  () => ({
    MicrosoftAccessTokenCacheService: { getOrRefresh: getOrRefreshMock },
  })
);

class MockMicrosoftGraphError extends Error {
  override readonly name = "MicrosoftGraphError" as const;
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

jest.unstable_mockModule("../../services/microsoft-graph.service.js", () => ({
  MicrosoftGraphService: { searchWorkbooks: searchWorkbooksMock },
  MicrosoftGraphError: MockMicrosoftGraphError,
}));

const { MicrosoftExcelConnectorService } = await import(
  "../../services/microsoft-excel-connector.service.js"
);

beforeEach(() => {
  getOrRefreshMock.mockReset();
  searchWorkbooksMock.mockReset();
});

describe("MicrosoftExcelConnectorService.searchWorkbooks", () => {
  it("threads access token + query into the graph call and returns { items }", async () => {
    getOrRefreshMock.mockResolvedValue("access-token-x");
    searchWorkbooksMock.mockResolvedValue([
      {
        driveItemId: "01ABC",
        name: "Q3.xlsx",
        lastModifiedDateTime: "2026-04-01T12:00:00Z",
        lastModifiedBy: "Alice",
      },
    ]);

    const out = await MicrosoftExcelConnectorService.searchWorkbooks({
      connectorInstanceId: "ci-1",
      search: "Q3",
    });

    expect(getOrRefreshMock).toHaveBeenCalledWith("ci-1");
    expect(searchWorkbooksMock).toHaveBeenCalledWith("access-token-x", "Q3");
    expect(out).toEqual({
      items: [
        {
          driveItemId: "01ABC",
          name: "Q3.xlsx",
          lastModifiedDateTime: "2026-04-01T12:00:00Z",
          lastModifiedBy: "Alice",
        },
      ],
    });
  });

  it("defaults search to empty string when not supplied", async () => {
    getOrRefreshMock.mockResolvedValue("access-token-x");
    searchWorkbooksMock.mockResolvedValue([]);

    await MicrosoftExcelConnectorService.searchWorkbooks({
      connectorInstanceId: "ci-1",
    });

    expect(searchWorkbooksMock).toHaveBeenCalledWith("access-token-x", "");
  });
});
