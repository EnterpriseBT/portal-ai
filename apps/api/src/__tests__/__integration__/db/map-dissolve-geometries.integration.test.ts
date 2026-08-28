/**
 * Integration tests for the `map_dissolve_geometries` storage table (#472,
 * slice 1). Exercises the PostGIS substrate the precompute job writes and the
 * tile serve path reads: a MultiPolygon round-trips through the hand-added
 * `geom geometry(MultiPolygon,4326)` column + GiST index, the natural key is
 * unique, and rows cascade-delete with their pin.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("map_dissolve_geometries storage (#472)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let stationId: string;
  let portalResultId: string;

  const MULTIPOLYGON = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    ],
  };

  const now = Date.now();

  const insertRow = async (
    args: {
      value?: string;
      zoomBand?: number;
      columnName?: string;
      geomJson?: unknown;
    } = {}
  ) => {
    const id = generateId();
    await connection.unsafe(
      `INSERT INTO map_dissolve_geometries
        (id, created, created_by, organization_id, portal_result_id,
         column_name, value, zoom_band, feature_count, geom)
       VALUES ($1,$2,'test',$3,$4,$5,$6,$7,$8,
         ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($9),4326)))`,
      [
        id,
        now,
        orgId,
        portalResultId,
        args.columnName ?? "c_own_type",
        args.value ?? "Private",
        args.zoomBand ?? 0,
        5,
        JSON.stringify(args.geomJson ?? MULTIPOLYGON),
      ]
    );
    return id;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbTyped = db as ReturnType<typeof drizzle>;
    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    stationId = generateId();
    await dbTyped.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Test Station",
      description: null,
      toolPacks: [],
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    portalResultId = generateId();
    await dbTyped.insert(schema.portalResults).values({
      id: portalResultId,
      organizationId: orgId,
      stationId,
      portalId: null,
      messageId: null,
      name: "choropleth",
      type: "geo",
      content: {},
      snapshotUpdatedAt: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("round-trips a GeoJSON MultiPolygon through the geom column", async () => {
    await insertRow();
    const rows = (await connection.unsafe(
      `SELECT ST_GeometryType(geom) AS gtype, ST_AsGeoJSON(geom)::jsonb AS gj,
              ST_SRID(geom) AS srid
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [portalResultId]
    )) as unknown as Array<{ gtype: string; gj: unknown; srid: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].gtype).toBe("ST_MultiPolygon");
    expect(Number(rows[0].srid)).toBe(4326);
    const gj = rows[0].gj as { type: string; coordinates: number[][][][] };
    expect(gj.type).toBe("MultiPolygon");
    expect(gj.coordinates).toEqual(MULTIPOLYGON.coordinates);
  });

  it("plans a spatial predicate as a GiST index scan", async () => {
    await insertRow();
    const plan = await connection.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      return (await tx.unsafe(
        `EXPLAIN SELECT 1 FROM map_dissolve_geometries
         WHERE ST_Intersects(geom, ST_MakeEnvelope(0, 0, 1, 1, 4326))`
      )) as unknown as Array<Record<string, string>>;
    });
    const planText = plan
      .map((r) => Object.values(r)[0])
      .join("\n")
      .toLowerCase();
    expect(planText).toMatch(/index scan|bitmap index scan/);
  });

  it("rejects a duplicate (portalResultId, columnName, value, zoomBand)", async () => {
    await insertRow({ value: "Private", zoomBand: 0 });
    await expect(
      insertRow({ value: "Private", zoomBand: 0 })
    ).rejects.toThrow();
    // A different band for the same value is fine.
    await expect(
      insertRow({ value: "Private", zoomBand: 1 })
    ).resolves.toBeDefined();
  });

  it("cascade-deletes rows when the pin is removed", async () => {
    await insertRow({ value: "Private" });
    await insertRow({ value: "Federal" });
    const before = (await connection.unsafe(
      `SELECT count(*)::int AS n FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [portalResultId]
    )) as unknown as Array<{ n: number }>;
    expect(before[0].n).toBe(2);

    await connection.unsafe(`DELETE FROM portal_results WHERE id = $1`, [
      portalResultId,
    ]);

    const after = (await connection.unsafe(
      `SELECT count(*)::int AS n FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [portalResultId]
    )) as unknown as Array<{ n: number }>;
    expect(after[0].n).toBe(0);
  });
});
