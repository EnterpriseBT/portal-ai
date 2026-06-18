import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

const mockRedisSet = jest.fn<() => Promise<unknown>>().mockResolvedValue("OK");
const mockRedisGet = jest
  .fn<(key: string) => Promise<string | null>>()
  .mockResolvedValue(null);
const mockRedisPublish = jest.fn<() => Promise<number>>().mockResolvedValue(1);

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    set: mockRedisSet,
    get: mockRedisGet,
    publish: mockRedisPublish,
  }),
}));

const mockRunSqlQuery =
  jest.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [] });

jest.unstable_mockModule("../../services/portal-sql.service.js", () => ({
  PortalSqlService: {
    runSqlQuery: mockRunSqlQuery,
  },
}));

const { PortalSqlHandleService, streamChannelKey } = await import(
  "../../services/portal-sql-handle.service.js"
);
const { ApiCode } = await import("../../constants/api-codes.constants.js");

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisSet.mockResolvedValue("OK");
  mockRedisGet.mockResolvedValue(null);
  mockRedisPublish.mockResolvedValue(1);
});

describe("PortalSqlHandleService.produce", () => {
  it("returns an envelope with rowCount, schema, samplePeek", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      // First-row value drives detection; use a non-integer so the
      // first sample registers as numeric.
      acreage: 0.5 + i * 1.5,
      assessed_value: 10000 + i,
    }));
    mockRunSqlQuery.mockResolvedValueOnce({ rows });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT acreage, assessed_value FROM parcels",
    });

    expect(envelope.queryHandle).toMatch(/^qh-/);
    expect(envelope.rowCount).toBe(50);
    expect(envelope.schema).toEqual([
      { name: "acreage", type: "numeric" },
      { name: "assessed_value", type: "integer" },
    ]);
    expect(envelope.sampled).toBe(false);
    expect(envelope.samplePeek).toHaveLength(10);
    expect(envelope.samplePeek[0]).toEqual({
      acreage: 0.5,
      assessed_value: 10000,
    });
  });

  // #129 slice 1: the envelope retains the query for the cursor tier.
  // Sort-key resolution (and a live cursor) is the slice-2 spike — for now
  // sortKey is null and cursor is false, so every handle stays the
  // ≤HANDLE_ROW_CAP snapshot it is today.
  it("retains sql and reports no cursor yet (sortKey null, cursor false)", async () => {
    mockRunSqlQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT x FROM t",
    });
    expect(envelope.sql).toBe("SELECT x FROM t");
    expect(envelope.sortKey).toBeNull();
    expect(envelope.cursor).toBe(false);
  });

  // #129 slice 2: the stored meta carries station/org (internal) so the
  // cursor tier can re-execute `sql` via PortalSqlService. They are NOT on
  // the agent-facing envelope.
  it("stores stationId/organizationId on the meta but not the envelope", async () => {
    mockRunSqlQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-9",
      organizationId: "org-9",
      sql: "SELECT x FROM t",
    });
    // not on the public envelope
    expect(
      (envelope as unknown as Record<string, unknown>)._stationId
    ).toBeUndefined();
    // present on the stored meta JSON
    const calls = mockRedisSet.mock.calls as unknown as Array<[string, string]>;
    const metaCall = calls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith(":meta")
    );
    expect(metaCall).toBeDefined();
    const stored = JSON.parse(metaCall![1]) as Record<string, unknown>;
    expect(stored._stationId).toBe("station-9");
    expect(stored._organizationId).toBe("org-9");
  });

  it("marks the envelope sampled when rowCount > SAMPLING_THRESHOLD", async () => {
    const rows = Array.from({ length: 60_000 }, (_, i) => ({ x: i }));
    mockRunSqlQuery.mockResolvedValueOnce({ rows });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT x FROM huge",
    });

    expect(envelope.sampled).toBe(true);
    expect(envelope.sampleSize).toBeGreaterThan(0);
  });

  it("writes meta + batches to Redis and publishes data + complete events", async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => ({ x: i }));
    mockRunSqlQuery.mockResolvedValueOnce({ rows });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT x FROM mid",
    });

    // 1 meta + 3 batches (2500 / 1000 → ceil(2.5) = 3)
    expect(mockRedisSet).toHaveBeenCalledTimes(4);
    // 3 data events + 1 complete event
    expect(mockRedisPublish).toHaveBeenCalledTimes(4);

    const channel = streamChannelKey(envelope.queryHandle);
    const publishCalls = mockRedisPublish.mock.calls as unknown as [
      string,
      string,
    ][];
    expect(publishCalls.every(([c]) => c === channel)).toBe(true);

    const events = publishCalls.map((c) => JSON.parse(c[1]));
    expect(events.filter((e) => e.type === "data")).toHaveLength(3);
    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
  });

  it("derives schema entries with detected types", async () => {
    mockRunSqlQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Alice",
          age: 33,
          balance: 99.5,
          active: true,
          created: new Date(),
          tags: { count: 2 },
        },
      ],
    });

    const { envelope } = await PortalSqlHandleService.produce({
      stationId: "station-1",
      organizationId: "org-1",
      sql: "SELECT * FROM users LIMIT 1",
    });

    const map = new Map(envelope.schema.map((s) => [s.name, s.type]));
    expect(map.get("name")).toBe("text");
    expect(map.get("age")).toBe("integer");
    expect(map.get("balance")).toBe("numeric");
    expect(map.get("active")).toBe("boolean");
    expect(map.get("created")).toBe("timestamptz");
    expect(map.get("tags")).toBe("jsonb");
  });

  it("throws REQUEST_PAYLOAD_TOO_LARGE when upstream collapsed to a sample shape", async () => {
    mockRunSqlQuery.mockResolvedValueOnce({
      truncated: true,
      sample: [{ x: 1 }],
      totalCount: 10_000_000,
      columnSizes: { x: 4 },
      hint: "too big",
    });

    await expect(
      PortalSqlHandleService.produce({
        stationId: "station-1",
        organizationId: "org-1",
        sql: "SELECT * FROM gigantic",
      })
    ).rejects.toMatchObject({ code: ApiCode.REQUEST_PAYLOAD_TOO_LARGE });
  });
});

