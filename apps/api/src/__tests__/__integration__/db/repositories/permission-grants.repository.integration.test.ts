import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { PermissionGrantModelFactory } from "@portalai/core/models";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { PermissionGrantsRepository } from "../../../../db/repositories/permission-grants.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("permission_grants repo (#621 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: PermissionGrantsRepository;
  let orgId: string;

  const grant = (over: Record<string, unknown>) =>
    new PermissionGrantModelFactory()
      .create("system")
      .update({
        organizationId: orgId,
        principalType: "user",
        principalId: "u-x",
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: "st-1",
        condition: null,
        ...over,
      })
      .parse();

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new PermissionGrantsRepository();
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const owner = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(owner as never);
    const org = createOrganization(owner.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  it("findByPrincipals unions a user + a role principal", async () => {
    await repo.create(grant({ principalId: "u-1" }) as never, db);
    await repo.create(
      grant({
        principalType: "role",
        principalId: "role-1",
        resourceId: "st-2",
      }) as never,
      db
    );
    await repo.create(grant({ principalId: "u-other" }) as never, db); // must NOT match

    const rows = await repo.findByPrincipals(
      [
        { principalType: "user", principalId: "u-1" },
        { principalType: "role", principalId: "role-1" },
      ],
      orgId,
      db
    );
    expect(rows.map((r) => r.resourceId).sort()).toEqual(["st-1", "st-2"]);
  });

  it("findByResource returns every grant on one object", async () => {
    await repo.create(grant({ principalId: "u-1", verb: "read" }) as never, db);
    await repo.create(
      grant({ principalId: "u-1", verb: "write" }) as never,
      db
    );
    await repo.create(grant({ resourceId: "st-9" }) as never, db); // other object
    const rows = await repo.findByResource(orgId, "station", "st-1", db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.verb).sort()).toEqual(["read", "write"]);
  });

  it("hardDeleteByResource removes all grants on the object", async () => {
    await repo.create(grant({ verb: "read" }) as never, db);
    await repo.create(grant({ verb: "write" }) as never, db);
    const n = await repo.hardDeleteByResource(orgId, "station", "st-1", db);
    expect(n).toBe(2);
    expect(
      await repo.findByResource(orgId, "station", "st-1", db)
    ).toHaveLength(0);
  });

  it("hardDeleteByPrincipal revokes every grant naming the principal", async () => {
    await repo.create(
      grant({ principalId: "u-1", resourceId: "st-1" }) as never,
      db
    );
    await repo.create(
      grant({ principalId: "u-1", resourceId: "st-2" }) as never,
      db
    );
    await repo.create(grant({ principalId: "u-2" }) as never, db); // survives
    const n = await repo.hardDeleteByPrincipal(orgId, "user", "u-1", db);
    expect(n).toBe(2);
    expect(
      await repo.findByPrincipals(
        [{ principalType: "user", principalId: "u-1" }],
        orgId,
        db
      )
    ).toHaveLength(0);
    expect(
      await repo.findByPrincipals(
        [{ principalType: "user", principalId: "u-2" }],
        orgId,
        db
      )
    ).toHaveLength(1);
  });
});
