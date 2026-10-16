/**
 * The batched sync record writer (#440, slice 2).
 *
 * Replaced the old per-record write path's 3–4 round-trips per record with
 * one bulk read, in-memory classification, and one bulk write per batch —
 * the shape `record-import.util.ts`'s `flushBatch` already uses in
 * production. The per-record path is gone (#812); the writer is the only
 * REST sync write path.
 *
 * The counts contract (`created` / `updated` / `unchanged`, plus the
 * geometry tallies) reaches an API response and an SSE consumer, so a
 * describe block pins the tallies one fixture produces.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ─────────────────────────────────────────────────────────────

const findBySourceIdsForSyncMock = jest.fn<
  (
    entityId: string,
    sourceIds: string[]
  ) => Promise<
    Array<{
      id: string;
      sourceId: string;
      checksum: string;
      created: number;
      createdBy: string;
    }>
  >
>();
const upsertManyBySourceIdMock =
  jest.fn<
    (
      rows: Array<Record<string, unknown>>,
      client?: unknown
    ) => Promise<unknown[]>
  >();
const bulkUpdateSyncedAtMock =
  jest.fn<
    (ids: string[], syncedAt: number, client?: unknown) => Promise<number>
  >();
const upsertWideManyMock = jest.fn<
  (
    entityId: string,
    rows: unknown[],
    client?: unknown
  ) => Promise<{
    repaired: number;
    rejected: Array<{ sourceId: string; reason: string }>;
  }>
>();
const selectMissingWideRowIdsMock =
  jest.fn<
    (entityId: string, ids: ReadonlyArray<string>) => Promise<string[]>
  >();
const transactionMock =
  jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    transaction: transactionMock,
    repository: {
      entityRecords: {
        findBySourceIdsForSync: findBySourceIdsForSyncMock,
        upsertManyBySourceId: upsertManyBySourceIdMock,
        bulkUpdateSyncedAt: bulkUpdateSyncedAtMock,
      },
      wideTable: {
        upsertMany: upsertWideManyMock,
        selectMissingWideRowIds: selectMissingWideRowIdsMock,
      },
    },
  },
}));

jest.unstable_mockModule("../../../services/normalization.service.js", () => ({
  NormalizationService: {
    normalizeWithMappings: () => ({ normalizedData: {}, isValid: true }),
  },
}));

jest.unstable_mockModule("../../../db/client.js", () => ({
  db: { execute: jest.fn(async () => undefined) },
}));

const { createSyncRecordWriter, SYNC_WRITE_BATCH_SIZE, checksumRecord } =
  await import("../../../adapters/rest-api/rest-api.adapter.js");

// ── Fixture ───────────────────────────────────────────────────────────

const ENTITY = "e1111111-1111-1111-1111-111111111111";

function makeCtx(
  overrides: { idField?: string | null; withWideProjection?: boolean } = {}
) {
  return {
    endpoint: {
      entity: { id: ENTITY, key: "k", label: "l" },
      // `?? "pid"` would swallow an explicit `null`, which is exactly the
      // synthetic-source-id case, so test for the key's presence instead.
      config: {
        idField: "idField" in overrides ? overrides.idField : "pid",
      },
    },
    instance: { id: "i1", organizationId: "o1" },
    runStartedAt: 5_000,
    generationKey: "job-abc",
    userId: "u1",
    mappingsForNormalize: [],
    wideProjection:
      overrides.withWideProjection === false
        ? null
        : (new Map([["a", "c_a"]]) as ReadonlyMap<string, string>),
    counts: {
      created: 0,
      updated: 0,
      unchanged: 0,
      recordIndex: 0,
      geometryRepaired: 0,
      geometryRejected: 0,
      geometryRejectedSample: [] as string[],
      nulStrippedValues: 0,
    },
  } as never;
}

const rec = (pid: string) => ({ pid, v: pid });

beforeEach(() => {
  jest.clearAllMocks();
  findBySourceIdsForSyncMock.mockResolvedValue([]);
  upsertManyBySourceIdMock.mockResolvedValue([]);
  bulkUpdateSyncedAtMock.mockResolvedValue(0);
  upsertWideManyMock.mockResolvedValue({ repaired: 0, rejected: [] });
  selectMissingWideRowIdsMock.mockResolvedValue([]);
  transactionMock.mockImplementation((fn) => fn("tx"));
});

// ── Buffering ─────────────────────────────────────────────────────────

describe("createSyncRecordWriter — buffering", () => {
  it("issues no query while the buffer is below the batch size", async () => {
    const w = createSyncRecordWriter(makeCtx());
    for (let i = 0; i < 10; i++) await w.add(rec(`p${i}`));

    expect(findBySourceIdsForSyncMock).not.toHaveBeenCalled();
    expect(upsertManyBySourceIdMock).not.toHaveBeenCalled();
  });

  it("auto-flushes when the buffer reaches SYNC_WRITE_BATCH_SIZE", async () => {
    const w = createSyncRecordWriter(makeCtx());
    for (let i = 0; i < SYNC_WRITE_BATCH_SIZE; i++) await w.add(rec(`p${i}`));

    expect(findBySourceIdsForSyncMock).toHaveBeenCalledTimes(1);
    expect(findBySourceIdsForSyncMock.mock.calls[0][1]).toHaveLength(
      SYNC_WRITE_BATCH_SIZE
    );
  });

  it("flush writes the remainder", async () => {
    const w = createSyncRecordWriter(makeCtx());
    for (let i = 0; i < 3; i++) await w.add(rec(`p${i}`));
    await w.flush();

    expect(findBySourceIdsForSyncMock).toHaveBeenCalledTimes(1);
    expect(findBySourceIdsForSyncMock.mock.calls[0][1]).toEqual([
      "p0",
      "p1",
      "p2",
    ]);
  });

  it("flush on an empty buffer issues nothing", async () => {
    const w = createSyncRecordWriter(makeCtx());
    await w.flush();
    await w.flush();

    expect(findBySourceIdsForSyncMock).not.toHaveBeenCalled();
    expect(bulkUpdateSyncedAtMock).not.toHaveBeenCalled();
  });

  it("skips a non-object record but still advances recordIndex", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add(null);
    await w.add("nope");
    await w.add(rec("p0"));
    await w.flush();

    // Two skips consumed indexes 0 and 1; the real record took index 2.
    expect(
      (ctx as unknown as { counts: { recordIndex: number } }).counts.recordIndex
    ).toBe(3);
    expect(findBySourceIdsForSyncMock.mock.calls[0][1]).toEqual(["p0"]);
  });
  it("never holds more than SYNC_WRITE_BATCH_SIZE records in memory", async () => {
    // The streaming branch back-pressures its parser at 64/32 records
    // precisely to bound memory; the writer's buffer is larger, so the
    // buffer — not the stream — becomes the high-water mark. It must stay
    // bounded by construction, since the memory smoke
    // (`scripts/rest-api-stream-memory-smoke.ts`) drains
    // `streamFetchRecords` through a bare `for await` and never exercises
    // this buffer.
    const ctx = makeCtx();
    let observedMax = 0;
    findBySourceIdsForSyncMock.mockImplementation(async (_e, sourceIds) => {
      observedMax = Math.max(observedMax, sourceIds.length);
      return [];
    });

    const w = createSyncRecordWriter(ctx);
    for (let i = 0; i < SYNC_WRITE_BATCH_SIZE * 3 + 7; i++) {
      await w.add(rec(`p${i}`));
    }
    await w.flush();

    expect(observedMax).toBe(SYNC_WRITE_BATCH_SIZE);
    expect(findBySourceIdsForSyncMock).toHaveBeenCalledTimes(4); // 3 full + 1 remainder
  });
});

// ── Classification ────────────────────────────────────────────────────

describe("createSyncRecordWriter — classification", () => {
  it("classifies created / updated / unchanged from one bulk read", async () => {
    const ctx = makeCtx();
    // p1 exists with a matching checksum (unchanged); p2 exists with a
    // different one (updated); p3 is absent (created).
    const w = createSyncRecordWriter(ctx);
    await w.add(rec("p1"));
    await w.add(rec("p2"));
    await w.add(rec("p3"));

    const sums = (
      await import("../../../adapters/rest-api/rest-api.adapter.js")
    ).checksumRecord;
    findBySourceIdsForSyncMock.mockResolvedValueOnce([
      {
        id: "r1",
        sourceId: "p1",
        checksum: sums({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
      {
        id: "r2",
        sourceId: "p2",
        checksum: "STALE",
        created: 2,
        createdBy: "u0",
      },
    ]);

    await w.flush();

    const counts = (ctx as unknown as { counts: Record<string, number> })
      .counts;
    expect(counts.unchanged).toBe(1);
    expect(counts.updated).toBe(1);
    expect(counts.created).toBe(1);
    expect(findBySourceIdsForSyncMock).toHaveBeenCalledTimes(1);
  });

  it("writes only changed rows through one transaction", async () => {
    const ctx = makeCtx();
    const sums = (
      await import("../../../adapters/rest-api/rest-api.adapter.js")
    ).checksumRecord;
    findBySourceIdsForSyncMock.mockResolvedValueOnce([
      {
        id: "r1",
        sourceId: "p1",
        checksum: sums({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
    ]);

    const w = createSyncRecordWriter(ctx);
    await w.add(rec("p1")); // unchanged
    await w.add(rec("p2")); // created
    await w.flush();

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(upsertManyBySourceIdMock).toHaveBeenCalledTimes(1);
    const written = upsertManyBySourceIdMock.mock.calls[0][0];
    expect(written).toHaveLength(1);
    expect((written[0] as { sourceId: string }).sourceId).toBe("p2");
  });

  it("bumps synced_at for unchanged rows in one batched UPDATE", async () => {
    const ctx = makeCtx();
    const sums = (
      await import("../../../adapters/rest-api/rest-api.adapter.js")
    ).checksumRecord;
    findBySourceIdsForSyncMock.mockResolvedValueOnce([
      {
        id: "r1",
        sourceId: "p1",
        checksum: sums({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
      {
        id: "r2",
        sourceId: "p2",
        checksum: sums({ pid: "p2", v: "p2" }),
        created: 1,
        createdBy: "u0",
      },
    ]);

    const w = createSyncRecordWriter(ctx);
    await w.add(rec("p1"));
    await w.add(rec("p2"));
    await w.flush();

    expect(bulkUpdateSyncedAtMock).toHaveBeenCalledTimes(1);
    expect(bulkUpdateSyncedAtMock.mock.calls[0][0].sort()).toEqual([
      "r1",
      "r2",
    ]);
    expect(bulkUpdateSyncedAtMock.mock.calls[0][1]).toBe(5_000);
    expect(upsertManyBySourceIdMock).not.toHaveBeenCalled();
  });

  it("passes ctx.generationKey to the synthetic source id (guards #439)", async () => {
    const ctx = makeCtx({ idField: null });
    const w = createSyncRecordWriter(ctx);
    await w.add(rec("ignored"));
    await w.flush();

    expect(findBySourceIdsForSyncMock.mock.calls[0][1]).toEqual([
      "api:job-abc:0",
    ]);
  });
});

// ── Wide-table mirror ─────────────────────────────────────────────────

describe("createSyncRecordWriter — wide-table mirror", () => {
  it("mirrors the batch in one upsertMany call", async () => {
    const w = createSyncRecordWriter(makeCtx());
    await w.add(rec("p1"));
    await w.add(rec("p2"));
    await w.flush();

    expect(upsertWideManyMock).toHaveBeenCalledTimes(1);
    expect(upsertWideManyMock.mock.calls[0][1]).toHaveLength(2);
  });

  it("skips the mirror entirely when there is no wide projection", async () => {
    const w = createSyncRecordWriter(makeCtx({ withWideProjection: false }));
    await w.add(rec("p1"));
    await w.flush();

    expect(upsertWideManyMock).not.toHaveBeenCalled();
  });

  it("accumulates geometry tallies and caps the rejected sample at 20", async () => {
    const ctx = makeCtx();
    upsertWideManyMock.mockResolvedValue({
      repaired: 3,
      rejected: Array.from({ length: 25 }, (_, i) => ({
        sourceId: `bad-${i}`,
        reason: "GEOMETRY_INVALID_ON_IMPORT",
      })),
    });

    const w = createSyncRecordWriter(ctx);
    await w.add(rec("p1"));
    await w.flush();

    const counts = (
      ctx as unknown as {
        counts: {
          geometryRepaired: number;
          geometryRejected: number;
          geometryRejectedSample: string[];
        };
      }
    ).counts;
    expect(counts.geometryRepaired).toBe(3);
    expect(counts.geometryRejected).toBe(25);
    expect(counts.geometryRejectedSample).toHaveLength(20);
  });

  it("a failed mirror is swallowed — entity_records still landed", async () => {
    upsertWideManyMock.mockRejectedValue(new Error("wide table exploded"));

    const w = createSyncRecordWriter(makeCtx());
    await w.add(rec("p1"));

    await expect(w.flush()).resolves.toBeUndefined();
    expect(upsertManyBySourceIdMock).toHaveBeenCalledTimes(1);
  });
});

// ── Counts contract ───────────────────────────────────────────────────

describe("counts contract", () => {
  /**
   * One fixture — a created, an updated and an unchanged record — whose
   * tallies reach the sync's API response and SSE consumer.
   */
  async function drive(): Promise<Record<string, number>> {
    findBySourceIdsForSyncMock.mockResolvedValue([
      {
        id: "r1",
        sourceId: "p1",
        checksum: checksumRecord({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
      {
        id: "r2",
        sourceId: "p2",
        checksum: "STALE",
        created: 2,
        createdBy: "u0",
      },
    ]);

    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    for (const r of [rec("p1"), rec("p2"), rec("p3")]) await w.add(r);
    await w.flush();
    return (ctx as unknown as { counts: Record<string, number> }).counts;
  }

  it("tallies one created, one updated and one unchanged record", async () => {
    expect(await drive()).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 1,
    });
  });

  it("advances recordIndex once per record", async () => {
    expect((await drive()).recordIndex).toBe(3);
  });
});

