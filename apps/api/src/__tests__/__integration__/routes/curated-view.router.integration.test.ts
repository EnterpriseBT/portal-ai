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
  allowForUser,
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
const { SystemUtilities } = await import("../../../utils/system.util.js");

describe("curated-view.router integration", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;

  let orgId: string;
  let stationId: string;
  let entityId: string;
  let emailFmId: string;
  let ageFmId: string;
  let tagsFmId: string;
  let backupFmId: string;
  let memberId: string;

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
    memberId = member.id;
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
    // #678: a json column (unsortable), and a second field mapping that shares
    // the Email column definition (two columns, one definition label).
    const cdTags = generateId();
    await dbT
      .insert(schema.columnDefinitions)
      .values([
        mkColumnDef(cdEmail, orgId, "email", "Email", "string", now),
        mkColumnDef(cdAge, orgId, "age", "Age", "number", now),
        mkColumnDef(cdTags, orgId, "tags", "Tags", "json", now),
      ] as never);

    emailFmId = generateId();
    ageFmId = generateId();
    tagsFmId = generateId();
    backupFmId = generateId();
    await dbT.insert(schema.fieldMappings).values([
      // Owner-created (#729): a member reads one only through a grant. In
      // this suite SYSTEM_ID is "SYSTEM_TEST", and a member may read
      // system-created mappings (created_by_system).
      mkMapping(
        emailFmId,
        orgId,
        entityId,
        cdEmail,
        "email",
        now,
        seeded.userId
      ),
      mkMapping(ageFmId, orgId, entityId, cdAge, "age", now + 1, seeded.userId),
      mkMapping(
        tagsFmId,
        orgId,
        entityId,
        cdTags,
        "tags",
        now + 2,
        seeded.userId
      ),
      mkMapping(
        backupFmId,
        orgId,
        entityId,
        cdEmail,
        "backup_email",
        now + 3,
        seeded.userId
      ),
    ] as never);

    await reconciler.reconcileEntity(entityId, db);

    // Two rows: one under 30, one over.
    const r1 = generateId();
    const r2 = generateId();
    // #678: creation order runs opposite to record-id order, so a `created`
    // sort is distinguishable from the record-id fallback.
    const createdAt = (id: string) =>
      id === [r1, r2].sort()[0] ? now + 1000 : now;
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
        created: createdAt(id),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }
    await dbT.execute(
      sql`INSERT INTO ${sql.raw(`"er__${entityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age", "c_backup_email") VALUES (${r1}, ${orgId}, ${now}, true, 'src-1', 'a@b.co', 25, 'a2@b.co'), (${r2}, ${orgId}, ${now}, true, 'src-2', 'x@y.co', 42, 'x2@y.co')`
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
    const items = list.body.payload.curatedViews as Array<{
      key: string;
      entity: { key: string; label: string } | null;
    }>;
    expect(items.map((v) => v.key)).toContain("all_contacts");
    // #646: each item carries its connector entity's key + label.
    const item = items.find((v) => v.key === "all_contacts");
    expect(item?.entity).toEqual({ key: "contacts", label: "Contacts" });

    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([]);
  });

  it("rejects a reserved key that would collide with a _meta_* view (400)", async () => {
    const res = await createView({
      connectorEntityId: entityId,
      key: "_meta_columns",
      label: "Bad",
    });
    expect(res.status).toBe(400);
    // #745: a schema failure names the field and carries every issue.
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(res.body.message).toMatch(/^Invalid curated view payload: key: /);
    expect(res.body.details.issues[0].path).toEqual(["key"]);
  });

  it("#745: PATCH with a malformed body names the field", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "patch_bad_body",
        label: "V",
      })
    ).body.payload.curatedView.id as string;
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(res.body.message).toMatch(/^Invalid curated view payload: label: /);
    expect(res.body.details.issues[0].path).toEqual(["label"]);
  });

  it("#745: attach without a stationId names the field", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "attach_bad_body",
        label: "V",
      })
    ).body.payload.curatedView.id as string;
    const res = await request(app)
      .post(`/api/curated-views/${id}/attach`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(res.body.message).toMatch(
      /^Invalid curated view attach payload: stationId: /
    );
    expect(res.body.details.issues[0].path).toEqual(["stationId"]);
  });

  it("attach rejects a station outside the caller's org (404)", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "unattached_target",
        label: "V",
      })
    ).body.payload.curatedView.id as string;
    const att = await request(app)
      .post(`/api/curated-views/${id}/attach`)
      .send({ stationId: "00000000-0000-0000-0000-000000000000" });
    expect(att.status).toBe(404);
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
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).not.toHaveProperty("age");
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
    const rows = records.body.payload.records as Array<{ age: number }>;
    expect(rows.length).toBe(1);
    expect(Number(rows[0].age)).toBe(42);
  });

  it("records endpoint returns projected columns and sorts by a projected column", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "sortable",
      label: "Sortable",
    });
    expect(created.status).toBe(201);
    const id = created.body.payload.curatedView.id as string;

    // #678: the projected columns are ResolvedColumns keyed by the field
    // mapping's normalizedKey (the header), carrying the column definition's
    // label and type (the caption). They used to be { key: c_*, label: the
    // definition label }, which made shared definitions unreadable.
    const base = await request(app).get(`/api/curated-views/${id}/records`);
    expect(base.status).toBe(200);
    const cols = base.body.payload.columns as Array<{
      key: string;
      normalizedKey: string;
      label: string;
      type: string;
    }>;
    expect(cols.map((c) => c.normalizedKey)).toEqual([
      "email",
      "age",
      "tags",
      "backup_email",
    ]);
    expect(cols.find((c) => c.normalizedKey === "email")).toMatchObject({
      key: "email",
      label: "Email",
      type: "string",
    });
    expect(cols.find((c) => c.normalizedKey === "age")).toMatchObject({
      label: "Age",
      type: "number",
    });
    const rows = base.body.payload.records as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "_record_id",
        "_source_id",
        "age",
        "backup_email",
        "email",
        "tags",
      ].sort()
    );

    const asc = await request(app).get(
      `/api/curated-views/${id}/records?sortBy=age&sortOrder=asc`
    );
    expect(
      (asc.body.payload.records as Array<{ age: number }>).map((r) =>
        Number(r.age)
      )
    ).toEqual([25, 42]);

    const desc = await request(app).get(
      `/api/curated-views/${id}/records?sortBy=age&sortOrder=desc`
    );
    expect(
      (desc.body.payload.records as Array<{ age: number }>).map((r) =>
        Number(r.age)
      )
    ).toEqual([42, 25]);
  });

  it("records endpoint searches projected columns; a non-projected sortBy falls back safely", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "searchable",
      label: "Searchable",
    });
    const id = created.body.payload.curatedView.id as string;

    const emailHit = await request(app).get(
      `/api/curated-views/${id}/records?search=a@b`
    );
    expect(emailHit.status).toBe(200);
    const emailRows = emailHit.body.payload.records as Array<{
      email: string;
    }>;
    expect(emailRows.length).toBe(1);
    expect(emailRows[0].email).toBe("a@b.co");

    // The numeric column is searchable via a text cast.
    const ageHit = await request(app).get(
      `/api/curated-views/${id}/records?search=42`
    );
    expect((ageHit.body.payload.records as unknown[]).length).toBe(1);

    // LIKE metacharacters are escaped — a literal `%` is not a wildcard, so it
    // matches nothing here (no value contains a literal percent sign).
    const wildcard = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ search: "%" });
    expect(wildcard.status).toBe(200);
    expect((wildcard.body.payload.records as unknown[]).length).toBe(0);

    // A sortBy that names no projected column falls back to the stable
    // record-id order, and never errors.
    const fallback = await request(app).get(
      `/api/curated-views/${id}/records?sortBy=nonexistent_column`
    );
    expect(fallback.status).toBe(200);
    expect((fallback.body.payload.records as unknown[]).length).toBe(2);
  });

  it("#678: sortBy=created orders by record creation (the entity table's sort), both directions", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "by_created",
      label: "By created",
    });
    const id = created.body.payload.curatedView.id as string;
    const ids = async (sortOrder: string) =>
      (
        (
          await request(app)
            .get(`/api/curated-views/${id}/records`)
            .query({ sortBy: "created", sortOrder })
        ).body.payload.records as Array<{ _record_id: string }>
      ).map((r) => r._record_id);
    // The fixture's lower record id was created later.
    const [lowId, highId] = (await ids("asc")).slice().sort();
    expect(await ids("asc")).toEqual([highId, lowId]);
    expect(await ids("desc")).toEqual([lowId, highId]);
  });

  it("records search term is escaped (no injection)", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "inj",
      label: "Inj",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ search: "a@b' OR '1'='1" });
    // Treated as a literal substring (matches nothing) — not an injected
    // predicate that would return every row.
    expect(res.status).toBe(200);
    expect((res.body.payload.records as unknown[]).length).toBe(0);
  });

  it("#678: two field mappings sharing one column definition come back as two distinct columns", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "shared_def",
      label: "Shared",
      fieldMappingIds: [emailFmId, backupFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app).get(`/api/curated-views/${id}/records`);
    const cols = res.body.payload.columns as Array<{
      normalizedKey: string;
      label: string;
    }>;
    expect(cols.map((c) => c.normalizedKey)).toEqual(["email", "backup_email"]);
    // Same definition label (the caption), distinct headers.
    expect(cols.map((c) => c.label)).toEqual(["Email", "Email"]);
  });

  // ── #680: GET / list scoped to the reader ──────────────────────────

  /** The member may read `viewId` and only the email field mapping. */
  async function grantMemberViewAndEmail(viewId: string) {
    const base = {
      organizationId: orgId,
      principalType: "user",
      principalId: memberId,
      effect: "allow",
      verb: "read",
      condition: null,
      conditionParam: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.permissionGrants)
      .values([
        {
          ...base,
          id: generateId(),
          resourceType: "curated_view",
          resourceId: viewId,
        },
        {
          ...base,
          id: generateId(),
          resourceType: "field_mapping",
          resourceId: emailFmId,
        },
      ] as never);
  }

  const AGE_FILTER = {
    combinator: "and",
    conditions: [{ field: "age", operator: "gt", value: 30 }],
  };

  it("#680: a reader without write gets no filter and only the projection ids they can read", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "redacted",
      label: "Redacted",
      filter: AGE_FILTER,
      fieldMappingIds: [emailFmId, ageFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    await grantMemberViewAndEmail(id);

    currentSub = MEMBER_SUB;
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.status).toBe(200);
    const view = got.body.payload.curatedView;
    expect(view.filter).toBeNull();
    expect(view.filtered).toBe(true);
    expect(view.projected).toBe(true);
    expect(view.fieldMappingIds).toEqual([emailFmId]);
    // Nothing about the hidden column survives anywhere in the payload.
    expect(JSON.stringify(got.body)).not.toContain(ageFmId);
    expect(JSON.stringify(got.body)).not.toContain('"age"');

    const list = await request(app).get(`/api/curated-views`);
    expect(list.status).toBe(200);
    const row = (
      list.body.payload.curatedViews as Array<Record<string, unknown>>
    ).find((v) => v.id === id)!;
    expect(row.filter).toBeNull();
    expect(row.filtered).toBe(true);
    expect(row.projected).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('"age"');
  });

  // #729: a member's field-mapping read is conditional (created_by_caller /
  // created_by_system). The column check passed no createdBy, so no condition
  // could match and the member got zero columns on every view: the view page
  // spun forever and a portal session's views had no columns. The shares
  // above (in_curated_view / instance grants) never needed createdBy.
  it("#729: a member reads a system-created view's columns through created_by_system, with no shares", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "system_view",
      label: "System view",
      fieldMappingIds: [emailFmId, ageFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    await (db as ReturnType<typeof drizzle>).execute(
      sql`update curated_views set created_by = ${SystemUtilities.id.system} where id = ${id}`
    );
    await makeEntitySystemOwned();

    currentSub = MEMBER_SUB;
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.status).toBe(200);
    expect([...got.body.payload.curatedView.fieldMappingIds].sort()).toEqual(
      [emailFmId, ageFmId].sort()
    );

    const records = await request(app).get(
      `/api/curated-views/${id}/records?limit=10&offset=0`
    );
    expect(records.status).toBe(200);
    const keys = (
      records.body.payload.columns as Array<{ normalizedKey: string }>
    ).map((c) => c.normalizedKey);
    expect(keys.length).toBeGreaterThan(0);
    expect(records.body.payload.records.length).toBeGreaterThan(0);
  });

  /** Make the fixture entity's mappings and records system-created (#729). */
  async function makeEntitySystemOwned() {
    const system = SystemUtilities.id.system;
    const dbT = db as ReturnType<typeof drizzle>;
    await dbT.execute(
      sql`update field_mappings set created_by = ${system} where connector_entity_id = ${entityId}`
    );
    await dbT.execute(
      sql`update entity_records set created_by = ${system} where connector_entity_id = ${entityId}`
    );
    // The statement cache carries each mapping's creator.
    singletonStatementCache.clear();
  }

  /** #736: a field mapping on a fresh entity in `organizationId` (this org or
   *  another), sharing this suite's connector definition. */
  async function foreignMapping(organizationId: string): Promise<string> {
    const dbT = db as ReturnType<typeof drizzle>;
    const now = Date.now();
    const [{ connectorDefinitionId }] = await dbT
      .select({
        connectorDefinitionId: schema.connectorInstances.connectorDefinitionId,
      })
      .from(schema.connectorInstances)
      .innerJoin(
        schema.connectorEntities,
        sql`${schema.connectorEntities.connectorInstanceId} = ${schema.connectorInstances.id}`
      )
      .where(sql`${schema.connectorEntities.id} = ${entityId}`);
    const audit = {
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    const instanceId = generateId();
    await dbT.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId,
      organizationId,
      name: "Other Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      ...audit,
    } as never);
    const otherEntityId = generateId();
    await dbT.insert(schema.connectorEntities).values({
      id: otherEntityId,
      organizationId,
      connectorInstanceId: instanceId,
      key: `other_${otherEntityId.slice(0, 8)}`,
      label: "Other",
      ...audit,
    } as never);
    const cd = generateId();
    await dbT
      .insert(schema.columnDefinitions)
      .values(
        mkColumnDef(
          cd,
          organizationId,
          "other",
          "Other",
          "string",
          now
        ) as never
      );
    const fm = generateId();
    await dbT
      .insert(schema.fieldMappings)
      .values(
        mkMapping(
          fm,
          organizationId,
          otherEntityId,
          cd,
          "other",
          now,
          "SYSTEM_TEST"
        ) as never
      );
    return fm;
  }

  async function viewCount(key: string): Promise<number> {
    const rows = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.curatedViews.id })
      .from(schema.curatedViews)
      .where(sql`${schema.curatedViews.key} = ${key}`);
    return rows.length;
  }

  it("#736: create rejects a field mapping from another entity in the org (400)", async () => {
    const res = await createView({
      connectorEntityId: entityId,
      key: "cross_entity",
      label: "Cross entity",
      fieldMappingIds: [emailFmId, await foreignMapping(orgId)],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(await viewCount("cross_entity")).toBe(0);
  });

  it("#736: create rejects a field mapping from another org (400)", async () => {
    const other = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      "auth0|ci-curated-other-org"
    );
    const res = await createView({
      connectorEntityId: entityId,
      key: "cross_org",
      label: "Cross org",
      fieldMappingIds: [await foreignMapping(other.organizationId)],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(await viewCount("cross_org")).toBe(0);
  });

  it("#736: create rejects a duplicate field mapping (400, not 500)", async () => {
    const res = await createView({
      connectorEntityId: entityId,
      key: "dup_fm",
      label: "Duplicate",
      fieldMappingIds: [emailFmId, emailFmId],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    // A semantic refusal, not a schema failure: no Zod issues attached.
    expect(res.body.details).toBeUndefined();
    expect(await viewCount("dup_fm")).toBe(0);
  });

  it("#736: PATCH rejects another entity's field mapping and keeps the projection", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "patch_target",
        label: "Patch target",
        fieldMappingIds: [emailFmId],
      })
    ).body.payload.curatedView.id as string;
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [ageFmId, await foreignMapping(orgId)] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([emailFmId]);
  });

  it("#736: a member given view-create sending a foreign id gets 400, not 403", async () => {
    await allowForUser(db as ReturnType<typeof drizzle>, {
      organizationId: orgId,
      userId: memberId,
      verb: "write",
      resourceType: "curated_view",
    });
    const foreign = await foreignMapping(orgId);
    currentSub = MEMBER_SUB;
    const res = await createView({
      connectorEntityId: entityId,
      key: "member_foreign",
      label: "Member foreign",
      fieldMappingIds: [foreign],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
  });

  /** #736: soft-delete a field mapping the way its route does, leaving the
   *  projection rows that name it in place. */
  async function softDeleteMapping(id: string): Promise<void> {
    await (db as ReturnType<typeof drizzle>)
      .update(schema.fieldMappings)
      .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" } as never)
      .where(sql`${schema.fieldMappings.id} = ${id}`);
  }

  it("#736: create rejects an unknown field mapping id (400)", async () => {
    const res = await createView({
      connectorEntityId: entityId,
      key: "unknown_fm",
      label: "Unknown",
      fieldMappingIds: [emailFmId, generateId()],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(await viewCount("unknown_fm")).toBe(0);
  });

  it("#736: a view still saves after one of its projected mappings is deleted, and a change drops it", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "stale_projection",
        label: "Stale",
        fieldMappingIds: [emailFmId, ageFmId],
      })
    ).body.payload.curatedView.id as string;
    await softDeleteMapping(ageFmId);
    // The editor sends the stored ids back on every save.
    const stored = (await request(app).get(`/api/curated-views/${id}`)).body
      .payload.curatedView.fieldMappingIds as string[];
    expect([...stored].sort()).toEqual([emailFmId, ageFmId].sort());
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "Renamed", fieldMappingIds: stored });
    expect(res.status).toBe(200);
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.label).toBe("Renamed");
    // #738: resending the stored ids is no change, so the projection is kept.
    expect([...got.body.payload.curatedView.fieldMappingIds].sort()).toEqual(
      [emailFmId, ageFmId].sort()
    );
    // The next real change drops the deleted mapping.
    const changed = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [...stored, tagsFmId] });
    expect(changed.status).toBe(200);
    const after = await request(app).get(`/api/curated-views/${id}`);
    expect([...after.body.payload.curatedView.fieldMappingIds].sort()).toEqual(
      [emailFmId, tagsFmId].sort()
    );
  });

  it("#736: a changed save left with only deleted mappings is refused, never widened to all columns", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "all_stale",
        label: "All stale",
        fieldMappingIds: [emailFmId, ageFmId],
      })
    ).body.payload.curatedView.id as string;
    await softDeleteMapping(ageFmId);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "Renamed", fieldMappingIds: [ageFmId] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.label).toBe("All stale");
    expect([...got.body.payload.curatedView.fieldMappingIds].sort()).toEqual(
      [emailFmId, ageFmId].sort()
    );
  });

  /** #738: the view's live projection rows, as ids of the rows themselves. */
  async function projectionRowIds(viewId: string): Promise<string[]> {
    const rows = await (db as ReturnType<typeof drizzle>)
      .select({ id: schema.curatedViewFieldMappings.id })
      .from(schema.curatedViewFieldMappings)
      .where(
        sql`${schema.curatedViewFieldMappings.curatedViewId} = ${viewId} and ${schema.curatedViewFieldMappings.deleted} is null`
      );
    return rows.map((r) => r.id).sort();
  }

  /** #738: a view the member owns over system-created (member-readable)
   *  mappings, plus a mapping on the same entity that someone else created,
   *  which the member can't read. */
  async function memberOwnedView(
    key: string,
    fieldMappingIds: string[],
    opts: { secretProjected?: boolean } = {}
  ): Promise<{ id: string; secret: string }> {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key,
        label: key,
        fieldMappingIds,
      })
    ).body.payload.curatedView.id as string;
    await makeEntitySystemOwned();
    const dbT = db as ReturnType<typeof drizzle>;
    await dbT.execute(
      sql`update curated_views set created_by = ${memberId} where id = ${id}`
    );
    const cd = generateId();
    await dbT
      .insert(schema.columnDefinitions)
      .values(
        mkColumnDef(
          cd,
          orgId,
          "secret",
          "Secret",
          "string",
          Date.now()
        ) as never
      );
    const secret = generateId();
    await dbT
      .insert(schema.fieldMappings)
      .values(
        mkMapping(
          secret,
          orgId,
          entityId,
          cd,
          "secret",
          Date.now(),
          "someone-else"
        ) as never
      );
    singletonStatementCache.clear();
    if (opts.secretProjected) {
      // Someone who could read it put the secret column in the view.
      await dbT.insert(schema.curatedViewFieldMappings).values({
        id: generateId(),
        organizationId: orgId,
        curatedViewId: id,
        fieldMappingId: secret,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }
    currentSub = MEMBER_SUB;
    return { id, secret };
  }

  it("#738: re-saving an unchanged all-columns view needs no read on every column", async () => {
    const { id } = await memberOwnedView("member_all", []);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "Renamed", fieldMappingIds: [] });
    expect(res.body.code ?? null).toBeNull();
    expect(res.status).toBe(200);
    currentSub = OWNER_SUB;
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.label).toBe("Renamed");
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([]);
  });

  it("#738: changing an all-columns view to a readable list still saves", async () => {
    const { id } = await memberOwnedView("member_all_to_list", []);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId] });
    expect(res.status).toBe(200);
  });

  it("#738: widening a list to all columns over an unreadable column is refused, and says why", async () => {
    const { id } = await memberOwnedView("member_list_to_all", [emailFmId]);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_FIELD_NOT_READABLE);
    expect(res.body.message).toBe(
      "An all-columns view needs read access to every column of its entity"
    );
    currentSub = OWNER_SUB;
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([emailFmId]);
  });

  it("#738: a writer can remove a column while the view keeps one they can't read", async () => {
    const { id, secret } = await memberOwnedView(
      "member_narrow",
      [emailFmId, ageFmId],
      { secretProjected: true }
    );
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId, secret] });
    expect(res.body.code ?? null).toBeNull();
    expect(res.status).toBe(200);
  });

  it("#738: a writer can add a readable column while the view keeps one they can't read", async () => {
    const { id, secret } = await memberOwnedView(
      "member_add_readable",
      [emailFmId],
      { secretProjected: true }
    );
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId, secret, ageFmId] });
    expect(res.body.code ?? null).toBeNull();
    expect(res.status).toBe(200);
  });

  it("#738: a writer still can't add a column they can't read", async () => {
    const { id, secret } = await memberOwnedView("member_add_secret", [
      emailFmId,
    ]);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId, secret] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_FIELD_NOT_READABLE);
    expect(res.body.message).toBe(
      "You cannot project a field mapping you do not have read access to"
    );
  });

  it("#738: narrowing an all-columns view exposes nothing new, so it isn't refused", async () => {
    const { id, secret } = await memberOwnedView("member_all_narrow", []);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId, secret] });
    expect(res.status).toBe(200);
  });

  it("#738: a duplicate id is refused even when the set matches the stored one", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "dup_unchanged",
        label: "Dup unchanged",
        fieldMappingIds: [emailFmId, ageFmId],
      })
    ).body.payload.curatedView.id as string;
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [emailFmId, ageFmId, emailFmId] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
  });

  it("#738: a label save on a view whose every projected mapping is deleted keeps it as is", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "all_dead_label",
        label: "All dead",
        fieldMappingIds: [ageFmId],
      })
    ).body.payload.curatedView.id as string;
    await softDeleteMapping(ageFmId);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "Renamed", fieldMappingIds: [ageFmId] });
    expect(res.status).toBe(200);
    const got = await request(app).get(`/api/curated-views/${id}`);
    expect(got.body.payload.curatedView.label).toBe("Renamed");
    expect(got.body.payload.curatedView.fieldMappingIds).toEqual([ageFmId]);
  });

  it("#738: the same ids in another order are no change, so no rows are rewritten", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "reordered",
        label: "Reordered",
        fieldMappingIds: [emailFmId, ageFmId],
      })
    ).body.payload.curatedView.id as string;
    const before = await projectionRowIds(id);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ fieldMappingIds: [ageFmId, emailFmId] });
    expect(res.status).toBe(200);
    expect(await projectionRowIds(id)).toEqual(before);
  });

  it("#736: a label-only PATCH doesn't re-check the projection", async () => {
    const id = (
      await createView({
        connectorEntityId: entityId,
        key: "label_only",
        label: "Label only",
        fieldMappingIds: [ageFmId],
      })
    ).body.payload.curatedView.id as string;
    await softDeleteMapping(ageFmId);
    const res = await request(app)
      .patch(`/api/curated-views/${id}`)
      .send({ label: "Renamed" });
    expect(res.status).toBe(200);
  });

  // #729 (code review): the create/update guard had the same omission, so a
  // member creating a view over system-created fields got 403 on every field.
  it("#729: a member given view-create can project system-created field mappings", async () => {
    await makeEntitySystemOwned();
    // View create is class-level (owner/admin by default); a custom policy can
    // give it to anyone, and the field guard then decides the projection.
    await allowForUser(db as ReturnType<typeof drizzle>, {
      organizationId: orgId,
      userId: memberId,
      verb: "write",
      resourceType: "curated_view",
    });
    currentSub = MEMBER_SUB;
    const created = await createView({
      connectorEntityId: entityId,
      key: "member_over_system",
      label: "Member over system",
      fieldMappingIds: [emailFmId, ageFmId],
    });
    expect(created.body.code ?? null).toBeNull();
    expect(created.status).toBe(201);
  });

  // #729 (code review): the portal session build reads the same columns, so a
  // member's session view over system-created mappings has them.
  it("#729: a member's portal session build gets the system-created view's columns", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "session_system_view",
      label: "Session system view",
      fieldMappingIds: [emailFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    const dbT = db as ReturnType<typeof drizzle>;
    await dbT.execute(
      sql`update curated_views set created_by = ${SystemUtilities.id.system} where id = ${id}`
    );
    await dbT.insert(schema.stationViews).values({
      id: generateId(),
      organizationId: orgId,
      stationId,
      curatedViewId: id,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await makeEntitySystemOwned();

    const { PortalSqlService } =
      await import("../../../services/portal-sql.service.js");
    const { views } = await PortalSqlService.resolveGrantedViewColumns(
      stationId,
      orgId,
      memberId,
      db
    );
    const session = views.find((v) => v.view.id === id);
    expect(session?.columns.map((c) => c.normalizedKey)).toEqual(["email"]);
  });

  it("#680: a caller with write on the view gets the full definition", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "full_def",
      label: "Full",
      filter: AGE_FILTER,
      fieldMappingIds: [emailFmId, ageFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    const got = await request(app).get(`/api/curated-views/${id}`);
    const view = got.body.payload.curatedView;
    expect(view.filter).toEqual(AGE_FILTER);
    expect(view.filtered).toBe(true);
    expect(view.projected).toBe(true);
    expect([...view.fieldMappingIds].sort()).toEqual(
      [emailFmId, ageFmId].sort()
    );
    const list = await request(app).get(`/api/curated-views`);
    const row = (
      list.body.payload.curatedViews as Array<Record<string, unknown>>
    ).find((v) => v.id === id)!;
    expect(row.filter).toEqual(AGE_FILTER);
    expect(row.filtered).toBe(true);
    expect(row.projected).toBe(true);
  });

  it("#680: an unfiltered, unprojected view reads filtered: false, projected: false", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "plain",
      label: "Plain",
    });
    const id = created.body.payload.curatedView.id as string;
    await grantMemberViewAndEmail(id);
    for (const sub of [OWNER_SUB, MEMBER_SUB]) {
      currentSub = sub;
      const got = await request(app).get(`/api/curated-views/${id}`);
      expect(got.body.payload.curatedView.filtered).toBe(false);
      expect(got.body.payload.curatedView.projected).toBe(false);
      const list = await request(app).get(`/api/curated-views`);
      const row = (
        list.body.payload.curatedViews as Array<Record<string, unknown>>
      ).find((v) => v.id === id)!;
      expect(row.filtered).toBe(false);
      expect(row.projected).toBe(false);
    }
  });

  it("#678: sorting a json column is refused (400 CURATED_VIEW_INVALID_SORT)", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "json_sort",
      label: "Json sort",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app).get(
      `/api/curated-views/${id}/records?sortBy=tags&sortOrder=asc`
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_SORT);
  });

  it("#678: a caller who can't read a projected field mapping gets neither its column nor its values", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "partial_read",
      label: "Partial",
      fieldMappingIds: [emailFmId, ageFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    // The member may read the view, but only the email field mapping.
    const base = {
      organizationId: orgId,
      principalType: "user",
      principalId: memberId,
      effect: "allow",
      verb: "read",
      condition: null,
      conditionParam: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.permissionGrants)
      .values([
        {
          ...base,
          id: generateId(),
          resourceType: "curated_view",
          resourceId: id,
        },
        {
          ...base,
          id: generateId(),
          resourceType: "field_mapping",
          resourceId: emailFmId,
        },
      ] as never);

    currentSub = MEMBER_SUB;
    const res = await request(app).get(`/api/curated-views/${id}/records`);
    expect(res.status).toBe(200);
    expect(
      (res.body.payload.columns as Array<{ normalizedKey: string }>).map(
        (c) => c.normalizedKey
      )
    ).toEqual(["email"]);
    const rows = res.body.payload.records as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).not.toHaveProperty("age");
  });

  // ── #678 slice 3: the view-scoped ad-hoc filter ──────────────────

  const b64 = (group: unknown) =>
    Buffer.from(JSON.stringify(group)).toString("base64");
  const where = (...conditions: unknown[]) =>
    b64({ combinator: "and", conditions });
  const ages = (res: request.Response) =>
    (res.body.payload.records as Array<{ age: number }>)
      .map((r) => Number(r.age))
      .sort((a, b) => a - b);

  it("#678: `filters` narrows the rows and the total", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_narrow",
      label: "Narrow",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ filters: where({ field: "age", operator: "gt", value: 30 }) });
    expect(res.status).toBe(200);
    expect(ages(res)).toEqual([42]);
    expect(res.body.payload.total).toBe(1);
  });

  it("#678: `filters` only narrows: it can't bring back a row the view's own filter excludes", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_adults",
      label: "Adults",
      filter: {
        combinator: "and",
        conditions: [{ field: "age", operator: "gt", value: 30 }],
      },
    });
    const id = created.body.payload.curatedView.id as string;
    // An OR that matches every row, including the excluded 25-year-old.
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({
        filters: b64({
          combinator: "or",
          conditions: [
            { field: "age", operator: "lt", value: 30 },
            { field: "age", operator: "gte", value: 30 },
          ],
        }),
      });
    expect(res.status).toBe(200);
    expect(ages(res)).toEqual([42]);
    expect(res.body.payload.total).toBe(1);
  });

  it("#678: a filter on a column outside the view's projection is refused (400), before any query", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_email_only",
      label: "Email only",
      fieldMappingIds: [emailFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ filters: where({ field: "age", operator: "gt", value: 30 }) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER);
    expect(res.body.message).toMatch(/Unknown field/);
  });

  it("#678: a filter on a projected column the caller can't read is refused (400)", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_partial",
      label: "Partial",
      fieldMappingIds: [emailFmId, ageFmId],
    });
    const id = created.body.payload.curatedView.id as string;
    const base = {
      organizationId: orgId,
      principalType: "user",
      principalId: memberId,
      effect: "allow",
      verb: "read",
      condition: null,
      conditionParam: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.permissionGrants)
      .values([
        {
          ...base,
          id: generateId(),
          resourceType: "curated_view",
          resourceId: id,
        },
        {
          ...base,
          id: generateId(),
          resourceType: "field_mapping",
          resourceId: emailFmId,
        },
      ] as never);

    currentSub = MEMBER_SUB;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ filters: where({ field: "age", operator: "gt", value: 30 }) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER);
    // The readable column still filters fine.
    const ok = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({
        filters: where({ field: "email", operator: "eq", value: "a@b.co" }),
      });
    expect(ok.status).toBe(200);
    expect((ok.body.payload.records as unknown[]).length).toBe(1);
  });

  it.each([
    ["malformed base64", "%%%not-base64%%%"],
    ["base64 of malformed JSON", Buffer.from("{nope").toString("base64")],
    [
      "an operator invalid for the type",
      Buffer.from(
        JSON.stringify({
          combinator: "and",
          conditions: [{ field: "email", operator: "gt", value: "z" }],
        })
      ).toString("base64"),
    ],
  ])("#678: %s is a 400", async (_label, filters) => {
    const created = await createView({
      connectorEntityId: entityId,
      key: `f_bad_${generateId().slice(0, 6)}`,
      label: "Bad",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ filters });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER);
  });

  it("#678: an injection-shaped filter literal is escaped (the shared render), matching nothing", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_inj",
      label: "Inj",
    });
    const id = created.body.payload.curatedView.id as string;
    for (const value of [
      "'; DROP TABLE x; --",
      "a@b.co' OR '1'='1",
      "a\\' OR 1=1 --",
    ]) {
      const res = await request(app)
        .get(`/api/curated-views/${id}/records`)
        .query({ filters: where({ field: "email", operator: "eq", value }) });
      expect(res.status).toBe(200);
      expect((res.body.payload.records as unknown[]).length).toBe(0);
    }
    const still = await request(app).get(`/api/curated-views/${id}/records`);
    expect(still.body.payload.total).toBe(2);
  });

  it("#678: LIKE wildcards in a value match literally, not every row", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_like",
      label: "Like",
    });
    const id = created.body.payload.curatedView.id as string;
    for (const [operator, value] of [
      ["contains", "%"],
      ["starts_with", "_"],
      ["ends_with", "%"],
    ]) {
      const res = await request(app)
        .get(`/api/curated-views/${id}/records`)
        .query({ filters: where({ field: "email", operator, value }) });
      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(0);
    }
  });

  it.each(["__proto__", "constructor", "toString"])(
    "#678: a filter on the field %s is a 400 Unknown field, not a 500",
    async (field) => {
      const created = await createView({
        connectorEntityId: entityId,
        key: `f_proto_${generateId().slice(0, 6)}`,
        label: "Proto",
      });
      const id = created.body.payload.curatedView.id as string;
      const res = await request(app)
        .get(`/api/curated-views/${id}/records`)
        .query({ filters: where({ field, operator: "eq", value: "x" }) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER);
      expect(res.body.message).toBe(`Unknown field: "${field}"`);
    }
  );

  it.each([
    ["sortOrder", "sideways"],
    ["limit", "lots"],
  ])("#678: an invalid %s is a 400, not a 500", async (param, value) => {
    const created = await createView({
      connectorEntityId: entityId,
      key: `q_bad_${generateId().slice(0, 6)}`,
      label: "Bad query",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({ [param]: value });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.CURATED_VIEW_INVALID_QUERY);
    // #745: the message names the parameter; details carry the issues.
    expect(res.body.message).toMatch(
      new RegExp(`^Invalid curated view records query: ${param}: `)
    );
    expect(res.body.details.issues[0].path).toEqual([param]);
  });

  it("#678: filters, search and sort compose", async () => {
    const created = await createView({
      connectorEntityId: entityId,
      key: "f_compose",
      label: "Compose",
    });
    const id = created.body.payload.curatedView.id as string;
    const res = await request(app)
      .get(`/api/curated-views/${id}/records`)
      .query({
        filters: where({ field: "age", operator: "gte", value: 20 }),
        search: ".co",
        sortBy: "age",
        sortOrder: "desc",
      });
    expect(res.status).toBe(200);
    expect(
      (res.body.payload.records as Array<{ age: number }>).map((r) =>
        Number(r.age)
      )
    ).toEqual([42, 25]);
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
  created: number,
  createdBy: string
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
    createdBy,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}
