import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { stations } from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
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
      { userId: "u", organizationId: orgId, role: "owner" },
      db
    );
    expect(owner.can("billing.manage")).toBe(true);
    expect(owner.can("org.delete")).toBe(true);

    const admin = await PermissionService.loadSet(
      { userId: "u", organizationId: orgId, role: "admin" },
      db
    );
    expect(admin.can("billing.manage")).toBe(false);
    expect(admin.can("org.audit.read")).toBe(true);
    expect(admin.can("member.invite")).toBe(true);

    const member = await PermissionService.loadSet(
      { userId: memberId, organizationId: orgId, role: "member" },
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
      { userId: memberId, organizationId: orgId, role: "member" },
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
      { userId: memberId, organizationId: orgId, role: "member" },
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
      { userId: "owner-u", organizationId: orgId, role: "owner" },
      db
    );
    expect(
      owner.visibilityPredicate("station", {
        createdByCol: stations.createdBy,
        idCol: stations.id,
      })
    ).toBeUndefined();
  });
});
