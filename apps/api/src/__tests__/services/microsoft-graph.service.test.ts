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

function mockJsonResponse({ status = 200, body = {} }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const REQUEST_ID = "70b8fc83-f668-4a90-93c5-a4b047468145";

/**
 * Microsoft Graph's error envelope. `innerError.request-id` is the field
 * that must never reach a user-facing message — every no-drive assertion
 * below checks for its absence.
 */
function graphErrorBody(code: string, message: string) {
  return {
    error: {
      code,
      message,
      innerError: {
        date: "2026-08-20T16:06:06",
        "request-id": REQUEST_ID,
        "client-request-id": REQUEST_ID,
      },
    },
  };
}

/** The exact 400 an Entra tenant with no SharePoint Online license returns. */
const SPO_LICENSE_BODY = graphErrorBody(
  "BadRequest",
  "Tenant does not have a SPO license."
);

/** Asserts a thrown error leaks neither the Graph body nor its request id. */
function expectNoLeakedBody(err: unknown) {
  const { message } = err as MicrosoftGraphError;
  expect(message).not.toContain(REQUEST_ID);
  expect(message).not.toContain('{"error"');
  expect(message).not.toContain("innerError");
}

async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected throw");
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
            file: {
              mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
            },
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
        value: [{ id: "FOLDER1", name: "Reports", folder: { childCount: 1 } }],
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

  /**
   * No-drive classification. The root `/children` probe is the only
   * request that can distinguish "this account has no drive" from
   * "that folder is gone", so rules keyed on 404/403 apply here and
   * nowhere else.
   */
  describe("no-drive classification", () => {
    function mockRootError(status: number, body: unknown) {
      return jest
        .fn<typeof fetch>()
        .mockResolvedValue(mockJsonResponse({ status, body }));
    }

    it("classifies the SPO-license 400 at the drive root as no_drive", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(400, SPO_LICENSE_BODY)
        )
      );
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("no_drive");
    });

    it("carries remedy copy and leaks neither the Graph body nor its request id", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(400, SPO_LICENSE_BODY)
        )
      );
      const { message } = err as MicrosoftGraphError;
      expect(message).toContain("no OneDrive");
      expect(message).toContain("Reconnect");
      expectNoLeakedBody(err);
    });

    it("classifies a 404 ResourceNotFound at the drive root as no_drive", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(
            404,
            graphErrorBody("ResourceNotFound", "User's mysite not found.")
          )
        )
      );
      expect((err as MicrosoftGraphError).kind).toBe("no_drive");
    });

    it("classifies a 403 accessDenied at the drive root as no_drive", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(
            403,
            graphErrorBody("accessDenied", "Access denied to the drive.")
          )
        )
      );
      expect((err as MicrosoftGraphError).kind).toBe("no_drive");
    });

    it("does NOT classify a 404 on a descended folder as no_drive", async () => {
      // Root lists one folder successfully; the subfolder 404s. The account
      // demonstrably HAS a drive — only that folder is gone.
      const fetchMock = jest
        .fn<typeof fetch>()
        .mockImplementation(async (url) => {
          if (String(url).includes("/items/root/children")) {
            return mockJsonResponse({
              body: {
                value: [
                  { id: "FOLDER1", name: "Reports", folder: { childCount: 1 } },
                ],
              },
            });
          }
          return mockJsonResponse({
            status: 404,
            body: graphErrorBody("ResourceNotFound", "Item not found."),
          });
        });
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks("token-x", "", fetchMock)
      );
      expect((err as MicrosoftGraphError).kind).toBe("search_failed");
    });

    it("fails open on a 400 with a different error.code", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(
            400,
            graphErrorBody(
              "invalidRequest",
              "Tenant does not have a SPO license."
            )
          )
        )
      );
      expect((err as MicrosoftGraphError).kind).toBe("search_failed");
    });

    it("fails open on a BadRequest 400 whose message is unrelated", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(
            400,
            graphErrorBody("BadRequest", "Invalid $select clause.")
          )
        )
      );
      expect((err as MicrosoftGraphError).kind).toBe("search_failed");
    });

    it("fails open on a non-JSON body without throwing from the parser", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(400, "<html>502 Bad Gateway</html>")
        )
      );
      expect(err).toBeInstanceOf(MicrosoftGraphError);
      expect((err as MicrosoftGraphError).kind).toBe("search_failed");
    });

    it("omits the response body from a search_failed message", async () => {
      const err = await captureThrow(() =>
        MicrosoftGraphService.searchWorkbooks(
          "token-x",
          "",
          mockRootError(500, graphErrorBody("internalError", "Whoops."))
        )
      );
      expect((err as MicrosoftGraphError).message).toBe(
        "Microsoft Graph children failed (500)"
      );
      expectNoLeakedBody(err);
    });
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
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
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

  it("classifies the SPO-license 400 as no_drive", async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        mockJsonResponse({ status: 400, body: SPO_LICENSE_BODY })
      );
    const err = await captureThrow(() =>
      MicrosoftGraphService.headWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).kind).toBe("no_drive");
  });

  it("does NOT classify an item-level 404 as no_drive — that workbook is simply gone", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockJsonResponse({
        status: 404,
        body: graphErrorBody(
          "itemNotFound",
          "The resource could not be found."
        ),
      })
    );
    const err = await captureThrow(() =>
      MicrosoftGraphService.headWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).kind).toBe("head_failed");
  });

  it("omits the response body from a head_failed message", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockJsonResponse({
        status: 500,
        body: graphErrorBody("internalError", "Whoops."),
      })
    );
    const err = await captureThrow(() =>
      MicrosoftGraphService.headWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).message).toBe(
      "Microsoft Graph head failed (500)"
    );
    expectNoLeakedBody(err);
  });
});

describe("MicrosoftGraphService.downloadWorkbook", () => {
  function streamResponse({
    status = 200,
    contentLength,
    errorBody,
  }: {
    status?: number;
    contentLength?: string;
    /** Graph error envelope for the non-ok cases; defaults to `<binary>`. */
    errorBody?: unknown;
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
      text: async () =>
        errorBody === undefined ? "<binary>" : JSON.stringify(errorBody),
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

  it("classifies the SPO-license 400 as no_drive", async () => {
    const { res } = streamResponse({
      status: 400,
      contentLength: "100",
      errorBody: SPO_LICENSE_BODY,
    });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);
    const err = await captureThrow(() =>
      MicrosoftGraphService.downloadWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).kind).toBe("no_drive");
  });

  it("does NOT classify an item-level 403 as no_drive", async () => {
    const { res } = streamResponse({
      status: 403,
      contentLength: "100",
      errorBody: graphErrorBody("accessDenied", "Access denied to the item."),
    });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);
    const err = await captureThrow(() =>
      MicrosoftGraphService.downloadWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).kind).toBe("download_failed");
  });

  it("omits the response body from a download_failed message", async () => {
    const { res } = streamResponse({
      status: 500,
      contentLength: "100",
      errorBody: graphErrorBody("internalError", "Whoops."),
    });
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(res);
    const err = await captureThrow(() =>
      MicrosoftGraphService.downloadWorkbook("token-x", "01ABC", fetchMock)
    );
    expect((err as MicrosoftGraphError).message).toBe(
      "Microsoft Graph download failed (500)"
    );
    expectNoLeakedBody(err);
  });
});
