/**
 * Analytics Service — stateless service with static methods.
 *
 * Each method receives pre-loaded records and runs the analysis.
 * All methods are organized by pack — there is no distinction between
 * "core" and "curated" at the service layer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import alasql from "alasql";
import * as aq from "arquero";
import * as ss from "simple-statistics";
import { kmeans } from "ml-kmeans";
import {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  ATR,
  OBV,
  Stochastic,
  ADX,
  VWAP,
  WilliamsR,
  CCI,
  ROC,
  PSAR,
  IchimokuCloud,
} from "technicalindicators";
import * as financial from "financial";
import { parse as vegaParse, View as VegaView } from "vega";
import type { Spec as VegaSpec, Data, ValuesData } from "vega";
import { compile as vegaLiteCompile } from "vega-lite";
import type { TopLevelSpec as VegaLiteSpec } from "vega-lite";

import { inArray } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { db } from "../db/client.js";
import { connectorInstances as connectorInstancesTable } from "../db/schema/index.js";
import { createLogger } from "../utils/logger.util.js";
import { VegaLiteSpecInput } from "../tools/visualize.tool.js";

const logger = createLogger({ module: "analytics-service" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnSchema {
  key: string;
  label: string;
  type: string;
  columnDefinitionId: string;
  fieldMappingId: string;
  sourceField: string;
}

export interface EntitySchema {
  id: string;
  key: string;
  label: string;
  connectorInstanceId: string;
  columns: ColumnSchema[];
}

export interface EntityGroupMemberContext {
  entityKey: string;
  linkColumnKey: string;
  linkColumnLabel: string;
  isPrimary: boolean;
}

export interface EntityGroupContext {
  id: string;
  name: string;
  members: EntityGroupMemberContext[];
}

export interface StationData {
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  records: Map<string, Record<string, unknown>[]>;
}

export interface DescribeColumnResult {
  count: number;
  mean: number;
  median: number;
  stddev: number;
  /** Sample variance (n-1 divisor). */
  variance: number;
  /** Smallest value tied for highest frequency. */
  mode: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  /** Inter-quartile range: p75 - p25. */
  iqr: number;
  skewness: number;
  /** Excess kurtosis (≈ 0 for normal, < 0 for uniform/platykurtic). */
  kurtosis: number;
  /** Optional map of arbitrary percentiles, keyed by the input number stringified. */
  percentiles?: Record<string, number>;
}

export interface RegressionResult {
  coefficients: number[];
  rSquared: number;
}

export interface TrendResult {
  dates: string[];
  values: number[];
  trendLine: { slope: number; intercept: number };
}

export interface TechnicalIndicatorResult {
  dates: string[];
  values: (number | object)[];
}

