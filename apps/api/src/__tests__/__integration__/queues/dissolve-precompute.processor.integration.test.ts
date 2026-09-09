/**
 * Integration tests for the dissolve-precompute processor (#472, slice 2).
 *
 * Exercises the real processor against a live geometry wide table through the
 * session-view path: it runs the pin's durable pipeline and stores one row per
 * source polygon per zoom band, simplified to the band tolerance and tagged with
 * its colorBy value (or the dissolve-all sentinel) — area-ranked, NOT unioned
 * (#532: union was prohibitively slow and re-merged across bands). This proves
 * correctness (valid per-polygon rows, pin-keyed, no cardinality gate, lock,
 * recompute).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DISSOLVE_ZOOM_BANDS } from "@portalai/core/constants";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import { DISSOLVE_LOCK_NAMESPACE } from "../../../services/sync-lock.service.js";
import { dissolvePrecomputeProcessor } from "../../../queues/processors/dissolve-precompute.processor.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

// A unit square at horizontal offset `x` (each parcel is its own polygon).
const squareAt = (x: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [x, 0],
      [x, 1],
      [x + 1, 1],
      [x + 1, 0],
      [x, 0],
    ],
  ],
});

// Run the processor with a minimal fake BullMQ job.
const runProcessor = (portalResultId: string, organizationId: string) =>
  dissolvePrecomputeProcessor({
    data: { portalResultId, organizationId },
    updateProgress: async () => {},
  } as never);

describe("dissolve-precompute processor (#472)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let entityId: string;
  let stationId: string;

  const t = Date.now();

  const insertParcel = async (x: number, ownType: string) => {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const erId = generateId();
    await dbTyped.insert(schema.entityRecords).values({
      id: erId,
      organizationId: orgId,
      connectorEntityId: entityId,
      data: { geom: squareAt(x), own_type: ownType },
      sourceId: `src-${x}`,
      checksum: `chk-${x}`,
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
    await new WideTableRepository().upsertMany(
      entityId,
      [
        {
          entity_record_id: erId,
          organization_id: orgId,
          synced_at: t,
          is_valid: true,
          source_id: `src-${x}`,
          c_geom: squareAt(x),
          c_own_type: ownType,
        },
      ],
      db
    );
  };

  const createPin = async (
    pipelineSql: string,
    colorByColumn: string
  ): Promise<string> => {
    const pinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: pinId,
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
        created: t,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    return pinId;
  };

  // #532: a plain polygon pin (no colorBy) → area-ranked simplified geometry.
  const createPinNoColorBy = async (pipelineSql: string): Promise<string> => {
    const pinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: pinId,
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
        created: t,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    return pinId;
  };

  const countRows = async (pinId: string): Promise<number> => {
    const r = (await connection.unsafe(
      `SELECT count(*)::int AS n FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{ n: number }>;
    return r[0].n;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    reconciler = new WideTableReconcilerService();
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const dbTyped = db as ReturnType<typeof drizzle>;

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-dissolve-${generateId().slice(0, 8)}`,
      display: "Dissolve Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, sync: true },
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
      name: "Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, sync: true },
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
      name: "Station",
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

    for (const [key, type] of [
      ["geom", "geometry"],
      ["own_type", "string"],
    ] as const) {
      const colDefId = generateId();
      await dbTyped.insert(schema.columnDefinitions).values({
        id: colDefId,
        organizationId: orgId,
        key,
        label: key,
        type,
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
        sourceField: key,
        isPrimaryKey: false,
        normalizedKey: key,
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
    }

    await reconciler.reconcileEntity(entityId, db);
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(entityId, db);
    } catch {
      /* ignore */
    }
    await connection.end();
  });

  it("#532: a colorBy layer stores one row per polygon per band, tagged with its value (area-ranked, NOT unioned)", async () => {
    // Three adjacent Private, one Federal, one State. Area-ranked (#532) keeps
    // each polygon as its own row — the three adjacent Private are NOT merged
    // into one piece the way the old dissolve-union did.
    await insertParcel(0, "Private");
    await insertParcel(1, "Private");
    await insertParcel(2, "Private");
    await insertParcel(5, "Federal");
    await insertParcel(8, "State");

    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const result = await runProcessor(pinId, orgId);

    expect(result.columnName).toBe("c_own_type");
    expect(result.valuesDissolved).toBe(3);
    expect(result.rowsWritten).toBeGreaterThan(0);
    expect(result.skipped).toBeUndefined();

    // Rows exist for every band, keyed by the PIN (not the entity), all valid,
    // carrying the colorBy value + column, feature_count 1 (one polygon each).
    const rows = (await connection.unsafe(
      `SELECT value, zoom_band, column_name, feature_count,
              ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS gtype
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{
      value: string;
      zoom_band: number;
      column_name: string;
      feature_count: number;
      valid: boolean;
      gtype: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.valid)).toBe(true);
    expect(rows.every((r) => r.gtype === "ST_MultiPolygon")).toBe(true);
    expect(rows.every((r) => r.column_name === "c_own_type")).toBe(true);
    expect(rows.every((r) => r.feature_count === 1)).toBe(true);
    expect(new Set(rows.map((r) => r.value))).toEqual(
      new Set(["Private", "Federal", "State"])
    );
    expect(new Set(rows.map((r) => r.zoom_band))).toEqual(
      new Set(DISSOLVE_ZOOM_BANDS.map((b) => b.band))
    );
    // Not unioned: the 3 adjacent Private polygons stay 3 separate rows in each
    // band (would be 1 merged piece under the old union path).
    const band0Private = rows.filter(
      (r) => r.zoom_band === 0 && r.value === "Private"
    );
    expect(band0Private.length).toBe(3);
  });

  it("#532: every colorBy value appears in every band (per-polygon, no value drops across a boundary)", async () => {
    await insertParcel(0, "Private");
    await insertParcel(1, "Private");
    await insertParcel(5, "Federal");
    await insertParcel(8, "State");

    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    await runProcessor(pinId, orgId);

    const rows = (await connection.unsafe(
      `SELECT DISTINCT value, zoom_band FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{ value: string; zoom_band: number }>;

    // Every band simplifies the SAME per-polygon rows, so every band carries the
    // full value set — a value never drops out or re-merges across a boundary.
    const expected = new Set(["Private", "Federal", "State"]);
    for (const { band } of DISSOLVE_ZOOM_BANDS) {
      const valuesInBand = new Set(
        rows.filter((r) => r.zoom_band === band).map((r) => r.value)
      );
      expect(valuesInBand).toEqual(expected);
    }
  });

  it("#532: a no-colorBy polygon precomputes area-ranked rows (one per polygon, NOT unioned)", async () => {
    // Three adjacent Private + one Federal + one State = 5 polygons. A colorBy
    // dissolve would UNION the adjacent ones per value; area-ranked keeps every
    // polygon as its own row (so ST_Area can rank them on serve).
    await insertParcel(0, "Private");
    await insertParcel(1, "Private");
    await insertParcel(2, "Private");
    await insertParcel(5, "Federal");
    await insertParcel(8, "State");

    const pinId = await createPinNoColorBy(
      'SELECT "c_geom" AS geom FROM parcels'
    );
    const result = await runProcessor(pinId, orgId);
    expect(result.skipped).toBeUndefined();

    const rows = (await connection.unsafe(
      `SELECT column_name, value, zoom_band, feature_count,
              ST_GeometryType(geom) AS gtype
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{
      column_name: string;
      value: string;
      zoom_band: number;
      feature_count: number;
      gtype: string;
    }>;
    // Keyed by the sentinel, one row per polygon per band (5 polygons × 5 bands
    // = 25) — not merged down to a few unioned pieces.
    expect(rows.every((r) => r.column_name === "__all__")).toBe(true);
    expect(rows.every((r) => r.value === "__all__")).toBe(true);
    expect(rows.every((r) => r.feature_count === 1)).toBe(true);
    expect(rows.every((r) => r.gtype === "ST_MultiPolygon")).toBe(true);
    const perBand = rows.filter((r) => r.zoom_band === 0).length;
    expect(perBand).toBe(5); // one row per polygon — proof it's not unioned
    expect(new Set(rows.map((r) => r.zoom_band))).toEqual(
      new Set(DISSOLVE_ZOOM_BANDS.map((b) => b.band))
    );
  });

  it("keys by the pin, so two pins over the same entity dissolve independently", async () => {
    await insertParcel(0, "Private");
    await insertParcel(5, "Federal");
    const pinA = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    // A different pipeline shape (a filter) — the processor runs whatever SQL the
    // pin carries, so a joined/aggregated multi-source pipeline works the same.
    const pinB = await createPin(
      `SELECT "c_geom" AS geom, "c_own_type" FROM parcels WHERE "c_own_type" = 'Private'`,
      "c_own_type"
    );
    await runProcessor(pinA, orgId);
    await runProcessor(pinB, orgId);

    const valuesA = (await connection.unsafe(
      `SELECT DISTINCT value FROM map_dissolve_geometries WHERE portal_result_id = $1 ORDER BY 1`,
      [pinA]
    )) as unknown as Array<{ value: string }>;
    const valuesB = (await connection.unsafe(
      `SELECT DISTINCT value FROM map_dissolve_geometries WHERE portal_result_id = $1 ORDER BY 1`,
      [pinB]
    )) as unknown as Array<{ value: string }>;
    expect(valuesA.map((r) => r.value)).toEqual(["Federal", "Private"]);
    expect(valuesB.map((r) => r.value)).toEqual(["Private"]); // the filter applied
  });

  it("recompute replaces the pin's rows (no doubling, no zero-row window)", async () => {
    await insertParcel(0, "Private");
    await insertParcel(5, "Federal");
    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    await runProcessor(pinId, orgId);
    const first = await countRows(pinId);
    expect(first).toBeGreaterThan(0);
    await runProcessor(pinId, orgId);
    const second = await countRows(pinId);
    expect(second).toBe(first);
  });

  it("#532: a high-cardinality colorBy is precomputed area-ranked (no cardinality gate)", async () => {
    // 70 distinct values — the old union path skipped over a 64-value ceiling
    // because each value got its own union; the area-ranked store keeps one row
    // per polygon regardless, so there is no ceiling and nothing is skipped.
    for (let i = 0; i < 70; i++) await insertParcel(i, `owner-${i}`);
    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const result = await runProcessor(pinId, orgId);
    expect(result.skipped).toBeUndefined();
    expect(result.valuesDissolved).toBe(70);
    // 70 polygons × 5 bands, one row each.
    expect(await countRows(pinId)).toBe(70 * DISSOLVE_ZOOM_BANDS.length);
  });

  it("reports superseded without writing when the pin lock is held", async () => {
    await insertParcel(0, "Private");
    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    // Hold the advisory lock on this pin from a separate session.
    const holder = postgres(process.env.DATABASE_URL as string, { max: 1 });
    try {
      const locked = (await holder.unsafe(
        `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
        [DISSOLVE_LOCK_NAMESPACE, pinId]
      )) as unknown as Array<{ locked: boolean }>;
      expect(locked[0].locked).toBe(true);

      const result = await runProcessor(pinId, orgId);
      expect(result.skipped).toBe("superseded");
      expect(await countRows(pinId)).toBe(0);
    } finally {
      await holder.unsafe(`SELECT pg_advisory_unlock_all()`);
      await holder.end();
    }
  });

  it("skips a non-polygon pin (points → no dissolve)", async () => {
    await insertParcel(0, "Private");
    // A points pin — nothing to dissolve (#532: only polygons dissolve; a
    // no-colorBy *polygon* now dissolves area-ranked, tested above).
    const pinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: pinId,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Points",
        type: "geo",
        content: {
          spec: {
            layers: [
              {
                kind: "points",
                source: { latColumn: "lat", lngColumn: "lng" },
              },
            ],
          },
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
    const result = await runProcessor(pinId, orgId);
    expect(result.skipped).toBe("non-polygon");
    expect(await countRows(pinId)).toBe(0);
  });
});
