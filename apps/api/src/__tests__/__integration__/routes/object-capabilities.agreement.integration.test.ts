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
 * Per type, rows in one org created by the owner, the member and the system
 * (SYSTEM_TEST is the integration SYSTEM_ID). Then:
 * - the matrix: the owner can do everything. For a data type, a member can
 *   do everything to their own row, only read a system row, and doesn't see
 *   the owner's. For an owner/admin-only type, a member sees no row at all.
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
const { DbService } = await import("../../../services/db.service.js");
const { wideTableReconcilerService } =
  await import("../../../services/wide-table-reconciler.service.js");

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

/** A seeded row and, for child types, its parent's id. */
interface Seeded {
  id: string;
  parent?: string;
}

/** One resource type under test. */
interface TypeCase {
  name: string;
  shareable: boolean;
  /** "data": members hold own + system read. "none": owner/admin-only. */
  member: "data" | "none";
  seed: (db: Db, fx: TenancyFixture, createdBy: string) => Promise<Seeded>;
  listPath: (parent?: string) => string;
  listKey: string;
  getPath: (s: Seeded) => string;
  getRow: (payload: Record<string, unknown>) => Record<string, unknown>;
  deletePath: (s: Seeded) => string;
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

// ── Seeds ────────────────────────────────────────────────────────────

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

async function portal(db: Db, fx: TenancyFixture, createdBy: string) {
  const stationId = await station(db, fx, SYSTEM);
  const id = generateId();
  await db.insert(schema.portals).values({
    id,
    organizationId: fx.orgId,
    stationId,
    name: "Portal",
    lastOpened: null,
    ...base(createdBy),
  } as never);
  return { id, stationId };
}

async function pin(db: Db, fx: TenancyFixture, createdBy: string) {
  const p = await portal(db, fx, createdBy);
  const id = generateId();
  await db.insert(schema.portalResults).values({
    id,
    organizationId: fx.orgId,
    stationId: p.stationId,
    portalId: p.id,
    name: `Pin ${suffix()}`,
    type: "text",
    content: { text: "hello" },
    ...base(createdBy),
  } as never);
  return id;
}

async function instance(db: Db, fx: TenancyFixture, createdBy: string) {
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
  const id = generateId();
  await db.insert(schema.connectorInstances).values({
    id,
    connectorDefinitionId: definitionId,
    organizationId: fx.orgId,
    name: "Instance",
    status: "active",
    config: {},
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: { read: true, write: true },
    ...base(createdBy),
  } as never);
  return id;
}

/** An entity created by `createdBy`, on a system-created instance. */
async function entity(db: Db, fx: TenancyFixture, createdBy: string) {
  const instanceId = await instance(db, fx, SYSTEM);
  const id = generateId();
  await db.insert(schema.connectorEntities).values({
    id,
    organizationId: fx.orgId,
    connectorInstanceId: instanceId,
    key: `ent_${suffix()}`,
    label: "Entity",
    ...base(createdBy),
  } as never);
  await wideTableReconcilerService.ensureTable(id, db as never);
  return id;
}

async function columnDefinition(db: Db, fx: TenancyFixture, createdBy: string) {
  const id = generateId();
  await db.insert(schema.columnDefinitions).values({
    id,
    organizationId: fx.orgId,
    key: `col_${suffix()}`,
    label: "Col",
    type: "string",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    ...base(createdBy),
  } as never);
  return id;
}

async function fieldMapping(db: Db, fx: TenancyFixture, createdBy: string) {
  const connectorEntityId = await entity(db, fx, SYSTEM);
  const columnDefinitionId = await columnDefinition(db, fx, SYSTEM);
  const id = generateId();
  await db.insert(schema.fieldMappings).values({
    id,
    organizationId: fx.orgId,
    connectorEntityId,
    columnDefinitionId,
    sourceField: "src",
    isPrimaryKey: false,
    normalizedKey: `nk_${suffix()}`,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    ...base(createdBy),
  } as never);
  return id;
}

/** A record created through the API on a system entity (so the wide table is
 *  written), then attributed to `createdBy`. */
async function record(db: Db, fx: TenancyFixture, createdBy: string) {
  const parent = await entity(db, fx, SYSTEM);
  const prev = currentSub;
  currentSub = OWNER_SUB;
  const res = await request(app)
    .post(`/api/connector-entities/${parent}/records`)
    .send({ normalizedData: {}, sourceId: `src-${suffix()}` });
  currentSub = prev;
  expect(res.status).toBe(201);
  const id = (res.body.payload.record ?? res.body.payload.entityRecord).id;
  await db
    .update(schema.entityRecords)
    .set({ createdBy } as never)
    .where(eq(schema.entityRecords.id, id));
  return { id, parent };
}

async function tag(db: Db, fx: TenancyFixture, createdBy: string) {
  const id = generateId();
  await db.insert(schema.entityTags).values({
    id,
    organizationId: fx.orgId,
    name: `tag-${suffix()}`,
    color: null,
    description: null,
    ...base(createdBy),
  } as never);
  return id;
}

async function group(db: Db, fx: TenancyFixture, createdBy: string) {
  const id = generateId();
  await db.insert(schema.entityGroups).values({
    id,
    organizationId: fx.orgId,
    name: `group-${suffix()}`,
    description: null,
    ...base(createdBy),
  } as never);
  return id;
}

async function toolpack(_db: Db, fx: TenancyFixture, createdBy: string) {
  const id = generateId();
  await DbService.repository.organizationToolpacks.create({
    id,
    ...base(createdBy),
    organizationId: fx.orgId,
    name: `cap_${suffix()}`,
    description: null,
    endpoints: {
      schema: "https://example.com/schema",
      runtime: "https://example.com/runtime",
    },
    authHeaders: null,
    tools: [],
    metadata: null,
    schemaFetchedAt: now,
    metadataFetchedAt: null,
    signingSecret: "whsec_capabilities0123456789abcdef",
  } as never);
  return id;
}

const asSeeded =
  (fn: (db: Db, fx: TenancyFixture, createdBy: string) => Promise<string>) =>
  async (db: Db, fx: TenancyFixture, createdBy: string): Promise<Seeded> => ({
    id: await fn(db, fx, createdBy),
  });

const simple = (
  name: string,
  opts: {
    shareable?: boolean;
    member?: "data" | "none";
    seed: (db: Db, fx: TenancyFixture, createdBy: string) => Promise<string>;
    path: string;
    listKey: string;
    rowKey: string;
    table: { id: unknown; deleted: unknown };
  }
): TypeCase => ({
  name,
  shareable: opts.shareable ?? false,
  member: opts.member ?? "data",
  seed: asSeeded(opts.seed),
  listPath: () => `${opts.path}?limit=100`,
  listKey: opts.listKey,
  getPath: (s) => `${opts.path}/${s.id}`,
  getRow: (p) => p[opts.rowKey] as Record<string, unknown>,
  deletePath: (s) => `${opts.path}/${s.id}`,
  alive: isLive(opts.table),
});

const TYPES: TypeCase[] = [
  simple("station", {
    shareable: true,
    seed: station,
    path: "/api/stations",
    listKey: "stations",
    rowKey: "station",
    table: schema.stations as never,
  }),
  simple("pin", {
    shareable: true,
    seed: pin,
    path: "/api/portal-results",
    listKey: "portalResults",
    rowKey: "portalResult",
    table: schema.portalResults as never,
  }),
  simple("curated_view", {
    shareable: true,
    seed: async (db, fx, createdBy) => {
      const connectorEntityId = await entity(db, fx, SYSTEM);
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
    },
    path: "/api/curated-views",
    listKey: "curatedViews",
    rowKey: "curatedView",
    table: schema.curatedViews as never,
  }),
  simple("portal", {
    seed: async (db, fx, createdBy) => (await portal(db, fx, createdBy)).id,
    path: "/api/portals",
    listKey: "portals",
    rowKey: "portal",
    table: schema.portals as never,
  }),
  simple("connector_instance", {
    seed: instance,
    path: "/api/connector-instances",
    listKey: "connectorInstances",
    rowKey: "connectorInstance",
    table: schema.connectorInstances as never,
  }),
  simple("entity", {
    seed: entity,
    path: "/api/connector-entities",
    listKey: "connectorEntities",
    rowKey: "connectorEntity",
    table: schema.connectorEntities as never,
  }),
  simple("field_mapping", {
    seed: fieldMapping,
    path: "/api/field-mappings",
    listKey: "fieldMappings",
    rowKey: "fieldMapping",
    table: schema.fieldMappings as never,
  }),
  {
    name: "entity_record",
    shareable: false,
    member: "data",
    seed: record,
    listPath: (parent) => `/api/connector-entities/${parent}/records?limit=100`,
    listKey: "records",
    getPath: (s) => `/api/connector-entities/${s.parent}/records/${s.id}`,
    getRow: (p) => p.record as Record<string, unknown>,
    deletePath: (s) => `/api/connector-entities/${s.parent}/records/${s.id}`,
    alive: isLive(schema.entityRecords as never),
  },
  simple("tag", {
    member: "none",
    seed: tag,
    path: "/api/entity-tags",
    listKey: "entityTags",
    rowKey: "entityTag",
    table: schema.entityTags as never,
  }),
  simple("entity_group", {
    member: "none",
    seed: group,
    path: "/api/entity-groups",
    listKey: "entityGroups",
    rowKey: "entityGroup",
    table: schema.entityGroups as never,
  }),
  simple("column_definition", {
    member: "none",
    seed: columnDefinition,
    path: "/api/column-definitions",
    listKey: "columnDefinitions",
    rowKey: "columnDefinition",
    table: schema.columnDefinitions as never,
  }),
  simple("toolpack", {
    member: "none",
    seed: toolpack,
    path: "/api/toolpacks",
    listKey: "toolpacks",
    rowKey: "toolpack",
    table: schema.organizationToolpacks as never,
  }),
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

  /** The row as the current caller lists it (undefined when not listed, or
   *  when the list itself is refused, as toolpacks are for members). */
  const listRow = async (t: TypeCase, s: Seeded) => {
    const res = await request(app).get(t.listPath(s.parent));
    if (res.status === 403) return undefined;
    expect(res.status).toBe(200);
    return (res.body.payload[t.listKey] as Array<Record<string, unknown>>).find(
      (r) => r.id === s.id
    );
  };

  describe.each(TYPES)("$name", (t) => {
    it("list and GET carry the matrix for the owner and the member", async () => {
      const owners = await t.seed(db, fx, fx.ownerId);
      const members = await t.seed(db, fx, fx.memberId);
      const systems = await t.seed(db, fx, SYSTEM);

      currentSub = OWNER_SUB;
      for (const s of [owners, members, systems]) {
        expect((await listRow(t, s))?.capabilities).toEqual(ALL(t.shareable));
        const one = await request(app).get(t.getPath(s));
        expect(one.status).toBe(200);
        expect(t.getRow(one.body.payload).capabilities).toEqual(
          ALL(t.shareable)
        );
      }

      currentSub = MEMBER_SUB;
      expect(await listRow(t, owners)).toBeUndefined();
      if (t.member === "data") {
        expect((await listRow(t, members))?.capabilities).toEqual(
          ALL(t.shareable)
        );
        expect((await listRow(t, systems))?.capabilities).toEqual(
          READ_ONLY(t.shareable)
        );
        const sys = await request(app).get(t.getPath(systems));
        expect(t.getRow(sys.body.payload).capabilities).toEqual(
          READ_ONLY(t.shareable)
        );
      } else {
        // Owner/admin-only: a member sees no row, not even one they made.
        expect(await listRow(t, members)).toBeUndefined();
        expect(await listRow(t, systems)).toBeUndefined();
      }
    });

    it("agreement: delete=false is refused and the row survives; delete=true succeeds", async () => {
      const systems = await t.seed(db, fx, SYSTEM);
      const owners = await t.seed(db, fx, fx.ownerId);

      currentSub = MEMBER_SUB;
      const refused = await request(app).delete(t.deletePath(systems));
      expect([403, 404]).toContain(refused.status);
      expect(await t.alive(db, systems.id)).toBe(true);

      currentSub = OWNER_SUB;
      const ok = await request(app).delete(t.deletePath(owners));
      expect(ok.status).toBeLessThan(300);
      expect(await t.alive(db, owners.id)).toBe(false);
    });
  });

  it("toolpacks: a builtin is read-only even to the owner, and its DELETE is refused", async () => {
    const list = await request(app).get("/api/toolpacks");
    expect(list.status).toBe(200);
    const builtin = (
      list.body.payload.toolpacks as Array<Record<string, unknown>>
    ).find((p) => p.kind === "builtin");
    expect(builtin?.capabilities).toEqual({
      read: true,
      write: false,
      delete: false,
    });
    const del = await request(app).delete(`/api/toolpacks/${builtin?.id}`);
    expect(del.status).toBeGreaterThanOrEqual(400);
  });
});
