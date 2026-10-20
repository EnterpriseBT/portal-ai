/**
 * Integration tests for CuratedViewDeleteService (#802) — the one view delete
 * cascade the view route, the entity delete and the connector delete share.
 *
 * Each view is seeded with every dependent (projection row, station
 * attachment, resource grant), so a cascade
 * that misses one table is visible.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { CuratedViewDeleteService } from "../../../services/curated-view-delete.service.js";
import { DbService } from "../../../services/db.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import { teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  seedCuratedViewWithDependents,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

type Db = ReturnType<typeof drizzle>;

/** Live dependents of the given views, by table. */
async function liveDependents(db: Db, viewIds: string[]) {
  const views = await db
    .select()
    .from(schema.curatedViews)
    .where(
      and(
        inArray(schema.curatedViews.id, viewIds),
        isNull(schema.curatedViews.deleted)
      )
    );
  const links = await db
    .select()
    .from(schema.curatedViewFieldMappings)
    .where(
      and(
        inArray(schema.curatedViewFieldMappings.curatedViewId, viewIds),
        isNull(schema.curatedViewFieldMappings.deleted)
      )
    );
  const attachments = await db
    .select()
    .from(schema.stationViews)
    .where(
      and(
        inArray(schema.stationViews.curatedViewId, viewIds),
        isNull(schema.stationViews.deleted)
      )
    );
  const grants = await db
    .select()
    .from(schema.permissionGrants)
    .where(
      and(
        eq(schema.permissionGrants.resourceType, "curated_view"),
        inArray(schema.permissionGrants.resourceId, viewIds)
      )
    );
  return {
    views: views.length,
    links: links.length,
    attachments: attachments.length,
    grants: grants.length,
  };
}

describe("CuratedViewDeleteService integration tests (#802)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let target!: PopulatedOrg;
  let foreign!: PopulatedOrg;
  let secondViewId!: string;
  let siblingViewId!: string;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    for (const org of [target, foreign]) {
      if (org) {
        await wideTableReconcilerService.dropTable(
          org.connectorEntityId,
          db as DbClient
        );
      }
    }
    await teardownOrg(db);
    await connection.end();
  });

  beforeEach(async () => {
    for (const org of [target, foreign]) {
      if (org) {
        await wideTableReconcilerService.dropTable(
          org.connectorEntityId,
          db as DbClient
        );
      }
    }
    await teardownOrg(db);
    target = await seedPopulatedOrg(db, "cvd-target");
    foreign = await seedPopulatedOrg(db, "cvd-foreign");
    const seed = (key: string) =>
      seedCuratedViewWithDependents(db, {
        organizationId: target.orgId,
        connectorEntityId: target.connectorEntityId,
        fieldMappingId: target.fieldMappingId,
        stationId: target.stationId,
        granteeUserId: target.memberUserId,
        key,
      });
    secondViewId = await seed(`second_${Date.now()}`);
    siblingViewId = await seed(`sibling_${Date.now()}`);
  });

  it("deletes the views and every dependent, and reports the counts", async () => {
    const viewIds = [target.curatedViewId, secondViewId];

    const counts = await DbService.transaction((tx) =>
      CuratedViewDeleteService.deleteByIds(
        target.orgId,
        viewIds,
        target.ownerUserId,
        tx
      )
    );

    expect(counts).toEqual({
      curatedViews: 2,
      fieldMappings: 2,
      stationViews: 2,
      grants: 2,
    });
    expect(await liveDependents(db, viewIds)).toEqual({
      views: 0,
      links: 0,
      attachments: 0,
      grants: 0,
    });
  });

  it("is a no-op on an empty list", async () => {
    const counts = await DbService.transaction((tx) =>
      CuratedViewDeleteService.deleteByIds(
        target.orgId,
        [],
        target.ownerUserId,
        tx
      )
    );

    expect(counts).toEqual({
      curatedViews: 0,
      fieldMappings: 0,
      stationViews: 0,
      grants: 0,
    });
  });

  it("ignores a view id from another organization", async () => {
    const counts = await DbService.transaction((tx) =>
      CuratedViewDeleteService.deleteByIds(
        target.orgId,
        [foreign.curatedViewId],
        target.ownerUserId,
        tx
      )
    );

    expect(counts.curatedViews).toBe(0);
    expect(await liveDependents(db, [foreign.curatedViewId])).toEqual({
      views: 1,
      links: 1,
      attachments: 1,
      grants: 1,
    });
  });

  it("leaves a sibling view over the same entity untouched", async () => {
    await DbService.transaction((tx) =>
      CuratedViewDeleteService.deleteByIds(
        target.orgId,
        [target.curatedViewId],
        target.ownerUserId,
        tx
      )
    );

    expect(await liveDependents(db, [siblingViewId])).toEqual({
      views: 1,
      links: 1,
      attachments: 1,
      grants: 1,
    });
  });

  it("joins the caller's transaction, so a rollback keeps everything", async () => {
    await expect(
      DbService.transaction(async (tx) => {
        await CuratedViewDeleteService.deleteByIds(
          target.orgId,
          [target.curatedViewId],
          target.ownerUserId,
          tx
        );
        throw new Error("roll back");
      })
    ).rejects.toThrow("roll back");

    expect(await liveDependents(db, [target.curatedViewId])).toEqual({
      views: 1,
      links: 1,
      attachments: 1,
      grants: 1,
    });
  });

  it("finds the live view ids over a set of entities, org-scoped", async () => {
    const ids = await CuratedViewDeleteService.findIdsByConnectorEntityIds(
      target.orgId,
      [target.connectorEntityId, foreign.connectorEntityId]
    );

    expect(ids.sort()).toEqual(
      [target.curatedViewId, secondViewId, siblingViewId].sort()
    );
  });
});
