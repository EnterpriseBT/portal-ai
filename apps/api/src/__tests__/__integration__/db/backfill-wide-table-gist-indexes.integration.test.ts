import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

import { gistIndexName } from "../../../services/wide-table-reconciler.service.js";
import { generateId } from "../utils/application.util.js";

/**
 * #804: 0123 gives every `er__*` geometry column that no GiST index covers an
 * index under the current `gistIndexName`, and leaves covered columns alone,
 * whatever their index is called.
 */
describe("0123 backfill-wide-table-gist-indexes (#804)", () => {
  let connection!: ReturnType<typeof postgres>;
  let entityId: string;
  let table: string;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0123_backfill-wide-table-gist-indexes.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  /** GiST-indexed column name → index name. */
  async function gistIndexes(): Promise<Map<string, string>> {
    const rows = (await connection.unsafe(
      `SELECT a.attname AS column_name, i.relname AS index_name
       FROM pg_index x
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_am am ON am.oid = i.relam AND am.amname = 'gist'
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
       WHERE t.relname = $1`,
      [table]
    )) as unknown as Array<{ column_name: string; index_name: string }>;
    return new Map(rows.map((r) => [r.column_name, r.index_name]));
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    entityId = generateId();
    table = `er__${entityId}`;

    // Two geometry columns whose pre-#804 index names truncate to one: only
    // the first got its index. A jsonb column is never indexed.
    await connection.unsafe(
      `CREATE TABLE "${table}" (
         id text PRIMARY KEY,
         c_parcel_boundary_polygon_a geometry(Geometry, 4326),
         c_parcel_boundary_polygon_b geometry(Geometry, 4326),
         c_notes jsonb
       )`
    );
    const legacy = `${table}__c_parcel_boundary_polygon_a_gist`.slice(0, 63);
    await connection.unsafe(
      `CREATE INDEX "${legacy}" ON "${table}" USING GIST (c_parcel_boundary_polygon_a)`
    );
  });

  afterEach(async () => {
    await connection.unsafe(`DROP TABLE IF EXISTS "${table}"`);
    await connection.end();
  });

  it("indexes the column the collision left bare", async () => {
    await runMigration();

    const indexes = await gistIndexes();
    expect(indexes.get("c_parcel_boundary_polygon_b")).toBe(
      gistIndexName(entityId, "c_parcel_boundary_polygon_b")
    );
  });

  it("leaves an already-covered column's legacy index alone", async () => {
    const before = (await gistIndexes()).get("c_parcel_boundary_polygon_a");
    await runMigration();

    expect((await gistIndexes()).get("c_parcel_boundary_polygon_a")).toBe(
      before
    );
    expect((await gistIndexes()).has("c_notes")).toBe(false);
    expect((await gistIndexes()).size).toBe(2);
  });

  it("is a no-op on a second run", async () => {
    await runMigration();
    const once = await gistIndexes();
    await runMigration();

    expect(await gistIndexes()).toEqual(once);
  });
});
