import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

/**
 * #644: a curated view's row filter is a `FilterGroup` (`filter`) or SQL
 * (`filter_sql`), never both. The `curated_views_filter_mode_exclusive` CHECK
 * holds that at the database, whatever the writer, and `filter_sql_keys`
 * defaults to empty.
 */
describe("curated_views filter mode (#644)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let org!: PopulatedOrg;

  const group = {
    combinator: "and",
    conditions: [{ field: "name", operator: "eq", value: "x" }],
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "filter-mode");
  });

  afterEach(async () => {
    await wideTableReconcilerService.dropTable(
      org.connectorEntityId,
      db as DbClient
    );
    await teardownOrg(db);
    await connection.end();
  });

  const view = async () =>
    (
      await db
        .select()
        .from(schema.curatedViews)
        .where(eq(schema.curatedViews.id, org.curatedViewId))
    )[0]!;

  it("defaults to no SQL filter and no referenced keys", async () => {
    const row = await view();
    expect(row.filterSql).toBeNull();
    expect(row.filterSqlKeys).toEqual([]);
  });

  it("stores a SQL filter with its keys when the FilterGroup is null", async () => {
    await db
      .update(schema.curatedViews)
      .set({ filter: null, filterSql: "name = 'x'", filterSqlKeys: ["name"] })
      .where(eq(schema.curatedViews.id, org.curatedViewId));
    const row = await view();
    expect(row.filterSql).toBe("name = 'x'");
    expect(row.filterSqlKeys).toEqual(["name"]);
  });

  it("refuses a row carrying both a FilterGroup and SQL", async () => {
    await expect(
      db
        .update(schema.curatedViews)
        .set({ filter: group as never, filterSql: "name = 'x'" })
        .where(eq(schema.curatedViews.id, org.curatedViewId))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint_name: "curated_views_filter_mode_exclusive",
      }),
    });
  });
});
