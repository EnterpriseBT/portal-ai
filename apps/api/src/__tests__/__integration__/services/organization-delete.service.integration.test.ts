/**
 * Integration tests for OrganizationDeleteService (#197).
 *
 * Seeds a fully-populated organization (every org-scoped table plus a real
 * `er__*` wide table) alongside an identically-shaped control org, runs the
 * delete, then asserts the tombstone-hybrid contract: content hard-purged,
 * org + memberships soft-deleted, `usage` retained, control org untouched.
 *
 * Fixture-maintenance note: the "content tables are empty" loop below is the
 * guard against future cascade gaps — when a new `organizationId`-scoped
 * table lands, extend BOTH `seedPopulatedOrg` and the cascade in
 * `organization-delete.service.ts`, or the loop proves less than it claims.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";

import { OrganizationDeleteService } from "../../../services/organization-delete.service.js";
import { JobsService } from "../../../services/jobs.service.js";
import { S3Service } from "../../../services/s3.service.js";
import { StripeService } from "../../../services/stripe.service.js";
import { DbService } from "../../../services/db.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
} from "../utils/application.util.js";

type Db = ReturnType<typeof drizzle>;

// ── Fixture ──────────────────────────────────────────────────────────

interface PopulatedOrg {
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
async function seedPopulatedOrg(
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

async function wideTableExists(db: Db, entityId: string): Promise<boolean> {
  const rows = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ${"er__" + entityId}
  `);
  return rows.length > 0;
}

function spyCancelAsDbTransition(db: Db) {
  return jest
    .spyOn(JobsService, "cancel")
    .mockImplementation(async (jobId: string) => {
      await db
        .update(schema.jobs)
        .set({ status: "cancelled" })
        .where(eq(schema.jobs.id, jobId));
      return {} as never;
    });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OrganizationDeleteService integration tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    await connection.end();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe("after a successful delete", () => {
    let target!: PopulatedOrg;
    let control!: PopulatedOrg;
    let cancelSpy!: ReturnType<typeof spyCancelAsDbTransition>;
    let s3Spy!: ReturnType<typeof jest.spyOn>;

    beforeAll(async () => {
      await teardownOrg(db);
      target = await seedPopulatedOrg(db, "target");
      control = await seedPopulatedOrg(db, "control");

      cancelSpy = spyCancelAsDbTransition(db);
      s3Spy = jest
        .spyOn(S3Service, "deleteObject")
        .mockResolvedValue(undefined as never);

      await OrganizationDeleteService.deleteOrganization(
        target.orgId,
        target.ownerUserId
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      for (const id of [target.connectorEntityId, control.connectorEntityId]) {
        await wideTableReconcilerService.dropTable(id, db as DbClient);
      }
      await teardownOrg(db);
    });

    it("hard-deletes every org-scoped content table (case 3)", async () => {
      const byOrg: Array<[string, { organizationId: unknown }]> = [
        ["entity_group_members", schema.entityGroupMembers],
        ["entity_tag_assignments", schema.entityTagAssignments],
        ["entity_records", schema.entityRecords],
        ["field_mappings", schema.fieldMappings],
        ["portal_results", schema.portalResults],
        ["portal_messages", schema.portalMessages],
        ["portals", schema.portals],
        ["stations", schema.stations],
        ["connector_entities", schema.connectorEntities],
        ["connector_instances", schema.connectorInstances],
        ["entity_groups", schema.entityGroups],
        ["entity_tags", schema.entityTags],
        ["column_definitions", schema.columnDefinitions],
        ["wide_table_columns", schema.wideTableColumns],
        ["api_endpoint_configs", schema.apiEndpointConfigs],
        ["organization_toolpacks", schema.organizationToolpacks],
        ["file_uploads", schema.fileUploads],
        ["jobs", schema.jobs],
      ] as never;
      for (const [name, table] of byOrg) {
        const rows = await db
          .select()
          .from(table as never)
          .where(
            eq(
              (table as { organizationId: never }).organizationId,
              target.orgId as never
            )
          );
        expect({ table: name, count: rows.length }).toEqual({
          table: name,
          count: 0,
        });
      }

      // Indirectly-scoped tables, addressed by their parent ids.
      const stationToolpackRows = await db
        .select()
        .from(schema.stationToolpacks)
        .where(eq(schema.stationToolpacks.stationId, target.stationId));
      expect(stationToolpackRows).toHaveLength(0);
      const stationInstanceRows = await db
        .select()
        .from(schema.stationInstances)
        .where(eq(schema.stationInstances.stationId, target.stationId));
      expect(stationInstanceRows).toHaveLength(0);
      const planRows = await db
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(
          eq(
            schema.connectorInstanceLayoutPlans.connectorInstanceId,
            target.connectorInstanceId
          )
        );
      expect(planRows).toHaveLength(0);
    });

    it("drops the er__ wide table and its catalog rows (case 4)", async () => {
      expect(await wideTableExists(db, target.connectorEntityId)).toBe(false);
      const catalogRows = await db
        .select()
        .from(schema.wideTableColumns)
        .where(eq(schema.wideTableColumns.organizationId, target.orgId));
      expect(catalogRows).toHaveLength(0);
    });

    it("retains the usage ledger untouched (case 5)", async () => {
      const rows = await db
        .select()
        .from(schema.usage)
        .where(eq(schema.usage.organizationId, target.orgId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.unitsUsed).toBe(5);
      expect(rows[0]!.deleted).toBeNull();
    });

    // #179 case 18 — the per-call itemization survives the cascade too.
    it("retains tool_usage_ledger rows untouched (#179 case 18)", async () => {
      const rows = await db
        .select()
        .from(schema.toolUsageLedger)
        .where(eq(schema.toolUsageLedger.organizationId, target.orgId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.units).toBe(5);
      expect(rows[0]!.deleted).toBeNull();
    });

    it("soft-deletes the organization row with the actor stamped (case 6)", async () => {
      const [row] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(row).toBeDefined();
      expect(row!.deleted).not.toBeNull();
      expect(row!.deletedBy).toBe(target.ownerUserId);
      // defaultStationId was nulled before its station was deleted (case 10).
      expect(row!.defaultStationId).toBeNull();

      const viaRepo = await DbService.repository.organizations.findById(
        target.orgId
      );
      expect(viaRepo).toBeUndefined();
    });

    it("soft-deletes every membership, owner included (case 7)", async () => {
      const rows = await db
        .select()
        .from(schema.organizationUsers)
        .where(eq(schema.organizationUsers.organizationId, target.orgId));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.deleted).not.toBeNull();
        expect(row.deletedBy).toBe(target.ownerUserId);
      }
    });

    it("leaves the control org fully intact (case 8)", async () => {
      const [controlOrg] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, control.orgId));
      expect(controlOrg!.deleted).toBeNull();

      const controlStations = await db
        .select()
        .from(schema.stations)
        .where(eq(schema.stations.organizationId, control.orgId));
      expect(controlStations).toHaveLength(1);
      const controlRecords = await db
        .select()
        .from(schema.entityRecords)
        .where(eq(schema.entityRecords.organizationId, control.orgId));
      expect(controlRecords).toHaveLength(1);
      const controlUploads = await db
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.organizationId, control.orgId));
      expect(controlUploads).toHaveLength(1);
      const controlMemberships = await db
        .select()
        .from(schema.organizationUsers)
        .where(
          and(
            eq(schema.organizationUsers.organizationId, control.orgId),
            sql`${schema.organizationUsers.deleted} IS NULL`
          )
        );
      expect(controlMemberships).toHaveLength(2);
      expect(await wideTableExists(db, control.connectorEntityId)).toBe(true);
    });

    it("cancelled the queued job before deleting (case 9, happy half)", () => {
      expect(cancelSpy).toHaveBeenCalledWith(target.pendingJobId);
      expect(cancelSpy).not.toHaveBeenCalledWith(target.completedJobId);
    });

    it("deleted the S3 object for each collected upload key (case 11, happy half)", () => {
      expect(s3Spy).toHaveBeenCalledTimes(1);
      expect(s3Spy).toHaveBeenCalledWith(target.s3Key);
    });
  });

  describe("with an active job", () => {
    let target!: PopulatedOrg;

    beforeAll(async () => {
      await teardownOrg(db);
      target = await seedPopulatedOrg(db, "locked", {
        pendingJobStatus: "active",
      });
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await wideTableReconcilerService.dropTable(
        target.connectorEntityId,
        db as DbClient
      );
      await teardownOrg(db);
    });

    it("throws 409 ENTITY_LOCKED_BY_JOB and deletes nothing (case 9, blocking half)", async () => {
      const cancelSpy = spyCancelAsDbTransition(db);
      const s3Spy = jest
        .spyOn(S3Service, "deleteObject")
        .mockResolvedValue(undefined as never);

      let thrown: unknown;
      try {
        await OrganizationDeleteService.deleteOrganization(
          target.orgId,
          target.ownerUserId
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ApiError);
      const apiError = thrown as ApiError;
      expect(apiError.status).toBe(409);
      expect(apiError.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
      const runningJobs = apiError.details?.runningJobs as Array<{
        id: string;
        status: string;
      }>;
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0]!.id).toBe(target.pendingJobId);
      expect(runningJobs[0]!.status).toBe("active");

      // The active job must not have been cancelled, and nothing deleted.
      expect(cancelSpy).not.toHaveBeenCalledWith(target.pendingJobId);
      expect(s3Spy).not.toHaveBeenCalled();
      const [orgRow] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(orgRow!.deleted).toBeNull();
      const stationRows = await db
        .select()
        .from(schema.stations)
        .where(eq(schema.stations.organizationId, target.orgId));
      expect(stationRows).toHaveLength(1);
      expect(await wideTableExists(db, target.connectorEntityId)).toBe(true);
    });
  });

  describe("when S3 cleanup fails", () => {
    let target!: PopulatedOrg;

    beforeAll(async () => {
      await teardownOrg(db);
      target = await seedPopulatedOrg(db, "s3fail");
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await teardownOrg(db);
    });

    it("still commits the delete (case 11, failure half)", async () => {
      spyCancelAsDbTransition(db);
      jest
        .spyOn(S3Service, "deleteObject")
        .mockRejectedValue(new Error("s3 unavailable") as never);

      await expect(
        OrganizationDeleteService.deleteOrganization(
          target.orgId,
          target.ownerUserId
        )
      ).resolves.toBeUndefined();

      const [orgRow] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(orgRow!.deleted).not.toBeNull();
      const uploadRows = await db
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.organizationId, target.orgId));
      expect(uploadRows).toHaveLength(0);
    });
  });

  describe("Stripe subscription cancellation (#176 case 18)", () => {
    let target!: PopulatedOrg;
    let stripeCancelSpy!: ReturnType<typeof jest.spyOn>;

    beforeEach(async () => {
      await teardownOrg(db);
      target = await seedPopulatedOrg(db, "stripe");
      spyCancelAsDbTransition(db);
      jest
        .spyOn(S3Service, "deleteObject")
        .mockResolvedValue(undefined as never);
      stripeCancelSpy = jest
        .spyOn(StripeService, "cancelSubscription")
        .mockResolvedValue(undefined as never);
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await teardownOrg(db);
    });

    async function linkSubscription(id: string) {
      await db
        .update(schema.organizations)
        .set({ stripeCustomerId: `cus_${id}`, stripeSubscriptionId: id })
        .where(eq(schema.organizations.id, target.orgId));
    }

    it("cancels a live subscription after the cascade commits", async () => {
      await linkSubscription("sub_del_1");

      await OrganizationDeleteService.deleteOrganization(
        target.orgId,
        target.ownerUserId
      );

      expect(stripeCancelSpy).toHaveBeenCalledTimes(1);
      expect(stripeCancelSpy).toHaveBeenCalledWith("sub_del_1");
      // Cascade committed — the cancel ran post-commit, and the tombstone
      // keeps both Stripe ids.
      const [orgRow] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(orgRow!.deleted).not.toBeNull();
      expect(orgRow!.stripeSubscriptionId).toBe("sub_del_1");
      expect(orgRow!.stripeCustomerId).toBe("cus_sub_del_1");
    });

    it("a Stripe outage during cancel never blocks the delete (warn only)", async () => {
      await linkSubscription("sub_del_2");
      stripeCancelSpy.mockRejectedValue(new Error("stripe down") as never);

      await expect(
        OrganizationDeleteService.deleteOrganization(
          target.orgId,
          target.ownerUserId
        )
      ).resolves.toBeUndefined();

      const [orgRow] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(orgRow!.deleted).not.toBeNull();
    });

    it("makes no Stripe call for an unsubscribed org", async () => {
      await OrganizationDeleteService.deleteOrganization(
        target.orgId,
        target.ownerUserId
      );

      expect(stripeCancelSpy).not.toHaveBeenCalled();
    });
  });
});