// ── Unchanged path does no no-op work (slice 3) ───────────────────────

describe("createSyncRecordWriter — unchanged rows skip no-op work (#440)", () => {
  /** Prime the bulk read so both records classify as unchanged. */
  async function twoUnchanged(ctx: unknown) {
    const sums = (
      await import("../../../adapters/rest-api/rest-api.adapter.js")
    ).checksumRecord;
    findBySourceIdsForSyncMock.mockResolvedValueOnce([
      {
        id: "r1",
        sourceId: "p1",
        checksum: sums({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
      {
        id: "r2",
        sourceId: "p2",
        checksum: sums({ pid: "p2", v: "p2" }),
        created: 1,
        createdBy: "u0",
      },
    ]);
    const w = createSyncRecordWriter(ctx as never);
    await w.add(rec("p1"));
    await w.add(rec("p2"));
    await w.flush();
  }

  it("does NOT re-upsert the mirror when no wide row is missing", async () => {
    selectMissingWideRowIdsMock.mockResolvedValue([]);
    await twoUnchanged(makeCtx());

    expect(selectMissingWideRowIdsMock).toHaveBeenCalledTimes(1);
    expect(selectMissingWideRowIdsMock.mock.calls[0][1]).toEqual(["r1", "r2"]);
    expect(upsertWideManyMock).not.toHaveBeenCalled();
  });

  it("mirrors ONLY the rows the anti-join reports missing", async () => {
    selectMissingWideRowIdsMock.mockResolvedValue(["r2"]);
    await twoUnchanged(makeCtx());

    expect(upsertWideManyMock).toHaveBeenCalledTimes(1);
    expect(upsertWideManyMock.mock.calls[0][1]).toHaveLength(1);
  });

  it("does not consult the anti-join when there is no wide projection", async () => {
    await twoUnchanged(makeCtx({ withWideProjection: false }));

    expect(selectMissingWideRowIdsMock).not.toHaveBeenCalled();
    expect(upsertWideManyMock).not.toHaveBeenCalled();
  });

  it("a failing missing-row probe does not fail the sync", async () => {
    // Regression: this probe was unguarded when slice 3 was written, and the
    // #440 smoke walk caught it. With the wide table renamed away, every
    // per-batch mirror degraded gracefully and then this read threw, killing
    // a sync whose entity_records writes had all succeeded. The wide table is
    // a best-effort mirror; nothing in it may fail the run.
    selectMissingWideRowIdsMock.mockRejectedValue(
      new Error('relation "er__x" does not exist')
    );
    const sums = (
      await import("../../../adapters/rest-api/rest-api.adapter.js")
    ).checksumRecord;
    findBySourceIdsForSyncMock.mockResolvedValueOnce([
      {
        id: "r1",
        sourceId: "p1",
        checksum: sums({ pid: "p1", v: "p1" }),
        created: 1,
        createdBy: "u0",
      },
    ]);

    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add(rec("p1"));

    await expect(w.flush()).resolves.toBeUndefined();
    // The watermark bump still happened — the record is not left to be reaped.
    expect(bulkUpdateSyncedAtMock).toHaveBeenCalledTimes(1);
    expect(
      (ctx as unknown as { counts: { unchanged: number } }).counts.unchanged
    ).toBe(1);
  });

  it("still mirrors changed rows unconditionally", async () => {
    selectMissingWideRowIdsMock.mockResolvedValue([]);
    const w = createSyncRecordWriter(makeCtx());
    await w.add(rec("new1")); // absent from the bulk read -> created
    await w.flush();

    // The anti-join is for unchanged rows only; a changed row is always
    // written, because its projected values are what changed.
    expect(upsertWideManyMock).toHaveBeenCalledTimes(1);
    expect(upsertWideManyMock.mock.calls[0][1]).toHaveLength(1);
    expect(selectMissingWideRowIdsMock).not.toHaveBeenCalled();
  });
});

// ── NUL stripping (#805) ──────────────────────────────────────────────
//
// Postgres can't store U+0000 in jsonb, so one stray byte in a remote record
// failed the whole sync. The writer strips it before the source id and
// checksum are derived, and counts what it stripped.

describe("NUL stripping (#805)", () => {
  const counts = (ctx: unknown) =>
    (ctx as { counts: Record<string, number> }).counts;

  it("writes stripped data and source id, counting every changed string", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "a\u0000b", v: { deep: "x\u0000", ok: "y" } });
    await w.flush();

    const [rows] = upsertManyBySourceIdMock.mock.calls[0]!;
    expect(rows[0]).toMatchObject({
      sourceId: "ab",
      data: { pid: "ab", v: { deep: "x", ok: "y" } },
    });
    expect(counts(ctx).nulStrippedValues).toBe(2);
  });

  it("reports an unchanged remote record containing a NUL as unchanged on re-sync", async () => {
    const mod = await import("../../../adapters/rest-api/rest-api.adapter.js");
    findBySourceIdsForSyncMock.mockResolvedValue([
      {
        id: "r1",
        sourceId: "ab",
        checksum: mod.checksumRecord({ pid: "ab", v: "same" }),
        created: 1,
        createdBy: "u0",
      },
    ]);

    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "a\u0000b", v: "sa\u0000me" });
    await w.flush();

    expect(counts(ctx).unchanged).toBe(1);
    expect(counts(ctx).updated).toBe(0);
  });

  it("copies null-prototype sub-objects into plain objects", async () => {
    const sub = Object.create(null) as Record<string, unknown>;
    sub.note = "n\u0000";
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "p", sub });
    await w.flush();

    const [rows] = upsertManyBySourceIdMock.mock.calls[0]!;
    const data = rows[0]!.data as { sub: object };
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(data.sub)).toBe(Object.prototype);
    expect(data.sub).toEqual({ note: "n" });
  });

  it("leaves a clean record alone and counts nothing", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "p", v: "tab\there" });
    await w.flush();

    const [rows] = upsertManyBySourceIdMock.mock.calls[0]!;
    expect(rows[0]).toMatchObject({ data: { pid: "p", v: "tab\there" } });
    expect(counts(ctx).nulStrippedValues).toBe(0);
  });
});

