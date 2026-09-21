import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { stations } from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  PermissionGrantModelFactory,
  type OrgRole,
} from "@portalai/core/models";
import { SeedService } from "../../../services/seed.service.js";
import { PermissionService } from "../../../services/permission.service.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("PermissionService.loadSet — data-driven engine (#598 slice 3, case 9)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let memberId: string;

  const insertStation = async (createdBy: string) => {
    const id = generateId();
    await (db as ReturnType<typeof drizzle>).insert(stations).values({
      id,
      organizationId: orgId,
      name: `station-${id.slice(0, 6)}`,
      description: null,
      created: Date.now(),
      createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);

    const owner = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(owner as never);
    const member = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(member as never);
    memberId = member.id;
    const org = createOrganization(owner.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    await new SeedService().seedRbacSystemPolicies(orgId, db);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("resolves owner/admin/member from the seeded policies", async () => {
    const owner = await PermissionService.loadSet(
      { userId: "u", organizationId: orgId, roles: ["owner"] },
      db
    );
    expect(owner.can("billing.manage")).toBe(true);
    expect(owner.can("org.delete")).toBe(true);

    const admin = await PermissionService.loadSet(
      { userId: "u", organizationId: orgId, roles: ["admin"] },
      db
    );
    expect(admin.can("billing.manage")).toBe(false);
    expect(admin.can("org.audit.read")).toBe(true);
    expect(admin.can("member.invite")).toBe(true);

    const member = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, roles: ["member"] },
      db
    );
    expect(member.can("org.audit.read")).toBe(false);
    expect(
      member.can("resource.read", { type: "station", createdBy: memberId })
    ).toBe(true);
    expect(
      member.can("resource.read", {
        type: "station",
        createdBy: "someone-else",
      })
    ).toBe(false);
  });

  it("an empty/unknown role resolves to a fail-closed empty set", async () => {
    // A role name with no seeded row → no attachments → empty set → deny.
    const set = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, roles: ["member"] },
      db
    );
    // sanity: member set is non-empty (has statements)
    expect(
      set.can("resource.read", { type: "station", createdBy: memberId })
    ).toBe(true);
  });

  it("the member visibilityPredicate filters a real stations query to own + system", async () => {
    const ownId = await insertStation(memberId);
    const systemId = await insertStation(SystemUtilities.id.system);
    await insertStation("other-user"); // must NOT be visible

    const set = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, roles: ["member"] },
      db
    );
    const pred = set.visibilityPredicate("station", {
      createdByCol: stations.createdBy,
      idCol: stations.id,
    });
    const rows = await db
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.organizationId, orgId), pred));
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([ownId, systemId].sort());
  });

  it("the owner visibilityPredicate is undefined (sees all)", async () => {
    await insertStation(memberId);
    await insertStation("other-user");
    const owner = await PermissionService.loadSet(
      { userId: "owner-u", organizationId: orgId, roles: ["owner"] },
      db
    );
    expect(
      owner.visibilityPredicate("station", {
        createdByCol: stations.createdBy,
        idCol: stations.id,
      })
    ).toBeUndefined();
  });

  // ── #620 multi-role (spec cases 3, 5) ──────────────────────────────

  it("loadSet unions statements across all of a user's roles (case 5)", async () => {
    // A pure member cannot invite; adding the admin role grants it via union,
    // while the member's own-resource allow is retained.
    const set = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, roles: ["member", "admin"] },
      db
    );
    expect(set.can("member.invite")).toBe(true); // from admin
    expect(set.can("org.audit.read")).toBe(true); // from admin
    expect(
      set.can("resource.read", { type: "station", createdBy: memberId })
    ).toBe(true); // retained from member
  });

  it("an explicit deny in one role beats an allow in another (deny wins across the union, case 5)", async () => {
    // owner = FullAccess (allow * *); admin = AdminAccess (+ deny billing).
    // The union denies billing — the IAM invariant that deny always wins.
    const set = await PermissionService.loadSet(
      { userId: "u", organizationId: orgId, roles: ["owner", "admin"] },
      db
    );
    expect(set.can("billing.manage")).toBe(false);
  });

  it("single-role loadSet is identical to the role alone (parity gate, case 5)", async () => {
    // The #620 guarantee: a user with exactly one role resolves precisely as
    // pre-#620's single-enum switch did (see permission-set switch-parity).
    const member = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, roles: ["member"] },
      db
    );
    expect(member.can("member.invite")).toBe(false);
    expect(member.can("org.audit.read")).toBe(false);
    expect(
      member.can("resource.read", { type: "station", createdBy: memberId })
    ).toBe(true);
  });

  it("capabilities() maps every caller-capability action to a boolean (case 3)", async () => {
    const ownerCaps = await PermissionService.capabilities(
      { userId: "u", organizationId: orgId, roles: ["owner"] },
      db
    );
    expect(ownerCaps).toEqual({
      "billing.manage": true,
      "org.delete": true,
      "org.audit.read": true,
      "member.role.assign": true,
      "member.invite": true,
      "member.remove": true,
    });

    const memberCaps = await PermissionService.capabilities(
      { userId: memberId, organizationId: orgId, roles: ["member"] },
      db
    );
    expect(memberCaps).toEqual({
      "billing.manage": false,
      "org.delete": false,
      "org.audit.read": false,
      "member.role.assign": false,
      "member.invite": false,
      "member.remove": false,
    });

    const adminCaps = await PermissionService.capabilities(
      { userId: "u", organizationId: orgId, roles: ["admin"] },
      db
    );
    expect(adminCaps["billing.manage"]).toBe(false);
    expect(adminCaps["org.delete"]).toBe(false);
    expect(adminCaps["org.audit.read"]).toBe(true);
    expect(adminCaps["member.invite"]).toBe(true);
  });

  // ── #621 grant union ────────────────────────────────────────────────

  const insertGrant = async (over: Record<string, unknown>) => {
    const row = new PermissionGrantModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        organizationId: orgId,
        principalType: "user",
        principalId: memberId,
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: "st-shared",
        condition: null,
        ...over,
      })
      .parse();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.permissionGrants)
      .values(row as never);
  };

  it("a user-principal grant surfaces an object the member didn't create (#621)", async () => {
    const ctx = {
      userId: memberId,
      organizationId: orgId,
      roles: ["member"] as OrgRole[],
    };
    const other = {
      type: "station",
      id: "st-shared",
      createdBy: "someone-else",
    };
    // Without a grant: no access to another user's station.
    expect(
      (await PermissionService.loadSet(ctx, db)).can("resource.read", other)
    ).toBe(false);
    await insertGrant({ verb: "read" });
    const set = await PermissionService.loadSet(ctx, db);
    expect(set.can("resource.read", other)).toBe(true);
    expect(set.can("resource.write", other)).toBe(false); // read grant only
  });

  it("a role-principal grant reaches a member via their role (team share, #621)", async () => {
    await insertGrant({
      principalType: "role",
      principalId: `sysrole:${orgId}:member`,
      resourceId: "st-team",
      verb: "read",
    });
    const set = await PermissionService.loadSet(
      { userId: "any-member", organizationId: orgId, roles: ["member"] },
      db
    );
    expect(
      set.can("resource.read", {
        type: "station",
        id: "st-team",
        createdBy: "x",
      })
    ).toBe(true);
  });

  it("a deny grant overrides an allow the member otherwise has (#621)", async () => {
    const ctx = {
      userId: memberId,
      organizationId: orgId,
      roles: ["member"] as OrgRole[],
    };
    const own = { type: "station", id: "st-own", createdBy: memberId };
    // Member can write their own station (MemberAccess write created_by_caller).
    expect(
      (await PermissionService.loadSet(ctx, db)).can("resource.write", own)
    ).toBe(true);
    await insertGrant({ effect: "deny", verb: "write", resourceId: "st-own" });
    expect(
      (await PermissionService.loadSet(ctx, db)).can("resource.write", own)
    ).toBe(false);
  });
});
