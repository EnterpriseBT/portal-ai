import {
  JobModel,
  JobModelFactory,
  JobSchema,
  JobStatusEnum,
  JobTypeEnum,
  FileUploadMetadataSchema,
  FileUploadFileSchema,
  FileUploadJobModel,
  FileUploadJobModelFactory,
  TERMINAL_JOB_STATUSES,
} from "../../models/job.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";
import type { Job } from "../../models/job.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Builds a complete, valid Job object from a partial. */
function buildValidJob(overrides: Partial<Job> = {}): Partial<Job> {
  return {
    id: "job-1",
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    type: "file_upload",
    status: "pending",
    progress: 0,
    metadata: {},
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    bullJobId: null,
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

// ── JobSchema ────────────────────────────────────────────────────────

describe("JobSchema", () => {
  it("should parse a valid job object", () => {
    const data = buildValidJob();
    const result = JobSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject missing required fields", () => {
    const result = JobSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject an invalid status value", () => {
    const result = JobSchema.safeParse(buildValidJob({ status: "unknown" as never }));
    expect(result.success).toBe(false);
  });

  it("should reject an invalid type value", () => {
    const result = JobSchema.safeParse(buildValidJob({ type: "invalid_type" as never }));
    expect(result.success).toBe(false);
  });

  it("should accept nullable fields as null", () => {
    const result = JobSchema.safeParse(
      buildValidJob({
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        bullJobId: null,
      })
    );
    expect(result.success).toBe(true);
  });

  it("should accept result as a record", () => {
    const result = JobSchema.safeParse(
      buildValidJob({ result: { recordsSynced: 42 } })
    );
    expect(result.success).toBe(true);
  });

  it("should accept metadata as a record", () => {
    const result = JobSchema.safeParse(
      buildValidJob({ metadata: { connectorId: "c-1", batch: 5 } })
    );
    expect(result.success).toBe(true);
  });
});

// ── JobStatusEnum ────────────────────────────────────────────────────

describe("JobStatusEnum", () => {
  it.each(["pending", "active", "completed", "failed", "stalled", "cancelled", "awaiting_confirmation"])(
    "should accept '%s'",
    (status) => {
      expect(JobStatusEnum.safeParse(status).success).toBe(true);
    }
  );

  it("should reject an unknown status", () => {
    expect(JobStatusEnum.safeParse("running").success).toBe(false);
  });

  it("awaiting_confirmation should not be a terminal status", () => {
    expect(TERMINAL_JOB_STATUSES).not.toContain("awaiting_confirmation");
  });
});

// ── JobTypeEnum ──────────────────────────────────────────────────────

describe("JobTypeEnum", () => {
  it("should accept 'file_upload'", () => {
    expect(JobTypeEnum.safeParse("file_upload").success).toBe(true);
  });

  it("should reject an unknown type", () => {
    expect(JobTypeEnum.safeParse("data_import").success).toBe(false);
  });
});

// ── JobModelFactory ──────────────────────────────────────────────────

describe("JobModelFactory", () => {
  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const factory = new JobModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      expect(factory).toBeInstanceOf(JobModelFactory);
    });
  });

  describe("create", () => {
    let factory: JobModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("job-id");
      factory = new JobModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a JobModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(JobModel);
    });

    it("should assign the generated id", () => {
      const model = factory.create("user-1");
      expect(model.toJSON().id).toBe("job-id-1");
    });

    it("should set createdBy", () => {
      const model = factory.create("admin-42");
      expect(model.toJSON().createdBy).toBe("admin-42");
    });

    it("should set a created timestamp", () => {
      const before = Date.now();
      const model = factory.create("user-1");
      const after = Date.now();
      const created = model.toJSON().created;

      expect(created).toBeDefined();
      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(after);
    });

    it("should not set updated, updatedBy, deleted, or deletedBy", () => {
      const json = factory.create("user-1").toJSON();

      expect(json.updated).toBeNull();
      expect(json.updatedBy).toBeNull();
      expect(json.deleted).toBeNull();
      expect(json.deletedBy).toBeNull();
    });

    it("should produce unique ids across multiple calls", () => {
      const defaultFactory = new JobModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce UUID-formatted ids with the default IDFactory", () => {
      const defaultFactory = new JobModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose JobSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("type");
      expect(shape).toHaveProperty("status");
      expect(shape).toHaveProperty("progress");
      expect(shape).toHaveProperty("metadata");
      expect(shape).toHaveProperty("bullJobId");
    });

    it("should allow updating job-specific fields after creation", () => {
      const model = factory.create("user-1");
      model.update({
        organizationId: "org-1",
        type: "file_upload",
        status: "active",
        progress: 50,
        metadata: { source: "upload" },
        startedAt: Date.now(),
      });

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.type).toBe("file_upload");
      expect(json.status).toBe("active");
      expect(json.progress).toBe(50);
      expect(json.metadata).toEqual({ source: "upload" });
      expect(json.id).toBe("job-id-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        organizationId: "org-1",
        type: "file_upload",
        status: "pending",
        progress: 0,
        metadata: {},
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        bullJobId: null,
        attempts: 0,
        maxAttempts: 3,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when job-specific required fields are missing", () => {
      const model = factory.create("user-1");
      model.update({
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("organizationId");
      }
    });
  });
});

