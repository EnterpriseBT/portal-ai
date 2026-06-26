import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Stateful in-memory Redis fake so a handle round-trips (produce → getMeta →
// getSnapshot → streamHandle) without a real server. set/get store JSON
// strings exactly as the service writes them.
const store = new Map<string, string>();
const fakeRedis = {
  set: jest.fn(async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  }),
  get: jest.fn(async (k: string) => store.get(k) ?? null),
  publish: jest.fn(async () => 1),
  del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
};

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => fakeRedis,
}));

const mockRunSqlQuery = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ rows: [] });
jest.unstable_mockModule("../../services/portal-sql.service.js", () => ({
  PortalSqlService: { runSqlQuery: mockRunSqlQuery },
}));

const { PortalSqlHandleService } = await import(
  "../../services/portal-sql-handle.service.js"
);
const { AnalyticsService } = await import("../../services/analytics.service.js");

const N = 40;
const OHLCV = Array.from({ length: N }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 4) + i * 0.5;
  return {
    _record_id: `r-${String(i).padStart(4, "0")}`,
    date: new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString(),
    value: close,
    high: close + 1,
    low: close - 1,
    volume: 500 + i,
  };
});

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("PortalSqlHandleService.produceFromTransform (#159)", () => {
  async function makeSource() {
    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows: OHLCV,
      stationId: "s1",
      organizationId: "o1",
    });
    return envelope.queryHandle;
  }

  async function drain(handleId: string) {
    const rows: Array<Record<string, unknown>> = [];
    for await (const batch of PortalSqlHandleService.streamHandle(
      handleId,
      "date"
    )) {
      rows.push(...batch);
    }
    return rows;
  }

  it("produces a transform handle whose rows equal the array path (SMA)", async () => {
    const sourceHandle = await makeSource();
    const { envelope } = await PortalSqlHandleService.produceFromTransform({
      transform: {
        kind: "technical_indicator",
        sourceHandle,
        dateColumn: "date",
        valueColumn: "value",
        indicator: "SMA",
        params: { period: 5 },
      },
      stationId: "s1",
      organizationId: "o1",
    });

    const oracle = AnalyticsService.technicalIndicator({
      records: OHLCV,
      dateColumn: "date",
      valueColumn: "value",
      indicator: "SMA",
      params: { period: 5 },
    });

    // Envelope: derived (sql null), full output count, schema from output rows.
    expect(envelope.sql).toBeNull();
    expect(envelope.rowCount).toBe(oracle.values.length);
    expect(envelope.schema.map((c) => c.name)).toEqual(
      expect.arrayContaining(["date", "value", "_record_id"])
    );
    expect(envelope.samplePeek[0]).toMatchObject({ value: oracle.values[0] });

    // Read back through the normal handle paths.
    const snap = await PortalSqlHandleService.getSnapshot(
      envelope.queryHandle,
      { offset: 0, limit: 5_000 }
    );
    expect(snap.rows).toHaveLength(oracle.values.length);
    snap.rows.forEach((r, i) =>
      expect(r.value as number).toBeCloseTo(oracle.values[i] as number, 9)
    );

    // streamHandle yields the folded series in date order.
    const streamed = await drain(envelope.queryHandle);
    expect(streamed.map((r) => r.date)).toEqual(oracle.dates);
  });

  it("emits multi-column rows for object indicators (MACD)", async () => {
    const sourceHandle = await makeSource();
    const { envelope } = await PortalSqlHandleService.produceFromTransform({
      transform: {
        kind: "technical_indicator",
        sourceHandle,
        dateColumn: "date",
        valueColumn: "value",
        indicator: "MACD",
        params: {},
      },
      stationId: "s1",
      organizationId: "o1",
    });
    const names = envelope.schema.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["date", "macd"]));
    expect(envelope.rowCount).toBeGreaterThan(0);
  });

  it("carries the source tiebreaker so the transform handle is itself streamable", async () => {
    const sourceHandle = await makeSource();
    const { envelope } = await PortalSqlHandleService.produceFromTransform({
      transform: {
        kind: "technical_indicator",
        sourceHandle,
        dateColumn: "date",
        valueColumn: "value",
        indicator: "EMA",
        params: { period: 5 },
      },
      stationId: "s1",
      organizationId: "o1",
    });
    expect(envelope.schema.some((c) => c.name === "_record_id")).toBe(true);
    const streamed = await drain(envelope.queryHandle);
    expect(typeof streamed[0]._record_id).toBe("string");
  });
});
