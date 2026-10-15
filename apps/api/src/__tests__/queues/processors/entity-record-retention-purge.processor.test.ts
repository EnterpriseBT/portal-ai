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
      scope: "orphan" | "live" | "stranded"
    ) => Promise<number>
  >();
const mockFindLeftoverTables =
  jest.fn<
    (cutoffMs: number, limit: number, excludeIds: string[]) => Promise<string[]>
  >();
const mockDropTable = jest.fn<(entityId: string) => Promise<void>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { purgeTombstonedBefore: mockPurge },
      wideTable: {
        findEntityIdsWithTableDeletedBefore: mockFindLeftoverTables,
      },
    },
  },
}));

jest.unstable_mockModule(
  "../../../services/wide-table-reconciler.service.js",
  () => ({ wideTableReconcilerService: { dropTable: mockDropTable } })
);

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
const drains = (
  byScope: Record<"orphan" | "live", number[]> & { stranded?: number[] }
) => {
  const queues = {
    orphan: [...byScope.orphan],
    live: [...byScope.live],
    stranded: [...(byScope.stranded ?? [])],
  };
  mockPurge.mockImplementation(async (_cutoff, _size, scope) =>
    queues[scope].length > 0 ? (queues[scope].shift() as number) : 0
  );
};

describe("entityRecordRetentionPurgeProcessor (#442)", () => {
  beforeEach(() => {
    mockPurge.mockReset();
    mockFindLeftoverTables.mockReset().mockResolvedValue([]);
    mockDropTable.mockReset().mockResolvedValue(undefined);
  });

  it("drains each scope until the repository reports 0", async () => {
    drains({ orphan: [10_000, 10_000, 2_500], live: [10_000, 400] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary.purgedOrphan).toBe(22_500);
    expect(summary.purgedLive).toBe(10_400);
    // 3 + 1 orphan calls, 2 + 1 live calls and 0 + 1 stranded — the
    // trailing zero that terminates each loop is a real call, and is
    // counted as such.
    expect(mockPurge).toHaveBeenCalledTimes(8);
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
    // The summary reports what it enforced, so the run's BullMQ
    // returnvalue says which windows were in effect.
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

  it("#802: drains the stranded scope at the orphan cutoff", async () => {
    drains({ orphan: [], live: [], stranded: [10_000, 3] });

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(summary.purgedStranded).toBe(10_003);
    const strandedCall = mockPurge.mock.calls.find((c) => c[2] === "stranded");
    expect(strandedCall?.[0]).toBe(NOW - 7 * DAY);
  });

  it("#802: drops the wide tables deleted entities left behind", async () => {
    drains({ orphan: [], live: [] });
    mockFindLeftoverTables.mockResolvedValueOnce(["ce-1", "ce-2"]);

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(mockFindLeftoverTables).toHaveBeenCalledWith(NOW - 7 * DAY, 100, []);
    expect(mockDropTable.mock.calls.map((c) => c[0])).toEqual(["ce-1", "ce-2"]);
    expect(summary.wideTablesDropped).toBe(2);
  });

  it("#802: one table that won't drop doesn't stop the rest", async () => {
    drains({ orphan: [], live: [] });
    mockFindLeftoverTables.mockResolvedValueOnce(["ce-1", "ce-2"]);
    mockDropTable.mockRejectedValueOnce(new Error("lock timeout"));

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(mockDropTable).toHaveBeenCalledTimes(2);
    expect(summary.wideTablesDropped).toBe(1);
  });

  it("#802: tables that won't drop don't starve newer ones", async () => {
    drains({ orphan: [], live: [] });
    // The oldest page fails entirely; the next page, which excludes it,
    // still gets dropped in the same run.
    mockFindLeftoverTables
      .mockResolvedValueOnce(["stuck-1", "stuck-2"])
      .mockResolvedValueOnce(["ce-3"])
      .mockResolvedValueOnce([]);
    mockDropTable
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockRejectedValueOnce(new Error("lock timeout"));

    const summary = await entityRecordRetentionPurgeProcessor({ now: NOW });

    expect(mockFindLeftoverTables.mock.calls[1][2]).toEqual([
      "stuck-1",
      "stuck-2",
    ]);
    expect(mockDropTable).toHaveBeenLastCalledWith("ce-3");
    expect(summary.wideTablesDropped).toBe(1);
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
      purgedStranded: 0,
      wideTablesDropped: 0,
      batches: 0,
    });
    // Idempotence: the second daily run is this, and it must stay cheap —
    // one probe per scope (orphan, live, stranded), no retry storm.
    expect(mockPurge).toHaveBeenCalledTimes(3);
  });
});
