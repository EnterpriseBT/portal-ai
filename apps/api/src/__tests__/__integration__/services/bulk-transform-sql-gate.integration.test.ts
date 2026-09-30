/**
 * #660: BulkTransformService splices agent SQL (the projection and the
 * sourceFilter WHERE fragment) into queries it runs on the default connection —
 * outside the SQL session. The service re-checks the exact SQL it built: the
 * source entity's own wide table is the only relation, with no sub-selects and
 * only allowlisted functions — so a queued job can't read another org's data
 * even if it bypassed the tool's pre-flight. Rejected before any query runs.
 */
import { describe, it, expect } from "@jest/globals";

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
});
