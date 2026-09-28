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
import { sql } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache as singletonStatementCache } from "../../../services/wide-table-statement.cache.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
  createUser,
  createOrganizationUser,
} from "../utils/application.util.js";

const OWNER_SUB = "auth0|ci-curated-owner";
const MEMBER_SUB = "auth0|ci-curated-member";

// Mutable auth sub so a single test file can act as the owner or a member.
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

describe("curated-view.router integration", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;

  let orgId: string;
  let stationId: string;
  let entityId: string;
  let emailFmId: string;
  let ageFmId: string;

  beforeEach(async () => {
    currentSub = OWNER_SUB;
    connection = postgres(process.env.DATABASE_URL!, { max: 8 });
    db = drizzle(connection, { schema });
    reconciler = new WideTableReconcilerService();
    singletonStatementCache.clear();
    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbT = db as ReturnType<typeof drizzle>;
    const now = Date.now();

    const seeded = await seedUserAndOrg(dbT, OWNER_SUB);
    orgId = seeded.organizationId;

    // A second, member-role user (no `*`, no view grants) for boundary cases.
    const member = createUser(MEMBER_SUB);
    await dbT.insert(schema.users).values(member as never);
    await dbT
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(orgId, member.id, { role: "member" }) as never
      );

    const connDefId = generateId();
    await dbT.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `cv-${generateId().slice(0, 8)}`,
      display: "CV Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const instanceId = generateId();
    await dbT.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "CV Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    stationId = generateId();
    await dbT.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "CV Station",
      description: null,
      toolPacks: ["data_query"],
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbT.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: "contacts",
      label: "Contacts",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const cdEmail = generateId();
    const cdAge = generateId();
    await dbT
      .insert(schema.columnDefinitions)
      .values([
        mkColumnDef(cdEmail, orgId, "email", "Email", "string", now),
        mkColumnDef(cdAge, orgId, "age", "Age", "number", now),
      ] as never);

    emailFmId = generateId();
    ageFmId = generateId();
    await dbT
      .insert(schema.fieldMappings)
      .values([
        mkMapping(emailFmId, orgId, entityId, cdEmail, "email", now),
        mkMapping(ageFmId, orgId, entityId, cdAge, "age", now + 1),
      ] as never);

    await reconciler.reconcileEntity(entityId, db);

    // Two rows: one under 30, one over.
    const r1 = generateId();
    const r2 = generateId();
    for (const [id, src] of [
      [r1, "src-1"],
      [r2, "src-2"],
    ] as const) {
      await dbT.insert(schema.entityRecords).values({
        id,
        organizationId: orgId,
        connectorEntityId: entityId,
        sourceId: src,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `chk-${src}`,
        origin: "sync",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }
    await dbT.execute(
      sql`INSERT INTO ${sql.raw(`"er__${entityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${r1}, ${orgId}, ${now}, true, 'src-1', 'a@b.co', 25), (${r2}, ${orgId}, ${now}, true, 'src-2', 'x@y.co', 42)`
    );
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(entityId, db);
    } catch {
      /* ignore */
    }
    singletonStatementCache.clear();
    await connection.end();
  });

  async function createView(body: Record<string, unknown>) {
    return request(app).post("/api/curated-views").send(body);
  }

  it("owner creates, lists, and gets an unrestricted view", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "all_contacts",
      label: "All Contacts",
    });
    expect(created.status).toBe(201);
    const id = created.body.payload.curatedView.id as string;

    const list = await request(app).get("/api/curated-views");
    expect(list.status).toBe(200);
    expect(
      (list.body.payload.curatedViews as Array<{ key: string }>).map(
        (v) => v.key
      )
    ).toContain("all_contacts");

    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([]);
  });

  it("filters the list to a station's attached views (stationId)", async () => {
    const attached = (
      await createView({
        connectorEntityId: entityId,
        key: "attached_v",
        label: "Attached",
      })
    ).body.payload.curatedView.id as string;
    await createView({
      connectorEntityId: entityId,
      key: "unattached_v",
      label: "Unattached",
    });
    const att = await request(app)
      .post(`/api/curated-views/${attached}/attach`)
      .send({ stationId });
    expect(att.status).toBeLessThan(300);

    const list = await request(app).get(
      `/api/curated-views?stationId=${stationId}`
    );
    expect(list.status).toBe(200);
    const keys = (list.body.payload.curatedViews as Array<{ key: string }>).map(
      (v) => v.key
    );
    expect(keys).toContain("attached_v");
    expect(keys).not.toContain("unattached_v");
  });

  it("records endpoint excludes columns outside the projection", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "email_only",
      label: "Email Only",
      fieldMappingIds: [emailFmId], // age excluded
    });
    expect(created.status).toBe(201);
    const id = created.body.payload.curatedView.id as string;

    const records = await request(app).get(
      `/api/curated-views/${id}/records?limit=10`
    );
    expect(records.status).toBe(200);
    const rows = records.body.payload.records as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveProperty("c_email");
    expect(rows[0]).not.toHaveProperty("c_age");
  });

  it("records endpoint applies the view's filter", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "adults",
      label: "Adults",
      filter: {
        combinator: "and",
        conditions: [{ field: "age", operator: "gt", value: 30 }],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.payload.curatedView.id as string;

    const records = await request(app).get(`/api/curated-views/${id}/records`);
    expect(records.status).toBe(200);
    const rows = records.body.payload.records as Array<{ c_age: number }>;
    expect(rows.length).toBe(1);
    expect(Number(rows[0].c_age)).toBe(42);
  });

  it("rejects a duplicate key (409) and an invalid filter (400)", async () => {
    const first = await createView({
      connectorEntityId: entityId,
      key: "dupe",
      label: "Dupe",
    });
    expect(first.status).toBe(201);
    const dup = await createView({
      connectorEntityId: entityId,
      key: "dupe",
      label: "Dupe 2",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe(ApiCode.CURATED_VIEW_DUPLICATE_KEY);

    // `gt` is not a valid operator for a string column → type-compat error.
    const bad = await createView({
      connectorEntityId: entityId,
      key: "bad_filter",
      label: "Bad",
      filter: {
        combinator: "and",
        conditions: [{ field: "email", operator: "gt", value: "z" }],
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER);
  });

  it("a member cannot read an ungranted view (404) and cannot create (403)", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "private_view",
      label: "Private",
    });
    expect(created.status).toBe(201);
    const id = created.body.payload.curatedView.id as string;

    currentSub = MEMBER_SUB;
    // Unreadable == absent.
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.status).toBe(404);
    const recs = await request(app).get(`/api/curated-views/${id}/records`);
    expect(recs.status).toBe(404);
    // Create is admin-only.
    const create = await createView({
      connectorEntityId: entityId,
      key: "member_view",
      label: "Member View",
    });
    expect(create.status).toBe(403);
  });
});

function mkColumnDef(
  id: string,
  organizationId: string,
  key: string,
  label: string,
  type: string,
  created: number
) {
  return {
    id,
    organizationId,
    key,
    label,
    type,
    description: null,
    isRequired: false,
    isUnique: false,
    defaultValue: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: false,
    created,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function mkMapping(
  id: string,
  organizationId: string,
  connectorEntityId: string,
  columnDefinitionId: string,
  sourceField: string,
  created: number
) {
  return {
    id,
    organizationId,
    connectorEntityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey: sourceField,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    refNormalizedKey: null,
    refEntityKey: null,
    created,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}
