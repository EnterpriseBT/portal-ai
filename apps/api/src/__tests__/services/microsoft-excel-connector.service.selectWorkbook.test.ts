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
const downloadWorkbookMock = jest.fn<
  (
    accessToken: string,
    driveItemId: string
  ) => Promise<{
    stream: ReadableStream<Uint8Array>;
    contentLength: number;
  }>
>();
const xlsxToCacheMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const beginSessionMock = jest.fn<(prefix: string) => Promise<SessionWriter>>();
const getSessionMetaMock =
  jest.fn<(prefix: string) => Promise<SessionMeta | null>>();
const readRowsMock =
  jest.fn<
    (
      prefix: string,
      sheetId: string,
      rowStart: number,
      rowEnd: number
    ) => AsyncIterable<ChunkRow>
  >();
const deleteSessionMock = jest.fn(async () => undefined);

const updateInstanceMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();

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
        findById: jest.fn(),
        update: updateInstanceMock,
        findByOrgAndDefinition: jest.fn(),
      },
      connectorDefinitions: { findBySlug: jest.fn() },
    },
  },
}));

const { MicrosoftExcelConnectorService } =
  await import("../../services/microsoft-excel-connector.service.js");

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
  updateInstanceMock.mockReset();

  getOrRefreshMock.mockResolvedValue("access-token-x");
  beginSessionMock.mockImplementation(async () => makeNoopWriter());
  xlsxToCacheMock.mockResolvedValue([]);
});

describe("MicrosoftExcelConnectorService.selectWorkbook", () => {
  const baseInput = {
    connectorInstanceId: "ci-1",
    driveItemId: "01ABC",
    organizationId: "org-1",
    userId: "user-1",
  };

  it("happy path: streams parse via chunked cache, updates config, returns inline preview", async () => {
    headWorkbookMock.mockResolvedValue({
      size: 1024,
      name: "Q3 Forecast.xlsx",
    });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });
    // Seed the meta + rows the inline-preview reader will see.
    getSessionMetaMock.mockResolvedValue(
      meta([
        {
          sheetId: "sheet_0_Sheet1",
          name: "Sheet1",
          rowCount: 1,
          colCount: 1,
        },
      ])
    );
    readRowsMock.mockReturnValue(rowsAsync([["x"]]));

    const out = await MicrosoftExcelConnectorService.selectWorkbook(baseInput);

    expect(headWorkbookMock).toHaveBeenCalledWith("access-token-x", "01ABC");
    expect(downloadWorkbookMock).toHaveBeenCalledWith(
      "access-token-x",
      "01ABC"
    );
    expect(xlsxToCacheMock).toHaveBeenCalledTimes(1);

    // The connector calls deleteSession to clear any stale prior session
    // before opening the new one + finalizing.
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "connector:wb:microsoft-excel:ci-1"
    );
    const beginPrefix = beginSessionMock.mock.calls[0]?.[0] as string;
    expect(beginPrefix).toBe("connector:wb:microsoft-excel:ci-1");

    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, patch] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe("ci-1");
    expect(patch.config).toMatchObject({
      driveItemId: "01ABC",
      name: "Q3 Forecast.xlsx",
    });
    expect((patch.config as { fetchedAt: number }).fetchedAt).toBeGreaterThan(
      0
    );
    expect(patch.updatedBy).toBe("user-1");

    // Title is the workbook name with the .xlsx extension stripped.
    expect(out.title).toBe("Q3 Forecast");
    expect(out.sheets).toHaveLength(1);
  });

  it("throws 413 MICROSOFT_EXCEL_FILE_TOO_LARGE BEFORE the download is attempted", async () => {
    headWorkbookMock.mockResolvedValue({
      size: 60 * 1024 * 1024,
      name: "Huge.xlsx",
    });

    try {
      await MicrosoftExcelConnectorService.selectWorkbook(baseInput);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(413);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_FILE_TOO_LARGE"
      );
    }

    expect(downloadWorkbookMock).not.toHaveBeenCalled();
    expect(xlsxToCacheMock).not.toHaveBeenCalled();
    expect(beginSessionMock).not.toHaveBeenCalled();
  });

  it("throws 415 MICROSOFT_EXCEL_UNSUPPORTED_FORMAT for non-.xlsx files", async () => {
    headWorkbookMock.mockResolvedValue({
      size: 1024,
      name: "Macros.xlsm",
    });

    try {
      await MicrosoftExcelConnectorService.selectWorkbook(baseInput);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(415);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_UNSUPPORTED_FORMAT"
      );
    }
    expect(downloadWorkbookMock).not.toHaveBeenCalled();
  });

  it("title falls back to the workbook name with mixed-case .XLSX extension stripped", async () => {
    headWorkbookMock.mockResolvedValue({ size: 1024, name: "data.XLSX" });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });
    getSessionMetaMock.mockResolvedValue(meta([]));

    const out = await MicrosoftExcelConnectorService.selectWorkbook(baseInput);
    expect(out.title).toBe("data");
  });
});
