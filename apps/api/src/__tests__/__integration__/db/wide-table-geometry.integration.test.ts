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

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
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
});