export interface AmortizationRow {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface ResolveIdentityResult {
  entityGroupName: string;
  linkValue: string;
  matches: {
    entityKey: string;
    isPrimary: boolean;
    records: Record<string, unknown>[];
  }[];
}

// ---------------------------------------------------------------------------
// SQL Blocklist
// ---------------------------------------------------------------------------

const SQL_BLOCKLIST = [/\bSELECT\s+INTO\b/i, /\bATTACH\b/i];

function validateSql(sql: string): void {
  for (const pattern of SQL_BLOCKLIST) {
    if (pattern.test(sql)) {
      throw new Error(`Blocked SQL operation: ${pattern.source}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Vega / Vega-Lite Spec Validation
// ---------------------------------------------------------------------------

/**
 * Validate a Vega spec by parsing and running a headless view.
 * Catches structural errors (bad mark types, invalid transforms, missing
 * data references, etc.) that `vega.parse` alone does not surface.
 */
function validateVegaLiteSpec(spec: VegaLiteSpec): void {
  try {
    vegaLiteCompile(spec);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Vega-Lite spec: ${msg}`);
  }
}

async function validateVegaSpec(spec: VegaSpec): Promise<void> {
  try {
    const runtime = vegaParse(spec as any);
    const view = new VegaView(runtime, { renderer: "none" });
    await view.runAsync();
    view.finalize();
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Vega spec: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// AlaSQL Database Management
// ---------------------------------------------------------------------------

/** Per-station AlaSQL database instances keyed by `stationId`. */
const stationDatabases = new Map<string, any>();

function getOrCreateDatabase(stationId: string): any {
  if (!stationDatabases.has(stationId)) {
    const dbName = `station_${stationId.replace(/-/g, "_")}`;
    const db = new alasql.Database(dbName);
    stationDatabases.set(stationId, { db, dbName });
  }
  return stationDatabases.get(stationId)!;
}

function dropDatabase(stationId: string): void {
  const entry = stationDatabases.get(stationId);
  if (entry) {
    try {
      alasql(`DROP DATABASE IF EXISTS ${entry.dbName}`);
    } catch {
      // ignore cleanup errors
    }
    stationDatabases.delete(stationId);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AnalyticsService {
  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  /**
   * Load all data for a station into in-memory AlaSQL tables.
   *
   * Resolves stationId → station_instances → connectorInstanceIds,
   * loads entities with field mappings + column definitions,
   * fetches entity records, registers AlaSQL tables, and discovers entity groups.
   */
  static async loadStation(
    stationId: string,
    organizationId: string
  ): Promise<StationData> {
    logger.info({ stationId, organizationId }, "Loading station data");

    // Clean up any prior load for this station
    dropDatabase(stationId);

    const repo = DbService.repository;

    // 1. Resolve station instances → connector instance IDs
    const stationInstances =
      await repo.stationInstances.findByStationId(stationId);
    const connectorInstanceIds = stationInstances.map(
      (si) => si.connectorInstanceId
    );

    if (connectorInstanceIds.length === 0) {
      logger.warn({ stationId }, "Station has no connector instances");
      return { entities: [], entityGroups: [], records: new Map() };
    }

    // 2. For each instance: load connector entities
    const allEntities = (
      await Promise.all(
        connectorInstanceIds.map((ciId) =>
          repo.connectorEntities.findByConnectorInstanceId(ciId)
        )
      )
    ).flat();

    // 3. For each entity: load field mappings → column definitions
    const entityIds = allEntities.map((e) => e.id);
    const fieldMappingsByEntity =
      await repo.connectorEntities.findFieldMappingsByEntityIds(entityIds);

    // 4. Build typed schema catalog + fetch records
    const entities: EntitySchema[] = [];
    const records = new Map<string, Record<string, unknown>[]>();
    const { db: alasqlDb, dbName } = getOrCreateDatabase(stationId);

    for (const entity of allEntities) {
      const mappings = fieldMappingsByEntity.get(entity.id) ?? [];
      const columns: ColumnSchema[] = mappings
        .filter((m: any) => m.columnDefinition)
        .map((m: any) => ({
          key: m.columnDefinition.key,
          label: m.columnDefinition.label,
          type: m.columnDefinition.type,
          columnDefinitionId: m.columnDefinitionId,
          fieldMappingId: m.id,
          sourceField: m.sourceField,
        }));

      entities.push({
        id: entity.id,
        key: entity.key,
        label: entity.label,
        connectorInstanceId: entity.connectorInstanceId,
        columns,
      });

      // Fetch records and extract normalizedData with record metadata
      const entityRecords = await repo.entityRecords.findByConnectorEntityId(
        entity.id
      );
      const rows = entityRecords
        .map((r: any) => {
          if (!r.normalizedData) return null;
          return {
            _record_id: r.id,
            _connector_entity_id: entity.id,
            ...r.normalizedData,
          };
        })
        .filter(Boolean) as Record<string, unknown>[];
      records.set(entity.key, rows);

      // Register as AlaSQL table
      alasqlDb.exec(`CREATE TABLE IF NOT EXISTS [${entity.key}]`);
      if (rows.length > 0) {
        alasql(`INSERT INTO [${dbName}].[${entity.key}] SELECT * FROM ?`, [
          rows,
        ]);
      }
    }

    // 5. Load station-scoped metadata tables into AlaSQL

    // Connector instances attached to this station (query directly to avoid credential decryption)
    const connectorInstanceRows =
      connectorInstanceIds.length > 0
        ? await db
            .select({
              id: connectorInstancesTable.id,
              name: connectorInstancesTable.name,
              status: connectorInstancesTable.status,
              connectorDefinitionId:
                connectorInstancesTable.connectorDefinitionId,
            })
            .from(connectorInstancesTable)
            .where(inArray(connectorInstancesTable.id, connectorInstanceIds))
        : [];
    alasqlDb.exec("CREATE TABLE IF NOT EXISTS [_connector_instances]");
    if (connectorInstanceRows.length > 0) {
      alasql(`INSERT INTO [${dbName}].[_connector_instances] SELECT * FROM ?`, [
        connectorInstanceRows.map((ci) => ({
          id: ci.id,
          name: ci.name,
          status: ci.status,
          connector_definition_id: ci.connectorDefinitionId,
        })),
      ]);
    }

    // Connector entities for attached instances
    alasqlDb.exec("CREATE TABLE IF NOT EXISTS [_connector_entities]");
    if (allEntities.length > 0) {
      alasql(`INSERT INTO [${dbName}].[_connector_entities] SELECT * FROM ?`, [
        allEntities.map((e: Record<string, unknown>) => ({
          id: e.id,
          key: e.key,
          label: e.label,
          connector_instance_id: e.connectorInstanceId,
        })),
      ]);
    }

    // Organization-level column definitions and field mappings
    const allColumnDefs =
      await repo.columnDefinitions.findByOrganizationId(organizationId);
    alasqlDb.exec("CREATE TABLE IF NOT EXISTS [_column_definitions]");
    if (allColumnDefs.length > 0) {
      alasql(`INSERT INTO [${dbName}].[_column_definitions] SELECT * FROM ?`, [
        allColumnDefs.map((cd: Record<string, unknown>) => ({
          id: cd.id,
          key: cd.key,
          label: cd.label,
          type: cd.type,
          required: cd.required,
          description: cd.description,
        })),
      ]);
    }

    const allFieldMappings = [...fieldMappingsByEntity.values()].flat();
    alasqlDb.exec("CREATE TABLE IF NOT EXISTS [_field_mappings]");
    if (allFieldMappings.length > 0) {
      alasql(`INSERT INTO [${dbName}].[_field_mappings] SELECT * FROM ?`, [
        allFieldMappings.map((fm: Record<string, unknown>) => ({
          id: fm.id,
          connector_entity_id: fm.connectorEntityId,
          column_definition_id: fm.columnDefinitionId,
          source_field: fm.sourceField,
          is_primary_key: fm.isPrimaryKey,
        })),
      ]);
    }

    // 6. Entity Group discovery
    const entityGroups = await this.discoverEntityGroups(
      allEntities,
      fieldMappingsByEntity
    );

    logger.info(
      {
        stationId,
        entityCount: entities.length,
        entityGroupCount: entityGroups.length,
      },
      "Station data loaded"
    );

    return { entities, entityGroups, records };
  }

  // -------------------------------------------------------------------------
  // Surgical AlaSQL cache mutations (called directly from tools)
  // -------------------------------------------------------------------------

  /**
   * Generic helpers: insert, upsert (by id), and delete a row in a named
   * AlaSQL table.  All helpers silently no-op when the station is not loaded.
   */
  private static cacheInsert(
    stationId: string,
    table: string,
    row: Record<string, unknown>
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [
        [row],
      ]);
    } catch (err) {
      logger.warn({ stationId, table, err }, "AlaSQL cache insert failed");
    }
  }

  private static cacheUpsert(
    stationId: string,
    table: string,
    id: string,
    row: Record<string, unknown>
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      alasql(`DELETE FROM [${entry.dbName}].[${table}] WHERE id = ?`, [id]);
      alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [
        [row],
      ]);
    } catch (err) {
      logger.warn({ stationId, table, id, err }, "AlaSQL cache upsert failed");
    }
  }

  private static cacheDelete(
    stationId: string,
    table: string,
    idColumn: string,
    id: string
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      alasql(
        `DELETE FROM [${entry.dbName}].[${table}] WHERE [${idColumn}] = ?`,
        [id]
      );
    } catch (err) {
      logger.warn({ stationId, table, id, err }, "AlaSQL cache delete failed");
    }
  }

  // -- Entity record data tables -------------------------------------------

  static applyRecordInsert(
    stationId: string,
    entityKey: string,
    row: Record<string, unknown>
  ): void {
    this.cacheInsert(stationId, entityKey, row);
  }

  static applyRecordUpdate(
    stationId: string,
    entityKey: string,
    recordId: string,
    row: Record<string, unknown>
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      alasql(
        `DELETE FROM [${entry.dbName}].[${entityKey}] WHERE _record_id = ?`,
        [recordId]
      );
      alasql(`INSERT INTO [${entry.dbName}].[${entityKey}] SELECT * FROM ?`, [
        [row],
      ]);
    } catch (err) {
      logger.warn(
        { stationId, entityKey, recordId, err },
        "AlaSQL record update failed"
      );
    }
  }

