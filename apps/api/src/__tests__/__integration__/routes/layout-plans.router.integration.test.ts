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
import type { LayoutPlanCommitDraftRequestBody } from "@portalai/core/contracts";

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

// In-memory Redis shim — caches both the legacy single-blob workbook
// (used by google-sheets / microsoft-excel pipelines) and the chunked
// upload-session layout that file-upload uses post-Phase-2 (see
// docs/LARGE_FILE_PARSE_STREAMING.plan.md). Supports the methods the
// chunked cache exercises: set / get / mget / del (variadic) /
// scanStream.
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
// Dynamic import so this lands AFTER `jest.unstable_mockModule` has
// registered the redis / S3 / auth0 / interpret mocks above. A static
// import would resolve before any mocks register, which leaves the
// service holding a real Redis client (cache misses everything →
// commit/interpret fall through to the real S3 path).
const { LayoutPlanDraftService } = await import(
  "../../../services/layout-plan-draft.service.js"
);

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

function makeConnectorDefinition(id = generateId(), slug = "google-sheets") {
  return {
    id,
    slug,
    display: slug,
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
        targetEntityDefinitionId: "contacts",
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
 * Seed an upload session — writes one `file_uploads` row + populates
 * the chunked Redis layout the file-upload pipeline reads from
 * post-Phase-2 (`docs/LARGE_FILE_PARSE_STREAMING.plan.md`):
 *
 *   - `upload-session:{id}:meta`                            session meta
 *   - `upload-session:{id}:sheet:{sheetId}:rows:{0}`        dense row chunk
 *
 * Sheet ids are minted via the same `sheetId()` helper the production
 * pipeline uses. `resolveWorkbook` reads these directly without needing
 * the mocked S3 path.
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

  const prefix = `upload-session:${uploadSessionId}`;
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
    const sheetId = sheetMetas[i]!.sheetId;
    const denseRows = sparseToDenseRows(sheet);
    // Seeded workbooks fit in a single chunk (default ROWS_PER_CHUNK=1000);
    // tests don't drive sessions that span the chunk boundary.
    redisStore.set(
      `${prefix}:sheet:${sheetId}:rows:0`,
      JSON.stringify(denseRows)
    );
  });
  return uploadSessionId;
}

/** Mirrors `sheetId` in workbook-preview.util.ts. */
function sheetIdOf(index: number, name: string): string {
  const slug = name.replace(/\s+/g, "_").toLowerCase();
  return `sheet_${index}_${slug}`;
}

/** Build dense row layout from a sparse `WorkbookData` sheet for cache seeding. */
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
    if (v === null || v === undefined) {
      dense[r]![c] = null;
    } else if (v instanceof Date) {
      dense[r]![c] = v.toISOString();
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      dense[r]![c] = v;
    } else {
      dense[r]![c] = String(v);
    }
  }
  return dense;
}

