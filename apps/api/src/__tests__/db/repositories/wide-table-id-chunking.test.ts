/**
 * Guard: the wide-table id-list builders must chunk (#436).
 *
 * `sql.join(ids.map(id => sql`${id}`), sql`, `)` allocates one SQL AST node
 * per element, and Drizzle flattens that chain recursively — so AST depth
 * scales with array length and overflows the V8 call stack long before
 * Postgres' parameter limit binds. `upsertMany` in the same repository
 * already documents this failure and fixes it by chunking at
 * `WIDE_TABLE_CHUNK_SIZE`; three sibling builders never got it.
 *
 * On 2026-08-22 a REST sync reaped 317,000 rows and handed them straight to
 * the id-list mark (`markDeletedByEntityRecordIds`, #450 — then a DELETE). It
 * raised `RangeError: Maximum call stack size exceeded` *after* the
 * `entity_records` reap had committed, leaving 317,000 wide rows pointing at
 * soft-deleted records — the unbounded growth #327 exists to prevent.
 *
 * The overflow happens **client-side**, while the statement is serialised —
 * not when `sql.join` is called. The fake client below therefore runs the
 * real `PgDialect.sqlToQuery` on every statement, so these tests exercise
 * the code path that actually crashed. No Postgres required.
 *
 * What this guard deliberately does NOT assert is the crash itself. The
 * threshold is stack-depth dependent: 317,000 ids throw `RangeError` under
 * plain `node`, but serialise fine inside Jest's VM context, which has a
 * different stack budget. Pinning "n throws" would be flaky and would
 * silently rot as runtimes change.
 *
 * So the invariant asserted is the one that makes the crash unreachable at
 * any depth: **no emitted statement ever carries more than `CHUNK` bound
 * parameters.** Statement counts pin the chunking arithmetic around the
 * boundary.
 *
 * Same technique and same class of bug as `cascade-count-no-returning.test.ts`
 * (#423): the integration suite proves the *result* is right, and cannot
 * prove how the statement was built.
 */

import { describe, it, expect } from "@jest/globals";

import { PgDialect } from "drizzle-orm/pg-core";

import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";

/** The chunk size the repository reuses from `upsertMany`. */
const CHUNK = 500;

/**
 * Fake client that **serialises** each statement with the real Postgres
 * dialect before recording it. Serialisation is where the recursive flatten
 * lives, so an unchunked call throws here exactly as it did in production.
 */
function fakeClient(rowsPerCall = 1) {
  const dialect = new PgDialect();
  const statements: { sql: string; params: number }[] = [];
  const client = {
    execute: (stmt: never) => {
      const q = dialect.sqlToQuery(stmt);
      statements.push({ sql: q.sql, params: q.params.length });
      return Promise.resolve(
        Array.from({ length: rowsPerCall }, (_, i) => ({
          entity_record_id: `stmt-${statements.length}-row-${i}`,
        }))
      );
    },
  } as unknown as DbClient;
  return { client, statements };
}

/** Stubbed statement cache — both read methods consult it before building. */
function repo() {
  return new WideTableRepository({
    get: async () => ({
      columns: [],
      selectAllSql: 'SELECT * FROM "er__fake"',
    }),
  } as never);
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
const ENTITY = "11111111-2222-3333-4444-555555555555";

const TS = 1_700_000_000_000;

describe("markDeletedByEntityRecordIds — chunking (#436, #450)", () => {
  it("does not throw on the 317k array that overflowed the stack in production", async () => {
    const { client, statements } = fakeClient();
    await expect(
      repo().markDeletedByEntityRecordIds(ENTITY, ids(317_000), TS, client)
    ).resolves.toBeUndefined();
    expect(statements.length).toBe(Math.ceil(317_000 / CHUNK));
    // Every statement stayed shallow enough to serialise, and none carried
    // more than one chunk's worth of ids. The mark UPDATE binds one extra
    // scalar (the `deletedAt` timestamp), so the ceiling is CHUNK + 1 — the
    // id list, which is what recursed, never exceeds CHUNK.
    expect(Math.max(...statements.map((s) => s.params))).toBeLessThanOrEqual(
      CHUNK + 1
    );
  });

  it("issues ceil(n / CHUNK) statements", async () => {
    const { client, statements } = fakeClient();
    await repo().markDeletedByEntityRecordIds(ENTITY, ids(50_000), TS, client);
    expect(statements.length).toBe(100);
  });

  it("issues exactly one statement at the chunk boundary", async () => {
    const { client, statements } = fakeClient();
    await repo().markDeletedByEntityRecordIds(ENTITY, ids(CHUNK), TS, client);
    expect(statements.length).toBe(1);
  });

  it("issues two statements one past the boundary", async () => {
    const { client, statements } = fakeClient();
    await repo().markDeletedByEntityRecordIds(
      ENTITY,
      ids(CHUNK + 1),
      TS,
      client
    );
    expect(statements.length).toBe(2);
  });

  it("still issues a single statement for a small list (scope of the change)", async () => {
    const { client, statements } = fakeClient();
    await repo().markDeletedByEntityRecordIds(ENTITY, ids(3), TS, client);
    expect(statements.length).toBe(1);
  });

  it("issues nothing for an empty list", async () => {
    const { client, statements } = fakeClient();
    await repo().markDeletedByEntityRecordIds(ENTITY, [], TS, client);
    expect(statements.length).toBe(0);
  });
});

describe("selectByEntityRecordIds — chunking (#436)", () => {
  it("does not throw on a list far past the overflow threshold", async () => {
    const { client, statements } = fakeClient();
    await expect(
      repo().selectByEntityRecordIds(ENTITY, ids(50_000), client)
    ).resolves.toBeDefined();
    expect(statements.length).toBe(100);
    expect(Math.max(...statements.map((s) => s.params))).toBeLessThanOrEqual(
      CHUNK
    );
  });

  it("concatenates every chunk's rows so the caller sees one complete set", async () => {
    // 3 rows per statement x 4 statements (1,600 ids / 500) = 12 rows.
    const { client, statements } = fakeClient(3);
    const rows = await repo().selectByEntityRecordIds(
      ENTITY,
      ids(1_600),
      client
    );
    expect(statements.length).toBe(4);
    expect(rows).toHaveLength(12);
    // Distinct across chunks — not one chunk's rows repeated.
    expect(new Set(rows.map((r) => r.entity_record_id)).size).toBe(12);
  });

  it("returns an empty array without querying for an empty list", async () => {
    const { client, statements } = fakeClient();
    await expect(
      repo().selectByEntityRecordIds(ENTITY, [], client)
    ).resolves.toEqual([]);
    expect(statements.length).toBe(0);
  });
});

describe("selectMissingWideRowIds — chunking (#440)", () => {
  it("chunks a large id list at CHUNK", async () => {
    const { client, statements } = fakeClient();
    await repo().selectMissingWideRowIds(ENTITY, ids(2_500), client);
    expect(statements.length).toBe(5);
    expect(Math.max(...statements.map((s) => s.params))).toBeLessThanOrEqual(
      CHUNK
    );
  });

  it("issues nothing and returns [] for an empty id list", async () => {
    const { client, statements } = fakeClient();
    await expect(
      repo().selectMissingWideRowIds(ENTITY, [], client)
    ).resolves.toEqual([]);
    expect(statements.length).toBe(0);
  });
});
