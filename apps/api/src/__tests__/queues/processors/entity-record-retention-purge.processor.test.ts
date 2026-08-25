/**
 * Unit tests for the entity-record retention purge processor (#442).
 *
 * The repository seam is proven against a real database in
 * `entity-records-purge.integration.test.ts`. What is unit-testable — and
 * what actually went wrong in the ticket's history — is the *loop*: a purge
 * that stops early leaves the backlog to grow again, and a purge that never
 * stops holds a worker slot forever.
 *
 * So these tests pin the drain, the two windows, and the summary. The
 * repository is mocked precisely so a wrong loop cannot hide behind a
 * database that happens to run out of rows.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockPurge =
  jest.fn<
    (
      cutoffMs: number,
      batchSize: number,
      scope: "orphan" | "live"
    ) => Promise<number>
  >();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: { entityRecords: { purgeTombstonedBefore: mockPurge } },
  },
}));

jest.unstable_mockModule("../../../environment.js", () => ({
  environment: {
    ENTITY_RECORD_RETENTION_DAYS: 30,
    ENTITY_RECORD_ORPHAN_RETENTION_DAYS: 7,
    // The processor's logger reads this at module load; pino rejects
    // `level: undefined`.
    LOG_LEVEL: "silent",
  },
}));

const { entityRecordRetentionPurgeProcessor } =
  await import("../../../queues/processors/entity-record-retention-purge.processor.js");

const DAY = 24 * 60 * 60 * 1000;
/** A fixed clock so the cutoffs are exact, not approximate. */
const NOW = 1_800_000_000_000;

/**
 * Queue per-scope return values. Each scope drains its own list and then
 * returns 0 forever, so a loop that ignores the zero would hang rather than
 * silently pass.
 */
const drains = (byScope: Record<"orphan" | "live", number[]>) => {
  const queues = {
    orphan: [...byScope.orphan],
    live: [...byScope.live],
  };
  mockPurge.mockImplementation(async (_cutoff, _size, scope) =>
    queues[scope].length > 0 ? (queues[scope].shift() as number) : 0
  );
};

describe("entityRecordRetentionPurgeProcessor (#442)", () => {
  beforeEach(() => {
    mockPurge.mockReset();
  });

  it("drains each scope until the repository reports 0", async () => {
    drains({ orphan: [10_000, 10_000, 2_500], live: [10_000, 400] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary.purgedOrphan).toBe(22_500);
    expect(summary.purgedLive).toBe(10_400);
    // 3 + 1 orphan calls and 2 + 1 live calls — the trailing zero that
    // terminates each loop is a real call, and is counted as such.
    expect(mockPurge).toHaveBeenCalledTimes(7);
  });

  it("counts batches, not rows", async () => {
    drains({ orphan: [10_000, 1], live: [] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary.batches).toBe(2);
    expect(summary.purgedOrphan).toBe(10_001);
  });

  it("derives the two cutoffs from the two windows and the injected clock", async () => {
    drains({ orphan: [1], live: [1] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    const orphanCall = mockPurge.mock.calls.find((c) => c[2] === "orphan");
    const liveCall = mockPurge.mock.calls.find((c) => c[2] === "live");

    expect(orphanCall?.[0]).toBe(NOW - 7 * DAY);
    expect(liveCall?.[0]).toBe(NOW - 30 * DAY);
    // The summary reports what it enforced, so an operator reading
    // `GET /api/admin/maintenance` can tell which windows were in effect.
    expect(summary.orphanCutoff).toBe(new Date(NOW - 7 * DAY).toISOString());
    expect(summary.liveCutoff).toBe(new Date(NOW - 30 * DAY).toISOString());
  });

  it("the orphan window is the shorter of the two", async () => {
    // Not a tautology of the mocked env: this asserts the processor pairs
    // each window with the scope it belongs to. Swapping them would leave
    // orphans waiting out the long window and purge recoverable rows early.
    drains({ orphan: [1], live: [1] });

    await entityRecordRetentionPurgeProcessor({ now: NOW });

    const orphanCutoff = mockPurge.mock.calls.find(
      (c) => c[2] === "orphan"
    )![0];
    const liveCutoff = mockPurge.mock.calls.find((c) => c[2] === "live")![0];
    expect(orphanCutoff).toBeGreaterThan(liveCutoff);
  });

  it("runs both scopes even when one has nothing to do", async () => {
    drains({ orphan: [], live: [5] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary.purgedOrphan).toBe(0);
    expect(summary.purgedLive).toBe(5);
    expect(mockPurge.mock.calls.some((c) => c[2] === "orphan")).toBe(true);
  });

  it("passes the batch size through, and the test seam overrides it", async () => {
    drains({ orphan: [7], live: [] });

    await entityRecordRetentionPurgeProcessor({ now: NOW, batchSize: 7 });

    expect(mockPurge.mock.calls[0][1]).toBe(7);
  });

  it("is a no-op on an empty backlog", async () => {
    drains({ orphan: [], live: [] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary).toMatchObject({
      purgedOrphan: 0,
      purgedLive: 0,
      batches: 0,
    });
    // Idempotence: the second daily run is this, and it must stay cheap —
    // one probe per scope, no retry storm.
    expect(mockPurge).toHaveBeenCalledTimes(2);
  });
});
