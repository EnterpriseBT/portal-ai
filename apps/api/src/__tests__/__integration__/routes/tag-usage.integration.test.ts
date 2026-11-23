/**
 * #1070: `GET /api/entity-tags?include=usage` counts, per type, the objects
 * carrying each tag, over only the objects the caller can read. A count over
 * the rest would reveal they exist.
 *
 * Fixture: a member owns one object of each type, all tagged "Shared". The
 * org owner owns another set, also tagged, which the member can't read. A
 * third member-owned set is tagged and then deleted. The member is granted
 * tag read, since a member holds no tag permission by default.
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
import { inArray } from "drizzle-orm";

import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const OWNER_SUB = "auth0|tag-usage-owner";
const MEMBER_SUB = "auth0|tag-usage-member";

let currentSub = MEMBER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
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

const ALL = (n: number) =>
  Object.fromEntries(TAG_TARGET_TYPES.map((t) => [t, n])) as Record<
    TagTargetType,
    number
  >;

describe("tag usage counts (#1070)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let shared!: string;
  let unused!: string;
  const repo = new EntityTagAssignmentsRepository();

  const tagAll = async (targets: Record<TagTargetType, string>) => {
    for (const type of TAG_TARGET_TYPES) {
      await repo.insertIfAbsent(
        { type, id: targets[type] },
        shared,
        {
          id: generateId(),
          organizationId: fx.orgId,
          created: Date.now(),
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        db as DbClient
      );
    }
  };

  const usageOf = async (tagId: string) => {
    const res = await request(app).get("/api/entity-tags?include=usage");
    expect(res.status).toBe(200);
    const row = (
      res.body.payload.entityTags as { id: string; usage?: unknown }[]
    ).find((t) => t.id === tagId);
    return row?.usage;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: "auth0|tag-usage-other",
    });
    shared = await seedTag(db, fx.orgId, fx.ownerId, "Shared");
    unused = await seedTag(db, fx.orgId, fx.ownerId, "Unused");
    await tagAll(await seedTagTargets(db, fx.orgId, fx.memberId, "mine"));
    await tagAll(await seedTagTargets(db, fx.orgId, fx.ownerId, "owners"));
    const gone = await seedTagTargets(db, fx.orgId, fx.memberId, "gone");
    await tagAll(gone);
    const deleted = { deleted: Date.now(), deletedBy: "SYSTEM_TEST" };
    await db
      .update(schema.curatedViews)
      .set(deleted)
      .where(inArray(schema.curatedViews.id, [gone.curated_view]));
    await db
      .update(schema.portalResults)
      .set(deleted)
      .where(inArray(schema.portalResults.id, [gone.pin]));
    await db
      .update(schema.stations)
      .set(deleted)
      .where(inArray(schema.stations.id, [gone.station]));
    await db
      .update(schema.connectorEntities)
      .set(deleted)
      .where(inArray(schema.connectorEntities.id, [gone.entity]));
    await db
      .update(schema.connectorInstances)
      .set(deleted)
      .where(inArray(schema.connectorInstances.id, [gone.connector_instance]));
    await allowForUser(db, {
      organizationId: fx.orgId,
      userId: fx.memberId,
      verb: "read",
      resourceType: "tag",
    });
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("counts only the readable, live objects of each type", async () => {
    currentSub = MEMBER_SUB;
    expect(await usageOf(shared)).toEqual(ALL(1));
  });

  it("counts every live object for a caller who reads them all", async () => {
    currentSub = OWNER_SUB;
    expect(await usageOf(shared)).toEqual(ALL(2));
  });

  it("gives every type zero for an unused tag", async () => {
    currentSub = MEMBER_SUB;
    expect(await usageOf(unused)).toEqual(ALL(0));
  });

  it("leaves usage off without include=usage", async () => {
    currentSub = MEMBER_SUB;
    const res = await request(app).get("/api/entity-tags");
    expect(res.status).toBe(200);
    for (const tag of res.body.payload.entityTags as object[]) {
      expect(tag).not.toHaveProperty("usage");
    }
  });
});
