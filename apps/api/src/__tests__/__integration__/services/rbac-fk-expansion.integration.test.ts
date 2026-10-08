/**
 * Integration test for the #599 slice-2 FK-condition expansion.
 *
 * A `read field_mapping in_curated_view:<V>` grant is expanded at load time
 * (`PermissionService.loadSet` → `expandFkConditions`) into concrete
 * `field_mapping:<id>` reads — the resolver never sees the FK condition. This
 * asserts against a real org → entity → field-mapping → curated-view chain:
 *   - an explicit-projection view → only its joined field mappings are readable,
 *   - an unrestricted (no-projection) view → all the entity's field mappings,
 *   - adding a projection row extends readability on the next load (auto-track),
 *   - a member holds no other field access (the grant is the sole authority).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { PermissionService } from "../../../services/permission.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

function base(userId: string) {
  return {
    id: generateId(),
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

describe("#599 slice 2 — FK-condition expansion (in_curated_view)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let client!: ReturnType<typeof drizzle>;
  let userId: string;
  let orgId: string;
  let entityId: string;
  let fmIds: string[];

  const ctx = () => ({ userId, organizationId: orgId, roles: [] as never[] });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    client = db as ReturnType<typeof drizzle>;
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(userId);
    await client.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const def = {
      ...base(userId),
      slug: `conn-${generateId()}`,
      display: "C",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: {},
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
    };
    await client.insert(schema.connectorDefinitions).values(def as never);

    const instance = {
      ...base(userId),
      connectorDefinitionId: def.id,
      organizationId: orgId,
      name: "I",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: {},
    };
    await client.insert(schema.connectorInstances).values(instance as never);

    const entity = {
      ...base(userId),
      organizationId: orgId,
      connectorInstanceId: instance.id,
      key: "accounts",
      label: "Accounts",
    };
    await client.insert(schema.connectorEntities).values(entity as never);
    entityId = entity.id;

    // Two columns → two field mappings.
    fmIds = [];
    for (const key of ["amount", "region"]) {
      const col = {
        ...base(userId),
        organizationId: orgId,
        key,
        label: key,
        type: "string" as const,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
      };
      await client.insert(schema.columnDefinitions).values(col as never);
      const fm = {
        ...base(userId),
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: col.id,
        sourceField: key,
        isPrimaryKey: false,
        normalizedKey: key,
        required: false,
      };
      await client.insert(schema.fieldMappings).values(fm as never);
      fmIds.push(fm.id);
    }
  });

  afterEach(async () => {
    await teardownOrg(client);
    await connection.end();
  });

  async function makeView(
    projectionFmIds: string[] | null // null = unrestricted (no projection rows)
  ): Promise<string> {
    const view = {
      ...base(userId),
      organizationId: orgId,
      connectorEntityId: entityId,
      key: `view-${generateId()}`,
      label: "V",
      description: null,
      whereClause: null,
    };
    await client.insert(schema.curatedViews).values(view as never);
    if (projectionFmIds) {
      for (const fieldMappingId of projectionFmIds) {
        await client.insert(schema.curatedViewFieldMappings).values({
          ...base(userId),
          organizationId: orgId,
          curatedViewId: view.id,
          fieldMappingId,
        } as never);
      }
    }
    return view.id;
  }

  async function grantView(viewId: string): Promise<void> {
    await client.insert(schema.permissionGrants).values({
      ...base(userId),
      organizationId: orgId,
      principalType: "user",
      principalId: userId,
      effect: "allow",
      verb: "read",
      resourceType: "field_mapping",
      resourceId: null,
      condition: "in_curated_view",
      conditionParam: viewId,
    } as never);
  }

  const canRead = (
    set: Awaited<ReturnType<typeof PermissionService.loadSet>>,
    id: string
  ) =>
    // #731: creator unknown — only the FK-expanded instance grant can match.
    set.can("resource.read", { type: "field_mapping", id, createdBy: null });

  it("an explicit-projection view grants read on ONLY its joined field mappings", async () => {
    const viewId = await makeView([fmIds[0]]); // amount only
    await grantView(viewId);

    const set = await PermissionService.loadSet(ctx(), db);
    expect(canRead(set, fmIds[0])).toBe(true); // in projection
    expect(canRead(set, fmIds[1])).toBe(false); // not in projection
  });

  it("an unrestricted (no-projection) view grants read on ALL the entity's field mappings", async () => {
    const viewId = await makeView(null);
    await grantView(viewId);

    const set = await PermissionService.loadSet(ctx(), db);
    expect(canRead(set, fmIds[0])).toBe(true);
    expect(canRead(set, fmIds[1])).toBe(true);
  });

  it("auto-tracks: adding a projection row extends readability on the next load", async () => {
    const viewId = await makeView([fmIds[0]]);
    await grantView(viewId);

    let set = await PermissionService.loadSet(ctx(), db);
    expect(canRead(set, fmIds[1])).toBe(false);

    await client.insert(schema.curatedViewFieldMappings).values({
      ...base(userId),
      organizationId: orgId,
      curatedViewId: viewId,
      fieldMappingId: fmIds[1],
    } as never);

    set = await PermissionService.loadSet(ctx(), db);
    expect(canRead(set, fmIds[1])).toBe(true); // no grant change needed
  });

  it("without the grant, the member holds no field access (grant is the sole authority)", async () => {
    await makeView([fmIds[0]]); // a view exists but is NOT granted
    const set = await PermissionService.loadSet(ctx(), db);
    expect(canRead(set, fmIds[0])).toBe(false);
    expect(canRead(set, fmIds[1])).toBe(false);
  });
});
