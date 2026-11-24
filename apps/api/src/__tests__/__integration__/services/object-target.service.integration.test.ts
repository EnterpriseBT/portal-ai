/**
 * #1072: the readable-object rule tags and favorites share. A live object in
 * the caller's org that they can read loads; anything else is its own 404.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ObjectTargetService } from "../../../services/object-target.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "../../../services/permission.service.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTagTargets } from "../utils/tag-targets.util.js";

const NOT_FOUND: Record<TagTargetType, ApiCode> = {
  entity: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
  station: ApiCode.STATION_NOT_FOUND,
  pin: ApiCode.PORTAL_RESULT_NOT_FOUND,
  connector_instance: ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
  curated_view: ApiCode.CURATED_VIEW_NOT_FOUND,
};

describe("ObjectTargetService.loadReadable (#1072)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let owner!: PermissionContext;
  let member!: PermissionContext;
  let t!: Record<TagTargetType, string>;

  const load = async (
    ctx: PermissionContext,
    type: TagTargetType,
    id: string
  ) =>
    ObjectTargetService.loadReadable(
      await PermissionService.loadSet(ctx),
      ctx,
      { type, id }
    );

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: "auth0|obj-target-owner",
      member: "auth0|obj-target-member",
      otherOwner: "auth0|obj-target-other",
    });
    owner = { userId: fx.ownerId, organizationId: fx.orgId, roles: ["owner"] };
    member = {
      userId: fx.memberId,
      organizationId: fx.orgId,
      roles: ["member"],
    };
    t = await seedTagTargets(db, fx.orgId, fx.ownerId);
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it.each(Object.keys(NOT_FOUND) as TagTargetType[])(
    "loads a readable %s",
    async (type) => {
      const row = await load(owner, type, t[type]);
      expect(row.id).toBe(t[type]);
    }
  );

  it("answers each type's 404 for a missing id", async () => {
    for (const type of Object.keys(NOT_FOUND) as TagTargetType[]) {
      await expect(load(owner, type, generateId())).rejects.toMatchObject({
        status: 404,
        code: NOT_FOUND[type],
      });
    }
  });

  it("answers 404 for an object the caller can't read", async () => {
    await expect(load(member, "station", t.station)).rejects.toMatchObject({
      status: 404,
      code: ApiCode.STATION_NOT_FOUND,
    });
  });

  it("answers 404 for another org's object", async () => {
    const theirs = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
    await expect(load(owner, "pin", theirs.pin)).rejects.toMatchObject({
      status: 404,
      code: ApiCode.PORTAL_RESULT_NOT_FOUND,
    });
  });

  it("answers 404 for a deleted object", async () => {
    await db
      .update(schema.curatedViews)
      .set({ deleted: Date.now(), deletedBy: fx.ownerId })
      .where(eq(schema.curatedViews.id, t.curated_view));
    await expect(
      load(owner, "curated_view", t.curated_view)
    ).rejects.toMatchObject({
      status: 404,
      code: ApiCode.CURATED_VIEW_NOT_FOUND,
    });
  });
});
