import { jest, describe, it, expect, beforeEach, beforeAll, afterAll } from "@jest/globals";

import type { WorkbookData } from "@portalai/spreadsheet-parsing";

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
const xlsxToWorkbookMock =
  jest.fn<(stream: unknown) => Promise<WorkbookData>>();

const cacheSetMock = jest.fn(async () => undefined);
const cacheGetMock =
  jest.fn<(key: string) => Promise<WorkbookData | null>>();

const updateInstanceMock =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

class MockMicrosoftGraphError extends Error {
  override readonly name = "MicrosoftGraphError" as const;
  readonly kind: string;
  readonly details?: Record<string, unknown>;
  constructor(kind: string, message?: string, details?: Record<string, unknown>) {
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
    xlsxToWorkbook: xlsxToWorkbookMock,
  })
);

jest.unstable_mockModule("../../services/workbook-cache.service.js", () => ({
  WorkbookCacheService: {
    set: cacheSetMock,
    get: cacheGetMock,
    delete: jest.fn(async () => undefined),
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

function fakeWorkbook(): WorkbookData {
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 2, cols: 1 },
        cells: [
          { row: 0, col: 0, value: "header" },
          { row: 1, col: 0, value: "row1" },
        ],
        merges: [],
      } as never,
    ],
  } as WorkbookData;
}

beforeEach(() => {
  getOrRefreshMock.mockReset();
  headWorkbookMock.mockReset();
  downloadWorkbookMock.mockReset();
  xlsxToWorkbookMock.mockReset();
  cacheSetMock.mockReset();
  cacheGetMock.mockReset();
  updateInstanceMock.mockReset();

  getOrRefreshMock.mockResolvedValue("access-token-x");
});

describe("MicrosoftExcelConnectorService.selectWorkbook", () => {
  const baseInput = {
    connectorInstanceId: "ci-1",
    driveItemId: "01ABC",
    organizationId: "org-1",
    userId: "user-1",
  };

  it("happy path: parses workbook, caches it, updates config, returns inline preview", async () => {
    headWorkbookMock.mockResolvedValue({ size: 1024, name: "Q3 Forecast.xlsx" });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });
    xlsxToWorkbookMock.mockResolvedValue(fakeWorkbook());

    const out = await MicrosoftExcelConnectorService.selectWorkbook(baseInput);

    expect(headWorkbookMock).toHaveBeenCalledWith("access-token-x", "01ABC");
    expect(downloadWorkbookMock).toHaveBeenCalledWith(
      "access-token-x",
      "01ABC"
    );
    expect(xlsxToWorkbookMock).toHaveBeenCalledTimes(1);
    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    const [cacheKey] = cacheSetMock.mock.calls[0] as unknown as [
      string,
      unknown,
    ];
    expect(cacheKey).toBe("connector:wb:microsoft-excel:ci-1");

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
    expect((patch.config as { fetchedAt: number }).fetchedAt).toBeGreaterThan(0);
    expect(patch.updatedBy).toBe("user-1");

    // Title is the workbook name with the .xlsx extension stripped.
    expect(out.title).toBe("Q3 Forecast");
    expect(out.sheets).toHaveLength(1);
  });

  it("throws 413 MICROSOFT_EXCEL_FILE_TOO_LARGE BEFORE the download is attempted", async () => {
    // 60 MB > the test's 50 MB cap; head must short-circuit.
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
      const details = (err as { details?: Record<string, unknown> }).details;
      expect(details?.sizeBytes).toBe(60 * 1024 * 1024);
      expect(typeof details?.capBytes).toBe("number");
    }

    expect(downloadWorkbookMock).not.toHaveBeenCalled();
    expect(xlsxToWorkbookMock).not.toHaveBeenCalled();
    expect(cacheSetMock).not.toHaveBeenCalled();
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

  it("title falls back to the workbook name when no .xlsx extension is present (defensive)", async () => {
    // The extension validation should reject this before we get here, but
    // confirm the extension-stripping code is bounded — the test sets up
    // a name that passes the lower-case .xlsx check.
    headWorkbookMock.mockResolvedValue({ size: 1024, name: "data.XLSX" });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });
    xlsxToWorkbookMock.mockResolvedValue(fakeWorkbook());

    const out = await MicrosoftExcelConnectorService.selectWorkbook(baseInput);
    expect(out.title).toBe("data");
  });
});
