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
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #688: every per-object payload row carries the caller's `capabilities`,
 * and they agree with what the type's mutation routes allow.
 *
 * Per type, three rows in one org: the owner's, the member's, and a
 * system-created one (SYSTEM_TEST is the integration SYSTEM_ID, which members
 * may read). Then:
 * - the matrix: the owner can do everything; a member everything on their own
 *   row, read-only on the system row, and the owner's row isn't returned;
 * - agreement: where `delete` is false the member's DELETE is refused and the
 *   row survives; where it's true the owner's DELETE succeeds.
 */

const OWNER_SUB = "auth0|cap-owner";
const MEMBER_SUB = "auth0|cap-member";
const OTHER_SUB = "auth0|cap-other-owner";
const SYSTEM = "SYSTEM_TEST";
let currentSub = OWNER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
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

const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});
const suffix = () => generateId().replace(/-/g, "").slice(0, 8);

type Db = ReturnType<typeof drizzle>;

interface Caps {
  read: boolean;
  write: boolean;
  delete: boolean;
  share?: boolean;
}

/** One resource type under test. */
interface TypeCase {
  name: string;
  shareable: boolean;
  /** Insert a row created by `createdBy`; returns its id. */
  seed: (db: Db, fx: TenancyFixture, createdBy: string) => Promise<string>;
  listPath: string;
  /** The payload array the list returns. */
  listKey: string;
  getPath: (id: string) => string;
  /** Unwrap the GET payload's row. */
  getRow: (payload: Record<string, unknown>) => Record<string, unknown>;
  deletePath: (id: string) => string;
  /** Is the row still live after a refused DELETE? */
  alive: (db: Db, id: string) => Promise<boolean>;
}

const isLive =
  (table: { id: unknown; deleted: unknown }) => async (db: Db, id: string) => {
    const [row] = await db
      .select()
      .from(table as never)
      .where(eq(table.id as never, id));
    return !!row && (row as { deleted: unknown }).deleted === null;
  };

async function station(db: Db, fx: TenancyFixture, createdBy: string) {
  const id = generateId();
  await db.insert(schema.stations).values({
    id,
    organizationId: fx.orgId,
    name: `Station ${suffix()}`,
    description: null,
    ...base(createdBy),
  } as never);
  return id;
}

async function pin(db: Db, fx: TenancyFixture, createdBy: string) {
  const stationId = await station(db, fx, createdBy);
  const portalId = generateId();
  await db.insert(schema.portals).values({
    id: portalId,
    organizationId: fx.orgId,
    stationId,
    name: "Portal",
    lastOpened: null,
    ...base(createdBy),
  } as never);
  const id = generateId();
  await db.insert(schema.portalResults).values({
    id,
    organizationId: fx.orgId,
    stationId,
    portalId,
    name: `Pin ${suffix()}`,
    type: "text",
    content: { text: "hello" },
    ...base(createdBy),
  } as never);
  return id;
}

/** A connector entity the view sits on (created by SYSTEM so every caller can
 *  read it; the view's own creator is what's under test). */
