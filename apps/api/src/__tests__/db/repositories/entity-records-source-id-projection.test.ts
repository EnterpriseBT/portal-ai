/**
 * Guard: the sync writer's change-detection read projects a narrow column
 * set and excludes soft-deleted rows (#440, slice 1).
 *
 * `findBySourceIds` does `.select()` — the whole row, including the `data`
 * jsonb and any geometry. The sync loop calls it once per record today, so
 * batching it into 1000-id reads would drag roughly a megabyte across the
 * wire per batch to read two fields. `findBySourceIdsForSync` returns only
 * what the writer needs to classify a record: the primary key, the source
 * id, the checksum, and the `created` / `createdBy` pair it must preserve
 * on an update.
 *
 * Soft-deleted rows are excluded deliberately. `layout-plan-commit`'s
 * `writeRecords` passes `includeDeleted: true` and resurrects prior rows via
 * `bulkResurrect`; `record-import`'s `flushBatch` does not, and neither does
 * today's `upsertRecord`. The REST sync path is modelled on `flushBatch`, so
 * resurrection is **not** introduced here — see the spec's Key decision 3.
 *
 * The statements are captured rather than executed: this asserts the shape
 * of what is built, which a real-DB integration test cannot distinguish from
 * a wide `SELECT *` by its return value alone.
 */

import { describe, it, expect } from "@jest/globals";

import { EntityRecordsRepository } from "../../../db/repositories/entity-records.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";

/** Chunk size the repository's bulk methods share. */
const CHUNK = 1000;

/**
 * Minimal stand-in for the drizzle select chain. Records each `.where()`
 * (one per chunk) and resolves to `rowsPerStatement` fabricated rows so the
 * caller has something to concatenate.
 */
function fakeClient(rowsPerStatement = 1) {
  const statements: { columns: string[] | "all" }[] = [];

  const client = {
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          statements.push({
            columns: projection ? Object.keys(projection) : "all",
          });
          return Promise.resolve(
            Array.from({ length: rowsPerStatement }, (_, i) => ({
              id: `id-${statements.length}-${i}`,
              sourceId: `src-${statements.length}-${i}`,
              checksum: `sum-${statements.length}-${i}`,
              created: 1,
              createdBy: "u1",
            }))
          );
        },
      }),
    }),
  } as unknown as DbClient;

  return { client, statements };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `src-${i}`);
const ENTITY = "11111111-2222-3333-4444-555555555555";

describe("findBySourceIdsForSync — projection (#440)", () => {
  it("selects only the five columns the writer needs, not the whole row", async () => {
    const repo = new EntityRecordsRepository();
    const { client, statements } = fakeClient();

    await repo.findBySourceIdsForSync(ENTITY, ids(3), client);

    expect(statements).toHaveLength(1);
    expect(statements[0].columns).not.toBe("all");
    expect(new Set(statements[0].columns as string[])).toEqual(
      new Set(["id", "sourceId", "checksum", "created", "createdBy"])
    );
  });

  it("does not project the `data` payload", async () => {
    const repo = new EntityRecordsRepository();
    const { client, statements } = fakeClient();

    await repo.findBySourceIdsForSync(ENTITY, ids(3), client);

    expect(statements[0].columns).not.toContain("data");
  });

  it("returns the projected rows to the caller", async () => {
    const repo = new EntityRecordsRepository();
    const { client } = fakeClient(2);

    const rows = await repo.findBySourceIdsForSync(ENTITY, ids(3), client);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        sourceId: expect.any(String),
        checksum: expect.any(String),
      })
    );
  });
});

describe("findBySourceIdsForSync — chunking (#440)", () => {
  it("issues one statement per CHUNK of source ids", async () => {
    const repo = new EntityRecordsRepository();
    const { client, statements } = fakeClient();

    await repo.findBySourceIdsForSync(ENTITY, ids(2_500), client);

    expect(statements).toHaveLength(3); // 1000 + 1000 + 500
  });

  it("issues exactly one statement at the chunk boundary", async () => {
    const repo = new EntityRecordsRepository();
    const { client, statements } = fakeClient();

    await repo.findBySourceIdsForSync(ENTITY, ids(CHUNK), client);

    expect(statements).toHaveLength(1);
  });

  it("concatenates rows across chunks", async () => {
    const repo = new EntityRecordsRepository();
    const { client } = fakeClient(4);

    const rows = await repo.findBySourceIdsForSync(ENTITY, ids(2_500), client);

    // 4 rows x 3 statements, all distinct.
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.id)).size).toBe(12);
  });

  it("issues nothing and returns [] for an empty id list", async () => {
    const repo = new EntityRecordsRepository();
    const { client, statements } = fakeClient();

    await expect(
      repo.findBySourceIdsForSync(ENTITY, [], client)
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });
});
