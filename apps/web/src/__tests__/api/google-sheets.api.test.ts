import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthMutation: mockUseAuthMutation,
}));

const { googleSheets } = await import("../../api/google-sheets.api");
const { queryKeys } = await import("../../api/keys");

type MutationCfg<TVars> = {
  url: string | ((vars: TVars) => string);
  method?: string;
  body?: (vars: TVars) => unknown;
};

function lastConfig<TVars>(): MutationCfg<TVars> {
  const calls = mockUseAuthMutation.mock.calls;
  return calls[calls.length - 1]?.[0] as MutationCfg<TVars>;
}

describe("googleSheets.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  describe("authorize", () => {
    it("mutates POST to /api/connectors/google-sheets/authorize", () => {
      googleSheets.authorize();
      expect(mockUseAuthMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/connectors/google-sheets/authorize",
        })
      );
    });
  });

  describe("searchSheets", () => {
    it("uses GET method with no body, builds the query string", () => {
      googleSheets.searchSheets();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        search?: string;
        pageToken?: string;
      }>();
      expect(cfg.method).toBe("GET");
      expect(cfg.body?.({ connectorInstanceId: "ci-1" })).toBeUndefined();

      const url = cfg.url as (
        vars: {
          connectorInstanceId: string;
          search?: string;
          pageToken?: string;
        }
      ) => string;
      const built = url({ connectorInstanceId: "ci-1" });
      expect(built).toContain("/api/connectors/google-sheets/sheets?");
      expect(built).toContain("connectorInstanceId=ci-1");
      expect(built).not.toContain("search=");
      expect(built).not.toContain("pageToken=");
    });

    it("includes search and pageToken when provided", () => {
      googleSheets.searchSheets();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        search?: string;
        pageToken?: string;
      }>();
      const url = cfg.url as (
        vars: {
          connectorInstanceId: string;
          search?: string;
          pageToken?: string;
        }
      ) => string;
      const built = url({
        connectorInstanceId: "ci-1",
        search: "Q3 forecast",
        pageToken: "page-2",
      });
      // URLSearchParams encodes spaces as +; either + or %20 is acceptable.
      expect(built).toContain("connectorInstanceId=ci-1");
      expect(built.includes("search=Q3+forecast") || built.includes("search=Q3%20forecast")).toBe(
        true
      );
      expect(built).toContain("pageToken=page-2");
    });

    it("omits search when it's an empty string", () => {
      googleSheets.searchSheets();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        search?: string;
      }>();
      const url = cfg.url as (
        vars: { connectorInstanceId: string; search?: string }
      ) => string;
      const built = url({ connectorInstanceId: "ci-1", search: "" });
      expect(built).not.toContain("search=");
    });
  });

  describe("selectSheet", () => {
    it("POSTs to /instances/:id/select-sheet with the connectorInstanceId in path", () => {
      googleSheets.selectSheet();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        spreadsheetId: string;
      }>();
      const url = cfg.url as (
        vars: { connectorInstanceId: string; spreadsheetId: string }
      ) => string;
      expect(url({ connectorInstanceId: "ci-1", spreadsheetId: "s1" })).toBe(
        "/api/connectors/google-sheets/instances/ci-1/select-sheet"
      );
      // Default method is POST → no explicit method arg.
      expect(cfg.method).toBeUndefined();
    });

    it("body strips connectorInstanceId so only { spreadsheetId } is sent", () => {
      googleSheets.selectSheet();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        spreadsheetId: string;
      }>();
      const body = cfg.body!({
        connectorInstanceId: "ci-1",
        spreadsheetId: "s1",
      });
      expect(body).toEqual({ spreadsheetId: "s1" });
    });
  });

  describe("sheetSlice", () => {
    it("GETs /instances/:id/sheet-slice with all rectangle params and no body", () => {
      googleSheets.sheetSlice();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        sheetId: string;
        rowStart: number;
        rowEnd: number;
        colStart: number;
        colEnd: number;
      }>();
      expect(cfg.method).toBe("GET");
      expect(
        cfg.body?.({
          connectorInstanceId: "ci-1",
          sheetId: "s",
          rowStart: 0,
          rowEnd: 5,
          colStart: 0,
          colEnd: 5,
        })
      ).toBeUndefined();

      const url = cfg.url as (
        vars: {
          connectorInstanceId: string;
          sheetId: string;
          rowStart: number;
          rowEnd: number;
          colStart: number;
          colEnd: number;
        }
      ) => string;
      const built = url({
        connectorInstanceId: "ci-1",
        sheetId: "sheet_0_forecast",
        rowStart: 0,
        rowEnd: 20,
        colStart: 0,
        colEnd: 10,
      });
      expect(built).toContain(
        "/api/connectors/google-sheets/instances/ci-1/sheet-slice?"
      );
      expect(built).toContain("sheetId=sheet_0_forecast");
      expect(built).toContain("rowStart=0");
      expect(built).toContain("rowEnd=20");
      expect(built).toContain("colStart=0");
      expect(built).toContain("colEnd=10");
      // connectorInstanceId is in the path, not a duplicate query param.
      expect(built.match(/connectorInstanceId/g)).toBeNull();
    });
  });
});

describe("queryKeys.googleSheets", () => {
  it("exposes a root key", () => {
    expect(queryKeys.googleSheets.root).toEqual(["googleSheets"]);
  });
});
