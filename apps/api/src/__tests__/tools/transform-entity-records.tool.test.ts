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
const mockCanCastConstant =
  jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
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
    canCastConstant: mockCanCastConstant,
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

// Cost-acknowledgement gate (#85 §4b server enforcement).
const mockRecordRejection =
  jest.fn<() => Promise<void>>().mockResolvedValue();
const mockValidateAck = jest
  .fn<
    () => Promise<{ ok: true } | { ok: false; reason: "missing" | "stale" }>
  >()
  .mockResolvedValue({ ok: true });
jest.unstable_mockModule("../../services/cost-acknowledgement.service.js", () => ({
  CostAcknowledgementService: {
    recordRejection: mockRecordRejection,
    validate: mockValidateAck,
  },
  computeJobSignature: jest.fn(() => "sig-fixed"),
}));

// Wide-table statement cache — drives the keyField pre-flight (#85).
// Default mock provides the keyField columns used by VALID_INPUT.
// Default mock returns a column set that covers both the source
// keyField check (Step 2a) and the target alias check (Step 2b)
// for VALID_INPUT — `acreage` matches the default expression's
// alias, `c_parcel_id` matches its keyField.
const mockWideTableStatementCacheGet = jest
  .fn<
    (id: string) => Promise<{
      columns: { columnName: string; pgType: string }[];
    }>
  >()
  .mockResolvedValue({
    columns: [
      { columnName: "c_parcel_id", pgType: "text" },
      { columnName: "c_id", pgType: "text" },
      { columnName: "c_diameter_km_min", pgType: "numeric" },
      { columnName: "c_diameter_km_max", pgType: "numeric" },
      { columnName: "acreage", pgType: "numeric" },
    ],
  });
jest.unstable_mockModule("../../services/wide-table-statement.cache.js", () => ({
  wideTableStatementCache: { get: mockWideTableStatementCacheGet },
}));

const { TransformEntityRecordsTool } = await import(
  "../../tools/transform-entity-records.tool.js"
);
const { ApiCode } = await import("../../constants/api-codes.constants.js");
const { ApiError } = await import("../../services/http.service.js");

// ── Helpers ──────────────────────────────────────────────────────────

const STATION_ID = "station-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";
const PORTAL_ID = "portal-001";

// Slice 0 (#99): the tool's contract migrated from a top-level
// `targetConnectorEntityId` + per-expression `targetColumn` to an
// explicit `writes[]` mapping. Single-write happy path keeps shape +
// behavior compatible with the prior tests.
const TARGET_ID = "ce-target";
const VALID_INPUT = {
  sourceConnectorEntityId: "ce-source",
  expression: {
    kind: "sql" as const,
    value: "ST_Area(geometry::geography) / 4047 AS acreage",
    writes: [
      {
        targetConnectorEntityId: TARGET_ID,
        column: "acreage",
        valueFrom: { kind: "sql_alias" as const, alias: "acreage" },
      },
    ],
  },
  keyField: "c_parcel_id",
  batchSize: 1_000,
};

const toolWrite = (column: string) => ({
  targetConnectorEntityId: TARGET_ID,
  column,
  valueFrom: { kind: "tool_result" as const },
});

