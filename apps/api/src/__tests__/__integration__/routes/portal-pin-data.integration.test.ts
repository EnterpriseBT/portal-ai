/**
 * #640: `GET /api/portal-results/:id/data` — a pin's data, live, as its
 * **definer** sees it.
 *
 * Fixture: one station with a `contacts` entity (email, age) and three rows
 * (ages 25, 42, 50). The **definer** is a member whose only access is a
 * curated view filtered to `age > 30`. The **sharee** is a second member with
 * no view of their own, shown the pin through a read grant. The org owner
 * manages every pin; another org's owner reads nothing.
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
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import {
  attachCuratedView,
  createOrganizationUser,
  createUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

const OWNER_SUB = "auth0|pin-data-owner";
const DEFINER_SUB = "auth0|pin-data-definer";
const SHAREE_SUB = "auth0|pin-data-sharee";
const OTHER_SUB = "auth0|pin-data-other";

let currentSub = SHAREE_SUB;

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
const { SeatService } = await import("../../../services/seat.service.js");
const { AnalyticsService } =
  await import("../../../services/analytics.service.js");

const AGE_OVER = (n: number) => ({
  combinator: "and" as const,
  conditions: [{ field: "age", operator: "gt" as const, value: n }],
});

describe("GET /api/portal-results/:id/data (#640)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let reconciler: WideTableReconcilerService;
  let fx: TenancyFixture;
  let definerId: string;
  let shareeId: string;
  let stationId: string;
  let entityId: string;
  let viewId: string;

  const base = (createdBy = "SYSTEM_TEST") => ({
    created: Date.now(),
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  async function insertContacts(rows: [string, number][]) {
    if (rows.length === 0) return;
    const now = Date.now();
    const ids = rows.map(() => generateId());
    await db.insert(schema.entityRecords).values(
      ids.map((id) => ({
        ...base(),
        id,
        organizationId: fx.orgId,
        connectorEntityId: entityId,
        sourceId: `src-${id}`,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `checksum-${id}`,
        origin: "sync",
      })) as never
    );
    const tuples = rows.map(([email, age], i) => {
      const id = ids[i];
      return sql`(${id}, ${fx.orgId}, ${now}, true, ${`src-${id}`}, ${email}, ${age})`;
    });
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"er__${entityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES ${sql.join(tuples, sql`, `)}`
    );
  }

  /** A data-table pin defined by the definer, shared Read with the sharee. */
  async function pin(
    content: Record<string, unknown> = {
      columns: ["c_email"],
      pipeline: {
        sql: "SELECT c_email FROM contacts ORDER BY c_email",
        stationId,
        organizationId: fx.orgId,
      },
    },
    type = "data-table"
  ): Promise<string> {
    const id = generateId();
    await db.insert(schema.portalResults).values({
      ...base(definerId),
      id,
      organizationId: fx.orgId,
      stationId,
      portalId: null,
      name: "Contacts",
      type,
      content,
      definerPrincipalType: "user",
      definerPrincipalId: definerId,
    } as never);
    await db.insert(schema.permissionGrants).values({
      ...base(definerId),
      id: generateId(),
      organizationId: fx.orgId,
      principalType: "user",
      principalId: shareeId,
      effect: "allow",
      verb: "read",
      resourceType: "pin",
      resourceId: id,
      condition: null,
      conditionParam: null,
    } as never);
    return id;
  }

  const data = (pinId: string) =>
    request(app).get(`/api/portal-results/${pinId}/data`);
  const emails = (res: request.Response) =>
    (res.body.payload.rows as { c_email: string }[]).map((r) => r.c_email);

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 8 });
    db = drizzle(connection, { schema });
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      wideTableStatementCache
    );
    wideTableStatementCache.clear();
    await teardownOrg(db);

    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: DEFINER_SUB,
      otherOwner: OTHER_SUB,
    });
    definerId = fx.memberId;
    const sharee = createUser(SHAREE_SUB);
    await db.insert(schema.users).values(sharee as never);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(fx.orgId, sharee.id, { role: "member" }) as never
      );
    shareeId = sharee.id;

    const definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      ...base(),
      id: definitionId,
      slug: `pin-data-${generateId().slice(0, 8)}`,
      display: "Readable",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
    } as never);
    const instanceId = generateId();
    await db.insert(schema.connectorInstances).values({
      ...base(),
      id: instanceId,
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
    } as never);
    stationId = generateId();
    await db.insert(schema.stations).values({
      ...base(),
      id: stationId,
      organizationId: fx.orgId,
      name: "Station",
      description: null,
      toolPacks: ["data_query"],
    } as never);
    entityId = generateId();
    await db.insert(schema.connectorEntities).values({
      ...base(),
      id: entityId,
      organizationId: fx.orgId,
      connectorInstanceId: instanceId,
      key: "contacts",
      label: "Contacts",
    } as never);
    const emailDef = generateId();
    const ageDef = generateId();
    const columnDef = (id: string, key: string, type: string) => ({
      ...base(),
      id,
      organizationId: fx.orgId,
      key,
      label: key,
      type,
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
    });
    await db
      .insert(schema.columnDefinitions)
      .values([
        columnDef(emailDef, "email", "string"),
        columnDef(ageDef, "age", "number"),
      ] as never);
    const mapping = (columnDefinitionId: string, key: string) => ({
      ...base(),
      id: generateId(),
      organizationId: fx.orgId,
      connectorEntityId: entityId,
      columnDefinitionId,
      sourceField: key,
      isPrimaryKey: false,
      normalizedKey: key,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
    });
    await db
      .insert(schema.fieldMappings)
      .values([mapping(emailDef, "email"), mapping(ageDef, "age")] as never);
    await reconciler.reconcileEntity(entityId, db as unknown as DbClient);

    viewId = await attachCuratedView(db, {
      stationId,
      organizationId: fx.orgId,
      connectorEntityId: entityId,
      key: "contacts",
      label: "Contacts",
      createdBy: fx.ownerId,
      grantToUserId: definerId,
      filter: AGE_OVER(30),
    });
    await insertContacts([
      ["a@x.co", 25],
      ["b@x.co", 42],
      ["c@x.co", 50],
    ]);
    currentSub = SHAREE_SUB;
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(entityId, db as unknown as DbClient);
    } catch {
      /* ignore */
    }
    wideTableStatementCache.clear();
    await teardownOrg(db);
    await connection.end();
  });

  it("shows a sharee the definer's rows, though the sharee has no view of their own", async () => {
    const pinId = await pin();
    const res = await data(pinId).expect(200);
    expect(res.body.payload.kind).toBe("inline");
    expect(emails(res)).toEqual(["b@x.co", "c@x.co"]);
  });

  it("is live: narrowing the definer's view narrows the pin on the next read", async () => {
    const pinId = await pin();
    expect(emails(await data(pinId).expect(200))).toHaveLength(2);
    await db
      .update(schema.curatedViews)
      .set({ filter: AGE_OVER(45) } as never)
      .where(eq(schema.curatedViews.id, viewId));
    expect(emails(await data(pinId).expect(200))).toEqual(["c@x.co"]);
    // Nothing was written back to the pin.
    const [row] = await db
      .select()
      .from(schema.portalResults)
      .where(eq(schema.portalResults.id, pinId));
    expect(row.content).not.toHaveProperty("rows");
  });

  it("an empty result is an ordinary 200, not an unavailable pin", async () => {
    await db
      .update(schema.curatedViews)
      .set({ filter: AGE_OVER(100) } as never)
      .where(eq(schema.curatedViews.id, viewId));
    const res = await data(await pin()).expect(200);
    expect(res.body.payload.rows).toEqual([]);
  });

  it("empties once the definer is removed: neutral for the sharee, the reason for the owner", async () => {
    const pinId = await pin();
    await SeatService.removeMember(
      { userId: fx.ownerId, organizationId: fx.orgId, roles: ["owner"] },
      definerId,
      { sourceIp: "203.0.113.1", userAgent: "jest" }
    );

    const asSharee = await data(pinId).expect(422);
    expect(asSharee.body.code).toBe(ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE);

    currentSub = OWNER_SUB;
    const asOwner = await data(pinId).expect(422);
    expect(asOwner.body.code).toBe(ApiCode.PORTAL_RESULT_DEFINER_ACCESS_LOST);
  });

  it("empties once the definer loses the view the query reads", async () => {
    const pinId = await pin();
    await db
      .update(schema.permissionGrants)
      .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" } as never)
      .where(eq(schema.permissionGrants.principalId, definerId));
    const res = await data(pinId).expect(422);
    expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE);
  });

  describe("a tiled map pin", () => {
    const tiledMap = () =>
      pin(
        {
          spec: { layers: [] },
          tiled: true,
          pipeline: {
            sql: "SELECT c_email FROM contacts",
            stationId,
            organizationId: fx.orgId,
          },
        },
        "geo"
      );

    it("answers tiles without running its query or staging a handle", async () => {
      const run = jest.spyOn(AnalyticsService, "sqlQuery");
      const res = await data(await tiledMap()).expect(200);
      expect(res.body.payload).toEqual({ kind: "tiles" });
      expect(run).not.toHaveBeenCalled();
      run.mockRestore();
    });

    it("still empties once the definer loses the view its query reads", async () => {
      const pinId = await tiledMap();
      await db
        .update(schema.permissionGrants)
        .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" } as never)
        .where(eq(schema.permissionGrants.principalId, definerId));
      const res = await data(pinId).expect(422);
      expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE);
    });
  });

  it("answers a pin with no stored query as not re-executable", async () => {
    const pinId = await pin({ columns: ["c_email"] });
    const res = await data(pinId).expect(422);
    expect(res.body.code).toBe(ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE);
  });

  it("is 404 for a member the pin isn't shared with, and for another org", async () => {
    const pinId = await pin();
    await db
      .delete(schema.permissionGrants)
      .where(eq(schema.permissionGrants.resourceId, pinId));
    await data(pinId).expect(404);

    currentSub = OTHER_SUB;
    await data(pinId).expect(404);
  });

  it("pages a large result through a handle the sharee can read, until unshared", async () => {
    await insertContacts(
      Array.from({ length: 150 }, (_, i) => [`bulk-${i}@x.co`, 60] as const)
    );
    const pinId = await pin();
    const res = await data(pinId).expect(200);
    expect(res.body.payload.kind).toBe("handle");
    const handle = res.body.payload.queryHandle as string;

    const page = await request(app)
      .get(`/api/portal-sql/handle/${handle}`)
      .query({ offset: 0, limit: 10 })
      .expect(200);
    expect(page.body.payload.rows).toHaveLength(10);

    await db
      .delete(schema.permissionGrants)
      .where(eq(schema.permissionGrants.resourceId, pinId));
    await request(app).get(`/api/portal-sql/handle/${handle}`).expect(404);
  });

  it("answers 429 past the shared per-org refresh window", async () => {
    const { incrementRateWindow } =
      await import("../../../utils/rate-limit.util.js");
    const { VIZ_REFRESH_RATE_PER_MIN } =
      await import("@portalai/core/constants");
    // The window is a wall-clock minute; re-exhaust until the loop lands
    // inside one.
    const currentMinute = () => Math.floor(Date.now() / 60_000);
    let minute: number;
    do {
      minute = currentMinute();
      for (let i = 0; i <= VIZ_REFRESH_RATE_PER_MIN; i++) {
        await incrementRateWindow(`viz-refresh:${fx.orgId}`);
      }
    } while (currentMinute() !== minute);
    const res = await data(generateId()).expect(429);
    expect(res.body.code).toBe(ApiCode.VIZ_REFRESH_RATE_LIMITED);
  });
});
