/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockGetMeta = jest.fn<() => Promise<unknown>>();
const mockProduceFromTransform = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: {
    getMeta: mockGetMeta,
    produceFromTransform: mockProduceFromTransform,
  },
  // Imported by the compute-input helpers; unused on these paths.
  resolveTiebreaker: jest.fn(),
}));

const { TechnicalIndicatorTool } =
  await import("../../tools/technical-indicator.tool.js");

async function run(input: Record<string, unknown>) {
  const t = new TechnicalIndicatorTool().build("station-1", "org-1", "user-1");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  })) as Record<string, unknown>;
}

const LARGE = {
  queryHandle: "qh-source",
  dateColumn: "d",
  valueColumn: "v",
  indicator: "SMA",
  params: { period: 5 },
};

beforeEach(() => {
  mockGetMeta.mockReset();
  mockProduceFromTransform.mockReset();
  mockProduceFromTransform.mockResolvedValue({
    envelope: { queryHandle: "qh-folded", rowCount: 500, schema: [] },
  });
});

describe("technical_indicator (#1038)", () => {
  it("a folded table carries its source query and transform as its pipeline", async () => {
    mockGetMeta.mockResolvedValue({
      rowCount: 500,
      sql: "SELECT _record_id, d, v FROM prices",
    });

    const result = await run(LARGE);

    expect(result.queryHandle).toBe("qh-folded");
    expect(result.pipeline).toEqual({
      sql: "SELECT _record_id, d, v FROM prices",
      stationId: "station-1",
      organizationId: "org-1",
      transform: {
        kind: "technical_indicator",
        dateColumn: "d",
        valueColumn: "v",
        indicator: "SMA",
        params: { period: 5 },
      },
    });
  });

  it("has no pipeline when its source has no query to re-run", async () => {
    mockGetMeta.mockResolvedValue({ rowCount: 500, sql: null });

    const result = await run(LARGE);

    expect(result.queryHandle).toBe("qh-folded");
    expect(result).not.toHaveProperty("pipeline");
  });
});
