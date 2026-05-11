import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type {
  ChunkRow,
  SessionMeta,
  SheetChunkMeta,
} from "../../services/workbook-cache.service.js";

const findByIdMock =
  jest.fn<
    (id: string) => Promise<{ id: string; organizationId: string } | undefined>
  >();
const getSessionMetaMock =
  jest.fn<(prefix: string) => Promise<SessionMeta | null>>();
const readRowsMock = jest.fn<
  (
    prefix: string,
    sheetId: string,
    rowStart: number,
    rowEnd: number
  ) => AsyncIterable<ChunkRow>
>();

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    getSessionMeta: getSessionMetaMock,
    readRows: readRowsMock,
    getMerges: jest.fn(async () => []),
    beginSession: jest.fn(),
    deleteSession: jest.fn(async () => undefined),
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

function meta(sheets: SheetChunkMeta[]): SessionMeta {
  return { sheets, status: "ready", createdAt: 0 };
}

function rowsAsync(rows: ChunkRow[]): AsyncIterable<ChunkRow> {
  return (async function* () {
    for (const r of rows) yield r;
  })();
}

const SHEET_ID_0 = "sheet_0_sheet1";

beforeEach(() => {
  getSessionMetaMock.mockReset();
  readRowsMock.mockReset();
  findByIdMock.mockReset();
});

describe("MicrosoftExcelConnectorService.sheetSlice", () => {
  it("throws 404 FILE_UPLOAD_SESSION_NOT_FOUND on cache miss", async () => {
    getSessionMetaMock.mockResolvedValue(null);
    try {
      await MicrosoftExcelConnectorService.sheetSlice({
        connectorInstanceId: "ci-1",
        sheetId: SHEET_ID_0,
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

  it("returns the requested rectangle from the chunked cache", async () => {
    getSessionMetaMock.mockResolvedValue(
      meta([
        {
          sheetId: SHEET_ID_0,
          name: "Sheet1",
          rowCount: 2,
          colCount: 2,
        },
      ])
    );
    // Mirror the contract: readRows yields rows in [rowStart, rowEnd) only.
    const all: ChunkRow[] = [
      ["a", "b"],
      ["c", "d"],
    ];
    readRowsMock.mockImplementation((_prefix, _sheetId, rowStart, rowEnd) =>
      rowsAsync(all.slice(rowStart, rowEnd))
    );

    const out = await MicrosoftExcelConnectorService.sheetSlice({
      connectorInstanceId: "ci-1",
      sheetId: SHEET_ID_0,
      rowStart: 0,
      rowEnd: 1,
      colStart: 0,
      colEnd: 1,
    });
    expect(out.cells).toEqual([["a"]]);
  });

  it("throws when the sheet id isn't in the workbook", async () => {
    getSessionMetaMock.mockResolvedValue(
      meta([
        {
          sheetId: SHEET_ID_0,
          name: "Sheet1",
          rowCount: 2,
          colCount: 2,
        },
      ])
    );
    try {
      await MicrosoftExcelConnectorService.sheetSlice({
        connectorInstanceId: "ci-1",
        sheetId: "sheet_99_unknown",
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

  it("reassembles the workbook from chunks on cache hit", async () => {
    findByIdMock.mockResolvedValue({ id: "ci-1", organizationId: "org-1" });
    getSessionMetaMock.mockResolvedValue(
      meta([
        {
          sheetId: SHEET_ID_0,
          name: "Sheet1",
          rowCount: 2,
          colCount: 2,
        },
      ])
    );
    readRowsMock.mockReturnValue(
      rowsAsync([
        ["a", "b"],
        ["c", "d"],
      ])
    );

    const out = await MicrosoftExcelConnectorService.resolveWorkbook(
      "ci-1",
      "org-1"
    );
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]?.dimensions).toEqual({ rows: 2, cols: 2 });
    expect(out.sheets[0]?.cells.map((c) => `${c.row}:${c.col}=${c.value}`).sort()).toEqual([
      "1:1=a",
      "1:2=b",
      "2:1=c",
      "2:2=d",
    ]);
  });

  it("throws 404 when meta is missing or not ready (no fallback)", async () => {
    findByIdMock.mockResolvedValue({ id: "ci-1", organizationId: "org-1" });
    getSessionMetaMock.mockResolvedValue(null);
    try {
      await MicrosoftExcelConnectorService.resolveWorkbook("ci-1", "org-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});
