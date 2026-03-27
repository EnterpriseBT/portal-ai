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

const AUTH0_ID = "auth0|station-router-test";

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
const {
  stations,
  organizations,
  portals,
  portalMessages,
  portalResults,
  connectorDefinitions,
  connectorInstances,
  stationInstances,
} = schema;

const now = Date.now();

function createConnectorDefinition() {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
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

function createConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string
) {
  return {
    id: generateId(),
    connectorDefinitionId,
    organizationId,
    name: "Test Instance",
    status: "active" as const,
    config: null,
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
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
    name: `Portal ${generateId().slice(0, 8)}`,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createPortalMessage(
  organizationId: string,
  portalId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    portalId,
    role: "user" as const,
    blocks: [],
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
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
    name: `Result ${generateId().slice(0, 8)}`,
    type: "text" as const,
    content: {},
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createStation(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    name: `Station ${generateId().slice(0, 8)}`,
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

describe("Station Router", () => {
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

  // ── GET /api/stations ─────────────────────────────────────────────

  describe("GET /api/stations", () => {
    it("returns paginated list scoped to org", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values([
          createStation(organizationId) as never,
          createStation(organizationId) as never,
        ]);

      const res = await request(app).get("/api/stations").expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.stations).toHaveLength(2);
      expect(res.body.payload.total).toBe(2);
    });

    it("does not return stations from another org", async () => {
      const { organizationId: orgA } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      const { organizationId: orgB } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        "auth0|other-user"
      );

      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values([createStation(orgB) as never]);

      const res = await request(app).get("/api/stations").expect(200);

      // orgA has no stations
      expect(res.body.payload.stations).toHaveLength(0);
      void orgA;
    });
  });

  // ── GET /api/stations/:id ─────────────────────────────────────────

  describe("GET /api/stations/:id", () => {
    it("returns the station with instances", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const res = await request(app)
        .get(`/api/stations/${station.id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.station.id).toBe(station.id);
      expect(res.body.payload.station.instances).toBeDefined();
    });

    it("returns 404 for unknown station", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .get(`/api/stations/${generateId()}`)
        .expect(404);

      expect(res.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    });
  });

  // ── POST /api/stations ────────────────────────────────────────────

  describe("POST /api/stations", () => {
    it("creates a station", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      const res = await request(app)
        .post("/api/stations")
        .send({ name: "My Station", toolPacks: ["data_query"] })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.payload.station.name).toBe("My Station");
    });

    it("creates station with connector instances", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const def = createConnectorDefinition();
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorDefinitions)
        .values(def as never);

      const ci = createConnectorInstance(def.id, organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(connectorInstances)
        .values(ci as never);

      const res = await request(app)
        .post("/api/stations")
        .send({
          name: "Station With Instances",
          toolPacks: ["data_query"],
          connectorInstanceIds: [ci.id],
        })
        .expect(201);

      expect(res.body.payload.station.id).toBeTruthy();

      // Verify instance was created
      const instances = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stationInstances)
        .where(eq(stationInstances.stationId, res.body.payload.station.id));
      expect(instances).toHaveLength(1);
    });

    it("returns 400 for invalid body", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).post("/api/stations").send({}).expect(400);
    });
  });

  // ── PATCH /api/stations/:id ───────────────────────────────────────

  describe("PATCH /api/stations/:id", () => {
    it("updates station name", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const res = await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ name: "Updated Name" })
        .expect(200);

      expect(res.body.payload.station.name).toBe("Updated Name");
    });

    it("returns 404 for unknown station", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app)
        .patch(`/api/stations/${generateId()}`)
        .send({ name: "X" })
        .expect(404);
    });
  });

  // ── DELETE /api/stations/:id ──────────────────────────────────────

  describe("DELETE /api/stations/:id", () => {
    it("soft-deletes a station", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const res = await request(app)
        .delete(`/api/stations/${station.id}`)
        .expect(200);

      expect(res.body.payload.id).toBe(station.id);

      // Verify soft-deleted (not returned by findById)
      const found = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stations)
        .where(eq(stations.id, station.id));
      expect(found[0].deleted).not.toBeNull();
    });

    it("soft-deletes portals, hard-deletes messages, and detaches pinned results", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      const portal1 = createPortal(organizationId, station.id);
      const portal2 = createPortal(organizationId, station.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portals)
        .values([portal1 as never, portal2 as never]);

      const msg1 = createPortalMessage(organizationId, portal1.id);
      const msg2 = createPortalMessage(organizationId, portal2.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalMessages)
        .values([msg1 as never, msg2 as never]);

      const result1 = createPortalResult(organizationId, station.id, portal1.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(portalResults)
        .values(result1 as never);

      await request(app).delete(`/api/stations/${station.id}`).expect(200);

      // Portals should be soft-deleted
      const remainingPortals = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portals)
        .where(eq(portals.stationId, station.id));
      expect(remainingPortals).toHaveLength(2);
      expect(remainingPortals.every((p) => p.deleted !== null)).toBe(true);

      // Messages should be hard-deleted (completely removed)
      const remainingMessages1 = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portalMessages)
        .where(eq(portalMessages.portalId, portal1.id));
      expect(remainingMessages1).toHaveLength(0);

      const remainingMessages2 = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portalMessages)
        .where(eq(portalMessages.portalId, portal2.id));
      expect(remainingMessages2).toHaveLength(0);

      // Pinned result should be preserved and detached from portal
      const [preservedResult] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(portalResults)
        .where(eq(portalResults.id, result1.id));
      expect(preservedResult).toBeDefined();
      expect(preservedResult.deleted).toBeNull();
      expect(preservedResult.portalId).toBeNull();
    });

    it("clears org defaultStationId when the default station is deleted", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);

      // Set this station as the org default
      await (db as ReturnType<typeof drizzle>)
        .update(organizations)
        .set({ defaultStationId: station.id } as never)
        .where(eq(organizations.id, organizationId));

      await request(app).delete(`/api/stations/${station.id}`).expect(200);

      const [org] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      expect(org.defaultStationId).toBeNull();
    });

    it("does not clear org defaultStationId when a non-default station is deleted", async () => {
      const { organizationId } = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );

      const defaultStation = createStation(organizationId);
      const otherStation = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values([defaultStation as never, otherStation as never]);

      await (db as ReturnType<typeof drizzle>)
        .update(organizations)
        .set({ defaultStationId: defaultStation.id } as never)
        .where(eq(organizations.id, organizationId));

      await request(app).delete(`/api/stations/${otherStation.id}`).expect(200);

      const [org] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      expect(org.defaultStationId).toBe(defaultStation.id);
    });

    it("returns 404 for unknown station", async () => {
      await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

      await request(app).delete(`/api/stations/${generateId()}`).expect(404);
    });
  });
});
