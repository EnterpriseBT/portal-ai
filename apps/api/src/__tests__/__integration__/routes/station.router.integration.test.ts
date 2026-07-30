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
  stationToolpacks,
  tiers,
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
    enabledCapabilityFlags: null,
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

  // ── Built-in toolpack entitlement guard (#284) ────────────────────
  //
  // Newly ADDED unentitled built-ins are rejected; already-persisted ones
  // are tolerated forever, so a downgrade never makes a station
  // un-editable and an upgrade needs no re-attach. Uses a dedicated
  // restricted tier row + org tier flips — the shared `standard` row is
  // never mutated, so the slug-keyed resolveTier cache stays clean.

  describe("entitlement guard (#284)", () => {
    const RESTRICTED_SLUG = "test-station-noent-tier";

    async function seedRestrictedTier() {
      await (db as ReturnType<typeof drizzle>)
        .insert(tiers)
        .values({
          id: `tier-${Date.now()}-station-noent`,
          created: Date.now(),
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
          slug: RESTRICTED_SLUG,
          displayName: "Data Query Only (test)",
          periodKind: "monthly",
          periodAnchorDay: 1,
          overage: "hard-deny",
          meteredUnitsPerPeriod: 1000,
          meteredRatePerMin: 20,
          expensiveUnitsPerPeriod: 100,
          expensiveRatePerMin: 5,
          // Only data_query — every other built-in is unentitled.
          builtinToolpacks: ["data_query"],
          customToolpacks: false,
        } as never)
        .onConflictDoNothing();
    }

    async function setOrgTier(organizationId: string, slug: string) {
      await (db as ReturnType<typeof drizzle>)
        .update(organizations)
        .set({ tier: slug })
        .where(eq(organizations.id, organizationId));
    }

    async function livePackRows(stationId: string) {
      const rows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stationToolpacks)
        .where(eq(stationToolpacks.stationId, stationId));
      return rows.filter((r) => r.deleted === null);
    }

    async function attachPack(stationId: string, slug: string) {
      await (db as ReturnType<typeof drizzle>).insert(stationToolpacks).values({
        id: generateId(),
        stationId,
        builtinSlug: slug,
        organizationToolpackId: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }

    /** Seed an org on the restricted tier. */
    async function seedRestrictedOrg() {
      const seeded = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        AUTH0_ID
      );
      await seedRestrictedTier();
      await setOrgTier(seeded.organizationId, RESTRICTED_SLUG);
      return seeded;
    }

    afterEach(async () => {
      // The org may still FK-reference the scratch tier — repoint before delete.
      await (db as ReturnType<typeof drizzle>)
        .update(organizations)
        .set({ tier: "standard" });
      await (db as ReturnType<typeof drizzle>)
        .delete(tiers)
        .where(eq(tiers.slug, RESTRICTED_SLUG));
    });

    // ── POST ────────────────────────────────────────────────────────

    it("403s POST with an unentitled built-in and persists nothing", async () => {
      const { organizationId } = await seedRestrictedOrg();

      const res = await request(app)
        .post("/api/stations")
        .send({
          name: "Blocked",
          toolPacks: ["data_query", "entity_management"],
        })
        .expect(403);

      expect(res.body.code).toBe(ApiCode.STATION_TOOLPACK_NOT_ENTITLED);
      expect(res.body.message).toMatch(/entity_management/);

      // No station row, and therefore no toolpack rows — the guard runs
      // before the insert, not after it.
      const rows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stations)
        .where(eq(stations.organizationId, organizationId));
      expect(rows.filter((r) => r.deleted === null)).toHaveLength(0);
      const packs = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(stationToolpacks);
      expect(packs).toHaveLength(0);
    });

    it("201s POST with no toolPacks — the data_query default is entitled on every tier", async () => {
      await seedRestrictedOrg();

      const res = await request(app)
        .post("/api/stations")
        .send({ name: "Default Packs" })
        .expect(201);

      const packs = await livePackRows(res.body.payload.station.id);
      expect(packs.map((p) => p.builtinSlug)).toEqual(["data_query"]);
    });

    // ── PATCH ───────────────────────────────────────────────────────

    it("403s PATCH that adds an unentitled built-in, leaving rows unchanged", async () => {
      const { organizationId } = await seedRestrictedOrg();
      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);
      await attachPack(station.id, "data_query");

      const res = await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ toolPacks: ["data_query", "visualize"] })
        .expect(403);

      expect(res.body.code).toBe(ApiCode.STATION_TOOLPACK_NOT_ENTITLED);
      const packs = await livePackRows(station.id);
      expect(packs.map((p) => p.builtinSlug)).toEqual(["data_query"]);
    });

    it("200s a rename-only PATCH on a station already carrying an unentitled pack", async () => {
      // The downgrade case: the station keeps working, including edits that
      // don't touch its packs.
      const { organizationId } = await seedRestrictedOrg();
      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);
      await attachPack(station.id, "data_query");
      await attachPack(station.id, "entity_management");

      const res = await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ name: "Renamed Anyway" })
        .expect(200);

      expect(res.body.payload.station.name).toBe("Renamed Anyway");
      const packs = await livePackRows(station.id);
      expect(packs.map((p) => p.builtinSlug).sort()).toEqual([
        "data_query",
        "entity_management",
      ]);
    });

    it("200s a PATCH that re-sends an already-persisted unentitled slug", async () => {
      const { organizationId } = await seedRestrictedOrg();
      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);
      await attachPack(station.id, "data_query");
      await attachPack(station.id, "entity_management");

      // Nothing is newly added, so nothing is denied.
      await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ toolPacks: ["data_query", "entity_management"] })
        .expect(200);

      const packs = await livePackRows(station.id);
      expect(packs.map((p) => p.builtinSlug).sort()).toEqual([
        "data_query",
        "entity_management",
      ]);
    });

    it("lets an unentitled slug be removed, then 403s re-adding it", async () => {
      const { organizationId } = await seedRestrictedOrg();
      const station = createStation(organizationId);
      await (db as ReturnType<typeof drizzle>)
        .insert(stations)
        .values(station as never);
      await attachPack(station.id, "data_query");
      await attachPack(station.id, "entity_management");

      // Dropping an unentitled pack is always allowed.
      await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ toolPacks: ["data_query"] })
        .expect(200);
      expect(
        (await livePackRows(station.id)).map((p) => p.builtinSlug)
      ).toEqual(["data_query"]);

      // Re-adding it is a new attach, and denied.
      const res = await request(app)
        .patch(`/api/stations/${station.id}`)
        .send({ toolPacks: ["data_query", "entity_management"] })
        .expect(403);
      expect(res.body.code).toBe(ApiCode.STATION_TOOLPACK_NOT_ENTITLED);
    });
  });

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

      const result1 = createPortalResult(
        organizationId,
        station.id,
        portal1.id
      );
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
