/**
 * Integration test for the vector-tile path (#316, slice 6).
 *
 * Exercises the real `PortalMapTileService.renderTile` → `defaultRunTileQuery`
 * against a live geometry wide table, through the session-view read-only
 * transaction — the actual runtime path (the unit test mocks the query). A pin
 * carries a pipeline that selects the raw geometry column from its session
 * view; the service wraps it in ST_AsMVT.
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

import { PortalMapTileService } from "../../../services/portal-map-tile.service.js";
import { PortalSqlReaderRoleService } from "../../../services/portal-sql-reader-role.service.js";
import { environment } from "../../../environment.js";
import {
  PortalSqlService,
  resolveScopeHash,
} from "../../../services/portal-sql.service.js";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  attachCuratedView,
} from "../utils/application.util.js";

/** These cases exercise rendering, not authorization (#692 pins that in the
 *  read-access suite and the service unit tests): every source is allowed. */
const allowAllSources = async () => true;

describe("Portal map tile route (#316)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let userId: string;
  let entityId: string;
  let pinId: string;
  let stationId: string;
  // #643: the serving user's resolved scope hash — seeded dissolve rows must
  // carry it so the per-scope serve matches (else it misses → raw fallback).
  let dissolveScopeHash: string;

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
    userId = user.id;

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

    // #599: attach a default (unrestricted) curated view for the entity and
    // grant it to the owner — so the org-wide map-tile path (via station_views)
    // and the per-user `runSqlQuery` both resolve it.
    await attachCuratedView(dbTyped, {
      stationId,
      organizationId: orgId,
      connectorEntityId: entityId,
      key: "parcels",
      label: "Parcels",
      createdBy: userId,
      grantToUserId: userId,
    });

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

    // #643: the scope the serving user (`userId`) resolves to — seeded dissolve
    // rows below are tagged with it so the per-scope serve matches.
    dissolveScopeHash = resolveScopeHash(
      await PortalSqlService.resolveViewsForSession(stationId, orgId, userId)
    );
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
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Buffer);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // #532 ETag format: `"<a|r>~<32-hex>"` — the a/r prefix records whether the
    // tile aggregated so a 304 can report the right notice.
    expect(res.etag).toMatch(/^"[ar]~[0-9a-f]{32}"$/);
  });

  it("#643: a user with no granted view over the map serves an empty tile (204), not 500 or another scope's data", async () => {
    // The pin's pipeline references the `parcels` curated view; a user who isn't
    // granted it has no such temp view in their per-user session, so the tile
    // query hits `relation "parcels" does not exist` (42P01). The serve must
    // degrade to an empty tile (AC2: a no-grant member "sees no tile") — never a
    // 500 and never the data. (Before #643 the org-wide builder made the view
    // for everyone, so this path never fired.)
    const stranger = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(stranger as never);
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pinId },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId: stranger.id,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  // #727: a stored pipeline naming a column the view no longer exposes (a
  // projection change, or a viewer whose grants hide it) is a 42703, which
  // answered 500 on every tile. It degrades like a missing view: empty, 204.
  it("#727: a pin whose pipeline names a column the view doesn't expose serves an empty tile (204), not 500", async () => {
    const stalePinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: stalePinId,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Stale-column map",
        type: "geo",
        content: {
          pipeline: {
            sql: 'SELECT "c_geom" AS geom, "c_no_such_column" FROM parcels',
            stationId,
            organizationId: orgId,
          },
        },
        snapshotUpdatedAt: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: stalePinId },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("#660: a pin whose stored pipeline reads a raw er__ table serves an empty tile, never the data", async () => {
    // A pinned pipeline only ever passed the pre-#660 regex gate, so one could
    // hold a physical-table reference. The tile re-validates it every run and
    // rejects any relation outside the caller's session views.
    const rawPinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: rawPinId,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Raw-table map",
        type: "geo",
        content: {
          pipeline: {
            sql: `SELECT "c_geom" AS geom FROM "er__${entityId}"`,
            stationId,
            organizationId: orgId,
          },
        },
        snapshotUpdatedAt: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: rawPinId },
      z: 12,
      x: 2048,
      y: 2047,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("#667: a commented pipeline executes its validated (comment-free) text and renders the same tile", async () => {
    const commentedPinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: commentedPinId,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Commented map",
        type: "geo",
        content: {
          pipeline: {
            sql: 'SELECT "c_geom" AS geom /* inline note */ FROM parcels -- trailing note',
            stationId,
            organizationId: orgId,
          },
        },
        snapshotUpdatedAt: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    const tile = (id: string) =>
      PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: id },
        z: 12,
        x: 2048,
        y: 2047,
        organizationId: orgId,
        userId,
        authorizeSource: allowAllSources,
      });
    const plain = await tile(pinId);

    const { db: appDb } = await import("../../../db/client.js");
    const executed: string[] = [];
    const original = appDb.transaction.bind(appDb);
    const spy = jest.spyOn(appDb, "transaction").mockImplementation(((
      fn: (tx: unknown) => unknown,
      cfg?: never
    ) =>
      original(async (tx) => {
        const exec = tx.execute.bind(tx);
        (tx as { execute: unknown }).execute = (q: unknown) => {
          executed.push(JSON.stringify(q));
          return exec(q as never);
        };
        return fn(tx);
      }, cfg)) as never);
    let commented;
    try {
      commented = await tile(commentedPinId);
    } finally {
      spy.mockRestore();
    }

    expect(commented.status).toBe(200);
    expect(Buffer.compare(commented.body as Buffer, plain.body as Buffer)).toBe(
      0
    );
    const tileSql = executed.find((q) => q.includes("ST_AsMVT"));
    expect(tileSql).toBeDefined();
    expect(tileSql).toContain("FROM parcels");
    expect(tileSql).not.toMatch(/inline note|trailing note/);
  });

  it("#660: the tile transaction always rolls back (its temp views never persist on the pooled connection)", async () => {
    const { db: appDb } = await import("../../../db/client.js");
    const outcomes: string[] = [];
    const original = appDb.transaction.bind(appDb);
    const spy = jest.spyOn(appDb, "transaction").mockImplementation(((
      fn: never,
      cfg?: never
    ) =>
      original(fn, cfg).then(
        (v: unknown) => {
          outcomes.push("committed");
          return v;
        },
        (e: unknown) => {
          outcomes.push("rolled-back");
          throw e;
        }
      )) as never);
    try {
      const res = await PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: pinId },
        z: 12,
        x: 2048,
        y: 2047,
        organizationId: orgId,
        userId,
        authorizeSource: allowAllSources,
      });
      expect(res.status).toBe(200); // still renders…
    } finally {
      spy.mockRestore();
    }
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((o) => o === "rolled-back")).toBe(true); // …but never commits
  });

  it("#660 PR 2: the tile's pipeline runs under the reader role", async () => {
    const { db: appDb } = await import("../../../db/client.js");
    const statements: string[] = [];
    const original = appDb.transaction.bind(appDb);
    const spy = jest.spyOn(appDb, "transaction").mockImplementation(((
      fn: (tx: unknown) => unknown,
      cfg?: never
    ) =>
      original(async (tx) => {
        const exec = tx.execute.bind(tx);
        (tx as { execute: unknown }).execute = (q: unknown) => {
          statements.push(JSON.stringify(q));
          return exec(q as never);
        };
        return fn(tx);
      }, cfg)) as never);
    try {
      const res = await PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: pinId },
        z: 12,
        x: 2048,
        y: 2047,
        organizationId: orgId,
        userId,
        authorizeSource: allowAllSources,
      });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    const roleAt = statements.findIndex((s) => s.includes("SET LOCAL ROLE"));
    const tileAt = statements.findIndex((s) => s.includes("ST_AsMVT"));
    expect(roleAt).toBeGreaterThan(-1);
    expect(tileAt).toBeGreaterThan(roleAt);
  });

  it("#660 PR 2: a reader role that disappears after a cached success refuses a tile with 503, not a 500", async () => {
    const tile = () =>
      PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: pinId },
        z: 12,
        x: 2048,
        y: 2047,
        organizationId: orgId,
        userId,
        authorizeSource: allowAllSources,
      });
    await expect(tile()).resolves.toMatchObject({ status: 200 }); // cached
    environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_gone";
    try {
      await expect(tile()).rejects.toMatchObject({
        status: 503,
        code: "PORTAL_SQL_UNAVAILABLE",
      });
    } finally {
      environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader";
      PortalSqlReaderRoleService.resetForTests();
    }
  });

  it("#660 PR 2: with the reader role unusable, a tile refuses (503 PORTAL_SQL_UNAVAILABLE) rather than run as the API's role", async () => {
    environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_absent";
    PortalSqlReaderRoleService.resetForTests();
    try {
      await expect(
        PortalMapTileService.renderTile({
          ref: { kind: "pin", portalResultId: pinId },
          z: 12,
          x: 2048,
          y: 2047,
          organizationId: orgId,
          userId,
          authorizeSource: allowAllSources,
        })
      ).rejects.toMatchObject({ status: 503, code: "PORTAL_SQL_UNAVAILABLE" });
    } finally {
      environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader";
      PortalSqlReaderRoleService.resetForTests();
    }
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
      userId,
      authorizeSource: allowAllSources,
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
        userId,
        authorizeSource: allowAllSources,
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
      userId,
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

  // #532: a plain (no-colorBy) polygon pin → area-ranked dissolve served under
  // the "__all__" sentinel.
  const createNoColorByPin = async (pipelineSql: string): Promise<string> => {
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
        name: "Plain polygons",
        type: "geo",
        content: {
          spec: {
            layers: [
              {
                kind: "polygons",
                source: { geometryColumn: "geom" },
                style: { color: "#4A90D9" },
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
          column_name, value, zoom_band, feature_count, scope_hash, geom)
       VALUES ($1,$2,'SYSTEM_TEST',$3,$4,$5,'Private',$6,3,$8,
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
        dissolveScopeHash,
      ]
    );

  it("dissolve HIT: serves precomputed geometry, never running the pipeline", async () => {
    // #660: the pipeline is validated (a real granted view), but a dissolve HIT
    // serves the stored geometry without running it — the pipeline path
    // (runSessionViewTile) is never entered. (Before #660 this used a
    // nonexistent view as the proof; the relation gate now rejects that pin at
    // any zoom, which is the point.)
    const pipelineRun = jest.spyOn(
      PortalMapTileService as unknown as {
        runSessionViewTile: (...a: unknown[]) => unknown;
      },
      "runSessionViewTile"
    );
    const pin = await createColorByPin(
      'SELECT "c_geom" AS geom, c_own_type FROM parcels',
      "c_own_type"
    );
    await insertDissolveRow(pin, "c_own_type", 0); // band 0 = z0

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.aggregated).toBe(false); // real geometry, not centroid bins
    expect(pipelineRun).not.toHaveBeenCalled();
    pipelineRun.mockRestore();
  });

  it("#660: a raw-table pipeline serves nothing even when precomputed dissolve rows exist for the caller's scope", async () => {
    // Rows computed before #660 from a pipeline that read a physical table (the
    // leak) must not be served: the tile validates the pipeline before choosing
    // the dissolve branch, so it serves nothing at any zoom.
    const pin = await createColorByPin(
      `SELECT "c_geom" AS geom, c_own_type FROM "er__${entityId}"`,
      "c_own_type"
    );
    await insertDissolveRow(pin, "c_own_type", 0);
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
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
      userId,
      authorizeSource: allowAllSources,
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
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect(res.aggregated).toBe(false);
  });

  it("#532: a no-colorBy polygon serves the area-ranked '__all__' dissolve at low zoom (real geometry, not a 504)", async () => {
    // The pipeline references a nonexistent view — if the serve path ran it, the
    // tile would error. It serves from the precomputed "__all__" rows instead.
    const pin = await createNoColorByPin(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    await insertDissolveRow(pin, "__all__", 0); // band 0 = z0, sentinel column

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Real polygon geometry from the precompute — not centroid-bin squares.
    expect(res.aggregated).toBe(false);
  });

  it("#532: an over-cap tile serves the MERGED coverage (never-drop), not a clipped subset", async () => {
    // The never-drop invariant: when a tile holds more individual polygons than
    // the feature cap, the serve switches to the stored merged coverage so every
    // polygon is represented — instead of area-ranking to the largest N and
    // dropping the rest (which is what made whole swathes disappear).
    const pin = await createNoColorByPin(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    // One merged-coverage row (band 0) spanning the data area.
    await connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       VALUES ($1,$2,'SYSTEM_TEST',$3,$4,'__all__','__all__',0,10001,true,$6,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
      [
        generateId(),
        Date.now(),
        orgId,
        pin,
        JSON.stringify({
          type: "MultiPolygon",
          coordinates: [POLYGON.coordinates],
        }),
        dissolveScopeHash,
      ]
    );
    // 10,001 individual rows (merged=false) in the same band, all inside the z0
    // envelope — one over the 10k cap.
    await connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       SELECT gen_random_uuid()::text, $1, 'SYSTEM_TEST', $2, $3,
              '__all__','__all__',0,1,false,$4,
              ST_Multi(ST_Buffer(ST_SetSRID(
                ST_MakePoint(1 + (g % 100) * 0.01, 1 + (g / 100) * 0.01), 4326), 0.002))
       FROM generate_series(1, 10001) g`,
      [Date.now(), orgId, pin, dissolveScopeHash]
    );

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Over the cap → the merged coverage, flagged as an aggregate overview.
    expect(res.aggregated).toBe(true);
  });

  // Bulk-insert `n` individual (merged=false) dissolve rows in band 0, spread as
  // 0.5° squares across the globe so they're visible at z0 (not sub-pixel) — all
  // inside the z0 world envelope.
  const insertManyIndividuals = (pin: string, n: number) =>
    connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       SELECT gen_random_uuid()::text, $1, 'SYSTEM_TEST', $2, $3,
              '__all__','__all__',0,1,false,$4,
              ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(
                -179 + ((g - 1) % 100) * 3.5,
                -85 + (((g - 1) / 100)::int % 100) * 1.6
              ), 4326), 0.5))
       FROM generate_series(1, ${n}) g`,
      [Date.now(), orgId, pin, dissolveScopeHash]
    );

  it("#541 slice 1: over-cap tile with NO merged coverage → area-ranked individuals, never blank", async () => {
    // A degraded (or mid-build) pin: individuals exist but the merged pass never
    // wrote coverage. Before #541 this served an EMPTY tile; now it falls back to
    // area-ranked individuals (the honest degraded state) rather than blanking.
    const pin = await createNoColorByPin(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    await insertManyIndividuals(pin, 10_001); // > cap, no merged=true rows

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Fallback = area-ranked individuals clipped to the cap: a real clip, not an
    // aggregate overview and not empty.
    expect(res.aggregated).toBe(false);
    expect(res.truncatedCap).not.toBeNull();
  });

  it("#541 slice 1: under-cap tile in a band that HAS coverage still serves individuals", async () => {
    // has_merged is band-level; it must not force the coverage path when the tile
    // itself is under the cap — a sparse tile still shows individual polygons.
    const pin = await createNoColorByPin(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    await insertManyIndividuals(pin, 5); // ≤ cap
    await insertDissolveRow(pin, "__all__", 0); // a merged=false row (individual)
    // Add a real merged=true coverage row so the band "has coverage".
    await connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       VALUES ($1,$2,'SYSTEM_TEST',$3,$4,'__all__','__all__',0,5,true,$6,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
      [
        generateId(),
        Date.now(),
        orgId,
        pin,
        JSON.stringify({
          type: "MultiPolygon",
          coordinates: [POLYGON.coordinates],
        }),
        dissolveScopeHash,
      ]
    );

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Under cap → individuals, not the coverage.
    expect(res.aggregated).toBe(false);
  });

  // ── #542: a MESSAGE-block map serves its own precompute (owner-keyed) ──
  const createMessageMap = async (pipelineSql: string): Promise<string> => {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const portalId = generateId();
    await dbTyped.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const messageId = generateId();
    await dbTyped.insert(schema.portalMessages).values({
      id: messageId,
      portalId,
      organizationId: orgId,
      role: "assistant",
      blocks: [
        {
          type: "geo",
          content: {
            spec: {
              layers: [
                { kind: "polygons", source: { geometryColumn: "geom" } },
              ],
            },
            pipeline: { sql: pipelineSql, stationId, organizationId: orgId },
          },
        },
      ],
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return messageId;
  };
  const insertMsgMerged = (messageId: string) =>
    connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, message_id, block_index,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       VALUES ($1,$2,'SYSTEM_TEST',$3,$4,0,'__all__','__all__',0,10001,true,$6,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
      [
        generateId(),
        Date.now(),
        orgId,
        messageId,
        JSON.stringify({
          type: "MultiPolygon",
          coordinates: [POLYGON.coordinates],
        }),
        dissolveScopeHash,
      ]
    );
  const insertMsgIndividuals = (messageId: string, n: number) =>
    connection.unsafe(
      `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, message_id, block_index,
          column_name, value, zoom_band, feature_count, merged, scope_hash, geom)
       SELECT gen_random_uuid()::text, $1, 'SYSTEM_TEST', $2, $3, 0,
              '__all__','__all__',0,1,false,$4,
              ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(
                -179 + ((g - 1) % 100) * 3.5,
                -85 + (((g - 1) / 100)::int % 100) * 1.6
              ), 4326), 0.5))
       FROM generate_series(1, ${n}) g`,
      [Date.now(), orgId, messageId, dissolveScopeHash]
    );

  it("#542: a message tile ref over-cap serves the merged coverage (owner-keyed)", async () => {
    // The message's pipeline references a nonexistent view — serving proves it
    // reads the message-owned precompute, not the raw pipeline.
    const messageId = await createMessageMap(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    await insertMsgMerged(messageId);
    await insertMsgIndividuals(messageId, 10_001); // over cap

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "message", messageId, blockIndex: 0 },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.aggregated).toBe(true);
  });

  it("#542: a message tile ref over-cap with NO coverage falls back to individuals, never blank", async () => {
    const messageId = await createMessageMap(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    await insertMsgIndividuals(messageId, 10_001); // over cap, no merged rows

    const res = await PortalMapTileService.renderTile({
      ref: { kind: "message", messageId, blockIndex: 0 },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.aggregated).toBe(false);
    expect(res.truncatedCap).not.toBeNull();
  });

  // ── #532: count-driven per-tile decision (whole-layer fast path) ──────

  const createCountedPin = async (
    pipelineSql: string,
    count: { matchedCount: number; matchedCountExact: boolean } | null,
    kind: "points" | "lines" = "points"
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
        name: "Counted map",
        type: "geo",
        content: {
          // A points/lines layer → the count-driven aggregate path (bins for
          // points, hybrid for lines). A polygon layer takes the dissolve/raw
          // path (covered by the dissolve tests above).
          spec: {
            layers: [{ kind, source: { geometryColumn: "geom" } }],
          },
          pipeline: { sql: pipelineSql, stationId, organizationId: orgId },
          ...(count ?? {}),
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

  // Bulk-insert `count` short line segments (near lng/lat 1) so a low-zoom tile
  // holds more than the feature cap. The wide table FKs `entity_record_id`, so an
  // `entity_records` row is created for each.
  const bulkInsertLines = async (count: number) => {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const t = Date.now();
    const erRows = [];
    const wideRows = [];
    for (let i = 0; i < count; i++) {
      const lng = 1 + (i % 100) * 0.01;
      const lat = 1 + Math.floor(i / 100) * 0.01;
      const geom = {
        type: "LineString",
        coordinates: [
          [lng, lat],
          [lng + 0.005, lat + 0.005],
        ],
      };
      const erId = generateId();
      erRows.push({
        id: erId,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { geom },
        sourceId: `line-${i}`,
        checksum: `chk-line-${i}`,
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
      });
      wideRows.push({
        entity_record_id: erId,
        organization_id: orgId,
        synced_at: t,
        is_valid: true,
        source_id: `line-${i}`,
        c_geom: geom,
      });
    }
    for (let i = 0; i < erRows.length; i += 1000) {
      await dbTyped
        .insert(schema.entityRecords)
        .values(erRows.slice(i, i + 1000) as never);
    }
    await new WideTableRepository().upsertMany(entityId, wideRows, db);
  };

  it("fast path: an exact count <= cap renders raw at low zoom, not bins (#532)", async () => {
    const pin = await createCountedPin('SELECT "c_geom" AS geom FROM parcels', {
      matchedCount: 5,
      matchedCountExact: true,
    });
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // The whole-layer fast path took the raw path even at z0 — no centroid bins.
    expect(res.aggregated).toBe(false);
  });

  it("#698: a lines layer on the fast path renders raw with ST_Simplify", async () => {
    await bulkInsertLines(3);
    const pin = await createCountedPin(
      'SELECT "c_geom" AS geom FROM parcels',
      { matchedCount: 4, matchedCountExact: true },
      "lines"
    );
    const build = jest.spyOn(PortalMapTileService, "buildRawTileSql");
    try {
      const res = await PortalMapTileService.renderTile({
        ref: { kind: "pin", portalResultId: pin },
        // z10 tile over the bulk lines near (1°, 1°) — each line spans a few
        // pixels here, so it survives ST_AsMVTGeom's quantisation.
        z: 10,
        x: 514,
        y: 509,
        organizationId: orgId,
        userId,
        authorizeSource: allowAllSources,
      });
      expect(res.status).toBe(200);
      expect(res.aggregated).toBe(false);
      expect(build).toHaveBeenCalled();
      const sqlText = build.mock.results[0].value as string;
      expect(sqlText).toContain("ST_Simplify(src.geom,");
      expect(sqlText).not.toContain("ST_SimplifyPreserveTopology");
    } finally {
      build.mockRestore();
    }
  });

  it("no persisted count but a tile that fits → the probe serves raw, not bins (#532 slice 3)", async () => {
    // Only the single setup polygon is in view (1 feature ≤ cap). With no
    // persisted count the tile is probed; because it fits, it serves raw — the
    // count-driven probe, not the old zoom-threshold fallback that binned here.
    const pin = await createCountedPin(
      'SELECT "c_geom" AS geom FROM parcels',
      null
    );
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(res.aggregated).toBe(false);
  });

  it("#532 slice 3: an over-cap points tile aggregates to bins (probe), never clips", async () => {
    await bulkInsertLines(10_001); // 10,001 features > the 10k cap, all in z0
    const pin = await createCountedPin(
      'SELECT "c_geom" AS geom FROM parcels',
      null,
      "points"
    );
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // Over cap → bins, not an arbitrary raw clip.
    expect(res.aggregated).toBe(true);
  });

  it("#532 slice 4: an over-cap lines tile serves the hybrid (aggregated), never dropping short lines", async () => {
    await bulkInsertLines(10_001);
    const pin = await createCountedPin(
      'SELECT "c_geom" AS geom FROM parcels',
      null,
      "lines"
    );
    const res = await PortalMapTileService.renderTile({
      ref: { kind: "pin", portalResultId: pin },
      z: 0,
      x: 0,
      y: 0,
      organizationId: orgId,
      userId,
      authorizeSource: allowAllSources,
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    // The hybrid summarises the remainder (never a length-ranked clip that drops
    // the short lines), so the tile reports aggregated.
    expect(res.aggregated).toBe(true);
  });
});
