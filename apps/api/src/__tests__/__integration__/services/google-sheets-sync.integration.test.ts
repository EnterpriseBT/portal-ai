/**
 * Integration tests for `googleSheetsAdapter.syncInstance`.
 *
 * The watermark behavior demands real SQL — this is a full integration
 * suite that seeds an instance + plan + records and walks through the
 * three sync delta cases (added / updated / removed) plus the guard,
 * the lastSyncAt update, and the multi-entity per-instance shape.
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
import { and, eq, isNull } from "drizzle-orm";
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

const AUTH0_ID = "auth0|gsheets-sync-test-user";

// In-memory Redis shim — the workbook cache + access-token cache both
// route through getRedisClient. We don't use the cache for sync (sync
// fetches fresh from Google), but the access-token cache reads from
// Redis even when getOrRefresh is mocked elsewhere — so the shim is
// still required to avoid a real Redis connection.
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

// Encryption key so credentials encrypt/decrypt round-trip.
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

// Mock the access-token cache so we never touch Google's OAuth.
const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();
jest.unstable_mockModule(
  "../../../services/google-access-token-cache.service.js",
  () => ({
    GoogleAccessTokenCacheService: { getOrRefresh: getOrRefreshMock },
  })
);

// Capture global fetch for the spreadsheets.get call inside
// fetchWorkbookForSync. The adapter always uses the default fetch —
// no injection seam at the adapter call site — so we patch globalThis.fetch.
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

const { environment } = await import("../../../environment.js");
environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const { googleSheetsAdapter } = await import(
  "../../../adapters/google-sheets/google-sheets.adapter.js"
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
            sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
            columnDefinitionId: opts.emailColumnDefinitionId,
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
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

function makeWorkbook(rows: { email: string; name: string }[]): WorkbookData {
  const cells: WorkbookData["sheets"][number]["cells"] = [
    { row: 1, col: 1, value: "email" },
    { row: 1, col: 2, value: "name" },
  ];
  for (let i = 0; i < rows.length; i++) {
    cells.push({ row: 2 + i, col: 1, value: rows[i]!.email });
    cells.push({ row: 2 + i, col: 2, value: rows[i]!.name });
  }
  return {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 1 + rows.length, cols: 2 },
        cells,
      },
    ],
  };
}

/** Mocks the Sheets API's `spreadsheets.get` response. */
function mockSheetsApiResponse(rows: { email: string; name: string }[]) {
  const rowData = [
    {
      values: [
        { effectiveValue: { stringValue: "email" }, formattedValue: "email" },
        { effectiveValue: { stringValue: "name" }, formattedValue: "name" },
      ],
    },
    ...rows.map((r) => ({
      values: [
        { effectiveValue: { stringValue: r.email }, formattedValue: r.email },
        { effectiveValue: { stringValue: r.name }, formattedValue: r.name },
      ],
    })),
  ];
  return {
    properties: { title: "People" },
    sheets: [
      {
        properties: {
          title: "Sheet1",
          gridProperties: { rowCount: 1 + rows.length, columnCount: 2 },
        },
        data: [{ startRow: 0, startColumn: 0, rowData }],
      },
    ],
  };
}

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
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