async function entity(db: Db, fx: TenancyFixture) {
  const definitionId = generateId();
  await db.insert(schema.connectorDefinitions).values({
    id: definitionId,
    slug: `cap-${suffix()}`,
    display: "Cap",
    category: "test",
    authType: "none",
    configSchema: null,
    capabilityFlags: { sync: true, read: true, write: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    ...base(SYSTEM),
  } as never);
  const instanceId = generateId();
  await db.insert(schema.connectorInstances).values({
    id: instanceId,
    connectorDefinitionId: definitionId,
    organizationId: fx.orgId,
    name: "Instance",
    status: "active",
    config: {},
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: { read: true, write: true },
    ...base(SYSTEM),
  } as never);
  const entityId = generateId();
  await db.insert(schema.connectorEntities).values({
    id: entityId,
    organizationId: fx.orgId,
    connectorInstanceId: instanceId,
    key: `ent_${suffix()}`,
    label: "Entity",
    ...base(SYSTEM),
  } as never);
  return entityId;
}

async function curatedView(db: Db, fx: TenancyFixture, createdBy: string) {
  const connectorEntityId = await entity(db, fx);
  const id = generateId();
  await db.insert(schema.curatedViews).values({
    id,
    organizationId: fx.orgId,
    connectorEntityId,
    key: `view_${suffix()}`,
    label: "View",
    description: null,
    filter: null,
    ...base(createdBy),
  } as never);
  return id;
}

/** Slice 4: the shareable types. Slice 5 extends this table. */
const TYPES: TypeCase[] = [
  {
    name: "station",
    shareable: true,
    seed: station,
    listPath: "/api/stations?limit=100",
    listKey: "stations",
    getPath: (id) => `/api/stations/${id}`,
    getRow: (p) => p.station as Record<string, unknown>,
    deletePath: (id) => `/api/stations/${id}`,
    alive: isLive(schema.stations as never),
  },
  {
    name: "pin",
    shareable: true,
    seed: pin,
    listPath: "/api/portal-results?limit=100",
    listKey: "portalResults",
    getPath: (id) => `/api/portal-results/${id}`,
    getRow: (p) => p.portalResult as Record<string, unknown>,
    deletePath: (id) => `/api/portal-results/${id}`,
    alive: isLive(schema.portalResults as never),
  },
  {
    name: "curated_view",
    shareable: true,
    seed: curatedView,
    listPath: "/api/curated-views?limit=100",
    listKey: "curatedViews",
    getPath: (id) => `/api/curated-views/${id}`,
    getRow: (p) => p.curatedView as Record<string, unknown>,
    deletePath: (id) => `/api/curated-views/${id}`,
    alive: isLive(schema.curatedViews as never),
  },
];

const ALL = (shareable: boolean): Caps =>
  shareable
    ? { read: true, write: true, delete: true, share: true }
    : { read: true, write: true, delete: true };
const READ_ONLY = (shareable: boolean): Caps =>
  shareable
    ? { read: true, write: false, delete: false, share: false }
    : { read: true, write: false, delete: false };

describe("Object capabilities agree with the mutation routes (#688)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: Db;
  let fx: TenancyFixture;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    await connection.end();
  });

  const listRow = async (t: TypeCase, id: string) => {
    const res = await request(app).get(t.listPath);
    expect(res.status).toBe(200);
    return (res.body.payload[t.listKey] as Array<Record<string, unknown>>).find(
      (r) => r.id === id
    );
  };

  describe.each(TYPES)("$name", (t) => {
    it("list and GET carry the matrix for the owner and the member", async () => {
      const owners = await t.seed(db, fx, fx.ownerId);
      const members = await t.seed(db, fx, fx.memberId);
      const systems = await t.seed(db, fx, SYSTEM);

      currentSub = OWNER_SUB;
      for (const id of [owners, members, systems]) {
        expect((await listRow(t, id))?.capabilities).toEqual(ALL(t.shareable));
        const one = await request(app).get(t.getPath(id));
        expect(one.status).toBe(200);
        expect(t.getRow(one.body.payload).capabilities).toEqual(
          ALL(t.shareable)
        );
      }

      currentSub = MEMBER_SUB;
      expect((await listRow(t, members))?.capabilities).toEqual(
        ALL(t.shareable)
      );
      expect((await listRow(t, systems))?.capabilities).toEqual(
        READ_ONLY(t.shareable)
      );
      expect(await listRow(t, owners)).toBeUndefined();
      const sys = await request(app).get(t.getPath(systems));
      expect(t.getRow(sys.body.payload).capabilities).toEqual(
        READ_ONLY(t.shareable)
      );
    });

    it("agreement: delete=false is refused and the row survives; delete=true succeeds", async () => {
      const systems = await t.seed(db, fx, SYSTEM);
      const owners = await t.seed(db, fx, fx.ownerId);

      currentSub = MEMBER_SUB;
      const refused = await request(app).delete(t.deletePath(systems));
      expect([403, 404]).toContain(refused.status);
      expect(await t.alive(db, systems)).toBe(true);

      currentSub = OWNER_SUB;
      const ok = await request(app).delete(t.deletePath(owners));
      expect(ok.status).toBeLessThan(300);
      expect(await t.alive(db, owners)).toBe(false);
    });
  });
});
