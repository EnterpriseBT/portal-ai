/**
 * Fully-populated organization fixture — one org touching every
 * org-scoped table, plus a real `er__<entityId>` wide table via the
 * reconciler.
 *
 * Shared by the two whole-org cascade tests (#197's
 * `OrganizationDeleteService`, #295's `ResetService`) because both are
 * only as good as the fixture is complete: an org that avoids a table is
 * an org whose cascade gap the test can't see. When a new
 * `organizationId`-scoped table lands, extend this fixture AND both
 * cascades, or the tests prove less than they claim.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";

import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
} from "./application.util.js";

type Db = ReturnType<typeof drizzle>;

export interface PopulatedOrg {
  orgId: string;
  orgName: string;
  ownerUserId: string;
  memberUserId: string;
  stationId: string;
  portalId: string;
  connectorInstanceId: string;
  connectorEntityId: string;
  s3Key: string;
  pendingJobId: string;
  completedJobId: string;
}

function base(now: number) {
  return {
    id: generateId(),
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

/**
 * Seed one organization touching every org-scoped table, plus a real
 * `er__<entityId>` wide table via the reconciler.
 */
export async function seedPopulatedOrg(
  db: Db,
  suffix: string,
  opts: { pendingJobStatus?: "pending" | "active" } = {}
): Promise<PopulatedOrg> {
  const now = Date.now();

  const owner = createUser(`auth0|owner-${suffix}-${generateId()}`);
  await db.insert(schema.users).values(owner as never);
  const member = createUser(`auth0|member-${suffix}-${generateId()}`);
  await db.insert(schema.users).values(member as never);

  const org = createOrganization(owner.id, { name: `Org ${suffix}` });
  await db.insert(schema.organizations).values(org as never);
  await db
    .insert(schema.organizationUsers)
    .values(createOrganizationUser(org.id, owner.id) as never);
  await db
    .insert(schema.organizationUsers)
    .values(createOrganizationUser(org.id, member.id) as never);

  const connDef = {
    ...base(now),
    slug: `test-conn-${suffix}-${generateId().slice(0, 8)}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: {},
    capabilityFlags: { sync: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
  };
  await db.insert(schema.connectorDefinitions).values(connDef as never);

  const station = { ...base(now), organizationId: org.id, name: "Station" };
  await db.insert(schema.stations).values(station as never);
  await db
    .update(schema.organizations)
    .set({ defaultStationId: station.id })
    .where(eq(schema.organizations.id, org.id));

  const portal = {
    ...base(now),
    organizationId: org.id,
    stationId: station.id,
    name: "Portal",
  };
  await db.insert(schema.portals).values(portal as never);
  await db.insert(schema.portalMessages).values({
    ...base(now),
    portalId: portal.id,
    organizationId: org.id,
    role: "user",
    blocks: [],
  } as never);
  await db.insert(schema.portalResults).values({
    ...base(now),
    organizationId: org.id,
    stationId: station.id,
    portalId: portal.id,
    name: "Result",
    type: "text",
    content: {},
  } as never);

  const instance = {
    ...base(now),
    connectorDefinitionId: connDef.id,
    organizationId: org.id,
    name: "Instance",
    status: "active",
    config: {},
    credentials: null,
  };
  await db.insert(schema.connectorInstances).values(instance as never);

  const entity = {
    ...base(now),
    organizationId: org.id,
    connectorInstanceId: instance.id,
    key: "contacts",
    label: "Contacts",
  };
  await db.insert(schema.connectorEntities).values(entity as never);

  const columnDef = {
    ...base(now),
    organizationId: org.id,
    key: "email",
    label: "Email",
    type: "string",
  };
  await db.insert(schema.columnDefinitions).values(columnDef as never);

  const mapping = {
    ...base(now),
    organizationId: org.id,
    connectorEntityId: entity.id,
    columnDefinitionId: columnDef.id,
    sourceField: "email",
    isPrimaryKey: true,
    normalizedKey: "email",
    required: false,
  };
  await db.insert(schema.fieldMappings).values(mapping as never);

  await db.insert(schema.entityRecords).values({
    ...base(now),
    organizationId: org.id,
    connectorEntityId: entity.id,
    data: { email: "a@example.com" },
    sourceId: "r-1",
    checksum: "sum",
    syncedAt: now,
    origin: "manual",
    isValid: true,
  } as never);

  await db.insert(schema.connectorInstanceLayoutPlans).values({
    ...base(now),
    connectorInstanceId: instance.id,
    planVersion: "v1",
    plan: {},
  } as never);

  const group = { ...base(now), organizationId: org.id, name: "People" };
  await db.insert(schema.entityGroups).values(group as never);
  await db.insert(schema.entityGroupMembers).values({
    ...base(now),
    organizationId: org.id,
    entityGroupId: group.id,
    connectorEntityId: entity.id,
    linkFieldMappingId: mapping.id,
    isPrimary: true,
  } as never);

  const tag = { ...base(now), organizationId: org.id, name: "VIP" };
  await db.insert(schema.entityTags).values(tag as never);
  await db.insert(schema.entityTagAssignments).values({
    ...base(now),
    organizationId: org.id,
    connectorEntityId: entity.id,
    entityTagId: tag.id,
  } as never);

  await db.insert(schema.stationToolpacks).values({
    ...base(now),
    stationId: station.id,
    builtinSlug: "web",
    organizationToolpackId: null,
  } as never);
  await db.insert(schema.stationInstances).values({
    ...base(now),
    stationId: station.id,
    connectorInstanceId: instance.id,
  } as never);

  await db.insert(schema.organizationToolpacks).values({
    ...base(now),
    organizationId: org.id,
    name: `Custom Pack ${suffix}`,
    endpoints: [],
    signingSecret: "secret",
    tools: [],
    schemaFetchedAt: now,
  } as never);

  await db.insert(schema.apiEndpointConfigs).values({
    ...base(now),
    organizationId: org.id,
    connectorEntityId: entity.id,
    path: "/contacts",
    method: "GET",
    pagination: "none",
  } as never);

  const s3Key = `uploads/${suffix}/${generateId()}.csv`;
  await db.insert(schema.fileUploads).values({
    ...base(now),
    organizationId: org.id,
    filename: "contacts.csv",
    s3Key,
    status: "uploaded",
  } as never);

  await db.insert(schema.usage).values({
    ...base(now),
    organizationId: org.id,
    periodId: "2026-07",
    costClass: "metered",
    unitsUsed: 5,
  } as never);

  // #179: the per-call itemization behind the aggregate — retained on
  // delete exactly like `usage`.
  await db.insert(schema.toolUsageLedger).values({
    ...base(now),
    organizationId: org.id,
    toolName: "web_search",
    toolCallId: `call-${suffix}`,
    stationId: station.id,
    portalId: null,
    costClass: "metered",
    units: 5,
    periodId: "2026-07",
    userId: owner.id,
  } as never);

  const pendingJob = {
    ...base(now),
    organizationId: org.id,
    type: "connector_sync",
    status: opts.pendingJobStatus ?? "pending",
    progress: 0,
    metadata: { connectorInstanceId: instance.id },
    attempts: 0,
    maxAttempts: 3,
  };
  await db.insert(schema.jobs).values(pendingJob as never);
  const completedJob = {
    ...base(now),
    organizationId: org.id,
    type: "connector_sync",
    status: "completed",
    progress: 100,
    metadata: { connectorInstanceId: instance.id },
    attempts: 1,
    maxAttempts: 3,
  };
  await db.insert(schema.jobs).values(completedJob as never);

  await db.insert(schema.wideTableColumns).values({
    ...base(now),
    organizationId: org.id,
    connectorEntityId: entity.id,
    fieldMappingId: mapping.id,
    columnDefinitionId: columnDef.id,
    columnName: "c_email",
    pgType: "text",
  } as never);
  await wideTableReconcilerService.ensureTable(entity.id);

  return {
    orgId: org.id,
    orgName: org.name as string,
    ownerUserId: owner.id,
    memberUserId: member.id,
    stationId: station.id,
    portalId: portal.id,
    connectorInstanceId: instance.id,
    connectorEntityId: entity.id,
    s3Key,
    pendingJobId: pendingJob.id,
    completedJobId: completedJob.id,
  };
}

/** Is the entity's dynamic `er__<id>` table still in the schema? */
export async function wideTableExists(
  db: Db,
  entityId: string
): Promise<boolean> {
  const rows = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ${"er__" + entityId}
  `);
  return rows.length > 0;
}
