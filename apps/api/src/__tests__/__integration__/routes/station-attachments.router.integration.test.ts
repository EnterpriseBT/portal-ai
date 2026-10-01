/**
 * #674: the station write path for both attachment kinds — curated views and
 * connector instances. Attaching is an edit to the station (`resource.write`
 * on it) plus `resource.read` on each newly attached object; unreadable
 * existing attachments are preserved; writes are a diff with soft delete, in
 * one transaction, and each change is audited.
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
import { and, eq, isNull } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
  createUser,
  createOrganizationUser,
} from "../utils/application.util.js";

const OWNER_SUB = "auth0|ci-station-attach-owner";
const MEMBER_SUB = "auth0|ci-station-attach-member";

// Mutable auth sub so one file can act as either user.
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
const { StationAttachmentService } =
  await import("../../../services/station-attachment.service.js");

const {
  stations,
  stationViews,
  stationInstances,
  curatedViews,
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  permissionGrants,
  auditLog,
} = schema;

type Db = ReturnType<typeof drizzle>;

describe("station attachments (#674)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;

  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let entityId: string;
  let ci1: string;
  let ci2: string;
  let v1: string;
  let v2: string;

  const base = () => ({
    created: Date.now(),
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  async function insertInstance(): Promise<string> {
    const id = generateId();
    await db.insert(connectorInstances).values({
      ...base(),
      // Owner-created, so only `*` or an explicit grant reads it (a
      // system-created row is readable through `created_by_system`).
      createdBy: ownerId,
      id,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: `Instance ${id.slice(0, 6)}`,
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
    } as never);
    return id;
  }

  async function insertView(key: string): Promise<string> {
    const id = generateId();
    await db.insert(curatedViews).values({
      ...base(),
      // Owner-created, so only `*` or an explicit grant reads it (a
      // system-created row is readable through `created_by_system`).
      createdBy: ownerId,
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      key,
      label: key,
      description: null,
      filter: null,
    } as never);
    return id;
  }

  async function grant(
    principalId: string,
    verb: string,
    resourceType: string,
    resourceId: string
  ): Promise<void> {
    await db.insert(permissionGrants).values({
      ...base(),
      id: generateId(),
      organizationId: orgId,
      principalType: "user",
      principalId,
      effect: "allow",
      verb,
      resourceType,
      resourceId,
      condition: null,
      conditionParam: null,
    } as never);
  }

  async function insertStation(): Promise<string> {
    const id = generateId();
    await db.insert(stations).values({
      ...base(),
      id,
      organizationId: orgId,
      name: `Station ${id.slice(0, 6)}`,
      description: null,
    } as never);
    return id;
  }

  async function liveViewIds(stationId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(stationViews)
      .where(
        and(eq(stationViews.stationId, stationId), isNull(stationViews.deleted))
      );
    return rows.map((r) => r.curatedViewId).sort();
  }

  async function liveInstanceIds(stationId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(stationInstances)
      .where(
        and(
          eq(stationInstances.stationId, stationId),
          isNull(stationInstances.deleted)
        )
      );
    return rows.map((r) => r.connectorInstanceId).sort();
  }

  async function attachmentAudits(stationId: string) {
    return db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "station.attachments.change"),
          eq(auditLog.targetId, stationId)
        )
      );
  }

  let defId: string;

  beforeEach(async () => {
    currentSub = OWNER_SUB;
    connection = postgres(process.env.DATABASE_URL!, { max: 8 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);

    const seeded = await seedUserAndOrg(db, OWNER_SUB);
    orgId = seeded.organizationId;
    ownerId = seeded.userId;

    // A second user with no grants beyond the seeded member role; each case
    // grants it exactly what it needs.
    const member = createUser(MEMBER_SUB);
    await db.insert(schema.users).values(member as never);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(orgId, member.id, { role: "member" }) as never
      );
    memberId = member.id;

    defId = generateId();
    await db.insert(connectorDefinitions).values({
      ...base(),
      id: defId,
      slug: `sa-${generateId().slice(0, 8)}`,
      display: "SA Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: null,
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
    } as never);
    ci1 = await insertInstance();
    ci2 = await insertInstance();

    entityId = generateId();
    await db.insert(connectorEntities).values({
      ...base(),
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: ci1,
      key: "contacts",
      label: "Contacts",
    } as never);
    v1 = await insertView("v_one");
    v2 = await insertView("v_two");
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  // ── Create ──────────────────────────────────────────────────────────

  it("case 6: create attaches readable views and connectors, and audits once", async () => {
    const res = await request(app)
      .post("/api/stations")
      .send({
        name: "Both",
        toolPacks: ["data_query"],
        curatedViewIds: [v1, v2, v1],
        connectorInstanceIds: [ci1],
      })
      .expect(201);
    const stationId = res.body.payload.station.id as string;

    expect(await liveViewIds(stationId)).toEqual([v1, v2].sort());
    expect(await liveInstanceIds(stationId)).toEqual([ci1]);

    const audits = await attachmentAudits(stationId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(ownerId);
    expect(audits[0]!.targetType).toBe("station");
    const meta = audits[0]!.metadata as {
      added: { curatedViewIds: string[]; connectorInstanceIds: string[] };
      removed: { curatedViewIds: string[]; connectorInstanceIds: string[] };
    };
    expect([...meta.added.curatedViewIds].sort()).toEqual([v1, v2].sort());
    expect(meta.added.connectorInstanceIds).toEqual([ci1]);
    expect(meta.removed).toEqual({
      curatedViewIds: [],
      connectorInstanceIds: [],
    });
  });

  it("case 6: create with no attachments writes no audit row", async () => {
    const res = await request(app)
      .post("/api/stations")
      .send({ name: "Empty", toolPacks: ["data_query"] })
      .expect(201);
    expect(await attachmentAudits(res.body.payload.station.id)).toHaveLength(0);
  });

  it("case 7: create naming an unreadable view returns 403 and writes no station", async () => {
    currentSub = MEMBER_SUB;
    await grant(memberId, "read", "curated_view", v1);
    const name = `Denied ${generateId().slice(0, 6)}`;

    const res = await request(app)
      .post("/api/stations")
      .send({ name, toolPacks: ["data_query"], curatedViewIds: [v1, v2] })
      .expect(403);
    expect(res.body.code).toBe(ApiCode.STATION_ATTACHMENT_NOT_READABLE);

    const rows = await db
      .select()
      .from(stations)
      .where(eq(stations.name, name));
    expect(rows).toHaveLength(0);
  });

  it("case 7: a missing and a cross-org id get the same 403 as an unreadable one", async () => {
    const missing = await request(app)
      .post("/api/stations")
      .send({ name: "M", toolPacks: ["data_query"], curatedViewIds: ["nope"] })
      .expect(403);
    const missingCi = await request(app)
      .post("/api/stations")
      .send({
        name: "M2",
        toolPacks: ["data_query"],
        connectorInstanceIds: ["nope"],
      })
      .expect(403);
    expect(missing.body.code).toBe(ApiCode.STATION_ATTACHMENT_NOT_READABLE);
    expect(missingCi.body.message).toBe(missing.body.message);
  });

  // ── Update ──────────────────────────────────────────────────────────

  it("case 8: updating views alone leaves connectors untouched, and vice versa", async () => {
    const stationId = await insertStation();

    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ connectorInstanceIds: [ci1, ci2] })
      .expect(200);
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(200);
    expect(await liveInstanceIds(stationId)).toEqual([ci1, ci2].sort());
    expect(await liveViewIds(stationId)).toEqual([v1]);

    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ connectorInstanceIds: [ci2] })
      .expect(200);
    expect(await liveViewIds(stationId)).toEqual([v1]);
    expect(await liveInstanceIds(stationId)).toEqual([ci2]);
  });

  it("case 9: removing an attachment soft-deletes it; re-attaching creates a new live row", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1], connectorInstanceIds: [ci1] })
      .expect(200);
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [], connectorInstanceIds: [] })
      .expect(200);

    const views = await db
      .select()
      .from(stationViews)
      .where(eq(stationViews.stationId, stationId));
    expect(views).toHaveLength(1);
    expect(views[0]!.deleted).not.toBeNull();
    expect(views[0]!.deletedBy).toBe(ownerId);
    const links = await db
      .select()
      .from(stationInstances)
      .where(eq(stationInstances.stationId, stationId));
    expect(links).toHaveLength(1);
    expect(links[0]!.deleted).not.toBeNull();

    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(200);
    const after = await db
      .select()
      .from(stationViews)
      .where(eq(stationViews.stationId, stationId));
    expect(after).toHaveLength(2);
    expect(await liveViewIds(stationId)).toEqual([v1]);

    const audits = await attachmentAudits(stationId);
    expect(audits).toHaveLength(3);
  });

  it("case 10: an attachment the editor can't read is preserved", async () => {
    // The owner attaches V1 and V2. The second user can edit the station and
    // read only V2, and sends an empty set.
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1, v2] })
      .expect(200);

    await grant(memberId, "write", "station", stationId);
    await grant(memberId, "read", "curated_view", v2);
    currentSub = MEMBER_SUB;
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [] })
      .expect(200);

    expect(await liveViewIds(stationId)).toEqual([v1]);
    const audits = await attachmentAudits(stationId);
    const last = audits.find((a) => a.userId === memberId)!;
    expect(
      (last.metadata as { removed: { curatedViewIds: string[] } }).removed
        .curatedViewIds
    ).toEqual([v2]);
  });

  it("case 10: the editor can't add a view they can't read", async () => {
    const stationId = await insertStation();
    await grant(memberId, "write", "station", stationId);
    currentSub = MEMBER_SUB;
    const res = await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(403);
    expect(res.body.code).toBe(ApiCode.STATION_ATTACHMENT_NOT_READABLE);
    expect(await liveViewIds(stationId)).toEqual([]);
  });

  it("case 11: two concurrent updates adding the same view leave one live row", async () => {
    const stationId = await insertStation();
    const results = await Promise.all([
      request(app)
        .patch(`/api/stations/${stationId}`)
        .send({ curatedViewIds: [v1] }),
      request(app)
        .patch(`/api/stations/${stationId}`)
        .send({ curatedViewIds: [v1] }),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    expect(await liveViewIds(stationId)).toEqual([v1]);
  });

  it("case 13: a caller without write on the station gets 403 and nothing changes", async () => {
    const stationId = await insertStation();
    await grant(memberId, "read", "station", stationId);
    await grant(memberId, "read", "curated_view", v1);
    currentSub = MEMBER_SUB;
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(403);
    expect(await liveViewIds(stationId)).toEqual([]);
    expect(await attachmentAudits(stationId)).toHaveLength(0);
  });

  // ── Delete ──────────────────────────────────────────────────────────

  it("case 14: deleting a station soft-deletes its views and connector links", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1, v2], connectorInstanceIds: [ci1] })
      .expect(200);

    await request(app).delete(`/api/stations/${stationId}`).expect(200);

    expect(await liveViewIds(stationId)).toEqual([]);
    expect(await liveInstanceIds(stationId)).toEqual([]);
    const all = await db
      .select()
      .from(stationViews)
      .where(eq(stationViews.stationId, stationId));
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.deleted !== null)).toBe(true);
  });

  // ── Read ────────────────────────────────────────────────────────────

  it("case 12: GET returns every attachment with canRead, labelled even when unreadable", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1, v2], connectorInstanceIds: [ci1, ci2] })
      .expect(200);

    await grant(memberId, "read", "station", stationId);
    await grant(memberId, "read", "curated_view", v2);
    await grant(memberId, "read", "connector_instance", ci2);
    currentSub = MEMBER_SUB;
    const res = await request(app)
      .get(`/api/stations/${stationId}?include=curatedView,connectorInstance`)
      .expect(200);

    const views = res.body.payload.station.views as {
      curatedViewId: string;
      canRead: boolean;
      curatedView?: { label: string };
    }[];
    const byView = new Map(views.map((v) => [v.curatedViewId, v]));
    expect(views).toHaveLength(2);
    expect(byView.get(v1)).toMatchObject({
      canRead: false,
      curatedView: { label: "v_one" },
    });
    expect(byView.get(v2)).toMatchObject({ canRead: true });

    const instances = res.body.payload.station.instances as {
      connectorInstanceId: string;
      canRead: boolean;
      connectorInstance?: { name: string };
    }[];
    const byInstance = new Map(
      instances.map((i) => [i.connectorInstanceId, i])
    );
    expect(instances).toHaveLength(2);
    expect(byInstance.get(ci1)!.canRead).toBe(false);
    expect(byInstance.get(ci1)!.connectorInstance?.name).toBeTruthy();
    expect(byInstance.get(ci2)!.canRead).toBe(true);
  });

  it("case 12: GET without include=curatedView omits views, but instances still carry canRead", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1], connectorInstanceIds: [ci1] })
      .expect(200);
    const res = await request(app)
      .get(`/api/stations/${stationId}`)
      .expect(200);
    expect(res.body.payload.station.views).toBeUndefined();
    expect(res.body.payload.station.instances[0].canRead).toBe(true);
  });

  // ── Attach / detach routes ──────────────────────────────────────────

  it("case 15: attach with station write + view read returns 200 and audits", async () => {
    const stationId = await insertStation();
    await grant(memberId, "write", "station", stationId);
    await grant(memberId, "read", "station", stationId);
    await grant(memberId, "read", "curated_view", v1);
    currentSub = MEMBER_SUB;
    await request(app)
      .post(`/api/curated-views/${v1}/attach`)
      .send({ stationId })
      .expect(200);
    // Idempotent: a second attach writes nothing new.
    await request(app)
      .post(`/api/curated-views/${v1}/attach`)
      .send({ stationId })
      .expect(200);
    expect(await liveViewIds(stationId)).toEqual([v1]);
    expect(await attachmentAudits(stationId)).toHaveLength(1);
  });

  it("case 15: attach with view write but no station write returns 403", async () => {
    const stationId = await insertStation();
    await grant(memberId, "read", "station", stationId);
    await grant(memberId, "write", "curated_view", v1);
    await grant(memberId, "read", "curated_view", v1);
    currentSub = MEMBER_SUB;
    await request(app)
      .post(`/api/curated-views/${v1}/attach`)
      .send({ stationId })
      .expect(403);
    expect(await liveViewIds(stationId)).toEqual([]);
  });

  it("case 15: attach of a view the caller can't read returns 403 STATION_ATTACHMENT_NOT_READABLE", async () => {
    const stationId = await insertStation();
    await grant(memberId, "write", "station", stationId);
    await grant(memberId, "read", "station", stationId);
    currentSub = MEMBER_SUB;
    const res = await request(app)
      .post(`/api/curated-views/${v1}/attach`)
      .send({ stationId })
      .expect(403);
    expect(res.body.code).toBe(ApiCode.STATION_ATTACHMENT_NOT_READABLE);
  });

  it("case 15: detach with station write (no read on the view) soft-deletes and audits", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(200);
    await grant(memberId, "write", "station", stationId);
    await grant(memberId, "read", "station", stationId);
    currentSub = MEMBER_SUB;
    await request(app)
      .delete(`/api/curated-views/${v1}/attach/${stationId}`)
      .expect(200);
    expect(await liveViewIds(stationId)).toEqual([]);
    const audits = await attachmentAudits(stationId);
    expect(audits.filter((a) => a.userId === memberId)).toHaveLength(1);
  });

  it("case 15: detach without station write returns 403 and keeps the link", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1] })
      .expect(200);
    await grant(memberId, "read", "station", stationId);
    await grant(memberId, "write", "curated_view", v1);
    currentSub = MEMBER_SUB;
    await request(app)
      .delete(`/api/curated-views/${v1}/attach/${stationId}`)
      .expect(403);
    expect(await liveViewIds(stationId)).toEqual([v1]);
  });

  // ── Agent-facing counts ─────────────────────────────────────────────

  it("case 17: countsForCaller tallies attached vs readable per kind for the caller", async () => {
    const stationId = await insertStation();
    await request(app)
      .patch(`/api/stations/${stationId}`)
      .send({ curatedViewIds: [v1, v2], connectorInstanceIds: [ci1] })
      .expect(200);
    await grant(memberId, "read", "curated_view", v2);

    expect(
      await StationAttachmentService.countsForCaller(stationId, orgId, memberId)
    ).toEqual({
      views: { attached: 2, readable: 1 },
      connectors: { attached: 1, readable: 0 },
    });
    expect(
      await StationAttachmentService.countsForCaller(stationId, orgId, ownerId)
    ).toEqual({
      views: { attached: 2, readable: 2 },
      connectors: { attached: 1, readable: 1 },
    });
  });
});
