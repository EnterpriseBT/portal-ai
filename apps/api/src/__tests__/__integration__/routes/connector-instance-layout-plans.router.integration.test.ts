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

import type {
  InterpretResponsePayload,
  LayoutPlan,
  LayoutPlanEditContextResponsePayload,
  WorkbookData,
} from "@portalai/core/contracts";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { LayoutPlanCommitService } from "../../../services/layout-plan-commit.service.js";
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

// In-memory Redis shim — keeps the chunked workbook cache exercised by
// `getEditContext` off a real Redis. Mirrors the implementation that
// `layout-plans.router.integration.test.ts` uses.
const redisStore = new Map<string, string>();
jest.unstable_mockModule("../../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    set: async (key: string, value: string): Promise<"OK"> => {
      redisStore.set(key, value);
      return "OK";
    },
    get: async (key: string): Promise<string | null> =>
      redisStore.get(key) ?? null,
    mget: async (...keys: string[]): Promise<(string | null)[]> =>
      keys.map((k) => redisStore.get(k) ?? null),
    del: async (...keys: string[]): Promise<number> => {
      let n = 0;
      for (const k of keys) if (redisStore.delete(k)) n++;
      return n;
    },
    scanStream({ match }: { match: string }) {
      const re = new RegExp(
        "^" +
          match
            .split("*")
            .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$"
      );
      const matched = [...redisStore.keys()].filter((k) => re.test(k));
      return (async function* () {
        if (matched.length > 0) yield matched;
      })();
    },
  }),
  closeRedis: async () => undefined,
}));

// edit-context now calls `rehydrateWorkbookCache` on every cloud-
// connector visit so Modify Layout Plan reflects current upstream
// state. In tests we don't have a real Google / Microsoft API — the
// seed helpers populate the cache directly via `seedWorkbookCache`,
// so the rehydrate step is a no-op for tests. Mock both
// `rehydrateWorkbookCache` statics to do nothing; the rest of the
// service surfaces (auth, sheet listing, etc.) stays unmocked.
jest.unstable_mockModule(
  "../../../services/google-sheets-connector.service.js",
  () => ({
    GoogleSheetsConnectorService: {
      rehydrateWorkbookCache: jest.fn(async () => undefined),
    },
  })
);
jest.unstable_mockModule(
  "../../../services/microsoft-excel-connector.service.js",
  () => ({
    MicrosoftExcelConnectorService: {
      rehydrateWorkbookCache: jest.fn(async () => undefined),
    },
  })
);

