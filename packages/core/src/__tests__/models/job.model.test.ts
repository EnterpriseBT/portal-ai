import {
  JobModel,
  JobModelFactory,
  JobSchema,
  JobStatusEnum,
  JobTypeEnum,
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
    type: "system_check",
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
    const result = JobSchema.safeParse(
      buildValidJob({ status: "unknown" as never })
    );
    expect(result.success).toBe(false);
  });

  it("should reject an invalid type value", () => {
    const result = JobSchema.safeParse(
      buildValidJob({ type: "invalid_type" as never })
    );
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
  it.each([
    "pending",
    "active",
    "completed",
    "failed",
    "stalled",
    "cancelled",
    "awaiting_confirmation",
  ])("should accept '%s'", (status) => {
    expect(JobStatusEnum.safeParse(status).success).toBe(true);
  });

  it("should reject an unknown status", () => {
    expect(JobStatusEnum.safeParse("running").success).toBe(false);
  });

  it("awaiting_confirmation should not be a terminal status", () => {
    expect(TERMINAL_JOB_STATUSES).not.toContain("awaiting_confirmation");
  });
});

// ── JobTypeEnum ──────────────────────────────────────────────────────

describe("JobTypeEnum", () => {
  it("should accept 'system_check'", () => {
    expect(JobTypeEnum.safeParse("system_check").success).toBe(true);
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
        type: "system_check",
        status: "active",
        progress: 50,
        metadata: { source: "upload" },
        startedAt: Date.now(),
      });

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.type).toBe("system_check");
      expect(json.status).toBe("active");
      expect(json.progress).toBe(50);
      expect(json.metadata).toEqual({ source: "upload" });
      expect(json.id).toBe("job-id-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        organizationId: "org-1",
        type: "system_check",
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
    expect([...JobModel.TERMINAL_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
    ]);
  });
});

// ── BulkTransform (#85) ──────────────────────────────────────────────

import {
  BulkTransformExpressionSchema,
  BulkTransformMetadataSchema,
  BulkTransformResultSchema,
  JOB_TYPE_SCHEMAS,
} from "../../models/job.model.js";
import { DEFAULT_BULK_BATCH } from "../../constants/large-data-ops.constants.js";

describe("BulkTransform schemas (#85)", () => {
  it("JobTypeEnum includes bulk_transform", () => {
    expect(JobTypeEnum.safeParse("bulk_transform").success).toBe(true);
  });

  it("BulkTransformMetadataSchema accepts an sql-kind expression", () => {
    const parsed = BulkTransformMetadataSchema.parse({
      sourceConnectorEntityId: "ce-source",
      targetConnectorEntityId: "ce-target",
      expression: {
        kind: "sql",
        value: "ST_Area(geometry::geography) / 4047 AS acreage",
      },
      keyField: "parcel_id",
    });
    expect(parsed.expression.kind).toBe("sql");
    expect(parsed.batchSize).toBe(DEFAULT_BULK_BATCH);
  });

  it("BulkTransformMetadataSchema accepts a tool-kind expression", () => {
    const parsed = BulkTransformMetadataSchema.parse({
      sourceConnectorEntityId: "ce-source",
      targetConnectorEntityId: "ce-target",
      expression: {
        kind: "tool",
        ref: "compute_distance_to_nearest_hospital",
        args: { radius_km: 50 },
      },
      keyField: "parcel_id",
      batchSize: 500,
      acknowledgeCost: true,
    });
    expect(parsed.expression.kind).toBe("tool");
    if (parsed.expression.kind === "tool") {
      expect(parsed.expression.ref).toBe(
        "compute_distance_to_nearest_hospital"
      );
    }
    expect(parsed.batchSize).toBe(500);
    expect(parsed.acknowledgeCost).toBe(true);
  });

  it("rejects a mixed-shape expression (kind sql with tool's ref key)", () => {
    const result = BulkTransformExpressionSchema.safeParse({
      kind: "sql",
      ref: "compute_x",
    });
    expect(result.success).toBe(false);
  });

  it("defaults batchSize to DEFAULT_BULK_BATCH when omitted", () => {
    const parsed = BulkTransformMetadataSchema.parse({
      sourceConnectorEntityId: "a",
      targetConnectorEntityId: "b",
      expression: { kind: "sql", value: "1" },
      keyField: "k",
    });
    expect(parsed.batchSize).toBe(DEFAULT_BULK_BATCH);
  });

  it("rejects batchSize past 10_000", () => {
    const result = BulkTransformMetadataSchema.safeParse({
      sourceConnectorEntityId: "a",
      targetConnectorEntityId: "b",
      expression: { kind: "sql", value: "1" },
      keyField: "k",
      batchSize: 50_000,
    });
    expect(result.success).toBe(false);
  });

  it("BulkTransformResultSchema accepts partialFailures with nested ApiError envelope", () => {
    const parsed = BulkTransformResultSchema.parse({
      recordsProcessed: 47000,
      recordsFailed: 3,
      durationMs: 998000,
      partialFailures: [
        {
          sourceKey: "p-99",
          error: {
            success: false,
            message: "Tool call failed.",
            code: "BULK_DISPATCH_CALL_TIMEOUT",
            recommendation: "Retry; the hospital API returned a 500.",
          },
        },
      ],
    });
    expect(parsed.recordsFailed).toBe(3);
    expect(parsed.partialFailures?.[0].error.recommendation).toBe(
      "Retry; the hospital API returned a 500."
    );
  });

  it("JOB_TYPE_SCHEMAS has a bulk_transform entry whose schemas match the exported types", () => {
    expect(JOB_TYPE_SCHEMAS.bulk_transform).toBeDefined();
    expect(JOB_TYPE_SCHEMAS.bulk_transform.metadata).toBe(
      BulkTransformMetadataSchema
    );
    expect(JOB_TYPE_SCHEMAS.bulk_transform.result).toBe(
      BulkTransformResultSchema
    );
  });
});

