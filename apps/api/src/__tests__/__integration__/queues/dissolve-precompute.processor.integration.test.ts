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

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DISSOLVE_ZOOM_BANDS } from "@portalai/core/constants";
import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableRepository } from "../../../db/repositories/wide-table.repository.js";
import { DISSOLVE_LOCK_NAMESPACE } from "../../../services/sync-lock.service.js";
import { DissolvePrecomputeService } from "../../../services/dissolve-precompute.service.js";
import { JobsService } from "../../../services/jobs.service.js";
import { dissolvePrecomputeProcessor } from "../../../queues/processors/dissolve-precompute.processor.js";
import { messageDissolveRetentionPurgeProcessor } from "../../../queues/processors/message-dissolve-retention-purge.processor.js";
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

  it("#532: a colorBy layer stores individuals + a merged coverage per band, tagged with its value", async () => {
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

    // Rows exist for every band, keyed by the PIN, all valid, carrying the
    // colorBy value + column. `merged` distinguishes the two representations.
    const rows = (await connection.unsafe(
      `SELECT value, zoom_band, column_name, feature_count, merged,
              ST_IsValid(geom) AS valid, ST_GeometryType(geom) AS gtype
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{
      value: string;
      zoom_band: number;
      column_name: string;
      feature_count: number;
      merged: boolean;
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

    // Individuals (merged=false): one row per source polygon, feature_count 1 —
    // the 3 adjacent Private stay 3 separate rows per band (NOT unioned).
    const individuals = rows.filter((r) => !r.merged);
    expect(individuals.every((r) => r.feature_count === 1)).toBe(true);
    const band0PrivateIndiv = individuals.filter(
      (r) => r.zoom_band === 0 && r.value === "Private"
    );
    expect(band0PrivateIndiv.length).toBe(3);

    // Merged coverage (merged=true): a dissolved piece per value per band, its
    // feature_count = the source polygons it merged (Private = 3).
    const merged = rows.filter((r) => r.merged);
    expect(merged.length).toBeGreaterThan(0);
    expect(new Set(merged.map((r) => r.zoom_band))).toEqual(
      new Set(DISSOLVE_ZOOM_BANDS.map((b) => b.band))
    );
    const band0PrivateMerged = merged.filter(
      (r) => r.zoom_band === 0 && r.value === "Private"
    );
    expect(band0PrivateMerged.length).toBeGreaterThanOrEqual(1);
    expect(band0PrivateMerged.every((r) => r.feature_count === 3)).toBe(true);
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

  it("#532: a no-colorBy polygon stores individuals (one per polygon) + a merged coverage under the sentinel", async () => {
    // Three adjacent Private + one Federal + one State = 5 polygons. Individuals
    // keep every polygon as its own row (so ST_Area can rank them under the cap);
    // the merged coverage unions them for the over-cap case.
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
      `SELECT column_name, value, zoom_band, feature_count, merged,
              ST_GeometryType(geom) AS gtype
       FROM map_dissolve_geometries WHERE portal_result_id = $1`,
      [pinId]
    )) as unknown as Array<{
      column_name: string;
      value: string;
      zoom_band: number;
      feature_count: number;
      merged: boolean;
      gtype: string;
    }>;
    // Both representations keyed by the sentinel column + value.
    expect(rows.every((r) => r.column_name === "__all__")).toBe(true);
    expect(rows.every((r) => r.value === "__all__")).toBe(true);
    expect(rows.every((r) => r.gtype === "ST_MultiPolygon")).toBe(true);
    expect(new Set(rows.map((r) => r.zoom_band))).toEqual(
      new Set(DISSOLVE_ZOOM_BANDS.map((b) => b.band))
    );

    // Individuals: one row per polygon per band (5 per band), feature_count 1.
    const individuals = rows.filter((r) => !r.merged);
    expect(individuals.every((r) => r.feature_count === 1)).toBe(true);
    expect(individuals.filter((r) => r.zoom_band === 0).length).toBe(5);

    // Merged coverage: the 5 polygons snapped-then-unioned, feature_count 5,
    // present per band. #541: the coarse-snap union COLLAPSES the sources into a
    // bounded coverage — far fewer merged pieces per band than source polygons
    // (the 3 adjacent squares union into one), never O(source count).
    const merged = rows.filter((r) => r.merged);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.every((r) => r.feature_count === 5)).toBe(true);
    expect(new Set(merged.map((r) => r.zoom_band))).toEqual(
      new Set(DISSOLVE_ZOOM_BANDS.map((b) => b.band))
    );
    const mergedBand0 = merged.filter((r) => r.zoom_band === 0).length;
    expect(mergedBand0).toBeLessThan(5); // collapsed, not one-per-source
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

  it("#532: a high-cardinality colorBy is precomputed with no cardinality gate", async () => {
    // 70 distinct values — the old union path skipped over a 64-value ceiling;
    // the #532 store has no ceiling, so nothing is skipped.
    for (let i = 0; i < 70; i++) await insertParcel(i, `owner-${i}`);
    const pinId = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const result = await runProcessor(pinId, orgId);
    expect(result.skipped).toBeUndefined();
    expect(result.valuesDissolved).toBe(70);
    // Per band: 70 individuals (one polygon each) + 70 merged pieces (one union
    // per value, each of a single polygon) = 140 × 5 bands.
    expect(await countRows(pinId)).toBe(2 * 70 * DISSOLVE_ZOOM_BANDS.length);
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

  it("#541: reenqueueAllDissolvable enqueues a dissolve for each polygon pin (real DB scan)", async () => {
    const p1 = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const p2 = await createPinNoColorBy('SELECT "c_geom" AS geom FROM parcels');
    // Spy JobsService.create so the scan is exercised without touching the queue.
    const createSpy = jest
      .spyOn(JobsService, "create")
      .mockResolvedValue({ id: "job" } as never);
    try {
      const res = await DissolvePrecomputeService.reenqueueAllDissolvable();
      const enqueuedPins = createSpy.mock.calls.map(
        ([, params]) =>
          (params as unknown as { metadata: { portalResultId: string } })
            .metadata.portalResultId
      );
      // Robust to any pins other suites left behind: both of ours are enqueued.
      expect(enqueuedPins).toContain(p1);
      expect(enqueuedPins).toContain(p2);
      expect(res.enqueued).toBeGreaterThanOrEqual(2);
    } finally {
      createSpy.mockRestore();
    }
  });

  // #542: a transient message-block map owner.
  const createMessageBlock = async (
    pipelineSql: string,
    colorByColumn: string | null,
    blocks = 1
  ): Promise<string> => {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const portalId = generateId();
    await dbTyped.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const layer = colorByColumn
      ? {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: colorByColumn } },
        }
      : { kind: "polygons", source: { geometryColumn: "geom" } };
    const block = {
      type: "geo",
      content: {
        spec: { layers: [layer] },
        pipeline: { sql: pipelineSql, stationId, organizationId: orgId },
      },
    };
    const messageId = generateId();
    await dbTyped.insert(schema.portalMessages).values({
      id: messageId,
      portalId,
      organizationId: orgId,
      role: "assistant",
      blocks: Array.from({ length: blocks }, () => block),
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return messageId;
  };

  const runProcessorMsg = (
    messageId: string,
    blockIndex: number,
    organizationId: string
  ) =>
    dissolvePrecomputeProcessor({
      data: { messageId, blockIndex, organizationId },
      updateProgress: async () => {},
    } as never);

  const msgRows = async (messageId: string, blockIndex: number) =>
    (await connection.unsafe(
      `SELECT portal_result_id, message_id, block_index, merged, feature_count
       FROM map_dissolve_geometries WHERE message_id = $1 AND block_index = $2`,
      [messageId, blockIndex]
    )) as unknown as Array<{
      portal_result_id: string | null;
      message_id: string;
      block_index: number;
      merged: boolean;
      feature_count: number;
    }>;

  it("#542: a message-owner job writes coverage keyed by (message_id, block_index)", async () => {
    await insertParcel(0, "Private");
    await insertParcel(1, "Private");
    await insertParcel(5, "Federal");
    const messageId = await createMessageBlock(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const result = await runProcessorMsg(messageId, 0, orgId);
    expect(result.skipped).toBeUndefined();

    const rows = await msgRows(messageId, 0);
    expect(rows.length).toBeGreaterThan(0);
    // Owned by the message block, never a pin.
    expect(
      rows.every(
        (r) =>
          r.portal_result_id === null &&
          r.message_id === messageId &&
          r.block_index === 0
      )
    ).toBe(true);
    // Both representations present (reuses #532/#541 unchanged).
    expect(rows.some((r) => !r.merged)).toBe(true);
    expect(rows.some((r) => r.merged)).toBe(true);
  });

  it("#542: two blocks of one message dissolve independently", async () => {
    await insertParcel(0, "Private");
    const messageId = await createMessageBlock(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type",
      2
    );
    await runProcessorMsg(messageId, 0, orgId);
    await runProcessorMsg(messageId, 1, orgId);
    expect((await msgRows(messageId, 0)).length).toBeGreaterThan(0);
    expect((await msgRows(messageId, 1)).length).toBeGreaterThan(0);
  });

  it("#542: deleting the message cascade-removes its coverage", async () => {
    await insertParcel(0, "Private");
    const messageId = await createMessageBlock(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    await runProcessorMsg(messageId, 0, orgId);
    expect((await msgRows(messageId, 0)).length).toBeGreaterThan(0);
    await connection.unsafe(`DELETE FROM portal_messages WHERE id = $1`, [
      messageId,
    ]);
    expect((await msgRows(messageId, 0)).length).toBe(0);
  });

  it("#542: age purge deletes message coverage past the window, keeps in-window + pin rows", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const dbTyped = db as ReturnType<typeof drizzle>;
    const portalId = generateId();
    await dbTyped.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const mkMsg = async (created: number): Promise<string> => {
      const id = generateId();
      await dbTyped.insert(schema.portalMessages).values({
        id,
        portalId,
        organizationId: orgId,
        role: "assistant",
        blocks: [],
        created,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      return id;
    };
    const oldMsg = await mkMsg(t - 40 * DAY); // past a 30d window
    const newMsg = await mkMsg(t); // in-window
    const pin = await createPin(
      'SELECT "c_geom" AS geom, "c_own_type" FROM parcels',
      "c_own_type"
    );
    const geomJson = JSON.stringify({
      type: "MultiPolygon",
      coordinates: [squareAt(0).coordinates],
    });
    const insMsgCov = (mid: string) =>
      connection.unsafe(
        `INSERT INTO map_dissolve_geometries
           (id, created, created_by, organization_id, message_id, block_index,
            column_name, value, zoom_band, feature_count, merged, geom)
         VALUES ($1,$2,'SYSTEM_TEST',$3,$4,0,'__all__','__all__',0,1,false,
           ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
        [generateId(), t, orgId, mid, geomJson]
      );
    const insPinCov = (pid: string) =>
      connection.unsafe(
        `INSERT INTO map_dissolve_geometries
           (id, created, created_by, organization_id, portal_result_id,
            column_name, value, zoom_band, feature_count, merged, geom)
         VALUES ($1,$2,'SYSTEM_TEST',$3,$4,'__all__','__all__',0,1,false,
           ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)))`,
        [generateId(), t, orgId, pid, geomJson]
      );
    await insMsgCov(oldMsg);
    await insMsgCov(newMsg);
    await insPinCov(pin);

    const summary = await messageDissolveRetentionPurgeProcessor({ now: t });
    expect(summary.purged).toBe(1); // only the aged-out message's coverage

    const cnt = async (where: string, val: string): Promise<number> => {
      const r = (await connection.unsafe(
        `SELECT count(*)::int AS n FROM map_dissolve_geometries WHERE ${where} = $1`,
        [val]
      )) as unknown as Array<{ n: number }>;
      return r[0].n;
    };
    expect(await cnt("message_id", oldMsg)).toBe(0); // aged out → purged
    expect(await cnt("message_id", newMsg)).toBe(1); // in-window → kept
    expect(await cnt("portal_result_id", pin)).toBe(1); // pin → never touched
  });
});
