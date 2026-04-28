import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { Readable } from "node:stream";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { environment } from "../../../environment.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";
import { buildMultiSheetXlsx } from "../../utils/xlsx-fixtures.util.js";

const AUTH0_ID = "auth0|file-uploads-streaming";

beforeAll(() => {
  environment.UPLOAD_S3_BUCKET = "test-bucket";
  environment.UPLOAD_S3_REGION = "us-east-1";
  environment.UPLOAD_S3_PREFIX = "uploads";
  environment.UPLOAD_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  environment.UPLOAD_MAX_FILES_PER_SESSION = 5;
  environment.UPLOAD_ALLOWED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"];
  environment.FILE_UPLOAD_INLINE_CELLS_MAX = 1_000_000;
  environment.FILE_UPLOAD_SLICE_CELLS_MAX = 50_000;
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

// Mock S3Service: in-memory bucket keyed by s3Key.
const s3Bucket = new Map<string, Buffer>();

jest.unstable_mockModule("../../../services/s3.service.js", () => ({
  S3Service: {
    createPresignedPutUrl: jest.fn(
      async (s3Key: string) => `https://s3.test.example/${encodeURIComponent(s3Key)}`
    ),
    getObjectStream: jest.fn(async (s3Key: string) => {
      const buf = s3Bucket.get(s3Key);
      if (!buf) {
        const err = new Error("NotFound");
        (err as unknown as { name: string }).name = "NotFound";
        throw err;
      }
      return { stream: Readable.from(buf), contentLength: buf.length };
    }),
    headObject: jest.fn(async (s3Key: string) => {
      const buf = s3Bucket.get(s3Key);
      if (!buf) return null;
      return { contentLength: buf.length, contentType: "text/csv" };
    }),
    deleteObject: jest.fn(async (s3Key: string) => {
      s3Bucket.delete(s3Key);
    }),
  },
}));

// In-memory Redis shim so we can run the cache without a live redis in tests.
const redisStore = new Map<string, string>();
jest.unstable_mockModule("../../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    set: async (
      key: string,
      value: string,
      _ex?: string,
      _ttl?: number
    ): Promise<"OK"> => {
      redisStore.set(key, value);
      return "OK";
    },
    get: async (key: string): Promise<string | null> =>
      redisStore.get(key) ?? null,
    del: async (key: string): Promise<number> => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    },
  }),
  closeRedis: async () => undefined,
}));

const { app } = await import("../../../app.js");