describe("googleSheetsAdapter.syncInstance", () => {
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
    fetchMock.mockReset();
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await teardownOrg(db);
    const seed = await seedUserAndOrg(db, AUTH0_ID);
    organizationId = seed.organizationId;
    userId = seed.userId;

    connectorDefinitionId = generateId();
    await db.insert(connectorDefinitions).values({
      id: connectorDefinitionId,
      slug: "google-sheets",
      display: "Google Sheets",
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
    globalThis.fetch = originalFetch;
    await connection.end();
  });

  /** Seed a connector instance + plan + initial records (post-commit state). */
  async function seedCommittedInstance(opts: {
    rows: { email: string; name: string }[];
    identityKind?: "column" | "rowPosition";
    instanceLastErrorMessage?: string | null;
  }): Promise<{
    instance: schema.ConnectorInstanceSelect;
    planId: string;
    entityId: string;
    emailColumnDefinitionId: string;
    nameColumnDefinitionId: string;
  }> {
    const emailColumnDefinitionId = await seedColumnDefinition(
      db,
      organizationId,
      "email"
    );
    const nameColumnDefinitionId = await seedColumnDefinition(
      db,
      organizationId,
      "name"
    );

    const instanceId = generateId();
    await db.insert(connectorInstances).values({
      id: instanceId,
      connectorDefinitionId,
      organizationId,
      name: "GS sync test",
      status: "active" as const,
      config: { spreadsheetId: "1abc", title: "People", fetchedAt: now },
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
        emailColumnDefinitionId,
        nameColumnDefinitionId,
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

    // Seed initial records as if commit had already run, with an early
    // syncedAt so the sync's watermark is unambiguously "after" them.
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
    return {
      instance: instance!,
      planId,
      entityId,
      emailColumnDefinitionId,
      nameColumnDefinitionId,
    };
  }

  it("refuses sync when the plan has any rowPosition-identity region", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
      identityKind: "rowPosition",
    });

    await expect(
      googleSheetsAdapter.syncInstance!(instance, userId)
    ).rejects.toMatchObject({
      status: 409,
      code: ApiCode.LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY,
    });

    // No fetch attempted (refusal happens before the network call).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates lastSyncAt + clears lastErrorMessage on success", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
      instanceLastErrorMessage: "stale error from a prior run",
    });

    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        mockSheetsApiResponse([
          { email: "alice@example.com", name: "Alice" },
        ])
      )
    );

    const beforeSync = Date.now();
    await googleSheetsAdapter.syncInstance!(instance, userId);

    const [after] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instance.id));
    expect(after?.lastSyncAt).not.toBeNull();
    expect(after!.lastSyncAt!).toBeGreaterThanOrEqual(beforeSync);
    expect(after?.lastErrorMessage).toBeNull();
  });

  it("calls progress with monotonically-increasing percents through 100", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
    });
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        mockSheetsApiResponse([
          { email: "alice@example.com", name: "Alice" },
        ])
      )
    );

    const calls: number[] = [];
    await googleSheetsAdapter.syncInstance!(instance, userId, (p) =>
      calls.push(p)
    );

    expect(calls.length).toBeGreaterThan(2);
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(100);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]!);
    }
  });

  it("on rowPosition refusal, lastSyncAt is not updated", async () => {
    const { instance } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
      identityKind: "rowPosition",
    });
    await expect(
      googleSheetsAdapter.syncInstance!(instance, userId)
    ).rejects.toThrow();
    const [after] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instance.id));
    expect(after?.lastSyncAt).toBeNull();
  });

  it("does NOT reap unchanged rows — bumps their syncedAt to the run watermark", async () => {
    // Reproduces the production bug where the second sync against an
    // unmodified workbook reported "N unchanged, N removed" — i.e. every
    // record the user already had was detected as unchanged (no
    // checksum delta) but then immediately reaped by the watermark
    // sweep because its `synced_at` didn't advance past the run start.
    // Run a first sync to seed `entity_records` via the real commit
    // pipeline — that's the only way to land them with a checksum that
    // matches what the next replay() will compute, which in turn is the
    // only way the second sync will classify them as `unchanged`.
    const { instance, entityId } = await seedCommittedInstance({ rows: [] });
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        mockSheetsApiResponse([
          { email: "alice@example.com", name: "Alice" },
          { email: "bob@example.com", name: "Bob" },
        ])
      )
    );
    await googleSheetsAdapter.syncInstance!(instance, userId);

    const liveBefore = await db
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.connectorEntityId, entityId),
          isNull(entityRecords.deleted)
        )
      );
    expect(liveBefore).toHaveLength(2);
    const syncedAtBefore = liveBefore[0]!.syncedAt;

    // Second sync against the SAME workbook — every row should classify
    // as unchanged (same checksum as the rows we just committed).
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        mockSheetsApiResponse([
          { email: "alice@example.com", name: "Alice" },
          { email: "bob@example.com", name: "Bob" },
        ])
      )
    );
    const out = await googleSheetsAdapter.syncInstance!(instance, userId);

    // The user's bug: this came back as `0 added, 0 updated, 2
    // unchanged, 2 removed` — every unchanged row was reaped because
    // its `synced_at` didn't advance past the run watermark.
    expect(out.recordCounts.deleted).toBe(0);
    expect(out.recordCounts.unchanged).toBe(2);

    const liveAfter = await db
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.connectorEntityId, entityId),
          isNull(entityRecords.deleted)
        )
      );
    expect(liveAfter).toHaveLength(2);
    // Every survivor's `synced_at` advanced past the prior sync.
    for (const row of liveAfter) {
      expect(row.syncedAt).toBeGreaterThan(syncedAtBefore);
    }
  });

  it("resurrects soft-deleted records on the same (connector_entity_id, source_id) instead of duplicate-key-erroring", async () => {
    // Reproduces the production bug where the user manually cleared all
    // records for an entity (soft-deleting them) and then triggered a
    // sync. Without resurrection logic, the upsert collides on the
    // primary key because the partial unique index `WHERE deleted IS
    // NULL` doesn't match the soft-deleted row but the bulk INSERT
    // reuses its id.
    const { instance, entityId } = await seedCommittedInstance({
      rows: [{ email: "alice@example.com", name: "Alice" }],
    });

    // Fetch the existing row's id so we can assert it's preserved.
    const [originalRow] = await db
      .select()
      .from(entityRecords)
      .where(eq(entityRecords.connectorEntityId, entityId));
    const originalId = originalRow!.id;

    // Soft-delete the record (mirrors the "clear all records" route).
    await db
      .update(entityRecords)
      .set({ deleted: Date.now(), deletedBy: userId })
      .where(eq(entityRecords.id, originalId));

    // Sync against the same workbook — the source still has Alice.
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(
        mockSheetsApiResponse([{ email: "alice@example.com", name: "Alice" }])
      )
    );

    const out = await googleSheetsAdapter.syncInstance!(instance, userId);

    // The original soft-deleted row is now resurrected (same id, deleted
    // cleared) — no duplicate-key error. The exact `created` tally is
    // implementation-defined (replay may produce extra synthetic records
    // for empty cells inside the plan's bounds), so we only assert that
    // resurrection produced no duplicates and no key collisions.
    expect(out).toBeDefined();

    const liveRows = await db
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.connectorEntityId, entityId),
          isNull(entityRecords.deleted)
        )
      );
    const aliceRows = liveRows.filter(
      (r) => r.sourceId === "alice@example.com"
    );
    expect(aliceRows).toHaveLength(1); // resurrected, not duplicated
    expect(aliceRows[0]?.id).toBe(originalId); // same id preserved
    expect(aliceRows[0]?.deleted).toBeNull();
    expect(aliceRows[0]?.deletedBy).toBeNull();
  });
});