// ── JobModel static helpers ──────────────────────────────────────

describe("JobModel.isTerminalStatus", () => {
  it.each(["completed", "failed", "cancelled"] as const)(
    "should return true for terminal status '%s'",
    (status) => {
      expect(JobModel.isTerminalStatus(status)).toBe(true);
    }
  );

  it.each(["pending", "active", "stalled", "awaiting_confirmation"] as const)(
    "should return false for non-terminal status '%s'",
    (status) => {
      expect(JobModel.isTerminalStatus(status)).toBe(false);
    }
  );
});

describe("JobModel.TERMINAL_STATUSES", () => {
  it("should equal TERMINAL_JOB_STATUSES", () => {
    expect(JobModel.TERMINAL_STATUSES).toEqual(TERMINAL_JOB_STATUSES);
  });

  it("should contain exactly completed, failed, and cancelled", () => {
    expect([...JobModel.TERMINAL_STATUSES].sort()).toEqual(
      ["cancelled", "completed", "failed"]
    );
  });
});

// ── FileUploadFileSchema ──────────────────────────────────────────

describe("FileUploadFileSchema", () => {
  const validFile = {
    originalName: "contacts.csv",
    s3Key: "uploads/org_123/job_abc/contacts.csv",
    sizeBytes: 2048,
  };

  it("should parse a valid file entry", () => {
    expect(FileUploadFileSchema.safeParse(validFile).success).toBe(true);
  });

  it("should reject missing originalName", () => {
    const { originalName: _, ...rest } = validFile;
    expect(FileUploadFileSchema.safeParse(rest).success).toBe(false);
  });

  it("should reject missing s3Key", () => {
    const { s3Key: _, ...rest } = validFile;
    expect(FileUploadFileSchema.safeParse(rest).success).toBe(false);
  });

  it("should reject missing sizeBytes", () => {
    const { sizeBytes: _, ...rest } = validFile;
    expect(FileUploadFileSchema.safeParse(rest).success).toBe(false);
  });
});

// ── FileUploadMetadataSchema ──────────────────────────────────────

describe("FileUploadMetadataSchema", () => {
  const validMetadata = {
    files: [
      {
        originalName: "contacts.csv",
        s3Key: "uploads/org_123/job_abc/contacts.csv",
        sizeBytes: 2048,
      },
    ],
    organizationId: "org_123",
    connectorDefinitionId: "cdef_csv01",
  };

  it("should parse valid metadata", () => {
    expect(FileUploadMetadataSchema.safeParse(validMetadata).success).toBe(true);
  });

  it("should parse metadata with multiple files", () => {
    const result = FileUploadMetadataSchema.safeParse({
      ...validMetadata,
      files: [
        { originalName: "a.csv", s3Key: "key/a.csv", sizeBytes: 100 },
        { originalName: "b.csv", s3Key: "key/b.csv", sizeBytes: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing files", () => {
    const { files: _, ...rest } = validMetadata;
    expect(FileUploadMetadataSchema.safeParse(rest).success).toBe(false);
  });

  it("should reject missing organizationId", () => {
    const { organizationId: _, ...rest } = validMetadata;
    expect(FileUploadMetadataSchema.safeParse(rest).success).toBe(false);
  });

  it("should reject missing connectorDefinitionId", () => {
    const { connectorDefinitionId: _, ...rest } = validMetadata;
    expect(FileUploadMetadataSchema.safeParse(rest).success).toBe(false);
  });
});

// ── FileUploadJobModelFactory ─────────────────────────────────────

describe("FileUploadJobModelFactory", () => {
  const uploadParams = {
    organizationId: "org-1",
    connectorDefinitionId: "cdef-csv",
    files: [
      { originalName: "data.csv", s3Key: "uploads/org-1/job-1/data.csv", sizeBytes: 1024 },
    ],
  };

  it("should return a FileUploadJobModel instance", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    expect(model).toBeInstanceOf(FileUploadJobModel);
  });

  it("should set type to file_upload", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    expect(model.toJSON().type).toBe("file_upload");
  });

  it("should set status to pending", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    expect(model.toJSON().status).toBe("pending");
  });

  it("should set organizationId from params", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    expect(model.toJSON().organizationId).toBe("org-1");
  });

  it("should store typed metadata with files", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    const metadata = model.fileUploadMetadata;
    expect(metadata.files).toHaveLength(1);
    expect(metadata.files[0].originalName).toBe("data.csv");
    expect(metadata.connectorDefinitionId).toBe("cdef-csv");
  });

  it("should pass full validation after createForUpload", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    const result = model.validate();
    expect(result.success).toBe(true);
  });

  it("should produce a parseable Job for DB insertion", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.createForUpload("user-1", uploadParams);
    const job = model.parse();
    expect(job.id).toBeDefined();
    expect(job.type).toBe("file_upload");
    expect(job.status).toBe("pending");
    expect(job.progress).toBe(0);
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
  });

  it("fileUploadMetadata getter should throw on invalid metadata", () => {
    const factory = new FileUploadJobModelFactory({
      coreModelFactory: buildCoreModelFactory(),
    });
    const model = factory.create("user-1");
    // model has no metadata set yet
    expect(() => model.fileUploadMetadata).toThrow();
  });
});
