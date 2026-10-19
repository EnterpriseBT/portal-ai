/**
 * #825: the agent's create tools upserted. On an existing key they changed a
 * row the caller might not own, authorized only as "may create a row they'd
 * own", and reported it as created. A member could relabel the owner's entity
 * or remap the owner's field mapping. The tools now only create: an existing
 * key is refused, and the owner's rows are untouched. Tools are built exactly
 * as a portal session builds them, so every gate wraps them.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { ToolService } from "../../../services/tools.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
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
  created: 1_700_000_000_000,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

type Exec = (input: unknown) => Promise<Record<string, unknown>>;
const call = (tools: Record<string, unknown>, name: string): Exec => {
  const t = tools[name] as {
    execute: (
      input: unknown,
      opts: unknown
    ) => Promise<Record<string, unknown>>;
  };
  return (input) =>
    t.execute(input, {
      toolCallId: "t",
      messages: [],
      abortSignal: new AbortController().signal,
    });
};

describe("agent create on an existing key (#825)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let stationId: string;
  let instanceId: string;
  let entityId: string;
  let mappingId: string;
  let colDefId: string;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 2 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);

    const owner = createUser(`auth0|owner-${generateId()}`);
    const member = createUser(`auth0|member-${generateId()}`);
    await d.insert(schema.users).values([owner, member] as never);
    ownerId = owner.id;
    memberId = member.id;
    const org = createOrganization(owner.id);
    await d.insert(schema.organizations).values(org as never);
    orgId = org.id;
    const tierSlug = `ace-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base("AGENT_CREATE_EXISTING_TEST"),
      slug: tierSlug,
      displayName: "Agent create existing-key test",
      builtinToolpacks: ["entity_management"],
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: tierSlug })
      .where(eq(schema.organizations.id, orgId));
    await seedRbacForOrg(d as never, orgId);
    await d
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(orgId, ownerId, { role: "owner", lastLogin: 0 }),
        createOrganizationUser(orgId, memberId, { role: "member" }),
      ] as never);

    const defId = generateId();
    await d.insert(schema.connectorDefinitions).values({
      id: defId,
      slug: `cd-${defId.slice(0, 8)}`,
      display: "Sandbox",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: false },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    instanceId = generateId();
    await d.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: "Sandbox",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: false },
      ...base(ownerId),
    } as never);

    // The owner's entity and its `name` mapping.
    entityId = generateId();
    await d.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: "widgets",
      label: "Widgets",
      ...base(ownerId),
    } as never);
    colDefId = generateId();
    await d.insert(schema.columnDefinitions).values({
      id: colDefId,
      organizationId: orgId,
      key: "name",
      label: "Name",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(ownerId),
    } as never);
    mappingId = generateId();
    await d.insert(schema.fieldMappings).values({
      id: mappingId,
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colDefId,
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

    // A station that reaches Sandbox directly and through a view, so the
    // entity write tools are offered.
    stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Agent station",
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instanceId,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "entity_management",
      organizationToolpackId: null,
      ...base(ownerId),
    } as never);
    await attachCuratedView(d as never, {
      stationId,
      organizationId: orgId,
      connectorEntityId: entityId,
      key: "widgets_view",
      label: "Widgets view",
      createdBy: ownerId,
    });
  });

  afterEach(async () => {
    await teardownOrg(d);
    await d
      .delete(schema.tiers)
      .where(eq(schema.tiers.createdBy, "AGENT_CREATE_EXISTING_TEST"));
    await connection.end();
  });

  const memberTools = () =>
    ToolService.buildAnalyticsTools(orgId, stationId, memberId, generateId());

  const entityRow = async () =>
    (
      await d
        .select()
        .from(schema.connectorEntities)
        .where(eq(schema.connectorEntities.id, entityId))
    )[0];
  const mappingRow = async () =>
    (
      await d
        .select()
        .from(schema.fieldMappings)
        .where(eq(schema.fieldMappings.id, mappingId))
    )[0];

  it("a member's create on the owner's entity key is refused and leaves the owner's row unchanged", async () => {
    const before = await entityRow();
    const tools = await memberTools();
    expect("connector_entity_create" in tools).toBe(true);

    const result = await call(
      tools,
      "connector_entity_create"
    )({
      items: [
        {
          connectorInstanceId: instanceId,
          key: "widgets",
          label: "Relabelled by member",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toMatch(/already exists/i);
    expect(JSON.stringify(result)).not.toContain(entityId);
    expect(await entityRow()).toEqual(before);
  });

  it("a member's create on the owner's mapping key is refused and leaves the owner's mapping unchanged", async () => {
    const before = await mappingRow();
    const tools = await memberTools();

    const result = await call(
      tools,
      "field_mapping_create"
    )({
      items: [
        {
          connectorEntityId: entityId,
          columnDefinitionId: colDefId,
          sourceField: "hijacked_source",
          normalizedKey: "name",
          isPrimaryKey: true,
        },
      ],
    });

    expect(JSON.stringify(result)).not.toMatch(/"success":true/);
    expect(await mappingRow()).toEqual(before);
  });

  it("a new key still creates, owned by the member", async () => {
    const tools = await memberTools();
    const result = await call(
      tools,
      "connector_entity_create"
    )({
      items: [
        { connectorInstanceId: instanceId, key: "gadgets", label: "Gadgets" },
      ],
    });
    expect(result.success).toBe(true);
    const [row] = await d
      .select()
      .from(schema.connectorEntities)
      .where(eq(schema.connectorEntities.key, "gadgets"));
    expect(row?.createdBy).toBe(memberId);
  });
});
