/**
 * #824: a station with no attached curated views lost every agent write
 * tool, though its attached connector allowed writes: the write gate derived
 * the station's connectors from its views only (#599), while the tools
 * themselves scope by the connectors attached to the station directly. Tools
 * are built here exactly as a portal session builds them.
 *
 * #827: the mirror — a station reaching an entity only through a view was
 * offered the write tools, which then refused every item as out of scope.
 * Both sides now share one definition of the station's reach.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { ToolService } from "../../../services/tools.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
  seedRbacForOrg,
  attachCuratedView,
} from "../utils/application.util.js";

const base = (createdBy: string) => ({
  created: Date.now(),
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

const WRITE_TOOLS = [
  "connector_entity_create",
  "field_mapping_create",
  "entity_record_create",
] as const;

describe("station write scope (#824)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let orgId: string;
  let ownerId: string;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 2 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);

    const owner = createUser(`auth0|owner-${generateId()}`);
    await d.insert(schema.users).values(owner as never);
    ownerId = owner.id;
    const org = createOrganization(owner.id);
    await d.insert(schema.organizations).values(org as never);
    orgId = org.id;
    const tierSlug = `sws-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base("STATION_WRITE_SCOPE_TEST"),
      slug: tierSlug,
      displayName: "Station write scope test",
      builtinToolpacks: ["entity_management"],
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: tierSlug })
      .where(eq(schema.organizations.id, orgId));
    await seedRbacForOrg(d as never, orgId);
    await d.insert(schema.organizationUsers).values(
      createOrganizationUser(orgId, ownerId, {
        role: "owner",
        lastLogin: 0,
      }) as never
    );
  });

  afterEach(async () => {
    await teardownOrg(d);
    await d
      .delete(schema.tiers)
      .where(eq(schema.tiers.createdBy, "STATION_WRITE_SCOPE_TEST"));
    await connection.end();
  });

  /** A write-enabled connector instance the owner created. */
  async function seedInstance(instanceWrite: boolean) {
    const defId = generateId();
    await d.insert(schema.connectorDefinitions).values({
      id: defId,
      slug: `cd-${defId.slice(0, 8)}`,
      display: "CD",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: false },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const instId = generateId();
    await d.insert(schema.connectorInstances).values({
      id: instId,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: "Sandbox",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: instanceWrite, sync: false },
      ...base(ownerId),
    } as never);
    return instId;
  }

  /** A station with the entity pack and nothing attached. */
  async function seedBareStation(name: string) {
    const stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name,
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "entity_management",
      organizationToolpackId: null,
      ...base(ownerId),
    } as never);
    return stationId;
  }

  /** An entity on `instanceId` with one mapping and its wide table. */
  async function seedEntity(instanceId: string) {
    const entityId = generateId();
    await d.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: `ent_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Entity",
      ...base(ownerId),
    } as never);
    const colId = generateId();
    await d.insert(schema.columnDefinitions).values({
      id: colId,
      organizationId: orgId,
      key: `name_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Name",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.fieldMappings).values({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colId,
      sourceField: "name",
      isPrimaryKey: false,
      normalizedKey: "name",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      ...base(ownerId),
    } as never);
    wideTableStatementCache.clear();
    await wideTableReconcilerService.reconcileEntity(
      entityId,
      d as unknown as DbClient
    );
    return entityId;
  }

  const recordCount = async (entityId: string) =>
    (
      await d
        .select()
        .from(schema.entityRecords)
        .where(eq(schema.entityRecords.connectorEntityId, entityId))
    ).length;

  const run = async (stationId: string, name: string, input: unknown) => {
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      ownerId,
      generateId()
    );
    const t = tools[name] as {
      execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>>;
    };
    return t.execute(input, {
      toolCallId: "t",
      messages: [],
      abortSignal: new AbortController().signal,
    });
  };

  /** A station with the entity pack and one connector attached directly, no views. */
  async function seedStation(instanceWrite: boolean) {
    const instId = await seedInstance(instanceWrite);
    const stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "No-view station",
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instId,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "entity_management",
      organizationToolpackId: null,
      ...base(ownerId),
    } as never);
    return stationId;
  }

  it("offers the entity write tools on a station with no views but a writable attached connector", async () => {
    const stationId = await seedStation(true);
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      ownerId,
      generateId()
    );
    for (const name of WRITE_TOOLS) {
      expect([name, name in tools]).toEqual([name, true]);
    }
  });

  it("still withholds them when the attached connector doesn't allow writes", async () => {
    const stationId = await seedStation(false);
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      ownerId,
      generateId()
    );
    for (const name of WRITE_TOOLS) {
      expect([name, name in tools]).toEqual([name, false]);
    }
  });

  it("#827: writes to an entity the station reaches only through a view", async () => {
    const instanceId = await seedInstance(true);
    const entityId = await seedEntity(instanceId);
    const stationId = await seedBareStation("View-only station");
    await attachCuratedView(d as never, {
      stationId,
      organizationId: orgId,
      connectorEntityId: entityId,
      key: `view_${generateId().slice(0, 8)}`,
      label: "View",
      createdBy: ownerId,
    });

    const result = await run(stationId, "entity_record_create", {
      items: [{ connectorEntityId: entityId, data: { name: "Probe" } }],
    });
    expect([JSON.stringify(result), result.success]).toEqual([
      JSON.stringify(result),
      true,
    ]);
    expect(await recordCount(entityId)).toBe(1);
  });

  it("#827: still refuses an entity the station reaches neither way", async () => {
    const viewed = await seedEntity(await seedInstance(true));
    const far = await seedEntity(await seedInstance(true));
    const stationId = await seedBareStation("View-only station");
    await attachCuratedView(d as never, {
      stationId,
      organizationId: orgId,
      connectorEntityId: viewed,
      key: `view_${generateId().slice(0, 8)}`,
      label: "View",
      createdBy: ownerId,
    });

    const result = await run(stationId, "entity_record_create", {
      items: [{ connectorEntityId: far, data: { name: "Probe" } }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain(
      "does not belong to an instance attached to this station"
    );
    expect(await recordCount(far)).toBe(0);
  });
});
