/**
 * #1072: FavoritesRepository against the database. A favorite is one user's
 * star on one station, pin, view or connector. Rows are hard-deleted, the
 * insert is idempotent through the target's unique index, and a hard delete
 * of the object cascades.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { favoritesRepo } from "../../../db/repositories/favorites.repository.js";
import { DbService } from "../../../services/db.service.js";
import {
  seedTenancyFixture,
  teardownOrg,
  generateId,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTagTargets } from "../utils/tag-targets.util.js";

type Targets = Awaited<ReturnType<typeof seedTagTargets>>;

describe("FavoritesRepository (#1072)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let t!: Targets;

  const star = (
    userId: string,
    target: {
      type: "station" | "pin" | "curated_view" | "connector_instance";
      id: string;
    },
    orgId = fx.orgId
  ) =>
    favoritesRepo.insertIfAbsent(
      { id: generateId(), organizationId: orgId, userId, created: Date.now() },
      target
    );

  const rows = () => db.select().from(schema.favorites);

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: "auth0|fav-repo-owner",
      member: "auth0|fav-repo-member",
      otherOwner: "auth0|fav-repo-other",
    });
    t = await seedTagTargets(db, fx.orgId, fx.ownerId);
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it.each(["station", "pin", "curated_view", "connector_instance"] as const)(
    "stars a %s once, however often it's asked",
    async (type) => {
      expect(await star(fx.ownerId, { type, id: t[type] })).toEqual({
        created: true,
      });
      expect(await star(fx.ownerId, { type, id: t[type] })).toEqual({
        created: false,
      });
      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0]!.createdBy).toBe(fx.ownerId);
      expect(all[0]!.deleted).toBeNull();
    }
  );

  it("makes one row from parallel stars", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        star(fx.ownerId, { type: "station", id: t.station })
      )
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("keeps two users' stars of one object apart", async () => {
    await star(fx.ownerId, { type: "station", id: t.station });
    await star(fx.memberId, { type: "station", id: t.station });
    expect(await rows()).toHaveLength(2);
  });

  it("refuses a row with no target", async () => {
    await expect(
      db.insert(schema.favorites).values({
        id: generateId(),
        created: Date.now(),
        createdBy: fx.ownerId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: fx.orgId,
        userId: fx.ownerId,
        stationId: null,
        portalResultId: null,
        curatedViewId: null,
        connectorInstanceId: null,
      })
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("unstars only the caller's row, and unstarring nothing is fine", async () => {
    const target = { type: "pin" as const, id: t.pin };
    await star(fx.ownerId, target);
    await star(fx.memberId, target);
    expect(await favoritesRepo.deleteFor(fx.ownerId, target)).toBe(1);
    expect(await favoritesRepo.deleteFor(fx.ownerId, target)).toBe(0);
    const left = await rows();
    expect(left.map((r) => r.userId)).toEqual([fx.memberId]);
  });

  it("finds which of a page's ids the user starred", async () => {
    await star(fx.ownerId, { type: "curated_view", id: t.curated_view });
    await star(fx.memberId, { type: "station", id: t.station });
    const ids = [t.curated_view, t.station, generateId()];
    expect(
      await favoritesRepo.favoritedIds(
        fx.orgId,
        fx.ownerId,
        "curated_view",
        ids
      )
    ).toEqual(new Set([t.curated_view]));
    expect(
      await favoritesRepo.favoritedIds(fx.orgId, fx.ownerId, "station", ids)
    ).toEqual(new Set());
    expect(
      await favoritesRepo.favoritedIds(fx.orgId, fx.ownerId, "station", [])
    ).toEqual(new Set());
  });

  it("narrows a list query to the user's favorites", async () => {
    const second = await seedTagTargets(db, fx.orgId, fx.ownerId, "Second");
    await star(fx.ownerId, { type: "station", id: second.station });
    await star(fx.memberId, { type: "station", id: t.station });
    const found = await db
      .select({ id: schema.stations.id })
      .from(schema.stations)
      .where(
        and(
          eq(schema.stations.organizationId, fx.orgId),
          favoritesRepo.favoritedBy(
            fx.orgId,
            fx.ownerId,
            "station",
            schema.stations.id
          )
        )
      );
    expect(found.map((r) => r.id)).toEqual([second.station]);
  });

  it("sweeps an object's favorites for every user", async () => {
    await star(fx.ownerId, { type: "station", id: t.station });
    await star(fx.memberId, { type: "station", id: t.station });
    await star(fx.ownerId, { type: "pin", id: t.pin });
    expect(
      await favoritesRepo.hardDeleteByTargets("station", [t.station])
    ).toBe(2);
    expect(await favoritesRepo.hardDeleteByTargets("station", [])).toBe(0);
    expect((await rows()).map((r) => r.portalResultId)).toEqual([t.pin]);
  });

  it("sweeps one member's favorites in one org", async () => {
    const foreign = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
    await star(fx.memberId, { type: "station", id: t.station });
    await star(fx.memberId, { type: "pin", id: t.pin });
    await star(fx.ownerId, { type: "station", id: t.station });
    // The same user starring in another org keeps that star.
    await star(
      fx.memberId,
      { type: "station", id: foreign.station },
      fx.otherOrgId
    );
    expect(await favoritesRepo.hardDeleteByUser(fx.orgId, fx.memberId)).toBe(2);
    const left = await rows();
    expect(left).toHaveLength(2);
    expect(left.some((r) => r.organizationId === fx.otherOrgId)).toBe(true);
    expect(
      left.some(
        (r) => r.userId === fx.memberId && r.organizationId === fx.orgId
      )
    ).toBe(false);
  });

  it("sweeps a whole org", async () => {
    const foreign = await seedTagTargets(db, fx.otherOrgId, fx.otherOwnerId);
    await star(fx.ownerId, { type: "station", id: t.station });
    await star(
      fx.otherOwnerId,
      { type: "station", id: foreign.station },
      fx.otherOrgId
    );
    expect(await favoritesRepo.hardDeleteByOrganization(fx.orgId)).toBe(1);
    expect((await rows()).map((r) => r.organizationId)).toEqual([
      fx.otherOrgId,
    ]);
  });

  it("locks a live target and reports a deleted one", async () => {
    const target = { type: "station" as const, id: t.station };
    expect(
      await DbService.transaction((tx) =>
        favoritesRepo.lockLiveTarget(target, tx)
      )
    ).toBe(true);
    await db
      .update(schema.stations)
      .set({ deleted: Date.now(), deletedBy: fx.ownerId })
      .where(eq(schema.stations.id, t.station));
    expect(
      await DbService.transaction((tx) =>
        favoritesRepo.lockLiveTarget(target, tx)
      )
    ).toBe(false);
  });

  it("goes with the object on a hard delete", async () => {
    await star(fx.ownerId, { type: "pin", id: t.pin });
    await db
      .delete(schema.portalResults)
      .where(eq(schema.portalResults.id, t.pin));
    expect(await rows()).toHaveLength(0);
  });
});
