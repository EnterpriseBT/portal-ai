import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { WorkbookData } from "@portalai/spreadsheet-parsing";

const cacheGetMock =
  jest.fn<(key: string) => Promise<WorkbookData | null>>();
const findByIdMock =
  jest.fn<
    (id: string) => Promise<{ id: string; organizationId: string } | undefined>
  >();

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    set: jest.fn(async () => undefined),
    get: cacheGetMock,
    delete: jest.fn(async () => undefined),
  },
}));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: {
        findById: findByIdMock,
        update: jest.fn(),
        findByOrgAndDefinition: jest.fn(),
      },
      connectorDefinitions: { findBySlug: jest.fn() },
    },
  },
}));

const { MicrosoftExcelConnectorService } = await import(
  "../../services/microsoft-excel-connector.service.js"
);

function workbookWithSheet(): WorkbookData {
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 2, cols: 2 },
        cells: [
          { row: 0, col: 0, value: "a" },
          { row: 0, col: 1, value: "b" },
          { row: 1, col: 0, value: "c" },
          { row: 1, col: 1, value: "d" },
        ],
        merges: [],
      } as never,
    ],
  } as WorkbookData;
}

// Server-minted sheet id matches `sheet_<index>_<lower-name>`.
const SHEET_ID_0 = "sheet_0_sheet1";

beforeEach(() => {
  cacheGetMock.mockReset();
});

describe("MicrosoftExcelConnectorService.sheetSlice", () => {
  it("throws 404 FILE_UPLOAD_SESSION_NOT_FOUND on cache miss", async () => {
    cacheGetMock.mockResolvedValue(null);
    try {
      await MicrosoftExcelConnectorService.sheetSlice({
        connectorInstanceId: "ci-1",
        sheetId: "0",
        rowStart: 0,
        rowEnd: 5,
        colStart: 0,
        colEnd: 5,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
      expect((err as { code?: string }).code).toBe(
        "FILE_UPLOAD_SESSION_NOT_FOUND"
      );
    }
  });

  it("returns the requested rectangle from the cached workbook", async () => {
    cacheGetMock.mockResolvedValue(workbookWithSheet());
    const out = await MicrosoftExcelConnectorService.sheetSlice({
      connectorInstanceId: "ci-1",
      sheetId: SHEET_ID_0,
      rowStart: 0,
      rowEnd: 1,
      colStart: 0,
      colEnd: 1,
    });
    expect(out.cells).toBeDefined();
    expect(Array.isArray(out.cells)).toBe(true);
  });

  it("throws when the sheet id isn't in the workbook", async () => {
    cacheGetMock.mockResolvedValue(workbookWithSheet());
    try {
      await MicrosoftExcelConnectorService.sheetSlice({
        connectorInstanceId: "ci-1",
        sheetId: "99",
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});

describe("MicrosoftExcelConnectorService.resolveWorkbook", () => {
  beforeEach(() => {
    findByIdMock.mockReset();
  });

  it("throws when instance not found", async () => {
    findByIdMock.mockResolvedValue(undefined);
    try {
      await MicrosoftExcelConnectorService.resolveWorkbook("ci-1", "org-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });

  it("throws 403 when instance belongs to a different org", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-other",
    });
    try {
      await MicrosoftExcelConnectorService.resolveWorkbook("ci-1", "org-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(403);
    }
  });

  it("returns the cached workbook on hit", async () => {
    findByIdMock.mockResolvedValue({ id: "ci-1", organizationId: "org-1" });
    const wb = workbookWithSheet();
    cacheGetMock.mockResolvedValue(wb);

    const out = await MicrosoftExcelConnectorService.resolveWorkbook(
      "ci-1",
      "org-1"
    );
    expect(out).toBe(wb);
  });

  it("throws 404 on cache miss (no fallback)", async () => {
    findByIdMock.mockResolvedValue({ id: "ci-1", organizationId: "org-1" });
    cacheGetMock.mockResolvedValue(null);
    try {
      await MicrosoftExcelConnectorService.resolveWorkbook("ci-1", "org-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});
