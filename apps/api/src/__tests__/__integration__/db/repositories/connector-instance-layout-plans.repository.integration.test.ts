/**
 * Integration tests for the ConnectorInstanceLayoutPlansRepository.
 *
 * Tests run against the postgres-test container with the Phase 6 migration
 * applied by globalSetup.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { LayoutPlan } from "@portalai/core/contracts";

import { ConnectorInstanceLayoutPlansRepository } from "../../../../db/repositories/connector-instance-layout-plans.repository.js";
import { ConnectorInstancesRepository } from "../../../../db/repositories/connector-instances.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type {
  ConnectorInstanceLayoutPlanInsert,
  ConnectorInstanceSelect,
} from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

type Db = ReturnType<typeof drizzle>;

function makeLayoutPlan(overrides: Partial<LayoutPlan> = {}): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Sheet1"],
      dimensions: { Sheet1: { rows: 2, cols: 2 } },
      anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "name" }],
    },
    regions: [
      {
        id: "r1",
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [{ kind: "field", positionCount: 2 }],
        },
        headerStrategyByAxis: {
          row: {
            kind: "row",
            locator: { kind: "row", sheet: "Sheet1", row: 1 },
            confidence: 0.9,
          },
        },
        identityStrategy: { kind: "rowPosition", confidence: 0.3 },
        columnBindings: [],
        skipRules: [],
        drift: {
          headerShiftRows: 0,
          addedColumns: "halt",
          removedColumns: { max: 0, action: "halt" },
        },
        confidence: { region: 0.9, aggregate: 0.9 },
        warnings: [],
      },
    ],
    confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
    ...overrides,
  };
}

describe("ConnectorInstanceLayoutPlansRepository", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: ConnectorInstanceLayoutPlansRepository;
  let connectorInstancesRepo: ConnectorInstancesRepository;
  let orgId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new ConnectorInstanceLayoutPlansRepository();
    connectorInstancesRepo = new ConnectorInstancesRepository();

    await teardownOrg(db as Db);

    const user = createUser(`auth0|${generateId()}`);
    await (db as Db).insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await (db as Db).insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connectorDefId = generateId();
    await (db as Db).insert(schema.connectorDefinitions).values({
      id: connectorDefId,
      slug: `file-upload-${generateId().slice(0, 8)}`,
      display: "File Upload",
      category: "file",
      authType: "none",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const ci: ConnectorInstanceSelect = {
      id: generateId(),
      organizationId: orgId,
      connectorDefinitionId: connectorDefId,
      name: "Test File Upload Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as ConnectorInstanceSelect;
    await (db as Db).insert(schema.connectorInstances).values(ci as never);
    connectorInstanceId = ci.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  function makePlanRow(
    overrides: Partial<ConnectorInstanceLayoutPlanInsert> = {}
  ): ConnectorInstanceLayoutPlanInsert {
    const now = Date.now();
    return {
      id: generateId(),
      connectorInstanceId,
      planVersion: "1.0.0",
      revisionTag: null,
      plan: makeLayoutPlan(),
      interpretationTrace: null,
      supersededBy: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as ConnectorInstanceLayoutPlanInsert;
  }

  describe("create + findById", () => {
    it("persists a plan row and round-trips the full LayoutPlan JSONB", async () => {
      const row = makePlanRow();
      const created = await repo.create(row, db);

      expect(created.id).toBe(row.id);
      expect(created.connectorInstanceId).toBe(connectorInstanceId);
      expect(created.planVersion).toBe("1.0.0");
      expect(created.plan.regions).toHaveLength(1);
      expect(created.plan.regions[0].targetEntityDefinitionId).toBe("contacts");

      const fetched = await repo.findById(row.id, db);
      expect(fetched).toBeDefined();
      expect(fetched?.plan).toEqual(row.plan);
    });

    it("accepts null interpretationTrace + revisionTag", async () => {
      const row = makePlanRow();
      const created = await repo.create(row, db);
      expect(created.interpretationTrace).toBeNull();
      expect(created.revisionTag).toBeNull();
    });
  });

  describe("soft-delete", () => {
    it("hides soft-deleted plans from findMany", async () => {
      const row = makePlanRow();
      await repo.create(row, db);
      await repo.softDelete(row.id, "SYSTEM_TEST", db);

      const all = await repo.findMany(undefined, {}, db);
      expect(all.find((r) => r.id === row.id)).toBeUndefined();
    });
  });

  describe("findCurrentByConnectorInstanceId", () => {
    it("returns the sole plan when supersededBy is null", async () => {
      const row = makePlanRow();
      await repo.create(row, db);
      const current = await repo.findCurrentByConnectorInstanceId(
        connectorInstanceId,
        db
      );
      expect(current?.id).toBe(row.id);
    });

    it("skips superseded plans and returns the current one", async () => {
      const older = await repo.create(makePlanRow(), db);
      const newer = await repo.create(makePlanRow(), db);
      await repo.supersede(older.id, newer.id, "SYSTEM_TEST", db);

      const current = await repo.findCurrentByConnectorInstanceId(
        connectorInstanceId,
        db
      );
      expect(current?.id).toBe(newer.id);
    });

    it("returns undefined when no plan exists for the instance", async () => {
      const current = await repo.findCurrentByConnectorInstanceId(
        connectorInstanceId,
        db
      );
      expect(current).toBeUndefined();
    });
  });

  describe("supersede", () => {
    it("sets supersededBy and bumps updated/updatedBy on the old row", async () => {
      const older = await repo.create(makePlanRow(), db);
      const newer = await repo.create(makePlanRow(), db);
      const before = Date.now();
      const result = await repo.supersede(
        older.id,
        newer.id,
        "SYSTEM_TEST",
        db
      );

      expect(result?.supersededBy).toBe(newer.id);
      expect(result?.updatedBy).toBe("SYSTEM_TEST");
      expect((result?.updated ?? 0) >= before).toBe(true);
    });

    it("is a no-op on already-soft-deleted rows", async () => {
      const older = await repo.create(makePlanRow(), db);
      const newer = await repo.create(makePlanRow(), db);
      await repo.softDelete(older.id, "SYSTEM_TEST", db);
      const result = await repo.supersede(
        older.id,
        newer.id,
        "SYSTEM_TEST",
        db
      );
      expect(result).toBeUndefined();
    });
  });

  describe("connectorInstances soft-delete cascade", () => {
    it("soft-deletes layout plans when the parent connector instance is soft-deleted", async () => {
      const planA = await repo.create(makePlanRow(), db);
      const planB = await repo.create(makePlanRow(), db);
      expect(planA.deleted).toBeNull();
      expect(planB.deleted).toBeNull();

      await connectorInstancesRepo.softDelete(
        connectorInstanceId,
        "SYSTEM_TEST",
        db
      );

      const [rowA] = await (db as Db)
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(eq(schema.connectorInstanceLayoutPlans.id, planA.id));
      const [rowB] = await (db as Db)
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(eq(schema.connectorInstanceLayoutPlans.id, planB.id));

      expect(rowA.deleted).not.toBeNull();
      expect(rowA.deletedBy).toBe("SYSTEM_TEST");
      expect(rowB.deleted).not.toBeNull();
      expect(rowB.deletedBy).toBe("SYSTEM_TEST");
    });

    it("softDeleteMany cascades to all referenced layout plans", async () => {
      const planA = await repo.create(makePlanRow(), db);
      await connectorInstancesRepo.softDeleteMany(
        [connectorInstanceId],
        "SYSTEM_TEST",
        db
      );
      const [rowA] = await (db as Db)
        .select()
        .from(schema.connectorInstanceLayoutPlans)
        .where(eq(schema.connectorInstanceLayoutPlans.id, planA.id));
      expect(rowA.deleted).not.toBeNull();
    });
  });
});
