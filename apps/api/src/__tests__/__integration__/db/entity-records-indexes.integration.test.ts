/**
 * Integration tests for the `entity_records` sort index (#433).
 *
 * The UI's default list sort is `created` (`usePagination`'s
 * `defaultSortBy`), and before this index no table in the schema indexed
 * it — so `WHERE connector_entity_id = ? AND deleted IS NULL ORDER BY
 * created LIMIT 10` could not stream. Postgres hash-joined all 283K rows
 * against the wide table and spilled to 64 batches before discarding all
 * but ten (14,635ms measured on app-dev; 86ms once an index-ordered scan
 * was possible).
 *
 * This is a **regression guard**, not a performance test: it asserts the
 * index exists with the exact shape the planner needs. Latency itself is
 * verified manually against app-dev in the smoke walkthrough — CI has
 * neither the data volume nor the timing stability to assert on it.
 *
 * The trailing `id` is not decoration: it is the unique tiebreaker that
 * makes pagination deterministic over a tied sort key, and a
 * precondition for keyset seeking.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const INDEX_NAME = "entity_records_entity_created_id_idx";

describe("entity_records sort index (#433)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let indexdef: string | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);

    const rows = (await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'entity_records'
        AND indexname = ${INDEX_NAME}
    `)) as unknown as Array<{ indexdef: string }>;
    indexdef = rows[0]?.indexdef;
  });

  afterAll(async () => {
    await connection.end();
  });

  it("exists on entity_records", () => {
    expect(indexdef).toBeDefined();
  });

  it("covers (connector_entity_id, created, id) in that order", () => {
    // Order matters: the scope column must lead so a single entity's rows
    // are one contiguous index range, then the sort key, then the
    // tiebreaker. Any other order stops the planner using it for
    // `WHERE connector_entity_id = ? ORDER BY created`.
    expect(indexdef).toMatch(
      /\(\s*connector_entity_id\s*,\s*created\s*,\s*id\s*\)/
    );
  });

  it("is partial on `deleted IS NULL`", () => {
    // Every read goes through the soft-delete guard, so the index has to
    // carry the same predicate to be usable — and staying partial keeps
    // it off tombstoned rows.
    expect(indexdef).toMatch(/WHERE\s+\(?deleted IS NULL\)?/);
  });

  it("is a btree", () => {
    expect(indexdef).toMatch(/USING btree/);
  });
});
