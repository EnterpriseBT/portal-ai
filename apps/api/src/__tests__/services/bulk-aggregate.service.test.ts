import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
} from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockExecute = jest.fn<(arg: unknown) => Promise<unknown>>();
const mockTransaction =
  jest.fn<(cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>>();

jest.unstable_mockModule("../../db/client.js", () => ({
  db: { execute: mockExecute, transaction: mockTransaction },
}));

jest.unstable_mockModule("../../db/repositories/wide-table.repository.js", () => ({
  wideTableRepo: { tableName: (id: string) => `er__${id}` },
}));

// ── SUT (dynamic import after mocks) ─────────────────────────────────

let buildAggregateSql: typeof import("../../services/bulk-aggregate.service.js").buildAggregateSql;
let buildExplainSql: typeof import("../../services/bulk-aggregate.service.js").buildExplainSql;
let isStatementTimeoutError: typeof import("../../services/bulk-aggregate.service.js").isStatementTimeoutError;
let BulkAggregateService: typeof import("../../services/bulk-aggregate.service.js").BulkAggregateService;
let ApiCode: typeof import("../../constants/api-codes.constants.js").ApiCode;

beforeAll(async () => {
  const mod = await import("../../services/bulk-aggregate.service.js");
  buildAggregateSql = mod.buildAggregateSql;
  buildExplainSql = mod.buildExplainSql;
  isStatementTimeoutError = mod.isStatementTimeoutError;
  BulkAggregateService = mod.BulkAggregateService;
  ApiCode = (await import("../../constants/api-codes.constants.js")).ApiCode;
});

beforeEach(() => {
  mockExecute.mockReset();
  mockTransaction.mockReset();
});

const BASE = {
  sourceConnectorEntityId: "ce-source",
  organizationId: "org-1",
  expression: "SUM(c_area) AS total, AVG(c_age) AS avg_age",
};

// ── Case 2 — SQL assembly (pure) ─────────────────────────────────────

describe("buildAggregateSql / buildExplainSql", () => {
  it("assembles an org-scoped aggregate with the injected COUNT(*)", () => {
    const out = buildAggregateSql(BASE);
    expect(out).toContain("SUM(c_area) AS total, AVG(c_age) AS avg_age");
    expect(out).toContain("COUNT(*) AS __records_processed");
    expect(out).toContain('FROM "er__ce-source"');
    expect(out).toContain("\"organization_id\" = 'org-1'");
    expect(out).not.toContain(" AND (");
  });

  it("injects the whereSqlFragment when present", () => {
    const out = buildAggregateSql({
      ...BASE,
      whereSqlFragment: "c_age > 30",
    });
    expect(out).toContain(" AND (c_age > 30)");
  });

  it("escapes single quotes in the organization id", () => {
    const out = buildAggregateSql({ ...BASE, organizationId: "o'rg" });
    expect(out).toContain("\"organization_id\" = 'o''rg'");
  });

  it("buildExplainSql wraps the same query with EXPLAIN", () => {
    expect(buildExplainSql(BASE)).toBe(`EXPLAIN ${buildAggregateSql(BASE)}`);
  });
});

// ── isStatementTimeoutError (pure) ───────────────────────────────────

describe("isStatementTimeoutError", () => {
  it("detects SQLSTATE 57014 on the error", () => {
    expect(isStatementTimeoutError({ code: "57014" })).toBe(true);
  });
  it("detects 57014 on the cause chain", () => {
    expect(isStatementTimeoutError({ cause: { code: "57014" } })).toBe(true);
  });
  it("detects the canonical message", () => {
    expect(
      isStatementTimeoutError(
        new Error("canceling statement due to statement timeout")
      )
    ).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    expect(isStatementTimeoutError(new Error("syntax error"))).toBe(false);
  });
});

// ── Case 3 — explainExpression error mapping ─────────────────────────

describe("BulkAggregateService.explainExpression", () => {
  it("resolves when EXPLAIN succeeds", async () => {
    mockExecute.mockResolvedValueOnce([]);
    await expect(
      BulkAggregateService.explainExpression(BASE)
    ).resolves.toBeUndefined();
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("throws BULK_AGGREGATE_EXPRESSION_INVALID with the pg error in details", async () => {
    mockExecute.mockRejectedValueOnce(new Error('column "c_nope" does not exist'));
    await expect(
      BulkAggregateService.explainExpression(BASE)
    ).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
      status: 400,
      details: { pgError: expect.stringContaining("c_nope") },
    });
  });
});

// ── Case 4 + 5 — runAggregate ────────────────────────────────────────

describe("BulkAggregateService.runAggregate", () => {
  function wireTx(executeImpl: ReturnType<typeof jest.fn>) {
    mockTransaction.mockImplementation(async (cb) =>
      cb({ execute: executeImpl })
    );
  }

  it("returns the result row with __records_processed stripped into recordsProcessed", async () => {
    const txExecute = jest.fn<(arg: unknown) => Promise<unknown>>();
    txExecute
      .mockResolvedValueOnce(undefined) // SET statement_timeout
      .mockResolvedValueOnce(undefined) // SET transaction_read_only
      .mockResolvedValueOnce([{ total: 100, avg_age: 37.5, __records_processed: 1000 }]);
    wireTx(txExecute);

    const out = await BulkAggregateService.runAggregate(BASE);
    expect(out.recordsProcessed).toBe(1000);
    expect(out.result).toEqual({ total: 100, avg_age: 37.5 });
  });

  it("maps a statement_timeout to BULK_AGGREGATE_TIMEOUT", async () => {
    const txExecute = jest.fn<(arg: unknown) => Promise<unknown>>();
    txExecute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("canceling statement due to statement timeout"), {
          code: "57014",
        })
      );
    wireTx(txExecute);

    await expect(BulkAggregateService.runAggregate(BASE)).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_TIMEOUT,
      status: 400,
    });
  });
});