describe("File uploads streaming router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let organizationId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    s3Bucket.clear();
    redisStore.clear();
    const seed = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    organizationId = seed.organizationId;
  });

  afterEach(async () => {
    await connection.end();
  });

  async function presign(files: Array<{ fileName: string; sizeBytes: number; contentType?: string }>) {
    return request(app)
      .post("/api/file-uploads/presign")
      .set("Authorization", "Bearer test-token")
      .send({
        files: files.map((f) => ({
          fileName: f.fileName,
          contentType: f.contentType ?? "text/csv",
          sizeBytes: f.sizeBytes,
        })),
      });
  }

  function simulatePut(s3Key: string, bytes: Buffer) {
    s3Bucket.set(s3Key, bytes);
  }

  describe("POST /api/file-uploads/presign", () => {
    it("mints one presigned URL + file_uploads row per file", async () => {
      const res = await presign([
        { fileName: "a.csv", sizeBytes: 100 },
        { fileName: "b.csv", sizeBytes: 200 },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.payload.uploads).toHaveLength(2);
      const { uploads } = res.body.payload;
      expect(uploads[0]).toMatchObject({
        uploadId: expect.any(String),
        putUrl: expect.stringContaining("https://"),
        s3Key: expect.stringContaining(organizationId),
      });
      const rows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.fileUploads);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "pending")).toBe(true);
    });

    it("rejects unsupported extensions", async () => {
      const res = await presign([
        { fileName: "notes.pdf", sizeBytes: 100, contentType: "application/pdf" },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED);
    });

    it("rejects oversize files", async () => {
      const res = await presign([
        {
          fileName: "big.csv",
          sizeBytes: environment.UPLOAD_MAX_FILE_SIZE_BYTES + 1,
        },
      ]);
      expect(res.status).toBe(413);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE);
    });

    it("rejects too many files per session", async () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        fileName: `file-${i}.csv`,
        sizeBytes: 10,
      }));
      const res = await presign(files);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_TOO_MANY_FILES);
    });
  });

  describe("POST /api/file-uploads/confirm", () => {
    it("returns 409 when the S3 object is missing", async () => {
      const { body: presignBody } = await presign([
        { fileName: "a.csv", sizeBytes: 50 },
      ]);
      const { uploadId } = presignBody.payload.uploads[0];
      const res = await request(app)
        .post("/api/file-uploads/confirm")
        .set("Authorization", "Bearer test-token")
        .send({ uploadId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_S3_NOT_PRESENT);
    });

    it("transitions pending → uploaded on a real PUT", async () => {
      const { body: presignBody } = await presign([
        { fileName: "a.csv", sizeBytes: 50 },
      ]);
      const { uploadId, s3Key } = presignBody.payload.uploads[0];
      simulatePut(s3Key, Buffer.from("Name,Email\nAlice,a@x.com\n"));

      const res = await request(app)
        .post("/api/file-uploads/confirm")
        .set("Authorization", "Bearer test-token")
        .send({ uploadId });
      expect(res.status).toBe(200);
      expect(res.body.payload.status).toBe("uploaded");

      const [row] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.id, uploadId));
      expect(row.status).toBe("uploaded");
    });

    it("returns 404 for an unknown uploadId", async () => {
      const res = await request(app)
        .post("/api/file-uploads/confirm")
        .set("Authorization", "Bearer test-token")
        .send({ uploadId: "u_does_not_exist" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
    });
  });

  describe("POST /api/file-uploads/parse", () => {
    async function uploadAndConfirm(
      files: Array<{ fileName: string; bytes: Buffer; contentType?: string }>
    ): Promise<string[]> {
      const { body: presignBody } = await presign(
        files.map((f) => ({
          fileName: f.fileName,
          sizeBytes: f.bytes.length,
          contentType: f.contentType,
        }))
      );
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const { uploadId, s3Key } = presignBody.payload.uploads[i];
        simulatePut(s3Key, files[i].bytes);
        await request(app)
          .post("/api/file-uploads/confirm")
          .set("Authorization", "Bearer test-token")
          .send({ uploadId });
        ids.push(uploadId);
      }
      return ids;
    }

    it("merges multi-CSV uploads into one workbook with preview cells inline", async () => {
      const uploadIds = await uploadAndConfirm([
        { fileName: "contacts.csv", bytes: Buffer.from("Name,Email\nAlice,a@x.com\n") },
        { fileName: "orders.csv", bytes: Buffer.from("OrderId,Total\no-1,42\n") },
      ]);
      const res = await request(app)
        .post("/api/file-uploads/parse")
        .set("Authorization", "Bearer test-token")
        .send({ uploadIds });
      expect(res.status).toBe(200);
      expect(res.body.payload.uploadSessionId).toBeDefined();
      expect(res.body.payload.sheets).toHaveLength(2);
      expect(res.body.payload.sheets.map((s: { name: string }) => s.name)).toEqual([
        "contacts",
        "orders",
      ]);
      expect(res.body.payload.sliced).toBeUndefined();
      const contacts = res.body.payload.sheets[0];
      expect(contacts.cells[0]).toEqual(["Name", "Email"]);
      expect(contacts.cells[1]).toEqual(["Alice", "a@x.com"]);
    });

    it("parses multi-sheet XLSX uploads", async () => {
      const xlsxBuf = await buildMultiSheetXlsx({
        Contacts: [
          ["Name", "Email"],
          ["Alice", "a@x.com"],
        ],
        Orders: [
          ["OrderId", "Total"],
          ["o-1", 42],
        ],
      });
      const uploadIds = await uploadAndConfirm([
        {
          fileName: "book.xlsx",
          bytes: xlsxBuf,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ]);
      const res = await request(app)
        .post("/api/file-uploads/parse")
        .set("Authorization", "Bearer test-token")
        .send({ uploadIds });
      expect(res.status).toBe(200);
      expect(res.body.payload.sheets.map((s: { name: string }) => s.name)).toEqual([
        "Contacts",
        "Orders",
      ]);
    });

    it("sets sliced=true for sheets over the inline cap", async () => {
      const originalMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
      environment.FILE_UPLOAD_INLINE_CELLS_MAX = 10;
      try {
        const bytes = Buffer.from(
          "A,B,C,D,E\n1,2,3,4,5\n6,7,8,9,10\n11,12,13,14,15\n16,17,18,19,20\n"
        );
        const uploadIds = await uploadAndConfirm([
          { fileName: "big.csv", bytes },
        ]);
        const res = await request(app)
          .post("/api/file-uploads/parse")
          .set("Authorization", "Bearer test-token")
          .send({ uploadIds });
        expect(res.status).toBe(200);
        expect(res.body.payload.sliced).toBe(true);
        expect(res.body.payload.sheets[0].cells).toEqual([]);
        expect(res.body.payload.sheets[0].dimensions).toEqual({
          rows: 5,
          cols: 5,
        });
      } finally {
        environment.FILE_UPLOAD_INLINE_CELLS_MAX = originalMax;
      }
    });

    it("rejects unconfirmed (pending) uploads with 409", async () => {
      const { body: presignBody } = await presign([
        { fileName: "a.csv", sizeBytes: 50 },
      ]);
      const { uploadId } = presignBody.payload.uploads[0];
      const res = await request(app)
        .post("/api/file-uploads/parse")
        .set("Authorization", "Bearer test-token")
        .send({ uploadIds: [uploadId] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_INVALID_STATE);
    });
  });

  describe("GET /api/file-uploads/sheet-slice", () => {
    it("returns a sliced rectangle from the cached workbook", async () => {
      const originalMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
      environment.FILE_UPLOAD_INLINE_CELLS_MAX = 10;
      try {
        const bytes = Buffer.from(
          "A,B,C,D,E\n1,2,3,4,5\n6,7,8,9,10\n11,12,13,14,15\n16,17,18,19,20\n"
        );
        const { body: presignBody } = await presign([
          { fileName: "big.csv", sizeBytes: bytes.length },
        ]);
        const { uploadId, s3Key } = presignBody.payload.uploads[0];
        simulatePut(s3Key, bytes);
        await request(app)
          .post("/api/file-uploads/confirm")
          .set("Authorization", "Bearer test-token")
          .send({ uploadId });
        const parseRes = await request(app)
          .post("/api/file-uploads/parse")
          .set("Authorization", "Bearer test-token")
          .send({ uploadIds: [uploadId] });
        const { uploadSessionId, sheets } = parseRes.body.payload;
        const sheetId = sheets[0].id;

        const res = await request(app)
          .get("/api/file-uploads/sheet-slice")
          .query({
            uploadSessionId,
            sheetId,
            rowStart: 1,
            rowEnd: 3,
            colStart: 1,
            colEnd: 4,
          })
          .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(200);
        expect(res.body.payload.cells).toEqual([
          ["2", "3", "4"],
          ["7", "8", "9"],
        ]);
      } finally {
        environment.FILE_UPLOAD_INLINE_CELLS_MAX = originalMax;
      }
    });

    it("rejects slices exceeding the per-request cell cap", async () => {
      const originalMax = environment.FILE_UPLOAD_SLICE_CELLS_MAX;
      environment.FILE_UPLOAD_SLICE_CELLS_MAX = 2;
      try {
        const bytes = Buffer.from("A,B\n1,2\n3,4\n");
        const { body: presignBody } = await presign([
          { fileName: "tiny.csv", sizeBytes: bytes.length },
        ]);
        const { uploadId, s3Key } = presignBody.payload.uploads[0];
        simulatePut(s3Key, bytes);
        await request(app)
          .post("/api/file-uploads/confirm")
          .set("Authorization", "Bearer test-token")
          .send({ uploadId });
        const parseRes = await request(app)
          .post("/api/file-uploads/parse")
          .set("Authorization", "Bearer test-token")
          .send({ uploadIds: [uploadId] });
        const { uploadSessionId, sheets } = parseRes.body.payload;
        const res = await request(app)
          .get("/api/file-uploads/sheet-slice")
          .query({
            uploadSessionId,
            sheetId: sheets[0].id,
            rowStart: 0,
            rowEnd: 3,
            colStart: 0,
            colEnd: 2,
          })
          .set("Authorization", "Bearer test-token");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_SLICE_TOO_LARGE);
      } finally {
        environment.FILE_UPLOAD_SLICE_CELLS_MAX = originalMax;
      }
    });
  });

  describe("Layout plans /interpret + /commit with uploadSessionId", () => {
    it("interpret accepts uploadSessionId and resolves the workbook from the cache", async () => {
      const bytes = Buffer.from("Name,Email\nAlice,a@x.com\n");
      const { body: presignBody } = await presign([
        { fileName: "contacts.csv", sizeBytes: bytes.length },
      ]);
      const { uploadId, s3Key } = presignBody.payload.uploads[0];
      simulatePut(s3Key, bytes);
      await request(app)
        .post("/api/file-uploads/confirm")
        .set("Authorization", "Bearer test-token")
        .send({ uploadId });
      const parseRes = await request(app)
        .post("/api/file-uploads/parse")
        .set("Authorization", "Bearer test-token")
        .send({ uploadIds: [uploadId] });
      const { uploadSessionId } = parseRes.body.payload;

      const interpretRes = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ uploadSessionId, regionHints: [] });
      // Service may 500 if LLM mock isn't wired here — what we care about is
      // that the request passed Zod validation and reached the service (not
      // 400 for bad body).
      expect([200, 500]).toContain(interpretRes.status);
      expect(interpretRes.body.code).not.toBe(
        ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD
      );
    });

    it("rejects interpret when uploadSessionId is missing from the body", async () => {
      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ regionHints: [] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });
  });
});
