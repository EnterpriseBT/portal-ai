import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthMutation: mockUseAuthMutation,
}));

const { microsoftExcel } = await import("../../api/microsoft-excel.api");
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

describe("microsoftExcel.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it("authorize → POST /api/connectors/microsoft-excel/authorize", () => {
    microsoftExcel.authorize();
    expect(mockUseAuthMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/connectors/microsoft-excel/authorize",
      })
    );
  });

  it("exposes a microsoftExcel root query key", () => {
    expect(queryKeys.microsoftExcel.root).toEqual(["microsoftExcel"]);
  });

  describe("searchWorkbooks", () => {
    it("uses GET method, no body, builds the query string", () => {
      microsoftExcel.searchWorkbooks();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        search?: string;
      }>();
      expect(cfg.method).toBe("GET");
      expect(cfg.body?.({ connectorInstanceId: "ci-1" })).toBeUndefined();
      const url = cfg.url as (vars: {
        connectorInstanceId: string;
        search?: string;
      }) => string;
      const built = url({ connectorInstanceId: "ci-1" });
      expect(built).toContain("/api/connectors/microsoft-excel/workbooks?");
      expect(built).toContain("connectorInstanceId=ci-1");
      expect(built).not.toContain("search=");
    });

    it("includes search when non-empty", () => {
      microsoftExcel.searchWorkbooks();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        search?: string;
      }>();
      const url = cfg.url as (vars: {
        connectorInstanceId: string;
        search?: string;
      }) => string;
      const built = url({ connectorInstanceId: "ci-1", search: "Q3" });
      expect(built).toContain("search=Q3");
    });
  });

  describe("selectWorkbook", () => {
    it("POSTs to /instances/:id/select-workbook with only driveItemId in the body", () => {
      microsoftExcel.selectWorkbook();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        driveItemId: string;
      }>();
      const url = cfg.url as (vars: {
        connectorInstanceId: string;
        driveItemId: string;
      }) => string;
      expect(url({ connectorInstanceId: "ci-1", driveItemId: "01ABC" })).toBe(
        "/api/connectors/microsoft-excel/instances/ci-1/select-workbook"
      );
      expect(
        cfg.body?.({ connectorInstanceId: "ci-1", driveItemId: "01ABC" })
      ).toEqual({ driveItemId: "01ABC" });
    });
  });

  describe("sheetSlice", () => {
    it("uses GET method and builds the slice query", () => {
      microsoftExcel.sheetSlice();
      const cfg = lastConfig<{
        connectorInstanceId: string;
        sheetId: string;
        rowStart: number;
        rowEnd: number;
        colStart: number;
        colEnd: number;
      }>();
      expect(cfg.method).toBe("GET");
      const url = cfg.url as (vars: {
        connectorInstanceId: string;
        sheetId: string;
        rowStart: number;
        rowEnd: number;
        colStart: number;
        colEnd: number;
      }) => string;
      const built = url({
        connectorInstanceId: "ci-1",
        sheetId: "sheet_0_q3",
        rowStart: 0,
        rowEnd: 100,
        colStart: 0,
        colEnd: 50,
      });
      expect(built).toContain(
        "/api/connectors/microsoft-excel/instances/ci-1/sheet-slice?"
      );
      expect(built).toContain("sheetId=sheet_0_q3");
      expect(built).toContain("rowStart=0");
      expect(built).toContain("rowEnd=100");
      expect(built).toContain("colStart=0");
      expect(built).toContain("colEnd=50");
    });
  });
});
