/**
 * #660: BulkTransformService splices agent SQL (the projection and the
 * sourceFilter WHERE fragment) into queries it runs on the default connection —
 * outside the SQL session. The service re-checks the exact SQL it built: the
 * source entity's own wide table is the only relation, with no sub-selects and
 * only allowlisted functions — so a queued job can't read another org's data
 * even if it bypassed the tool's pre-flight. Rejected before any query runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { sql } from "drizzle-orm";

import { db } from "../../../db/client.js";
import { BulkTransformService } from "../../../services/bulk-transform.service.js";
import { generateId } from "../utils/application.util.js";

const ORG = generateId();
const SOURCE = generateId();

describe("BulkTransformService SQL gate (#660)", () => {
  it("explainExpression rejects a cross-tenant sub-select before running EXPLAIN", async () => {
    await expect(
      BulkTransformService.explainExpression(
        SOURCE,
        ORG,
        `(SELECT count(*) FROM "er__${generateId()}") AS stolen`
      )
    ).rejects.toMatchObject({ code: "PORTAL_SQL_FORBIDDEN" });
  });

  it("runBatch rejects a projection that reaches another relation", async () => {
    await expect(
      BulkTransformService.runBatch({
        sourceConnectorEntityId: SOURCE,
        organizationId: ORG,
        keyField: "c_id",
        expression: "(SELECT max(secret) FROM entity_records) AS s",
        batchSize: 10,
        offset: 0,
      } as never)
    ).rejects.toMatchObject({ code: "PORTAL_SQL_FORBIDDEN" });
  });

  it("fetchSourceBatch rejects a WHERE fragment with a sub-select", async () => {
    await expect(
      BulkTransformService.fetchSourceBatch({
        sourceConnectorEntityId: SOURCE,
        organizationId: ORG,
        whereSqlFragment: "c_id IN (SELECT id FROM users)",
        batchSize: 10,
        offset: 0,
      } as never)
    ).rejects.toMatchObject({ code: "PORTAL_SQL_FORBIDDEN" });
  });

  it("fetchSourceBatch rejects a WHERE fragment that closes the clause to add a relation", async () => {
    await expect(
      BulkTransformService.fetchSourceBatch({
        sourceConnectorEntityId: SOURCE,
        organizationId: ORG,
        whereSqlFragment:
          "true) UNION ALL SELECT * FROM entity_records WHERE (true",
        batchSize: 10,
        offset: 0,
      } as never)
    ).rejects.toMatchObject({ code: "PORTAL_SQL_FORBIDDEN" });
  });

  // #667: a commented fragment must pass the gate (fenced on its own lines)
  // and reach Postgres. The source table doesn't exist in this suite, so a
  // gate pass shows up as a database error, not PORTAL_SQL_FORBIDDEN.
  it("#667: a WHERE fragment with a trailing comment passes the gate (reaches Postgres)", async () => {
    const err = await BulkTransformService.fetchSourceBatch({
      sourceConnectorEntityId: SOURCE,
      organizationId: ORG,
      whereSqlFragment: "c_id > 1 -- note",
      batchSize: 10,
      offset: 0,
    } as never).then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } }
    );
    expect(err?.code).not.toBe("PORTAL_SQL_FORBIDDEN");
    expect(err?.cause?.code).toBe("42P01"); // the missing source table
  });

  it("#667: a projection with a trailing comment keeps its FROM (reaches Postgres against the source)", async () => {
    const err = await BulkTransformService.explainExpression(
      SOURCE,
      ORG,
      "c_id * 2 AS x -- note"
    ).then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } }
    );
    expect(err?.code).not.toBe("PORTAL_SQL_FORBIDDEN");
    expect(err?.cause?.code).toBe("42P01"); // FROM the (missing) source table
  });

  it("#669: fetchSourceBatch refuses a WHERE fragment that escapes its parentheses, before any query", async () => {
    await expect(
      BulkTransformService.fetchSourceBatch({
        sourceConnectorEntityId: SOURCE,
        organizationId: ORG,
        whereSqlFragment: "c_id > 1) OR (c_id < 0",
        batchSize: 10,
        offset: 0,
      } as never)
    ).rejects.toMatchObject({
      code: "PORTAL_SQL_FORBIDDEN",
      message: expect.stringMatching(/single condition/),
    });
  });
});

/**
 * #671: the SQL-kind batch read and every source count honour
 * sourceFilter.whereSqlFragment. A real 4-row source wide table (amounts 5,
 * 20, 0, 50) carries only the columns these queries read.
 */
describe("BulkTransformService sourceFilter on the SQL-kind path (#671)", () => {
  const ENTITY = generateId();
  const TABLE = `"er__${ENTITY}"`;
  const FILTER = "c_amount > 10 OR c_amount IS NULL";

  beforeAll(async () => {
    await db.execute(
      sql.raw(
        `CREATE TABLE ${TABLE} (entity_record_id text PRIMARY KEY, ` +
          `organization_id text NOT NULL, c_id text NOT NULL, c_amount numeric)`
      )
    );
    await db.execute(
      sql.raw(
        `INSERT INTO ${TABLE} VALUES ` +
          `('r1','${ORG}','O1',5), ('r2','${ORG}','O2',20), ` +
          `('r3','${ORG}','O3',0), ('r4','${ORG}','O4',50), ` +
          // Another org's row must never be counted or read.
          `('r5','${generateId()}','X1',99)`
      )
    );
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
  });

  const batch = (whereSqlFragment?: string) =>
    BulkTransformService.runBatch({
      sourceConnectorEntityId: ENTITY,
      targetConnectorEntityId: ENTITY,
      organizationId: ORG,
      expression: "c_amount * 2 AS c_doubled",
      keyField: "c_id",
      batchSize: 100,
      offset: 0,
      jobId: "job-671",
      userId: "user-671",
      whereSqlFragment,
    });

  it("countSourceRows counts only the rows the fragment selects", async () => {
    expect(
      await BulkTransformService.countSourceRows(ENTITY, ORG, FILTER)
    ).toBe(2);
  });

  it("countSourceRows without a fragment still counts the whole org's source", async () => {
    expect(await BulkTransformService.countSourceRows(ENTITY, ORG)).toBe(4);
  });

  it("runBatch with the fragment returns exactly the selected rows", async () => {
    const { rows } = await batch(FILTER);
    expect(rows.map((r) => r.__src_key).sort()).toEqual(["O2", "O4"]);
    expect(rows.map((r) => Number(r.c_doubled)).sort((a, b) => a - b)).toEqual([
      40, 100,
    ]);
  });

  it("runBatch without a fragment still returns every row of the org", async () => {
    const { rows } = await batch();
    expect(rows.map((r) => r.__src_key).sort()).toEqual([
      "O1",
      "O2",
      "O3",
      "O4",
    ]);
  });

  it.each([
    ["an OR-escape", "c_amount > 10) OR (c_amount < 0"],
    ["a CTE-escape", "true ORDER BY 1) , evil AS (SELECT 1"],
  ])(
    "runBatch and countSourceRows refuse %s before any query",
    async (_label, fragment) => {
      await expect(batch(fragment)).rejects.toMatchObject({
        code: "PORTAL_SQL_FORBIDDEN",
      });
      await expect(
        BulkTransformService.countSourceRows(ENTITY, ORG, fragment)
      ).rejects.toMatchObject({ code: "PORTAL_SQL_FORBIDDEN" });
    }
  );
});
