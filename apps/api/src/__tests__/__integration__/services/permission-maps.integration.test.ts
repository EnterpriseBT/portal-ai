import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import { PermissionService } from "../../../services/permission.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

/**
 * #630 slice 3 — `PermissionService.permissionMaps` feeds the current-org
 * payload. A member sees their member pages + own-object read/write; an owner
 * sees everything. Computed from one resolved set.
 */
describe("PermissionService.permissionMaps (#630)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    userId = user.id;
    const org = createOrganization(userId);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
    await new SeedService().seedRbacSystemPolicies(orgId, db);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("a member: member pages granted, admin pages denied", async () => {
    const { pagePermissions } = await PermissionService.permissionMaps(
      { userId, organizationId: orgId, roles: ["member"] },
      db
    );
    expect(pagePermissions.stations).toBe(true);
    expect(pagePermissions.pinned).toBe(true);
    expect(pagePermissions.jobs).toBe(true);
    expect(pagePermissions.connectors).toBe(false);
    expect(pagePermissions.entities).toBe(false);
    expect(pagePermissions.toolpacks).toBe(false);
  });

  it("a member: own-object read/write/delete on data types; none on admin-managed", async () => {
    const { resourcePermissions } = await PermissionService.permissionMaps(
      { userId, organizationId: orgId, roles: ["member"] },
      db
    );
    // connector_instance ∈ data types → read/write/delete own (#630 grants
    // members delete of the data objects they create).
    expect(resourcePermissions.connector_instance).toEqual({
      read: true,
      write: true,
      delete: true,
    });
    // station ∈ shareable → read/write/delete own.
    expect(resourcePermissions.station).toEqual({
      read: true,
      write: true,
      delete: true,
    });
    // job → unconditional read, no write/delete.
    expect(resourcePermissions.job).toEqual({
      read: true,
      write: false,
      delete: false,
    });
    // entity_group is admin-managed → member has nothing.
    expect(resourcePermissions.entity_group).toEqual({
      read: false,
      write: false,
      delete: false,
    });
  });

  it("an owner: every page and every object verb", async () => {
    const { pagePermissions, resourcePermissions, capabilities } =
      await PermissionService.permissionMaps(
        { userId, organizationId: orgId, roles: ["owner"] },
        db
      );
    for (const granted of Object.values(pagePermissions)) {
      expect(granted).toBe(true);
    }
    for (const rwx of Object.values(resourcePermissions)) {
      expect(rwx).toEqual({ read: true, write: true, delete: true });
    }
    expect(capabilities["billing.manage"]).toBe(true);
    expect(capabilities["org.delete"]).toBe(true);
  });

  it("an admin: pages + objects, but not billing.manage / org.delete", async () => {
    const { capabilities, pagePermissions } =
      await PermissionService.permissionMaps(
        { userId, organizationId: orgId, roles: ["admin"] },
        db
      );
    expect(pagePermissions.connectors).toBe(true);
    expect(pagePermissions.toolpacks).toBe(true);
    expect(capabilities["billing.manage"]).toBe(false);
    expect(capabilities["org.delete"]).toBe(false);
  });
});
