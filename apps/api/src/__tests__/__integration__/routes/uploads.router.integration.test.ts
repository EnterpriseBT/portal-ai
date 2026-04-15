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
  environment.UPLOAD_ALLOWED_EXTENSIONS = [".csv", ".xlsx"];
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

// Mock JobEventsService to avoid Redis dependency
const mockTransition = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockPublishCustomEvent = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockUpdateProgress = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule("../../../services/job-events.service.js", () => ({
  JobEventsService: {
    transition: mockTransition,
    publishCustomEvent: mockPublishCustomEvent,
    updateProgress: mockUpdateProgress,
  },
}));

const { app } = await import("../../../app.js");

const { jobs, connectorDefinitions, connectorInstances, connectorEntities, columnDefinitions, fieldMappings } = schema;

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
    mockTransition.mockReset().mockResolvedValue(undefined);
    mockPublishCustomEvent.mockReset().mockResolvedValue(undefined);

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
            { fileName: "data.pdf", contentType: "application/pdf", sizeBytes: 1024 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_FILE_TYPE);
    });

    it("should accept .xlsx files (per default allowed extensions)", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
      const organizationId = "org_123";
      mockCreatePresignedUpload.mockResolvedValue("https://s3.amazonaws.com/test-bucket/uploads/...");

      const res = await request(app)
        .post("/api/uploads/presign")
        .set("Authorization", "Bearer test-token")
        .send({
          organizationId,
          connectorDefinitionId: "cdef_csv01",
          files: [
            { fileName: "workbook.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 4096 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.uploads[0].fileName).toBe("workbook.xlsx");
      expect(res.body.payload.uploads[0].s3Key).toContain("workbook.xlsx");
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

  // ── POST /api/uploads/:jobId/confirm ────────────────────────────

  describe("POST /api/uploads/:jobId/confirm", () => {
    const CONNECTOR_DEF_ID = "cdef_csv01";
    const NAME_COL_DEF_ID = "coldef_name";
    const EMAIL_COL_DEF_ID = "coldef_email";

    function createConfirmBody(overrides?: Partial<Record<string, unknown>>) {
      return {
        connectorInstanceName: "My CSV Import",
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                existingColumnDefinitionId: NAME_COL_DEF_ID,
                format: null,
                isPrimaryKey: false,
                required: true,
                normalizedKey: "name",
              },
              {
                sourceField: "Email",
                existingColumnDefinitionId: EMAIL_COL_DEF_ID,
                format: "email",
                isPrimaryKey: true,
                required: true,
                normalizedKey: "email",
              },
            ],
          },
        ],
        ...overrides,
      };
    }

    async function seedConnectorDefinition(db: ReturnType<typeof drizzle>) {
      await db.insert(connectorDefinitions).values({
        id: CONNECTOR_DEF_ID,
        slug: "csv",
        display: "CSV Upload",
        category: "file",
        authType: "none",
        configSchema: {},
        capabilityFlags: { sync: false, query: false, write: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }

    async function seedColumnDefs(db: ReturnType<typeof drizzle>, organizationId: string) {
      const base = {
        organizationId,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await db.insert(columnDefinitions).values([
        { ...base, id: NAME_COL_DEF_ID, key: "name", label: "Name", type: "string" } as never,
        { ...base, id: EMAIL_COL_DEF_ID, key: "email", label: "Email", type: "string" } as never,
      ]);
    }

    function createAwaitingJob(
      organizationId: string,
      overrides?: Partial<Record<string, unknown>>
    ) {
      return createJob(organizationId, {
        status: "awaiting_confirmation",
        progress: 80,
        result: {
          parseResults: [],
          recommendations: {
            connectorInstanceName: "My CSV",
            entities: [],
          },
        },
        ...overrides,
      });
    }

    it("should return 409 if job not in awaiting_confirmation", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedColumnDefs(db as ReturnType<typeof drizzle>, organizationId);

      const job = createJob(organizationId, { status: "completed" });
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(createConfirmBody());

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_STATE);
    });

    it("should return 400 for invalid request body", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_PAYLOAD);
    });

    it("should return 400 for invalid column definition references", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                existingColumnDefinitionId: "nonexistent-col-def",
                format: null,
                isPrimaryKey: false,
                required: true,
                normalizedKey: "name",
              },
            ],
          },
        ],
      });

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.UPLOAD_INVALID_REFERENCE);
    });

    it("should return 200 with confirmed entity summary on success", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);
      await seedColumnDefs(db as ReturnType<typeof drizzle>, organizationId);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(createConfirmBody());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const payload = res.body.payload;
      expect(payload.connectorInstanceId).toBeDefined();
      expect(payload.connectorInstanceName).toBe("My CSV Import");
      expect(payload.confirmedEntities).toHaveLength(1);

      const entity = payload.confirmedEntities[0];
      expect(entity.connectorEntityId).toBeDefined();
      expect(entity.entityKey).toBe("contacts");
      expect(entity.entityLabel).toBe("Contacts");
      expect(entity.columnDefinitions).toHaveLength(2);
      expect(entity.fieldMappings).toHaveLength(2);

      // Verify column definitions created
      expect(entity.columnDefinitions[0].key).toBe("name");
      expect(entity.columnDefinitions[1].key).toBe("email");

      // Verify field mappings
      expect(entity.fieldMappings[0].sourceField).toBe("Name");
      expect(entity.fieldMappings[0].isPrimaryKey).toBe(false);
      expect(entity.fieldMappings[1].sourceField).toBe("Email");
      expect(entity.fieldMappings[1].isPrimaryKey).toBe(true);

      // Verify SSE events were emitted
      expect(mockTransition).toHaveBeenCalledWith(
        job.id,
        "completed",
        expect.objectContaining({ progress: 100 })
      );
      expect(mockPublishCustomEvent).toHaveBeenCalledWith(
        job.id,
        "complete",
        expect.objectContaining({
          confirmedEntities: expect.arrayContaining([entity.connectorEntityId]),
        })
      );
    });

    it("should create records in database on success", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);
      await seedColumnDefs(db as ReturnType<typeof drizzle>, organizationId);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(createConfirmBody());

      expect(res.status).toBe(200);
      const payload = res.body.payload;

      // Verify connector instance in DB
      const [ci] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorInstances)
        .where(
          (await import("drizzle-orm")).eq(
            connectorInstances.id,
            payload.connectorInstanceId
          )
        );
      expect(ci).toBeDefined();
      expect(ci.name).toBe("My CSV Import");
      expect(ci.organizationId).toBe(organizationId);
      expect(ci.enabledCapabilityFlags).toEqual({ read: true, write: true });

      // Verify connector entity in DB
      const ceRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorEntities)
        .where(
          (await import("drizzle-orm")).eq(
            connectorEntities.connectorInstanceId,
            payload.connectorInstanceId
          )
        );
      expect(ceRows).toHaveLength(1);
      expect(ceRows[0].key).toBe("contacts");

      // Verify column definitions in DB
      const cdRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(columnDefinitions)
        .where(
          (await import("drizzle-orm")).eq(
            columnDefinitions.organizationId,
            organizationId
          )
        );
      expect(cdRows.length).toBeGreaterThanOrEqual(2);
      const cdKeys = cdRows.map((cd) => cd.key);
      expect(cdKeys).toContain("name");
      expect(cdKeys).toContain("email");

      // Verify field mappings in DB
      const fmRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(fieldMappings)
        .where(
          (await import("drizzle-orm")).eq(
            fieldMappings.connectorEntityId,
            payload.confirmedEntities[0].connectorEntityId
          )
        );
      expect(fmRows).toHaveLength(2);
    });

    it("should not duplicate records on idempotent re-submit", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);
      await seedColumnDefs(db as ReturnType<typeof drizzle>, organizationId);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const body = createConfirmBody();

      // First confirm
      const res1 = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);
      expect(res1.status).toBe(200);

      // Reset job back to awaiting_confirmation for re-submit
      await (db as ReturnType<typeof drizzle>)
        .update(jobs)
        .set({ status: "awaiting_confirmation" } as never)
        .where(
          (await import("drizzle-orm")).eq(jobs.id, job.id)
        );

      // Second confirm (idempotent)
      const res2 = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);
      expect(res2.status).toBe(200);

      // Verify no duplicates: only 1 connector entity, 2 column defs, 2 field mappings
      const ceRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(connectorEntities)
        .where(
          (await import("drizzle-orm")).eq(
            connectorEntities.connectorInstanceId,
            res2.body.payload.connectorInstanceId
          )
        );
      expect(ceRows).toHaveLength(1);

      const cdRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(columnDefinitions)
        .where(
          (await import("drizzle-orm")).eq(
            columnDefinitions.organizationId,
            organizationId
          )
        );
      // Should have exactly 2, not 4
      expect(cdRows).toHaveLength(2);
    });

    it("should persist refEntityKey and refNormalizedKey on field mapping for directly specified references", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);

      const roleIdColDefId = generateId();
      const base = {
        organizationId,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          { ...base, id: roleIdColDefId, key: "role_id", label: "Role ID", type: "reference" } as never,
        ]);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "test.csv",
            columns: [
              {
                sourceField: "role_id",
                existingColumnDefinitionId: roleIdColDefId,
                format: null,
                isPrimaryKey: false,
                required: false,
                normalizedKey: "role_id",
                refEntityKey: "roles",
                refNormalizedKey: "role_pk",
              },
            ],
          },
        ],
      });

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);

      expect(res.status).toBe(200);

      const { eq } = await import("drizzle-orm");

      const [fmRow] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.columnDefinitionId, roleIdColDefId));

      expect(fmRow).toBeDefined();
      expect(fmRow.refEntityKey).toBe("roles");
      expect(fmRow.refNormalizedKey).toBe("role_pk");
    });

    it("should persist refNormalizedKey directly from confirm payload", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);

      const rolePkColDefId = generateId();
      const userRoleIdColDefId = generateId();
      const base = {
        organizationId,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values([
          { ...base, id: rolePkColDefId, key: "role_pk", label: "Role PK", type: "string" } as never,
          { ...base, id: userRoleIdColDefId, key: "user_role_id", label: "User Role ID", type: "reference" } as never,
        ]);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "roles",
            entityLabel: "Roles",
            sourceFileName: "test.csv",
            columns: [
              {
                sourceField: "id",
                existingColumnDefinitionId: rolePkColDefId,
                format: null,
                isPrimaryKey: true,
                required: true,
                normalizedKey: "role_pk",
              },
            ],
          },
          {
            entityKey: "users",
            entityLabel: "Users",
            sourceFileName: "test.csv",
            columns: [
              {
                sourceField: "role_id",
                existingColumnDefinitionId: userRoleIdColDefId,
                format: null,
                isPrimaryKey: false,
                required: false,
                normalizedKey: "user_role_id",
                refEntityKey: "roles",
                refNormalizedKey: "role_pk",
              },
            ],
          },
        ],
      });

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);

      expect(res.status).toBe(200);

      const { eq } = await import("drizzle-orm");

      const [fmRow] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.columnDefinitionId, userRoleIdColDefId));

      expect(fmRow).toBeDefined();
      expect(fmRow.refEntityKey).toBe("roles");
      expect(fmRow.refNormalizedKey).toBe("role_pk");
    });

    it("should handle shared columns across entities without duplicates", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedConnectorDefinition(db as ReturnType<typeof drizzle>);

      // Pre-seed one column definition shared by both entities
      const fullNameColDefId = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(columnDefinitions)
        .values({
          id: fullNameColDefId,
          organizationId,
          key: "full_name",
          label: "Full Name",
          type: "string",
          description: null,
          validationPattern: null,
          validationMessage: null,
          canonicalFormat: null,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      const job = createAwaitingJob(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(jobs)
        .values(job as never);

      const body = createConfirmBody({
        entities: [
          {
            entityKey: "contacts",
            entityLabel: "Contacts",
            sourceFileName: "contacts.csv",
            columns: [
              {
                sourceField: "Name",
                existingColumnDefinitionId: fullNameColDefId,
                format: null,
                isPrimaryKey: false,
                required: true,
                normalizedKey: "full_name",
              },
            ],
          },
          {
            entityKey: "leads",
            entityLabel: "Leads",
            sourceFileName: "leads.csv",
            columns: [
              {
                sourceField: "Lead Name",
                existingColumnDefinitionId: fullNameColDefId,
                format: null,
                isPrimaryKey: false,
                required: true,
                normalizedKey: "full_name",
              },
            ],
          },
        ],
      });

      const res = await request(app)
        .post(`/api/uploads/${job.id}/confirm`)
        .set("Authorization", "Bearer test-token")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.payload.confirmedEntities).toHaveLength(2);

      // Both entities should reference the same column definition
      const entity1ColDefId = res.body.payload.confirmedEntities[0].columnDefinitions[0].id;
      const entity2ColDefId = res.body.payload.confirmedEntities[1].columnDefinitions[0].id;
      expect(entity1ColDefId).toBe(entity2ColDefId);
      expect(entity1ColDefId).toBe(fullNameColDefId);
    });
  });
});
