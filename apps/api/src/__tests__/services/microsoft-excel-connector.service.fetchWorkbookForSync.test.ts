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

function fakeWorkbook(): WorkbookData {
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 1, cols: 1 },
        cells: [{ row: 0, col: 0, value: "x" }],
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
  findByIdMock.mockReset();

  getOrRefreshMock.mockResolvedValue("access-token-x");
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

  it("happy path: downloads, parses, returns WorkbookData WITHOUT writing the cache", async () => {
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
    const workbook = fakeWorkbook();
    xlsxToWorkbookMock.mockResolvedValue(workbook);

    const out = await MicrosoftExcelConnectorService.fetchWorkbookForSync(
      "ci-1",
      "org-1"
    );

    expect(out).toBe(workbook);
    expect(getOrRefreshMock).toHaveBeenCalledWith("ci-1");
    expect(headWorkbookMock).toHaveBeenCalledWith("access-token-x", "01ABC");
    expect(downloadWorkbookMock).toHaveBeenCalledWith(
      "access-token-x",
      "01ABC"
    );
    expect(xlsxToWorkbookMock).toHaveBeenCalledTimes(1);
    // Sync wants fresh data on every call — must NOT write the editor
    // session's workbook cache.
    expect(cacheSetMock).not.toHaveBeenCalled();
  });
});
