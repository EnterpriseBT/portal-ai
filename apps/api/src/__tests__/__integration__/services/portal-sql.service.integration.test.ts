/**
 * Integration tests for PortalSqlService (Phase 3 slice 2).
 *
 * Two describe blocks — `resolveViewsForSession` view machinery (cases
 * 34–41; the org-wide `buildSessionViews` was retired in #643) and
 * `runSqlQuery` (cases 42–55 from
 * `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_3.spec.md`).
 *
 * The shared `beforeEach` builds a station with three connector
 * entities — two read-capable (`contacts`, `deals`) and one with read
 * disabled (`private_audit`) — reconciles their wide tables, seeds a
 * known set of `entity_records` + wide-table rows, and attaches curated
 * views granting `userId` read on the two readable ones. Each test then
 * either drives `resolveViewsForSession` directly (assertions on the
 * generated DDL + a probe SELECT inside a transaction) or calls
 * `runSqlQuery` against the live station.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import {
  WideTableStatementCache,
  wideTableStatementCache as singletonStatementCache,
} from "../../../services/wide-table-statement.cache.js";
import {
  PortalSqlServiceImpl,
  openSqlSession,
} from "../../../services/portal-sql.service.js";
import { PortalSqlReaderRoleService } from "../../../services/portal-sql-reader-role.service.js";
import { environment } from "../../../environment.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  attachCuratedView,
} from "../utils/application.util.js";

describe("PortalSqlService integration tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let statementCache: WideTableStatementCache;
  let reconciler: WideTableReconcilerService;
  let portalSql: PortalSqlServiceImpl;

  let orgId: string;
  let stationId: string;
  let contactsEntityId: string;
  let dealsEntityId: string;
  let privateEntityId: string;
  let userId: string;
  let contactsViewId: string;
  let dealsViewId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 8 });
    db = drizzle(connection, { schema });
    statementCache = new WideTableStatementCache();
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statementCache
    );
    // The service-under-test uses the singleton statement cache, since
    // the production execution path (runSqlQuery) is wired to it. Sync
    // the singleton with our local reconciler-driven cache by clearing
    // it before each test so a `runSqlQuery` call rebuilds against the
    // current state.
    singletonStatementCache.clear();
    portalSql = new PortalSqlServiceImpl();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    userId = user.id;
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    // Connector definition with read+write enabled.
    const connDefReadId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefReadId,
      slug: `test-read-${generateId().slice(0, 8)}`,
      display: "Readable Connector",
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

    // Connector instance for read+write (the station + entities below).
    const readInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: readInstanceId,
      connectorDefinitionId: connDefReadId,
      organizationId: orgId,
      name: "Readable Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      // Both read and write enabled.
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Second instance with read DISABLED — its entity is the
    // read-disabled `private_audit` below.
    const privateInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: privateInstanceId,
      connectorDefinitionId: connDefReadId,
      organizationId: orgId,
      name: "Write-Only Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      // Read DISABLED.
      enabledCapabilityFlags: { read: false, write: true, sync: true },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Station linking both instances.
    stationId = generateId();
    await dbTyped.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Test Station",
      description: null,
      toolPacks: ["data_query"],
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await dbTyped.insert(schema.stationInstances).values([
      {
        id: generateId(),
        stationId,
        connectorInstanceId: readInstanceId,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: generateId(),
        stationId,
        connectorInstanceId: privateInstanceId,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    // Two read-capable entities (contacts + deals) and one read-disabled.
    contactsEntityId = generateId();
    dealsEntityId = generateId();
    privateEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values([
      {
        id: contactsEntityId,
        organizationId: orgId,
        connectorInstanceId: readInstanceId,
        key: "contacts",
        label: "Contacts",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: dealsEntityId,
        organizationId: orgId,
        connectorInstanceId: readInstanceId,
        key: "deals",
        label: "Deals",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: privateEntityId,
        organizationId: orgId,
        connectorInstanceId: privateInstanceId,
        key: "private_audit",
        label: "Private Audit",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    // Column definitions + field mappings.
    // contacts: c_email (text), c_age (number)
    // deals: c_amount (number), c_account_ref (text — JOIN target via source_id)
    // private_audit: c_payload (text) — should never appear in any view.
    const cdEmail = generateId();
    const cdAge = generateId();
    const cdAmount = generateId();
    const cdAccountRef = generateId();
    const cdPayload = generateId();

    await dbTyped
      .insert(schema.columnDefinitions)
      .values([
        mkColumnDef(cdEmail, orgId, "email", "Email", "string", now),
        mkColumnDef(cdAge, orgId, "age", "Age", "number", now),
        mkColumnDef(cdAmount, orgId, "amount", "Amount", "number", now),
        mkColumnDef(
          cdAccountRef,
          orgId,
          "account_ref",
          "Account Ref",
          "string",
          now
        ),
        mkColumnDef(cdPayload, orgId, "payload", "Payload", "string", now),
      ] as never);

    await dbTyped
      .insert(schema.fieldMappings)
      .values([
        mkMapping(orgId, contactsEntityId, cdEmail, "Email", "email", now),
        mkMapping(orgId, contactsEntityId, cdAge, "Age", "age", now + 1),
        mkMapping(orgId, dealsEntityId, cdAmount, "Amount", "amount", now),
        mkMapping(
          orgId,
          dealsEntityId,
          cdAccountRef,
          "Account Ref",
          "account_ref",
          now + 1
        ),
        mkMapping(orgId, privateEntityId, cdPayload, "Payload", "payload", now),
      ] as never);

    // Reconcile all three entities so the wide tables exist with the
    // expected `c_*` columns.
    await reconciler.reconcileEntity(contactsEntityId, db);
    await reconciler.reconcileEntity(dealsEntityId, db);
    await reconciler.reconcileEntity(privateEntityId, db);
    // #599: attach default curated views (the cutover data attachment). Grant
    // the test user read on the two readable ones; private_audit is attached
    // but ungranted, so it stays out of the per-user session.
    contactsViewId = await attachCuratedView(dbTyped, {
      stationId,
      organizationId: orgId,
      connectorEntityId: contactsEntityId,
      key: "contacts",
      label: "Contacts",
      createdBy: user.id,
      grantToUserId: user.id,
    });
    dealsViewId = await attachCuratedView(dbTyped, {
      stationId,
      organizationId: orgId,
      connectorEntityId: dealsEntityId,
      key: "deals",
      label: "Deals",
      createdBy: user.id,
      grantToUserId: user.id,
    });
    await attachCuratedView(dbTyped, {
      stationId,
      organizationId: orgId,
      connectorEntityId: privateEntityId,
      key: "private_audit",
      label: "Private Audit",
      createdBy: user.id,
    });
    // Grant the test user class-wide `read column_definition` so the per-user
    // session includes the admin-facing `_meta_column_catalog` view (it is
    // gated on `canPerformAny("read","column_definition")` in
    // buildViewsForSession). This keeps the catalog coverage below on the live
    // per-user path; a member without this grant simply omits the view.
    await dbTyped.insert(schema.permissionGrants).values({
      id: generateId(),
      organizationId: orgId,
      principalType: "user",
      principalId: user.id,
      effect: "allow",
      verb: "read",
      resourceType: "column_definition",
      resourceId: null,
      condition: null,
      conditionParam: null,
      created: now,
      createdBy: user.id,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(contactsEntityId, db);
    } catch {
      /* ignore */
    }
    try {
      await reconciler.dropTable(dealsEntityId, db);
    } catch {
      /* ignore */
    }
    try {
      await reconciler.dropTable(privateEntityId, db);
    } catch {
      /* ignore */
    }
    statementCache.clear();
    singletonStatementCache.clear();
    await connection.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────

  async function insertEntityRecord(
    entityId: string,
    id: string,
    sourceId: string
  ): Promise<void> {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();
    await dbTyped.insert(schema.entityRecords).values({
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      sourceId,
      isValid: true,
      validationErrors: null,
      normalizedData: {},
      syncedAt: now,
      data: {},
      checksum: `checksum-${sourceId}-${id}`,
      origin: "sync",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  }

  /**
   * Helper that runs `resolveViewsForSession` (the per-user view builder — the
   * org-wide `buildSessionViews` was retired in #643) inside a transaction,
   * materialises the DDL, runs the provided probe SQL, and rolls the
   * transaction back. The fixture grants `userId` read on the two readable
   * views (contacts, deals) with all their columns, so the resolved view set +
   * projections match what the org-wide builder produced for this station.
   */
  async function probeInsideTx<T>(
    probeSql: string
  ): Promise<{ ddlByEntity: Map<string, string>; rows: T[] }> {
    let captured: { ddlByEntity: Map<string, string>; rows: T[] } | undefined;
    try {
      await db.transaction(async (tx) => {
        const build = await portalSql.resolveViewsForSession(
          stationId,
          orgId,
          userId,
          tx as unknown as DbClient
        );
        const ddlByEntity = new Map<string, string>();
        // #599: each view now emits DROP + CREATE (pushTempView), so a
        // positional zip against viewMap no longer aligns — key by the CREATE
        // statement's view name instead.
        for (const ddl of build.views) {
          const m = ddl.match(/^CREATE TEMP VIEW\s+"([^"]+)"/);
          if (m) ddlByEntity.set(m[1], ddl);
        }
        for (const ddl of build.views) {
          await tx.execute(sql.raw(ddl));
        }
        // Flip into read-only AFTER view creation — Postgres refuses
        // `CREATE TEMP VIEW` under `transaction_read_only = on`.
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));
        const result = await tx.execute(sql.raw(probeSql));
        captured = {
          ddlByEntity,
          rows: result as unknown as T[],
        };
        // Force rollback to clean up temp views.
        throw new Error("__probe_done__");
      });
    } catch (err) {
      if ((err as Error).message !== "__probe_done__") throw err;
    }
    if (!captured) throw new Error("probe never captured");
    return captured;
  }

  // ═════════════════════════════════════════════════════════════════════
  // resolveViewsForSession — view-building machinery (cases 34–41)
  // (org-wide buildSessionViews retired #643; the same DDL machinery is now
  // reached per-user, so these assertions run against the live path)
  // ═════════════════════════════════════════════════════════════════════

  describe("resolveViewsForSession (view machinery)", () => {
    // Case 34
    it("produces a temp view for each read-capable entity, named after entity.key", async () => {
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      // viewMap now also carries the three schema-introspection meta
      // views (_meta_entities, _meta_columns, _meta_column_catalog)
      // added in #87. Connector instances are static for the session
      // and live in the system prompt, not as a meta view.
      expect([...ddlByEntity.keys()].sort()).toEqual([
        "_meta_column_catalog",
        "_meta_columns",
        "_meta_entities",
        "contacts",
        "deals",
      ]);
      expect(ddlByEntity.get("contacts")).toMatch(
        /CREATE\s+TEMP\s+VIEW\s+"contacts"/i
      );
      expect(ddlByEntity.get("deals")).toMatch(
        /CREATE\s+TEMP\s+VIEW\s+"deals"/i
      );
    });

    // Case 35
    it("excludes read-disabled entities (no view, LLM cannot SELECT from them)", async () => {
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      expect(ddlByEntity.has("private_audit")).toBe(false);
    });

    // Case 36
    it("projects _record_id and _connector_entity_id synthetic columns", async () => {
      const r1 = generateId();
      await insertEntityRecord(contactsEntityId, r1, "src-1");
      await (db as ReturnType<typeof drizzle>).execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${r1}, ${orgId}, ${Date.now()}, true, ${"src-1"}, ${"a@b.co"}, ${25})`
      );

      const { rows } = await probeInsideTx<{
        _record_id: string;
        _connector_entity_id: string;
      }>(`SELECT "_record_id", "_connector_entity_id" FROM "contacts"`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?._record_id).toBe(r1);
      expect(rows[0]?._connector_entity_id).toBe(contactsEntityId);
    });

    // Case 37
    it("projects every live data column under its c_<sanitized> name", async () => {
      const r1 = generateId();
      await insertEntityRecord(contactsEntityId, r1, "src-1");
      await (db as ReturnType<typeof drizzle>).execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${r1}, ${orgId}, ${Date.now()}, true, ${"src-1"}, ${"x@y.co"}, ${42})`
      );

      const { rows } = await probeInsideTx<{
        c_email: string;
        c_age: string;
      }>(`SELECT "c_email", "c_age" FROM "contacts"`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.c_email).toBe("x@y.co");
      expect(String(rows[0]?.c_age)).toBe("42");
    });

    // Case 38
    it("excludes raw metadata columns (organization_id, synced_at, is_valid)", async () => {
      // Probing the view for the hidden columns should fail at SQL
      // planning time — they are not part of the view's projection.
      await expect(
        probeInsideTx(`SELECT "organization_id" FROM "contacts"`)
      ).rejects.toThrow(/organization_id/);
      await expect(
        probeInsideTx(`SELECT "synced_at" FROM "contacts"`)
      ).rejects.toThrow(/synced_at/);
      await expect(
        probeInsideTx(`SELECT "is_valid" FROM "contacts"`)
      ).rejects.toThrow(/is_valid/);
    });

    // Case 39
    it("the view filters by organization_id (DDL embeds the org literal)", async () => {
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      const contactsDdl = ddlByEntity.get("contacts") ?? "";
      expect(contactsDdl).toMatch(
        new RegExp(`organization_id"?\\s*=\\s*'${orgId}'`, "i")
      );
    });

    // Case 40
    it("the view filters out soft-deleted rows (#450: local wide.deleted, no join)", async () => {
      const live = generateId();
      const dead = generateId();
      await insertEntityRecord(contactsEntityId, live, "src-live");
      await insertEntityRecord(contactsEntityId, dead, "src-dead");
      const now = Date.now();
      await (db as ReturnType<typeof drizzle>).execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email") VALUES (${live}, ${orgId}, ${now}, true, ${"src-live"}, ${"live@x.co"}), (${dead}, ${orgId}, ${now}, true, ${"src-dead"}, ${"dead@x.co"})`
      );
      // Soft-delete the second row — the real delete paths mark BOTH the
      // entity_records row and the wide row (#450), so the view can filter the
      // wide row locally without joining entity_records.
      await (db as ReturnType<typeof drizzle>).execute(
        sql`UPDATE ${schema.entityRecords} SET deleted = ${now}, deleted_by = 'test' WHERE id = ${dead}`
      );
      await (db as ReturnType<typeof drizzle>).execute(
        sql`UPDATE ${sql.raw(`"er__${contactsEntityId}"`)} SET "deleted" = ${now} WHERE "entity_record_id" = ${dead}`
      );

      const { rows } = await probeInsideTx<{ c_email: string }>(
        `SELECT "c_email" FROM "contacts" ORDER BY "c_email"`
      );
      expect(rows.map((r) => r.c_email)).toEqual(["live@x.co"]);
    });

    // Case 40b — the mechanism: local filter, no entity_records join (#450).
    it("filters on the wide table's own deleted column, not a JOIN to entity_records", async () => {
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      const contactsDdl = ddlByEntity.get("contacts") ?? "";
      // The 14.6x win: no join to entity_records in the view.
      expect(contactsDdl.toLowerCase()).not.toContain("join entity_records");
      expect(contactsDdl.toLowerCase()).not.toContain("entity_records er");
      // Filtering is local to the wide row.
      expect(contactsDdl).toMatch(/"deleted"\s+is\s+null/i);
    });

    // Case 41 — reconciler-added column appears on the next build.
    it("a column added by the reconciler appears on the next resolveViewsForSession", async () => {
      // Pre-state: contacts has c_email + c_age.
      const before = await probeInsideTx<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'contacts'`
      );
      // The information_schema view of a temp view is hit-or-miss; assert
      // via the projected column list instead.
      const beforeCols = (
        await probeInsideTx(`SELECT * FROM "contacts" LIMIT 0`)
      ).rows;
      expect(beforeCols).toEqual([]);
      void before;

      // Add a new column-definition + field-mapping; reconcile.
      const dbTyped = db as ReturnType<typeof drizzle>;
      const now = Date.now();
      const newCd = generateId();
      await dbTyped
        .insert(schema.columnDefinitions)
        .values(
          mkColumnDef(newCd, orgId, "phone", "Phone", "string", now) as never
        );
      await dbTyped
        .insert(schema.fieldMappings)
        .values(
          mkMapping(
            orgId,
            contactsEntityId,
            newCd,
            "Phone",
            "phone",
            now
          ) as never
        );
      await reconciler.reconcileEntity(contactsEntityId, db);

      // The new column must now be projected by the rebuilt view.
      const r1 = generateId();
      await insertEntityRecord(contactsEntityId, r1, "src-1");
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age", "c_phone") VALUES (${r1}, ${orgId}, ${now}, true, ${"src-1"}, ${"a@b.co"}, ${30}, ${"555-1212"})`
      );
      // The portal-sql singleton needs to pick up the rebuilt schema —
      // the production statementCache is the singleton; the reconciler
      // invalidated *its* cache (the one passed at construction). Sync
      // by clearing the singleton too.
      singletonStatementCache.clear();
      const { rows } = await probeInsideTx<{ c_phone: string }>(
        `SELECT "c_phone" FROM "contacts"`
      );
      expect(rows.map((r) => r.c_phone)).toEqual(["555-1212"]);
    });

    // Cases 42–47 — schema-introspection meta views (#87).

    it("emits a _meta_entities view listing every granted curated view", async () => {
      // #643/#599: per-user, `_meta_entities` lists the caller's granted
      // curated views (id = curated_view id), not raw connector entities.
      const { rows } = await probeInsideTx<{
        id: string;
        key: string;
        label: string;
      }>(`SELECT id, key, label FROM "_meta_entities" ORDER BY key`);
      expect(rows).toEqual([
        { id: contactsViewId, key: "contacts", label: "Contacts" },
        { id: dealsViewId, key: "deals", label: "Deals" },
      ]);
    });

    it("excludes read-disabled entities from _meta_entities", async () => {
      const { rows } = await probeInsideTx<{ key: string }>(
        `SELECT key FROM "_meta_entities" WHERE key = 'private_audit'`
      );
      expect(rows).toHaveLength(0);
    });

    it("emits a _meta_columns view with the joined column catalog", async () => {
      const { rows } = await probeInsideTx<{
        entity_key: string;
        column_key: string;
        label: string;
        type: string;
      }>(
        `SELECT entity_key, column_key, label, type FROM "_meta_columns" ORDER BY entity_key, column_key`
      );
      expect(rows).toEqual([
        {
          entity_key: "contacts",
          column_key: "age",
          label: "Age",
          type: "number",
        },
        {
          entity_key: "contacts",
          column_key: "email",
          label: "Email",
          type: "string",
        },
        {
          entity_key: "deals",
          column_key: "account_ref",
          label: "Account Ref",
          type: "string",
        },
        {
          entity_key: "deals",
          column_key: "amount",
          label: "Amount",
          type: "number",
        },
      ]);
    });

    it("excludes columns of read-disabled entities from _meta_columns", async () => {
      const { rows } = await probeInsideTx<{ entity_key: string }>(
        `SELECT entity_key FROM "_meta_columns" WHERE entity_key = 'private_audit'`
      );
      expect(rows).toHaveLength(0);
    });

    it("_meta_columns projects the wide_column_name so the agent knows the physical SQL column", async () => {
      // The agent needs to know that the "email" column-definition maps to
      // c_email on the entity view so it can write valid SELECTs.
      const { rows } = await probeInsideTx<{
        entity_key: string;
        column_key: string;
        wide_column_name: string;
      }>(
        `SELECT entity_key, column_key, wide_column_name FROM "_meta_columns" WHERE entity_key = 'contacts' ORDER BY column_key`
      );
      expect(rows).toEqual([
        {
          entity_key: "contacts",
          column_key: "age",
          wide_column_name: "c_age",
        },
        {
          entity_key: "contacts",
          column_key: "email",
          wide_column_name: "c_email",
        },
      ]);
    });

    it("_meta_entities and _meta_columns DDL embeds the organizationId literal in the WHERE clause", async () => {
      // Org-scope guard — mirror the same defensive check the entity-data
      // views rely on. Cross-org leaks are prevented by the literal being
      // baked into the view definition at build time.
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      const metaEntitiesDdl = ddlByEntity.get("_meta_entities") ?? "";
      const metaColumnsDdl = ddlByEntity.get("_meta_columns") ?? "";
      expect(metaEntitiesDdl).toMatch(
        new RegExp(`WHERE\\s+[\\s\\S]*"organization_id"\\s*=\\s*'${orgId}'`)
      );
      expect(metaColumnsDdl).toMatch(
        new RegExp(`WHERE\\s+[\\s\\S]*"organization_id"\\s*=\\s*'${orgId}'`)
      );
    });

    // _meta_column_catalog — org-wide curated column-definition catalog.
    // Distinct from _meta_columns, which only lists columns bound to
    // entities; _meta_column_catalog includes unbound column definitions
    // so the agent knows what's available to wire up when creating a
    // new entity. Column definitions are admin-only — agent can't make
    // new ones.

    it("emits a _meta_column_catalog view listing every column definition in the org", async () => {
      const { rows } = await probeInsideTx<{
        column_key: string;
        label: string;
        type: string;
      }>(
        `SELECT column_key, label, type FROM "_meta_column_catalog" ORDER BY column_key`
      );
      // From the test fixture: email, age, amount, account_ref, payload.
      // ALL appear — including `payload` whose entity (private_audit) is
      // read-disabled. The catalog is the curated org-wide list, not
      // station-filtered.
      expect(rows).toEqual([
        { column_key: "account_ref", label: "Account Ref", type: "string" },
        { column_key: "age", label: "Age", type: "number" },
        { column_key: "amount", label: "Amount", type: "number" },
        { column_key: "email", label: "Email", type: "string" },
        { column_key: "payload", label: "Payload", type: "string" },
      ]);
    });

    it("_meta_column_catalog includes unbound column definitions", async () => {
      // Seed a column definition with NO field_mapping. _meta_columns
      // (entity-joined) won't see it; _meta_column_catalog (org-only)
      // must. This is the case the agent needs to detect "this column
      // exists in the catalog but isn't wired to anything yet."
      const newCd = generateId();
      const dbTyped = db as ReturnType<typeof drizzle>;
      const now = Date.now();
      await dbTyped
        .insert(schema.columnDefinitions)
        .values(
          mkColumnDef(
            newCd,
            orgId,
            "unbound_yet",
            "Unbound Yet",
            "string",
            now
          ) as never
        );

      const { rows: catalog } = await probeInsideTx<{ column_key: string }>(
        `SELECT column_key FROM "_meta_column_catalog" WHERE column_key = 'unbound_yet'`
      );
      expect(catalog).toEqual([{ column_key: "unbound_yet" }]);

      const { rows: bound } = await probeInsideTx<{ column_key: string }>(
        `SELECT column_key FROM "_meta_columns" WHERE column_key = 'unbound_yet'`
      );
      expect(bound).toHaveLength(0);
    });

    it("_meta_column_catalog DDL embeds the organizationId literal in the WHERE clause", async () => {
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      const ddl = ddlByEntity.get("_meta_column_catalog") ?? "";
      expect(ddl).toMatch(
        new RegExp(`WHERE\\s+[\\s\\S]*"organization_id"\\s*=\\s*'${orgId}'`)
      );
    });

    it("does NOT emit a _meta_connector_instances view (instances are static in the prompt instead)", async () => {
      // Connector instances are configuration: they don't change while
      // a portal is live, so listing them once in the system prompt at
      // session start (per system.prompt.ts → "## Available Connector
      // Instances") is the right surface. A meta view here would just
      // waste an LLM roundtrip on data the agent already has in its
      // prompt.
      const { ddlByEntity } = await probeInsideTx("SELECT 1");
      expect(ddlByEntity.has("_meta_connector_instances")).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // runSqlQuery — cases 42–55
  // ═════════════════════════════════════════════════════════════════════

  describe("runSqlQuery", () => {
    async function seedContacts(
      count: number,
      ageBase = 20
    ): Promise<string[]> {
      const ids: string[] = [];
      const tuples: ReturnType<typeof sql>[] = [];
      const now = Date.now();
      for (let i = 0; i < count; i++) {
        const id = generateId();
        const sourceId = `src-${i}`;
        await insertEntityRecord(contactsEntityId, id, sourceId);
        ids.push(id);
        tuples.push(
          sql`(${id}, ${orgId}, ${now}, true, ${sourceId}, ${`u${i}@x.co`}, ${ageBase + i})`
        );
      }
      const dbTyped = db as ReturnType<typeof drizzle>;
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES ${sql.join(tuples, sql`, `)}`
      );
      return ids;
    }

    // Case 42
    it("SELECT COUNT(*) FROM contacts returns 1 row", async () => {
      await seedContacts(3);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT COUNT(*) AS n FROM contacts`,
        stationId,
        organizationId: orgId,
      });
      expect("rows" in res ? res.rows : []).toHaveLength(1);
      // Postgres returns COUNT(*) as bigint, surfaced as a numeric string.
      const row0 = ("rows" in res ? res.rows[0] : {}) as Record<
        string,
        unknown
      >;
      expect(String(row0?.n)).toBe("3");
      // Aggregation — no implicit limit wrap.
      expect(
        ("appliedLimit" in res ? res.appliedLimit : null) ?? null
      ).toBeNull();
    });

    // Case 43
    it("SELECT * FROM contacts WHERE c_age > 30 LIMIT 5 returns matching rows", async () => {
      await seedContacts(10, 25); // ages 25..34
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email", "c_age" FROM contacts WHERE "c_age" > 30 ORDER BY "c_age" LIMIT 5`,
        stationId,
        organizationId: orgId,
      });
      const rows = "rows" in res ? res.rows : [];
      expect(rows).toHaveLength(4); // ages 31, 32, 33, 34
      expect(rows.every((r) => Number(r.c_age) > 30)).toBe(true);
    });

    // #340: computeExactTotal reports the TRUE total via a same-txn COUNT(*),
    // while rowCount/totalCount stay the capped `rowCap+1` staging probe.
    it("#340: computeExactTotal returns the exact total beyond the row cap", async () => {
      await seedContacts(7);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts`,
        stationId,
        organizationId: orgId,
        computeExactTotal: true,
        rowCap: 3,
      });
      expect((res as { exactTotal?: number | null }).exactTotal).toBe(7);
      // The probe still caps at rowCap+1 = 4; the exact count is the truth.
      expect("totalCount" in res ? res.totalCount : undefined).toBe(4);
    });

    it("#340: omitting computeExactTotal yields no exactTotal", async () => {
      await seedContacts(5);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts`,
        stationId,
        organizationId: orgId,
        rowCap: 3,
      });
      expect(
        (res as { exactTotal?: number | null }).exactTotal
      ).toBeUndefined();
    });

    // #129 slice-2 caveat closer: the cursor tier wraps the retained query
    // as `SELECT * FROM (<sql>) _cur WHERE (orderBy, _record_id) > (…)
    // ORDER BY orderBy, _record_id LIMIT n` and runs it via runSqlQuery.
    // This proves (a) validatePortalSql accepts that wrapper, and (b) the
    // entity views compose INSIDE the subquery — the only thing the
    // streamHandle unit tests (mocked runSqlQuery) couldn't.
    it("#129: a wrapped keyset query re-executes against the views, paging by (c_age, _record_id)", async () => {
      await seedContacts(5, 10); // c_age 10..14, distinct _record_id
      const inner = `SELECT "_record_id", "c_age" FROM contacts`;
      const page = async (where: string) => {
        const res = await portalSql.runSqlQuery({
          userId,
          sql:
            `SELECT * FROM (${inner}) "_cur" ${where} ` +
            `ORDER BY "c_age" ASC, "_record_id" ASC LIMIT 2`,
          stationId,
          organizationId: orgId,
        });
        return ("rows" in res ? res.rows : []) as Array<
          Record<string, unknown>
        >;
      };

      const p1 = await page(""); // first page, no cursor
      expect(p1.map((r) => Number(r.c_age))).toEqual([10, 11]);

      const last = p1[1];
      const p2 = await page(
        `WHERE ("c_age", "_record_id") > ` +
          `(${Number(last.c_age)}, '${String(last._record_id)}')`
      );
      expect(p2.map((r) => Number(r.c_age))).toEqual([12, 13]); // keyset continues

      const ids = [...p1, ...p2].map((r) => String(r._record_id));
      expect(new Set(ids).size).toBe(4); // no overlap across pages
    });

    // Case 44
    it("projects _record_id as a non-null text per row", async () => {
      await seedContacts(2);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "_record_id", "c_email" FROM contacts ORDER BY "c_email" LIMIT 10`,
        stationId,
        organizationId: orgId,
      });
      const rows = "rows" in res ? res.rows : [];
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(typeof r._record_id).toBe("string");
        expect((r._record_id as string).length).toBeGreaterThan(0);
      }
    });

    // Case 45 — JOIN across entities via source_id.
    it("supports cross-entity JOIN on source_id", async () => {
      // Seed two contacts.
      const c1 = generateId();
      const c2 = generateId();
      await insertEntityRecord(contactsEntityId, c1, "acct-1");
      await insertEntityRecord(contactsEntityId, c2, "acct-2");
      const now = Date.now();
      const dbTyped = db as ReturnType<typeof drizzle>;
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${c1}, ${orgId}, ${now}, true, ${"acct-1"}, ${"a@a.co"}, ${30}), (${c2}, ${orgId}, ${now}, true, ${"acct-2"}, ${"b@b.co"}, ${40})`
      );
      // Seed one deal whose c_account_ref points at the first contact.
      const d1 = generateId();
      await insertEntityRecord(dealsEntityId, d1, "deal-1");
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${dealsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_amount", "c_account_ref") VALUES (${d1}, ${orgId}, ${now}, true, ${"deal-1"}, ${100}, ${"acct-1"})`
      );

      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT d."c_amount" AS amt, c."c_email" AS email
              FROM deals d
              JOIN contacts c ON c."source_id" = d."c_account_ref"`,
        stationId,
        organizationId: orgId,
      });
      const rows = "rows" in res ? res.rows : [];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe("a@a.co");
      expect(String(rows[0]?.amt)).toBe("100");
    });

    // Case 46 — implicit LIMIT fires.
    it("wraps a bare SELECT with the implicit LIMIT and reports appliedLimit", async () => {
      await seedContacts(3);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts`,
        stationId,
        organizationId: orgId,
      });
      // 3 rows < default rowCap, so the response is plain with the
      // appliedLimit field set to rowCap + 1 = 501.
      expect("appliedLimit" in res ? res.appliedLimit : null).toBe(501);
      expect("rows" in res ? res.rows.length : 0).toBe(3);
    });

    // Case 47 — row cap fires when rows exceed the configured rowCap.
    it("trips the row cap and emits the truncated envelope", async () => {
      await seedContacts(20);
      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email", "c_age" FROM contacts ORDER BY "c_age" LIMIT 1000`,
        stationId,
        organizationId: orgId,
        // Override the cap to keep the test fast.
        rowCap: 5,
      });
      // The wrap is skipped (explicit LIMIT present); the row cap fires.
      expect("truncated" in res && res.truncated).toBe(true);
      if ("truncated" in res && "rows" in res) {
        expect(res.rows).toHaveLength(5);
        expect(res.totalCount).toBe(20);
        expect(res.hint).toMatch(/truncated to 5 rows/);
      }
    });

    // Cases 48–52 — validation rejects.
    it.each([
      ["INSERT INTO contacts (c_email) VALUES ('x@y.co')", /reserved verb/i],
      ["UPDATE contacts SET c_email = 'x'", /reserved verb/i],
      ["DROP TABLE contacts", /reserved verb/i],
      ["SELECT * FROM pg_tables", /system catalog access/i],
      ["SELECT 1; DROP TABLE entity_records", /multi-statement/i],
    ])("rejects %p", async (badSql, expected) => {
      await expect(
        portalSql.runSqlQuery({
          userId,
          sql: badSql,
          stationId,
          organizationId: orgId,
        })
      ).rejects.toThrow(expected);
    });

    // Case 53 — cross-org isolation. The view's WHERE clause embeds
    // the caller's orgId; rows written under a different org never
    // appear, regardless of the LLM-supplied filter.
    it("the view's org filter is structural — rows from another org are invisible", async () => {
      const dbTyped = db as ReturnType<typeof drizzle>;
      const now = Date.now();

      // Create a second org and an entity_records row under it pointing
      // at the SAME wide table (cross-org row in the same er__ table —
      // possible in theory if a bug ever bypasses tenant scoping).
      const otherOrgUser = createUser(`auth0|${generateId()}`);
      await dbTyped.insert(schema.users).values(otherOrgUser as never);
      const otherOrg = createOrganization(otherOrgUser.id);
      await dbTyped.insert(schema.organizations).values(otherOrg as never);

      // Seed a row under the *other* org id on the contacts wide table.
      const intruderId = generateId();
      await dbTyped.insert(schema.entityRecords).values({
        id: intruderId,
        organizationId: otherOrg.id,
        connectorEntityId: contactsEntityId,
        sourceId: "intruder-1",
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `c-intruder`,
        origin: "sync",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email") VALUES (${intruderId}, ${otherOrg.id}, ${now}, true, ${"intruder-1"}, ${"intruder@evil.co"})`
      );

      // Also seed a legitimate row under the test org.
      const legit = generateId();
      await insertEntityRecord(contactsEntityId, legit, "legit-1");
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email") VALUES (${legit}, ${orgId}, ${now}, true, ${"legit-1"}, ${"legit@me.co"})`
      );

      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts ORDER BY "c_email"`,
        stationId,
        organizationId: orgId,
      });
      const rows = "rows" in res ? res.rows : [];
      expect(rows.map((r) => r.c_email)).toEqual(["legit@me.co"]);
    });

    // Case 54 — read-disabled entity not in the view set; LLM gets
    // PORTAL_SQL_FORBIDDEN with the "unknown entity" hint.
    it("read-disabled entity is unreachable; the LLM sees PORTAL_SQL_FORBIDDEN", async () => {
      await expect(
        portalSql.runSqlQuery({
          userId,
          sql: `SELECT 1 FROM private_audit`,
          stationId,
          organizationId: orgId,
        })
      ).rejects.toThrow(/unknown entity: private_audit/);
    });

    // Phase 3 slice 5 case 71 — read-after-write semantics.
    // After a Postgres write commits, the next `sql_query` SELECT sees
    // the new value. No in-memory cache to invalidate; Postgres is the
    // single source of truth.
    it("sql_query SELECT sees a committed Postgres write immediately", async () => {
      const r = generateId();
      await insertEntityRecord(contactsEntityId, r, "src-1");
      const now = Date.now();
      const dbTyped = db as ReturnType<typeof drizzle>;
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${r}, ${orgId}, ${now}, true, ${"src-1"}, ${"before@x.co"}, ${20})`
      );

      const before = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts WHERE "_record_id" = '${r}'`,
        stationId,
        organizationId: orgId,
      });
      expect("rows" in before ? before.rows : []).toEqual([
        { c_email: "before@x.co" },
      ]);

      // Update the wide-table row directly (mimicking what
      // entity_record_update does in production).
      await dbTyped.execute(
        sql`UPDATE ${sql.raw(`"er__${contactsEntityId}"`)} SET "c_email" = ${"after@x.co"} WHERE "entity_record_id" = ${r}`
      );

      const after = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM contacts WHERE "_record_id" = '${r}'`,
        stationId,
        organizationId: orgId,
      });
      expect("rows" in after ? after.rows : []).toEqual([
        { c_email: "after@x.co" },
      ]);
    });
  });

  // #599 slice 3b: end-to-end view-scoping over the real resolver.
  // `resolveGrantedViewColumns` is the single source both the SQL session
  // (resolveViewsForSession) and the introspection surfaces (buildStationContext
  // roster + the station_context tool) consume, so asserting it against real
  // seeded data proves a member sees only granted views + readable columns
  // across query, roster, and introspection. Consumer wiring is unit-tested in
  // portal.service.test / station-context.tool.test.
  describe("curated-views end-to-end view-scoping (#599)", () => {
    it("resolves only the caller's granted views + readable columns", async () => {
      const { views } = await portalSql.resolveGrantedViewColumns(
        stationId,
        orgId,
        userId,
        db
      );
      expect(views.map((v) => v.view.key).sort()).toEqual([
        "contacts",
        "deals",
      ]);
      // private_audit is attached but ungranted — never resolved.
      expect(views.some((v) => v.view.key === "private_audit")).toBe(false);
      const contacts = views.find((v) => v.view.key === "contacts");
      expect(contacts?.columns.map((c) => c.columnName).sort()).toEqual([
        "c_age",
        "c_email",
      ]);
    });

    it("resolves nothing for a caller with no view grants (fail-closed)", async () => {
      const stranger = createUser(`auth0|${generateId()}`);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(stranger as never);
      const { views } = await portalSql.resolveGrantedViewColumns(
        stationId,
        orgId,
        stranger.id,
        db
      );
      expect(views).toEqual([]);
    });

    it("a curated view's FilterGroup restricts the rows in its session view", async () => {
      // Two contacts rows: one below and one above the filter threshold.
      const young = generateId();
      const adult = generateId();
      await insertEntityRecord(contactsEntityId, young, "y-1");
      await insertEntityRecord(contactsEntityId, adult, "a-1");
      await (db as ReturnType<typeof drizzle>).execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age") VALUES (${young}, ${orgId}, ${Date.now()}, true, ${"y-1"}, ${"young@x.co"}, ${25}), (${adult}, ${orgId}, ${Date.now()}, true, ${"a-1"}, ${"adult@x.co"}, ${42})`
      );
      // A second curated view over the SAME contacts wide table, filtered to
      // age > 30, granted to the user — proves two independently-granted views
      // over one wide table + the FilterGroup render restricting rows.
      await attachCuratedView(db as ReturnType<typeof drizzle>, {
        stationId,
        organizationId: orgId,
        connectorEntityId: contactsEntityId,
        key: "adult_contacts",
        label: "Adult Contacts",
        createdBy: userId,
        grantToUserId: userId,
        filter: {
          combinator: "and",
          conditions: [{ field: "age", operator: "gt", value: 30 }],
        },
      });

      const res = await portalSql.runSqlQuery({
        userId,
        sql: `SELECT "c_email" FROM adult_contacts ORDER BY "c_email"`,
        stationId,
        organizationId: orgId,
      });
      const rows = "rows" in res ? (res.rows as { c_email: string }[]) : [];
      expect(rows.map((r) => r.c_email)).toEqual(["adult@x.co"]);
    });
  });

  // #658: the view-scoped row read `resolve_identity` uses — one granted view's
  // readable columns + its filter, matched on one (readable) column.
  describe("queryViewRowsByColumn (#658)", () => {
    async function seedContact(
      email: string,
      age: number,
      opts: { org?: string; deleted?: boolean } = {}
    ): Promise<string> {
      const id = generateId();
      const org = opts.org ?? orgId;
      const now = Date.now();
      const dbTyped = db as ReturnType<typeof drizzle>;
      await dbTyped.insert(schema.entityRecords).values({
        id,
        organizationId: org,
        connectorEntityId: contactsEntityId,
        sourceId: `src-${id}`,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `c-${id}`,
        origin: "sync",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: opts.deleted ? now : null,
        deletedBy: opts.deleted ? "test" : null,
      } as never);
      await dbTyped.execute(
        sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age", "deleted") VALUES (${id}, ${org}, ${now}, true, ${`src-${id}`}, ${email}, ${age}, ${opts.deleted ? now : null})`
      );
      return id;
    }

    async function grantedView(key: string) {
      const { views } = await portalSql.resolveGrantedViewColumns(
        stationId,
        orgId,
        userId,
        db
      );
      const v = views.find((x) => x.view.key === key);
      if (!v) throw new Error(`view ${key} not granted`);
      return v;
    }

    it("returns only _record_id, source_id and the view's readable columns", async () => {
      const id = await seedContact("ada@x.co", 36);
      const res = await portalSql.queryViewRowsByColumn(
        await grantedView("contacts"),
        orgId,
        { normalizedKey: "email", value: "ada@x.co" },
        { limit: 10 },
        db
      );
      expect(res?.truncated).toBe(false);
      expect(res?.records).toHaveLength(1);
      expect(Object.keys(res!.records[0]).sort()).toEqual(
        ["_record_id", "c_age", "c_email", "source_id"].sort()
      );
      expect(res!.records[0]._record_id).toBe(id);
    });

    it("applies the view's row filter", async () => {
      await seedContact("young@x.co", 25);
      await seedContact("adult@x.co", 42);
      await attachCuratedView(db as ReturnType<typeof drizzle>, {
        stationId,
        organizationId: orgId,
        connectorEntityId: contactsEntityId,
        key: "adult_contacts",
        label: "Adult Contacts",
        createdBy: userId,
        grantToUserId: userId,
        filter: {
          combinator: "and",
          conditions: [{ field: "age", operator: "gt", value: 30 }],
        },
      });
      const adults = await grantedView("adult_contacts");
      const young = await portalSql.queryViewRowsByColumn(
        adults,
        orgId,
        { normalizedKey: "email", value: "young@x.co" },
        { limit: 10 },
        db
      );
      const adult = await portalSql.queryViewRowsByColumn(
        adults,
        orgId,
        { normalizedKey: "email", value: "adult@x.co" },
        { limit: 10 },
        db
      );
      expect(young?.records).toEqual([]);
      expect(adult?.records.map((r) => r.c_email)).toEqual(["adult@x.co"]);
    });

    it("returns null when the match column is not readable through the view (oracle guard)", async () => {
      await seedContact("ada@x.co", 36);
      const [ageMapping] = await (db as ReturnType<typeof drizzle>)
        .select({ id: schema.fieldMappings.id })
        .from(schema.fieldMappings)
        .where(
          sql`${schema.fieldMappings.connectorEntityId} = ${contactsEntityId} AND ${schema.fieldMappings.normalizedKey} = 'age'`
        );
      const ageOnlyId = await attachCuratedView(
        db as ReturnType<typeof drizzle>,
        {
          stationId,
          organizationId: orgId,
          connectorEntityId: contactsEntityId,
          key: "contact_ages",
          label: "Contact Ages",
          createdBy: userId,
          grantToUserId: userId,
        }
      );
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.curatedViewFieldMappings)
        .values({
          id: generateId(),
          organizationId: orgId,
          curatedViewId: ageOnlyId,
          fieldMappingId: ageMapping.id,
          created: Date.now(),
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);
      const ages = await grantedView("contact_ages");
      expect(ages.columns.map((c) => c.normalizedKey)).toEqual(["age"]);

      const res = await portalSql.queryViewRowsByColumn(
        ages,
        orgId,
        { normalizedKey: "email", value: "ada@x.co" },
        { limit: 10 },
        db
      );
      expect(res).toBeNull();
    });

    it("caps at `limit`, ordered by _record_id, and reports truncated", async () => {
      const ids = [
        await seedContact("dup@x.co", 30),
        await seedContact("dup@x.co", 31),
        await seedContact("dup@x.co", 32),
      ].sort();
      const view = await grantedView("contacts");
      const capped = await portalSql.queryViewRowsByColumn(
        view,
        orgId,
        { normalizedKey: "email", value: "dup@x.co" },
        { limit: 2 },
        db
      );
      expect(capped?.truncated).toBe(true);
      expect(capped?.records.map((r) => r._record_id)).toEqual(ids.slice(0, 2));
      const all = await portalSql.queryViewRowsByColumn(
        view,
        orgId,
        { normalizedKey: "email", value: "dup@x.co" },
        { limit: 3 },
        db
      );
      expect(all?.truncated).toBe(false);
      expect(all?.records).toHaveLength(3);
    });

    it("excludes soft-deleted rows and rows of another org", async () => {
      const live = await seedContact("same@x.co", 40);
      await seedContact("same@x.co", 41, { deleted: true });
      const intruder = createUser(`auth0|${generateId()}`);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.users)
        .values(intruder as never);
      const otherOrg = createOrganization(intruder.id);
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.organizations)
        .values(otherOrg as never);
      await seedContact("same@x.co", 42, { org: otherOrg.id });

      const res = await portalSql.queryViewRowsByColumn(
        await grantedView("contacts"),
        orgId,
        { normalizedKey: "email", value: "same@x.co" },
        { limit: 10 },
        db
      );
      expect(res?.records.map((r) => r._record_id)).toEqual([live]);
    });

    it("treats a hostile match value as a literal (no injection, no error)", async () => {
      await seedContact("ada@x.co", 36);
      const res = await portalSql.queryViewRowsByColumn(
        await grantedView("contacts"),
        orgId,
        { normalizedKey: "email", value: "' OR 1=1 --" },
        { limit: 10 },
        db
      );
      expect(res?.records).toEqual([]);
    });
  });

  // #660: agent SQL may reference only the caller's session views (+ _meta_*).
  // Before this, runSqlQuery ran as the API's DB role and any physical table
  // (another org's er__*, entity_records, …) was readable.
  describe("session relation boundary (#660)", () => {
    const run = (q: string) =>
      portalSql.runSqlQuery({
        userId,
        sql: q,
        stationId,
        organizationId: orgId,
      });
    const expectRelationForbidden = async (q: string, rel: string) => {
      await expect(run(q)).rejects.toMatchObject({
        code: "PORTAL_SQL_FORBIDDEN",
        message: `unknown entity: ${rel}`,
      });
    };

    /** Another org with one reconciled entity — a physical er__ table the
     *  caller must never reach. */
    async function seedOtherOrgEntity(): Promise<string> {
      const dbTyped = db as ReturnType<typeof drizzle>;
      const now = Date.now();
      const otherUser = createUser(`auth0|${generateId()}`);
      await dbTyped.insert(schema.users).values(otherUser as never);
      const otherOrg = createOrganization(otherUser.id);
      await dbTyped.insert(schema.organizations).values(otherOrg as never);
      const [def] = await dbTyped
        .select({ id: schema.connectorDefinitions.id })
        .from(schema.connectorDefinitions)
        .limit(1);
      const instId = generateId();
      await dbTyped.insert(schema.connectorInstances).values({
        id: instId,
        connectorDefinitionId: def.id,
        organizationId: otherOrg.id,
        name: "Other org instance",
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
      const entId = generateId();
      await dbTyped.insert(schema.connectorEntities).values({
        id: entId,
        organizationId: otherOrg.id,
        connectorInstanceId: instId,
        key: `secrets_${entId.slice(0, 6)}`,
        label: "Other org secrets",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      const cdId = generateId();
      await dbTyped
        .insert(schema.columnDefinitions)
        .values(
          mkColumnDef(
            cdId,
            otherOrg.id,
            `secret_${cdId.slice(0, 6)}`,
            "Secret",
            "string",
            now
          ) as never
        );
      await dbTyped
        .insert(schema.fieldMappings)
        .values(
          mkMapping(otherOrg.id, entId, cdId, "secret", "secret", now) as never
        );
      await reconciler.reconcileEntity(entId, db);
      otherOrgEntityIds.push(entId);
      return entId;
    }
    const otherOrgEntityIds: string[] = [];
    afterEach(async () => {
      for (const id of otherOrgEntityIds.splice(0)) {
        try {
          await reconciler.dropTable(id, db);
        } catch {
          /* ignore */
        }
      }
    });

    it("rejects another org's physical er__ table (the reproduced cross-tenant read)", async () => {
      const otherEntityId = await seedOtherOrgEntity();
      await expectRelationForbidden(
        `SELECT * FROM "er__${otherEntityId}"`,
        `er__${otherEntityId}`
      );
    });

    it("rejects the caller's own org's raw tables and app tables too", async () => {
      await expectRelationForbidden(
        `SELECT * FROM "er__${privateEntityId}"`,
        `er__${privateEntityId}`
      );
      await expectRelationForbidden(
        "SELECT count(*) FROM entity_records",
        "entity_records"
      );
      await expectRelationForbidden(
        "SELECT * FROM contacts WHERE c_email IN (SELECT email FROM users)",
        "users"
      );
    });

    it("a view the caller wasn't granted is not a relation they can name", async () => {
      // private_audit is attached to the station but ungranted.
      await expectRelationForbidden(
        "SELECT * FROM private_audit",
        "private_audit"
      );
    });

    it("a leftover temp view (e.g. from another user's build on a pooled connection) can't be referenced", async () => {
      await expectRelationForbidden("SELECT * FROM leak_v", "leak_v");
    });

    it("the granted views, _meta_* views and CTEs over them still work", async () => {
      await insertEntityRecord(contactsEntityId, generateId(), "c-1");
      await expect(
        run("SELECT count(*) AS n FROM contacts")
      ).resolves.toBeDefined();
      await expect(
        run("SELECT entity_key FROM _meta_columns LIMIT 1")
      ).resolves.toBeDefined();
      await expect(
        run("WITH c AS (SELECT * FROM contacts) SELECT count(*) FROM c")
      ).resolves.toBeDefined();
    });

    it("explainSqlQuery enforces the same relation boundary", async () => {
      await expect(
        portalSql.explainSqlQuery({
          userId,
          sql: "SELECT * FROM entity_records",
          stationId,
          organizationId: orgId,
        })
      ).rejects.toMatchObject({
        code: "PORTAL_SQL_FORBIDDEN",
        message: "unknown entity: entity_records",
      });
    });

    it("every session transaction starts with DISCARD TEMP (runSqlQuery + explainSqlQuery)", async () => {
      const { db: appDb } = await import("../../../db/client.js");
      const firstStatements: string[] = [];
      const original = appDb.transaction.bind(appDb);
      const spy = jest.spyOn(appDb, "transaction").mockImplementation((async (
        fn: (tx: unknown) => unknown,
        cfg?: unknown
      ) =>
        original(async (tx) => {
          const exec = tx.execute.bind(tx);
          let first = true;
          (tx as { execute: unknown }).execute = (q: unknown) => {
            if (first) {
              first = false;
              firstStatements.push(JSON.stringify(q));
            }
            return exec(q as never);
          };
          return fn(tx);
        }, cfg as never)) as never);
      try {
        await run("SELECT count(*) FROM contacts");
        await portalSql.explainSqlQuery({
          userId,
          sql: "SELECT count(*) FROM contacts",
          stationId,
          organizationId: orgId,
        });
      } finally {
        spy.mockRestore();
      }
      expect(firstStatements).toHaveLength(2);
      for (const s of firstStatements) expect(s).toContain("DISCARD TEMP");
    });
  });

  describe("reader role (#660 PR 2)", () => {
    const run = (q: string) =>
      portalSql.runSqlQuery({
        userId,
        sql: q,
        stationId,
        organizationId: orgId,
      });

    afterEach(() => {
      environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader";
      PortalSqlReaderRoleService.resetForTests();
    });

    it("agent SQL runs as the reader role, not the API's role", async () => {
      const res = await run("SELECT current_user AS u");
      expect(res).toMatchObject({ rows: [{ u: "portalai_sql_reader" }] });
    });

    it("Postgres denies a raw read under the role even when the SQL gate is bypassed", async () => {
      const { db: appDb } = await import("../../../db/client.js");
      const build = await portalSql.resolveViewsForSession(
        stationId,
        orgId,
        userId
      );
      // Always rolls back, as the real session paths do, so no temp view
      // outlives the attempt on the pooled connection.
      const READ = Symbol("read");
      const attempt = (q: string) =>
        appDb
          .transaction(async (tx) => {
            await openSqlSession(tx, build, { statementTimeoutMs: 5000 });
            await tx.execute(sql.raw(q));
            throw READ;
          })
          .then(
            () => "committed",
            (err: unknown) =>
              err === READ
                ? "read"
                : ((err as { cause?: { code?: string } }).cause?.code ?? "?")
          );
      await insertEntityRecord(contactsEntityId, generateId(), "c-1");
      await expect(attempt("SELECT count(*) FROM contacts")).resolves.toBe(
        "read"
      );
      await expect(
        attempt("SELECT 1 FROM entity_records LIMIT 1")
      ).resolves.toBe("42501");
      await expect(
        attempt(`SELECT 1 FROM "er__${privateEntityId}" LIMIT 1`)
      ).resolves.toBe("42501");
      await expect(attempt("SELECT 1 FROM users LIMIT 1")).resolves.toBe(
        "42501"
      );
    });

    it("a role that disappears after a cached success refuses with PORTAL_SQL_UNAVAILABLE (503), not a 500, and is re-probed next call", async () => {
      // Cache a success with the real role.
      await expect(run("SELECT 1 AS one")).resolves.toBeDefined();
      // The role "disappears" (the service now names one that doesn't exist:
      // the same failure as a DROP ROLE under a running API).
      environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_gone";
      await expect(run("SELECT 1 AS one")).rejects.toMatchObject({
        status: 503,
        code: "PORTAL_SQL_UNAVAILABLE",
      });
      // The cached success was cleared, so the next call re-probes (and
      // refuses before opening a session) instead of failing mid-session.
      const probe = jest.spyOn(PortalSqlReaderRoleService, "probe");
      try {
        await expect(run("SELECT 1 AS one")).rejects.toMatchObject({
          code: "PORTAL_SQL_UNAVAILABLE",
        });
        expect(probe).toHaveBeenCalledTimes(1);
      } finally {
        probe.mockRestore();
      }
    });

    it("an unusable role refuses runSqlQuery and explainSqlQuery with PORTAL_SQL_UNAVAILABLE, before any transaction", async () => {
      const { db: appDb } = await import("../../../db/client.js");
      environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_absent";
      PortalSqlReaderRoleService.resetForTests();
      const spy = jest.spyOn(appDb, "transaction");
      try {
        await expect(run("SELECT 1")).rejects.toMatchObject({
          status: 503,
          code: "PORTAL_SQL_UNAVAILABLE",
        });
        await expect(
          portalSql.explainSqlQuery({
            userId,
            sql: "SELECT 1",
            stationId,
            organizationId: orgId,
          })
        ).rejects.toMatchObject({ code: "PORTAL_SQL_UNAVAILABLE" });
        // A missing role is detected before the probe opens a transaction,
        // so no transaction ran at all: nothing reached a session.
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// ── Local seeders ───────────────────────────────────────────────────

function mkColumnDef(
  id: string,
  orgId: string,
  key: string,
  label: string,
  type: string,
  now: number
): Record<string, unknown> {
  return {
    id,
    organizationId: orgId,
    key,
    label,
    type,
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: false,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function mkMapping(
  orgId: string,
  entityId: string,
  columnDefinitionId: string,
  sourceField: string,
  normalizedKey: string,
  created: number
): Record<string, unknown> {
  return {
    id: generateId(),
    organizationId: orgId,
    connectorEntityId: entityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey,
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
