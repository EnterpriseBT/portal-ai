import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { Production } from "@portalai/core/models";

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
const mockSqlQuery = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ rows: [] });
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { sqlQuery: mockSqlQuery },
}));

const { resolveResultSink } = await import("../../tools/result-sink.js");
const { PortalSqlHandleService } =
  await import("../../services/portal-sql-handle.service.js");

const CTX = { stationId: "s1", organizationId: "o1" };
const rowsProd = (onLarge: "handle" | "sample" | "error"): Production => ({
  kind: "rows",
  onLarge,
  inlineThreshold: 5,
});

async function* asStream(rows: Record<string, unknown>[], batch = 2) {
  for (let i = 0; i < rows.length; i += batch) yield rows.slice(i, i + batch);
}
const mkRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ i, v: i * 2 }));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("resolveResultSink (#161)", () => {
  it("value → returned inline as-is", async () => {
    const out = await resolveResultSink(
      { kind: "value" },
      { value: { mape: 0.04 } },
      CTX
    );
    expect(out).toEqual({ mape: 0.04 });
  });

  it("rows ≤ threshold → inline { rows }", async () => {
    const out: any = await resolveResultSink(
      rowsProd("handle"),
      { rows: asStream(mkRows(5)) },
      CTX
    );
    expect(out.type).toBeUndefined();
    expect(out.rows).toHaveLength(5);
  });

  it("rows > threshold + onLarge:handle → transform-free handle envelope", async () => {
    const out: any = await resolveResultSink(
      rowsProd("handle"),
      { rows: asStream(mkRows(40)) },
      CTX
    );
    expect(out.type).toBe("data-table");
    expect(out.rowCount).toBe(40);
    expect(out.sql).toBeNull();
    // Round-trips: the staged handle reads back the full set.
    const snap = await PortalSqlHandleService.getSnapshot(out.queryHandle, {
      offset: 0,
      limit: 5_000,
    });
    expect(snap.rows).toHaveLength(40);
  });

  it("rows > threshold + onLarge:error → COMPUTE_OUTPUT_TOO_LARGE", async () => {
    await expect(
      resolveResultSink(rowsProd("error"), { rows: asStream(mkRows(40)) }, CTX)
    ).rejects.toMatchObject({ code: "COMPUTE_OUTPUT_TOO_LARGE" });
  });

  it("rows > threshold + onLarge:sample → flagged sample of threshold size", async () => {
    const out: any = await resolveResultSink(
      rowsProd("sample"),
      { rows: asStream(mkRows(40)) },
      CTX
    );
    expect(out.sampled).toBe(true);
    expect(out.rows).toHaveLength(5);
    expect(out.type).toBeUndefined(); // inline, not a handle
  });

  // ── transform sinks ──
  const OHLCV = Array.from({ length: 30 }, (_, i) => ({
    _record_id: `r-${String(i).padStart(3, "0")}`,
    date: new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString(),
    value: 100 + i,
  }));
  const smaTransform = (sourceHandle: string) => ({
    kind: "technical_indicator" as const,
    sourceHandle,
    dateColumn: "date",
    valueColumn: "value",
    indicator: "SMA" as const,
    params: { period: 3 },
  });

  async function source() {
    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows: OHLCV,
      stationId: "s1",
      organizationId: "o1",
    });
    return envelope.queryHandle;
  }

  it("transform, small source → folded inline { rows }", async () => {
    const h = await source();
    const out: any = await resolveResultSink(
      { kind: "rows", onLarge: "handle" }, // default threshold 100 > 30
      { transform: smaTransform(h) },
      CTX
    );
    expect(out.type).toBeUndefined();
    expect(out.rows).toHaveLength(30 - 2); // SMA(3) warmup drops 2
    expect(out.rows[0]).toHaveProperty("value");
  });

  it("transform, source > threshold → transform handle (sql null, re-foldable)", async () => {
    const h = await source();
    const out: any = await resolveResultSink(
      rowsProd("handle"), // threshold 5 < 30
      { transform: smaTransform(h) },
      CTX
    );
    expect(out.type).toBe("data-table");
    expect(out.rowCount).toBe(28);
    expect(out.sql).toBeNull();
  });
});

