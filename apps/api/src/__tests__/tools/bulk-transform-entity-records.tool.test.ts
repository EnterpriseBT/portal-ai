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

const mockLookupBulkDispatchable = jest
  .fn<() => Promise<unknown | null>>()
  .mockResolvedValue(null);
jest.unstable_mockModule("../../services/tools.service.js", () => ({
  ToolService: {
    lookupBulkDispatchable: mockLookupBulkDispatchable,
  },
}));

// Wide-table statement cache — drives the keyField pre-flight (#85).
// Default mock provides the keyField columns used by VALID_INPUT.
// Default mock returns a column set that covers both the source
// keyField check (Step 2a) and the target alias check (Step 2b)
// for VALID_INPUT — `acreage` matches the default expression's
// alias, `c_parcel_id` matches its keyField.
const mockWideTableStatementCacheGet = jest
  .fn<() => Promise<{ columns: { columnName: string }[] }>>()
  .mockResolvedValue({
    columns: [
      { columnName: "c_parcel_id" },
      { columnName: "c_id" },
      { columnName: "c_diameter_km_min" },
      { columnName: "c_diameter_km_max" },
      { columnName: "acreage" },
    ],
  });
jest.unstable_mockModule("../../services/wide-table-statement.cache.js", () => ({
  wideTableStatementCache: { get: mockWideTableStatementCacheGet },
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

  it("rejects expression.kind === 'tool' when the tool isn't bulk-dispatchable", async () => {
    // Default lookup mock returns null → tool not registered or
    // bulkDispatch metadata missing.
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_x", targetColumn: "acreage" },
    })) as { code: string };
    expect(result.code).toBe(
      ApiCode.BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE
    );
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("accepts expression.kind === 'tool' when bulkDispatch is declared", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 10,
        timeoutMs: 5_000,
        idempotent: true,
        estimatedMsPerCall: 200,
        costHint: "metered",
      },
    });
    mockCountSourceRows.mockResolvedValueOnce(50_000);

    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_distance", targetColumn: "acreage" },
    })) as { jobId?: string; estimatedSeconds?: number };

    expect(result.jobId).toBe("job-created-1");
    // ETA: 50_000 * 200ms / (10 * 1000) = 1000s
    expect(result.estimatedSeconds).toBe(1_000);
    expect(mockJobsCreate).toHaveBeenCalled();
  });

  it("rejects costHint expensive without acknowledgeCost", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 5,
        timeoutMs: 5_000,
        idempotent: true,
        costHint: "expensive",
      },
    });
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_costly", targetColumn: "acreage" },
    })) as { code: string };

    expect(result.code).toBe(
      ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
    );
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("accepts costHint expensive when acknowledgeCost is true", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 5,
        timeoutMs: 5_000,
        idempotent: true,
        costHint: "expensive",
      },
    });
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_costly", targetColumn: "acreage" },
      acknowledgeCost: true,
    })) as { jobId?: string };

    expect(result.jobId).toBe("job-created-1");
    expect(mockJobsCreate).toHaveBeenCalled();
  });

  it("threads sourceFilter.whereSqlFragment into the job metadata", async () => {
    // Retry-failed-only contract (Phase 4 slice 5). The agent passes
    // sourceFilter through; the tool persists it in job.metadata;
    // the processor injects it into the cursor's WHERE clause.
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 10,
        timeoutMs: 5_000,
        idempotent: true,
      },
    });
    mockCountSourceRows.mockResolvedValueOnce(3);

    await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_x", targetColumn: "acreage" },
      sourceFilter: {
        whereSqlFragment: "c_parcel_id IN ('p-99','p-499','p-999')",
      },
    });

    const metadata = mockJobsCreate.mock.calls[0][1].metadata as Record<
      string,
      unknown
    >;
    expect(metadata.sourceFilter).toEqual({
      whereSqlFragment: "c_parcel_id IN ('p-99','p-499','p-999')",
    });
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

  it("rejects when a projection alias is not a wide-column on the target", async () => {
    // First cache.get() is for the source's keyField check (Step 2a),
    // second is for the target's alias check (Step 2b).
    mockWideTableStatementCacheGet
      .mockResolvedValueOnce({
        columns: [
          { columnName: "c_id" },
          { columnName: "c_diameter_km_min" },
          { columnName: "c_diameter_km_max" },
        ],
      })
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_diameter_avg_km" }],
      });

    const result = (await exec({
      ...VALID_INPUT,
      keyField: "c_id",
      expression: {
        kind: "sql" as const,
        // Includes the key under an invented name + a real derived col.
        value:
          "c_id::text AS asteroid_id, (c_diameter_km_min + c_diameter_km_max) / 2 AS c_diameter_avg_km",
      },
    })) as {
      code: string;
      details?: {
        unknownAliases?: string[];
        availableTargetColumns?: string[];
      };
    };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.details?.unknownAliases).toEqual(["asteroid_id"]);
    expect(result.details?.availableTargetColumns).toContain(
      "c_diameter_avg_km"
    );
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects when keyField is not a wide-column on the source", async () => {
    mockWideTableStatementCacheGet.mockResolvedValueOnce({
      columns: [
        { columnName: "c_id" },
        { columnName: "c_diameter_km_min" },
      ],
    });
    const result = (await exec({
      ...VALID_INPUT,
      keyField: "asteroid_id",
    })) as { code: string; details?: { availableColumns?: string[] } };
    expect(result.code).toBe(ApiCode.BULK_JOB_KEY_FIELD_INVALID);
    expect(result.details?.availableColumns).toEqual(
      expect.arrayContaining(["c_id", "c_diameter_km_min"])
    );
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("threads portalId + organizationId + stationId + userId into the job metadata", async () => {
    await exec();
    const metadata = mockJobsCreate.mock.calls[0][1].metadata as Record<
      string,
      unknown
    >;
    expect(metadata.portalId).toBe(PORTAL_ID);
    expect(metadata.organizationId).toBe(ORG_ID);
    // stationId + userId are the ids the worker reads back to call
    // lookupBulkDispatchable for tool-kind expressions. Missing
    // stationId would cause BULK_DISPATCH_TOOL_NOT_FOUND mid-job
    // even when the pre-flight passed.
    expect(metadata.stationId).toBe(STATION_ID);
    expect(metadata.userId).toBe(USER_ID);
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
