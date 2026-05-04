/**
 * Integration tests for `microsoftExcelAdapter.syncInstance`.
 *
 * Mirrors `google-sheets-sync.integration.test.ts` — exercises the real
 * sync pipeline (eligibility → fetch → commit → reap → mark) against
 * Postgres. Mocks the network seam (access-token cache + Graph head/
 * download + xlsx adapter) so we don't need a real Microsoft account or
 * .xlsx fixture; the rest of the code path is real.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { LayoutPlan } from "@portalai/core/contracts";
import type { WorkbookData } from "@portalai/spreadsheet-parsing";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|mexcel-sync-test-user";

// In-memory Redis shim (workbook cache + access-token cache route through
// getRedisClient). Sync doesn't read the workbook cache, but the cache
// service touches Redis on every refresh path.
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

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

// Mock the access-token cache so we never hit Microsoft's OAuth endpoint.
const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();
jest.unstable_mockModule(
  "../../../services/microsoft-access-token-cache.service.js",
  () => ({
    MicrosoftAccessTokenCacheService: { getOrRefresh: getOrRefreshMock },
  })
);

// Mock the Graph service — head + download — so we don't need network.
const headWorkbookMock =
  jest.fn<
    (
      accessToken: string,
      driveItemId: string
    ) => Promise<{ size: number; name: string }>
  >();
const downloadWorkbookMock =
  jest.fn<
    (
      accessToken: string,
      driveItemId: string
    ) => Promise<{
      stream: ReadableStream<Uint8Array>;
      contentLength: number;
    }>
  >();
class MockMicrosoftGraphError extends Error {
  override readonly name = "MicrosoftGraphError" as const;
  readonly kind: string;
  readonly details?: Record<string, unknown>;
  constructor(
    kind: string,
    message?: string,
    details?: Record<string, unknown>
  ) {
    super(message ?? kind);
    this.kind = kind;
    if (details) this.details = details;
  }
}
jest.unstable_mockModule("../../../services/microsoft-graph.service.js", () => ({
  MicrosoftGraphService: {
    headWorkbook: headWorkbookMock,
    downloadWorkbook: downloadWorkbookMock,
    searchWorkbooks: jest.fn(),
    toNodeReadable: (stream: ReadableStream<Uint8Array>) => stream,
  },
  MicrosoftGraphError: MockMicrosoftGraphError,
}));

// Mock the xlsx adapter so we don't need a real .xlsx byte fixture —
// instead each test passes the WorkbookData it wants the parse to yield.
const xlsxToWorkbookMock =
  jest.fn<(stream: unknown) => Promise<WorkbookData>>();
jest.unstable_mockModule(
  "../../../services/workbook-adapters/xlsx.adapter.js",
  () => ({ xlsxToWorkbook: xlsxToWorkbookMock })
);

const { environment } = await import("../../../environment.js");
environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const { microsoftExcelAdapter } = await import(
  "../../../adapters/microsoft-excel/microsoft-excel.adapter.js"
);

const {
  connectorInstances,
  connectorDefinitions,
  connectorInstanceLayoutPlans,
  connectorEntities,
  entityRecords,
  columnDefinitions,
} = schema;

type Db = ReturnType<typeof drizzle>;

const now = Date.now();

function makePlan(opts: {
  emailColumnDefinitionId: string;
  nameColumnDefinitionId: string;
  identityKind?: "column" | "rowPosition";
}): LayoutPlan {
  const identity =
    opts.identityKind === "rowPosition"
      ? { kind: "rowPosition" as const, confidence: 0.3 }
      : {
          kind: "column" as const,
          sourceLocator: {
            kind: "column" as const,
            sheet: "Sheet1",
            col: 1,
          },
          confidence: 0.9,
        };
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
        targetEntityDefinitionId: "people",
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
        identityStrategy: identity,
        columnBindings: [
          {
            sourceLocator: {
              kind: "byHeaderName",
              axis: "row",
              name: "email",
            },
            columnDefinitionId: opts.emailColumnDefinitionId,
            confidence: 0.9,
          },
          {
            sourceLocator: {
              kind: "byHeaderName",
              axis: "row",
              name: "name",
            },
            columnDefinitionId: opts.nameColumnDefinitionId,
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
  } as unknown as LayoutPlan;
}

/**
 * Build a WorkbookData with header row [email, name] + the supplied
 * rows. Coordinates are 1-indexed per WorkbookSchema (row 1 = header,
 * data starts at row 2).
 */
