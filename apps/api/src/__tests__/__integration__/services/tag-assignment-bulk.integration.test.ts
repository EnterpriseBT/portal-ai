/**
 * #1071 code review: TagAssignmentService.assignMany / unassignMany, the bulk
 * path the agent's tag_assign / tag_unassign run on. Every pair is written in
 * one transaction, so a failure part-way through leaves nothing applied, and
 * the caller's permissions load once per call, not once per pair.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isNull } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { DbService } from "../../../services/db.service.js";
import { PermissionService } from "../../../services/permission.service.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import { TagAssignmentService } from "../../../services/tag-assignment.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

describe("TagAssignmentService bulk writes (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let owner!: PermissionContext;
  let tags!: string[];
  let targets!: { type: "station" | "curated_view" | "pin"; id: string }[];

  const live = async () =>
    db
      .select()
      .from(schema.entityTagAssignments)
      .where(isNull(schema.entityTagAssignments.deleted));

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: "auth0|tab-owner",
      member: "auth0|tab-member",
      otherOwner: "auth0|tab-other",
    });
    owner = { userId: fx.ownerId, organizationId: fx.orgId, roles: ["owner"] };
    tags = [
      await seedTag(db, fx.orgId, fx.ownerId, "Finance"),
      await seedTag(db, fx.orgId, fx.ownerId, "Q4"),
    ];
    const objects = await seedTagTargets(db, fx.orgId, fx.ownerId, "o");
    targets = [
      { type: "station", id: objects.station },
      { type: "curated_view", id: objects.curated_view },
      { type: "pin", id: objects.pin },
    ];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await teardownOrg(db);
    await connection.end();
  });

  it("assigns every pair and reports each in input order", async () => {
    const results = await TagAssignmentService.assignMany(owner, targets, tags);
    expect(results.map((r) => [r.target.id, r.entityTagId, r.created])).toEqual(
      targets.flatMap((t) => tags.map((tag) => [t.id, tag, true]))
    );
    expect(await live()).toHaveLength(6);
  });

  it("applies nothing when a write fails part-way through", async () => {
    const repo = DbService.repository.entityTagAssignments;
    const real = repo.insertIfAbsent.bind(repo);
    let calls = 0;
    jest.spyOn(repo, "insertIfAbsent").mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 4) throw new Error("connection reset");
      return real(...args);
    });

    await expect(
      TagAssignmentService.assignMany(owner, targets, tags)
    ).rejects.toMatchObject({
      status: 500,
      code: ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED,
    });
    expect(calls).toBe(4);
    expect(await live()).toEqual([]);
  });

  it("loads the caller's permissions once for the whole call", async () => {
    const loadSet = jest.spyOn(PermissionService, "loadSet");
    await TagAssignmentService.assignMany(owner, targets, tags);
    expect(loadSet).toHaveBeenCalledTimes(1);

    loadSet.mockClear();
    await TagAssignmentService.unassignMany(owner, targets, tags);
    expect(loadSet).toHaveBeenCalledTimes(1);
  });

  it("removes what each object carries and reports the rest as absent", async () => {
    await TagAssignmentService.assignMany(owner, [targets[0]], [tags[0]]);

    const results = await TagAssignmentService.unassignMany(
      owner,
      [targets[0]],
      tags
    );

    expect(results.map((r) => [r.entityTagId, r.removed])).toEqual([
      [tags[0], true],
      [tags[1], false],
    ]);
    expect(await live()).toEqual([]);
  });

  it("refuses a deleted tag before writing anything", async () => {
    await db
      .update(schema.entityTags)
      .set({ deleted: Date.now(), deletedBy: fx.ownerId });
    const err = await TagAssignmentService.assignMany(
      owner,
      targets,
      tags
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(ApiCode.ENTITY_TAG_NOT_FOUND);
    expect(await live()).toEqual([]);
  });
});
