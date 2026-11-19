/**
 * #1038: `GET /api/portal-sql/handle/:id` re-checks, on every read, that the
 * caller can still read what the handle's query reads. Revoking the caller's
 * view grant, or detaching the view from the station, closes a handle they
 * already hold (the same 404 as an expired handle).
 *
 * Fixture: one station with a `contacts` entity and a curated view granted to
 * the member (the handle's owner). The handle-reauth suite's fixture, without pins.
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
import { PortalSqlHandleService } from "../../../services/portal-sql-handle.service.js";
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

const OWNER_SUB = "auth0|handle-reauth-owner";
const DEFINER_SUB = "auth0|handle-reauth-definer";
const SHAREE_SUB = "auth0|handle-reauth-sharee";
const OTHER_SUB = "auth0|handle-reauth-other";

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

const AGE_OVER = (n: number) => ({
  combinator: "and" as const,
  conditions: [{ field: "age", operator: "gt" as const, value: n }],
});

describe("GET /api/portal-sql/handle/:id re-authorizes (#1038)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let reconciler: WideTableReconcilerService;
  let fx: TenancyFixture;
  let definerId: string;
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

    const definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      ...base(),
      id: definitionId,
      slug: `handle-reauth-${generateId().slice(0, 8)}`,
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
    currentSub = DEFINER_SUB;
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

  const read = (handle: string, offset = 0) =>
    request(app)
      .get(`/api/portal-sql/handle/${handle}`)
      .query({ offset, limit: 10 });

  /** A query handle the member produced, as the agent's tools do. */
  async function memberHandle(
    sqlText = "SELECT c_email FROM contacts ORDER BY c_email"
  ): Promise<string> {
    const { envelope } = await PortalSqlHandleService.produce({
      sql: sqlText,
      stationId,
      organizationId: fx.orgId,
      userId: definerId,
    });
    return envelope.queryHandle;
  }

  async function revokeMemberViewGrant() {
    await db
      .update(schema.permissionGrants)
      .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" } as never)
      .where(eq(schema.permissionGrants.principalId, definerId));
  }

  it("serves the member's own handle while they can read its view", async () => {
    const handle = await memberHandle();
    const res = await read(handle).expect(200);
    expect(
      (res.body.payload.rows as { c_email: string }[]).map((r) => r.c_email)
    ).toEqual(["b@x.co", "c@x.co"]);
  });

  // A read inside the last pass's window is still served (below); these read
  // only after the revocation, so the check runs.
  it("closes the handle once the member's view grant is revoked", async () => {
    const handle = await memberHandle();

    await revokeMemberViewGrant();

    const res = await read(handle).expect(404);
    expect(res.body.code).toBe(ApiCode.READ_HANDLE_EXPIRED);
  });

  it("closes the handle once the view is detached from the station", async () => {
    const handle = await memberHandle();

    await db
      .delete(schema.stationViews)
      .where(eq(schema.stationViews.curatedViewId, viewId));

    const res = await read(handle).expect(404);
    expect(res.body.code).toBe(ApiCode.READ_HANDLE_EXPIRED);
  });

  it("closes a transform handle once its source's view is revoked", async () => {
    const source = await memberHandle(
      "SELECT _record_id, c_email AS d, c_age AS v FROM contacts ORDER BY c_email"
    );
    const { envelope } = await PortalSqlHandleService.produceFromTransform({
      transform: {
        kind: "technical_indicator",
        sourceHandle: source,
        dateColumn: "d",
        valueColumn: "v",
        indicator: "SMA",
        params: { period: 1 },
      },
      stationId,
      organizationId: fx.orgId,
      userId: definerId,
    });

    await revokeMemberViewGrant();

    const res = await read(envelope.queryHandle).expect(404);
    expect(res.body.code).toBe(ApiCode.READ_HANDLE_EXPIRED);
  });

  // #1038 review: one passed check covers the reader's further pages for
  // HANDLE_READ_DECISION_TTL_MS (30s), so a large chart doesn't EXPLAIN per
  // page. A revocation reaches an open handle within that window, not at once.
  it("serves pages inside the last check's window, even after a revocation", async () => {
    const handle = await memberHandle();
    await read(handle).expect(200);

    await revokeMemberViewGrant();

    await read(handle, 1).expect(200);
  });

  /** A member's portal holding a stored contacts table, as resolveDisplayBlock
   *  persists it. Returns the message id; the table is block 0. */
  async function memberTableMessage(): Promise<string> {
    const portalId = generateId();
    await db.insert(schema.portals).values({
      ...base(definerId),
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Portal",
    } as never);
    const messageId = generateId();
    await db.insert(schema.portalMessages).values({
      ...base(definerId),
      id: messageId,
      organizationId: fx.orgId,
      portalId,
      role: "assistant",
      blocks: [
        {
          type: "data-table",
          content: {
            type: "data-table",
            columns: ["c_email"],
            pipeline: {
              sql: "SELECT c_email FROM contacts ORDER BY c_email",
              stationId,
              organizationId: fx.orgId,
            },
          },
        },
      ],
    } as never);
    return messageId;
  }

  const refresh = (messageId: string) =>
    request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 0 });

  it("a stored table refreshes as unavailable once the member's view grant is revoked", async () => {
    const messageId = await memberTableMessage();
    await refresh(messageId).expect(200);

    await revokeMemberViewGrant();

    const res = await refresh(messageId).expect(422);
    expect(res.body.code).toBe(ApiCode.VIZ_WIDGET_DATA_UNAVAILABLE);
  });

  it("a stored table reads its current rows again once access is restored", async () => {
    const messageId = await memberTableMessage();
    await revokeMemberViewGrant();
    await refresh(messageId).expect(422);

    await db
      .update(schema.permissionGrants)
      .set({ deleted: null, deletedBy: null } as never)
      .where(eq(schema.permissionGrants.principalId, definerId));

    const res = await refresh(messageId).expect(200);
    expect(res.body.payload).toEqual({
      kind: "inline",
      rows: [{ c_email: "b@x.co" }, { c_email: "c@x.co" }],
    });
  });

  it("serves a message stored with rows without them (#1038)", async () => {
    const portalId = generateId();
    await db.insert(schema.portals).values({
      ...base(definerId),
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Portal",
    } as never);
    const pipeline = {
      sql: "SELECT c_email FROM contacts ORDER BY c_email",
      stationId,
      organizationId: fx.orgId,
    };
    await db.insert(schema.portalMessages).values({
      ...base(definerId),
      id: generateId(),
      organizationId: fx.orgId,
      portalId,
      role: "assistant",
      blocks: [
        {
          type: "tool-result",
          toolName: "sql_query",
          content: { rows: [{ c_email: "b@x.co" }], pipeline },
        },
        {
          type: "data-table",
          content: {
            type: "data-table",
            columns: ["c_email"],
            rows: [{ c_email: "b@x.co" }],
            pipeline,
          },
        },
      ],
    } as never);

    const res = await request(app).get(`/api/portals/${portalId}`).expect(200);

    expect(JSON.stringify(res.body)).not.toContain("b@x.co");
    const blocks = res.body.payload.messages[0].blocks;
    expect(blocks[1].content).toEqual({
      type: "data-table",
      columns: ["c_email"],
      pipeline,
    });
  });

  it("keeps a staged-rows handle (no query to re-check) to its owner", async () => {
    const { envelope } = await PortalSqlHandleService.produceFromRows({
      rows: [{ n: 1 }, { n: 2 }],
      stationId,
      organizationId: fx.orgId,
      userId: definerId,
    });
    await revokeMemberViewGrant();
    await read(envelope.queryHandle).expect(200);

    currentSub = SHAREE_SUB;
    await read(envelope.queryHandle).expect(404);
  });
});