describe("PortalSqlHandleService.getSnapshot", () => {
  it("throws READ_HANDLE_EXPIRED when the handle's meta key is missing", async () => {
    mockRedisGet.mockResolvedValueOnce(null);

    await expect(
      PortalSqlHandleService.getSnapshot("qh-missing", { offset: 0, limit: 100 })
    ).rejects.toMatchObject({ code: ApiCode.READ_HANDLE_EXPIRED });
  });

  it("returns a paged window from cached batches", async () => {
    const meta = JSON.stringify({
      queryHandle: "qh-x",
      rowCount: 1_500,
      schema: [],
      sampled: false,
      truncated: false,
      samplePeek: [],
    });
    const batch0 = JSON.stringify(
      Array.from({ length: 1_000 }, (_, i) => ({ x: i }))
    );
    const batch1 = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ x: 1_000 + i }))
    );

    mockRedisGet.mockImplementation(async (key) => {
      if (key.endsWith(":meta")) return meta;
      if (key.endsWith(":batches:0")) return batch0;
      if (key.endsWith(":batches:1")) return batch1;
      return null;
    });

    const result = await PortalSqlHandleService.getSnapshot("qh-x", {
      offset: 950,
      limit: 100,
    });

    expect(result.total).toBe(1_500);
    expect(result.offset).toBe(950);
    expect(result.rows).toHaveLength(100);
    expect(result.rows[0]).toEqual({ x: 950 });
    expect(result.rows[99]).toEqual({ x: 1_049 });
  });

  it("caps limit at 5_000", async () => {
    mockRedisGet.mockImplementationOnce(async () =>
      JSON.stringify({
        queryHandle: "qh-x",
        rowCount: 10_000,
        schema: [],
        sampled: false,
        truncated: false,
        samplePeek: [],
      })
    );
    mockRedisGet.mockImplementation(async () => null);

    const result = await PortalSqlHandleService.getSnapshot("qh-x", {
      offset: 0,
      limit: 50_000,
    });

    expect(result.limit).toBe(5_000);
  });
});

// #129 slice 2: the cursor stream (streamHandle).
describe("PortalSqlHandleService.streamHandle", () => {
  async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const x of gen) out.push(x);
    return out;
  }

  const baseMeta = {
    queryHandle: "qh-s",
    schema: [
      { name: "id", type: "integer" },
      { name: "ts", type: "integer" },
    ],
    sampled: false,
    truncated: false,
    samplePeek: [],
    sql: "SELECT id, ts FROM t",
    sortKey: null,
    cursor: false,
    _stationId: "st",
    _organizationId: "org",
  };

  it("≤cap: yields the snapshot sorted by (orderBy, id), no re-execution", async () => {
    const meta = { ...baseMeta, rowCount: 4 };
    const batch = [
      { id: 3, ts: 2 },
      { id: 1, ts: 1 },
      { id: 2, ts: 2 },
      { id: 0, ts: 0 },
    ];
    mockRedisGet.mockImplementation(async (key: string) => {
      if (key.endsWith(":meta")) return JSON.stringify(meta);
      if (key.endsWith(":batches:0")) return JSON.stringify(batch);
      return null;
    });

    const flat = (
      await collect(PortalSqlHandleService.streamHandle("qh-s", "ts"))
    ).flat();
    expect(flat.map((r) => r.id)).toEqual([0, 1, 2, 3]); // (ts,id) order
    expect(mockRunSqlQuery).not.toHaveBeenCalled();
  });

  it(">cap: keyset re-executes, advancing the cursor, terminating on a short page", async () => {
    const meta = { ...baseMeta, rowCount: 100_001, truncated: true };
    mockRedisGet.mockImplementation(async (key: string) =>
      key.endsWith(":meta") ? JSON.stringify(meta) : null
    );
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: i, ts: i }));
    const shortPage = [{ id: 1000, ts: 1000 }];
    mockRunSqlQuery
      .mockResolvedValueOnce({ rows: fullPage })
      .mockResolvedValueOnce({ rows: shortPage });

    const out = await collect(PortalSqlHandleService.streamHandle("qh-s", "ts"));
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1000);
    expect(out[1]).toHaveLength(1);
    expect(mockRunSqlQuery).toHaveBeenCalledTimes(2);

    const calls = mockRunSqlQuery.mock.calls as unknown as Array<
      [{ sql: string }]
    >;
    const firstSql = calls[0][0].sql;
    expect(firstSql).toContain(`SELECT * FROM (SELECT id, ts FROM t) "_cur"`);
    expect(firstSql).toContain(`ORDER BY "ts" ASC, "id" ASC`);
    expect(firstSql).toContain("LIMIT 1000");
    expect(firstSql).not.toContain("WHERE");

    const secondSql = calls[1][0].sql;
    expect(secondSql).toContain(`WHERE ("ts", "id") > (999, 999)`);
  });

  it("throws when the result lacks a unique id tiebreaker", async () => {
    const meta = { ...baseMeta, rowCount: 5, schema: [{ name: "ts", type: "integer" }] };
    mockRedisGet.mockImplementation(async (key: string) =>
      key.endsWith(":meta") ? JSON.stringify(meta) : null
    );
    await expect(
      collect(PortalSqlHandleService.streamHandle("qh-s", "ts"))
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });
});
