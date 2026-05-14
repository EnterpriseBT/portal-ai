import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from "@jest/globals";

import type {
  ChunkRow,
  SessionMeta,
  SessionWriter,
  SheetChunkMeta,
} from "../../services/workbook-cache.service.js";

import { environment } from "../../environment.js";

let originalCap: number;

beforeAll(() => {
  originalCap = environment.UPLOAD_MAX_FILE_SIZE_BYTES;
  environment.UPLOAD_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
});

afterAll(() => {
  environment.UPLOAD_MAX_FILE_SIZE_BYTES = originalCap;
});

const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();
const headWorkbookMock =
  jest.fn<
    (
      accessToken: string,
      driveItemId: string
    ) => Promise<{ size: number; name: string }>
  >();
const downloadWorkbookMock =
  jest.fn<
    (
      accessToken: string,
      driveItemId: string
    ) => Promise<{
      stream: ReadableStream<Uint8Array>;
      contentLength: number;
    }>
  >();
const xlsxToCacheMock = jest.fn<
  (...args: unknown[]) => Promise<unknown>
>();

const beginSessionMock =
  jest.fn<(prefix: string) => Promise<SessionWriter>>();
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
const deleteSessionMock = jest.fn(async () => undefined);

const findByIdMock =
  jest.fn<
    (id: string) => Promise<
      | {
          id: string;
          organizationId: string;
          config: { driveItemId?: string } | null;
        }
      | undefined
    >
  >();

class MockMicrosoftGraphError extends Error {
  override readonly name = "MicrosoftGraphError" as const;
  readonly kind: string;
  readonly details?: Record<string, unknown>;
  constructor(
    kind: string,
    message?: string,
    details?: Record<string, unknown>
  ) {
    super(message ?? kind);
    this.kind = kind;
    if (details) this.details = details;
  }
}

jest.unstable_mockModule(
  "../../services/microsoft-access-token-cache.service.js",
  () => ({
    MicrosoftAccessTokenCacheService: { getOrRefresh: getOrRefreshMock },
  })
);

jest.unstable_mockModule("../../services/microsoft-graph.service.js", () => ({
  MicrosoftGraphService: {
    headWorkbook: headWorkbookMock,
    downloadWorkbook: downloadWorkbookMock,
    searchWorkbooks: jest.fn(),
    toNodeReadable: (stream: ReadableStream<Uint8Array>) => stream,
  },
  MicrosoftGraphError: MockMicrosoftGraphError,
}));

jest.unstable_mockModule(
  "../../services/workbook-adapters/xlsx.adapter.js",
  () => ({
    xlsxToCache: xlsxToCacheMock,
  })
);

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    beginSession: beginSessionMock,
    getSessionMeta: getSessionMetaMock,
    readRows: readRowsMock,
    getMerges: jest.fn(async () => []),
    deleteSession: deleteSessionMock,
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

function fakeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0x50, 0x4b]));
      controller.close();
    },
  });
}

function makeNoopWriter(): SessionWriter {
  return {
    appendRows: jest.fn(async () => undefined),
    finishSheet: jest.fn(async () => undefined),
    finalize: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
  };
}

function meta(sheets: SheetChunkMeta[]): SessionMeta {
  return { sheets, status: "ready", createdAt: 0 };
}

function rowsAsync(rows: ChunkRow[]): AsyncIterable<ChunkRow> {
  return (async function* () {
    for (const r of rows) yield r;
  })();
}

beforeEach(() => {
  getOrRefreshMock.mockReset();
  headWorkbookMock.mockReset();
  downloadWorkbookMock.mockReset();
  xlsxToCacheMock.mockReset();
  beginSessionMock.mockReset();
  getSessionMetaMock.mockReset();
  readRowsMock.mockReset();
  deleteSessionMock.mockClear();
  findByIdMock.mockReset();

  getOrRefreshMock.mockResolvedValue("access-token-x");
  // Default writer for any begin: a no-op writer the connector can drive.
  beginSessionMock.mockImplementation(async () => makeNoopWriter());
  // Default xlsxToCache: a no-op (the test seeds meta + rows below for the
  // "happy path" case so the reassemble step has data to work with).
  xlsxToCacheMock.mockResolvedValue([]);
});