  static applyRecordDelete(
    stationId: string,
    entityKey: string,
    recordId: string
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      alasql(
        `DELETE FROM [${entry.dbName}].[${entityKey}] WHERE _record_id = ?`,
        [recordId]
      );
    } catch (err) {
      logger.warn(
        { stationId, entityKey, recordId, err },
        "AlaSQL record delete failed"
      );
    }
  }

  // -- _connector_entities -------------------------------------------------

  static applyEntityInsert(
    stationId: string,
    row: { id: string; key: string; label: string; connectorInstanceId: string }
  ): void {
    this.cacheInsert(stationId, "_connector_entities", {
      id: row.id,
      key: row.key,
      label: row.label,
      connector_instance_id: row.connectorInstanceId,
    });
    // Create the empty data table for the new entity
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      entry.db.exec(`CREATE TABLE IF NOT EXISTS [${row.key}]`);
    } catch {
      /* ignore */
    }
  }

  static applyEntityUpdate(
    stationId: string,
    row: { id: string; key: string; label: string; connectorInstanceId: string }
  ): void {
    this.cacheUpsert(stationId, "_connector_entities", row.id, {
      id: row.id,
      key: row.key,
      label: row.label,
      connector_instance_id: row.connectorInstanceId,
    });
  }

  static applyEntityDelete(
    stationId: string,
    entityId: string,
    entityKey: string
  ): void {
    this.cacheDelete(stationId, "_connector_entities", "id", entityId);
    // Drop the entity data table
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    try {
      entry.db.exec(`DROP TABLE IF EXISTS [${entityKey}]`);
    } catch {
      /* ignore */
    }
    // Remove field mappings that belonged to this entity
    try {
      alasql(
        `DELETE FROM [${entry.dbName}].[_field_mappings] WHERE connector_entity_id = ?`,
        [entityId]
      );
    } catch {
      /* ignore */
    }
  }

  // -- _column_definitions -------------------------------------------------

  static applyColumnDefinitionInsert(
    stationId: string,
    row: {
      id: string;
      key: string;
      label: string;
      type: string;
      description: string | null;
    }
  ): void {
    this.cacheInsert(stationId, "_column_definitions", row);
  }

  static applyColumnDefinitionUpdate(
    stationId: string,
    row: {
      id: string;
      key: string;
      label: string;
      type: string;
      description: string | null;
    }
  ): void {
    this.cacheUpsert(stationId, "_column_definitions", row.id, row);
  }

  static applyColumnDefinitionDelete(
    stationId: string,
    columnDefinitionId: string
  ): void {
    this.cacheDelete(
      stationId,
      "_column_definitions",
      "id",
      columnDefinitionId
    );
  }

  // -- _field_mappings -----------------------------------------------------

  static applyFieldMappingInsert(
    stationId: string,
    row: {
      id: string;
      connector_entity_id: string;
      column_definition_id: string;
      source_field: string;
      is_primary_key: boolean;
    }
  ): void {
    this.cacheInsert(stationId, "_field_mappings", row);
  }

  static applyFieldMappingUpdate(
    stationId: string,
    row: {
      id: string;
      connector_entity_id: string;
      column_definition_id: string;
      source_field: string;
      is_primary_key: boolean;
    }
  ): void {
    this.cacheUpsert(stationId, "_field_mappings", row.id, row);
  }

  static applyFieldMappingDelete(
    stationId: string,
    fieldMappingId: string
  ): void {
    this.cacheDelete(stationId, "_field_mappings", "id", fieldMappingId);
  }

  // -------------------------------------------------------------------------
  // Batch cache mutations (called from bulk tools)
  // -------------------------------------------------------------------------

  private static cacheBatchInsert(
    stationId: string,
    table: string,
    rows: Record<string, unknown>[]
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry || rows.length === 0) return;
    try {
      alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [
        rows,
      ]);
    } catch (err) {
      logger.warn(
        { stationId, table, count: rows.length, err },
        "AlaSQL batch insert failed"
      );
    }
  }

  private static cacheBatchUpsert(
    stationId: string,
    table: string,
    idColumn: string,
    rows: Record<string, unknown>[]
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry || rows.length === 0) return;
    try {
      const ids = rows.map((r) => r[idColumn]);
      alasql(
        `DELETE FROM [${entry.dbName}].[${table}] WHERE [${idColumn}] IN @(?)`,
        [ids]
      );
      alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [
        rows,
      ]);
    } catch (err) {
      logger.warn(
        { stationId, table, count: rows.length, err },
        "AlaSQL batch upsert failed"
      );
    }
  }

  private static cacheBatchDelete(
    stationId: string,
    table: string,
    idColumn: string,
    ids: string[]
  ): void {
    const entry = stationDatabases.get(stationId);
    if (!entry || ids.length === 0) return;
    try {
      alasql(
        `DELETE FROM [${entry.dbName}].[${table}] WHERE [${idColumn}] IN @(?)`,
        [ids]
      );
    } catch (err) {
      logger.warn(
        { stationId, table, count: ids.length, err },
        "AlaSQL batch delete failed"
      );
    }
  }

  // -- Batch: entity records ------------------------------------------------

  static applyRecordInsertMany(
    stationId: string,
    entityKey: string,
    rows: Record<string, unknown>[]
  ): void {
    this.cacheBatchInsert(stationId, entityKey, rows);
  }

  static applyRecordUpdateMany(
    stationId: string,
    entityKey: string,
    rows: Record<string, unknown>[]
  ): void {
    this.cacheBatchUpsert(stationId, entityKey, "_record_id", rows);
  }

  static applyRecordDeleteMany(
    stationId: string,
    entityKey: string,
    recordIds: string[]
  ): void {
    this.cacheBatchDelete(stationId, entityKey, "_record_id", recordIds);
  }

  // -- Batch: field mappings ------------------------------------------------

  static applyFieldMappingInsertMany(
    stationId: string,
    rows: Record<string, unknown>[]
  ): void {
    this.cacheBatchInsert(stationId, "_field_mappings", rows);
  }

  static applyFieldMappingUpdateMany(
    stationId: string,
    rows: Record<string, unknown>[]
  ): void {
    this.cacheBatchUpsert(stationId, "_field_mappings", "id", rows);
  }

  static applyFieldMappingDeleteMany(stationId: string, ids: string[]): void {
    this.cacheBatchDelete(stationId, "_field_mappings", "id", ids);
  }

  // -- Batch: connector entities --------------------------------------------

  static applyEntityInsertMany(
    stationId: string,
    rows: {
      id: string;
      key: string;
      label: string;
      connectorInstanceId: string;
    }[]
  ): void {
    const cacheRows = rows.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      connector_instance_id: r.connectorInstanceId,
    }));
    this.cacheBatchInsert(stationId, "_connector_entities", cacheRows);
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    for (const r of rows) {
      try {
        entry.db.exec(`CREATE TABLE IF NOT EXISTS [${r.key}]`);
      } catch {
        /* ignore */
      }
    }
  }

  static applyEntityUpdateMany(
    stationId: string,
    rows: {
      id: string;
      key: string;
      label: string;
      connectorInstanceId: string;
    }[]
  ): void {
    const cacheRows = rows.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      connector_instance_id: r.connectorInstanceId,
    }));
    this.cacheBatchUpsert(stationId, "_connector_entities", "id", cacheRows);
  }

  static applyEntityDeleteMany(
    stationId: string,
    entityIds: string[],
    entityKeys: string[]
  ): void {
    this.cacheBatchDelete(stationId, "_connector_entities", "id", entityIds);
    const entry = stationDatabases.get(stationId);
    if (!entry) return;
    for (const key of entityKeys) {
      try {
        entry.db.exec(`DROP TABLE IF EXISTS [${key}]`);
      } catch {
        /* ignore */
      }
    }
    for (const entityId of entityIds) {
      try {
        alasql(
          `DELETE FROM [${entry.dbName}].[_field_mappings] WHERE connector_entity_id = ?`,
          [entityId]
        );
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Discover entity groups that have ≥2 member entities loaded in this station.
   */
  private static async discoverEntityGroups(
    loadedEntities: { id: string; key: string }[],
    _fieldMappingsByEntity: Map<string, any[]>
  ): Promise<EntityGroupContext[]> {
    const repo = DbService.repository;
    const loadedEntityIds = new Set(loadedEntities.map((e) => e.id));
    const loadedEntityKeyById = new Map(
      loadedEntities.map((e) => [e.id, e.key])
    );

    // For each loaded entity, find group memberships
    const allMemberships = (
      await Promise.all(
        loadedEntities.map((e) =>
          repo.entityGroupMembers.findByConnectorEntityId(e.id)
        )
      )
    ).flat();

    // Deduplicate by entityGroupId
    const groupIdSet = new Set(allMemberships.map((m) => m.entityGroupId));

    const entityGroups: EntityGroupContext[] = [];

    for (const groupId of groupIdSet) {
      // Fetch full group + all members with related data
      const [group, members] = await Promise.all([
        repo.entityGroups.findById(groupId),
        repo.entityGroupMembers.findByEntityGroupId(groupId, {
          include: ["connectorEntity", "fieldMapping", "columnDefinition"],
        }),
      ]);

      if (!group) continue;

      // Keep only groups where ≥2 member entities are loaded
      const loadedMembers = members.filter((m: any) =>
        loadedEntityIds.has(m.connectorEntityId)
      );
      if (loadedMembers.length < 2) continue;

      const memberContexts: EntityGroupMemberContext[] = loadedMembers.map(
        (m: any) => ({
          entityKey: loadedEntityKeyById.get(m.connectorEntityId) ?? "",
          linkColumnKey: m.columnDefinition?.key ?? "",
          linkColumnLabel: m.columnDefinition?.label ?? "",
          isPrimary: m.isPrimary ?? false,
        })
      );

      entityGroups.push({
        id: group.id,
        name: group.name,
        members: memberContexts,
      });
    }

    return entityGroups;
  }

  /**
   * Load records for a single entity by key.
   */
  static async loadRecords(
    entityKey: string,
    _organizationId: string
  ): Promise<Record<string, unknown>[]> {
    const repo = DbService.repository;

    // Find entity across all connector instances in the org
    // We need to search through connector entities
    const entities = await repo.connectorEntities.findMany();
    const entity = entities.find((e: any) => e.key === entityKey);

    if (!entity) {
      throw new Error(`Entity not found: ${entityKey}`);
    }

    const records = await repo.entityRecords.findByConnectorEntityId(entity.id);
    return records.map((r: any) => r.normalizedData).filter(Boolean) as Record<
      string,
      unknown
    >[];
  }

  // -----------------------------------------------------------------------
  // Pack: data_query
  // -----------------------------------------------------------------------

  /**
   * Execute a SQL query against in-memory AlaSQL tables.
   * Validates SQL against an allowlist (blocks SELECT INTO, ATTACH).
   */
  static sqlQuery(params: {
    sql: string;
    stationId: string;
  }): Record<string, unknown>[] {
    const { sql, stationId } = params;
    validateSql(sql);

    const entry = stationDatabases.get(stationId);
    if (!entry) {
      throw new Error(`Station not loaded: ${stationId}`);
    }

    logger.info({ stationId, sql }, "Executing SQL query");
    return entry.db.exec(sql) as Record<string, unknown>[];
  }

  /**
   * Run SQL then inject rows into a Vega-Lite spec.
   */
  static async visualize(params: {
    sql: string;
    vegaLiteSpec: VegaLiteSpecInput;
    stationId: string;
  }): Promise<VegaLiteSpec> {
    const { sql, vegaLiteSpec, stationId } = params;
    const rows = this.sqlQuery({ sql, stationId });
    const spec = {
      ...vegaLiteSpec,
      data: { values: rows },
    } as VegaLiteSpec;
    validateVegaLiteSpec(spec);
    return spec;
  }

  /**
   * Run SQL then inject rows into a full Vega spec.
   *
   * When `data[0]` derives from a named `source` dataset (e.g. "table") that
   * doesn't exist in the spec, we create that base dataset with the query
   * results so downstream datasets can reference it. Otherwise we fall back to
   * setting `data[0].values` directly.
   */
  static async visualizeVega(params: {
    sql: string;
    vegaSpec: Record<string, unknown>;
    stationId: string;
  }): Promise<VegaSpec> {
    const { sql, vegaSpec, stationId } = params;
    const rows = this.sqlQuery({ sql, stationId });
    const specData = vegaSpec.data;
    const data: Data[] = Array.isArray(specData)
      ? ([...specData] as Data[])
      : [];

    const first = data[0] as Data | undefined;
    const firstSource =
      first && "source" in first && typeof first.source === "string"
        ? first.source
        : null;

    if (firstSource) {
      const sourceExists = data.some((d) => d.name === firstSource);
      if (!sourceExists) {
        // Create the missing base dataset that other datasets derive from
        const base: ValuesData = { name: firstSource, values: rows };
        data.unshift(base);
      } else {
        const idx = data.findIndex((d) => d.name === firstSource);
        data[idx] = { ...data[idx], values: rows } as ValuesData;
      }
    } else {
      data[0] = { ...data[0], values: rows } as ValuesData;
    }

    const spec = { ...vegaSpec, data } as VegaSpec;
    await validateVegaSpec(spec);
    return spec;
  }

  /**
   * Look up an Entity Group by name, query each member's in-memory AlaSQL table,
   * and return matched records grouped by source entity with primary entity first.
   */
  static resolveIdentity(params: {
    entityGroupName: string;
    linkValue: string;
    stationId: string;
    entityGroups: EntityGroupContext[];
  }): ResolveIdentityResult {
    const { entityGroupName, linkValue, stationId, entityGroups } = params;

    const group = entityGroups.find((g) => g.name === entityGroupName);
    if (!group) {
      throw new Error(`Entity group not found: ${entityGroupName}`);
    }

    const entry = stationDatabases.get(stationId);
    if (!entry) {
      throw new Error(`Station not loaded: ${stationId}`);
    }

    const matches: ResolveIdentityResult["matches"] = [];

    for (const member of group.members) {
      try {
        const rows = entry.db.exec(
          `SELECT * FROM [${member.entityKey}] WHERE [${member.linkColumnKey}] = '${String(linkValue).replace(/'/g, "''")}'`
        ) as Record<string, unknown>[];
        matches.push({
          entityKey: member.entityKey,
          isPrimary: member.isPrimary,
          records: rows,
        });
      } catch (err) {
        logger.warn(
          { entityKey: member.entityKey, error: err },
          "Failed to query entity for identity resolution"
        );
        matches.push({
          entityKey: member.entityKey,
          isPrimary: member.isPrimary,
          records: [],
        });
      }
    }

    // Sort: primary entity first
    matches.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));

    return { entityGroupName, linkValue, matches };
  }

  // -----------------------------------------------------------------------
  // Pack: statistics
  // -----------------------------------------------------------------------

  /**
   * Describe a numeric column: count, mean, median, stddev, min, max, p25, p75.
   */
  static describeColumn(params: {
    records: Record<string, unknown>[];
    column: string;
    percentiles?: number[];
  }): DescribeColumnResult {
    const values = this.extractNumericColumn(params.records, params.column);
    if (values.length === 0) {
      return {
        count: 0,
        mean: 0,
        median: 0,
        stddev: 0,
        variance: 0,
        mode: 0,
        min: 0,
        max: 0,
        p25: 0,
        p75: 0,
        iqr: 0,
        skewness: 0,
        kurtosis: 0,
      };
    }

    const p25 = ss.quantile(values, 0.25);
    const p75 = ss.quantile(values, 0.75);
    const result: DescribeColumnResult = {
      count: values.length,
      mean: ss.mean(values),
      median: ss.median(values),
      stddev: ss.standardDeviation(values),
      variance: ss.sampleVariance(values),
      mode: ss.mode(values),
      min: ss.min(values),
      max: ss.max(values),
      p25,
      p75,
      iqr: p75 - p25,
      skewness: ss.sampleSkewness(values),
      kurtosis: ss.sampleKurtosis(values),
    };

    if (params.percentiles !== undefined) {
      const map: Record<string, number> = {};
      for (const p of params.percentiles) {
        map[String(p)] = ss.quantile(values, p);
      }
      result.percentiles = map;
    }

    return result;
  }

  /**
   * Correlation between two numeric columns. Method defaults to Pearson;
   * Spearman uses averaged ranks; Kendall uses τ-b with tie correction.
   */
  static correlate(params: {
    records: Record<string, unknown>[];
    columnA: string;
    columnB: string;
    method?: "pearson" | "spearman" | "kendall";
  }): { correlation: number } {
    const a = this.extractNumericColumn(params.records, params.columnA);
    const b = this.extractNumericColumn(params.records, params.columnB);

    if (a.length !== b.length || a.length < 2) {
      throw new Error(
        "Columns must have the same length and at least 2 values"
      );
    }

    const method = params.method ?? "pearson";
    let correlation: number;
    switch (method) {
      case "pearson":
        correlation = ss.sampleCorrelation(a, b);
        break;
      case "spearman":
        correlation = ss.sampleRankCorrelation(a, b);
        break;
      case "kendall":
        correlation = this.kendallTau(a, b);
        break;
    }
    return { correlation };
  }

  /**
   * Kendall's τ-b (with tie correction). Reference: Kendall (1938);
   * SciPy convention returns 0 when the denominator collapses (fully tied).
   */
  private static kendallTau(a: number[], b: number[]): number {
    const n = a.length;
    if (n < 2) return 0;

    let concordant = 0;
    let discordant = 0;
    let tiesA = 0;
    let tiesB = 0;

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const da = Math.sign(a[i] - a[j]);
        const db = Math.sign(b[i] - b[j]);
        if (da === 0 && db === 0) {
          tiesA++;
          tiesB++;
        } else if (da === 0) {
          tiesA++;
        } else if (db === 0) {
          tiesB++;
        } else if (da === db) {
          concordant++;
        } else {
          discordant++;
        }
      }
    }

    const n0 = (n * (n - 1)) / 2;
    const denom = Math.sqrt((n0 - tiesA) * (n0 - tiesB));
    if (denom === 0) return 0;
    return (concordant - discordant) / denom;
  }

  /**
   * Detect outliers using IQR, Z-score, or modified Z-score (MAD).
   * Default thresholds: IQR 1.5, Z-score 3, modified Z (Iglewicz/Hoaglin) 3.5.
   */
  static detectOutliers(params: {
    records: Record<string, unknown>[];
    column: string;
    method: "iqr" | "zscore" | "mad";
    threshold?: number;
  }): { outliers: Record<string, unknown>[]; indices: number[] } {
    const values = this.extractNumericColumn(params.records, params.column);
    const indices: number[] = [];
    const { method } = params;

    if (method === "iqr") {
      const t = params.threshold ?? 1.5;
      const q1 = ss.quantile(values, 0.25);
      const q3 = ss.quantile(values, 0.75);
      const iqr = q3 - q1;
      const lower = q1 - t * iqr;
      const upper = q3 + t * iqr;

      values.forEach((v, i) => {
        if (v < lower || v > upper) indices.push(i);
      });
    } else if (method === "zscore") {
      const t = params.threshold ?? 3;
      const m = ss.mean(values);
      const std = ss.standardDeviation(values);
      if (std === 0) return { outliers: [], indices: [] };

      values.forEach((v, i) => {
        if (Math.abs((v - m) / std) > t) indices.push(i);
      });
    } else {
      // mad — Iglewicz/Hoaglin modified z-score
      const t = params.threshold ?? 3.5;
      const median = ss.median(values);
      const mad = ss.median(values.map((v) => Math.abs(v - median)));
      if (mad === 0) return { outliers: [], indices: [] };

      values.forEach((v, i) => {
        const modZ = (0.6745 * (v - median)) / mad;
        if (Math.abs(modZ) > t) indices.push(i);
      });
    }

    return {
      outliers: indices.map((i) => params.records[i]),
      indices,
    };
  }

  /**
   * K-means clustering via ml-kmeans. Optionally z-score each column before
   * fitting; when `standardize` is true, centroids are returned in original-
   * data units (un-standardized) so consumers can interpret them directly.
   */
  static cluster(params: {
    records: Record<string, unknown>[];
    columns: string[];
    k: number;
    standardize?: boolean;
    seed?: number;
    maxIterations?: number;
  }): { clusters: number[]; centroids: number[][] } {
    const data = params.records.map((r) =>
      params.columns.map((col) => {
        const v = Number(r[col]);
        if (isNaN(v)) throw new Error(`Non-numeric value in column "${col}"`);
        return v;
      })
    );

    if (data.length === 0) {
      return { clusters: [], centroids: [] };
    }

    let fitData = data;
    let means: number[] | null = null;
    let stddevs: number[] | null = null;

    if (params.standardize) {
      const cols = params.columns.length;
      means = new Array(cols).fill(0);
      stddevs = new Array(cols).fill(0);
      for (let c = 0; c < cols; c++) {
        const colVals = data.map((row) => row[c]);
        means[c] = ss.mean(colVals);
        stddevs[c] = ss.standardDeviation(colVals);
      }
      fitData = data.map((row) =>
        row.map((v, c) =>
          stddevs![c] === 0 ? 0 : (v - means![c]) / stddevs![c]
        )
      );
    }

    const opts: { seed?: number; maxIterations?: number } = {};
    if (params.seed !== undefined) opts.seed = params.seed;
    if (params.maxIterations !== undefined) opts.maxIterations = params.maxIterations;

    const result = kmeans(fitData, params.k, opts);

    const rawCentroids = result.centroids.map((c: any) =>
      Array.isArray(c) ? c : c.centroid
    );

    const centroids =
      params.standardize && means && stddevs
        ? rawCentroids.map((row: number[]) =>
            row.map((v, c) =>
              stddevs![c] === 0 ? means![c] : v * stddevs![c] + means![c]
            )
          )
        : rawCentroids;

    return {
      clusters: result.clusters,
      centroids,
    };
  }

  // -----------------------------------------------------------------------
  // Pack: regression
  // -----------------------------------------------------------------------

  /**
   * Linear or polynomial regression via simple-statistics.
   * Returns coefficients and R-squared.
   */
  static regression(params: {
    records: Record<string, unknown>[];
    x: string;
    y: string;
    type: "linear" | "polynomial";
    degree?: number;
  }): RegressionResult {
    const xVals = this.extractNumericColumn(params.records, params.x);
    const yVals = this.extractNumericColumn(params.records, params.y);

    if (xVals.length !== yVals.length || xVals.length < 2) {
      throw new Error(
        "Columns must have the same length and at least 2 values"
      );
    }

    const pairs: [number, number][] = xVals.map((x, i) => [x, yVals[i]]);

    if (params.type === "linear") {
      const lr = ss.linearRegression(pairs);
      const lrLine = ss.linearRegressionLine(lr);
      const predicted = xVals.map((x) => lrLine(x));
      const rSq = this.computeRSquared(yVals, predicted);

      return {
        coefficients: [lr.b, lr.m], // [intercept, slope]
        rSquared: rSq,
      };
    }

    // Polynomial regression using normal equations
    const degree = params.degree ?? 2;
    const coefficients = this.polynomialFit(xVals, yVals, degree);
    const predicted = xVals.map((x) =>
      coefficients.reduce((sum, c, i) => sum + c * Math.pow(x, i), 0)
    );
    const rSq = this.computeRSquared(yVals, predicted);

    return { coefficients, rSquared: rSq };
  }

  /**
   * Time-series aggregation via Arquero + linear trend line.
   */
  static trend(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    interval: "day" | "week" | "month" | "quarter" | "year";
  }): TrendResult {
    const { records, dateColumn, valueColumn, interval } = params;

    if (records.length === 0) {
      return { dates: [], values: [], trendLine: { slope: 0, intercept: 0 } };
    }

    // Sort by date
    const sorted = [...records].sort((a, b) => {
      const da = new Date(a[dateColumn] as string).getTime();
      const db = new Date(b[dateColumn] as string).getTime();
      return da - db;
    });

    // Build Arquero table
    const dt = aq.from(sorted);

    // Group by interval
    const grouped = dt
      .derive({
        _period: aq.escape((d: any) => {
          const date = new Date(d[dateColumn]);
          switch (interval) {
            case "day":
              return date.toISOString().slice(0, 10);
            case "week": {
              const start = new Date(date);
              start.setDate(start.getDate() - start.getDay());
              return start.toISOString().slice(0, 10);
            }
            case "month":
              return date.toISOString().slice(0, 7);
            case "quarter": {
              const q = Math.ceil((date.getMonth() + 1) / 3);
              return `${date.getFullYear()}-Q${q}`;
            }
            case "year":
              return `${date.getFullYear()}`;
          }
        }),
      })
      .groupby("_period")
      .rollup({ _value: aq.op.mean(valueColumn) })
      .orderby("_period");

    const dates = grouped.array("_period") as string[];
    const values = grouped.array("_value") as number[];

    // Linear trend line
    const indices = values.map((_, i) => i);
    const pairs: [number, number][] = indices.map((i) => [i, values[i]]);
    const lr = ss.linearRegression(pairs);

    return {
      dates,
      values,
      trendLine: { slope: lr.m, intercept: lr.b },
    };
  }

  // -----------------------------------------------------------------------
  // Pack: financial
  // -----------------------------------------------------------------------

  /**
   * Technical indicators via technicalindicators library.
   */
  static technicalIndicator(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    indicator:
      | "SMA"
      | "EMA"
      | "RSI"
      | "MACD"
      | "BB"
      | "ATR"
      | "OBV"
      | "Stochastic"
      | "ADX"
      | "VWAP"
      | "WilliamsR"
      | "CCI"
      | "ROC"
      | "PSAR"
      | "Ichimoku"
      | "Donchian";
    params?: Record<string, unknown>;
  }): TechnicalIndicatorResult {
    const { records, dateColumn, valueColumn, indicator } = params;
    const extraParams = params.params ?? {};

    // Sort by date
    const sorted = [...records].sort(
      (a, b) =>
        new Date(a[dateColumn] as string).getTime() -
        new Date(b[dateColumn] as string).getTime()
    );

    const dates = sorted.map((r) => String(r[dateColumn]));
    const closePrices = sorted.map((r) => Number(r[valueColumn]));
    const period = (extraParams.period as number) ?? 14;

    let values: (number | object)[];

    switch (indicator) {
      case "SMA":
        values = SMA.calculate({ period, values: closePrices });
        break;
      case "EMA":
        values = EMA.calculate({ period, values: closePrices });
        break;
      case "RSI":
        values = RSI.calculate({ period, values: closePrices });
        break;
      case "MACD": {
        const result = MACD.calculate({
          values: closePrices,
          fastPeriod: (extraParams.fastPeriod as number) ?? 12,
          slowPeriod: (extraParams.slowPeriod as number) ?? 26,
          signalPeriod: (extraParams.signalPeriod as number) ?? 9,
          SimpleMAOscillator: false,
          SimpleMASignal: false,
        });
        values = result as object[];
        break;
      }
      case "BB":
        values = BollingerBands.calculate({
          period,
          values: closePrices,
          stdDev: (extraParams.stdDev as number) ?? 2,
        }) as object[];
        break;
      case "ATR": {
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        const close = closePrices;
        values = ATR.calculate({ period, high, low, close });
        break;
      }
      case "OBV": {
        const close = closePrices;
        const volume = sorted.map((r) =>
          Number(r[(extraParams.volumeColumn as string) ?? "volume"])
        );
        values = OBV.calculate({ close, volume });
        break;
      }
      case "Stochastic": {
        const stochPeriod = (extraParams.period as number) ?? 14;
        const signalPeriod = (extraParams.signalPeriod as number) ?? 3;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = Stochastic.calculate({
          period: stochPeriod,
          signalPeriod,
          high,
          low,
          close: closePrices,
        }) as object[];
        break;
      }
      case "ADX": {
        const adxPeriod = (extraParams.period as number) ?? 14;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = ADX.calculate({
          period: adxPeriod,
          high,
          low,
          close: closePrices,
        }) as object[];
        break;
      }
      case "VWAP": {
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        const volume = sorted.map((r) =>
          Number(r[(extraParams.volumeColumn as string) ?? "volume"])
        );
        values = VWAP.calculate({
          high,
          low,
          close: closePrices,
          volume,
        });
        break;
      }
      case "WilliamsR": {
        const wrPeriod = (extraParams.period as number) ?? 14;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = WilliamsR.calculate({
          period: wrPeriod,
          high,
          low,
          close: closePrices,
        });
        break;
      }
      case "CCI": {
        const cciPeriod = (extraParams.period as number) ?? 20;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = CCI.calculate({
          period: cciPeriod,
          high,
          low,
          close: closePrices,
        });
        break;
      }
      case "ROC": {
        const rocPeriod = (extraParams.period as number) ?? 12;
        values = ROC.calculate({ period: rocPeriod, values: closePrices });
        break;
      }
      case "PSAR": {
        const step = (extraParams.step as number) ?? 0.02;
        const max = (extraParams.max as number) ?? 0.2;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = PSAR.calculate({ step, max, high, low });
        break;
      }
      case "Ichimoku": {
        const conversionPeriod =
          (extraParams.conversionPeriod as number) ?? 9;
        const basePeriod = (extraParams.basePeriod as number) ?? 26;
        const spanPeriod = (extraParams.spanPeriod as number) ?? 52;
        const displacement = (extraParams.displacement as number) ?? 26;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        values = IchimokuCloud.calculate({
          conversionPeriod,
          basePeriod,
          spanPeriod,
          displacement,
          high,
          low,
        }) as object[];
        break;
      }
      case "Donchian": {
        // Hand-rolled — technicalindicators does not export Donchian.
        // Upper = highest high over N periods, lower = lowest low,
        // middle = (upper + lower) / 2. Output aligns to the right edge.
        const dcPeriod = (extraParams.period as number) ?? 20;
        const high = sorted.map((r) =>
          Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map((r) =>
          Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        const out: { upper: number; middle: number; lower: number }[] = [];
        for (let i = dcPeriod - 1; i < high.length; i++) {
          const winHigh = high.slice(i - dcPeriod + 1, i + 1);
          const winLow = low.slice(i - dcPeriod + 1, i + 1);
          const upper = Math.max(...winHigh);
          const lower = Math.min(...winLow);
          out.push({ upper, middle: (upper + lower) / 2, lower });
        }
        values = out;
        break;
      }
      default:
        throw new Error(`Unsupported indicator: ${indicator}`);
    }

    // Align dates — indicators produce fewer values (offset from start)
    const offset = dates.length - values.length;
    const alignedDates = dates.slice(offset);

    return { dates: alignedDates, values };
  }

  /**
   * Net present value via financial.
   */
  static npv(params: { rate: number; cashFlows: number[] }): { npv: number } {
    return { npv: financial.npv(params.rate, params.cashFlows) };
  }

  /**
   * Internal rate of return via financial.
   */
  static irr(params: { cashFlows: number[] }): { irr: number } {
    return { irr: financial.irr(params.cashFlows) };
  }

  /**
   * Loan amortization schedule via financial. Compounding selects the
   * periods-per-year (default monthly = 12); extraPayment is added to the
   * scheduled principal each period and may shorten the schedule.
   */
  static amortize(params: {
    principal: number;
    annualRate: number;
    periods: number;
    compounding?: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
    extraPayment?: number;
  }): AmortizationRow[] {
    const { principal, annualRate, periods } = params;
    const periodsPerYear = {
      weekly: 52,
      biweekly: 26,
      monthly: 12,
      quarterly: 4,
      annual: 1,
    }[params.compounding ?? "monthly"];

    const periodicRate = annualRate / periodsPerYear;
    const basePayment =
      periodicRate === 0
        ? principal / periods
        : -financial.pmt(periodicRate, periods, principal);
    const extra = params.extraPayment ?? 0;
    const schedule: AmortizationRow[] = [];
    let balance = principal;

    for (let i = 1; i <= periods; i++) {
      if (balance <= 0) break;
      const interest = balance * periodicRate;
      let principalPart = basePayment - interest + extra;
      let payment = basePayment + extra;
      if (principalPart > balance) {
        principalPart = balance;
        payment = principalPart + interest;
      }
      balance -= principalPart;

      schedule.push({
        period: i,
        payment: Math.round(payment * 100) / 100,
        principal: Math.round(principalPart * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        balance: Math.round(Math.max(balance, 0) * 100) / 100,
      });
    }

    return schedule;
  }

  /**
   * Sharpe ratio: (mean - riskFreeRate) / stddev. When `periodicity` is
   * supplied, multiplies the raw ratio by the appropriate annualization
   * factor (√252 for daily, √52 weekly, √12 monthly, 2 quarterly, 1 annual).
   */
  static sharpeRatio(params: {
    records: Record<string, unknown>[];
    valueColumn: string;
    riskFreeRate?: number;
    periodicity?: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  }): { sharpeRatio: number } {
    const values = this.extractNumericColumn(
      params.records,
      params.valueColumn
    );
    if (values.length < 2) {
      throw new Error("At least 2 values required for Sharpe ratio");
    }

    // Compute returns
    const returns: number[] = [];
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }

    const meanReturn = ss.mean(returns);
    const stdReturn = ss.standardDeviation(returns);
    const rfr = params.riskFreeRate ?? 0;

    if (stdReturn === 0) {
      return { sharpeRatio: 0 };
    }

    const annualizationFactor = {
      daily: Math.sqrt(252),
      weekly: Math.sqrt(52),
      monthly: Math.sqrt(12),
      quarterly: 2,
      annual: 1,
    };

    let ratio = (meanReturn - rfr) / stdReturn;
    if (params.periodicity) {
      ratio *= annualizationFactor[params.periodicity];
    }

    return { sharpeRatio: ratio };
  }

  /**
   * Maximum drawdown: rolling peak then (peak - trough) / peak.
   */
  static maxDrawdown(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
  }): {
    maxDrawdown: number;
    peakDate: string | null;
    troughDate: string | null;
  } {
    const { records, dateColumn, valueColumn } = params;

    if (records.length === 0) {
      return { maxDrawdown: 0, peakDate: null, troughDate: null };
    }

    // Sort by date
    const sorted = [...records].sort(
      (a, b) =>
        new Date(a[dateColumn] as string).getTime() -
        new Date(b[dateColumn] as string).getTime()
    );

    const dates = sorted.map((r) => String(r[dateColumn]));
    const values = sorted.map((r) => Number(r[valueColumn]));

    let peak = values[0];
    let peakIdx = 0;
    let maxDd = 0;
    let maxDdPeakIdx = 0;
    let maxDdTroughIdx = 0;

    for (let i = 1; i < values.length; i++) {
      if (values[i] > peak) {
        peak = values[i];
        peakIdx = i;
      }
      const dd = (peak - values[i]) / peak;
      if (dd > maxDd) {
        maxDd = dd;
        maxDdPeakIdx = peakIdx;
        maxDdTroughIdx = i;
      }
    }

    return {
      maxDrawdown: maxDd,
      peakDate: maxDd > 0 ? dates[maxDdPeakIdx] : null,
      troughDate: maxDd > 0 ? dates[maxDdTroughIdx] : null,
    };
  }

  /**
   * Rolling returns: period-over-period return series within a rolling window.
   */
  static rollingReturns(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    window: number;
  }): { dates: string[]; returns: number[] } {
    const { records, dateColumn, valueColumn, window: windowSize } = params;

    // Sort by date
    const sorted = [...records].sort(
      (a, b) =>
        new Date(a[dateColumn] as string).getTime() -
        new Date(b[dateColumn] as string).getTime()
    );

    const dates: string[] = [];
    const returns: number[] = [];

    for (let i = windowSize; i < sorted.length; i++) {
      const current = Number(sorted[i][valueColumn]);
      const past = Number(sorted[i - windowSize][valueColumn]);
      if (past !== 0) {
        dates.push(String(sorted[i][dateColumn]));
        returns.push((current - past) / past);
      }
    }

    return { dates, returns };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Extract a numeric column from records, skipping non-numeric values. */
  private static extractNumericColumn(
    records: Record<string, unknown>[],
    column: string
  ): number[] {
    const values: number[] = [];
    for (const r of records) {
      const v = Number(r[column]);
      if (!isNaN(v) && r[column] !== null && r[column] !== undefined) {
        values.push(v);
      }
    }
    return values;
  }

  /** R-squared computation. */
  private static computeRSquared(
    actual: number[],
    predicted: number[]
  ): number {
    const meanActual = ss.mean(actual);
    const ssRes = actual.reduce(
      (sum, y, i) => sum + Math.pow(y - predicted[i], 2),
      0
    );
    const ssTot = actual.reduce(
      (sum, y) => sum + Math.pow(y - meanActual, 2),
      0
    );
    return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  }

  /** Polynomial least-squares fit. Returns coefficients [a0, a1, ..., an]. */
  private static polynomialFit(
    x: number[],
    y: number[],
    degree: number
  ): number[] {
    const size = degree + 1;

    // Build Vandermonde matrix
    const matrix: number[][] = [];
    const rhs: number[] = [];

    for (let i = 0; i < size; i++) {
      matrix[i] = [];
      for (let j = 0; j < size; j++) {
        matrix[i][j] = x.reduce((sum, xi) => sum + Math.pow(xi, i + j), 0);
      }
      rhs[i] = x.reduce((sum, xi, k) => sum + y[k] * Math.pow(xi, i), 0);
    }

    // Gaussian elimination
    for (let col = 0; col < size; col++) {
      // Partial pivoting
      let maxRow = col;
      for (let row = col + 1; row < size; row++) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[maxRow][col])) {
          maxRow = row;
        }
      }
      [matrix[col], matrix[maxRow]] = [matrix[maxRow], matrix[col]];
      [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];

      for (let row = col + 1; row < size; row++) {
        const factor = matrix[row][col] / matrix[col][col];
        for (let j = col; j < size; j++) {
          matrix[row][j] -= factor * matrix[col][j];
        }
        rhs[row] -= factor * rhs[col];
      }
    }

    // Back substitution
    const coeffs = new Array(size).fill(0);
    for (let i = size - 1; i >= 0; i--) {
      coeffs[i] = rhs[i];
      for (let j = i + 1; j < size; j++) {
        coeffs[i] -= matrix[i][j] * coeffs[j];
      }
      coeffs[i] /= matrix[i][i];
    }

    return coeffs;
  }

  /**
   * Clean up in-memory data for a station.
   */
  static cleanup(stationId: string): void {
    dropDatabase(stationId);
  }
}