describe("Layout Plans Draft Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let organizationId: string;
  let userId: string;
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
    userId = seed.userId;

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

  /**
   * Drives the draft commit pipeline through the same code path the
   * `layout_plan_commit` worker takes — `prepareDraftCommit`
   * (synchronous validation + UUID minting; the route's call) followed
   * by `runCommitDraft` (instance + plan rows + records-write +
   * rollback; the worker's call). Behavior assertions can use this
   * directly without round-tripping through Bull. The HTTP route's
   * 202 + jobId envelope is exercised by the dedicated test below.
   * Defined at the outer describe scope so both the uploadSessionId
   * and connectorInstanceId paths reuse the same helper.
   */
  async function runDraftCommitInline(body: LayoutPlanCommitDraftRequestBody) {
    const prepared = await LayoutPlanDraftService.prepareDraftCommit(
      organizationId,
      userId,
      body
    );
    return LayoutPlanDraftService.runCommitDraft(prepared.metadata);
  }

  describe("POST /api/layout-plans/commit", () => {
    it("returns 202 with { connectorInstanceId, planId, jobId, status: pending } and persists a layout_plan_commit job", async () => {
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
          name: "Async commit",
          plan: makePlan(emailId, nameId),
          uploadSessionId,
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toEqual({
        connectorInstanceId: expect.any(String),
        planId: expect.any(String),
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
        kind: "draft",
        organizationId,
        connectorInstanceId: res.body.payload.connectorInstanceId,
        planId: res.body.payload.planId,
        connectorDefinitionId,
        name: "Async commit",
        isExistingInstance: false,
      });

      // Route creates the connector_instance + plan rows
      // synchronously (status="pending" for the fresh-create path)
      // so the client can navigate to /connectors/:id immediately and
      // see the lock alert. The worker flips to "active" on success
      // or hard-deletes on failure.
      const instances = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.name, "Async commit"));
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe(res.body.payload.connectorInstanceId);
      expect(instances[0].status).toBe("pending");
      const plans = await (db as Db)
        .select()
        .from(connectorInstanceLayoutPlans);
      expect(plans).toHaveLength(1);
      expect(plans[0].id).toBe(res.body.payload.planId);
      expect(plans[0].connectorInstanceId).toBe(
        res.body.payload.connectorInstanceId
      );
    });

    it("creates the ConnectorInstance + plan row and commits records atomically", async () => {
      const emailId = await seedColumnDefinition(db as Db, organizationId, "email");
      const nameId = await seedColumnDefinition(db as Db, organizationId, "name");
      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );

      const result = await runDraftCommitInline({
        connectorDefinitionId,
        name: "My CSV upload",
        plan: makePlan(emailId, nameId),
        uploadSessionId,
      });

      expect(result.connectorInstanceId).toBeDefined();
      expect(result.planId).toBeDefined();

      const instances = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.id, result.connectorInstanceId));
      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe("My CSV upload");
      expect(instances[0].organizationId).toBe(organizationId);

      const plans = await (db as Db)
        .select()
        .from(connectorInstanceLayoutPlans)
        .where(eq(connectorInstanceLayoutPlans.id, result.planId));
      expect(plans).toHaveLength(1);
      expect(plans[0].connectorInstanceId).toBe(result.connectorInstanceId);

      const entities = await (db as Db)
        .select()
        .from(connectorEntities)
        .where(eq(connectorEntities.connectorInstanceId, result.connectorInstanceId));
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
          sourceLocator: {
            kind: "byHeaderName",
            axis: "row",
            name: "Email Address",
          },
          columnDefinitionId: emailId,
          confidence: 0.9,
        },
        {
          sourceLocator: {
            kind: "byHeaderName",
            axis: "row",
            name: "Full Name",
          },
          columnDefinitionId: nameId,
          confidence: 0.9,
        },
      ];
      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        workbook
      );

      const result = await runDraftCommitInline({
        connectorDefinitionId,
        name: "Source-derived keys",
        plan,
        uploadSessionId,
      });
      const connectorInstanceId = result.connectorInstanceId;

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

      // `normalizedData` now lives on the wide table. Read via the
      // hydrated repo to verify the source-derived keys line up with
      // the FieldMapping rows.
      const { entityRecordsRepo } = await import(
        "../../../db/repositories/entity-records.repository.js"
      );
      const [hydrated] = await entityRecordsRepo.findHydratedMany(entity.id);
      expect(hydrated.normalizedData).toEqual({
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
          code: "SEGMENT_MISSING_AXIS_NAME",
          severity: "blocker",
          message: "Synthetic blocker for rollback test",
        },
      ];

      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );
      await expect(
        runDraftCommitInline({
          connectorDefinitionId,
          name: "Should not persist",
          plan: planWithBlocker,
          uploadSessionId,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: ApiCode.LAYOUT_PLAN_BLOCKER_WARNINGS,
      });

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

        await expect(
          runDraftCommitInline({
            connectorDefinitionId,
            name: "Duplicate target",
            plan,
            uploadSessionId,
          })
        ).rejects.toMatchObject({
          status: 400,
          code: ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY,
        });

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

        const result = await runDraftCommitInline({
          connectorDefinitionId,
          name: "Distinct targets baseline",
          plan: makePlan(emailId, nameId),
          uploadSessionId,
        });

        expect(result.connectorInstanceId).toBeDefined();
      });
    });
  });

  // ── connectorInstanceId path (google-sheets et al.) ────────────────

  /**
   * Seed a pending ConnectorInstance + populate the chunked workbook cache
   * under `connector:wb:<slug>:{id}` (Phase 4 layout — meta + per-sheet
   * row chunks). Slug controls which resolver the dispatcher picks
   * (google-sheets vs. microsoft-excel).
   */
  async function seedPendingConnectorInstance(
    db: Db,
    organizationId: string,
    workbook: WorkbookData,
    options: { definitionId?: string; slug?: string } = {}
  ): Promise<string> {
    const slug = options.slug ?? "google-sheets";
    let definitionId = options.definitionId;
    if (!definitionId) {
      const def = makeConnectorDefinition(generateId(), slug);
      await db.insert(connectorDefinitions).values(def as never);
      definitionId = def.id;
    }
    const instanceId = generateId();
    await db.insert(connectorInstances).values({
      id: instanceId,
      organizationId,
      connectorDefinitionId: definitionId,
      name: `Pending ${slug} instance`,
      status: "pending" as const,
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
    } as never);

    const prefix = `connector:wb:${slug}:${instanceId}`;
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
      const sheetId = sheetMetas[i]!.sheetId;
      redisStore.set(
        `${prefix}:sheet:${sheetId}:rows:0`,
        JSON.stringify(sparseToDenseRows(sheet))
      );
    });
    return instanceId;
  }


  describe("POST /api/layout-plans/interpret — connectorInstanceId path", () => {
    it("reads the workbook from connector:wb:google-sheets:{id} cache and returns the plan", async () => {
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
      mockAnalyze.mockResolvedValue(makePlan(emailId, nameId));

      const ciId = await seedPendingConnectorInstance(
        db as Db,
        organizationId,
        makeWorkbook(),
        { definitionId: connectorDefinitionId, slug: "google-sheets" }
      );

      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ connectorInstanceId: ciId, regionHints: [] });

      expect(res.status).toBe(200);
      expect(res.body.payload.plan.regions).toHaveLength(1);
    });

    it("rejects body with both uploadSessionId and connectorInstanceId", async () => {
      const ciId = await seedPendingConnectorInstance(
        db as Db,
        organizationId,
        makeWorkbook(),
        { definitionId: connectorDefinitionId, slug: "google-sheets" }
      );
      const uploadSessionId = await seedUploadSession(
        db as Db,
        organizationId,
        makeWorkbook()
      );

      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ connectorInstanceId: ciId, uploadSessionId, regionHints: [] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });

    it("rejects body with neither session id", async () => {
      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ regionHints: [] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD);
    });

    it("returns 404 when the connector instance does not exist", async () => {
      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ connectorInstanceId: "nonexistent", regionHints: [] });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    });

    it("dispatches to the microsoft-excel resolver when the connector definition slug is microsoft-excel", async () => {
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
      mockAnalyze.mockResolvedValue(makePlan(emailId, nameId));

      // Seed a microsoft-excel-shaped instance: cache key uses the
      // microsoft-excel slug so only the right dispatcher branch finds
      // it. If layout-plan-draft.service hardcoded gsheets again, the
      // cache lookup would miss and this would 404.
      const ciId = await seedPendingConnectorInstance(
        db as Db,
        organizationId,
        makeWorkbook(),
        { slug: "microsoft-excel" }
      );

      const res = await request(app)
        .post("/api/layout-plans/interpret")
        .set("Authorization", "Bearer test-token")
        .send({ connectorInstanceId: ciId, regionHints: [] });

      expect(res.status).toBe(200);
      expect(res.body.payload.plan.regions).toHaveLength(1);
    });
  });

  describe("POST /api/layout-plans/commit — connectorInstanceId path", () => {
    it("flips the pending instance to active without creating a new one", async () => {
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
      const ciId = await seedPendingConnectorInstance(
        db as Db,
        organizationId,
        makeWorkbook(),
        { definitionId: connectorDefinitionId, slug: "google-sheets" }
      );

      const result = await runDraftCommitInline({
        connectorDefinitionId,
        name: "GS commit",
        plan: makePlan(emailId, nameId),
        connectorInstanceId: ciId,
      });

      // Returns the SAME instance id — not a fresh one.
      expect(result.connectorInstanceId).toBe(ciId);

      const all = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId));
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe("active");
    });

    it("does not delete the pending instance when commit fails (rollback path)", async () => {
      const emailId = await seedColumnDefinition(
        db as Db,
        organizationId,
        "email"
      );
      // Use a definitely-bogus columnDefinitionId in the plan so commit fails.
      const ciId = await seedPendingConnectorInstance(
        db as Db,
        organizationId,
        makeWorkbook(),
        { definitionId: connectorDefinitionId, slug: "google-sheets" }
      );

      await expect(
        runDraftCommitInline({
          connectorDefinitionId,
          name: "GS bad",
          plan: makePlan(emailId, "nonexistent-cd"),
          connectorInstanceId: ciId,
        })
      ).rejects.toBeDefined();

      // Pending instance must STILL be present (rollback didn't remove it).
      const after = await (db as Db)
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.id, ciId));
      expect(after).toHaveLength(1);
      // And status remains pending — the success-path "flip to active" did not run.
      expect(after[0]?.status).toBe("pending");
    });

    it("returns 404 when the connectorInstanceId does not exist", async () => {
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

      await expect(
        runDraftCommitInline({
          connectorDefinitionId,
          name: "GS missing",
          plan: makePlan(emailId, nameId),
          connectorInstanceId: "nonexistent",
        })
      ).rejects.toMatchObject({
        status: 404,
        code: ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      });
    });
  });
});
