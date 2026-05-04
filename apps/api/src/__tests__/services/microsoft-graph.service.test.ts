import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";

import { environment } from "../../environment.js";
import {
  MicrosoftGraphError,
  MicrosoftGraphService,
} from "../../services/microsoft-graph.service.js";

let originalCap: number;

beforeAll(() => {
  originalCap = environment.UPLOAD_MAX_FILE_SIZE_BYTES;
  environment.UPLOAD_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
});

afterAll(() => {
  environment.UPLOAD_MAX_FILE_SIZE_BYTES = originalCap;
});

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface MockResponseInit {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  bodyStream?: ReadableStream<Uint8Array>;
  bodyCancel?: jest.Mock;
}

function mockJsonResponse({
  status = 200,
  body = {},
}: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as unknown as Response;
}

describe("MicrosoftGraphService.searchWorkbooks", () => {
  /** Build a fetch mock that returns a different body per URL. */
  function mockChildren(byUrl: Record<string, unknown>) {
    return jest.fn<typeof fetch>().mockImplementation(async (url) => {
      const key = String(url);
      // Match by the path segment that identifies which folder is being
      // listed (e.g. /items/root/children, /items/01FOLDER/children).
      const matchKey = Object.keys(byUrl).find((p) => key.includes(p));
      if (!matchKey) {
        return mockJsonResponse({
          status: 404,
          body: { error: `unmocked URL: ${key}` },
        });
      }
      return mockJsonResponse({ body: byUrl[matchKey] });
    });
  }

  it("walks /me/drive/items/root/children and returns matching .xlsx files", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          {
            id: "01ABC",
            name: "Q3 Forecast.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-01T12:00:00Z",
            lastModifiedBy: {
              user: { displayName: "Alice" },
            },
          },
          {
            id: "01DEF",
            name: "Macros.xlsm",
            file: { mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12" },
          },
          {
            id: "01GHI",
            name: "Notes.csv",
            file: { mimeType: "text/csv" },
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "",
      fetchMock
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      driveItemId: "01ABC",
      name: "Q3 Forecast.xlsx",
      lastModifiedDateTime: "2026-04-01T12:00:00Z",
      lastModifiedBy: "Alice",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "https://graph.microsoft.com/v1.0/me/drive/items/root/children"
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-x"
    );
  });

  it("recurses into subfolders up to the depth cap", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          { id: "FOLDER1", name: "Reports", folder: { childCount: 1 } },
        ],
      },
      "/items/FOLDER1/children": {
        value: [
          {
            id: "01XYZ",
            name: "nested.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-02T00:00:00Z",
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "",
      fetchMock
    );
    expect(items.map((i) => i.name)).toEqual(["nested.xlsx"]);
  });

  it("filters by case-insensitive filename substring when query is non-empty", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          {
            id: "01A",
            name: "Test Layout.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-01T00:00:00Z",
          },
          {
            id: "01B",
            name: "Reformatted.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-02T00:00:00Z",
          },
          {
            id: "01C",
            name: "Q3 Forecast.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-03T00:00:00Z",
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "test layout",
      fetchMock
    );
    expect(items.map((i) => i.name)).toEqual(["Test Layout.xlsx"]);
  });

  it("returns all .xlsx matches when query is empty", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          {
            id: "01A",
            name: "A.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-01T00:00:00Z",
          },
          {
            id: "01B",
            name: "B.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-02T00:00:00Z",
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "",
      fetchMock
    );
    expect(items).toHaveLength(2);
  });

  it("sorts results by lastModifiedDateTime descending", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          {
            id: "OLD",
            name: "old.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2024-01-01T00:00:00Z",
          },
          {
            id: "NEW",
            name: "new.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-05-04T00:00:00Z",
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "",
      fetchMock
    );
    expect(items.map((i) => i.driveItemId)).toEqual(["NEW", "OLD"]);
  });

  it("falls back to lastModifiedBy: null when displayName is missing", async () => {
    const fetchMock = mockChildren({
      "/items/root/children": {
        value: [
          {
            id: "01ABC",
            name: "Q3.xlsx",
            file: { mimeType: XLSX_MIME },
            lastModifiedDateTime: "2026-04-01T12:00:00Z",
          },
        ],
      },
    });
    const items = await MicrosoftGraphService.searchWorkbooks(
      "token-x",
      "",
      fetchMock
    );
    expect(items[0]?.lastModifiedBy).toBeNull();
  });

  it("throws MicrosoftGraphError('search_failed') on a 4xx", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        mockJsonResponse({ status: 401, body: { error: "Unauthorized" } })
      );
    try {
      await MicrosoftGraphService.searchWorkbooks("token-x", "x", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("search_failed");
    }
  });
});

describe("MicrosoftGraphService.headWorkbook", () => {
  it("requests /me/drive/items/{id} with size+name $select", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockJsonResponse({
        body: { id: "01ABC", name: "Q3.xlsx", size: 1024 },
      })
    );
    const out = await MicrosoftGraphService.headWorkbook(
      "token-x",
      "01ABC",
      fetchMock
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "https://graph.microsoft.com/v1.0/me/drive/items/01ABC"
    );
    expect(url).toContain("$select=size,name");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-x"
    );
    expect(out).toEqual({ size: 1024, name: "Q3.xlsx" });
  });

  it("throws MicrosoftGraphError('head_failed') on a 4xx", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockJsonResponse({ status: 404, body: { error: "Not Found" } })
    );
    try {
      await MicrosoftGraphService.headWorkbook("token-x", "01ABC", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("head_failed");
    }
  });
});

describe("MicrosoftGraphService.downloadWorkbook", () => {
  function streamResponse({
    status = 200,
    contentLength,
  }: {
    status?: number;
    contentLength?: string;
  }): { res: Response; cancelMock: jest.Mock } {
    const cancelMock = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x50, 0x4b])); // ZIP magic
        controller.close();
      },
      cancel: cancelMock as never,
    });
    const res = {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(
        contentLength === undefined ? {} : { "Content-Length": contentLength }
      ),
      body: stream,
      text: async () => "<binary>",
    } as unknown as Response;
    return { res, cancelMock };
  }

  it("returns the response body stream when Content-Length is within the cap", async () => {
    const { res } = streamResponse({ contentLength: "1024" });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);

    const out = await MicrosoftGraphService.downloadWorkbook(
      "token-x",
      "01ABC",
      fetchMock
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/me/drive/items/01ABC/content"
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-x"
    );
    expect(out.contentLength).toBe(1024);
    expect(out.stream).toBeDefined();
  });

  it("throws file_too_large + cancels the stream when Content-Length exceeds the cap", async () => {
    const { res, cancelMock } = streamResponse({
      contentLength: String(60 * 1024 * 1024), // 60 MB > 50 MB cap
    });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);
    try {
      await MicrosoftGraphService.downloadWorkbook(
        "token-x",
        "01ABC",
        fetchMock
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("file_too_large");
    }
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it("throws MicrosoftGraphError('download_failed') on a 4xx", async () => {
    const { res } = streamResponse({ status: 404, contentLength: "100" });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);
    try {
      await MicrosoftGraphService.downloadWorkbook(
        "token-x",
        "01ABC",
        fetchMock
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("download_failed");
    }
  });
});
