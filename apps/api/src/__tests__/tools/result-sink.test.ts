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

const { resolveResultSink } = await import("../../tools/result-sink.js");
const { PortalSqlHandleService } = await import(
  "../../services/portal-sql-handle.service.js"
);

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
  const smaTransform = (sourceHandle: string) =>
    ({
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
