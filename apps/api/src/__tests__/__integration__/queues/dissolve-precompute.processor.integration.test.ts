/**
 * Integration tests for the dissolve-precompute processor (#472, slice 2).
 *
 * Exercises the real processor against a live geometry wide table through the
 * session-view path: it runs the pin's durable pipeline, dissolves the result
 * by the colorBy value per zoom band (snap → make-valid → union), subdivides it
 * into bounded pieces, and stores them keyed by the pin. The bounded-union SQL
 * itself was measured against a 397,960-parcel layer (~2s/21s/30s per band); this
 * proves correctness (valid pieces, pin-keyed, cardinality gate, lock, recompute).
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

  it("dissolves per (value, band) into valid subdivided pieces, keyed by the pin", async () => {
    // Three Private (adjacent → merge), one Federal, one State.
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
    // carrying the colorBy value + column.
    const rows = (await connection.unsafe(
      `SELECT value, zoom_band, column_name,
              ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS gtype
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{
      value: string;
      zoom_band: number;
      column_name: string;
      valid: boolean;
      gtype: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.valid)).toBe(true);
    expect(rows.every((r) => r.gtype === "ST_MultiPolygon")).toBe(true);
    expect(rows.every((r) => r.column_name === "c_own_type")).toBe(true);
    expect(new Set(rows.map((r) => r.value))).toEqual(
      new Set(["Private", "Federal", "State"])
    );
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

  it("skips a colorBy over the cardinality ceiling and clears stale rows", async () => {
    // 70 distinct values (> DISSOLVE_CARDINALITY_CEILING = 64).
    for (let i = 0; i < 70; i++) await insertParcel(i, `owner-${i}`);
    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const result = await runProcessor(pinId, orgId);
    expect(result.skipped).toBe("over-cardinality");
    expect(await countRows(pinId)).toBe(0);
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

  it("skips a non-polygon / no-colorby pin", async () => {
    await insertParcel(0, "Private");
    // A polygons pin with no colorBy.
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
        name: "No colorBy",
        type: "geo",
        content: {
          spec: {
            layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
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
    expect(result.skipped).toBe("no-colorby");
    expect(await countRows(pinId)).toBe(0);
  });
});
