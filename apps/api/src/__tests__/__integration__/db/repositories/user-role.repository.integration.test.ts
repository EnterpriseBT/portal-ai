import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { UserRolesRepository } from "../../../../db/repositories/user-roles.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
  seedRbacForOrg,
  provisionTestOrg,
} from "../../utils/application.util.js";

describe("user_role repo + backfill + provisioning (#620 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: UserRolesRepository;

  const audit = (actor: string) => ({
    created: Date.now(),
    createdBy: actor,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new UserRolesRepository();
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  const seedOrgWithRoles = async () => {
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    await seedRbacForOrg(db as ReturnType<typeof drizzle>, org.id); // creates sysrole:<org>:{owner,admin,member}
    return { userId: user.id, orgId: org.id };
  };

  it("round-trips + rejects a duplicate role assignment (case 4)", async () => {
    const { userId, orgId } = await seedOrgWithRoles();
    const roleId = `sysrole:${orgId}:member`;
    await repo.create(
      {
        id: generateId(),
        userId,
        organizationId: orgId,
        roleId,
        ...audit(userId),
      } as never,
      db
    );
    const rows = await repo.findByUserOrg(userId, orgId, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].roleId).toBe(roleId);
    expect(await repo.findRoleNames(userId, orgId, db)).toEqual(["member"]);

    // unique (userId, org, roleId) — a second identical live row is rejected.
    await expect(
      repo.create(
        {
          id: generateId(),
          userId,
          organizationId: orgId,
          roleId,
          ...audit(userId),
        } as never,
        db
      )
    ).rejects.toThrow();
  });

  it("countUsersWithRole counts owners by role name", async () => {
    const { userId, orgId } = await seedOrgWithRoles();
    await repo.create(
      {
        id: generateId(),
        userId,
        organizationId: orgId,
        roleId: `sysrole:${orgId}:owner`,
        ...audit(userId),
      } as never,
      db
    );
    expect(await repo.countUsersWithRole(orgId, "owner", db)).toBe(1);
    expect(await repo.countUsersWithRole(orgId, "admin", db)).toBe(0);
  });

  it("the 0104 backfill remaps an existing membership → user_role (case 6)", async () => {
    const { userId, orgId } = await seedOrgWithRoles();
    // A pre-#620 membership carrying its role in the enum, no user_role yet.
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(orgId, userId, { role: "admin" }) as never
      );
    expect(await repo.findByUserOrg(userId, orgId, db)).toHaveLength(0);

    const sql = readFileSync(
      join(process.cwd(), "drizzle/0104_backfill-user-roles.sql"),
      "utf8"
    );
    await connection.unsafe(sql);

    expect(await repo.findRoleNames(userId, orgId, db)).toEqual(["admin"]);
    // Idempotent: re-run changes nothing.
    await connection.unsafe(sql);
    expect(await repo.findByUserOrg(userId, orgId, db)).toHaveLength(1);
  });

  it("provisioning assigns the owner a user_role (case 10)", async () => {
    const owner = createUser(`auth0|${generateId()}`);
    const { user: created, organization } = await provisionTestOrg(
      owner as never
    );
    const roleNames = await repo.findRoleNames(created.id, organization.id, db);
    expect(roleNames).toContain("owner");
  });
});
