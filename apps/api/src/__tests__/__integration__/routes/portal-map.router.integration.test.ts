/**
 * Integration test for the vector-tile path (#316, slice 6).
 *
 * Exercises the real `PortalMapTileService.renderTile` → `defaultRunTileQuery`
 * against a live geometry wide table, through the session-view read-only
 * transaction — the actual runtime path (the unit test mocks the query). A pin
 * carries a pipeline that selects the raw geometry column from its session
 * view; the service wraps it in ST_AsMVT.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { PortalMapTileService } from "../../../services/portal-map-tile.service.js";
import { PortalSqlService } from "../../../services/portal-sql.service.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("Portal map tile route (#316)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let entityId: string;
  let pinId: string;
  let stationId: string;

  // A large-ish polygon near the origin (lng 0..10, lat 0..10) so it survives
  // low-zoom simplification and sits squarely in the z0 world envelope.
  const POLYGON = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
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
    reconciler = new WideTableReconcilerService();

    await teardownOrg(db as ReturnType<typeof drizzle>);
    const dbTyped = db as ReturnType<typeof drizzle>;
    const t = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-map-${generateId().slice(0, 8)}`,
      display: "Map Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const instanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Map Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: "parcels",
      label: "Parcels",
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    stationId = generateId();
    await dbTyped.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Map Station",
      description: null,
      toolPacks: ["data_query"],
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await dbTyped.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instanceId,
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const colDefId = generateId();
    await dbTyped.insert(schema.columnDefinitions).values({
      id: colDefId,
      organizationId: orgId,
      key: "geom",
      label: "Geometry",
      type: "geometry",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      geoRole: null,
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await dbTyped.insert(schema.fieldMappings).values({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colDefId,
      sourceField: "geom",
      isPrimaryKey: false,
      normalizedKey: "geom",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    await reconciler.reconcileEntity(entityId, db);

    // One geometry row.
    const erId = generateId();
    await dbTyped.insert(schema.entityRecords).values({
      id: erId,
      organizationId: orgId,
      connectorEntityId: entityId,
      data: { geom: POLYGON },
      sourceId: "src-1",
      checksum: "chk-1",
      syncedAt: t,
      origin: "sync",
      validationErrors: null,
      isValid: true,
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const repo = new WideTableRepository();
    await repo.upsertMany(
      entityId,
      [
        {
          entity_record_id: erId,
          organization_id: orgId,
          synced_at: t,
          is_valid: true,
          source_id: "src-1",
          c_geom: POLYGON,
        },
      ],
      db
    );

    // A pin whose durable pipeline selects the raw geometry from the session
    // view (`parcels`) aliased as `geom` — exactly the shape the tile query
    // wraps.
    pinId = generateId();
    await dbTyped.insert(schema.portalResults).values({
      id: pinId,
      organizationId: orgId,
      stationId,
      portalId: null,
      messageId: null,
      blockIndex: null,
      name: "Parcels map",
      type: "geo",
      content: {
        pipeline: {
          sql: 'SELECT "c_geom" AS geom FROM parcels',
          stationId,
          organizationId: orgId,
        },
      },
      snapshotUpdatedAt: null,
      created: t,
      createdBy: "SYSTEM_TEST",
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
    await connection.end();
  });

  it("renders a non-empty MVT for the world envelope (z0)", async () => {
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pinId },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Buffer);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("returns 204 for a tile envelope that doesn't contain the geometry", async () => {
    // z3 far south-west (lng≈[-180,-135], lat far south) — well clear of the
    // polygon at lng[0,10] lat[0,10], with no boundary touching.
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pinId },
      z: 3,
      x: 0,
      y: 7,
      organizationId: orgId,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("404s for a foreign org (no existence leak)", async () => {
    await expect(
      PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: pinId },
        z: 0,
        x: 0,
        y: 0,
        organizationId: generateId(),
      })
    ).rejects.toMatchObject({ status: 404, code: "MAP_TILE_NOT_FOUND" });
  });

  // Slice 7: the ST_Area(geometry::geography) idiom in the
  // `transform_entity_records` tool description must actually execute through
  // the read-only tool path against a real geometry column.
  it("runs ST_Area(geom::geography) through the read-only SQL path (#316)", async () => {
    const res = await PortalSqlService.runSqlQuery({
      sql: 'SELECT ST_Area("c_geom"::geography) AS area FROM parcels',
      stationId,
      organizationId: orgId,
    });
    const rows = "rows" in res ? res.rows : [];
    expect(rows).toHaveLength(1);
    // ~10°×10° polygon near the equator → a large but finite positive area (m²).
    expect(Number((rows[0] as Record<string, unknown>).area)).toBeGreaterThan(
      0
    );
  });

  // ── #472: low-zoom dissolve serve + raw-simplify fallback ─────────────

  const createColorByPin = async (
    pipelineSql: string,
    colorByColumn: string
  ): Promise<string> => {
    const id = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Choropleth",
        type: "geo",
        content: {
          spec: {
            layers: [
              {
                kind: "polygons",
                source: { geometryColumn: "geom" },
                style: { colorBy: { column: colorByColumn } },
              },
            ],
          },
          pipeline: { sql: pipelineSql, stationId, organizationId: orgId },
        },
        snapshotUpdatedAt: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    return id;
  };

  const insertDissolveRow = (pin: string, col: string, band: number) =>
    connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, geom)
       VALUES ($1,$2,'SYSTEM_TEST',$3,$4,$5,'Private',$6,3,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7),4326)))`,
      [
        generateId(),
        Date.now(),
        orgId,
        pin,
        col,
        band,
        JSON.stringify({
          type: "MultiPolygon",
          coordinates: [POLYGON.coordinates],
        }),
      ]
    );

  it("dissolve HIT: serves precomputed geometry, never running the pipeline", async () => {
    // The pipeline references a view that does not exist — if the dissolve-hit
    // path ran it, the tile would 500. It serves from the stored geometry instead.
    const pin = await createColorByPin(
      'SELECT "c_geom" AS geom, c_own_type FROM does_not_exist',
      "c_own_type"
    );
    await insertDissolveRow(pin, "c_own_type", 0); // band 0 = z0

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.aggregated).toBe(false); // real geometry, not centroid bins
  });

  it("dissolve MISS: falls back to raw simplified polygons, never bins", async () => {
    // A polygon+colorBy pin (→ treatment dissolve) with NO precompute rows.
    const pin = await createColorByPin(
      `SELECT "c_geom" AS geom, 'Private'::text AS c_own_type FROM parcels`,
      "c_own_type"
    );
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Raw simplified polygons — NOT the aggregate/bins path.
    expect(res.aggregated).toBe(false);
    expect(res.simplifiedTolerance).not.toBeNull();
  });

  it("z >= threshold uses the raw path regardless of precompute", async () => {
    const pin = await createColorByPin(
      `SELECT "c_geom" AS geom, 'Private'::text AS c_own_type FROM parcels`,
      "c_own_type"
    );
    // z14 tile at lng≈5, lat≈5 (well inside the 0..10 polygon).
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 14,
      x: 8419,
      y: 7964,
      organizationId: orgId,
    });
    expect(res.status).toBe(200);
    expect(res.aggregated).toBe(false);
  });
});
