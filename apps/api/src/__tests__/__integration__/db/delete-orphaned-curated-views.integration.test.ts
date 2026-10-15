import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull, or } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

/**
 * #802: 0121 repairs the curated views earlier connector and entity deletes
 * left behind. Those deletes soft-deleted the entity and never touched its
 * views, which stayed listed, stayed attached to their stations and 500'd on
 * open. The migration soft-deletes each such view with its projection rows
 * and station attachments, and hard-deletes its grants — what the delete
 * cascade now does. A view over a live entity is untouched.
 */
describe("0121 delete-orphaned-curated-views (#802)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orphaned!: PopulatedOrg;
  let live!: PopulatedOrg;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0121_delete-orphaned-curated-views.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  /** What's still live for one view: the view, its projection rows, its
   *  station attachments, and its grants (both shapes). */
  async function liveState(viewId: string) {
    const [view] = await db
      .select()
      .from(schema.curatedViews)
      .where(eq(schema.curatedViews.id, viewId));
    const links = await db
      .select()
      .from(schema.curatedViewFieldMappings)
      .where(
        and(
          eq(schema.curatedViewFieldMappings.curatedViewId, viewId),
          isNull(schema.curatedViewFieldMappings.deleted)
        )
      );
    const attachments = await db
      .select()
      .from(schema.stationViews)
      .where(
        and(
          eq(schema.stationViews.curatedViewId, viewId),
          isNull(schema.stationViews.deleted)
        )
      );
    const grants = await db
      .select()
      .from(schema.permissionGrants)
      .where(
        or(
          eq(schema.permissionGrants.resourceId, viewId),
          eq(schema.permissionGrants.conditionParam, viewId)
        )
      );
    return {
      viewLive: view.deleted === null,
      deletedBy: view.deletedBy,
      links: links.length,
      attachments: attachments.length,
      grants: grants.length,
    };
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    orphaned = await seedPopulatedOrg(db, "orphaned-views");
    live = await seedPopulatedOrg(db, "live-views");

    // What a pre-#802 delete left: the entity soft-deleted, its view live.
    await db
      .update(schema.connectorEntities)
      .set({ deleted: Date.now(), deletedBy: orphaned.ownerUserId })
      .where(eq(schema.connectorEntities.id, orphaned.connectorEntityId));
  });

  afterEach(async () => {
    for (const org of [orphaned, live]) {
      await wideTableReconcilerService.dropTable(
        org.connectorEntityId,
        db as DbClient
      );
    }
    await teardownOrg(db);
    await connection.end();
  });

  it("deletes a view whose entity is gone, with its dependents and grants", async () => {
    await runMigration();

    expect(await liveState(orphaned.curatedViewId)).toEqual({
      viewLive: false,
      deletedBy: "system",
      links: 0,
      attachments: 0,
      grants: 0,
    });
  });

  it("leaves a view over a live entity alone", async () => {
    await runMigration();

    expect(await liveState(live.curatedViewId)).toEqual({
      viewLive: true,
      deletedBy: null,
      links: 1,
      attachments: 1,
      grants: 2,
    });
  });

  it("is a no-op the second time", async () => {
    await runMigration();
    const [first] = await db
      .select()
      .from(schema.curatedViews)
      .where(eq(schema.curatedViews.id, orphaned.curatedViewId));

    await runMigration();

    const [second] = await db
      .select()
      .from(schema.curatedViews)
      .where(eq(schema.curatedViews.id, orphaned.curatedViewId));
    expect(second.deleted).toBe(first.deleted);
    expect(await liveState(live.curatedViewId)).toMatchObject({
      viewLive: true,
      grants: 2,
    });
  });
});