// In-memory S3 — `FileUploadSessionService.resolveWorkbook`'s cache-miss
// branch re-streams from S3 via this service; the mock keeps the
// fallback path off the network for the source-available case and lets
// the source-removed case surface as `FILE_UPLOAD_SESSION_NOT_FOUND`
// (file_uploads rows missing, not S3).
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
    const bounds = overrides.bounds ?? {
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 2,
    };
    // Keep `segmentsByAxis.row.positionCount` in lockstep with the bounds
    // span so callers that override `bounds` don't have to remember to
    // restate segments — the plan-schema refinement requires the sum to
    // equal the span exactly.
    const colSpan = bounds.endCol - bounds.startCol + 1;
    return {
      id: regionId,
      sheet: "Sheet1",
      bounds,
      targetEntityDefinitionId: target,
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: colSpan }],
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
    /**
     * Drives the commit pipeline directly — same code path the
     * `layout_plan_commit` worker takes via
     * `LayoutPlanDraftService.runRecommit` — so behavior assertions
     * (drift gates, record counts, FieldMapping shape, etc.) don't
     * have to round-trip through Bull. The HTTP route's role is
     * exercised separately by the 202-and-job-persistence test below.
     */
    async function commitInline(planId: string, workbook: WorkbookData) {
      return LayoutPlanCommitService.commit(
        connectorInstanceId,
        planId,
        organizationId,
        userId,
        { workbook }
      );
    }

    it("returns 202 with { connectorInstanceId, planId, jobId, status: pending } and persists a layout_plan_commit job", async () => {
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
        .send({ uploadSessionId: generateId() });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toEqual({
        connectorInstanceId,
        planId,
        jobId: expect.any(String),
        status: "pending",
      });

      const jobs = await (db as Db)
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, res.body.payload.jobId));
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe("layout_plan_commit");
      expect(jobs[0].status).toBe("pending");
      expect(jobs[0].metadata).toMatchObject({
        kind: "recommit",
        connectorInstanceId,
        planId,
        organizationId,
      });
    });

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

      const result = await commitInline(planId, contactsWorkbook());

      expect(result.connectorEntityIds).toHaveLength(1);
      expect(result.recordCounts.created).toBe(2);
      expect(result.recordCounts.updated).toBe(0);

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

      // Phase 2 Slice 6 — `normalized_data` is gone from
      // `entity_records`; the typed values live on the wide table.
      const entityId = result.connectorEntityIds[0]!;
      const wideRows = await (db as Db).execute(
        (await import("drizzle-orm")).sql.raw(`SELECT * FROM "er__${entityId}"`)
      );
      const rows = wideRows as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      const byEmail = new Map(rows.map((r) => [r.c_email, r]));
      expect(byEmail.get("a@x.com")).toBeDefined();
      expect(byEmail.get("a@x.com")!.c_name).toBe("alice");
      expect(byEmail.get("a@x.com")!.source_id).toBeTruthy();
      expect(byEmail.get("a@x.com")!.is_valid).toBe(true);
      expect(byEmail.get("b@x.com")!.c_name).toBe("bob");
    });

    // Regression: two source columns mapped to the same ColumnDefinition
    // (the AI had classified "Model" + "Organization" both as the generic
    // "Name" type, and "Task" + "Authors" both as the generic "Array"
    // type). Extract used to key `record.fields` by `columnDefinitionId`,
    // so the right-most binding's value silently overwrote the left-most's
    // — records ended up with the Authors value under the "task" mapping
    // and an empty "authors" mapping. Keying by source-field name keeps
    // each binding's value distinct and lets reconcile materialise one
    // FieldMapping per source column.
    it("two bindings sharing a columnDefinitionId produce two FieldMappings and preserve both source values", async () => {
      const colNameTypeId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "name_type"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 2 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "model" }],
        },
        regions: [
          simpleRegion("r1", "things", colNameTypeId, colNameTypeId, {
            columnBindings: [
              {
                sourceLocator: {
                  kind: "byHeaderName",
                  axis: "row",
                  name: "model",
                },
                columnDefinitionId: colNameTypeId,
                confidence: 0.9,
              },
              {
                sourceLocator: {
                  kind: "byHeaderName",
                  axis: "row",
                  name: "organization",
                },
                columnDefinitionId: colNameTypeId,
                confidence: 0.9,
              },
            ],
          }),
        ],
        confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
      };
      const planId = await insertPlanRow(db as Db, plan);

      const workbook: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "model" },
              { row: 1, col: 2, value: "organization" },
              { row: 2, col: 1, value: "Claude" },
              { row: 2, col: 2, value: "Anthropic" },
              { row: 3, col: 1, value: "GPT" },
              { row: 3, col: 2, value: "OpenAI" },
            ],
          },
        ],
      };

      await commitInline(planId, workbook);

      const mappings = await (db as Db).select().from(schema.fieldMappings);
      expect(mappings).toHaveLength(2);
      const normalizedKeys = mappings.map((m) => m.normalizedKey).sort();
      expect(normalizedKeys).toEqual(["model", "organization"]);
      // Both mappings reference the same columnDefinitionId — that's the
      // shape this test exercises.
      for (const m of mappings) {
        expect(m.columnDefinitionId).toBe(colNameTypeId);
      }

      // After slice 6 `normalized_data` lives on the wide table only.
      // Read via the hydrated repo to verify each record's projection.
      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(2);
      const { entityRecordsRepo } = await import(
        "../../../db/repositories/entity-records.repository.js"
      );
      const entityIdAfter = records[0].connectorEntityId;
      const hydrated = await entityRecordsRepo.findHydratedMany(
        entityIdAfter
      );
      expect(hydrated).toHaveLength(2);
      const claude = hydrated.find(
        (r) =>
          (r.normalizedData as Record<string, unknown>).model === "Claude"
      );
      expect(claude).toBeDefined();
      expect(
        (claude!.normalizedData as Record<string, unknown>).organization
      ).toBe("Anthropic");
      const gpt = hydrated.find(
        (r) => (r.normalizedData as Record<string, unknown>).model === "GPT"
      );
      expect(gpt).toBeDefined();
      expect(
        (gpt!.normalizedData as Record<string, unknown>).organization
      ).toBe("OpenAI");
    });

    it("pivot region: writes one FieldMapping for the pivot axisName + one for cellValueField, with records carrying normalized keys", async () => {
      // Single-axis pivot region: row 1 = "id, Jan, Feb, Mar". The pivot
      // segment's axisName ("month") and the cellValueField.name ("revenue")
      // are the two logical fields that ultimately become entity record
      // columns — commit must materialise a FieldMapping for each so the
      // emitted records line up with concrete columnDefinitionIds.
      const colIdId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "id"
      );
      const colMonthId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "month"
      );
      const colRevenueId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "revenue"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 4 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "id" }],
        },
        regions: [
          {
            id: "r1",
            sheet: "Sheet1",
            bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 4 },
            targetEntityDefinitionId: "monthly",
            headerAxes: ["row"],
            segmentsByAxis: {
              row: [
                { kind: "field", positionCount: 1 },
                {
                  kind: "pivot",
                  id: "month-seg",
                  axisName: "month",
                  axisNameSource: "user",
                  positionCount: 3,
                  columnDefinitionId: colMonthId,
                },
              ],
            },
            cellValueField: {
              name: "revenue",
              nameSource: "user",
              columnDefinitionId: colRevenueId,
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
            // Binding for the identity column's field-segment position so
            // drift's addedColumns gate has a name to match against — the
            // pivot positions (Jan/Feb/Mar) skip the gate as pivot segments.
            columnBindings: [
              {
                sourceLocator: { kind: "byHeaderName", axis: "row", name: "id" },
                columnDefinitionId: colIdId,
                confidence: 0.95,
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
      };
      const planId = await insertPlanRow(db as Db, plan);

      const workbook: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "id" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 1, col: 4, value: "Mar" },
              { row: 2, col: 1, value: "p1" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 110 },
              { row: 2, col: 4, value: 120 },
              { row: 3, col: 1, value: "p2" },
              { row: 3, col: 2, value: 80 },
              { row: 3, col: 3, value: 90 },
              { row: 3, col: 4, value: 95 },
            ],
          },
        ],
      };

      const result = await commitInline(planId, workbook);

      expect(result.connectorEntityIds).toHaveLength(1);
      // Two entities × three pivot positions = six records.
      expect(result.recordCounts.created).toBe(6);

      const mappings = await (db as Db).select().from(schema.fieldMappings);
      // Three mappings: one for the identity columnBinding ("id"), one for
      // the pivot axisName ("month"), and one for the cellValueField.name
      // ("revenue").
      expect(mappings).toHaveLength(3);
      const byKey = new Map(
        mappings.map((m) => [m.normalizedKey, m.columnDefinitionId])
      );
      expect(byKey.get("id")).toBe(colIdId);
      expect(byKey.get("month")).toBe(colMonthId);
      expect(byKey.get("revenue")).toBe(colRevenueId);

      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(6);
      const { entityRecordsRepo } = await import(
        "../../../db/repositories/entity-records.repository.js"
      );
      const hydrated = await entityRecordsRepo.findHydratedMany(
        records[0].connectorEntityId
      );
      expect(hydrated[0].normalizedData).toHaveProperty("month");
      expect(hydrated[0].normalizedData).toHaveProperty("revenue");
      const months = new Set(
        hydrated.map((r) =>
          (r.normalizedData as Record<string, unknown>).month
        )
      );
      expect(months).toEqual(new Set(["Jan", "Feb", "Mar"]));
    });

    it("pivot region: excluded pivot axisName + cellValueField produce no FieldMappings", async () => {
      // Regression for the "Omit this column" toggle on synthetic chips:
      // when the user marks a pivot segment or cellValueField as excluded,
      // commit must not materialise a FieldMapping for it (parallel to
      // `binding.excluded === true` on columnBindings).
      const colIdId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "id"
      );
      const colMonthId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "month"
      );
      const colRevenueId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "revenue"
      );
      const plan: LayoutPlan = {
        planVersion: "1.0.0",
        workbookFingerprint: {
          sheetNames: ["Sheet1"],
          dimensions: { Sheet1: { rows: 3, cols: 4 } },
          anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "id" }],
        },
        regions: [
          {
            id: "r1",
            sheet: "Sheet1",
            bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 4 },
            targetEntityDefinitionId: "monthly",
            headerAxes: ["row"],
            segmentsByAxis: {
              row: [
                { kind: "field", positionCount: 1 },
                {
                  kind: "pivot",
                  id: "month-seg",
                  axisName: "month",
                  axisNameSource: "user",
                  positionCount: 3,
                  columnDefinitionId: colMonthId,
                  excluded: true,
                },
              ],
            },
            cellValueField: {
              name: "revenue",
              nameSource: "user",
              columnDefinitionId: colRevenueId,
              excluded: true,
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
                sourceLocator: { kind: "byHeaderName", axis: "row", name: "id" },
                columnDefinitionId: colIdId,
                confidence: 0.95,
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
      };
      const planId = await insertPlanRow(db as Db, plan);

      const workbook: WorkbookData = {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "id" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 1, col: 4, value: "Mar" },
              { row: 2, col: 1, value: "p1" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 110 },
              { row: 2, col: 4, value: 120 },
              { row: 3, col: 1, value: "p2" },
              { row: 3, col: 2, value: 80 },
              { row: 3, col: 3, value: 90 },
              { row: 3, col: 4, value: 95 },
            ],
          },
        ],
      };

      await commitInline(planId, workbook);

      const mappings = await (db as Db).select().from(schema.fieldMappings);
      // Only the static `id` columnBinding produces a FieldMapping. The
      // excluded pivot axisName + cellValueField each yield zero rows.
      expect(mappings).toHaveLength(1);
      expect(mappings[0].normalizedKey).toBe("id");
      expect(mappings[0].columnDefinitionId).toBe(colIdId);
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

      await expect(
        commitInline(planId, makeWorkbook())
      ).rejects.toMatchObject({
        status: 400,
        code: ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY,
      });

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

      const result = await commitInline(planId, contactsWorkbook());

      expect(result.connectorEntityIds).toHaveLength(2);
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

      const first = await commitInline(planId, contactsWorkbook());
      const second = await commitInline(planId, contactsWorkbook());

      expect(second.recordCounts.unchanged).toBe(2);
      expect(second.recordCounts.created).toBe(0);
      expect(second.recordCounts.updated).toBe(0);

      const records = await (db as Db).select().from(schema.entityRecords);
      expect(records).toHaveLength(2);

      // Phase 2 Slice 2 — re-commit doesn't double the wide-table rows
      // and the unchanged-path bumps `synced_at` on both sides.
      const entityId = first.connectorEntityIds[0]!;
      const wideRows = (await (db as Db).execute(
        (await import("drizzle-orm")).sql.raw(
          `SELECT * FROM "er__${entityId}"`
        )
      )) as unknown as Record<string, unknown>[];
      expect(wideRows).toHaveLength(2);
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

      // Duplicate identity values both flip `identityChanging: true` and escalate
      // severity to `blocker`; the identity-changing code wins because it is
      // the more specific classification.
      await expect(commitInline(planId, duplicate)).rejects.toMatchObject({
        status: 409,
        code: ApiCode.LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED,
        details: expect.objectContaining({
          drift: expect.objectContaining({ identityChanging: true }),
        }),
      });

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

      await expect(commitInline(planId, missingName)).rejects.toMatchObject({
        status: 409,
        code: ApiCode.LAYOUT_PLAN_DRIFT_BLOCKER,
        details: expect.objectContaining({
          drift: expect.objectContaining({ identityChanging: false }),
        }),
      });

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

      await expect(commitInline(planId, extraHeader)).rejects.toMatchObject({
        status: 409,
        code: ApiCode.LAYOUT_PLAN_DRIFT_HALT,
      });
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

      const result = await commitInline(planId, extraHeader);
      expect(result.recordCounts.created).toBe(1);
    });

    it("returns 400 when no workbook source is supplied", async () => {
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
        .send({ uploadSessionId: generateId() });
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
            code: "SEGMENT_MISSING_AXIS_NAME",
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

      await expect(
        commitInline(planId, contactsWorkbook())
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.LAYOUT_PLAN_BLOCKER_WARNINGS,
        details: expect.objectContaining({
          codes: expect.arrayContaining(["SEGMENT_MISSING_AXIS_NAME"]),
          warnings: expect.arrayContaining([expect.any(Object)]),
        }),
      });

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
                code: "SEGMENT_MISSING_AXIS_NAME",
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
        "SEGMENT_MISSING_AXIS_NAME"
      );
      expect(getRes.body.payload.plan.regions[0].warnings[0].severity).toBe(
        "blocker"
      );
    });
  });

  // ── GET /:connectorInstanceId/layout-plan/edit-context ───────────────────

  describe("GET /api/connector-instances/:id/layout-plan/edit-context", () => {
    /** Mirrors `workbook-preview.util.ts` sheetId(). */
    function sheetIdOf(index: number, name: string): string {
      const slug = name.replace(/\s+/g, "_").toLowerCase();
      return `sheet_${index}_${slug}`;
    }

    /** Dense-rows shape used by `WorkbookCacheService.readRows` / preview. */
    function sparseToDenseRows(
      sheet: WorkbookData["sheets"][number]
    ): (string | number | boolean | null)[][] {
      const { rows, cols } = sheet.dimensions;
      const dense: (string | number | boolean | null)[][] = Array.from(
        { length: rows },
        () => new Array(cols).fill(null) as (string | number | boolean | null)[]
      );
      for (const cell of sheet.cells) {
        const r = cell.row - 1;
        const c = cell.col - 1;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const v = cell.value;
        if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          dense[r]![c] = v;
        } else if (v == null) {
          dense[r]![c] = null;
        } else {
          dense[r]![c] = String(v);
        }
      }
      return dense;
    }

    /** Populate the chunked cache under `prefix` for the given workbook. */
    function seedWorkbookCache(prefix: string, workbook: WorkbookData) {
      const sheetMetas = workbook.sheets.map((sheet, i) => ({
        sheetId: sheetIdOf(i, sheet.name),
        name: sheet.name,
        rowCount: sheet.dimensions.rows,
        colCount: sheet.dimensions.cols,
        hasMerges: sheet.cells.some((c) => c.merged !== undefined),
      }));
      redisStore.set(
        `${prefix}:meta`,
        JSON.stringify({
          sheets: sheetMetas,
          status: "ready" as const,
          createdAt: now,
        })
      );
      workbook.sheets.forEach((sheet, i) => {
        const sId = sheetMetas[i]!.sheetId;
        redisStore.set(
          `${prefix}:sheet:${sId}:rows:0`,
          JSON.stringify(sparseToDenseRows(sheet))
        );
      });
    }

    async function seedConnectorInstanceWithSlug(
      slug: string
    ): Promise<{ definitionId: string; instanceId: string }> {
      const def = {
        ...makeConnectorDefinition(),
        slug,
      };
      await (db as Db).insert(connectorDefinitions).values(def as never);
      const inst = makeConnectorInstance(def.id, organizationId);
      await (db as Db).insert(connectorInstances).values(inst as never);
      return { definitionId: def.id, instanceId: inst.id };
    }

    async function seedPlanRow(forInstanceId: string): Promise<string> {
      const planId = generateId();
      await (db as Db).insert(connectorInstanceLayoutPlans).values({
        id: planId,
        connectorInstanceId: forInstanceId,
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
      return planId;
    }

    /**
     * Seed a layout_plan_commit job that points the file-upload edit-context
     * lookup at a specific uploadSessionId — mirrors what
     * `prepareDraftCommit` / `prepareRecommit` would have inserted in
     * production.
     */
    async function seedPriorLayoutPlanCommitJob(
      forInstanceId: string,
      forUploadSessionId: string,
      forPlanId: string
    ): Promise<void> {
      await (db as Db).insert(schema.jobs).values({
        id: generateId(),
        organizationId,
        type: "layout_plan_commit",
        status: "completed",
        progress: 100,
        metadata: {
          kind: "draft",
          organizationId,
          userId,
          connectorInstanceId: forInstanceId,
          planId: forPlanId,
          connectorDefinitionId: "_seed",
          name: "seed",
          isExistingInstance: false,
          plan: {},
          workbookSource: {
            kind: "uploadSession",
            uploadSessionId: forUploadSessionId,
          },
        },
        result: null,
        error: null,
        startedAt: now,
        completedAt: now,
        bullJobId: null,
        attempts: 1,
        maxAttempts: 1,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }

    beforeEach(() => {
      redisStore.clear();
    });

    it("case 1 — google-sheets: returns plan + slug + workbookPreview + editable:true", async () => {
      const seeded = await seedConnectorInstanceWithSlug("google-sheets");
      const planId = await seedPlanRow(seeded.instanceId);
      seedWorkbookCache(
        `connector:wb:google-sheets:${seeded.instanceId}`,
        makeWorkbook()
      );

      const res = await request(app)
        .get(
          `/api/connector-instances/${seeded.instanceId}/layout-plan/edit-context`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const payload =
        res.body.payload as LayoutPlanEditContextResponsePayload;
      expect(payload.planId).toBe(planId);
      expect(payload.plan.planVersion).toBe("1.0.0");
      expect(payload.connectorDefinitionSlug).toBe("google-sheets");
      expect(payload.editable).toBe(true);
      expect(payload.workbookPreview).not.toBeNull();
      expect(payload.workbookPreview!.sheets).toHaveLength(1);
      expect(payload.workbookPreview!.sheets[0].name).toBe("Sheet1");
      expect(payload.workbookPreview!.sheets[0].cells.length).toBeGreaterThan(0);
      expect(payload.reason).toBeUndefined();
      // Cloud connectors' slice endpoints key off the connector-instance
      // id; the upload-session echo is file-upload-only.
      expect(payload.uploadSessionId).toBeUndefined();
    });

    it("case 2 — microsoft-excel: returns the same bundle keyed off the excel cache", async () => {
      const seeded = await seedConnectorInstanceWithSlug("microsoft-excel");
      await seedPlanRow(seeded.instanceId);
      seedWorkbookCache(
        `connector:wb:microsoft-excel:${seeded.instanceId}`,
        makeWorkbook()
      );

      const res = await request(app)
        .get(
          `/api/connector-instances/${seeded.instanceId}/layout-plan/edit-context`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const payload =
        res.body.payload as LayoutPlanEditContextResponsePayload;
      expect(payload.connectorDefinitionSlug).toBe("microsoft-excel");
      expect(payload.editable).toBe(true);
      expect(payload.workbookPreview!.sheets).toHaveLength(1);
      expect(payload.uploadSessionId).toBeUndefined();
    });

    it("case 3 — file-upload connector: editable:false with UNSUPPORTED_CONNECTOR reason", async () => {
      // File-upload was removed from `EDITABLE_SLUGS` — the original
      // CSV / XLSX is a one-shot artifact and there's no live
      // upstream to reshape the plan against. The endpoint returns
      // the unsupported notice for any file-upload instance now,
      // regardless of whether the source files still exist.
      const seeded = await seedConnectorInstanceWithSlug("file-upload");
      const planId = await seedPlanRow(seeded.instanceId);
      const uploadSessionId = generateId();
      const uploadId = generateId();
      await (db as Db).insert(schema.fileUploads).values({
        id: uploadId,
        organizationId,
        filename: "models.csv",
        contentType: "text/csv",
        sizeBytes: 100,
        s3Key: `uploads/${organizationId}/${uploadId}/models.csv`,
        status: "parsed",
        uploadSessionId,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      seedWorkbookCache(`upload-session:${uploadSessionId}`, makeWorkbook());
      await seedPriorLayoutPlanCommitJob(
        seeded.instanceId,
        uploadSessionId,
        planId
      );

      const res = await request(app)
        .get(
          `/api/connector-instances/${seeded.instanceId}/layout-plan/edit-context`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const payload =
        res.body.payload as LayoutPlanEditContextResponsePayload;
      expect(payload.connectorDefinitionSlug).toBe("file-upload");
      expect(payload.editable).toBe(false);
      expect(payload.workbookPreview).toBeNull();
      expect(payload.reason?.code).toBe("UNSUPPORTED_CONNECTOR");
    });

    it("case 5 — plan missing: returns 404 LAYOUT_PLAN_NOT_FOUND", async () => {
      const seeded = await seedConnectorInstanceWithSlug("google-sheets");
      // No plan row inserted.

      const res = await request(app)
        .get(
          `/api/connector-instances/${seeded.instanceId}/layout-plan/edit-context`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_NOT_FOUND);
    });

    it("case 6 — cross-org: returns 404 LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND", async () => {
      // Seed a second org with its own instance.
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
        .get(
          `/api/connector-instances/${otherInstance.id}/layout-plan/edit-context`
        )
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(
        ApiCode.LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND
      );
    });
  });
});
