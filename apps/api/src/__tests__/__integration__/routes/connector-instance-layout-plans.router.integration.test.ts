import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type {
  InterpretResponsePayload,
  LayoutPlan,
  WorkbookData,
} from "@portalai/core/contracts";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-layout-plan-user";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

// Mock LayoutPlanInterpretService.analyze so we don't hit the LLM in integration tests.
const mockAnalyze = jest.fn<(...args: unknown[]) => Promise<LayoutPlan>>();
jest.unstable_mockModule("../../../services/layout-plan-interpret.service.js", () => ({
  LayoutPlanInterpretService: {
    analyze: mockAnalyze,
    loadCatalog: jest.fn(async () => []),
  },
}));

const { app } = await import("../../../app.js");

const {
  connectorInstances,
  connectorDefinitions,
  connectorInstanceLayoutPlans,
} = schema;

type Db = ReturnType<typeof drizzle>;

const now = Date.now();

function makeConnectorDefinition() {
  return {
    id: generateId(),
    slug: `file-upload-${generateId().slice(0, 8)}`,
    display: "File Upload",
    category: "file",
    authType: "none",
    configSchema: {},
    capabilityFlags: { sync: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function makeConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string
) {
  return {
    id: generateId(),
    connectorDefinitionId,
    organizationId,
    name: "Layout Plan Test Instance",
    status: "active" as const,
    config: null,
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

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

function makeWorkbook(): WorkbookData {
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 2, cols: 2 },
        cells: [
          { row: 1, col: 1, value: "name" },
          { row: 1, col: 2, value: "age" },
          { row: 2, col: 1, value: "alice" },
          { row: 2, col: 2, value: 30 },
        ],
      },
    ],
  };
}

