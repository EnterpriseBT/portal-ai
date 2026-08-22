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
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|portal-results-router-test";

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
const { stations, portals, portalMessages, portalResults } = schema;

const now = Date.now();

function createStation(organizationId: string) {
  return {
    id: generateId(),
    organizationId,
    name: "Test Station",
    description: null,
    toolPacks: ["data_query"],
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createPortal(organizationId: string, stationId: string) {
  return {
    id: generateId(),
    organizationId,
    stationId,
    name: "Test Portal",
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createPortalMessage(
  organizationId: string,
  portalId: string,
  role: "user" | "assistant",
  blocks: unknown[]
) {
  return {
    id: generateId(),
    organizationId,
    portalId,
    role,
    blocks,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createPortalResult(
  organizationId: string,
  stationId: string,
  portalId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    stationId,
    portalId,
    name: "My Result",
    type: "text" as const,
    content: { value: "hello" },
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

describe("Portal Results Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── POST /api/portal-results ──────────────────────────────────────

  describe("POST /api/portal-results (pin result)", () => {
    it("pins a block from the latest assistant message", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [{ type: "text", content: "Analysis complete." }]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "My Analysis" })
        .expect(201);

      expect(res.body.payload.portalResult).toBeDefined();
      expect(res.body.payload.portalResult.name).toBe("My Analysis");
      expect(res.body.payload.portalResult.stationId).toBe(station.id);
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: generateId(), blockIndex: 0, name: "X" })
        .expect(404);

      expect(res.body.code).toBe(ApiCode.PORTAL_NOT_FOUND);
    });

    it("returns 400 for out-of-range blockIndex", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [{ type: "text", content: "Hello" }]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 99, name: "X" })
        .expect(400);

      expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_BLOCK_INDEX_INVALID);
    });

    // #312 (supersedes the #273 gate): durable viz kinds now pin; the
    // server-side rejection remains for transient kinds, with the same
    // typed code.
    it("returns 400 PORTAL_RESULT_TYPE_NOT_PINNABLE for a transient block", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [
          { type: "text", content: "Import running." },
          {
            type: "bulk-job-progress",
            content: {
              jobId: "job-1",
              expectedRecords: 500,
            },
          },
        ]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 1, name: "My Import" })
        .expect(400);

      expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE);

      // The text block in the same message still pins.
      await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "The narrative" })
        .expect(201);
    });

    // #312: durable viz kinds pin end-to-end — the stored content is the
    // materialized inline shape and snapshotUpdatedAt is stamped.
    it("pins a d3 block with its materialized inline shape", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const pipeline = {
        sql: "SELECT 1 AS x",
        stationId: station.id,
        organizationId,
      };
      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [
          { type: "text", content: "Here is the chart." },
          {
            type: "d3",
            content: {
              program: "api.svg.append('g');",
              rows: [{ x: 1 }],
              pipeline,
            },
          },
        ]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 1, name: "My Chart" })
        .expect(201);

      const pr = res.body.payload.portalResult;
      expect(pr.type).toBe("d3");
      expect(pr.content.program).toBe("api.svg.append('g');");
      expect(pr.content.rows).toEqual([{ x: 1 }]);
      expect(pr.content.pipeline).toEqual(pipeline);
      expect(typeof pr.snapshotUpdatedAt).toBe("number");
    });

    // #312: a handle-backed table pins as a self-contained snapshot — the
    // ephemeral envelope is hydrated (real Redis) and never persisted.
    it("pins a handle-backed data-table as a materialized snapshot", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const { PortalSqlHandleService } =
        await import("../../../services/portal-sql-handle.service.js");
      const { envelope } = await PortalSqlHandleService.produceFromRows({
        rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
        stationId: station.id,
        organizationId,
      });

      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [{ type: "data-table", content: { ...envelope } }]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "My Table" })
        .expect(201);

      const pr = res.body.payload.portalResult;
      expect(pr.type).toBe("data-table");
      expect(pr.content.rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(pr.content.columns).toEqual(["a"]);
      expect(pr.content.truncated).toBe(false);
      // The ephemeral envelope never persists; produceFromRows handles have
      // no query to re-execute, so no pipeline is derived either.
      expect(pr.content.queryHandle).toBeUndefined();
      expect(pr.content.pipeline).toBeUndefined();
      expect(typeof pr.snapshotUpdatedAt).toBe("number");
    });

    // #312 smoke find: the display block for a query-backed handle carries no
    // `sql` — the pipeline must derive from the server-side handle meta.
    it("derives a query-backed table pin's pipeline from the handle meta", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const { PortalSqlHandleService } =
        await import("../../../services/portal-sql-handle.service.js");
      const { envelope } = await PortalSqlHandleService.produce({
        sql: "SELECT 1 AS x",
        stationId: station.id,
        organizationId,
      });

      // The persisted display block strips the envelope's sql — mirror that.
      const blockContent: Record<string, unknown> = { ...envelope };
      delete blockContent.sql;
      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [{ type: "data-table", content: blockContent }]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const res = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "Query Table" })
        .expect(201);

      const pr = res.body.payload.portalResult;
      expect(pr.content.pipeline).toEqual({
        sql: "SELECT 1 AS x",
        stationId: station.id,
        organizationId,
      });
      expect(pr.content.queryHandle).toBeUndefined();
    });

    /**
     * #349: an INLINE table block now carries its own pipeline, so pinning one
     * yields a refreshable pin. This needs no pin-side code — the pin service
     * already prefers the source block's own `pipeline` — so a failure here
     * points upstream at the sink or the block projection, not at
     * `portal-result-pin.service.ts`.
     */
    it("an inline data-table pin is refreshable end to end", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const pipeline = {
        sql: "SELECT 1 AS x",
        stationId: station.id,
        organizationId,
      };
      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [
          {
            type: "data-table",
            content: {
              type: "data-table",
              columns: ["x"],
              rows: [{ x: 999 }], // stale snapshot the refresh replaces
              pipeline,
            },
          },
        ]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const pinRes = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "Inline Table" })
        .expect(201);

      const pin = pinRes.body.payload.portalResult;
      expect(pin.type).toBe("data-table");
      expect(pin.content.pipeline).toEqual(pipeline);

      const refreshed = await request(app)
        .post(`/api/portal-results/${pin.id}/refresh`)
        .send()
        .expect(200);

      expect(refreshed.body.payload).toEqual({
        kind: "inline",
        rows: [{ x: 1 }],
      });
    });
  });

  // ── POST /api/portal-results/:id/refresh (#312) ───────────────────

  describe("POST /api/portal-results/:id/refresh", () => {
    it("re-executes the stored pipeline and persists the snapshot back", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const pipeline = {
        sql: "SELECT 1 AS x",
        stationId: station.id,
        organizationId,
      };
      const assistantMsg = createPortalMessage(
        organizationId,
        portal.id,
        "assistant",
        [
          {
            type: "d3",
            content: {
              program: "api.svg.append('g');",
              rows: [{ x: 999 }], // stale snapshot the refresh replaces
              pipeline,
            },
          },
        ]
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      const pinned = await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 0, name: "Live Chart" })
        .expect(201);
      const id = pinned.body.payload.portalResult.id as string;
      const pinnedAt = pinned.body.payload.portalResult
        .snapshotUpdatedAt as number;

      const res = await request(app)
        .post(`/api/portal-results/${id}/refresh`)
        .expect(200);
      expect(res.body.payload).toEqual({ kind: "inline", rows: [{ x: 1 }] });

      // Persist-back: the stored snapshot now holds the fresh rows.
      const after = await request(app)
        .get(`/api/portal-results/${id}`)
        .expect(200);
      expect(after.body.payload.portalResult.content.rows).toEqual([{ x: 1 }]);
      expect(
        after.body.payload.portalResult.snapshotUpdatedAt
      ).toBeGreaterThanOrEqual(pinnedAt);
    });

    it("returns 404 for an unknown pinned result", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post(`/api/portal-results/${generateId()}/refresh`)
        .expect(404);
      expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_NOT_FOUND);
    });

    it("returns 422 for a pin with no durable pipeline", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const staticPin = createPortalResult(
        organizationId,
        station.id,
        portal.id,
        {
          type: "data-table",
          content: { columns: ["a"], rows: [{ a: 1 }] },
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(staticPin as never);

      const res = await request(app)
        .post(`/api/portal-results/${staticPin.id}/refresh`)
        .expect(422);
      expect(res.body.code).toBe(ApiCode.VIZ_WIDGET_NOT_REFRESHABLE);
    });

    it("returns 429 past the per-org refresh window", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const { incrementRateWindow } =
        await import("../../../utils/rate-limit.util.js");
      const { VIZ_REFRESH_RATE_PER_MIN } =
        await import("@portalai/core/constants");
      // Exhaust the shared viz-refresh window (same budget as the
      // message-block addresser). The 429 fires before row lookup.
      //
      // The window is a wall-clock minute (`floor(now / 60_000)`), so a loop
      // that straddles a boundary leaves its increments split across two
      // windows and the request below sees a fresh one. Re-exhaust until the
      // whole loop lands inside a single minute.
      const currentMinute = () => Math.floor(Date.now() / 60_000);
      let minute: number;
      do {
        minute = currentMinute();
        for (let i = 0; i <= VIZ_REFRESH_RATE_PER_MIN; i++) {
          await incrementRateWindow(`viz-refresh:${organizationId}`);
        }
      } while (currentMinute() !== minute);

      const res = await request(app)
        .post(`/api/portal-results/${generateId()}/refresh`)
        .expect(429);
      expect(res.body.code).toBe(ApiCode.VIZ_REFRESH_RATE_LIMITED);
    });
  });

  // ── GET /api/portal-results ───────────────────────────────────────

  describe("GET /api/portal-results", () => {
    it("returns saved results for org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app).get("/api/portal-results").expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.total).toBe(1);
    });

    it("filters by stationId", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const stationA = createStation(organizationId);
      const stationB = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values([stationA as never, stationB as never]);

      const portalA = createPortal(organizationId, stationA.id);
      const portalB = createPortal(organizationId, stationB.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values([portalA as never, portalB as never]);

      const resultA = createPortalResult(
        organizationId,
        stationA.id,
        portalA.id
      );
      const resultB = createPortalResult(
        organizationId,
        stationB.id,
        portalB.id
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values([resultA as never, resultB as never]);

      const res = await request(app)
        .get(`/api/portal-results?stationId=${stationA.id}`)
        .expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.portalResults[0].id).toBe(resultA.id);
    });
    it("filters by portalId", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portalA = createPortal(organizationId, station.id);
      const portalB = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values([portalA as never, portalB as never]);

      const resultA = createPortalResult(
        organizationId,
        station.id,
        portalA.id
      );
      const resultB = createPortalResult(
        organizationId,
        station.id,
        portalB.id
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values([resultA as never, resultB as never]);

      const res = await request(app)
        .get(`/api/portal-results?portalId=${portalA.id}`)
        .expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.portalResults[0].id).toBe(resultA.id);
    });

    it("attaches portalName when include=portal", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      (portal as Record<string, unknown>).name = "Sales Portal";
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app)
        .get("/api/portal-results?include=portal")
        .expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.portalResults[0].portalName).toBe("Sales Portal");
    });

    it("returns portalName as null when portalId is null", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const result = createPortalResult(
        organizationId,
        station.id,
        null as unknown as string,
        { portalId: null }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app)
        .get("/api/portal-results?include=portal")
        .expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.portalResults[0].portalName).toBeNull();
    });

    it("omits portalName when include is absent", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app).get("/api/portal-results").expect(200);

      expect(res.body.payload.portalResults[0]).not.toHaveProperty(
        "portalName"
      );
    });
  });

  // ── GET /api/portal-results/:id ─────────────────────────────────

  describe("GET /api/portal-results/:id", () => {
    it("returns a portal result by ID", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app)
        .get(`/api/portal-results/${result.id}`)
        .expect(200);

      expect(res.body.payload.portalResult).toBeDefined();
      expect(res.body.payload.portalResult.id).toBe(result.id);
      expect(res.body.payload.portalResult.name).toBe("My Result");
    });

    it("returns 404 for non-existent ID", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).get(`/api/portal-results/${generateId()}`).expect(404);
    });

    it("returns 404 for soft-deleted result", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id, {
        deleted: now,
        deletedBy: "SYSTEM_TEST",
      });
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      await request(app).get(`/api/portal-results/${result.id}`).expect(404);
    });
  });

  // ── PATCH /api/portal-results/:id ────────────────────────────────

  describe("PATCH /api/portal-results/:id", () => {
    it("renames a portal result", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app)
        .patch(`/api/portal-results/${result.id}`)
        .send({ name: "Renamed Result" })
        .expect(200);

      expect(res.body.payload.portalResult.name).toBe("Renamed Result");
    });

    it("returns 404 for unknown result", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/portal-results/${generateId()}`)
        .send({ name: "X" })
        .expect(404);
    });
  });

  // ── DELETE /api/portal-results/:id ───────────────────────────────

  describe("DELETE /api/portal-results/:id", () => {
    it("soft-deletes a portal result", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const result = createPortalResult(organizationId, station.id, portal.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result as never);

      const res = await request(app)
        .delete(`/api/portal-results/${result.id}`)
        .expect(200);

      expect(res.body.payload.id).toBe(result.id);
    });

    it("returns 404 for unknown result", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .delete(`/api/portal-results/${generateId()}`)
        .expect(404);
    });
  });
});
