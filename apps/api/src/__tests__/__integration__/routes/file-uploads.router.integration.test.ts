import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { FileUploadParseResponsePayloadSchema } from "@portalai/core/contracts";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { environment } from "../../../environment.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";
import { buildSingleSheetXlsx, buildMultiSheetXlsx } from "../../utils/xlsx-fixtures.util.js";

const AUTH0_ID = "auth0|file-upload-parse-user";

beforeAll(() => {
  environment.FILE_UPLOAD_PARSE_MAX_BYTES = 25 * 1024 * 1024;
});

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

describe("POST /api/file-uploads/parse", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("returns a Workbook for a simple CSV upload", async () => {
    const csv = "Name,Email\nAlice,alice@example.com\nBob,bob@example.com\n";

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from(csv, "utf-8"), {
        filename: "contacts.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const parsed = FileUploadParseResponsePayloadSchema.safeParse(res.body.payload);
    expect(parsed.success).toBe(true);

    const workbook = res.body.payload.workbook;
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0].name).toBe("contacts");
    expect(workbook.sheets[0].dimensions.rows).toBe(3);
    expect(workbook.sheets[0].dimensions.cols).toBe(2);
    expect(workbook.sheets[0].cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, col: 1, value: "Name" }),
        expect.objectContaining({ row: 2, col: 1, value: "Alice" }),
        expect.objectContaining({ row: 3, col: 2, value: "bob@example.com" }),
      ])
    );
  });

  it("returns a multi-sheet Workbook for an XLSX upload", async () => {
    const buf = await buildMultiSheetXlsx({
      Contacts: [
        ["Name", "Email"],
        ["Alice", "alice@example.com"],
      ],
      Orders: [
        ["OrderId", "Total"],
        ["o-1", 42],
      ],
    });

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", buf, {
        filename: "book.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.workbook.sheets.map((s: { name: string }) => s.name)).toEqual([
      "Contacts",
      "Orders",
    ]);
  });

  it("parses Latin-1 CSV using the adapter's chardet fallback", async () => {
    const latin1 = Buffer.from("Name,Notes\nCafé,résumé\n", "latin1");

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", latin1, {
        filename: "unicode.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.workbook.sheets[0].cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, col: 1 }),
      ])
    );
  });

  it("rejects an empty file with FILE_UPLOAD_PARSE_EMPTY", async () => {
    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from(""), {
        filename: "empty.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_EMPTY);
  });

  it("rejects an unsupported extension with FILE_UPLOAD_PARSE_UNSUPPORTED", async () => {
    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from("hello"), {
        filename: "notes.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED);
  });

  it("rejects a missing file field with FILE_UPLOAD_PARSE_INVALID_PAYLOAD", async () => {
    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .field("foo", "bar");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD);
  });

  it("rejects a file exceeding FILE_UPLOAD_PARSE_MAX_BYTES with FILE_UPLOAD_PARSE_TOO_LARGE", async () => {
    const originalMax = environment.FILE_UPLOAD_PARSE_MAX_BYTES;
    environment.FILE_UPLOAD_PARSE_MAX_BYTES = 128;
    try {
      const csv = Buffer.alloc(512, "A".charCodeAt(0));
      const res = await request(app)
        .post("/api/file-uploads/parse")
        .set("Authorization", "Bearer test-token")
        .attach("file", csv, {
          filename: "too-big.csv",
          contentType: "text/csv",
        });

      expect(res.status).toBe(413);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE);
    } finally {
      environment.FILE_UPLOAD_PARSE_MAX_BYTES = originalMax;
    }
  });

  it("returns a valid workbook for an XLSX with one sheet", async () => {
    const buf = await buildSingleSheetXlsx("Only", [
      ["A", "B"],
      ["1", "2"],
    ]);

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", buf, {
        filename: "single.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(res.status).toBe(200);
    const parsed = FileUploadParseResponsePayloadSchema.safeParse(res.body.payload);
    expect(parsed.success).toBe(true);
  });

  it("merges sheets from multiple CSV files into a single workbook", async () => {
    const csvA = "Name,Email\nAlice,alice@example.com\n";
    const csvB = "OrderId,Total\no-1,42\n";

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from(csvA, "utf-8"), {
        filename: "contacts.csv",
        contentType: "text/csv",
      })
      .attach("file", Buffer.from(csvB, "utf-8"), {
        filename: "orders.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.workbook.sheets.map((s: { name: string }) => s.name)).toEqual([
      "contacts",
      "orders",
    ]);
  });

  it("merges multi-sheet XLSX files alongside CSV files in upload order", async () => {
    const xlsxBuf = await buildMultiSheetXlsx({
      Contacts: [
        ["Name", "Email"],
        ["Alice", "alice@example.com"],
      ],
      Orders: [
        ["OrderId", "Total"],
        ["o-1", 42],
      ],
    });
    const csv = "Region,Amount\nNA,100\n";

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", xlsxBuf, {
        filename: "book.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .attach("file", Buffer.from(csv, "utf-8"), {
        filename: "regions.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.workbook.sheets.map((s: { name: string }) => s.name)).toEqual([
      "Contacts",
      "Orders",
      "regions",
    ]);
  });

  it("disambiguates duplicate sheet names across files with a numeric suffix", async () => {
    const xlsxA = await buildSingleSheetXlsx("Sheet1", [
      ["a", "b"],
      ["1", "2"],
    ]);
    const xlsxB = await buildSingleSheetXlsx("Sheet1", [
      ["c", "d"],
      ["3", "4"],
    ]);

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", xlsxA, {
        filename: "first.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .attach("file", xlsxB, {
        filename: "second.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.workbook.sheets.map((s: { name: string }) => s.name)).toEqual([
      "Sheet1",
      "Sheet1 (2)",
    ]);
  });

  it("rejects when one of multiple files has an unsupported extension", async () => {
    const csv = "Name\nAlice\n";

    const res = await request(app)
      .post("/api/file-uploads/parse")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from(csv, "utf-8"), {
        filename: "ok.csv",
        contentType: "text/csv",
      })
      .attach("file", Buffer.from("hello"), {
        filename: "notes.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED);
  });
});