// ── Duplicate source ids in one batch ─────────────────────────────────
//
// #805 adversarial walk: an upstream that repeats an id within one batch (or
// two ids that only differ by a stripped U+0000) made one INSERT … ON CONFLICT
// touch the same row twice, and Postgres failed the whole sync with SQLSTATE
// 21000. The batch now keeps the last record per source id.

describe("duplicate source ids within a batch", () => {
  const counts = (ctx: unknown) =>
    (ctx as { counts: Record<string, number> }).counts;

  it("writes one row per source id, the last record winning", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "b", v: "one" });
    await w.add({ pid: "c", v: "solo" });
    await w.add({ pid: "b", v: "two" });
    await w.flush();

    const [rows] = upsertManyBySourceIdMock.mock.calls[0]!;
    expect(rows.map((r) => [r.sourceId, (r.data as { v: string }).v])).toEqual(
      expect.arrayContaining([
        ["b", "two"],
        ["c", "solo"],
      ])
    );
    expect(rows).toHaveLength(2);
    expect(counts(ctx).created).toBe(2);
  });

  it("dedupes ids that only collide once U+0000 is stripped", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "b\u0000", v: "one" });
    await w.add({ pid: "b", v: "two" });
    await w.flush();

    const [rows] = upsertManyBySourceIdMock.mock.calls[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: "b",
      data: { pid: "b", v: "two" },
    });
    expect(counts(ctx).nulStrippedValues).toBe(1);
  });

  it("looks up each source id once", async () => {
    const ctx = makeCtx();
    const w = createSyncRecordWriter(ctx);
    await w.add({ pid: "b", v: "one" });
    await w.add({ pid: "b", v: "two" });
    await w.flush();

    expect(findBySourceIdsForSyncMock.mock.calls[0]![1]).toEqual(["b"]);
  });
});
