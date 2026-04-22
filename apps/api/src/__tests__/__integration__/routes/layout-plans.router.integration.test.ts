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

// In-memory Redis shim — caches the parsed WorkbookData keyed by session id.
const redisStore = new Map<string, string>();
jest.unstable_mockModule("../../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    set: async (key: string, value: string): Promise<"OK"> => {
      redisStore.set(key, value);
      return "OK";
    },
    get: async (key: string): Promise<string | null> =>
      redisStore.get(key) ?? null,
    del: async (key: string): Promise<number> => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    },
  }),
  closeRedis: async () => undefined,
}));

// In-memory S3 — tests never reach the network. `file_uploads` rows still
// get written so the real resolveWorkbook path (cache-miss fallback)
// transparently re-streams from this map.
jest.unstable_mockModule("../../../services/s3.service.js", () => ({
  S3Service: {
    createPresignedPutUrl: jest.fn(async () => "https://s3.test/ignore"),
    getObjectStream: jest.fn(),
    headObject: jest.fn(async () => ({
      contentLength: 0,
      contentType: "text/csv",
    })),
    deleteObject: jest.fn(async () => undefined),
  },
}));

const { app } = await import("../../../app.js");

const {
  connectorInstances,
  connectorDefinitions,
  connectorInstanceLayoutPlans,
  connectorEntities,
  entityRecords,
  fieldMappings,
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
    capabilityFlags: { read: true, write: true },
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

/**
 * Seed an upload session — writes one `file_uploads` row + caches the
 * workbook in the mocked Redis so `FileUploadSessionService.resolveWorkbook`
 * finds it instantly (cache hit, no S3 stream required).
 */
async function seedUploadSession(
  db: Db,
  organizationId: string,
  workbook: WorkbookData
): Promise<string> {
  const uploadSessionId = generateId();
  const uploadId = generateId();
  await db.insert(schema.fileUploads).values({
    id: uploadId,
    organizationId,
    filename: "test.csv",
    contentType: "text/csv",
    sizeBytes: 100,
    s3Key: `uploads/${organizationId}/${uploadId}/test.csv`,
    status: "parsed",
    uploadSessionId,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  redisStore.set(
    `upload-session:${uploadSessionId}`,
    JSON.stringify(workbook)
  );
  return uploadSessionId;
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
    redisStore.clear();

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

      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );

      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ uploadSessionId, regionHints: [] });

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
      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );

      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId,
          name: "My CSV upload",
          plan: makePlan(emailId, nameId),
          uploadSessionId,
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

    it("writes entity_records.normalizedData keyed by the same normalizedKey the FieldMapping rows use", async () => {
      // Seed catalog columns whose `key` differs from the spreadsheet's
      // header text. The source-derived default `normalizedKey` should
      // match the header (e.g. "Email Address" → "email_address"), NOT the
      // catalog's key (e.g. "email"). This regression test guards against
      // the writeRecords / reconcile key-mismatch bug.
      const emailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email",
        "Email"
      );
      const nameId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name",
        "Name"
      );

      const workbook: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "Email Address" },
              { row: 1, col: 2, value: "Full Name" },
              { row: 2, col: 1, value: "alice@example.com" },
              { row: 2, col: 2, value: "Alice Example" },
            ],
          },
        ],
      };
      const plan = makePlan(emailId, nameId);
      plan.workbookFingerprint = {
        sheetNames: ["Sheet1"],
        dimensions: { Sheet1: { rows: 2, cols: 2 } },
        anchorCells: [
          { sheet: "Sheet1", row: 1, col: 1, value: "Email Address" },
        ],
      };
      plan.regions[0].bounds = {
        startRow: 1,
        startCol: 1,
        endRow: 2,
        endCol: 2,
      };
      plan.regions[0].columnBindings = [
        {
          sourceLocator: { kind: "byHeaderName", name: "Email Address" },
          columnDefinitionId: emailId,
          confidence: 0.9,
        },
        {
          sourceLocator: { kind: "byHeaderName", name: "Full Name" },
          columnDefinitionId: nameId,
          confidence: 0.9,
        },
      ];
      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        workbook
      );

      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId,
          name: "Source-derived keys",
          plan,
          uploadSessionId,
        });
      expect(res.status).toBe(200);
      const connectorInstanceId = res.body.payload
        .connectorInstanceId as string;

      const [entity] = await (db as Db)
        .select()
        .from(connectorEntities)
        .where(eq(connectorEntities.connectorInstanceId, connectorInstanceId));
      expect(entity).toBeDefined();

      const mappings = await (db as Db)
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.connectorEntityId, entity.id));
      const mappingKeys = new Set(mappings.map((m) => m.normalizedKey));
      // Source-derived keys, NOT catalog keys.
      expect(mappingKeys).toEqual(new Set(["email_address", "full_name"]));

      const records = await (db as Db)
        .select()
        .from(entityRecords)
        .where(eq(entityRecords.connectorEntityId, entity.id));
      expect(records).toHaveLength(1);
      const normalizedData = records[0].normalizedData as Record<
        string,
        unknown
      >;
      // The normalizedData must be keyed by the same derivation as the
      // FieldMapping rows — otherwise the UI renders empty fields.
      expect(normalizedData).toEqual({
        email_address: "alice@example.com",
        full_name: "Alice Example",
      });
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

      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );
      const res = await request(app)
        .post("/api/layout-plans/commit")
        .set("Authorization", "Bearer test-token")
        .send({
          connectorDefinitionId,
          name: "Should not persist",
          plan: planWithBlocker,
          uploadSessionId,
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

    describe("C1 duplicate-target guard", () => {
      it("returns 400 LAYOUT_PLAN_DUPLICATE_ENTITY when the plan has two regions with the same targetEntityDefinitionId", async () => {
        const emailId = await seedColumnDefinition(
          db as Db,
          organizationId,
          "email"
        );
        const nameId = await seedColumnDefinition(
          db as Db,
          organizationId,
          "name"
        );
        const uploadSessionId = await seedUploadSession(
          db as Db,
          organizationId,
          makeWorkbook()
        );

        const plan = makePlan(emailId, nameId);
        // Duplicate the single region with a new id — both still target
        // "contacts". (The plan schema rejects identical ids.)
        plan.regions = [
          plan.regions[0],
          { ...plan.regions[0], id: "r2" },
        ];

        const res = await request(app)
          .post("/api/layout-plans/commit")
          .set("Authorization", "Bearer test-token")
          .send({
            connectorDefinitionId,
            name: "Duplicate target",
            plan,
            uploadSessionId,
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY);

        // No rows should survive the outer rollback.
        const stray = await (db as Db)
          .select()
          .from(connectorInstances)
          .where(eq(connectorInstances.name, "Duplicate target"));
        expect(stray).toHaveLength(0);
        const strayPlans = await (db as Db)
          .select()
          .from(connectorInstanceLayoutPlans);
        expect(strayPlans).toHaveLength(0);
        const strayEntities = await (db as Db).select().from(connectorEntities);
        expect(strayEntities).toHaveLength(0);
        const strayMappings = await (db as Db).select().from(fieldMappings);
        expect(strayMappings).toHaveLength(0);
      });

      it("succeeds when the plan has one region per distinct target", async () => {
        // Regression — baseline shape still passes.
        const emailId = await seedColumnDefinition(
          db as Db,
          organizationId,
          "email"
        );
        const nameId = await seedColumnDefinition(
          db as Db,
          organizationId,
          "name"
        );
        const uploadSessionId = await seedUploadSession(
          db as Db,
          organizationId,
          makeWorkbook()
        );

        const res = await request(app)
          .post("/api/layout-plans/commit")
          .set("Authorization", "Bearer test-token")
          .send({
            connectorDefinitionId,
            name: "Distinct targets baseline",
            plan: makePlan(emailId, nameId),
            uploadSessionId,
          });

        expect(res.status).toBe(200);
        expect(res.body.payload.connectorInstanceId).toBeDefined();
      });
    });
  });
});
