/**
 * #1070: deleting a tagged object takes its tags with it, and deleting a tag
 * takes it off every object. Each delete runs through its real route, as the
 * org owner.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";

import type { TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|tag-tombstone-owner";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: OWNER_SUB } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const TYPES: TagTargetType[] = [
  "entity",
  "station",
  "pin",
  "connector_instance",
  "curated_view",
];

describe("tag tombstones (#1070)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let targets!: Record<TagTargetType, string>;
  let tagId!: string;
  const repo = new EntityTagAssignmentsRepository();

  /** The types whose seeded object still carries the tag. */
  const tagged = async () => {
    const result: TagTargetType[] = [];
    for (const type of TYPES) {
      const tags = await repo.findByTarget(
        { type, id: targets[type] },
        db as DbClient
      );
      if (tags.length > 0) result.push(type);
    }
    return result;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: "auth0|tag-tombstone-member",
      otherOwner: "auth0|tag-tombstone-other",
    });
    targets = await seedTagTargets(db, fx.orgId, fx.ownerId);
    tagId = await seedTag(db, fx.orgId, fx.ownerId);
    for (const type of TYPES) {
      await repo.insertIfAbsent(
        { type, id: targets[type] },
        tagId,
        {
          id: generateId(),
          organizationId: fx.orgId,
          created: Date.now(),
          createdBy: fx.ownerId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        db as DbClient
      );
    }
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("deleting a station takes its tags, and its pin keeps its own", async () => {
    const res = await request(app).delete(`/api/stations/${targets.station}`);
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual([
      "entity",
      "pin",
      "connector_instance",
      "curated_view",
    ]);
  });

  it("deleting a pin takes its tags", async () => {
    const res = await request(app).delete(`/api/portal-results/${targets.pin}`);
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual([
      "entity",
      "station",
      "connector_instance",
      "curated_view",
    ]);
  });

  it("deleting a view takes its tags", async () => {
    const res = await request(app).delete(
      `/api/curated-views/${targets.curated_view}`
    );
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual([
      "entity",
      "station",
      "pin",
      "connector_instance",
    ]);
  });

  it("deleting an entity takes its tags and its views' tags", async () => {
    const res = await request(app).delete(
      `/api/connector-entities/${targets.entity}`
    );
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual(["station", "pin", "connector_instance"]);
  });

  it("deleting a connector takes its tags and those of its entities and views", async () => {
    const res = await request(app).delete(
      `/api/connector-instances/${targets.connector_instance}`
    );
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual(["station", "pin"]);
  });

  it("deleting a tag takes it off every object", async () => {
    const res = await request(app).delete(`/api/entity-tags/${tagId}`);
    expect(res.status).toBe(200);
    expect(await tagged()).toEqual([]);
    const live = await db
      .select()
      .from(schema.entityTagAssignments)
      .where(
        and(
          eq(schema.entityTagAssignments.organizationId, fx.orgId),
          isNull(schema.entityTagAssignments.deleted)
        )
      );
    expect(live).toHaveLength(0);
  });
});
