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
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { LayoutPlan, WorkbookData } from "@portalai/core/contracts";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|layout-plan-draft-user";

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

// Mock LayoutPlanInterpretService.analyze to return a fixed plan so interpret
// tests don't touch an LLM.
const mockAnalyze = jest.fn<(...args: unknown[]) => Promise<LayoutPlan>>();
jest.unstable_mockModule(
  "../../../services/layout-plan-interpret.service.js",
  () => ({
    LayoutPlanInterpretService: {
      analyze: mockAnalyze,
      loadCatalog: jest.fn(async () => []),
    },
  })
);

const { app } = await import("../../../app.js");

const {
  connectorInstances,
  connectorDefinitions,
  connectorInstanceLayoutPlans,
  connectorEntities,
} = schema;

type Db = ReturnType<typeof drizzle>;

const now = Date.now();

function makeConnectorDefinition(id = generateId()) {
  return {
    id,
    slug: `file-upload-${id.slice(0, 8)}`,
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

async function seedColumnDefinition(
  db: Db,
  organizationId: string,
  key: string,
  label: string = key
): Promise<string> {
  const id = generateId();
  await db.insert(schema.columnDefinitions).values({
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

function makePlan(
  colEmailId: string,
  colNameId: string,
  overrides: Partial<LayoutPlan> = {}
): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Sheet1"],
      dimensions: { Sheet1: { rows: 3, cols: 2 } },
      anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
    },
    regions: [
      {
        id: "r1",
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        boundsMode: "absolute",
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
        headerStrategy: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.95,
        },
        identityStrategy: {
          kind: "column",
          sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
          confidence: 0.9,
        },
        columnBindings: [
          {
            sourceLocator: { kind: "byHeaderName", name: "email" },
            columnDefinitionId: colEmailId,
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", name: "name" },
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

describe("Layout Plans Draft Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let organizationId: string;
  let connectorDefinitionId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as Db);
    mockAnalyze.mockReset();

    const seed = await seedUserAndOrg(db as Db, AUTH0_ID);
    organizationId = seed.organizationId;

    const def = makeConnectorDefinition();
    await (db as Db).insert(connectorDefinitions).values(def as never);
    connectorDefinitionId = def.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  describe("POST /api/layout-plans/interpret", () => {
    it("returns the plan without persisting anything", async () => {
      const emailId = await seedColumnDefinition(db as Db, organizationId, "email");
      const nameId = await seedColumnDefinition(db as Db, organizationId, "name");
      mockAnalyze.mockResolvedValue(makePlan(emailId, nameId));

      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ workbook: makeWorkbook(), regionHints: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.plan.planVersion).toBe("1.0.0");
      expect(res.body.payload.plan.regions).toHaveLength(1);

      // No ConnectorInstance or layout plan row should have been created.
      const instances = await (db as Db).select().from(connectorInstances);
      expect(instances.filter((i) => i.organizationId === organizationId))
        .toHaveLength(0);
      const plans = await (db as Db).select().from(connectorInstanceLayoutPlans);
      expect(plans).toHaveLength(0);
    });

    it("rejects an invalid body", async () => {
      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });
  });

  describe("POST /api/layout-plans/commit", () => {
    it("creates the ConnectorInstance + plan row and commits records atomically", async () => {
      const emailId = await seedColumnDefinition(db as Db, organizationId, "email");
      const nameId = await seedColumnDefinition(db as Db, organizationId, "name");

      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId,
          name: "My CSV upload",
          plan: makePlan(emailId, nameId),
          workbook: makeWorkbook(),
        });

      expect(res.status).toBe(200);
      const payload = res.body.payload as {
        connectorInstanceId: string;
        planId: string;
        recordCounts: { created: number };
      };
      expect(payload.connectorInstanceId).toBeDefined();
      expect(payload.planId).toBeDefined();

      const instances = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.id, payload.connectorInstanceId));
      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe("My CSV upload");
      expect(instances[0].organizationId).toBe(organizationId);

      const plans = await (db as Db)
        .select()
        .from(connectorInstanceLayoutPlans)
        .where(eq(connectorInstanceLayoutPlans.id, payload.planId));
      expect(plans).toHaveLength(1);
      expect(plans[0].connectorInstanceId).toBe(payload.connectorInstanceId);

      const entities = await (db as Db)
        .select()
        .from(connectorEntities)
        .where(eq(connectorEntities.connectorInstanceId, payload.connectorInstanceId));
      expect(entities.length).toBeGreaterThanOrEqual(1);
    });

    it("rolls back the ConnectorInstance and plan row when commit fails", async () => {
      const emailId = await seedColumnDefinition(db as Db, organizationId, "email");
      const nameId = await seedColumnDefinition(db as Db, organizationId, "name");
      const planWithBlocker = makePlan(emailId, nameId);
      planWithBlocker.regions[0].warnings = [
        {
          code: "PIVOTED_REGION_MISSING_AXIS_NAME",
          severity: "blocker",
          message: "Synthetic blocker for rollback test",
        },
      ];

      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId,
          name: "Should not persist",
          plan: planWithBlocker,
          workbook: makeWorkbook(),
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_BLOCKER_WARNINGS);

      // No instance should have survived the rollback.
      const stray = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.name, "Should not persist"));
      expect(stray).toHaveLength(0);

      const strayPlans = await (db as Db)
        .select()
        .from(connectorInstanceLayoutPlans);
      expect(strayPlans).toHaveLength(0);
    });

    it("rejects an invalid body", async () => {
      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({ connectorDefinitionId, name: "x" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });
  });
});
