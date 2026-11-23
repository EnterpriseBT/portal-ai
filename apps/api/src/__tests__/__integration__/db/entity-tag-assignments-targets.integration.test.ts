import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

/**
 * #1070: a tag assignment points at exactly one object, an entity, station,
 * pin, connector instance or curated view. The
 * `entity_tag_assignments_one_target` CHECK holds that at the database, and a
 * live (target, tag) pair is unique per target column.
 */
describe("entity_tag_assignments targets (#1070)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let org!: PopulatedOrg;
  let tagId!: string;

  const row = (targets: Record<string, string>) => ({
    id: generateId(),
    created: Date.now(),
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: org.orgId,
    entityTagId: tagId,
    ...targets,
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "tag-targets");
    const [assignment] = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(
        and(
          eq(schema.entityTagAssignments.organizationId, org.orgId),
          isNull(schema.entityTagAssignments.deleted)
        )
      );
    tagId = assignment!.entityTagId;
  });

  afterEach(async () => {
    await wideTableReconcilerService.dropTable(
      org.connectorEntityId,
      db as DbClient
    );
    await teardownOrg(db);
    await connection.end();
  });

  it("keeps an existing entity assignment valid", async () => {
    const [existing] = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.organizationId, org.orgId));
    expect(existing!.connectorEntityId).toBe(org.connectorEntityId);
    expect(existing!.stationId).toBeNull();
  });

  it("stores an assignment on a station, a connector instance and a view", async () => {
    await db
      .insert(schema.entityTagAssignments)
      .values([
        row({ stationId: org.stationId }),
        row({ connectorInstanceId: org.connectorInstanceId }),
        row({ curatedViewId: org.curatedViewId }),
      ]);
    const rows = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.organizationId, org.orgId));
    expect(rows).toHaveLength(4);
  });

  it("refuses a row with two targets", async () => {
    await expect(
      db.insert(schema.entityTagAssignments).values(
        row({
          stationId: org.stationId,
          curatedViewId: org.curatedViewId,
        })
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint_name: "entity_tag_assignments_one_target",
      }),
    });
  });

  it("refuses a row with no target", async () => {
    await expect(
      db.insert(schema.entityTagAssignments).values(row({}))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint_name: "entity_tag_assignments_one_target",
      }),
    });
  });

  it("refuses the same tag twice on one station", async () => {
    await db
      .insert(schema.entityTagAssignments)
      .values(row({ stationId: org.stationId }));
    await expect(
      db
        .insert(schema.entityTagAssignments)
        .values(row({ stationId: org.stationId }))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint_name: "entity_tag_assignments_station_tag_unique",
      }),
    });
  });

  // #1070: a hard delete of a tagged object (a failed draft commit's
  // rollback, org delete) takes its tags instead of failing on them.
  it("cascades a hard delete of a tagged connector to its tags", async () => {
    await db
      .insert(schema.entityTagAssignments)
      .values(row({ connectorInstanceId: org.connectorInstanceId }));
    const pending = {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      connectorDefinitionId: (
        await db
          .select()
          .from(schema.connectorInstances)
          .where(eq(schema.connectorInstances.id, org.connectorInstanceId))
      )[0]!.connectorDefinitionId,
      organizationId: org.orgId,
      name: "Pending upload",
      status: "pending",
      config: {},
      credentials: null,
    };
    await db.insert(schema.connectorInstances).values(pending as never);
    await db
      .insert(schema.entityTagAssignments)
      .values(row({ connectorInstanceId: pending.id }));

    await db
      .delete(schema.connectorInstances)
      .where(eq(schema.connectorInstances.id, pending.id));

    const left = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.connectorInstanceId, pending.id));
    expect(left).toHaveLength(0);
  });
});
