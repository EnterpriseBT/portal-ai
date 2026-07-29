/**
 * Integration tests for ResetService (#295).
 *
 * The bug this guards: reset deleted 17 tables child → parent but never
 * `wide_table_columns`, `api_endpoint_configs` or
 * `connector_instance_layout_plans` — each of which holds an FK into one
 * of those 17 — and never dropped the `er__<entityId>` wide tables whose
 * owning `connector_entities` rows it deleted. Reset therefore failed on
 * a foreign key for any org that had actually been used, and orphaned
 * wide tables when it didn't.
 *
 * Seeds through the same fully-populated fixture the org-delete cascade
 * uses (an org simple enough to dodge those three FKs is an org that
 * proves nothing), then asserts reset completes AND stops where it is
 * supposed to: org row, owner membership, the system column definitions
 * and a control org all survive.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { ResetService } from "../../../services/reset.service.js";
import * as schema from "../../../db/schema/index.js";
import { teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  wideTableExists,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

type Db = ReturnType<typeof drizzle>;

describe("ResetService integration tests (#295)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let target!: PopulatedOrg;
  let control!: PopulatedOrg;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  describe("resetting a fully-populated org", () => {
    beforeAll(async () => {
      await teardownOrg(db);
      target = await seedPopulatedOrg(db, "reset-target");
      control = await seedPopulatedOrg(db, "reset-control");
      await ResetService.resetOrganization(target.orgId);
    });

    it("completes instead of aborting on a foreign key (case 1)", async () => {
      // Reaching beforeAll's end at all is the assertion; re-running it
      // against the now-empty org proves it is also idempotent.
      await expect(
        ResetService.resetOrganization(target.orgId)
      ).resolves.toBeUndefined();
    });

    it("deletes the three tables that used to block it (case 2)", async () => {
      const wideCols = await db
        .select()
        .from(schema.wideTableColumns)
        .where(eq(schema.wideTableColumns.organizationId, target.orgId));
      expect(wideCols).toHaveLength(0);

      const endpointConfigs = await db
        .select()
        .from(schema.apiEndpointConfigs)
        .where(eq(schema.apiEndpointConfigs.organizationId, target.orgId));
      expect(endpointConfigs).toHaveLength(0);

      const layoutPlans = await db
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(
          eq(
            schema.connectorInstanceLayoutPlans.connectorInstanceId,
            target.connectorInstanceId
          )
        );
      expect(layoutPlans).toHaveLength(0);
    });

    it("drops the entity's er__ wide table (case 3)", async () => {
      expect(await wideTableExists(db, target.connectorEntityId)).toBe(false);
    });

    it("clears the org's workspace content (case 4)", async () => {
      const counts = await Promise.all([
        db
          .select()
          .from(schema.entityRecords)
          .where(eq(schema.entityRecords.organizationId, target.orgId)),
        db
          .select()
          .from(schema.fieldMappings)
          .where(eq(schema.fieldMappings.organizationId, target.orgId)),
        db
          .select()
          .from(schema.connectorEntities)
          .where(eq(schema.connectorEntities.organizationId, target.orgId)),
        db
          .select()
          .from(schema.connectorInstances)
          .where(eq(schema.connectorInstances.organizationId, target.orgId)),
        db
          .select()
          .from(schema.stations)
          .where(eq(schema.stations.organizationId, target.orgId)),
        db
          .select()
          .from(schema.portals)
          .where(eq(schema.portals.organizationId, target.orgId)),
        db
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.organizationId, target.orgId)),
      ]);
      for (const rows of counts) expect(rows).toHaveLength(0);
    });

    it("hands back an org that still has its system column definitions (case 5)", async () => {
      // Found in the #295 smoke walk: reset deleted every
      // column_definition, including the `system: true` rows
      // ApplicationService seeds at provisioning
      // (application.service.ts:271) — so a reset org was missing
      // scaffolding a fresh org has, a state the app never otherwise
      // produces.
      const colDefs = await db
        .select()
        .from(schema.columnDefinitions)
        .where(eq(schema.columnDefinitions.organizationId, target.orgId));

      expect(colDefs.length).toBeGreaterThan(0);
      expect(colDefs.every((c) => c.system)).toBe(true);
    });

    it("leaves no org-authored column definitions behind (case 5b)", async () => {
      const colDefs = await db
        .select()
        .from(schema.columnDefinitions)
        .where(
          and(
            eq(schema.columnDefinitions.organizationId, target.orgId),
            eq(schema.columnDefinitions.system, false)
          )
        );
      expect(colDefs).toHaveLength(0);
    });

    it("keeps the org row and nulls its default station (case 6)", async () => {
      const [org] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, target.orgId));
      expect(org).toBeDefined();
      expect(org.deleted).toBeNull();
      expect(org.defaultStationId).toBeNull();
    });

    it("keeps the owner's membership and drops the rest (case 7)", async () => {
      const members = await db
        .select()
        .from(schema.organizationUsers)
        .where(
          and(
            eq(schema.organizationUsers.organizationId, target.orgId),
            isNull(schema.organizationUsers.deleted)
          )
        );
      expect(members.map((m) => m.userId)).toEqual([target.ownerUserId]);
    });

    it("leaves the control org fully intact (case 8)", async () => {
      const [org] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, control.orgId));
      expect(org.defaultStationId).toBe(control.stationId);

      const wideCols = await db
        .select()
        .from(schema.wideTableColumns)
        .where(eq(schema.wideTableColumns.organizationId, control.orgId));
      expect(wideCols).toHaveLength(1);

      const endpointConfigs = await db
        .select()
        .from(schema.apiEndpointConfigs)
        .where(eq(schema.apiEndpointConfigs.organizationId, control.orgId));
      expect(endpointConfigs).toHaveLength(1);

      const layoutPlans = await db
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(
          eq(
            schema.connectorInstanceLayoutPlans.connectorInstanceId,
            control.connectorInstanceId
          )
        );
      expect(layoutPlans).toHaveLength(1);

      expect(await wideTableExists(db, control.connectorEntityId)).toBe(true);

      // The re-seed is org-scoped: the control org's own (non-system)
      // column definition is untouched.
      const colDefs = await db
        .select()
        .from(schema.columnDefinitions)
        .where(eq(schema.columnDefinitions.organizationId, control.orgId));
      expect(colDefs).toHaveLength(1);
      expect(colDefs[0].system).toBe(false);

      const members = await db
        .select()
        .from(schema.organizationUsers)
        .where(eq(schema.organizationUsers.organizationId, control.orgId));
      expect(members).toHaveLength(2);
    });
  });

  describe("resetFirst", () => {
    beforeEach(async () => {
      await teardownOrg(db);
    });

    it("throws when there are no organizations", async () => {
      await expect(ResetService.resetFirst()).rejects.toThrow(
        "No organizations found in the database"
      );
    });

    it("resets the first org it finds", async () => {
      const only = await seedPopulatedOrg(db, "reset-first");
      await ResetService.resetFirst();

      const records = await db
        .select()
        .from(schema.entityRecords)
        .where(eq(schema.entityRecords.organizationId, only.orgId));
      expect(records).toHaveLength(0);
      expect(await wideTableExists(db, only.connectorEntityId)).toBe(false);
    });
  });

  describe("an org whose entities were already soft-deleted", () => {
    it("still clears their catalog rows (case 9)", async () => {
      await teardownOrg(db);
      const org = await seedPopulatedOrg(db, "reset-soft-deleted");
      await db
        .update(schema.connectorEntities)
        .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" })
        .where(inArray(schema.connectorEntities.id, [org.connectorEntityId]));

      await expect(
        ResetService.resetOrganization(org.orgId)
      ).resolves.toBeUndefined();

      const wideCols = await db
        .select()
        .from(schema.wideTableColumns)
        .where(eq(schema.wideTableColumns.organizationId, org.orgId));
      expect(wideCols).toHaveLength(0);
    });
  });
});
