/**
 * entity_record_clear processor (#453).
 *
 * The clear soft-deletes every record of one connector entity plus its
 * wide-table mirror, inside one transaction, and reports the driver's
 * affected-row count. It deliberately takes NO advisory lock (#460/#461):
 * it deletes everything rather than reaping by watermark, so a stall
 * re-delivered second pass double-soft-deletes idempotently — the
 * instance-level job lock (JOB_LOCK_KEYS) is what excludes syncs.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSoftDeleteByConnectorEntityId =
  jest.fn<(...a: unknown[]) => Promise<number>>();
const mockMarkDeletedByConnectorEntity = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockDbTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    transaction: mockDbTransaction,
    repository: {
      entityRecords: {
        softDeleteByConnectorEntityId: mockSoftDeleteByConnectorEntityId,
      },
      wideTable: {
        markDeletedByConnectorEntity: mockMarkDeletedByConnectorEntity,
      },
    },
  },
}));

// The repositories reach getRedisClient() through the record-count cache —
// a real ioredis socket nothing in a unit test closes (#377). Mock it.
jest.unstable_mockModule(
  "../../../services/entity-record-count.cache.js",
  () => ({
    EntityRecordCountCache: {
      invalidate: jest
        .fn<(...a: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    },
  })
);

const { entityRecordClearProcessor } =
  await import("../../../queues/processors/entity-record-clear.processor.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBullJob(): BullJob {
  return {
    data: {
      jobId: "job-453",
      type: "entity_record_clear",
      connectorEntityId: "ce-453",
      connectorInstanceId: "ci-453",
      organizationId: "org-1",
      userId: "user-1",
    },
    updateProgress: jest.fn(),
  } as unknown as BullJob;
}

beforeEach(() => {
  mockSoftDeleteByConnectorEntityId.mockReset();
  mockMarkDeletedByConnectorEntity.mockReset().mockResolvedValue(undefined);
  mockDbTransaction.mockClear();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("entityRecordClearProcessor (#453)", () => {
  it("soft-deletes the records then marks the wide table, both on the same transaction", async () => {
    mockSoftDeleteByConnectorEntityId.mockResolvedValue(7);

    await entityRecordClearProcessor(createMockBullJob());

    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(mockSoftDeleteByConnectorEntityId).toHaveBeenCalledWith(
      "ce-453",
      "user-1",
      "mock-tx"
    );
    // The wide-table tombstone must ride the SAME tx — a crash between the
    // two writes would otherwise leave live wide rows for dead records.
    expect(mockMarkDeletedByConnectorEntity).toHaveBeenCalledWith(
      "ce-453",
      "mock-tx"
    );
  });

  it("returns the driver's affected-row count", async () => {
    mockSoftDeleteByConnectorEntityId.mockResolvedValue(400_920);

    await expect(
      entityRecordClearProcessor(createMockBullJob())
    ).resolves.toEqual({ deleted: 400_920 });
  });

  it("skips the wide-table mark when nothing was deleted", async () => {
    mockSoftDeleteByConnectorEntityId.mockResolvedValue(0);

    await expect(
      entityRecordClearProcessor(createMockBullJob())
    ).resolves.toEqual({ deleted: 0 });
    expect(mockMarkDeletedByConnectorEntity).not.toHaveBeenCalled();
  });

  it("propagates a repository throw — BullMQ owns the retry", async () => {
    const boom = new Error("relation does not exist");
    mockSoftDeleteByConnectorEntityId.mockRejectedValue(boom);

    await expect(
      entityRecordClearProcessor(createMockBullJob())
    ).rejects.toThrow(boom);
  });
});