// ── The durable pipeline on SQL-backed results (#349) ────────────────
//
// Every `{ sql }` delivery — inline or handle — carries its re-executable
// pipeline, so a small result is a fast first paint rather than a terminal
// snapshot. Sinks with no originating SELECT stay pipeline-free.

/** The fields these cases inspect — narrower than the sink's `unknown`. */
type SinkOut = {
  type?: string;
  rows?: unknown[];
  sample?: unknown[];
  totalCount?: number;
  truncated?: boolean;
  queryHandle?: string;
  pipeline?: { sql: string; stationId: string; organizationId: string };
};

describe("resolveResultSink { sql } → durable pipeline (#349)", () => {
  const SQL = "SELECT name, acres FROM parcels ORDER BY acres DESC LIMIT 10";
  const EXPECTED_PIPELINE = {
    sql: SQL,
    stationId: "s1",
    organizationId: "o1",
  };

  it("inline { rows } carries the pipeline and preserves the rows", async () => {
    mockSqlQuery.mockResolvedValueOnce({ rows: mkRows(3) });
    const out = (await resolveResultSink(
      rowsProd("handle"),
      { sql: SQL },
      CTX
    )) as SinkOut;
    expect(out.pipeline).toEqual(EXPECTED_PIPELINE);
    expect(out.rows).toHaveLength(3);
    expect(out.type).toBeUndefined();
  });

  it("inline { rows, truncated, totalCount } shape is preserved alongside the pipeline", async () => {
    mockSqlQuery.mockResolvedValueOnce({
      rows: mkRows(4),
      truncated: false,
      totalCount: 4,
    });
    const out = (await resolveResultSink(
      rowsProd("handle"),
      { sql: SQL },
      CTX
    )) as SinkOut;
    expect(out.pipeline).toEqual(EXPECTED_PIPELINE);
    expect(out.totalCount).toBe(4);
    expect(out.truncated).toBe(false);
    expect(out.rows).toHaveLength(4);
  });

  it("inline { sample, totalCount } shape is preserved alongside the pipeline", async () => {
    mockSqlQuery.mockResolvedValueOnce({ sample: mkRows(2), totalCount: 2 });
    const out = (await resolveResultSink(
      rowsProd("handle"),
      { sql: SQL },
      CTX
    )) as SinkOut;
    expect(out.pipeline).toEqual(EXPECTED_PIPELINE);
    expect(out.sample).toHaveLength(2);
    expect(out.totalCount).toBe(2);
  });

  it("handle branch returns { type: data-table, ...envelope, pipeline }", async () => {
    // 6 rows > the fixture threshold of 5 → the handle branch.
    mockSqlQuery.mockResolvedValueOnce({ rows: mkRows(6) });
    const produceSpy = jest
      .spyOn(PortalSqlHandleService, "produce")
      .mockResolvedValue({
        envelope: {
          queryHandle: "qh-1",
          rowCount: 6,
          schema: [],
          sampled: false,
          truncated: false,
          samplePeek: [],
          sql: SQL,
        },
      } as never);

    const out = (await resolveResultSink(
      rowsProd("handle"),
      { sql: SQL },
      CTX
    )) as SinkOut;
    expect(out.type).toBe("data-table");
    expect(out.queryHandle).toBe("qh-1");
    expect(out.pipeline).toEqual(EXPECTED_PIPELINE);
    produceSpy.mockRestore();
  });

  // The over-reach guard: these sinks have no originating SELECT to re-run,
  // so inventing a pipeline for them would make an un-refreshable result
  // claim to be refreshable.
  it("value sink attaches no pipeline", async () => {
    const out = (await resolveResultSink(
      { kind: "value" },
      { value: { mape: 0.04 } },
      CTX
    )) as SinkOut;
    expect(out.pipeline).toBeUndefined();
  });

  it("rows sink attaches no pipeline", async () => {
    const out = (await resolveResultSink(
      rowsProd("handle"),
      { rows: asStream(mkRows(3)) },
      CTX
    )) as SinkOut;
    expect(out.pipeline).toBeUndefined();
  });
});
