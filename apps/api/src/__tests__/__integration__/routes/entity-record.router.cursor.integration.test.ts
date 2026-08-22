/**
 * Route-level tests for cursor pagination on the entity-record list (#433).
 *
 * The repository-level walk is covered by
 * `entity-records.keyset.integration.test.ts`. What this file pins is the
 * HTTP contract around it:
 *
 *  - `nextCursor` is minted while there is a next page and `null` at the end;
 *  - following it yields the next page with no overlap and no gap;
 *  - a cursor that no longer means anything — minted under a different sort,
 *    or corrupted in transit — **serves the first page**, status 200, no
 *    error code. A cursor rides in a URL that users edit, bookmark and share,
 *    so an unusable one is a stale address, not a client error.
 */

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
import { sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-cursor-user";

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

const { app } = await import("../../../app.js");

const RECORD_COUNT = 7;

describe("GET /api/connector-entities/:id/records — cursors (#433)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let entityId: string;

  const url = () => `/api/connector-entities/${entityId}/records`;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    reconciler = new WideTableReconcilerService();

    const dbTyped = db as ReturnType<typeof drizzle>;
    await teardownOrg(dbTyped);

    const seeded = await seedUserAndOrg(dbTyped, AUTH0_ID);
    orgId = seeded.organizationId;
    const now = Date.now();

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `cursor-${generateId().slice(0, 8)}`,
      display: "Cursor",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: { sync: true, write: true },
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

    const ciId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: ciId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Cursor",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      // Write-enabled so the create route can exercise count invalidation.
      enabledCapabilityFlags: { write: true },
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: ciId,
      key: `cursor_${generateId().slice(0, 6)}`,
      label: "Cursor",
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    await reconciler.ensureTable(entityId, db);

    // All rows share `created` so the default sort is fully tied — the
    // tiebreaker is what makes the walk deterministic.
    for (let i = 0; i < RECORD_COUNT; i++) {
      const id = generateId();
      const sourceId = `src-${String(i).padStart(3, "0")}`;
      await dbTyped.insert(schema.entityRecords).values({
        id,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { bulky: "x".repeat(64) },
        sourceId,
        checksum: "c",
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      await dbTyped.execute(
        sql`INSERT INTO ${sql.identifier(`er__${entityId}`)}
            ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id")
            VALUES (${id}, ${orgId}, ${now}, true, ${sourceId})`
      );
    }
  });

  afterEach(async () => {
    await reconciler.dropTable(entityId, db).catch(() => undefined);
    wideTableStatementCache.clear();
    await connection.end();
  });

  it("mints a nextCursor while more rows remain", async () => {
    const res = await request(app).get(url()).query({ limit: 3 }).expect(200);

    expect(res.body.payload.records).toHaveLength(3);
    expect(typeof res.body.payload.nextCursor).toBe("string");
  });

  it("returns nextCursor: null on the final page", async () => {
    const res = await request(app)
      .get(url())
      .query({ limit: RECORD_COUNT })
      .expect(200);

    expect(res.body.payload.records).toHaveLength(RECORD_COUNT);
    expect(res.body.payload.nextCursor).toBeNull();
  });

  it("walks the whole entity by cursor with no overlap and no gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (;;) {
      const query: Record<string, unknown> = { limit: 3 };
      if (cursor) query.cursor = cursor;
      const res = await request(app).get(url()).query(query).expect(200);

      const ids = res.body.payload.records.map((r: { id: string }) => r.id);
      seen.push(...ids);
      cursor = res.body.payload.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(RECORD_COUNT);
    expect(new Set(seen).size).toBe(RECORD_COUNT);
  });

  it("keeps `total` stable across cursor pages", async () => {
    const first = await request(app).get(url()).query({ limit: 3 }).expect(200);
    const second = await request(app)
      .get(url())
      .query({ limit: 3, cursor: first.body.payload.nextCursor })
      .expect(200);

    expect(first.body.payload.total).toBe(RECORD_COUNT);
    expect(second.body.payload.total).toBe(RECORD_COUNT);
  });

  it("ships no raw `data` payload in list rows", async () => {
    const res = await request(app).get(url()).query({ limit: 3 }).expect(200);

    for (const record of res.body.payload.records) {
      expect(record).not.toHaveProperty("data");
      expect(record).toHaveProperty("normalizedData");
    }
  });

  // ── Fail open ────────────────────────────────────────────────────

  it("ignores a cursor minted under a different sort, serving the first page", async () => {
    const first = await request(app)
      .get(url())
      .query({ limit: 3, sortBy: "created" })
      .expect(200);

    const reused = await request(app)
      .get(url())
      .query({
        limit: 3,
        sortBy: "sourceId",
        cursor: first.body.payload.nextCursor,
      })
      .expect(200);

    const baseline = await request(app)
      .get(url())
      .query({ limit: 3, sortBy: "sourceId" })
      .expect(200);

    expect(reused.body.success).toBe(true);
    expect(
      reused.body.payload.records.map((r: { id: string }) => r.id)
    ).toEqual(baseline.body.payload.records.map((r: { id: string }) => r.id));
  });

  it("ignores a cursor minted under a different sort direction", async () => {
    const first = await request(app)
      .get(url())
      .query({ limit: 3, sortOrder: "asc" })
      .expect(200);

    const reused = await request(app)
      .get(url())
      .query({
        limit: 3,
        sortOrder: "desc",
        cursor: first.body.payload.nextCursor,
      })
      .expect(200);

    const baseline = await request(app)
      .get(url())
      .query({ limit: 3, sortOrder: "desc" })
      .expect(200);

    expect(
      reused.body.payload.records.map((r: { id: string }) => r.id)
    ).toEqual(baseline.body.payload.records.map((r: { id: string }) => r.id));
  });

  it("serves the first page for a corrupted cursor, without an error code", async () => {
    const baseline = await request(app)
      .get(url())
      .query({ limit: 3 })
      .expect(200);

    for (const bad of ["not-a-cursor", "%%%", "a".repeat(400)]) {
      const res = await request(app)
        .get(url())
        .query({ limit: 3, cursor: bad })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.records.map((r: { id: string }) => r.id)).toEqual(
        baseline.body.payload.records.map((r: { id: string }) => r.id)
      );
    }
  });

  it("keeps `total` correct after a write invalidates the cached count", async () => {
    // The count is cached per (entity, filter set) so paging doesn't re-run a
    // full count. A write has to drop it, or the toolbar would report a stale
    // page count for up to the TTL.
    const before = await request(app)
      .get(url())
      .query({ limit: 3 })
      .expect(200);
    expect(before.body.payload.total).toBe(RECORD_COUNT);

    const created = await request(app)
      .post(url())
      .send({ normalizedData: {}, sourceId: "src-new" });
    expect(created.body.success).toBe(true);

    const after = await request(app).get(url()).query({ limit: 3 }).expect(200);
    expect(after.body.payload.total).toBe(RECORD_COUNT + 1);
  });

  it("still serves offset pagination unchanged", async () => {
    // `cursor` is additive — every existing caller keeps working.
    const page1 = await request(app)
      .get(url())
      .query({ limit: 3, offset: 0 })
      .expect(200);
    const page2 = await request(app)
      .get(url())
      .query({ limit: 3, offset: 3 })
      .expect(200);

    const ids1 = page1.body.payload.records.map((r: { id: string }) => r.id);
    const ids2 = page2.body.payload.records.map((r: { id: string }) => r.id);
    expect(ids1).toHaveLength(3);
    expect(ids2).toHaveLength(3);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });
});