function buildTool() {
  return new TransformEntityRecordsTool().build(
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

describe("TransformEntityRecordsTool — pre-flight", () => {
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
    // Reset the wide-table cache + cast-check mocks so per-target
    // `.mockResolvedValueOnce` / `.mockImplementation` calls in slice-2
    // tests don't leak forward; restore the broad default that the
    // single-target happy paths rely on.
    mockWideTableStatementCacheGet
      .mockReset()
      .mockResolvedValue({
        columns: [
          { columnName: "c_parcel_id", pgType: "text" },
          { columnName: "c_id", pgType: "text" },
          { columnName: "c_diameter_km_min", pgType: "numeric" },
          { columnName: "c_diameter_km_max", pgType: "numeric" },
          { columnName: "acreage", pgType: "numeric" },
        ],
      });
    mockCanCastConstant.mockReset().mockResolvedValue(true);
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
      id === TARGET_ID
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
      expression: { kind: "tool", ref: "compute_x", writes: [toolWrite("acreage")] },
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
      expression: { kind: "tool", ref: "compute_distance", writes: [toolWrite("acreage")] },
    })) as { jobId?: string; estimatedSeconds?: number };

    expect(result.jobId).toBe("job-created-1");
    // ETA: 50_000 * 200ms / (10 * 1000) = 1000s
    expect(result.estimatedSeconds).toBe(1_000);
    expect(mockJobsCreate).toHaveBeenCalled();
  });

  it("rejects costHint expensive without acknowledgeCost AND records the pending acknowledgement", async () => {
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
      expression: { kind: "tool", ref: "compute_costly", writes: [toolWrite("acreage")] },
    })) as { code: string };

    expect(result.code).toBe(
      ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED
    );
    // Server stashes the rejection so a future legitimate retry can
    // be validated against it. Without this side effect, the agent
    // could never escape the gate.
    expect(mockRecordRejection).toHaveBeenCalledTimes(1);
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("accepts costHint expensive when acknowledgeCost passes server validation", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 5,
        timeoutMs: 5_000,
        idempotent: true,
        costHint: "expensive",
      },
    });
    mockValidateAck.mockResolvedValueOnce({ ok: true });
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_costly", writes: [toolWrite("acreage")] },
      acknowledgeCost: true,
    })) as { jobId?: string };

    expect(result.jobId).toBe("job-created-1");
    expect(mockJobsCreate).toHaveBeenCalled();
    expect(mockValidateAck).toHaveBeenCalledTimes(1);
  });

  it("rejects acknowledgeCost when validation returns missing (agent skipped first rejection)", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 5,
        timeoutMs: 5_000,
        idempotent: true,
        costHint: "expensive",
      },
    });
    mockValidateAck.mockResolvedValueOnce({ ok: false, reason: "missing" });
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_costly", writes: [toolWrite("acreage")] },
      acknowledgeCost: true,
    })) as { code: string; details?: { reason?: string } };

    expect(result.code).toBe(
      ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID
    );
    expect(result.details?.reason).toBe("missing");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects acknowledgeCost when validation returns stale (agent retried same turn)", async () => {
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 5,
        timeoutMs: 5_000,
        idempotent: true,
        costHint: "expensive",
      },
    });
    mockValidateAck.mockResolvedValueOnce({ ok: false, reason: "stale" });
    const result = (await exec({
      ...VALID_INPUT,
      expression: { kind: "tool", ref: "compute_costly", writes: [toolWrite("acreage")] },
      acknowledgeCost: true,
    })) as { code: string; details?: { reason?: string } };

    expect(result.code).toBe(
      ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID
    );
    expect(result.details?.reason).toBe("stale");
    expect(mockJobsCreate).not.toHaveBeenCalled();
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
      expression: { kind: "tool", ref: "compute_x", writes: [toolWrite("acreage")] },
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

  // Case 2.5 — declared SQL alias that no writes[] entry references.
  it("rejects when a projection alias is declared but no write references it", async () => {
    // First cache.get() is for the source's keyField check (Step 2a),
    // then one per unique target (the new per-write loader).
    mockWideTableStatementCacheGet
      .mockResolvedValueOnce({
        columns: [
          { columnName: "c_id", pgType: "text" },
          { columnName: "c_diameter_km_min", pgType: "numeric" },
          { columnName: "c_diameter_km_max", pgType: "numeric" },
        ],
      })
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_diameter_avg_km", pgType: "numeric" }],
      });

    const result = (await exec({
      ...VALID_INPUT,
      keyField: "c_id",
      expression: {
        kind: "sql" as const,
        // Includes the key under an invented name + a real derived col;
        // writes[] only picks up the derived col.
        value:
          "c_id::text AS asteroid_id, (c_diameter_km_min + c_diameter_km_max) / 2 AS c_diameter_avg_km",
        writes: [
          {
            targetConnectorEntityId: TARGET_ID,
            column: "c_diameter_avg_km",
            valueFrom: { kind: "sql_alias" as const, alias: "c_diameter_avg_km" },
          },
        ],
      },
    })) as {
      code: string;
      message?: string;
      details?: {
        unreferencedAliases?: string[];
      };
    };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.details?.unreferencedAliases).toEqual(["asteroid_id"]);
    expect(result.message).toContain("asteroid_id");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  // Case 2.2 — valid multi-write across two targets succeeds; the
  // metadata's targetConnectorEntityIds denormalizes to a sorted unique
  // array of two.
  it("accepts valid multi-write across two targets and denormalizes targetConnectorEntityIds", async () => {
    const TARGET_A = "ce-target-a";
    const TARGET_B = "ce-target-b";
    // Per-target cache mock: source first, then TARGET_B alphabetically
    // first since `targetConnectorEntityIds` is sorted, then TARGET_A.
    mockWideTableStatementCacheGet.mockImplementation(async (id: string) => {
      if (id === "ce-source") {
        return {
          columns: [
            { columnName: "c_parcel_id", pgType: "text" },
            { columnName: "c_diameter_km_min", pgType: "numeric" },
            { columnName: "c_diameter_km_max", pgType: "numeric" },
            { columnName: "acreage", pgType: "numeric" },
          ],
        };
      }
      if (id === TARGET_A) {
        return { columns: [{ columnName: "c_km", pgType: "numeric" }] };
      }
      if (id === TARGET_B) {
        return { columns: [{ columnName: "c_summary", pgType: "text" }] };
      }
      return { columns: [] };
    });
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: {
        maxConcurrency: 10,
        timeoutMs: 5_000,
        idempotent: true,
      },
    });
    mockFindEntityById.mockImplementation(async (id) => ({
      id,
      organizationId: ORG_ID,
      connectorInstanceId: "ci-1",
    }));

    const result = (await exec({
      ...VALID_INPUT,
      expression: {
        kind: "tool" as const,
        ref: "compute_x",
        writes: [
          {
            targetConnectorEntityId: TARGET_A,
            column: "c_km",
            valueFrom: { kind: "tool_path" as const, path: "km" },
          },
          {
            targetConnectorEntityId: TARGET_B,
            column: "c_summary",
            valueFrom: { kind: "tool_result" as const },
          },
        ],
      },
    })) as { jobId?: string };

    expect(result.jobId).toBe("job-created-1");
    const metadata = mockJobsCreate.mock.calls[0][1].metadata as {
      targetConnectorEntityIds: string[];
    };
    expect(metadata.targetConnectorEntityIds).toEqual(
      [TARGET_A, TARGET_B].sort()
    );
  });

  // Case 2.3 — unknown column on the second target is rejected,
  // naming the bad { targetConnectorEntityId, column }.
  it("rejects when a write's column doesn't exist on its target", async () => {
    const TARGET_A = "ce-target-a";
    const TARGET_B = "ce-target-b";
    mockWideTableStatementCacheGet.mockImplementation(async (id: string) => {
      if (id === "ce-source") {
        return { columns: [{ columnName: "c_parcel_id", pgType: "text" }] };
      }
      if (id === TARGET_A) {
        return { columns: [{ columnName: "c_km", pgType: "numeric" }] };
      }
      if (id === TARGET_B) {
        // Doesn't include `c_zombie` — the write below should fail.
        return { columns: [{ columnName: "c_real", pgType: "text" }] };
      }
      return { columns: [] };
    });
    mockLookupBulkDispatchable.mockResolvedValueOnce({
      executor: async () => ({}),
      metadata: { maxConcurrency: 10, timeoutMs: 5_000, idempotent: true },
    });

    const result = (await exec({
      ...VALID_INPUT,
      expression: {
        kind: "tool" as const,
        ref: "compute_x",
        writes: [
          {
            targetConnectorEntityId: TARGET_A,
            column: "c_km",
            valueFrom: { kind: "tool_path" as const, path: "km" },
          },
          {
            targetConnectorEntityId: TARGET_B,
            column: "c_zombie",
            valueFrom: { kind: "tool_result" as const },
          },
        ],
      },
    })) as {
      code: string;
      message?: string;
      details?: { write?: { targetConnectorEntityId: string; column: string } };
    };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.details?.write?.targetConnectorEntityId).toBe(TARGET_B);
    expect(result.details?.write?.column).toBe("c_zombie");
    expect(result.message).toContain("c_zombie");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  // Case 2.4 — sql_alias write references an alias that isn't declared
  // in expression.value.
  it("rejects when a sql_alias write references an undeclared alias", async () => {
    mockWideTableStatementCacheGet
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_parcel_id", pgType: "text" }],
      })
      .mockResolvedValueOnce({
        columns: [{ columnName: "acreage", pgType: "numeric" }],
      });

    const result = (await exec({
      ...VALID_INPUT,
      expression: {
        kind: "sql" as const,
        value: "ST_Area(geometry::geography) / 4047 AS acreage",
        writes: [
          {
            targetConnectorEntityId: TARGET_ID,
            column: "acreage",
            // Alias 'square_meters' isn't declared in the projection.
            valueFrom: { kind: "sql_alias" as const, alias: "square_meters" },
          },
        ],
      },
    })) as { code: string; message?: string; details?: { alias?: string } };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.details?.alias).toBe("square_meters");
    expect(result.message).toContain("square_meters");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  // Case 2.6 — constant value that can't cast to the target column's
  // pgType. The cast check goes through BulkTransformService.canCastConstant
  // which the test mock controls.
  it("rejects when a constant write's value can't cast to the target column's pgType", async () => {
    mockWideTableStatementCacheGet
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_parcel_id", pgType: "text" }],
      })
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_count", pgType: "bigint" }],
      });
    mockCanCastConstant.mockResolvedValueOnce(false);

    const result = (await exec({
      ...VALID_INPUT,
      expression: {
        kind: "sql" as const,
        value: "1 AS dummy",
        writes: [
          {
            targetConnectorEntityId: TARGET_ID,
            column: "c_count",
            valueFrom: { kind: "constant" as const, value: "not a number" },
          },
        ],
      },
    })) as {
      code: string;
      message?: string;
      details?: { pgType?: string };
    };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.details?.pgType).toBe("bigint");
    expect(result.message).toContain("bigint");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  // Case 2.7 — source_column write references a column that doesn't
  // exist on the source's wide table.
  it("rejects when a source_column write names a column missing from the source", async () => {
    mockWideTableStatementCacheGet
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_parcel_id", pgType: "text" }],
      })
      .mockResolvedValueOnce({
        columns: [{ columnName: "c_copy", pgType: "text" }],
      });

    const result = (await exec({
      ...VALID_INPUT,
      expression: {
        kind: "sql" as const,
        value: "1 AS dummy",
        writes: [
          {
            targetConnectorEntityId: TARGET_ID,
            column: "c_copy",
            valueFrom: {
              kind: "source_column" as const,
              column: "c_zombie",
            },
          },
        ],
      },
    })) as {
      code: string;
      message?: string;
      details?: { write?: { column: string } };
    };

    expect(result.code).toBe(ApiCode.BULK_JOB_EXPRESSION_INVALID);
    expect(result.message).toContain("c_zombie");
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects when keyField is not a wide-column on the source", async () => {
    mockWideTableStatementCacheGet.mockResolvedValueOnce({
      columns: [
        { columnName: "c_id", pgType: "text" },
        { columnName: "c_diameter_km_min", pgType: "numeric" },
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
