import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import {
  GroupModelFactory,
  UserGroupModelFactory,
  PolicyAttachmentModelFactory,
  PolicyModelFactory,
} from "@portalai/core/models";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { GroupsRepository } from "../../../../db/repositories/groups.repository.js";
import { UserGroupsRepository } from "../../../../db/repositories/user-groups.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("groups + user_group repos (#622 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let groupsRepo: GroupsRepository;
  let userGroupsRepo: UserGroupsRepository;
  let orgId: string;
  let userId: string;

  const asDrizzle = () => db as ReturnType<typeof drizzle>;

  const makeGroup = (over: Record<string, unknown> = {}) =>
    new GroupModelFactory()
      .create("system")
      .update({
        organizationId: orgId,
        name: "Analysts",
        description: null,
        ...over,
      })
      .parse();

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    groupsRepo = new GroupsRepository();
    userGroupsRepo = new UserGroupsRepository();
    await teardownOrg(asDrizzle());
    const owner = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values(owner as never);
    userId = owner.id;
    const org = createOrganization(owner.id);
    await asDrizzle()
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  it("creates + finds a group by org and by name; soft-delete hides it", async () => {
    const g = makeGroup();
    await groupsRepo.create(g as never, db);

    expect((await groupsRepo.findByOrganizationId(orgId, db)).length).toBe(1);
    expect((await groupsRepo.findByName(orgId, "Analysts", db))?.id).toBe(g.id);

    await groupsRepo.softDelete(g.id, "system", db);
    expect(await groupsRepo.findByName(orgId, "Analysts", db)).toBeUndefined();
    expect((await groupsRepo.findByOrganizationId(orgId, db)).length).toBe(0);
  });

  it("findGroupIdsByUser returns only the user's live memberships in the org", async () => {
    const g1 = makeGroup({ name: "G1" });
    const g2 = makeGroup({ name: "G2" });
    await groupsRepo.create(g1 as never, db);
    await groupsRepo.create(g2 as never, db);

    const member = (groupId: string, uid = userId) =>
      new UserGroupModelFactory()
        .create("system")
        .update({ organizationId: orgId, userId: uid, groupId })
        .parse();

    const other = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values(other as never);
    await userGroupsRepo.create(member(g1.id) as never, db);
    await userGroupsRepo.create(member(g2.id) as never, db);
    await userGroupsRepo.create(member(g1.id, other.id) as never, db); // must NOT match

    const ids = await userGroupsRepo.findGroupIdsByUser(userId, orgId, db);
    expect(ids.sort()).toEqual([g1.id, g2.id].sort());

    // A soft-deleted membership drops out of the gather — soft-delete this
    // user's g1 row specifically, leaving g2.
    const [g1Row] = await userGroupsRepo.findMany(
      and(
        eq(schema.userGroup.userId, userId),
        eq(schema.userGroup.groupId, g1.id)
      ),
      {},
      db
    );
    await userGroupsRepo.softDelete(g1Row.id, "system", db);
    expect(await userGroupsRepo.findGroupIdsByUser(userId, orgId, db)).toEqual([
      g2.id,
    ]);
  });

  it("policy_attachments admits a group principal (migration CHECK)", async () => {
    const g = makeGroup();
    await groupsRepo.create(g as never, db);
    const policy = new PolicyModelFactory()
      .create("system")
      .update({
        organizationId: orgId,
        name: "P",
        kind: "custom",
        description: null,
      })
      .parse();
    await asDrizzle()
      .insert(schema.permissionPolicies)
      .values(policy as never);
    const attachment = new PolicyAttachmentModelFactory()
      .create("system")
      .update({
        organizationId: orgId,
        policyId: policy.id,
        principalType: "group",
        principalId: g.id,
      })
      .parse();
    await expect(
      asDrizzle()
        .insert(schema.policyAttachments)
        .values(attachment as never)
    ).resolves.toBeDefined();
  });
});