describe("Connector Instance Layout Plans Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let organizationId: string;
  let userId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as Db);
    mockAnalyze.mockReset();
    mockAnalyze.mockResolvedValue(makeLayoutPlan());

    const seed = await seedUserAndOrg(db as Db, AUTH0_ID);
    organizationId = seed.organizationId;
    userId = seed.userId;

    const def = makeConnectorDefinition();
    await (db as Db).insert(connectorDefinitions).values(def as never);
    const inst = makeConnectorInstance(def.id, organizationId);
    await (db as Db).insert(connectorInstances).values(inst as never);
    connectorInstanceId = inst.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── POST /interpret ──────────────────────────────────────────────────

  describe("POST /api/connector-instances/:id/layout-plan/interpret", () => {
    it("interprets a workbook, persists the plan, and returns plan + trace", async () => {
      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook(), regionHints: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const payload = res.body.payload as InterpretResponsePayload;
      expect(payload.plan.planVersion).toBe("1.0.0");
      expect(payload.plan.regions).toHaveLength(1);
      expect(payload.interpretationTrace).toBeNull();

      expect(mockAnalyze).toHaveBeenCalledTimes(1);
      const [wb, hints, orgArg, userArg] = mockAnalyze.mock.calls[0] ?? [];
      expect(wb).toBeDefined();
      expect(hints).toEqual([]);
      expect(orgArg).toBe(organizationId);
      expect(userArg).toBe(userId);

      // Persisted row
      const rows = await (db as Db).select().from(connectorInstanceLayoutPlans);
      expect(rows).toHaveLength(1);
      expect(rows[0].connectorInstanceId).toBe(connectorInstanceId);
      expect(rows[0].supersededBy).toBeNull();
    });

    it("supersedes the existing current plan when interpreting again", async () => {
      const first = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook() });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook() });
      expect(second.status).toBe(200);

      const rows = await (db as Db).select().from(connectorInstanceLayoutPlans);
      expect(rows).toHaveLength(2);
      const superseded = rows.filter((r) => r.supersededBy !== null);
      const current = rows.filter((r) => r.supersededBy === null);
      expect(superseded).toHaveLength(1);
      expect(current).toHaveLength(1);
      expect(superseded[0].supersededBy).toBe(current[0].id);
    });

    it("returns 400 LAYOUT_PLAN_INVALID_PAYLOAD when the workbook is missing", async () => {
      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
      expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it("returns 404 when the connector instance belongs to a different organization", async () => {
      // Seed a second org with its own connector instance.
      const otherDef = makeConnectorDefinition();
      await (db as Db).insert(connectorDefinitions).values(otherDef as never);
      const otherUser = {
        id: generateId(),
        auth0Id: `auth0|other-${generateId()}`,
        email: `other-${generateId()}@example.com`,
        name: "Other User",
        lastLogin: now,
        picture: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as Db).insert(schema.users).values(otherUser as never);
      const otherOrg = {
        id: generateId(),
        name: "Other Org",
        timezone: "UTC",
        ownerUserId: otherUser.id,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
      await (db as Db).insert(schema.organizations).values(otherOrg as never);
      const otherInstance = makeConnectorInstance(otherDef.id, otherOrg.id);
      await (db as Db)
        .insert(connectorInstances)
        .values(otherInstance as never);

      const res = await request(app)
        .post(
          `/api/connector-instances/${otherInstance.id}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook() });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(
        ApiCode.LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND
      );
    });
  });

  // ── GET /layout-plan ─────────────────────────────────────────────────

  describe("GET /api/connector-instances/:id/layout-plan", () => {
    it("returns the current plan when one exists", async () => {
      const planId = generateId();
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: planId,
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
      } as never);

      const res = await request(app)
        .get(`/api/connector-instances/${connectorInstanceId}/layout-plan`)
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.plan.planVersion).toBe("1.0.0");
      expect(res.body.payload.interpretationTrace).toBeNull();
    });

    it("strips interpretationTrace by default", async () => {
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: generateId(),
        connectorInstanceId,
        planVersion: "1.0.0",
        revisionTag: null,
        plan: makeLayoutPlan(),
        interpretationTrace: { stages: { detectRegions: { ok: true } } },
        supersededBy: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const res = await request(app)
        .get(`/api/connector-instances/${connectorInstanceId}/layout-plan`)
        .set("Authorization", "Bearer test-token");

      expect(res.body.payload.interpretationTrace).toBeNull();
    });

    it("includes interpretationTrace when ?include=interpretationTrace is set", async () => {
      const trace = { stages: { detectRegions: { ok: true } } };
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: generateId(),
        connectorInstanceId,
        planVersion: "1.0.0",
        revisionTag: null,
        plan: makeLayoutPlan(),
        interpretationTrace: trace,
        supersededBy: null,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const res = await request(app)
        .get(
          `/api/connector-instances/${connectorInstanceId}/layout-plan?include=interpretationTrace`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.body.payload.interpretationTrace).toEqual(trace);
    });

    it("returns 404 when no plan exists for the instance", async () => {
      const res = await request(app)
        .get(`/api/connector-instances/${connectorInstanceId}/layout-plan`)
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_NOT_FOUND);
    });
  });

  // ── PATCH /:planId ───────────────────────────────────────────────────

  describe("PATCH /api/connector-instances/:id/layout-plan/:planId", () => {
    it("merges the patch body onto the stored plan and returns the validated result", async () => {
      const planId = generateId();
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: planId,
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
      } as never);

      const patchedConfidence = { overall: 0.5, perRegion: { r1: 0.5 } };
      const res = await request(app)
        .patch(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}`
        )
        .set("Authorization", "Bearer test-token")
        .send({ confidence: patchedConfidence });

      expect(res.status).toBe(200);
      expect(res.body.payload.plan.confidence).toEqual(patchedConfidence);

      const [row] = await (db as Db)
        .select()
        .from(connectorInstanceLayoutPlans);
      expect(row.plan.confidence).toEqual(patchedConfidence);
      expect(row.updatedBy).toBe(userId);
    });

    it("returns 400 when the merged plan fails schema validation", async () => {
      const planId = generateId();
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: planId,
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
      } as never);

      // planVersion cannot be an empty string per LayoutPlanSchema.
      const res = await request(app)
        .patch(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}`
        )
        .set("Authorization", "Bearer test-token")
        .send({ planVersion: "" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });

    it("returns 404 when the planId does not belong to the connector instance", async () => {
      const res = await request(app)
        .patch(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${generateId()}`
        )
        .set("Authorization", "Bearer test-token")
        .send({ planVersion: "2.0.0" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_NOT_FOUND);
    });
  });

  // ── POST /:planId/commit ─────────────────────────────────────────────

  async function seedColumnDefinition(
    db: Db,
    organizationId: string,
    key: string,
    label: string = key
  ): Promise<string> {
    const id = generateId();
    await (db as Db).insert(schema.columnDefinitions).values({
      id,
      organizationId,
      key,
      label,
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  async function insertPlanRow(db: Db, plan: LayoutPlan): Promise<string> {
    const planId = generateId();
    await (db as Db).insert(connectorInstanceLayoutPlans).values({
      id: planId,
      connectorInstanceId,
      planVersion: plan.planVersion,
      revisionTag: null,
      plan,
      interpretationTrace: null,
      supersededBy: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return planId;
  }

  function simpleRegion(
    regionId: string,
    target: string,
    colEmailId: string,
    colNameId: string,
    overrides: Partial<LayoutPlan["regions"][number]> = {}
  ): LayoutPlan["regions"][number] {
    return {
      id: regionId,
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
      targetEntityDefinitionId: target,
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 2 }],
      },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.95,
        },
      },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
        confidence: 0.9,
      },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
          columnDefinitionId: colEmailId,
          confidence: 0.9,
        },
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
          columnDefinitionId: colNameId,
          confidence: 0.9,
        },
      ],
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0.9, aggregate: 0.9 },
      warnings: [],
      ...overrides,
    } as LayoutPlan["regions"][number];
  }

  function contactsWorkbook(): WorkbookData {
    return {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "name" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
          ],
        },
      ],
    };
  }

  describe("POST /api/connector-instances/:id/layout-plan/:planId/commit", () => {
    it("happy path: one region → one ConnectorEntity, N FieldMappings, M entity_records", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [simpleRegion("r1", "contacts", colEmailId, colNameId)],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorEntityIds).toHaveLength(1);
      expect(res.body.payload.recordCounts.created).toBe(2);
      expect(res.body.payload.recordCounts.updated).toBe(0);

      const entities = await (db as Db).select().from(schema.connectorEntities);
      expect(entities).toHaveLength(1);
      expect(entities[0].key).toBe("contacts");

      const mappings = await (db as Db).select().from(schema.fieldMappings);
      expect(mappings).toHaveLength(2);
      const byNormalized = new Map(
        mappings.map((m) => [m.normalizedKey, m.columnDefinitionId])
      );
      expect(byNormalized.get("email")).toBe(colEmailId);
      expect(byNormalized.get("name")).toBe(colNameId);

      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(2);
      expect(records[0].normalizedData).toHaveProperty("email");
      expect(records[0].normalizedData).toHaveProperty("name");
    });

    it("rejects plans where two regions share a targetEntityDefinitionId (C1)", async () => {
      // Historical semantic: regions sharing a target merged into a single
      // entity. Under C1 (see docs/REGION_CONFIG.c1_one_region_per_entity.spec.md)
      // each target must map to exactly one region — so the commit service
      // rejects the plan up-front with LAYOUT_PLAN_DUPLICATE_ENTITY before
      // touching the DB.
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );

      const region1 = simpleRegion("r1", "contacts", colEmailId, colNameId);
      const region2 = simpleRegion("r2", "contacts", colEmailId, colNameId);
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [region1, region2],
        confidence: { overall: 0.9, perRegion: { r1: 0.9, r2: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook() });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY);

      // No entity or mapping rows should have been written.
      const entities = await (db as Db)
        .select()
        .from(schema.connectorEntities);
      expect(entities).toHaveLength(0);
      const mappings = await (db as Db).select().from(schema.fieldMappings);
      expect(mappings).toHaveLength(0);
    });

    it("creates separate ConnectorEntities for distinct targetEntityDefinitionIds", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [
          simpleRegion("r1", "contacts", colEmailId, colNameId),
          simpleRegion("r2", "leads", colEmailId, colNameId),
        ],
        confidence: { overall: 0.9, perRegion: { r1: 0.9, r2: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorEntityIds).toHaveLength(2);
      const entities = await (db as Db).select().from(schema.connectorEntities);
      const keys = entities.map((e) => e.key).sort();
      expect(keys).toEqual(["contacts", "leads"]);
    });

    it("idempotent: re-committing the same plan + workbook leaves records unchanged", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [simpleRegion("r1", "contacts", colEmailId, colNameId)],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });

      const second = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });

      expect(second.status).toBe(200);
      expect(second.body.payload.recordCounts.unchanged).toBe(2);
      expect(second.body.payload.recordCounts.created).toBe(0);
      expect(second.body.payload.recordCounts.updated).toBe(0);

      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(2);
    });

    it("returns 409 LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED when the workbook has duplicate identity values", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [simpleRegion("r1", "contacts", colEmailId, colNameId)],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const duplicate: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "name" },
              { row: 2, col: 1, value: "dup@x.com" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "dup@x.com" },
              { row: 3, col: 2, value: "bob" },
            ],
          },
        ],
      };

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: duplicate });

      expect(res.status).toBe(409);
      // Duplicate identity values both flip `identityChanging: true` and escalate
      // severity to `blocker`; the identity-changing code wins because it is
      // the more specific classification.
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED);
      expect(res.body.details?.drift?.identityChanging).toBe(true);

      // No entity_records written.
      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(0);
    });

    it("returns 409 LAYOUT_PLAN_DRIFT_BLOCKER when removed-columns exceed removedColumns.max", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 2, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [
          simpleRegion("r1", "contacts", colEmailId, colNameId, {
            bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 1 },
            drift: {
              headerShiftRows: 0,
              addedColumns: "halt",
              removedColumns: { max: 0, action: "halt" },
            },
          }),
        ],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      // Workbook has only the email column — name binding is removed.
      const missingName: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 1 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 2, col: 1, value: "a@x.com" },
            ],
          },
        ],
      };

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: missingName });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_DRIFT_BLOCKER);
      expect(res.body.details?.drift?.identityChanging).toBe(false);

      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(0);
    });

    it("returns 409 LAYOUT_PLAN_DRIFT_HALT when a region's addedColumns knob is 'halt' and a new header appears", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 2, cols: 3 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [
          simpleRegion("r1", "contacts", colEmailId, colNameId, {
            bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
            drift: {
              headerShiftRows: 0,
              addedColumns: "halt",
              removedColumns: { max: 0, action: "halt" },
            },
          }),
        ],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const extraHeader: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "unexpected" }, // added
              { row: 2, col: 1, value: "a@x.com" },
              { row: 2, col: 2, value: "alice" },
              { row: 2, col: 3, value: "x" },
            ],
          },
        ],
      };

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: extraHeader });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_DRIFT_HALT);
    });

    it("commits cleanly (info severity) when addedColumns knob is 'auto-apply'", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 2, cols: 3 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
        },
        regions: [
          simpleRegion("r1", "contacts", colEmailId, colNameId, {
            bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
            drift: {
              headerShiftRows: 0,
              addedColumns: "auto-apply",
              removedColumns: { max: 0, action: "halt" },
            },
          }),
        ],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const extraHeader: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "unexpected" },
              { row: 2, col: 1, value: "a@x.com" },
              { row: 2, col: 2, value: "alice" },
              { row: 2, col: 3, value: "x" },
            ],
          },
        ],
      };

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: extraHeader });

      expect(res.status).toBe(200);
      expect(res.body.payload.recordCounts.created).toBe(1);
    });

    it("returns 400 when the workbook is missing", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [],
        },
        regions: [simpleRegion("r1", "contacts", colEmailId, colNameId)],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });

    it("returns 404 when the planId does not belong to the connector instance", async () => {
      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${generateId()}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_NOT_FOUND);
    });

    it("returns 409 LAYOUT_PLAN_BLOCKER_WARNINGS when a region carries a blocker warning", async () => {
      const colEmailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      const colNameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name"
      );
      const region = simpleRegion("r1", "contacts", colEmailId, colNameId, {
        warnings: [
          {
            code: "PIVOTED_REGION_MISSING_AXIS_NAME",
            severity: "blocker",
            message: "Pivoted region is missing a records-axis name.",
          },
        ],
      });
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [],
        },
        regions: [region],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const res = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}/commit`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: contactsWorkbook() });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_BLOCKER_WARNINGS);
      expect(res.body.details?.codes).toContain(
        "PIVOTED_REGION_MISSING_AXIS_NAME"
      );
      expect(res.body.details?.warnings).toHaveLength(1);

      // No records written — commit halted before replay/materialization.
      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(0);
    });
  });

  // ── Warnings persistence across interpret + GET ──────────────────────

  describe("blocker warnings survive the interpret → GET round-trip", () => {
    it("preserves blocker-severity warnings on the persisted plan and returns them on GET", async () => {
      const planWithBlocker: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 2, cols: 2 } },
          anchorCells: [],
        },
        regions: [
          {
            id: "r1",
            sheet: "Sheet1",
            bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            targetEntityDefinitionId: "monthly",
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
            confidence: { region: 0.8, aggregate: 0.8 },
            warnings: [
              {
                code: "PIVOTED_REGION_MISSING_AXIS_NAME",
                severity: "blocker",
                message:
                  "Pivoted region requires a records-axis name before it can commit.",
              },
            ],
          },
        ],
        confidence: { overall: 0.8, perRegion: { r1: 0.8 } },
      };
      // Override the default mock for this test — the baseline returns a
      // plan with no warnings; we want the interpreter to yield a blocker.
      mockAnalyze.mockResolvedValueOnce(planWithBlocker);

      const postRes = await request(app)
        .post(
          `/api/connector-instances/${connectorInstanceId}/layout-plan/interpret`
        )
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook() });
      expect(postRes.status).toBe(200);
      expect(postRes.body.payload.plan.regions[0].warnings).toHaveLength(1);
      expect(postRes.body.payload.plan.regions[0].warnings[0].severity).toBe(
        "blocker"
      );

      const getRes = await request(app)
        .get(`/api/connector-instances/${connectorInstanceId}/layout-plan`)
        .set("Authorization", "Bearer test-token");
      expect(getRes.status).toBe(200);
      expect(getRes.body.payload.plan.regions[0].warnings[0].code).toBe(
        "PIVOTED_REGION_MISSING_AXIS_NAME"
      );
      expect(getRes.body.payload.plan.regions[0].warnings[0].severity).toBe(
        "blocker"
      );
    });
  });
});
