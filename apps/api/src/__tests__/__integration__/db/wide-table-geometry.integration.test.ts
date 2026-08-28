/**
 * Integration tests for the geometry wide-table storage path (#316, slice 3).
 *
 * Exercises the full substrate end-to-end: the reconciler materializes a
 * `geometry(Geometry, 4326)` column with a GiST index, a GeoJSON value
 * round-trips in→out unchanged through the write (`ST_GeomFromGeoJSON` +
 * `ST_MakeValid` + `ST_SetSRID`) and read (`ST_AsGeoJSON`) expressions, and a
 * spatial predicate is planned as an index scan.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { geoReencodeRows } from "../../../tools/geo-delivery.util.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("Wide-table geometry storage (#316)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let statementCache: WideTableStatementCache;
  let orgId: string;
  let entityId: string;
  let columnDefIdGeom: string;
  let fieldMappingId: string;

  const POLYGON = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
        [0, 0],
      ],
    ],
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
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

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-geo-${generateId().slice(0, 8)}`,
      display: "Test Geo Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const connectorInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: connectorInstanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId,
      key: "parcels",
      label: "Parcels",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    columnDefIdGeom = generateId();
    await dbTyped.insert(schema.columnDefinitions).values({
      id: columnDefIdGeom,
      organizationId: orgId,
      key: "boundary",
      label: "Boundary",
      type: "geometry",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      geoRole: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    fieldMappingId = generateId();
    await dbTyped.insert(schema.fieldMappings).values({
      id: fieldMappingId,
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: columnDefIdGeom,
      sourceField: "geometry",
      isPrimaryKey: false,
      normalizedKey: "boundary",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(entityId, db);
    } catch {
      /* ignore */
    }
    statementCache.clear();
    await connection.end();
  });

  it("materializes a geometry(Geometry, 4326) column with a GiST index", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const table = `er__${entityId}`;

    // PostGIS records typed geometry columns in the geometry_columns view.
    const geomCols = (await db.execute(sql`
      SELECT type, srid FROM geometry_columns
      WHERE f_table_name = ${table}
    `)) as unknown as Array<{ type: string; srid: number }>;
    expect(geomCols).toHaveLength(1);
    expect(geomCols[0].type).toBe("GEOMETRY");
    expect(Number(geomCols[0].srid)).toBe(4326);

    // A GiST index exists on the geometry column.
    const idx = (await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = ${table} AND indexname LIKE '%_gist'
    `)) as unknown as Array<{ indexdef: string }>;
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef.toLowerCase()).toContain("gist");
  });

  it("round-trips a GeoJSON polygon in→out unchanged", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;

    // Insert an entity_records row (the wide table's PK is an FK to it).
    const erId = generateId();
    const now = Date.now();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.entityRecords)
      .values({
        id: erId,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { boundary: POLYGON },
        sourceId: "src-1",
        checksum: "chk-1",
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    // Write through the real insert template (geometry placeholder is wrapped
    // ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($n),4326))). Params follow
    // the metadata block then the single data column.
    await connection.unsafe(stmt.insertSqlTemplate, [
      erId,
      orgId,
      now,
      true,
      "src-1",
      JSON.stringify(POLYGON),
    ]);

    // Read through the real select projection (ST_AsGeoJSON(col)::jsonb).
    const rows = (await connection.unsafe(
      `${stmt.selectAllSql} WHERE "entity_record_id" = $1`,
      [erId]
    )) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const back = rows[0][geomCol] as {
      type: string;
      coordinates: number[][][];
    };
    expect(back.type).toBe("Polygon");
    expect(back.coordinates).toEqual(POLYGON.coordinates);
  });

  // ── Handle-snapshot re-encode (#371) ────────────────────────────────
  // A pin of a handle-backed map re-encodes the snapshot's WKB-hex geometry to
  // GeoJSON in place via geoReencodeRows. This must run against the real driver:
  // a fake `execute` would never catch that drizzle's `sql` template flattens a
  // bound JS array to scalar params, which is what made `unnest($hex[])` throw
  // and surfaced as an opaque pin failure (#371).
  it("re-encodes a snapshot's WKB-hex geometry to GeoJSON through the real driver", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;
    const now = Date.now();

    const erId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.entityRecords)
      .values({
        id: erId,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { boundary: POLYGON },
        sourceId: "src-reenc",
        checksum: "chk-reenc",
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    await connection.unsafe(stmt.insertSqlTemplate, [
      erId,
      orgId,
      now,
      true,
      "src-reenc",
      JSON.stringify(POLYGON),
    ]);

    // A handle snapshot stores the geometry as EWKB hex (the raw column as text),
    // exactly what materialize() holds before re-encoding.
    const rawRows = (await connection.unsafe(
      `SELECT "${geomCol}"::text AS "${geomCol}", "entity_record_id" AS id FROM "er__${entityId}" WHERE "entity_record_id" = $1`,
      [erId]
    )) as unknown as Array<Record<string, unknown>>;
    expect(typeof rawRows[0][geomCol]).toBe("string");
    expect(rawRows[0][geomCol] as string).toMatch(/^[0-9A-Fa-f]+$/);

    const out = await geoReencodeRows(rawRows, [geomCol], {
      execute: (q) => db.execute(q),
    });

    expect(out).toHaveLength(1);
    // Every non-geometry column rides through untouched.
    expect(out[0].id).toBe(erId);
    const gj = out[0][geomCol] as { type: string; coordinates: number[][][] };
    expect(gj.type).toBe("Polygon");
    expect(gj.coordinates).toEqual(POLYGON.coordinates);
  });

  it("plans a spatial predicate as an index scan", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;
    const table = `er__${entityId}`;

    // A tiny table would be seq-scanned regardless; disable seqscan for this
    // transaction so the planner reveals whether the GiST index is *usable*
    // by the spatial predicate — which is the property under test.
    const plan = await connection.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      return (await tx.unsafe(
        `EXPLAIN SELECT 1 FROM "${table}" ` +
          `WHERE ST_Intersects("${geomCol}", ST_MakeEnvelope(0, 0, 1, 1, 4326))`
      )) as unknown as Array<Record<string, string>>;
    });
    const planText = plan
      .map((r) => Object.values(r)[0])
      .join("\n")
      .toLowerCase();
    expect(planText).toMatch(/index scan|bitmap index scan/);
  });

  // ── Fail-closed geometry write via upsertMany (#316, slice 4) ──────

  it("writes clean+repaired rows, drops the unparseable one (absent, not NULL)", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;
    const now = Date.now();

    // Three entity_records: clean, self-intersecting (repairable), garbage.
    const CLEAN = "er-clean";
    const REPAIR = "er-repair";
    const REJECT = "er-reject";
    const bowtie = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    for (const [id, geom] of [
      [CLEAN, POLYGON],
      [REPAIR, bowtie],
      [REJECT, { not: "a geometry" }],
    ] as const) {
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.entityRecords)
        .values({
          id,
          organizationId: orgId,
          connectorEntityId: entityId,
          data: { boundary: geom },
          sourceId: id,
          checksum: `chk-${id}`,
          syncedAt: now,
          origin: "sync",
          validationErrors: null,
          isValid: true,
          created: now,
          createdBy: "test-system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);
    }

    const repo = new WideTableRepository(statementCache);
    const rows = [
      [CLEAN, POLYGON],
      [REPAIR, bowtie],
      [REJECT, { not: "a geometry" }],
    ].map(([id, geom]) => ({
      entity_record_id: id,
      organization_id: orgId,
      synced_at: now,
      is_valid: true,
      source_id: id,
      [geomCol]: geom,
    }));

    const result = await repo.upsertMany(entityId, rows, db);

    // The unparseable row is reported and NOT written.
    expect(result.repaired).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].sourceId).toBe(REJECT);
    expect(result.rejected[0].reason).toContain("GEOMETRY_INVALID_ON_IMPORT");

    const table = `er__${entityId}`;
    const written = (await connection.unsafe(
      `SELECT entity_record_id, ST_IsValid(${`"${geomCol}"`}) AS valid FROM "${table}" ORDER BY entity_record_id`
    )) as unknown as Array<{ entity_record_id: string; valid: boolean }>;

    // Exactly the clean + repaired rows landed; the rejected one is absent
    // (not present with a NULL geometry).
    expect(written.map((r) => r.entity_record_id).sort()).toEqual([
      CLEAN,
      REPAIR,
    ]);
    // Both written geometries are valid — the bowtie was repaired on write.
    expect(written.every((r) => r.valid)).toBe(true);
  });

  it("reprojects a non-4326 (web mercator 3857) source to 4326 on write", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;
    const now = Date.now();

    // An ArcGIS polygon in web-mercator meters around NYC, wkid 102100
    // (→ 3857). After reprojection the stored coordinates must be degrees.
    const mercator = {
      rings: [
        [
          [-8250000, 4970000],
          [-8250000, 4980000],
          [-8240000, 4980000],
          [-8240000, 4970000],
          [-8250000, 4970000],
        ],
      ],
      spatialReference: { wkid: 102100 },
    };
    const erId = "er-merc";
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.entityRecords)
      .values({
        id: erId,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { boundary: mercator },
        sourceId: erId,
        checksum: "chk-merc",
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    const repo = new WideTableRepository(statementCache);
    const result = await repo.upsertMany(
      entityId,
      [
        {
          entity_record_id: erId,
          organization_id: orgId,
          synced_at: now,
          is_valid: true,
          source_id: erId,
          [geomCol]: mercator,
        },
      ],
      db
    );
    expect(result.rejected).toHaveLength(0);

    const rows = (await connection.unsafe(
      `${stmt.selectAllSql} WHERE "entity_record_id" = $1`,
      [erId]
    )) as unknown as Array<Record<string, unknown>>;
    const geom = rows[0][geomCol] as { coordinates: number[][][] };
    const [lng, lat] = geom.coordinates[0][0];
    // Reprojected into degrees around NYC — not the raw ~8e6 meter values.
    expect(lng).toBeGreaterThan(-75);
    expect(lng).toBeLessThan(-73);
    expect(lat).toBeGreaterThan(40);
    expect(lat).toBeLessThan(41);
  });

  it("rejects a source whose SRID PostGIS does not know", async () => {
    await reconciler.reconcileEntity(entityId, db);
    const stmt = await statementCache.get(entityId, db);
    const geomCol = stmt.columns[0].columnName;
    const now = Date.now();

    const erId = "er-badsrid";
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.entityRecords)
      .values({
        id: erId,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: {},
        sourceId: erId,
        checksum: "chk-badsrid",
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    const repo = new WideTableRepository(statementCache);
    const result = await repo.upsertMany(
      entityId,
      [
        {
          entity_record_id: erId,
          organization_id: orgId,
          synced_at: now,
          is_valid: true,
          source_id: erId,
          [geomCol]: { ...POLYGON, spatialReference: { wkid: 987654 } },
        },
      ],
      db
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("GIS_SRID_UNSUPPORTED");

    const table = `er__${entityId}`;
    const written = (await connection.unsafe(
      `SELECT 1 FROM "${table}" WHERE "entity_record_id" = $1`,
      [erId]
    )) as unknown as unknown[];
    expect(written).toHaveLength(0);
  });
});
