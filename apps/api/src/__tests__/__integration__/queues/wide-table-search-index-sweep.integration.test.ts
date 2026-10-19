/**
 * The wide-table search-index sweep (#649).
 *
 * The reconciler builds a text column's trigram index when it adds the column,
 * in its transaction, while the table is empty. Everything else is this
 * sweep's: columns that predate #649 on populated tables, an index a failed
 * concurrent build left INVALID, and indexes on columns the reconciler has
 * since retired. It converges each table on "one valid `_trgm` index per live
 * text column", building CONCURRENTLY so a sync writing the table is never
 * blocked.
 *
 * `CREATE INDEX CONCURRENTLY` can't run in a transaction, so nothing here
 * wraps the processor in one.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { wideTableSearchIndexSweepProcessor } from "../../../queues/processors/wide-table-search-index-sweep.processor.js";
import {
  WideTableReconcilerService,
  trgmIndexName,
} from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import { withEntityLock } from "../../../db/advisory-lock.util.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("wide-table search-index sweep (#649)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let instanceId: string;
  const entities: string[] = [];

  const dbT = () => db as ReturnType<typeof drizzle>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    reconciler = new WideTableReconcilerService();
    entities.length = 0;
    await teardownOrg(dbT());

    const now = Date.now();
    const user = createUser(`auth0|${generateId()}`);
    await dbT()
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await dbT()
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbT()
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: `sweep-${generateId().slice(0, 8)}`,
        display: "Sweep",
        category: "crm",
        authType: "none",
        configSchema: {},
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    instanceId = generateId();
    await dbT()
      .insert(schema.connectorInstances)
      .values({
        id: instanceId,
        connectorDefinitionId: connDefId,
        organizationId: orgId,
        name: "Sweep",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
  });

  afterEach(async () => {
    for (const id of entities) {
      await reconciler.dropTable(id, db).catch(() => undefined);
    }
    wideTableStatementCache.clear();
    await connection.end();
  });

  /** An entity with one text column, `city`, holding `rows` rows. The
   *  reconciler builds its trigram index at add, as in production. */
  async function textEntity(rows = 5): Promise<string> {
    const now = Date.now();
    const entityId = generateId();
    entities.push(entityId);
    await dbT()
      .insert(schema.connectorEntities)
      .values({
        id: entityId,
        organizationId: orgId,
        connectorInstanceId: instanceId,
        key: `sweep_${generateId().slice(0, 6)}`,
        label: "Sweep",
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    const cdId = generateId();
    await dbT()
      .insert(schema.columnDefinitions)
      .values({
        id: cdId,
        organizationId: orgId,
        key: `city_${generateId().slice(0, 6)}`,
        label: "City",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    await dbT()
      .insert(schema.fieldMappings)
      .values({
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: cdId,
        sourceField: "City",
        isPrimaryKey: false,
        normalizedKey: "city",
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: null,
        refEntityKey: null,
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    await reconciler.reconcileEntity(entityId, db);

    for (let i = 0; i < rows; i++) {
      const id = generateId();
      await dbT()
        .insert(schema.entityRecords)
        .values({
          id,
          organizationId: orgId,
          connectorEntityId: entityId,
          data: {},
          sourceId: `src-${i}`,
          checksum: "c",
          syncedAt: now,
          origin: "sync",
          validationErrors: null,
          isValid: true,
          created: now,
          createdBy: "test",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);
      // Duplicate values, so a UNIQUE build over the column fails.
      await dbT().execute(
        sql`INSERT INTO ${sql.identifier(`er__${entityId}`)}
            ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_city")
            VALUES (${id}, ${orgId}, ${now}, true, ${`src-${i}`}, 'Boston')`
      );
    }
    return entityId;
  }

  const indexName = (entityId: string) => trgmIndexName(entityId, "c_city");

  async function indexState(
    entityId: string
  ): Promise<"valid" | "invalid" | "missing"> {
    const rows = (await dbT().execute(
      sql`SELECT x.indisvalid AS valid
          FROM pg_class c JOIN pg_index x ON x.indexrelid = c.oid
          WHERE c.relname = ${indexName(entityId)}`
    )) as unknown as Array<{ valid: boolean }>;
    if (rows.length === 0) return "missing";
    return rows[0]!.valid ? "valid" : "invalid";
  }

  async function dropIndex(entityId: string) {
    await dbT().execute(
      sql.raw(`DROP INDEX IF EXISTS "${indexName(entityId)}"`)
    );
  }

  it("builds a missing index on a populated table", async () => {
    const id = await textEntity();
    await dropIndex(id);

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(await indexState(id)).toBe("valid");
    expect(summary).toMatchObject({ built: 1, rebuilt: 0, dropped: 0 });
  });

  it("rebuilds an index a failed concurrent build left INVALID", async () => {
    const id = await textEntity();
    await dropIndex(id);
    // A concurrent UNIQUE build over duplicate values fails partway and leaves
    // an INVALID index under the name — what a crashed build looks like.
    await expect(
      dbT().execute(
        sql.raw(
          `CREATE UNIQUE INDEX CONCURRENTLY "${indexName(id)}" ON "er__${id}" (c_city)`
        )
      )
    ).rejects.toThrow();
    expect(await indexState(id)).toBe("invalid");

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(await indexState(id)).toBe("valid");
    expect(summary).toMatchObject({ built: 0, rebuilt: 1 });
  });

  it("drops the index on a retired column", async () => {
    const id = await textEntity();
    expect(await indexState(id)).toBe("valid");
    await dbT().execute(
      sql`UPDATE wide_table_columns SET retired_at = ${Date.now()} WHERE connector_entity_id = ${id}`
    );

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(await indexState(id)).toBe("missing");
    expect(summary).toMatchObject({ dropped: 1, built: 0 });
  });

  it("skips a table that no longer exists", async () => {
    const id = await textEntity();
    await dbT().execute(sql.raw(`DROP TABLE "er__${id}"`));

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(summary).toMatchObject({ built: 0, skipped: 1, failed: 0 });
  });

  it("leaves a soft-deleted entity alone", async () => {
    const id = await textEntity();
    await dropIndex(id);
    await dbT().execute(
      sql`UPDATE connector_entities SET deleted = ${Date.now()}, deleted_by = 'test' WHERE id = ${id}`
    );

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(await indexState(id)).toBe("missing");
    expect(summary.built).toBe(0);
  });

  it("skips an entity whose lock a reconcile or write holds, and releases its own", async () => {
    const id = await textEntity();
    await dropIndex(id);

    // A reconcile (or a commit's write) holds the entity lock. A build here
    // would make the reconcile's ALTER queue behind it, and every read of the
    // table behind that, so the sweep leaves the entity for the next run.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const acquired = new Promise<void>((r) => (locked = r));
    const holder = withEntityLock(db, id, async () => {
      locked();
      await held;
    });
    await acquired;
    const busy = await wideTableSearchIndexSweepProcessor({ entityIds: [id] });
    release();
    await holder;

    expect(busy).toMatchObject({ built: 0, busy: 1, failed: 0 });
    expect(await indexState(id)).toBe("missing");

    const next = await wideTableSearchIndexSweepProcessor({ entityIds: [id] });
    expect(next).toMatchObject({ built: 1, busy: 0 });
    // The sweep released its session lock: the entity locks straight away.
    await withEntityLock(db, id, async (tx) => {
      const rows = (await (tx as ReturnType<typeof drizzle>).execute(
        sql`SELECT 1 AS ok`
      )) as unknown as Array<{ ok: number }>;
      expect(rows[0]!.ok).toBe(1);
    });
  });

  it("stops at maxBuilds and reports the rest as deferred", async () => {
    const a = await textEntity(2);
    const b = await textEntity(2);
    await dropIndex(a);
    await dropIndex(b);

    const first = await wideTableSearchIndexSweepProcessor({
      entityIds: [a, b],
      maxBuilds: 1,
    });
    expect(first).toMatchObject({ built: 1, deferred: 1 });

    const second = await wideTableSearchIndexSweepProcessor({
      entityIds: [a, b],
      maxBuilds: 1,
    });
    expect(second).toMatchObject({ built: 1, deferred: 0 });
    expect(await indexState(a)).toBe("valid");
    expect(await indexState(b)).toBe("valid");
  });

  it("does nothing when every table has converged", async () => {
    const id = await textEntity();

    const summary = await wideTableSearchIndexSweepProcessor({
      entityIds: [id],
    });

    expect(summary).toMatchObject({
      built: 0,
      rebuilt: 0,
      dropped: 0,
      skipped: 0,
      busy: 0,
      deferred: 0,
      failed: 0,
    });
    expect(summary.tablesScanned).toBe(1);
  });
});
