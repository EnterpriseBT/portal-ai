/**
 * #824: a station with no attached curated views lost every agent write
 * tool, though its attached connector allowed writes: the write gate derived
 * the station's connectors from its views only (#599), while the tools
 * themselves scope by the connectors attached to the station directly. Tools
 * are built here exactly as a portal session builds them.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { ToolService } from "../../../services/tools.service.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
  seedRbacForOrg,
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

  /** A station with the entity pack and one connector attached directly, no views. */
  async function seedStation(instanceWrite: boolean) {
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
});
