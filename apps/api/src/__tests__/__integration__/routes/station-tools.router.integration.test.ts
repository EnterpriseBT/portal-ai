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
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|station-tools-router-test";

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
const { stations, organizationTools, stationTools } = schema;

const now = Date.now();

const WEBHOOK_IMPL = {
  type: "webhook" as const,
  url: "https://example.com/tool",
  headers: {},
};
const PARAM_SCHEMA = { type: "object", properties: {} };

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

function createOrgTool(
  organizationId: string,
  name: string = `tool_${generateId().replace(/-/g, "").slice(0, 8)}`
) {
  return {
    id: generateId(),
    organizationId,
    name,
    description: null,
    parameterSchema: PARAM_SCHEMA,
    implementation: WEBHOOK_IMPL,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createStationTool(stationId: string, organizationToolId: string) {
  return {
    id: generateId(),
    stationId,
    organizationToolId,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

describe("Station Tools Router", () => {
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

  // ── GET /api/stations/:stationId/tools ────────────────────────────

  describe("GET /api/stations/:stationId/tools", () => {
    it("returns assigned tools with org tool definition", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const orgTool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(orgTool as never);

      const assignment = createStationTool(station.id, orgTool.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(stationTools)
        .values(assignment as never);

      const res = await request(app)
        .get(`/api/stations/${station.id}/tools`)
        .expect(200);

      expect(res.body.payload.stationTools).toHaveLength(1);
      expect(res.body.payload.stationTools[0].id).toBe(assignment.id);
      expect(res.body.payload.stationTools[0].organizationTool).toBeDefined();
    });

    it("returns 404 for unknown station", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .get(`/api/stations/${generateId()}/tools`)
        .expect(404);
    });
  });

  // ── POST /api/stations/:stationId/tools ───────────────────────────

  describe("POST /api/stations/:stationId/tools", () => {
    it("assigns a tool to a station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const orgTool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(orgTool as never);

      const res = await request(app)
        .post(`/api/stations/${station.id}/tools`)
        .send({ organizationToolId: orgTool.id })
        .expect(201);

      expect(res.body.payload.stationTool.stationId).toBe(station.id);
      expect(res.body.payload.stationTool.organizationToolId).toBe(orgTool.id);
    });

    it("returns 409 when tool name shadows a built-in pack tool", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      // "sql_query" is a built-in pack tool name
      const orgTool = createOrgTool(organizationId, "sql_query");
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(orgTool as never);

      const res = await request(app)
        .post(`/api/stations/${station.id}/tools`)
        .send({ organizationToolId: orgTool.id })
        .expect(409);

      expect(res.body.code).toBe(ApiCode.STATION_TOOL_NAME_SHADOW);
    });

    it("returns 404 for unknown station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const orgTool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(orgTool as never);

      await request(app)
        .post(`/api/stations/${generateId()}/tools`)
        .send({ organizationToolId: orgTool.id })
        .expect(404);
    });

    it("returns 404 for unknown org tool", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      await request(app)
        .post(`/api/stations/${station.id}/tools`)
        .send({ organizationToolId: generateId() })
        .expect(404);
    });
  });

  // ── DELETE /api/stations/:stationId/tools/:assignmentId ───────────

  describe("DELETE /api/stations/:stationId/tools/:assignmentId", () => {
    it("unassigns a tool from a station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const orgTool = createOrgTool(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(organizationTools)
        .values(orgTool as never);

      const assignment = createStationTool(station.id, orgTool.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(stationTools)
        .values(assignment as never);

      const res = await request(app)
        .delete(`/api/stations/${station.id}/tools/${assignment.id}`)
        .expect(200);

      expect(res.body.payload.id).toBe(assignment.id);

      // Verify hard-deleted
      const remaining = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stationTools)
        .where(eq(stationTools.id, assignment.id));
      expect(remaining).toHaveLength(0);
    });

    it("returns 404 for unknown assignment", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      await request(app)
        .delete(`/api/stations/${station.id}/tools/${generateId()}`)
        .expect(404);
    });
  });
});
