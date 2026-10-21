/**
 * #644: a curated view with an advanced (SQL) row filter, served through the
 * per-user reader-role session.
 *
 * Such a view is a pair of temp views: a server-built source view over the
 * wide table (org + soft-delete guard, no user text) and the curated view
 * itself, declared `security_invoker` so its body — the author's fragment
 * included — runs with the reader role's privileges. The reader holds
 * column-level SELECT on the source view's needed columns and nothing else, so
 * a fragment that reached Postgres without validation still couldn't read
 * another relation, another org's rows or a privileged function. These pin
 * that boundary end to end, and that one broken view never breaks a session.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import {
  WideTableStatementCache,
  wideTableStatementCache as singletonStatementCache,
} from "../../../services/wide-table-statement.cache.js";
import {
  PortalSqlServiceImpl,
  buildGuardedViewStatements,
  openSqlSession,
  resolveScopeHash,
} from "../../../services/portal-sql.service.js";
import { PortalSqlReaderRoleService } from "../../../services/portal-sql-reader-role.service.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  attachCuratedView,
} from "../utils/application.util.js";

type Db = ReturnType<typeof drizzle>;

const base = (now: number) => ({
  created: now,
  createdBy: "SYSTEM_TEST",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

describe("curated views with a SQL filter in the reader session (#644)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler!: WideTableReconcilerService;
  let portalSql!: PortalSqlServiceImpl;

  let orgId!: string;
  let otherOrgId!: string;
  let userId!: string;
  let stationId!: string;
  let parcelsEntityId!: string;
  let secretsEntityId!: string;
  let parcelsViewId!: string;
  const mappingIdByKey = new Map<string, string>();

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    const typed = db as Db;
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new WideTableStatementCache()
    );
    singletonStatementCache.clear();
    portalSql = new PortalSqlServiceImpl();
    await teardownOrg(typed);
    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    userId = user.id;
    await typed.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    orgId = org.id;
    await typed.insert(schema.organizations).values(org as never);
    const otherOrg = createOrganization(user.id, { name: "Other org" });
    otherOrgId = otherOrg.id;
    await typed.insert(schema.organizations).values(otherOrg as never);

    const definitionId = generateId();
    await typed.insert(schema.connectorDefinitions).values({
      ...base(now),
      id: definitionId,
      slug: `test-sql-filter-${generateId().slice(0, 8)}`,
      display: "Readable Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
    } as never);
    const instanceId = generateId();
    await typed.insert(schema.connectorInstances).values({
      ...base(now),
      id: instanceId,
      connectorDefinitionId: definitionId,
      organizationId: orgId,
      name: "Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
    } as never);
    stationId = generateId();
    await typed.insert(schema.stations).values({
      ...base(now),
      id: stationId,
      organizationId: orgId,
      name: "Station",
      description: null,
      toolPacks: ["data_query"],
    } as never);
    await typed.insert(schema.stationInstances).values({
      ...base(now),
      id: generateId(),
      stationId,
      connectorInstanceId: instanceId,
    } as never);

    parcelsEntityId = generateId();
    secretsEntityId = generateId();
    await typed.insert(schema.connectorEntities).values([
      {
        ...base(now),
        id: parcelsEntityId,
        organizationId: orgId,
        connectorInstanceId: instanceId,
        key: "parcels",
        label: "Parcels",
      },
      {
        ...base(now),
        id: secretsEntityId,
        organizationId: orgId,
        connectorInstanceId: instanceId,
        key: "secrets",
        label: "Secrets",
      },
    ] as never);

    const columns: Array<[string, string, string]> = [
      [parcelsEntityId, "name", "string"],
      [parcelsEntityId, "amount", "number"],
      [parcelsEntityId, "cost", "number"],
      [parcelsEntityId, "payload", "json"],
      [parcelsEntityId, "location", "geometry"],
      [secretsEntityId, "secret", "string"],
    ];
    mappingIdByKey.clear();
    for (const [i, [entityId, key, type]] of columns.entries()) {
      const columnDefinitionId = generateId();
      await typed.insert(schema.columnDefinitions).values({
        ...base(now),
        id: columnDefinitionId,
        organizationId: orgId,
        key: `${key}_${i}`,
        label: key,
        type,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
      } as never);
      const mappingId = generateId();
      mappingIdByKey.set(key, mappingId);
      await typed.insert(schema.fieldMappings).values({
        ...base(now + i),
        id: mappingId,
        organizationId: orgId,
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
      } as never);
    }
    await reconciler.reconcileEntity(parcelsEntityId, db);
    await reconciler.reconcileEntity(secretsEntityId, db);

    // Every wide-table row hangs off an `entity_records` row (FK).
    const record = async (entityId: string, org: string, sourceId: string) => {
      const id = generateId();
      await typed.insert(schema.entityRecords).values({
        ...base(now),
        id,
        organizationId: org,
        connectorEntityId: entityId,
        sourceId,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `checksum-${sourceId}`,
        origin: "sync",
      } as never);
      return id;
    };

    // Parcels: three live in this org (near the point, far from it, and a
    // loss-maker), one soft-deleted, and one in another org sharing the table.
    const parcel = async (
      org: string,
      sourceId: string,
      name: string,
      amount: number,
      cost: number,
      status: string,
      lng: number,
      deleted: number | null = null
    ) =>
      sql`(${await record(parcelsEntityId, org, sourceId)}, ${org}, ${now}, true, ${sourceId}, ${deleted}, ${name}, ${amount}, ${cost}, ${JSON.stringify({ status })}::jsonb, ST_SetSRID(ST_MakePoint(${lng}, 0), 4326))`;
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"er__${parcelsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "deleted", "c_name", "c_amount", "c_cost", "c_payload", "c_location") VALUES ${sql.join(
        [
          await parcel(orgId, "p-near", "near", 100, 40, "active", 0.001),
          await parcel(orgId, "p-far", "far", 100, 40, "active", 5),
          await parcel(orgId, "p-loss", "loss", 10, 40, "closed", 0.001),
          await parcel(
            orgId,
            "p-deleted",
            "deleted",
            100,
            40,
            "active",
            0.001,
            now
          ),
          await parcel(
            otherOrgId,
            "p-other",
            "other-org",
            100,
            40,
            "active",
            0.001
          ),
        ],
        sql`, `
      )}`
    );
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"er__${secretsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_secret") VALUES (${await record(secretsEntityId, orgId, "s-1")}, ${orgId}, ${now}, true, ${"s-1"}, ${"top secret"})`
    );

    parcelsViewId = await attachCuratedView(typed, {
      stationId,
      organizationId: orgId,
      connectorEntityId: parcelsEntityId,
      key: "parcels_view",
      label: "Parcels",
      createdBy: userId,
      grantToUserId: userId,
    });
  });

  afterEach(async () => {
    for (const id of [parcelsEntityId, secretsEntityId]) {
      try {
        await reconciler.dropTable(id, db);
      } catch {
        /* ignore */
      }
    }
    singletonStatementCache.clear();
    await connection.end();
  });

  async function setFilterSql(filterSql: string, keys: string[]) {
    await (db as Db)
      .update(schema.curatedViews)
      .set({
        filter: null,
        filterSql,
        filterSqlKeys: keys,
        updated: Date.now(),
      })
      .where(eq(schema.curatedViews.id, parcelsViewId));
  }

  async function project(keys: string[]) {
    const now = Date.now();
    await (db as Db).insert(schema.curatedViewFieldMappings).values(
      keys.map((key) => ({
        ...base(now),
        id: generateId(),
        organizationId: orgId,
        curatedViewId: parcelsViewId,
        fieldMappingId: mappingIdByKey.get(key)!,
      })) as never
    );
  }

  async function query(sqlText: string) {
    const res = await portalSql.runSqlQuery({
      userId,
      sql: sqlText,
      stationId,
      organizationId: orgId,
    });
    return ("rows" in res ? res.rows : []) as Array<Record<string, unknown>>;
  }

  /** Open a session on a hand-built build and run `probe` as the reader. */
  async function probeRole(
    build: Parameters<typeof openSqlSession>[1],
    probe: string
  ): Promise<{ degraded: ReadonlySet<string>; rows: unknown[] }> {
    await PortalSqlReaderRoleService.assertUsable();
    let captured: { degraded: ReadonlySet<string>; rows: unknown[] } | null =
      null;
    try {
      await db.transaction(async (tx) => {
        const opened = await openSqlSession(tx as never, build, {
          statementTimeoutMs: 10_000,
        });
        const rows = (await tx.execute(sql.raw(probe))) as unknown as unknown[];
        captured = { degraded: opened.degradedViewKeys, rows };
        throw new Error("__probe_done__");
      });
    } catch (err) {
      if ((err as Error).message !== "__probe_done__") throw err;
    }
    return captured!;
  }

  it("a spatial ST_DWithin filter returns exactly the near parcels", async () => {
    await setFilterSql(
      "ST_DWithin(location, ST_SetSRID(ST_MakePoint(0, 0), 4326), 0.01)",
      ["location"]
    );
    const rows = await query(
      `SELECT "c_name" FROM parcels_view ORDER BY "c_name"`
    );
    expect(rows.map((r) => r.c_name)).toEqual(["loss", "near"]);
  });

  it("a JSON-path and column-vs-column filter returns exactly the matching parcels", async () => {
    await setFilterSql("payload->>'status' = 'active' AND amount > cost", [
      "amount",
      "cost",
      "payload",
    ]);
    const rows = await query(
      `SELECT "c_name" FROM parcels_view ORDER BY "c_name"`
    );
    expect(rows.map((r) => r.c_name)).toEqual(["far", "near"]);
  });

  it("returns only the projected columns, even when the filter reads others", async () => {
    await project(["name"]);
    await setFilterSql("amount > cost", ["amount", "cost"]);
    const rows = await query(`SELECT * FROM parcels_view ORDER BY "c_name"`);
    expect(rows.map((r) => r.c_name)).toEqual(["far", "near"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["_connector_entity_id", "_record_id", "c_name", "source_id"].sort()
    );
  });

  it("never returns another org's or a soft-deleted row", async () => {
    await setFilterSql("amount > 0", ["amount"]);
    const rows = await query(`SELECT "c_name" FROM parcels_view`);
    const names = rows.map((r) => r.c_name);
    expect(names).not.toContain("other-org");
    expect(names).not.toContain("deleted");
    expect(names).toHaveLength(3);
  });

  it("agent SQL can't read the source view by name", async () => {
    await setFilterSql("amount > cost", ["amount", "cost"]);
    const build = await portalSql.resolveViewsForSession(
      stationId,
      orgId,
      userId,
      db
    );
    const source = build.guardedViews?.[0]?.sourceGrant.relation;
    expect(source).toMatch(/^__src_/);
    await expect(query(`SELECT * FROM "${source}"`)).rejects.toMatchObject({
      code: ApiCode.PORTAL_SQL_FORBIDDEN,
    });
  });

  it("a source-view name never collides with a curated view key in the session", async () => {
    await setFilterSql("amount > cost", ["amount", "cost"]);
    await attachCuratedView(db as Db, {
      stationId,
      organizationId: orgId,
      connectorEntityId: parcelsEntityId,
      key: "__src_0",
      label: "Squatter",
      createdBy: userId,
      grantToUserId: userId,
    });
    const build = await portalSql.resolveViewsForSession(
      stationId,
      orgId,
      userId,
      db
    );
    expect(build.guardedViews?.[0]?.sourceGrant.relation).not.toBe("__src_0");
    // The squatter is the plain, unfiltered view it claims to be.
    expect(await query(`SELECT "c_name" FROM "__src_0"`)).toHaveLength(3);
    expect(await query(`SELECT "c_name" FROM parcels_view`)).toHaveLength(2);
  });

  it("a stored filter whose types no longer fit degrades only its own view", async () => {
    // Valid to the static gate (name is a key) but a type error for Postgres,
    // as after a referenced column changed type.
    await setFilterSql("name > 5", ["name"]);
    await attachCuratedView(db as Db, {
      stationId,
      organizationId: orgId,
      connectorEntityId: secretsEntityId,
      key: "secrets_view",
      label: "Secrets",
      createdBy: userId,
      grantToUserId: userId,
    });
    expect(await query(`SELECT * FROM parcels_view`)).toEqual([]);
    expect(await query(`SELECT "c_secret" FROM secrets_view`)).toEqual([
      { c_secret: "top secret" },
    ]);
  });

  it("re-keys the scope hash when the SQL filter changes", async () => {
    await setFilterSql("amount > cost", ["amount", "cost"]);
    const before = resolveScopeHash(
      await portalSql.resolveViewsForSession(stationId, orgId, userId, db)
    );
    await setFilterSql("amount < cost", ["amount", "cost"]);
    const after = resolveScopeHash(
      await portalSql.resolveViewsForSession(stationId, orgId, userId, db)
    );
    expect(after).not.toBe(before);
  });

  describe("the reader role is the boundary, validator or not", () => {
    const guarded = (renderedWhere: string) =>
      buildGuardedViewStatements({
        viewId: "v1",
        viewKey: "probe_view",
        sourceName: "__src_probe",
        connectorEntityId: parcelsEntityId,
        organizationId: orgId,
        projectedColumns: ["c_name"],
        filterColumns: ["c_amount"],
        renderedWhere,
      });

    const sessionFor = (renderedWhere: string) => ({
      views: [],
      viewMap: new Map([["probe_view", "probe_view"]]),
      guardedViews: [guarded(renderedWhere)],
    });

    it("serves a well-formed fragment", async () => {
      const { rows, degraded } = await probeRole(
        sessionFor(`w."c_amount" > 50`),
        `SELECT "c_name" FROM probe_view ORDER BY "c_name"`
      );
      expect(degraded.size).toBe(0);
      expect(rows).toEqual([{ c_name: "far" }, { c_name: "near" }]);
    });

    it.each([
      ["another org table", `EXISTS (SELECT 1 FROM "organizations")`],
      [
        "another entity's wide table",
        () => `EXISTS (SELECT 1 FROM "er__${secretsEntityId}")`,
      ],
      ["a privileged function", `pg_read_file('postgresql.conf') IS NOT NULL`],
    ])("refuses %s at the role", async (_label, where) => {
      const fragment = typeof where === "function" ? where() : where;
      await expect(
        probeRole(sessionFor(fragment), `SELECT * FROM probe_view`)
      ).rejects.toMatchObject({
        // insufficient_privilege: refused by the reader role, not a parse or
        // missing-relation error.
        cause: expect.objectContaining({ code: "42501" }),
      });
    });

    it("degrades a fragment naming a column the source view doesn't carry", async () => {
      const { rows, degraded } = await probeRole(
        sessionFor(`w."c_cost" > 0`),
        `SELECT * FROM probe_view`
      );
      expect([...degraded]).toEqual(["probe_view"]);
      expect(rows).toEqual([]);
    });
  });
});
