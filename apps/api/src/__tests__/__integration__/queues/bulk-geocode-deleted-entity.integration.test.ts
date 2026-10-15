/**
 * #802: once an entity or connector delete commits, the entity's records
 * belong to the entity_data_delete job and nothing else may write them. A
 * bulk_geocode job for a deleted entity fails unrecoverably before it reads
 * or geocodes a row — the backstop behind the tool's own entity check.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";

import { bulkGeocodeProcessor } from "../../../queues/processors/bulk-geocode.processor.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import { generateId, teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

describe("bulk_geocode against a deleted entity (#802)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let org!: PopulatedOrg;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "geocode-deleted");
  });

  afterEach(async () => {
    await wideTableReconcilerService.dropTable(
      org.connectorEntityId,
      db as DbClient
    );
    await teardownOrg(db);
    await connection.end();
  });

  it("fails unrecoverably without touching a record", async () => {
    await db
      .update(schema.connectorEntities)
      .set({ deleted: Date.now(), deletedBy: org.ownerUserId })
      .where(eq(schema.connectorEntities.id, org.connectorEntityId));

    await expect(
      bulkGeocodeProcessor({
        data: {
          jobId: generateId(),
          type: "bulk_geocode",
          organizationId: org.orgId,
          connectorEntityId: org.connectorEntityId,
          sourceColumnKey: "email",
          targetColumnKey: "geom",
        },
        updateProgress: async () => {},
      } as never)
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
