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

      const assistantMsg = createPortalMessage(organizationId, portal.id, "assistant", [
        { type: "text", content: "Analysis complete." },
      ]);
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

      const assistantMsg = createPortalMessage(organizationId, portal.id, "assistant", [
        { type: "text", content: "Hello" },
      ]);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values(assistantMsg as never);

      await request(app)
        .post("/api/portal-results")
        .send({ portalId: portal.id, blockIndex: 99, name: "X" })
        .expect(400);
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

      const resultA = createPortalResult(organizationId, stationA.id, portalA.id);
      const resultB = createPortalResult(organizationId, stationB.id, portalB.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values([resultA as never, resultB as never]);

      const res = await request(app)
        .get(`/api/portal-results?stationId=${stationA.id}`)
        .expect(200);

      expect(res.body.payload.portalResults).toHaveLength(1);
      expect(res.body.payload.portalResults[0].id).toBe(resultA.id);
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

      await request(app)
        .get(`/api/portal-results/${generateId()}`)
        .expect(404);
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

      await request(app)
        .get(`/api/portal-results/${result.id}`)
        .expect(404);
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
