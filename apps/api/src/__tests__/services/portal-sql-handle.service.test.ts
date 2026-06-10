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
