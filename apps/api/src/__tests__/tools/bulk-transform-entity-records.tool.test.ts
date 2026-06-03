/* global AbortController */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindEntityById =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAssertConnectorEntityUnlocked =
  jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
const mockAssertStationScope =
  jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
const mockCountSourceRows =
  jest.fn<() => Promise<number>>().mockResolvedValue(0);
const mockExplain =
  jest.fn<() => Promise<void>>().mockResolvedValue();
type JobsCreateParams = {
  organizationId: string;
  type: string;
  metadata?: Record<string, unknown>;
};
const mockJobsCreate = jest
  .fn<(userId: string, params: JobsCreateParams) => Promise<{ id: string }>>()
  .mockResolvedValue({ id: "job-created-1" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findById: mockFindEntityById },
    },
  },
}));

jest.unstable_mockModule("../../services/job-lock.service.js", () => ({
  JobLockService: {
    assertConnectorEntityUnlocked: mockAssertConnectorEntityUnlocked,
  },
}));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(),
  resolveStationCapabilities: jest
    .fn<() => Promise<unknown[]>>()
    .mockResolvedValue([]),
  resolveCapabilities: jest.fn(),
  resolveEntityCapabilities: jest.fn(async () => ({})),
}));

jest.unstable_mockModule("../../services/bulk-transform.service.js", () => ({
  BulkTransformService: {
    countSourceRows: mockCountSourceRows,
    runBatch: jest.fn(),
    explainExpression: mockExplain,
  },
}));

jest.unstable_mockModule("../../services/jobs.service.js", () => ({
  JobsService: {
    create: mockJobsCreate,
  },
}));

const { BulkTransformEntityRecordsTool } = await import(
  "../../tools/bulk-transform-entity-records.tool.js"
);
const { ApiCode } = await import("../../constants/api-codes.constants.js");
const { ApiError } = await import("../../services/http.service.js");

// ── Helpers ──────────────────────────────────────────────────────────

const STATION_ID = "station-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";
const PORTAL_ID = "portal-001";

const VALID_INPUT = {
  sourceConnectorEntityId: "ce-source",
  targetConnectorEntityId: "ce-target",
  expression: {
    kind: "sql" as const,
    value: "ST_Area(geometry::geography) / 4047 AS acreage",
  },
  keyField: "c_parcel_id",
  batchSize: 1_000,
};

function buildTool() {
  return new BulkTransformEntityRecordsTool().build(
    PORTAL_ID,
    STATION_ID,
    ORG_ID,
    USER_ID
  );
}

async function exec(input: Record<string, unknown> = VALID_INPUT) {
  const t = buildTool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("BulkTransformEntityRecordsTool — pre-flight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindEntityById.mockReset();
    mockAssertConnectorEntityUnlocked
      .mockReset()
      .mockResolvedValue(undefined);
    mockAssertStationScope.mockReset().mockResolvedValue(undefined);
    mockCountSourceRows.mockReset().mockResolvedValue(100);
    mockExplain.mockReset().mockResolvedValue(undefined);
    mockJobsCreate.mockReset().mockResolvedValue({ id: "job-created-1" });
    // Default: both entities found
    mockFindEntityById.mockImplementation(async (id) => ({
      id,
      organizationId: ORG_ID,
      connectorInstanceId: "ci-1",
    }));
  });

  it("happy path: passes all pre-flight checks and enqueues the job", async () => {
    const result = (await exec()) as {
      jobId: string;
      expectedRecords: number;
    };

    expect(result.jobId).toBe("job-created-1");
    expect(result.expectedRecords).toBe(100);
    expect(mockJobsCreate).toHaveBeenCalledTimes(1);
    expect(mockJobsCreate.mock.calls[0][1].type).toBe("bulk_transform");
  });

  it("rejects when the source entity isn't found", async () => {
    mockFindEntityById.mockImplementation(async (id) =>
      id === VALID_INPUT.sourceConnectorEntityId ? undefined : { id }
    );
    const result = (await exec()) as { code: string };
    expect(result.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects when the target entity isn't found", async () => {
    mockFindEntityById.mockImplementation(async (id) =>
      id === VALID_INPUT.targetConnectorEntityId
        ? undefined
        : { id, organizationId: ORG_ID, connectorInstanceId: "ci-1" }
    );
    const result = (await exec()) as { code: string };
    expect(result.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
  });

  it("rejects when the target is locked", async () => {
    mockAssertConnectorEntityUnlocked.mockRejectedValueOnce(
      new ApiError(
        409,
        ApiCode.BULK_JOB_TARGET_LOCKED,
        "Locked by an in-flight bulk job"
      )
    );
    const result = (await exec()) as { code: string };
    expect(result.code).toBe(ApiCode.BULK_JOB_TARGET_LOCKED);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects expression.kind === 'tool' (Phase 4)", async () => {
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_x" },
    })) as { code: string };
    expect(result.code).toBe(ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects when EXPLAIN fails (BULK_JOB_EXPRESSION_INVALID)", async () => {
    mockExplain.mockRejectedValueOnce(new Error("syntax error at AS"));
    const result = (await exec()) as { code: string };
    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects when source has more rows than MAX_BULK_RECORDS", async () => {
    mockCountSourceRows.mockResolvedValueOnce(10_000_000);
    const result = (await exec()) as { code: string };
    expect(result.code).toBe(ApiCode.BULK_JOB_MAX_RECORDS_EXCEEDED);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("threads portalId + organizationId into the job metadata", async () => {
    await exec();
    const metadata = mockJobsCreate.mock.calls[0][1].metadata as Record<
      string,
      unknown
    >;
    expect(metadata.portalId).toBe(PORTAL_ID);
    expect(metadata.organizationId).toBe(ORG_ID);
    expect(metadata.sourceConnectorEntityId).toBe(
      VALID_INPUT.sourceConnectorEntityId
    );
  });

  it("computes estimatedSeconds based on expectedRecords", async () => {
    mockCountSourceRows.mockResolvedValueOnce(50_000);
    const result = (await exec()) as { estimatedSeconds: number };
    // Rough seconds: small enough to fit comfortably; just assert positive
    expect(result.estimatedSeconds).toBeGreaterThan(0);
  });
});