function makeWorkbook(rows: { email: string; name: string }[]): WorkbookData {
  const cells = [
    { row: 1, col: 1, value: "email" },
    { row: 1, col: 2, value: "name" },
  ];
  rows.forEach((row, i) => {
    cells.push({ row: i + 2, col: 1, value: row.email });
    cells.push({ row: i + 2, col: 2, value: row.name });
  });
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 1 + rows.length, cols: 2 },
        cells,
      } as never,
    ],
  } as WorkbookData;
}

function fakeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0x50, 0x4b]));
      controller.close();
    },
  });
}

async function seedColumnDefinition(
  db: Db,
  organizationId: string,
  key: string
): Promise<string> {
  const id = generateId();
  await db.insert(columnDefinitions).values({
    id,
    organizationId,
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    type: "string",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: false,
    enumValues: null,
    referenceEntityKey: null,
    referenceFieldKey: null,
    created: now,
    createdBy: "test",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  return id;
}

describe("microsoftExcelAdapter.syncInstance", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let organizationId: string;
  let userId: string;
  let connectorDefinitionId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    redisStore.clear();
    getOrRefreshMock.mockReset();
    headWorkbookMock.mockReset();
    downloadWorkbookMock.mockReset();
    xlsxToWorkbookMock.mockReset();

    getOrRefreshMock.mockResolvedValue("eyJ.access");
    headWorkbookMock.mockResolvedValue({
      size: 1024,
      name: "People.xlsx",
    });
    downloadWorkbookMock.mockResolvedValue({
      stream: fakeStream(),
      contentLength: 1024,
    });

    await teardownOrg(db);
    const seed = await seedUserAndOrg(db, AUTH0_ID);
    organizationId = seed.organizationId;
    userId = seed.userId;

    connectorDefinitionId = generateId();
    await db.insert(connectorDefinitions).values({
      id: connectorDefinitionId,
      slug: "microsoft-excel",
      display: "Microsoft 365 Excel",
      category: "File-based",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true, read: true, write: false, push: false },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  /** Seed a microsoft-excel instance + plan + initial records. */
  async function seedCommittedInstance(opts: {
    rows: { email: string; name: string }[];
    identityKind?: "column" | "rowPosition";
    instanceLastErrorMessage?: string | null;
  }): Promise<{
    instance: schema.ConnectorInstanceSelect;
    planId: string;
    entityId: string;
  }> {
    const emailId = await seedColumnDefinition(db, organizationId, "email");
    const nameId = await seedColumnDefinition(db, organizationId, "name");

    const instanceId = generateId();
    await db.insert(connectorInstances).values({
      id: instanceId,
      connectorDefinitionId,
      organizationId,
      name: "Microsoft 365 Excel sync test",
      status: "active" as const,
      config: { driveItemId: "01ABC", name: "People.xlsx", fetchedAt: now },
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: opts.instanceLastErrorMessage ?? null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const planId = generateId();
    await db.insert(connectorInstanceLayoutPlans).values({
      id: planId,
      connectorInstanceId: instanceId,
      planVersion: "1.0.0",
      revisionTag: null,
      plan: makePlan({
        emailColumnDefinitionId: emailId,
        nameColumnDefinitionId: nameId,
        identityKind: opts.identityKind,
      }) as never,
      interpretationTrace: null,
      supersededBy: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const entityId = generateId();
    await db.insert(connectorEntities).values({
      id: entityId,
      organizationId,
      connectorInstanceId: instanceId,
      key: "people",
      label: "People",
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const initialSyncedAt = now - 1000;
    for (const row of opts.rows) {
      await db.insert(entityRecords).values({
        id: generateId(),
        organizationId,
        connectorEntityId: entityId,
        data: { email: row.email, name: row.name },
        normalizedData: { email: row.email, name: row.name },
        sourceId: row.email,
        checksum: `cs:${row.email}:${row.name}`,
        syncedAt: initialSyncedAt,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: initialSyncedAt,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }

    const [instance] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instanceId));
    return { instance: instance!, planId, entityId };
  }

  it("happy path: writes new rows, reaps absent rows, threads through head + download", async () => {
    // Plan bounds are rows 1..3 (header + 2 data rows). Stay within them
    // so we can assert created/deleted deterministically without drift.
    const { instance, entityId } = await seedCommittedInstance({
      rows: [
        { email: "alice@example.com", name: "Alice" },
        { email: "bob@example.com", name: "Bob" },
      ],
    });

    // Fresh fetch: alice persists (renamed), bob is gone, dan is new.
    xlsxToWorkbookMock.mockResolvedValueOnce(
      makeWorkbook([
        { email: "alice@example.com", name: "Alice Renamed" },
        { email: "dan@example.com", name: "Dan" },
      ])
    );

    const result = await microsoftExcelAdapter.syncInstance!(instance, userId);

    // dan is new, bob is reaped, alice persists (updated or unchanged
    // depending on how the commit pipeline computes the checksum).
    expect(result.recordCounts.created).toBe(1); // dan
    expect(result.recordCounts.deleted).toBe(1); // bob
    expect(
      result.recordCounts.updated + result.recordCounts.unchanged
    ).toBe(1); // alice

    expect(headWorkbookMock).toHaveBeenCalled();
    expect(downloadWorkbookMock).toHaveBeenCalled();

    // Verify the records table reflects the fresh state.
    const liveRows = await db
      .select()
      .from(entityRecords)
      .where(eq(entityRecords.connectorEntityId, entityId));
    const live = liveRows.filter((r) => r.deleted === null);
    const reaped = liveRows.filter((r) => r.deleted !== null);
    const liveEmails = new Set(live.map((r) => r.sourceId));
    expect(liveEmails.has("alice@example.com")).toBe(true);
    expect(liveEmails.has("dan@example.com")).toBe(true);
    expect(reaped.some((r) => r.sourceId === "bob@example.com")).toBe(true);
  });

  it("updates lastSyncAt + clears lastErrorMessage on success", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
      instanceLastErrorMessage: "stale error from a prior run",
    });
    xlsxToWorkbookMock.mockResolvedValueOnce(
      makeWorkbook([{ email: "alice@example.com", name: "Alice" }])
    );

    const beforeSync = Date.now();
    await microsoftExcelAdapter.syncInstance!(instance, userId);

    const [after] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instance.id));
    expect(after?.lastSyncAt).not.toBeNull();
    expect(after!.lastSyncAt!).toBeGreaterThanOrEqual(beforeSync);
    expect(after?.lastErrorMessage).toBeNull();
  });

  it("propagates 413 MICROSOFT_EXCEL_FILE_TOO_LARGE without flipping lastSyncAt", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
    });

    headWorkbookMock.mockResolvedValueOnce({
      size: 600 * 1024 * 1024,
      name: "People.xlsx",
    });

    try {
      await microsoftExcelAdapter.syncInstance!(instance, userId);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(413);
      expect((err as { code?: string }).code).toBe(
        "MICROSOFT_EXCEL_FILE_TOO_LARGE"
      );
    }

    const [after] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instance.id));
    expect(after?.lastSyncAt).toBeNull();
    // download must not have been attempted.
    expect(downloadWorkbookMock).not.toHaveBeenCalled();
  });

  it("refuses with LAYOUT_PLAN_NOT_FOUND when no plan is committed", async () => {
    // Seed an instance but no plan.
    const instanceId = generateId();
    await db.insert(connectorInstances).values({
      id: instanceId,
      connectorDefinitionId,
      organizationId,
      name: "no-plan",
      status: "pending" as const,
      config: { driveItemId: "01ABC", name: "x.xlsx", fetchedAt: now },
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const [instance] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instanceId));

    try {
      await microsoftExcelAdapter.syncInstance!(instance!, userId);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("LAYOUT_PLAN_NOT_FOUND");
    }
    expect(headWorkbookMock).not.toHaveBeenCalled();
  });

  it("calls progress with monotonically-increasing percents through 100", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
    });
    xlsxToWorkbookMock.mockResolvedValueOnce(
      makeWorkbook([{ email: "alice@example.com", name: "Alice" }])
    );

    const calls: number[] = [];
    await microsoftExcelAdapter.syncInstance!(instance, userId, (p) =>
      calls.push(p)
    );
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(100);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]!);
    }
  });

  it("on rowPosition plans, surfaces identityWarnings on the eligibility check (advisory)", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [],
      identityKind: "rowPosition",
    });
    const eligibility =
      await microsoftExcelAdapter.assertSyncEligibility!(instance);
    expect(eligibility.ok).toBe(true);
    expect(eligibility.identityWarnings).toEqual([{ regionId: "r1" }]);
  });
});
