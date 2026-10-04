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
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #685 slice 6c: routes that worked through a connector instance, an upload,
 * a portal or an org setting checked only that it was in the caller's org.
 * A member could add endpoints to, re-interpret or recommit, re-authorize
 * (swapping in their own OAuth account) or drive the stored token of another
 * member's instance; parse another member's upload; refresh or pin from
 * another member's portal; and change the org-wide default station.
 *
 * Members may read and write only the instances and portals they created, so
 * another member's are unreadable: 404. Fixture rows are owner- or
 * member-created, never SYSTEM_TEST (the integration SYSTEM_ID, readable by
 * members).
 */

const OWNER_SUB = "auth0|soa-owner";
const MEMBER_SUB = "auth0|soa-member";
const OTHER_SUB = "auth0|soa-other-owner";
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

describe("Same-org object access (#685)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;

  async function definition(slug: string) {
    const id = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id,
      slug: `${slug}${slug === "rest-api" || slug === "google-sheets" || slug === "microsoft-excel" ? "" : `-${suffix()}`}`,
      display: slug,
      category: "test",
      authType: "none",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    return id;
  }

  async function instance(definitionId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.connectorInstances).values({
      id,
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Instance",
      status: "active",
      config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    return id;
  }

  async function upload(createdBy: string, uploadSessionId: string | null) {
    const id = generateId();
    await db.insert(schema.fileUploads).values({
      id,
      organizationId: fx.orgId,
      filename: "data.csv",
      contentType: "text/csv",
      sizeBytes: 10,
      s3Key: `uploads/${id}`,
      status: "uploaded",
      uploadSessionId,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function portalWithMessage(createdBy: string) {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      ...base(createdBy),
    } as never);
    const portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Portal",
      lastOpened: null,
      ...base(createdBy),
    } as never);
    const messageId = generateId();
    await db.insert(schema.portalMessages).values({
      id: messageId,
      portalId,
      organizationId: fx.orgId,
      role: "assistant",
      blocks: [{ type: "text", content: "secret" }],
      ...base(createdBy),
    } as never);
    return { stationId, portalId, messageId };
  }

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

  // ── Connector instances ─────────────────────────────────────────────

  it("REST endpoints: a member can't list or add endpoints on the owner's instance (404); nothing is written", async () => {
    const def = await definition("rest-api");
    const ownersInstance = await instance(def, fx.ownerId);
    currentSub = MEMBER_SUB;
    const list = await request(app).get(
      `/api/connector-instances/${ownersInstance}/api-endpoints`
    );
    expect(list.status).toBe(404);
    const add = await request(app)
      .post(`/api/connector-instances/${ownersInstance}/api-endpoints`)
      .send({
        key: "planted",
        label: "Planted",
        config: {
          path: "/x",
          method: "GET",
          recordsPath: "",
          pagination: { strategy: "none" },
        },
      });
    expect(add.status).toBe(404);
    expect(add.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    const entities = await db
      .select()
      .from(schema.connectorEntities)
      .where(eq(schema.connectorEntities.connectorInstanceId, ownersInstance));
    expect(entities).toHaveLength(0);
  });

  it("REST endpoints: a member adds endpoints to their own instance", async () => {
    const def = await definition("rest-api");
    const own = await instance(def, fx.memberId);
    currentSub = MEMBER_SUB;
    const add = await request(app)
      .post(`/api/connector-instances/${own}/api-endpoints`)
      .send({
        key: "mine",
        label: "Mine",
        config: {
          path: "/x",
          method: "GET",
          recordsPath: "",
          pagination: { strategy: "none" },
        },
      });
    expect(add.status).toBe(201);
  });

  it("layout plans: a member can't interpret, edit or commit the owner's instance's plan (404)", async () => {
    const def = await definition("sandbox");
    const ownersInstance = await instance(def, fx.ownerId);
    const planId = generateId();
    currentSub = MEMBER_SUB;
    for (const send of [
      () =>
        request(app)
          .post(
            `/api/connector-instances/${ownersInstance}/layout-plan/interpret`
          )
          .send({}),
      () =>
        request(app)
          .patch(
            `/api/connector-instances/${ownersInstance}/layout-plan/${planId}`
          )
          .send({}),
      () =>
        request(app)
          .post(
            `/api/connector-instances/${ownersInstance}/layout-plan/${planId}/commit`
          )
          .send({}),
      () =>
        request(app).get(
          `/api/connector-instances/${ownersInstance}/layout-plan`
        ),
    ]) {
      const res = await send();
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(
        ApiCode.LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND
      );
    }
  });

  it("draft layout plans: a member can't interpret or commit from the owner's instance or upload session (404)", async () => {
    const def = await definition("sandbox");
    const ownersInstance = await instance(def, fx.ownerId);
    const sessionId = generateId();
    await upload(fx.ownerId, sessionId);
    currentSub = MEMBER_SUB;

    const fromInstance = await request(app)
      .post("/api/layout-plans/interpret")
      .send({ connectorInstanceId: ownersInstance });
    expect(fromInstance.status).toBe(404);
    expect(fromInstance.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

    const fromUpload = await request(app)
      .post("/api/layout-plans/interpret")
      .send({ uploadSessionId: sessionId });
    expect(fromUpload.status).toBe(404);
    expect(fromUpload.body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
  });

  it("Sheets and Excel: a member can't re-authorize or drive the owner's instance (404)", async () => {
    const sheets = await instance(
      await definition("google-sheets"),
      fx.ownerId
    );
    const excel = await instance(
      await definition("microsoft-excel"),
      fx.ownerId
    );
    currentSub = MEMBER_SUB;
    for (const send of [
      () =>
        request(app)
          .post("/api/connectors/google-sheets/authorize")
          .send({ connectorInstanceId: sheets }),
      () =>
        request(app)
          .post(
            `/api/connectors/google-sheets/instances/${sheets}/select-sheet`
          )
          .send({ spreadsheetId: "any-sheet" }),
      () =>
        request(app)
          .post("/api/connectors/microsoft-excel/authorize")
          .send({ connectorInstanceId: excel }),
      () =>
        request(app)
          .post(
            `/api/connectors/microsoft-excel/instances/${excel}/select-workbook`
          )
          .send({ driveItemId: "any-item" }),
    ]) {
      const res = await send();
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
    }
  });

  // ── Uploads ─────────────────────────────────────────────────────────

  it("uploads: a member can't confirm or parse the owner's upload (404)", async () => {
    const id = await upload(fx.ownerId, null);
    currentSub = MEMBER_SUB;
    const confirm = await request(app)
      .post("/api/file-uploads/confirm")
      .send({ uploadId: id });
    expect(confirm.status).toBe(404);
    expect(confirm.body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
    const parse = await request(app)
      .post("/api/file-uploads/parse")
      .send({ uploadIds: [id] });
    expect(parse.status).toBe(404);
    expect(parse.body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
  });

  // ── Portals ─────────────────────────────────────────────────────────

  it("portals: a member can't refresh a widget in, or pin from, the owner's portal (404)", async () => {
    const { portalId, messageId } = await portalWithMessage(fx.ownerId);
    currentSub = MEMBER_SUB;
    const refresh = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 0 });
    expect(refresh.status).toBe(404);
    expect(refresh.body.code).toBe(ApiCode.VIZ_WIDGET_NOT_FOUND);

    const pin = await request(app)
      .post("/api/portal-results")
      .send({ portalId, messageId, blockIndex: 0, name: "Stolen" });
    expect(pin.status).toBe(404);
    expect(pin.body.code).toBe(ApiCode.PORTAL_NOT_FOUND);
    const pins = await db
      .select()
      .from(schema.portalResults)
      .where(eq(schema.portalResults.portalId, portalId));
    expect(pins).toHaveLength(0);
  });

  // ── Org default station ─────────────────────────────────────────────

  it("org settings: a member can't change the default station (403); the owner can", async () => {
    const { stationId } = await portalWithMessage(fx.ownerId);
    currentSub = MEMBER_SUB;
    const refused = await request(app)
      .patch(`/api/organization/${fx.orgId}`)
      .send({ defaultStationId: null });
    expect(refused.status).toBe(403);

    currentSub = OWNER_SUB;
    const ok = await request(app)
      .patch(`/api/organization/${fx.orgId}`)
      .send({ defaultStationId: stationId });
    expect(ok.status).toBe(200);
    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, fx.orgId));
    expect(org.defaultStationId).toBe(stationId);
  });

  it("#690: the caller's station.default.set capability agrees with the default-station PATCH", async () => {
    const { stationId } = await portalWithMessage(fx.ownerId);
    for (const [sub, expected] of [
      [MEMBER_SUB, false],
      [OWNER_SUB, true],
    ] as const) {
      currentSub = sub;
      const current = await request(app).get("/api/organization/current");
      expect(current.status).toBe(200);
      expect(current.body.payload.capabilities["station.default.set"]).toBe(
        expected
      );
      const patch = await request(app)
        .patch(`/api/organization/${fx.orgId}`)
        .send({ defaultStationId: stationId });
      expect(patch.status).toBe(expected ? 200 : 403);
    }
  });
});
