import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import {
  createUser,
  createOrganization,
  createOrganizationUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

const { users, organizations, organizationUsers } = schema;

/**
 * #576 slice 1 — the `role` column on `organization_users`:
 * per-role round-trip, the DB CHECK guard, and the migration's owner backfill.
 */
describe("organization_users.role (#576)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
  });

  afterEach(async () => {
    await teardownOrg(db);
  });

  afterAll(async () => {
    await connection.end();
  });

  it("stores and reads back each valid role (spec case 5)", async () => {
    const owner = createUser("auth0|role-rt");
    await db.insert(users).values(owner as never);
    const org = createOrganization(owner.id);
    await db.insert(organizations).values(org as never);

    const roles = ["owner", "admin", "member"] as const;
    const memberships = await Promise.all(
      roles.map(async (role) => {
        const u = createUser(`auth0|role-rt-${role}`);
        await db.insert(users).values(u as never);
        const ou = createOrganizationUser(org.id, u.id, {
          id: generateId(),
          role,
        });
        await db.insert(organizationUsers).values(ou as never);
        return { id: ou.id, role };
      })
    );

    const rows = await db.select().from(organizationUsers);
    for (const m of memberships) {
      expect(rows.find((r) => r.id === m.id)?.role).toBe(m.role);
    }
  });

  it("rejects an invalid role at the DB via the CHECK (spec case 5)", async () => {
    const u = createUser("auth0|role-bad");
    await db.insert(users).values(u as never);
    const org = createOrganization(u.id);
    await db.insert(organizations).values(org as never);

    const bad = createOrganizationUser(org.id, u.id, {
      id: generateId(),
      role: "viewer", // not in ORG_ROLES — the CHECK must reject it
    });

    await expect(
      db.insert(organizationUsers).values(bad as never)
    ).rejects.toThrow();
  });

  it("owner backfill promotes the org owner's membership to 'owner' (spec case 7)", async () => {
    const owner = createUser("auth0|bf-owner");
    const other = createUser("auth0|bf-other");
    await db.insert(users).values([owner, other] as never);

    // ownerUserId = owner.id
    const org = createOrganization(owner.id);
    await db.insert(organizations).values(org as never);

    // Pre-backfill state: the ADD COLUMN default put BOTH at 'member'.
    const ownerMembership = createOrganizationUser(org.id, owner.id, {
      id: generateId(),
      role: "member",
    });
    const otherMembership = createOrganizationUser(org.id, other.id, {
      id: generateId(),
      role: "member",
    });
    await db
      .insert(organizationUsers)
      .values([ownerMembership, otherMembership] as never);

    // The exact backfill statement the migration runs.
    await db.execute(sql`
      UPDATE "organization_users" AS ou
      SET "role" = 'owner'
      FROM "organizations" AS o
      WHERE ou."organization_id" = o."id"
        AND ou."user_id" = o."owner_user_id"
        AND ou."deleted" IS NULL
    `);

    const rows = await db.select().from(organizationUsers);
    expect(rows.find((r) => r.id === ownerMembership.id)?.role).toBe("owner");
    expect(rows.find((r) => r.id === otherMembership.id)?.role).toBe("member");
  });
});