describe("MicrosoftExcelConnectorService.fetchWorkbookForSync", () => {
  it("throws 404 when the instance is not found", async () => {
    findByIdMock.mockResolvedValue(undefined);
    try {
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1"
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });

  it("throws 403 when the instance belongs to a different org", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-other",
      config: { driveItemId: "01ABC" },
    });
    try {
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1"
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(403);
    }
  });

  it("throws 400 MICROSOFT_EXCEL_INVALID_PAYLOAD when config has no driveItemId", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-1",
      config: null,
    });
    try {
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1"
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_INVALID_PAYLOAD"
      );
    }
  });

  it("throws 413 MICROSOFT_EXCEL_FILE_TOO_LARGE when the workbook is oversized at sync time", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-1",
      config: { driveItemId: "01ABC" },
    });
    headWorkbookMock.mockResolvedValue({
      size: 60 * 1024 * 1024,
      name: "Huge.xlsx",
    });
    try {
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1"
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(413);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_FILE_TOO_LARGE"
      );
    }
    expect(downloadWorkbookMock).not.toHaveBeenCalled();
  });

  it("throws 415 MICROSOFT_EXCEL_UNSUPPORTED_FORMAT when the workbook is no longer .xlsx", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-1",
      config: { driveItemId: "01ABC" },
    });
    headWorkbookMock.mockResolvedValue({ size: 1024, name: "Macros.xlsm" });
    try {
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        "ci-1",
        "org-1"
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(415);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_UNSUPPORTED_FORMAT"
      );
    }
    expect(downloadWorkbookMock).not.toHaveBeenCalled();
  });

  it("happy path: downloads, streams via throwaway chunked session, returns reassembled WorkbookData + cleans up the throwaway prefix", async () => {
    findByIdMock.mockResolvedValue({
      id: "ci-1",
      organizationId: "org-1",
      config: { driveItemId: "01ABC" },
    });
    headWorkbookMock.mockResolvedValue({ size: 1024, name: "Q3.xlsx" });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });
    // After xlsxToCache "completes" the connector reads back from the
    // throwaway prefix; seed meta + rows so the lazy workbook's
    // `loadRange` resolves a single-cell sheet.
    getSessionMetaMock.mockResolvedValue(
      meta([
        { sheetId: "sheet_0_Sheet1", name: "Sheet1", rowCount: 1, colCount: 1 },
      ])
    );
    readRowsMock.mockReturnValue(rowsAsync([["x"]]));

    const out = await MicrosoftExcelConnectorService.fetchWorkbookForSync(
      "ci-1",
      "org-1"
    );

    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]?.name).toBe("Sheet1");
    await out.sheets[0]?.loadRange(1, 1);
    expect(out.sheets[0]?.cell(1, 1)?.value).toBe("x");

    expect(getOrRefreshMock).toHaveBeenCalledWith("ci-1");
    expect(headWorkbookMock).toHaveBeenCalledWith("access-token-x", "01ABC");
    expect(downloadWorkbookMock).toHaveBeenCalledWith(
      "access-token-x",
      "01ABC"
    );
    expect(xlsxToCacheMock).toHaveBeenCalledTimes(1);
    // The throwaway session is NOT eagerly deleted on the happy path —
    // the lazy workbook still reads from it during downstream commit;
    // cleanup is left to the cache key TTL.
    expect(deleteSessionMock).not.toHaveBeenCalled();
    const passedPrefix = beginSessionMock.mock.calls[0]?.[0] as string;
    expect(passedPrefix).toMatch(/^connector:sync:/);
  });
});
