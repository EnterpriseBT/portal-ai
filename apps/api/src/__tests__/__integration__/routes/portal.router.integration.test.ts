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

const AUTH0_ID = "auth0|portal-router-test";

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

// Mock AnalyticsService.loadStation — it would need full DB setup with
// connector entities, records, etc. which is covered by its own tests.
jest.unstable_mockModule("../../../services/analytics.service.js", () => ({
  AnalyticsService: {
    loadStation: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      entities: [],
      entityGroups: [],
      records: new Map(),
    }),
  },
}));

const { app } = await import("../../../app.js");
const { stations, portals, portalMessages, portalResults } = schema;

const now = Date.now();

function createStation(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
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
    ...overrides,
  };
}

function createPortal(
  organizationId: string,
  stationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    stationId,
    name: "Test Portal",
    lastOpened: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

describe("Portal Router", () => {
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

  // ── POST /api/portals ─────────────────────────────────────────────

  describe("POST /api/portals", () => {
    it("creates a portal for a valid station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const res = await request(app)
        .post("/api/portals")
        .send({ stationId: station.id })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.portalId).toBeTruthy();
      expect(res.body.payload.stationContext).toBeDefined();
    });

    it("returns 404 when station does not exist", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/portals")
        .send({ stationId: generateId() })
        .expect(404);

      expect(res.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    });

    it("returns 400 when station has no tool packs", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId, { toolPacks: [] });
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const res = await request(app)
        .post("/api/portals")
        .send({ stationId: station.id })
        .expect(400);

      expect(res.body.code).toBe(ApiCode.PORTAL_STATION_NO_TOOLS);
    });

    it("returns 400 for invalid payload", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).post("/api/portals").send({}).expect(400);
    });
  });

  // ── GET /api/portals ──────────────────────────────────────────────

  describe("GET /api/portals", () => {
    it("returns portals scoped to org", async () => {
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

      const res = await request(app).get("/api/portals").expect(200);

      expect(res.body.payload.portals).toHaveLength(1);
      expect(res.body.payload.portals[0].id).toBe(portal.id);
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

      const res = await request(app)
        .get(`/api/portals?stationId=${stationA.id}`)
        .expect(200);

      expect(res.body.payload.portals).toHaveLength(1);
      expect(res.body.payload.portals[0].id).toBe(portalA.id);
    });

    it("sorts portals by lastOpened desc", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const older = createPortal(organizationId, station.id, {
        name: "Older",
        lastOpened: now - 10000,
      });
      const newer = createPortal(organizationId, station.id, {
        name: "Newer",
        lastOpened: now,
      });

      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values([older as never, newer as never]);

      const res = await request(app)
        .get("/api/portals?sortBy=lastOpened&sortOrder=desc")
        .expect(200);

      const names = res.body.payload.portals.map(
        (p: { name: string }) => p.name
      );
      expect(names[0]).toBe("Newer");
      expect(names[1]).toBe("Older");
    });

    it("attaches stationName when include=station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId, { name: "Research Lab" });
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values(portal as never);

      const res = await request(app)
        .get("/api/portals?include=station")
        .expect(200);

      expect(res.body.payload.portals).toHaveLength(1);
      expect(res.body.payload.portals[0].stationName).toBe("Research Lab");
    });

    it("omits stationName when include is absent", async () => {
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

      const res = await request(app).get("/api/portals").expect(200);

      expect(res.body.payload.portals[0]).not.toHaveProperty("stationName");
    });
  });

  // ── GET /api/portals/:id ──────────────────────────────────────────

  describe("GET /api/portals/:id", () => {
    it("returns portal with messages", async () => {
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

      const res = await request(app)
        .get(`/api/portals/${portal.id}`)
        .expect(200);

      expect(res.body.payload.portal.id).toBe(portal.id);
      expect(Array.isArray(res.body.payload.messages)).toBe(true);
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/portals/${generateId()}`)
        .expect(404);

      expect(res.body.code).toBe(ApiCode.PORTAL_NOT_FOUND);
    });
  });

  // ── DELETE /api/portals/:id ───────────────────────────────────────

  describe("DELETE /api/portals/:id", () => {
    it("soft-deletes a portal", async () => {
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

      const res = await request(app)
        .delete(`/api/portals/${portal.id}`)
        .expect(200);

      expect(res.body.payload.id).toBe(portal.id);

      const [row] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portals)
        .where(eq(portals.id, portal.id));
      expect(row.deleted).not.toBeNull();
    });

    it("hard-deletes associated messages", async () => {
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

      await (db as ReturnType<typeof drizzle>).insert(portalMessages).values([
        {
          id: generateId(),
          portalId: portal.id,
          organizationId,
          role: "user",
          blocks: [{ type: "text", content: "Hello" }],
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        {
          id: generateId(),
          portalId: portal.id,
          organizationId,
          role: "assistant",
          blocks: [{ type: "text", content: "Hi" }],
          created: now + 1000,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
      ]);

      await request(app).delete(`/api/portals/${portal.id}`).expect(200);

      const remaining = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portalMessages)
        .where(eq(portalMessages.portalId, portal.id));
      expect(remaining).toHaveLength(0);
    });

    it("detaches pinned results but preserves them", async () => {
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

      const resultId = generateId();
      await (db as ReturnType<typeof drizzle>).insert(portalResults).values({
        id: resultId,
        organizationId,
        stationId: station.id,
        portalId: portal.id,
        name: "Pinned Result",
        type: "text",
        content: { value: "kept" },
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      await request(app).delete(`/api/portals/${portal.id}`).expect(200);

      const [row] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portalResults)
        .where(eq(portalResults.id, resultId));
      expect(row).toBeDefined();
      expect(row.portalId).toBeNull();
      expect(row.name).toBe("Pinned Result");
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).delete(`/api/portals/${generateId()}`).expect(404);
    });
  });

  // ── PATCH /api/portals/:id ───────────────────────────────────────

  describe("PATCH /api/portals/:id", () => {
    it("renames a portal", async () => {
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

      const res = await request(app)
        .patch(`/api/portals/${portal.id}`)
        .send({ name: "Updated Name" })
        .expect(200);

      expect(res.body.payload.portal.name).toBe("Updated Name");

      const [row] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portals)
        .where(eq(portals.id, portal.id));
      expect(row.name).toBe("Updated Name");
      expect(row.updated).not.toBeNull();
    });

    it("updates lastOpened", async () => {
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

      const timestamp = Date.now();
      const res = await request(app)
        .patch(`/api/portals/${portal.id}`)
        .send({ lastOpened: timestamp })
        .expect(200);

      expect(res.body.payload.portal.lastOpened).toBe(timestamp);

      const [row] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portals)
        .where(eq(portals.id, portal.id));
      expect(row.lastOpened).toBe(timestamp);
      expect(row.updated).not.toBeNull();
    });

    it("updates both name and lastOpened simultaneously", async () => {
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

      const timestamp = Date.now();
      const res = await request(app)
        .patch(`/api/portals/${portal.id}`)
        .send({ name: "New Name", lastOpened: timestamp })
        .expect(200);

      expect(res.body.payload.portal.name).toBe("New Name");
      expect(res.body.payload.portal.lastOpened).toBe(timestamp);
    });

    it("returns 400 when neither name nor lastOpened is provided", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/portals/${generateId()}`)
        .send({})
        .expect(400);
    });

    it("returns 400 when name is empty and lastOpened is absent", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/portals/${generateId()}`)
        .send({ name: "   " })
        .expect(400);
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/portals/${generateId()}`)
        .send({ name: "New Name" })
        .expect(404);
    });
  });

  // ── DELETE /api/portals/:id/messages ──────────────────────────────

  describe("DELETE /api/portals/:id/messages", () => {
    it("deletes all messages and returns count", async () => {
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

      // Seed two messages
      const baseTime = Date.now();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.portalMessages)
        .values([
          {
            id: generateId(),
            portalId: portal.id,
            organizationId,
            role: "user",
            blocks: [{ type: "text", content: "Hello" }],
            created: baseTime,
            createdBy: "SYSTEM_TEST",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          } as never,
          {
            id: generateId(),
            portalId: portal.id,
            organizationId,
            role: "assistant",
            blocks: [{ type: "text", content: "Hi there" }],
            created: baseTime + 1000,
            createdBy: "SYSTEM_TEST",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          } as never,
        ]);

      const res = await request(app)
        .delete(`/api/portals/${portal.id}/messages`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.portalId).toBe(portal.id);
      expect(res.body.payload.deletedMessages).toBe(2);

      // Verify messages are gone
      const remaining = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.portalMessages)
        .where(eq(schema.portalMessages.portalId, portal.id));
      expect(remaining).toHaveLength(0);
    });

    it("returns 200 with zero count when portal has no messages", async () => {
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

      const res = await request(app)
        .delete(`/api/portals/${portal.id}/messages`)
        .expect(200);

      expect(res.body.payload.deletedMessages).toBe(0);
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .delete(`/api/portals/${generateId()}/messages`)
        .expect(404);
    });
  });

  // ── POST /api/portals/:id/messages ────────────────────────────────

  describe("POST /api/portals/:id/messages", () => {
    it("persists a user message and returns streaming status", async () => {
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

      const res = await request(app)
        .post(`/api/portals/${portal.id}/messages`)
        .send({ message: "What is the average revenue?" })
        .expect(200);

      expect(res.body.payload.portalId).toBe(portal.id);
      expect(res.body.payload.status).toBe("streaming");

      // Verify message was persisted
      const messages = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.portalMessages)
        .where(eq(schema.portalMessages.portalId, portal.id));
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("returns 404 for unknown portal", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .post(`/api/portals/${generateId()}/messages`)
        .send({ message: "Hello" })
        .expect(404);
    });

    it("returns 400 for missing message", async () => {
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

      await request(app)
        .post(`/api/portals/${portal.id}/messages`)
        .send({})
        .expect(400);
    });
  });
});
