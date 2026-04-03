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
  min: number;
  max: number;
  p25: number;
  p75: number;
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
    const msg =
      err instanceof Error ? err.message : String(err);
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
    const msg =
      err instanceof Error ? err.message : String(err);
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

      // Fetch records and extract normalizedData
      const entityRecords = await repo.entityRecords.findByConnectorEntityId(
        entity.id
      );
      const rows = entityRecords
        .map((r: any) => r.normalizedData)
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
    const connectorInstanceRows = connectorInstanceIds.length > 0
      ? await db
          .select({
            id: connectorInstancesTable.id,
            name: connectorInstancesTable.name,
            status: connectorInstancesTable.status,
            connectorDefinitionId: connectorInstancesTable.connectorDefinitionId,
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
    const allColumnDefs = await repo.columnDefinitions.findByOrganizationId(organizationId);
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
    return records
      .map((r: any) => r.normalizedData)
      .filter(Boolean) as Record<string, unknown>[];
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
    vegaLiteSpec: VegaLiteSpecInput
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
      ? [...specData] as Data[]
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
  }): DescribeColumnResult {
    const values = this.extractNumericColumn(params.records, params.column);
    if (values.length === 0) {
      return {
        count: 0,
        mean: 0,
        median: 0,
        stddev: 0,
        min: 0,
        max: 0,
        p25: 0,
        p75: 0,
      };
    }

    return {
      count: values.length,
      mean: ss.mean(values),
      median: ss.median(values),
      stddev: ss.standardDeviation(values),
      min: ss.min(values),
      max: ss.max(values),
      p25: ss.quantile(values, 0.25),
      p75: ss.quantile(values, 0.75),
    };
  }

  /**
   * Pearson correlation between two numeric columns.
   */
  static correlate(params: {
    records: Record<string, unknown>[];
    columnA: string;
    columnB: string;
  }): { correlation: number } {
    const a = this.extractNumericColumn(params.records, params.columnA);
    const b = this.extractNumericColumn(params.records, params.columnB);

    if (a.length !== b.length || a.length < 2) {
      throw new Error(
        "Columns must have the same length and at least 2 values"
      );
    }

    return { correlation: ss.sampleCorrelation(a, b) };
  }

  /**
   * Detect outliers using IQR or Z-score method.
   */
  static detectOutliers(params: {
    records: Record<string, unknown>[];
    column: string;
    method: "iqr" | "zscore";
  }): { outliers: Record<string, unknown>[]; indices: number[] } {
    const values = this.extractNumericColumn(params.records, params.column);
    const indices: number[] = [];

    if (params.method === "iqr") {
      const q1 = ss.quantile(values, 0.25);
      const q3 = ss.quantile(values, 0.75);
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;

      values.forEach((v, i) => {
        if (v < lower || v > upper) indices.push(i);
      });
    } else {
      const m = ss.mean(values);
      const std = ss.standardDeviation(values);
      if (std === 0) return { outliers: [], indices: [] };

      values.forEach((v, i) => {
        if (Math.abs((v - m) / std) > 3) indices.push(i);
      });
    }

    return {
      outliers: indices.map((i) => params.records[i]),
      indices,
    };
  }

  /**
   * K-means clustering via ml-kmeans.
   */
  static cluster(params: {
    records: Record<string, unknown>[];
    columns: string[];
    k: number;
  }): { clusters: number[]; centroids: number[][] } {
    const data = params.records.map((r) =>
      params.columns.map((col) => {
        const v = Number(r[col]);
        if (isNaN(v))
          throw new Error(`Non-numeric value in column "${col}"`);
        return v;
      })
    );

    if (data.length === 0) {
      return { clusters: [], centroids: [] };
    }

    const result = kmeans(data, params.k, {});

    return {
      clusters: result.clusters,
      centroids: result.centroids.map((c: any) =>
        Array.isArray(c) ? c : c.centroid
      ),
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
    indicator: "SMA" | "EMA" | "RSI" | "MACD" | "BB" | "ATR" | "OBV";
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
        const high = sorted.map(
          (r) => Number(r[(extraParams.highColumn as string) ?? "high"])
        );
        const low = sorted.map(
          (r) => Number(r[(extraParams.lowColumn as string) ?? "low"])
        );
        const close = closePrices;
        values = ATR.calculate({ period, high, low, close });
        break;
      }
      case "OBV": {
        const close = closePrices;
        const volume = sorted.map(
          (r) => Number(r[(extraParams.volumeColumn as string) ?? "volume"])
        );
        values = OBV.calculate({ close, volume });
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
  static npv(params: {
    rate: number;
    cashFlows: number[];
  }): { npv: number } {
    return { npv: financial.npv(params.rate, params.cashFlows) };
  }

  /**
   * Internal rate of return via financial.
   */
  static irr(params: { cashFlows: number[] }): { irr: number } {
    return { irr: financial.irr(params.cashFlows) };
  }

  /**
   * Loan amortization schedule via financial.
   */
  static amortize(params: {
    principal: number;
    annualRate: number;
    periods: number;
  }): AmortizationRow[] {
    const { principal, annualRate, periods } = params;
    const monthlyRate = annualRate / 12;
    const payment = -financial.pmt(monthlyRate, periods, principal);
    const schedule: AmortizationRow[] = [];
    let balance = principal;

    for (let i = 1; i <= periods; i++) {
      const interest = balance * monthlyRate;
      const principalPart = payment - interest;
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
   * Sharpe ratio: (mean - riskFreeRate) / stddev.
   * If annualize is true, multiplies by √252 for daily data.
   */
  static sharpeRatio(params: {
    records: Record<string, unknown>[];
    valueColumn: string;
    riskFreeRate?: number;
    annualize?: boolean;
  }): { sharpeRatio: number } {
    const values = this.extractNumericColumn(params.records, params.valueColumn);
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

    let ratio = (meanReturn - rfr) / stdReturn;
    if (params.annualize) {
      ratio *= Math.sqrt(252);
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
  }): { maxDrawdown: number; peakDate: string | null; troughDate: string | null } {
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
        matrix[i][j] = x.reduce(
          (sum, xi) => sum + Math.pow(xi, i + j),
          0
        );
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
