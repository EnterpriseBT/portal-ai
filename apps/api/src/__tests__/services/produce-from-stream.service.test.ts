import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { HANDLE_ROW_CAP } from "@portalai/core/constants";

// Stateful in-memory Redis fake so a handle round-trips (produce → getMeta →
// getSnapshot) without a real server. Mirrors transform-handle.service.test.
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

const { PortalSqlHandleService } =
  await import("../../services/portal-sql-handle.service.js");

async function* asStream(rows: Record<string, unknown>[], batchSize: number) {
  for (let i = 0; i < rows.length; i += batchSize) {
    yield rows.slice(i, i + batchSize);
  }
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("PortalSqlHandleService.produceFromStream (#161)", () => {
  it("stages a snapshot handle from an async row stream (sql null)", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      bucket: `b-${i}`,
      n: i,
    }));
    const { envelope } = await PortalSqlHandleService.produceFromStream({
      rows: asStream(rows, 64),
      stationId: "s1",
      organizationId: "o1",
    });

    expect(envelope.sql).toBeNull();
    expect(envelope.rowCount).toBe(250);
    expect(envelope.truncated).toBe(false);
    expect(envelope.schema.map((c) => c.name)).toEqual(["bucket", "n"]);
    expect(envelope.samplePeek[0]).toEqual({ bucket: "b-0", n: 0 });

    // Round-trips through the normal snapshot path.
    const snap = await PortalSqlHandleService.getSnapshot(
      envelope.queryHandle,
      { offset: 0, limit: 5_000 }
    );
    expect(snap.rows).toHaveLength(250);
    expect(snap.rows[249]).toEqual({ bucket: "b-249", n: 249 });
  });

  it("honors an explicit schema override", async () => {
    const { envelope } = await PortalSqlHandleService.produceFromStream({
      rows: asStream([{ x: 1 }], 1),
      schema: [{ name: "x", type: "double precision" }],
      stationId: "s1",
      organizationId: "o1",
    });
    expect(envelope.schema).toEqual([{ name: "x", type: "double precision" }]);
  });

  it("caps the snapshot at HANDLE_ROW_CAP and flags truncation, counting the full stream", async () => {
    const N = HANDLE_ROW_CAP + 5;
    // Generator never materializes all N at once — bounded memory.
    async function* big() {
      for (let i = 0; i < N; i += 1_000) {
        const end = Math.min(i + 1_000, N);
        const batch: Record<string, unknown>[] = [];
        for (let j = i; j < end; j++) batch.push({ i: j });
        yield batch;
      }
    }
    const { envelope } = await PortalSqlHandleService.produceFromStream({
      rows: big(),
      stationId: "s1",
      organizationId: "o1",
    });
    expect(envelope.rowCount).toBe(N); // full count
    expect(envelope.truncated).toBe(true); // snapshot is partial
    // Snapshot holds only the cap.
    const snap = await PortalSqlHandleService.getSnapshot(
      envelope.queryHandle,
      { offset: HANDLE_ROW_CAP - 2, limit: 5_000 }
    );
    expect(snap.rows.length).toBe(2); // only up to the cap is staged
  }, 20_000);

  it("produces an empty handle for an empty stream", async () => {
    const { envelope } = await PortalSqlHandleService.produceFromStream({
      rows: asStream([], 10),
      stationId: "s1",
      organizationId: "o1",
    });
    expect(envelope.rowCount).toBe(0);
    expect(envelope.schema).toEqual([]);
    expect(envelope.truncated).toBe(false);
  });
});
