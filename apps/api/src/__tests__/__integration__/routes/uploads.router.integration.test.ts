import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "@jest/globals";
import crypto from "crypto";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { environment } from "../../../environment.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|upload-test-user";

// Set ENCRYPTION_KEY before anything imports crypto.util
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
let _originalEncryptionKey: string | undefined;

beforeAll(() => {
  _originalEncryptionKey = environment.ENCRYPTION_KEY;
  environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

  // Set S3 config for tests
  environment.UPLOAD_S3_BUCKET = "test-bucket";
  environment.UPLOAD_S3_REGION = "us-east-1";
  environment.UPLOAD_S3_PREFIX = "uploads";
  environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC = 900;
  environment.UPLOAD_MAX_FILE_SIZE_MB = 50;
  environment.UPLOAD_MAX_FILES = 5;
  environment.UPLOAD_ALLOWED_EXTENSIONS = [".csv"];
});

// Mock the auth middleware
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

// Mock Auth0Service
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

// Mock S3Service to avoid real AWS calls
const mockCreatePresignedUpload = jest.fn<(s3Key: string, contentType: string, expiresIn: number) => Promise<string>>();
const mockHeadObject = jest.fn<(s3Key: string) => Promise<{ contentLength: number; contentType: string } | null>>();

jest.unstable_mockModule("../../../services/s3.service.js", () => ({
  S3Service: {
    createPresignedUpload: mockCreatePresignedUpload,
    headObject: mockHeadObject,
  },
}));

// Mock BullMQ queue
const mockQueueAdd = jest.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: "bull-job-1" });
jest.unstable_mockModule("../../../queues/jobs.queue.js", () => ({
  jobsQueue: {
    add: mockQueueAdd,
  },
  JOBS_QUEUE_NAME: "test-async-jobs",
}));

const { app } = await import("../../../app.js");

const { jobs } = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createJob(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    type: "file_upload" as const,
    status: "pending" as const,
    progress: 0,
    metadata: {
      files: [
        {
          originalName: "test.csv",
          s3Key: `uploads/${organizationId}/job-1/test.csv`,
          sizeBytes: 1024,
        },
      ],
      organizationId,
      connectorDefinitionId: "cdef_csv01",
    },
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    bullJobId: null,
    attempts: 0,
    maxAttempts: 3,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Uploads Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);

    // Reset mocks
    mockCreatePresignedUpload.mockReset();
    mockHeadObject.mockReset();
    mockQueueAdd.mockReset();

    // Default mock implementations
    mockCreatePresignedUpload.mockResolvedValue("https://s3.amazonaws.com/test-presigned-url");
    mockHeadObject.mockResolvedValue({ contentLength: 1024, contentType: "text/csv" });
    mockQueueAdd.mockResolvedValue({ id: "bull-job-1" });
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── POST /api/uploads/presign ─────────────────────────────────

  describe("POST /api/uploads/presign", () => {
    it("should return presigned URLs for valid files", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "contacts.csv", contentType: "text/csv", sizeBytes: 1024 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.jobId).toBeDefined();
      expect(res.body.payload.uploads).toHaveLength(1);
      expect(res.body.payload.uploads[0].fileName).toBe("contacts.csv");
      expect(res.body.payload.uploads[0].s3Key).toContain("contacts.csv");
      expect(res.body.payload.uploads[0].presignedUrl).toBe("https://s3.amazonaws.com/test-presigned-url");
      expect(res.body.payload.uploads[0].expiresIn).toBe(900);
    });

    it("should return presigned URLs for multiple files", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "a.csv", contentType: "text/csv", sizeBytes: 100 },
            { fileName: "b.csv", contentType: "text/csv", sizeBytes: 200 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.payload.uploads).toHaveLength(2);
      expect(mockCreatePresignedUpload).toHaveBeenCalledTimes(2);
    });

    it("should create a pending job in the database", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "contacts.csv", contentType: "text/csv", sizeBytes: 1024 },
          ],
        });

      expect(res.status).toBe(200);

      // Verify job exists in DB via the jobs API
      const jobId = res.body.payload.jobId;
      const jobRes = await request(app)
        .get(`/api/jobs/${jobId}`)
        .set("Authorization", "Bearer test-token");

      expect(jobRes.status).toBe(200);
      expect(jobRes.body.payload.job.id).toBe(jobId);
      expect(jobRes.body.payload.job.status).toBe("pending");
      expect(jobRes.body.payload.job.type).toBe("file_upload");
    });

    it("should return 400 for empty files array", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for invalid file extension", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "data.xlsx", contentType: "application/vnd.openxmlformats", sizeBytes: 1024 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_FILE_TYPE);
    });

    it("should return 400 for oversized files", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "huge.csv", contentType: "text/csv", sizeBytes: 100 * 1024 * 1024 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_FILE_TOO_LARGE);
    });

    it("should return 400 for too many files", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const files = Array.from({ length: 6 }, (_, i) => ({
        fileName: `file${i}.csv`,
        contentType: "text/csv",
        sizeBytes: 100,
      }));

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_TOO_MANY_FILES);
    });

    it("should return 400 for invalid request body", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_PAYLOAD);
    });

    it("should return 500 when S3 presign fails", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      mockCreatePresignedUpload.mockRejectedValue(new Error("S3 unavailable"));

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId: "org_123",
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "contacts.csv", contentType: "text/csv", sizeBytes: 1024 },
          ],
        });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe(ApiCode.UPLOAD_S3_ERROR);
    });
  });

  // ── POST /api/uploads/:jobId/process ──────────────────────────

  describe("POST /api/uploads/:jobId/process", () => {
    it("should enqueue a job when files exist in S3", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.job.id).toBe(job.id);
      expect(mockHeadObject).toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "file_upload",
        expect.objectContaining({ jobId: job.id, type: "file_upload" })
      );
    });

    it("should return 404 when job does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post(`/api/uploads/${generateId()}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.JOB_NOT_FOUND);
    });

    it("should return 403 when job belongs to different org", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const differentOrgId = generateId();
      const job = createJob(differentOrgId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ApiCode.JOB_UNAUTHORIZED);
    });

    it("should return 400 when job is not pending", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createJob(organizationId, { status: "active" });
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_JOB_NOT_PENDING);
    });

    it("should return 400 when files are missing from S3", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      mockHeadObject.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_FILE_MISSING);
    });

    it("should store bullJobId after successful enqueue", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/process`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(202);
      expect(res.body.payload.job.bullJobId).toBe("bull-job-1");
    });
  });
});
