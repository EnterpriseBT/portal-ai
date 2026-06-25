/**
 * Analytics Service — stateless service with static methods.
 *
 * Each method receives pre-loaded records and runs the analysis.
 * All methods are organized by pack — there is no distinction between
 * "core" and "curated" at the service layer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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

import { sql as drizzleSql } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";
import { VegaLiteSpecInput } from "../tools/visualize.tool.js";
import { PortalSqlService } from "./portal-sql.service.js";
import type { PortalSqlResponse } from "./portal-sql-response.util.js";
import { wideTableRepo } from "../db/repositories/wide-table.repository.js";
import { wideTableStatementCache } from "./wide-table-statement.cache.js";

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
  /** Wide-table connector_entity_id — needed by resolve_identity's
   * Postgres-direct path (phase 3 slice 3) to call `fetchProjectedRows`
   * without re-resolving the entity from its key. */
  connectorEntityId: string;
  /** Field-mapping normalized_key — the public identifier the LLM and
   * the wide table use for this column (`c_<linkNormalizedKey>`). */
  linkNormalizedKey: string;
  /** Column-definition key — historically the LLM-facing column name;
   * preserved here for the resolve_identity response shape. */
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

/** Human-facing direction of a signed quantity (#155). Consumers read this
 *  off the result instead of reconstructing direction from a number's sign. */
export type TrendDirection = "increasing" | "decreasing" | "flat";

/** Map a signed value to its direction, with a small dead-zone for "flat". */
function trendDirection(x: number): TrendDirection {
  const EPS = 1e-9;
  return x > EPS ? "increasing" : x < -EPS ? "decreasing" : "flat";
}

export interface RegressionResult {
  coefficients: number[];
  /** Per-coefficient direction of effect, parallel to `coefficients` (#155):
   *  positive → "increasing", negative → "decreasing", ~0 → "flat". Report
   *  the slope's direction from here rather than inferring it from the sign
   *  of the number. (Index 0 is the intercept.) */
  direction: TrendDirection[];
  rSquared: number;
  residuals: number[];
  standardErrors: number[];
  tStatistics: number[];
  pValues: number[];
  confidenceIntervals: { lower: number[]; upper: number[] };
}

export interface LogisticRegressionResult {
  coefficients: number[];
  probabilities: number[];
  logLoss: number;
  accuracy: number;
  iterations: number;
}

export interface ChangepointResult {
  changepoints: number[];
  changepointDates?: string[];
  segmentMeans: number[];
  segments: { start: number; end: number }[];
}

export interface DecomposeResult {
  dates: string[];
  observed: number[];
  trend: (number | null)[];
  seasonal: number[];
  residual: (number | null)[];
}

export interface ForecastResult {
  dates: string[];
  observed: number[];
  fitted: number[];
  forecast: {
    dates: string[];
    values: number[];
    lower: number[];
    upper: number[];
  };
  parameters: { alpha: number; beta: number; gamma: number };
  mape: number;
}

/**
 * Bounded-memory forecast result (#129 streaming fold). Identical to
 * {@link ForecastResult} except it omits the full-length `dates` / `observed`
 * / `fitted` arrays — the online fold never materializes the input series, so
 * those grow with N and cannot be returned for an unbounded source. The
 * agent-facing payload (the projected `forecast`, `parameters`, `mape`) is
 * computed exactly, byte-for-byte equivalent to the whole-array path. The
 * in-sample fit chart over a large series is a display concern handled by
 * aggregate-before-render, not by shipping N points back.
 */
export interface StreamForecastResult {
  forecast: {
    dates: string[];
    values: number[];
    lower: number[];
    upper: number[];
  };
  parameters: { alpha: number; beta: number; gamma: number };
  mape: number;
  /** Count of valid (numeric) observations folded — the recurrence length. */
  count: number;
}

export interface VarCvarResult {
  var: number;
  cvar: number;
  confidence: number;
  method: "historical" | "parametric";
  tailCount?: number;
}

export interface PortfolioMetricsResult {
  totalReturn: number;
  cagr: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  beta?: number;
  alpha?: number;
  informationRatio?: number;
  trackingError?: number;
  upCapture?: number;
  downCapture?: number;
}

export type BondMathResult =
  | { price: number }
  | { yield: number; iterations: number }
  | { macaulayDuration: number; modifiedDuration: number }
  | { convexity: number };

export interface TrendResult {
  dates: string[];
  values: number[];
  trendLine: { slope: number; intercept: number };
  forecast?: { dates: string[]; values: number[] };
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

export interface DepreciationRow {
  period: number;
  depreciation: number;
  accumulated: number;
  bookValue: number;
}

export type DepreciationResult =
  | { schedule: DepreciationRow[] }
  | { row: DepreciationRow };

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
   * loads entities with field mappings + column definitions, and
   * discovers entity groups. Returns metadata only — records live on
   * the phase-2 wide tables and are pulled per-call by `sqlQuery` /
   * the math tool wrappers / `resolveIdentity`.
   */
  static async loadStation(
    stationId: string,
    organizationId: string
  ): Promise<StationData> {
    logger.info({ stationId, organizationId }, "Loading station metadata");

    const repo = DbService.repository;

    // 1. Resolve station instances → connector instance IDs
    const stationInstances =
      await repo.stationInstances.findByStationId(stationId);
    const connectorInstanceIds = stationInstances.map(
      (si) => si.connectorInstanceId
    );

    if (connectorInstanceIds.length === 0) {
      logger.warn({ stationId }, "Station has no connector instances");
      return { entities: [], entityGroups: [] };
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

    // 4. Build typed schema catalog
    const entities: EntitySchema[] = [];
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
    }

    // 5. Entity Group discovery
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
      "Station metadata loaded"
    );

    return { entities, entityGroups };
  }

  // -------------------------------------------------------------------------
  // Cache surface — DELETED in Phase 3 slice 5.
  //
  // The 17 `apply*` methods + their `cache*` helpers existed to keep an
  // in-memory AlaSQL station database coherent with each mutation tool's
  // Postgres write. After slice 2 wired sql_query / visualize directly to
  // Postgres and slice 3 routed every math tool through a direct Postgres
  // row fetch, nothing read from the in-memory cache; the methods became
  // dead weight. (#114 later made the math tools pure — they now receive
  // rows as input rather than reading at all.) Mutation tools rely on
  // Postgres' own read-after-write semantics now.
  // -------------------------------------------------------------------------


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
          connectorEntityId: m.connectorEntityId,
          // Field-mapping `normalizedKey` is the wide-table column id; fall
          // back to the column-definition key when the field-mapping side
          // hasn't been populated (typical when `include: fieldMapping`
          // misses).
          linkNormalizedKey:
            m.fieldMapping?.normalizedKey ?? m.columnDefinition?.key ?? "",
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
  // -----------------------------------------------------------------------
  // Pack: data_query
  // -----------------------------------------------------------------------

  /**
   * Execute a SQL query through the Phase 3 Postgres-direct pipeline.
   *
   * Delegates to `PortalSqlService.runSqlQuery` which: validates the
   * SQL against the deny-list, optionally wraps with an implicit
   * `LIMIT`, opens a `READ ONLY` transaction, materialises the
   * station's per-call temp view set, executes, and emits the
   * truncation envelope.
   *
   * The legacy AlaSQL execution path is still preloaded by
   * `loadStation` (slice 5 deletes it) but is no longer read here.
   */
  static async sqlQuery(params: {
    sql: string;
    stationId: string;
    organizationId: string;
    rowCap?: number;
    cellCap?: number;
    payloadCap?: number;
  }): Promise<PortalSqlResponse> {
    logger.info(
      { stationId: params.stationId, sql: params.sql },
      "Executing portal sql_query against Postgres"
    );
    return PortalSqlService.runSqlQuery(params);
  }

  /**
   * Run SQL then inject rows into a Vega-Lite spec. Pulls rows from
   * the Postgres-direct `sqlQuery` envelope; payload-cap collapses
   * (no `rows` field) result in an empty `values` array, which the
   * visualize layer then renders as an empty chart.
   */
  static async visualize(params: {
    sql: string;
    vegaLiteSpec: VegaLiteSpecInput;
    stationId: string;
    organizationId: string;
  }): Promise<VegaLiteSpec> {
    const { sql, vegaLiteSpec, stationId, organizationId } = params;
    const response = await this.sqlQuery({ sql, stationId, organizationId });
    const rows = "rows" in response ? response.rows : [];
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
    organizationId: string;
  }): Promise<VegaSpec> {
    const { sql, vegaSpec, stationId, organizationId } = params;
    const response = await this.sqlQuery({ sql, stationId, organizationId });
    const rows = "rows" in response ? response.rows : [];
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
  static async resolveIdentity(params: {
    entityGroupName: string;
    linkValue: string;
    organizationId: string;
    entityGroups: EntityGroupContext[];
  }): Promise<ResolveIdentityResult> {
    const { entityGroupName, linkValue, organizationId, entityGroups } = params;

    const group = entityGroups.find((g) => g.name === entityGroupName);
    if (!group) {
      throw new Error(`Entity group not found: ${entityGroupName}`);
    }

    const matches: ResolveIdentityResult["matches"] = [];

    for (const member of group.members) {
      try {
        // Resolve the link column to its `c_<column_name>` so we can
        // filter the wide-table row by value, then ask for every live
        // normalizedKey on that entity so the matched record contains
        // the same field set the LLM was already seeing under AlaSQL.
        const stmt = await wideTableStatementCache.get(member.connectorEntityId);
        const cachedCol = stmt.columns.find(
          (c) => c.normalizedKey === member.linkNormalizedKey
        );
        if (!cachedCol) {
          matches.push({
            entityKey: member.entityKey,
            isPrimary: member.isPrimary,
            records: [],
          });
          continue;
        }
        const projectedKeys = stmt.columns.map((c) => c.normalizedKey);
        const rows = await wideTableRepo.fetchProjectedRows(
          member.connectorEntityId,
          projectedKeys,
          {
            organizationId,
            where: drizzleSql`w.${drizzleSql.raw(`"${cachedCol.columnName}"`)} = ${String(linkValue)}`,
          }
        );
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
   * Linear, multivariate-linear, or polynomial regression via OLS.
   * Returns coefficients, R-squared, residuals, standard errors,
   * t-statistics, p-values, and confidence intervals on each coefficient.
   */
  static regression(params: {
    records: Record<string, unknown>[];
    x?: string;
    xColumns?: string[];
    y: string;
    type: "linear" | "polynomial";
    degree?: number;
    confidence?: number;
  }): RegressionResult {
    const { type } = params;

    const hasX = params.x !== undefined;
    const hasXCols = params.xColumns !== undefined;
    if (hasX && hasXCols) {
      throw new Error("specify either x or xColumns, not both");
    }
    if (type === "polynomial" && hasXCols) {
      throw new Error("multivariate polynomial regression is not supported");
    }
    if (!hasX && !hasXCols) {
      throw new Error("specify either x or xColumns");
    }

    const yVals = this.extractNumericColumn(params.records, params.y);
    const n = yVals.length;

    let X: number[][];
    if (type === "polynomial") {
      const degree = params.degree ?? 2;
      const xVals = this.extractNumericColumn(params.records, params.x!);
      if (xVals.length !== n || n < 2) {
        throw new Error(
          "Columns must have the same length and at least 2 values"
        );
      }
      X = xVals.map((xi) =>
        Array.from({ length: degree + 1 }, (_, j) => Math.pow(xi, j))
      );
    } else if (hasXCols) {
      const cols = params.xColumns!.map((c) =>
        this.extractNumericColumn(params.records, c)
      );
      for (const col of cols) {
        if (col.length !== n) {
          throw new Error(
            "Columns must have the same length and at least 2 values"
          );
        }
      }
      X = Array.from({ length: n }, (_, i) => [
        1,
        ...cols.map((col) => col[i]),
      ]);
    } else {
      const xVals = this.extractNumericColumn(params.records, params.x!);
      if (xVals.length !== n || n < 2) {
        throw new Error(
          "Columns must have the same length and at least 2 values"
        );
      }
      X = xVals.map((xi) => [1, xi]);
    }

    const { coefficients, xtxInverse, residuals } = this.solveOLS(X, yVals);

    const k = coefficients.length;
    const dfResid = n - k;
    if (dfResid <= 0) {
      throw new Error(
        `Need at least ${k + 1} rows for the regression; got ${n}`
      );
    }

    const ssr = residuals.reduce((sum, r) => sum + r * r, 0);
    const yMean = ss.mean(yVals);
    const sst = yVals.reduce((s, v) => s + (v - yMean) * (v - yMean), 0);
    const rSquared = sst === 0 ? 1 : 1 - ssr / sst;
    const sigmaSquared = ssr / dfResid;

    const standardErrors = coefficients.map((_, i) =>
      Math.sqrt(Math.max(0, sigmaSquared * xtxInverse[i][i]))
    );
    const tStatistics = coefficients.map((c, i) =>
      standardErrors[i] === 0
        ? c === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : c / standardErrors[i]
    );
    const pValues = tStatistics.map((t) =>
      Number.isFinite(t) ? this.tTwoTailedPValue(t, dfResid) : 0
    );
    const alpha = 1 - (params.confidence ?? 0.95);
    const tCrit = this.tInverseCDF(1 - alpha / 2, dfResid);
    const confidenceIntervals = {
      lower: coefficients.map((c, i) => c - tCrit * standardErrors[i]),
      upper: coefficients.map((c, i) => c + tCrit * standardErrors[i]),
    };

    return {
      coefficients,
      direction: coefficients.map(trendDirection),
      rSquared,
      residuals,
      standardErrors,
      tStatistics,
      pValues,
      confidenceIntervals,
    };
  }

  /**
   * Binary logistic regression via IRLS (iteratively reweighted least
   * squares). Returns coefficients (intercept first), per-row predicted
   * probabilities, log-loss, accuracy at threshold 0.5, and iteration count.
   */
  static logisticRegression(params: {
    records: Record<string, unknown>[];
    x?: string;
    xColumns?: string[];
    y: string;
    maxIterations?: number;
  }): LogisticRegressionResult {
    const hasX = params.x !== undefined;
    const hasXCols = params.xColumns !== undefined;
    if (hasX && hasXCols) {
      throw new Error("specify either x or xColumns, not both");
    }
    if (!hasX && !hasXCols) {
      throw new Error("specify either x or xColumns");
    }

    // Coerce y to 0/1 (booleans accepted)
    const yRaw = params.records.map((r) => r[params.y]);
    const y: number[] = yRaw.map((v) => {
      if (v === true || v === 1) return 1;
      if (v === false || v === 0) return 0;
      const n = Number(v);
      if (n === 0 || n === 1) return n;
      throw new Error(`y values must be 0 or 1; got ${String(v)}`);
    });
    if (!y.includes(0) || !y.includes(1)) {
      throw new Error("y must contain at least one of each class");
    }

    // Build X with intercept column
    const n = y.length;
    let X: number[][];
    if (hasXCols) {
      const cols = params.xColumns!.map((c) =>
        this.extractNumericColumn(params.records, c)
      );
      for (const col of cols) {
        if (col.length !== n) {
          throw new Error(
            "Columns must have the same length and at least 2 values"
          );
        }
      }
      X = Array.from({ length: n }, (_, i) => [
        1,
        ...cols.map((col) => col[i]),
      ]);
    } else {
      const xVals = this.extractNumericColumn(params.records, params.x!);
      if (xVals.length !== n) {
        throw new Error(
          "Columns must have the same length and at least 2 values"
        );
      }
      X = xVals.map((xi) => [1, xi]);
    }

    const k = X[0].length;
    if (n < k + 1) {
      throw new Error(
        `Need at least ${k + 1} rows for the regression; got ${n}`
      );
    }

    const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
    const maxIter = params.maxIterations ?? 100;
    let beta = new Array(k).fill(0);
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations = iter + 1;
      const eta = X.map((row) =>
        row.reduce((s, xi, i) => s + xi * beta[i], 0)
      );
      const p = eta.map(sigmoid);
      const w = p.map((pi) => pi * (1 - pi));
      // Adjusted-response z_i = η_i + (y_i - p_i) / w_i (clamped)
      const z = eta.map((etaI, i) => {
        const wi = Math.max(w[i], 1e-12);
        return etaI + (y[i] - p[i]) / wi;
      });
      // Weighted normal equations via √W-scaling: solveOLS on (Xw, zw)
      const sqrtW = w.map((wi) => Math.sqrt(Math.max(wi, 1e-12)));
      const Xw = X.map((row, i) => row.map((v) => v * sqrtW[i]));
      const yw = z.map((zi, i) => zi * sqrtW[i]);
      const { coefficients: betaNew } = this.solveOLS(Xw, yw);

      const delta = Math.max(
        ...betaNew.map((b, i) => Math.abs(b - beta[i]))
      );
      beta = betaNew;
      if (delta < 1e-10) break;
    }

    const probabilities = X.map((row) =>
      sigmoid(row.reduce((s, xi, i) => s + xi * beta[i], 0))
    );
    const clipped = probabilities.map((pi) =>
      Math.max(1e-15, Math.min(1 - 1e-15, pi))
    );
    let lossSum = 0;
    for (let i = 0; i < n; i++) {
      lossSum +=
        y[i] * Math.log(clipped[i]) +
        (1 - y[i]) * Math.log(1 - clipped[i]);
    }
    const logLoss = -lossSum / n;
    let correct = 0;
    for (let i = 0; i < n; i++) {
      const pred = probabilities[i] >= 0.5 ? 1 : 0;
      if (pred === y[i]) correct += 1;
    }
    const accuracy = correct / n;

    return {
      coefficients: beta,
      probabilities,
      logLoss,
      accuracy,
      iterations,
    };
  }

  /**
   * Time-series aggregation via Arquero + linear trend line.
   */
  static trend(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    interval: "day" | "week" | "month" | "quarter" | "year";
    forecastPeriods?: number;
  }): TrendResult {
    const { records, dateColumn, valueColumn, interval } = params;

    if (records.length === 0) {
      const result: TrendResult = {
        dates: [],
        values: [],
        trendLine: { slope: 0, intercept: 0 },
      };
      if (params.forecastPeriods !== undefined) {
        result.forecast = { dates: [], values: [] };
      }
      return result;
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

    const result: TrendResult = {
      dates,
      values,
      trendLine: { slope: lr.m, intercept: lr.b },
    };

    if (params.forecastPeriods !== undefined && params.forecastPeriods > 0) {
      const fcDates: string[] = [];
      const fcValues: number[] = [];
      const lastBucket = dates[dates.length - 1];
      const n = values.length;
      for (let i = 1; i <= params.forecastPeriods; i++) {
        fcDates.push(this.stepBucket(lastBucket, interval, i));
        fcValues.push(lr.b + lr.m * (n + i - 1));
      }
      result.forecast = { dates: fcDates, values: fcValues };
    }

    return result;
  }

  /**
   * Holt-Winters exponential smoothing with optional trend and seasonality.
   * Returns in-sample fits, multi-step point forecasts, Gaussian-residual
   * prediction intervals, and MAPE.
   */
  static forecast(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    horizon: number;
    seasonalPeriod?: number;
    seasonality?: "none" | "additive" | "multiplicative";
    trend?: "none" | "additive";
    alpha?: number;
    beta?: number;
    gamma?: number;
    confidence?: number;
  }): ForecastResult {
    const sorted = [...params.records].sort(
      (a, b) =>
        new Date(a[params.dateColumn] as string).getTime() -
        new Date(b[params.dateColumn] as string).getTime()
    );
    const dates = sorted.map((r) => String(r[params.dateColumn]));
    const observed = this.extractNumericColumn(sorted, params.valueColumn);
    const n = observed.length;
    const seasonality = params.seasonality ?? "none";
    const trendType = params.trend ?? "additive";
    const m = seasonality !== "none" ? params.seasonalPeriod : undefined;
    const alpha = params.alpha ?? 0.5;
    const beta = params.beta ?? 0.1;
    const gamma = params.gamma ?? 0.1;

    if (seasonality !== "none") {
      if (!m || m < 2) {
        throw new Error(
          "seasonalPeriod is required (≥ 2) when seasonality is not 'none'"
        );
      }
      if (n < 2 * m) {
        throw new Error(
          `Forecasting with seasonality requires at least 2 full seasons (need ${2 * m} rows, got ${n})`
        );
      }
      if (seasonality === "multiplicative" && observed.some((v) => v <= 0)) {
        throw new Error(
          "multiplicative seasonality requires positive observations"
        );
      }
    } else if (n < 4) {
      throw new Error(
        `Forecasting requires at least 4 observations; got ${n}`
      );
    }

    // Initialize level / trend / seasonal
    let level = m
      ? observed.slice(0, m).reduce((s, v) => s + v, 0) / m
      : observed[0];
    let trendComp = 0;
    if (trendType === "additive") {
      if (m) {
        const meanA =
          observed.slice(0, m).reduce((s, v) => s + v, 0) / m;
        const meanB =
          observed.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m;
        trendComp = (meanB - meanA) / m;
      } else {
        trendComp = observed[1] - observed[0];
      }
    }
    const seasonal: number[] =
      m && seasonality !== "none"
        ? observed.slice(0, m).map((v) =>
            seasonality === "additive" ? v - level : v / level
          )
        : [];

    // In-sample fit
    const fitted: number[] = new Array(n).fill(0);
    for (let t = 0; t < n; t++) {
      const seasonalIdx = m ? t % m : 0;
      const sPrev = m
        ? seasonal[seasonalIdx]
        : seasonality === "multiplicative"
          ? 1
          : 0;

      // 1-step-ahead fit using state at t-1
      fitted[t] =
        seasonality === "multiplicative"
          ? (level + (trendType === "additive" ? trendComp : 0)) * sPrev
          : level + (trendType === "additive" ? trendComp : 0) + sPrev;

      // Update state
      const yt = observed[t];
      const lvlBefore = level;
      const trendBefore = trendComp;
      if (seasonality === "additive") {
        level =
          alpha * (yt - sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
      } else if (seasonality === "multiplicative") {
        level =
          alpha * (yt / sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
      } else {
        level = alpha * yt + (1 - alpha) * (lvlBefore + trendBefore);
      }
      if (trendType === "additive") {
        trendComp = beta * (level - lvlBefore) + (1 - beta) * trendBefore;
      }
      if (m && seasonality !== "none") {
        const newSeason =
          seasonality === "additive"
            ? gamma * (yt - lvlBefore - trendBefore) + (1 - gamma) * sPrev
            : gamma * (yt / (lvlBefore + trendBefore)) + (1 - gamma) * sPrev;
        seasonal[seasonalIdx] = newSeason;
      }
    }

    // Forecast horizon steps using final state
    const fcValues: number[] = [];
    for (let h = 1; h <= params.horizon; h++) {
      const seasonalIdx = m ? (n - 1 + h) % m : 0;
      const sFwd = m
        ? seasonal[seasonalIdx]
        : seasonality === "multiplicative"
          ? 1
          : 0;
      const point =
        seasonality === "multiplicative"
          ? (level + (trendType === "additive" ? h * trendComp : 0)) * sFwd
          : level + (trendType === "additive" ? h * trendComp : 0) + sFwd;
      fcValues.push(point);
    }

    // Forecast dates: infer median spacing from the input series.
    let fcDates: string[] = [];
    if (n >= 2) {
      const t0 = new Date(dates[dates.length - 2]).getTime();
      const t1 = new Date(dates[dates.length - 1]).getTime();
      const spacing = t1 - t0;
      for (let h = 1; h <= params.horizon; h++) {
        fcDates.push(
          new Date(t1 + spacing * h).toISOString()
        );
      }
    } else {
      fcDates = Array.from({ length: params.horizon }, (_, i) => `+${i + 1}`);
    }

    // Prediction intervals via Gaussian-residual approximation
    const warmup = m ?? 1;
    const residuals: number[] = [];
    for (let t = warmup; t < n; t++) {
      residuals.push(observed[t] - fitted[t]);
    }
    const sigmaHat =
      residuals.length > 1 ? ss.standardDeviation(residuals) : 0;
    const conf = params.confidence ?? 0.95;
    // Use tInverseCDF with large df to approximate the standard-normal quantile
    const z = this.tInverseCDF(1 - (1 - conf) / 2, 1000);
    const lower = fcValues.map((v, i) => v - z * sigmaHat * Math.sqrt(i + 1));
    const upper = fcValues.map((v, i) => v + z * sigmaHat * Math.sqrt(i + 1));

    // MAPE on post-warmup window
    let mapeSum = 0;
    let mapeCount = 0;
    for (let t = warmup; t < n; t++) {
      if (observed[t] !== 0) {
        mapeSum += Math.abs((observed[t] - fitted[t]) / observed[t]);
        mapeCount += 1;
      }
    }
    const mape = mapeCount > 0 ? (100 * mapeSum) / mapeCount : 0;

    return {
      dates,
      observed,
      fitted,
      forecast: { dates: fcDates, values: fcValues, lower, upper },
      parameters: { alpha, beta, gamma },
      mape,
    };
  }

  /**
   * Streaming Holt-Winters fold (#129) — the bounded-memory equivalent of
   * {@link forecast} over a record stream already ordered by `dateColumn`
   * (the cursor's `(orderBy, id)` keyset guarantees this). It maintains O(m)
   * state: a `2·seasonalPeriod` (or 2, non-seasonal) init buffer, the
   * `seasonal[]` ring, online residual sum/sum-sq for the prediction-interval
   * σ, online MAPE accumulators, and a 2-element date buffer for forecast
   * spacing. It never holds the full series, so it returns a
   * {@link StreamForecastResult} (no `dates`/`observed`/`fitted` arrays).
   *
   * The math mirrors `forecast` step-for-step — same init, same 1-step-ahead
   * recurrence, same post-warmup residual/MAPE windows, same Gaussian-residual
   * intervals — so the projected `forecast`, `parameters`, and `mape` match the
   * whole-array path on any series the in-memory tier could also handle.
   *
   * Faithfulness notes vs. `forecast`:
   *  - `observed` counts only numeric values (mirrors `extractNumericColumn`);
   *    non-numeric rows are skipped but still advance the date buffer, because
   *    the whole-array path derives forecast spacing from the last two *records*
   *    (`dates[len-2..]`), not the last two valid observations.
   *  - σ uses the one-pass population variance (`E[r²] − E[r]²`); for
   *    well-conditioned series this equals `ss.standardDeviation` to many
   *    decimals. (Tied timestamps may order differently than the in-memory
   *    `Array.sort`, since the cursor breaks ties on `_record_id` — forecasting
   *    assumes a strictly increasing time index, so this is a non-issue.)
   */
  static async forecastFromStream(
    batches: AsyncIterable<Record<string, unknown>[]>,
    params: {
      dateColumn: string;
      valueColumn: string;
      horizon: number;
      seasonalPeriod?: number;
      seasonality?: "none" | "additive" | "multiplicative";
      trend?: "none" | "additive";
      alpha?: number;
      beta?: number;
      gamma?: number;
      confidence?: number;
    }
  ): Promise<StreamForecastResult> {
    const seasonality = params.seasonality ?? "none";
    const trendType = params.trend ?? "additive";
    const m = seasonality !== "none" ? params.seasonalPeriod : undefined;
    const alpha = params.alpha ?? 0.5;
    const beta = params.beta ?? 0.1;
    const gamma = params.gamma ?? 0.1;

    if (seasonality !== "none" && (!m || m < 2)) {
      throw new Error(
        "seasonalPeriod is required (≥ 2) when seasonality is not 'none'"
      );
    }

    const warmup = m ?? 1;
    const initN = m ? 2 * m : 2; // observations buffered before init can run

    // O(m) state, set once the init buffer fills.
    let level = 0;
    let trendComp = 0;
    let seasonal: number[] = [];
    let initialized = false;
    const initBuf: number[] = [];

    let validCount = 0; // numeric observations folded (= recurrence length)
    // Last two *record* dates (all rows), for forecast-date spacing.
    let prevDate: string | undefined;
    let lastDate: string | undefined;
    // Post-warmup residual + MAPE accumulators.
    let residSum = 0;
    let residSumSq = 0;
    let residCount = 0;
    let mapeSum = 0;
    let mapeCount = 0;

    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

    const initState = () => {
      level = m ? mean(initBuf.slice(0, m)) : initBuf[0];
      trendComp = 0;
      if (trendType === "additive") {
        trendComp = m
          ? (mean(initBuf.slice(m, 2 * m)) - mean(initBuf.slice(0, m))) / m
          : initBuf[1] - initBuf[0];
      }
      seasonal =
        m && seasonality !== "none"
          ? initBuf
              .slice(0, m)
              .map((v) => (seasonality === "additive" ? v - level : v / level))
          : [];
    };

    // One 1-step-ahead fit + state update for observation at recurrence
    // index `t`. Mirrors the body of `forecast`'s in-sample loop exactly.
    const step = (yt: number, t: number) => {
      const seasonalIdx = m ? t % m : 0;
      const sPrev = m
        ? seasonal[seasonalIdx]
        : seasonality === "multiplicative"
          ? 1
          : 0;

      const fitted =
        seasonality === "multiplicative"
          ? (level + (trendType === "additive" ? trendComp : 0)) * sPrev
          : level + (trendType === "additive" ? trendComp : 0) + sPrev;

      if (t >= warmup) {
        const r = yt - fitted;
        residSum += r;
        residSumSq += r * r;
        residCount += 1;
        if (yt !== 0) {
          mapeSum += Math.abs(r / yt);
          mapeCount += 1;
        }
      }

      const lvlBefore = level;
      const trendBefore = trendComp;
      if (seasonality === "additive") {
        level = alpha * (yt - sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
      } else if (seasonality === "multiplicative") {
        level = alpha * (yt / sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
      } else {
        level = alpha * yt + (1 - alpha) * (lvlBefore + trendBefore);
      }
      if (trendType === "additive") {
        trendComp = beta * (level - lvlBefore) + (1 - beta) * trendBefore;
      }
      if (m && seasonality !== "none") {
        seasonal[seasonalIdx] =
          seasonality === "additive"
            ? gamma * (yt - lvlBefore - trendBefore) + (1 - gamma) * sPrev
            : gamma * (yt / (lvlBefore + trendBefore)) + (1 - gamma) * sPrev;
      }
    };

    for await (const batch of batches) {
      for (const rec of batch) {
        // Every record advances the date buffer (matches whole-array `dates`).
        prevDate = lastDate;
        lastDate = String(rec[params.dateColumn]);

        // Numeric extraction — identical predicate to extractNumericColumn.
        const raw = rec[params.valueColumn];
        const v = Number(raw);
        if (isNaN(v) || raw === null || raw === undefined) continue;
        if (seasonality === "multiplicative" && v <= 0) {
          throw new Error(
            "multiplicative seasonality requires positive observations"
          );
        }

        if (!initialized) {
          initBuf.push(v);
          validCount = initBuf.length;
          if (initBuf.length === initN) {
            initState();
            initialized = true;
            for (let t = 0; t < initBuf.length; t++) step(initBuf[t], t);
          }
          continue;
        }
        step(v, validCount);
        validCount += 1;
      }
    }

    const n = validCount;
    if (seasonality !== "none") {
      if (n < 2 * (m as number)) {
        throw new Error(
          `Forecasting with seasonality requires at least 2 full seasons (need ${2 * (m as number)} rows, got ${n})`
        );
      }
    } else if (n < 4) {
      throw new Error(`Forecasting requires at least 4 observations; got ${n}`);
    }

    // Project horizon from the final state (identical to `forecast`).
    const fcValues: number[] = [];
    for (let h = 1; h <= params.horizon; h++) {
      const seasonalIdx = m ? (n - 1 + h) % m : 0;
      const sFwd = m
        ? seasonal[seasonalIdx]
        : seasonality === "multiplicative"
          ? 1
          : 0;
      const point =
        seasonality === "multiplicative"
          ? (level + (trendType === "additive" ? h * trendComp : 0)) * sFwd
          : level + (trendType === "additive" ? h * trendComp : 0) + sFwd;
      fcValues.push(point);
    }

    // Forecast dates from the last two record dates' spacing.
    let fcDates: string[] = [];
    if (n >= 2 && prevDate !== undefined && lastDate !== undefined) {
      const t0 = new Date(prevDate).getTime();
      const t1 = new Date(lastDate).getTime();
      const spacing = t1 - t0;
      for (let h = 1; h <= params.horizon; h++) {
        fcDates.push(new Date(t1 + spacing * h).toISOString());
      }
    } else {
      fcDates = Array.from({ length: params.horizon }, (_, i) => `+${i + 1}`);
    }

    // Prediction intervals — one-pass population σ over post-warmup residuals.
    let sigmaHat = 0;
    if (residCount > 1) {
      const rMean = residSum / residCount;
      const variance = residSumSq / residCount - rMean * rMean;
      sigmaHat = Math.sqrt(Math.max(0, variance));
    }
    const conf = params.confidence ?? 0.95;
    const z = this.tInverseCDF(1 - (1 - conf) / 2, 1000);
    const lower = fcValues.map((val, i) => val - z * sigmaHat * Math.sqrt(i + 1));
    const upper = fcValues.map((val, i) => val + z * sigmaHat * Math.sqrt(i + 1));

    const mape = mapeCount > 0 ? (100 * mapeSum) / mapeCount : 0;

    return {
      forecast: { dates: fcDates, values: fcValues, lower, upper },
      parameters: { alpha, beta, gamma },
      mape,
      count: n,
    };
  }

  /**
   * Classical seasonal decomposition (additive or multiplicative).
   * Trend via centered moving average; seasonal via per-position averaging
   * of the detrended series; residual = observed − trend − seasonal
   * (additive) or observed / (trend × seasonal) (multiplicative).
   * Edge values of `trend` and `residual` are `null` where the centered
   * MA cannot be computed.
   */
  static decompose(params: {
    records: Record<string, unknown>[];
    dateColumn: string;
    valueColumn: string;
    seasonalPeriod: number;
    seasonality?: "additive" | "multiplicative";
  }): DecomposeResult {
    const sorted = [...params.records].sort(
      (a, b) =>
        new Date(a[params.dateColumn] as string).getTime() -
        new Date(b[params.dateColumn] as string).getTime()
    );
    const dates = sorted.map((r) => String(r[params.dateColumn]));
    const observed = this.extractNumericColumn(sorted, params.valueColumn);
    const n = observed.length;
    const m = params.seasonalPeriod;
    const seasonality = params.seasonality ?? "additive";

    if (n < 2 * m) {
      throw new Error(
        `Decomposition requires at least 2 full seasons (need ${2 * m} rows, got ${n})`
      );
    }
    if (seasonality === "multiplicative" && observed.some((v) => v <= 0)) {
      throw new Error(
        "multiplicative decomposition requires positive observations"
      );
    }

    // Centered moving average for the trend
    const trend: (number | null)[] = new Array(n).fill(null);
    const halfWindow = Math.floor(m / 2);
    const isEven = m % 2 === 0;
    if (isEven) {
      // 2-by-m MA: average of two adjacent m-MAs centered at i-0.5 and i+0.5
      for (let i = halfWindow; i <= n - halfWindow - 1; i++) {
        let sum1 = 0;
        for (let j = i - halfWindow; j < i - halfWindow + m; j++) {
          sum1 += observed[j];
        }
        let sum2 = 0;
        for (let j = i - halfWindow + 1; j < i - halfWindow + 1 + m; j++) {
          sum2 += observed[j];
        }
        trend[i] = (sum1 / m + sum2 / m) / 2;
      }
    } else {
      for (let i = halfWindow; i < n - halfWindow; i++) {
        let sum = 0;
        for (let j = i - halfWindow; j <= i + halfWindow; j++) {
          sum += observed[j];
        }
        trend[i] = sum / m;
      }
    }

    // Detrended series → per-position seasonal averages
    const detrended: (number | null)[] = observed.map((v, i) =>
      trend[i] === null
        ? null
        : seasonality === "additive"
          ? v - (trend[i] as number)
          : v / (trend[i] as number)
    );

    const seasonalAverages = new Array(m).fill(0);
    const seasonalCounts = new Array(m).fill(0);
    for (let i = 0; i < n; i++) {
      if (detrended[i] !== null) {
        seasonalAverages[i % m] += detrended[i] as number;
        seasonalCounts[i % m] += 1;
      }
    }
    for (let p = 0; p < m; p++) {
      if (seasonalCounts[p] > 0) {
        seasonalAverages[p] /= seasonalCounts[p];
      }
    }

    // Center the seasonal component: additive sums to 0; multiplicative
    // averages to 1.
    const meanSeasonal =
      seasonalAverages.reduce((s, v) => s + v, 0) / m;
    const seasonal: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      seasonal[i] =
        seasonality === "additive"
          ? seasonalAverages[i % m] - meanSeasonal
          : seasonalAverages[i % m] / meanSeasonal;
    }

    // Residual
    const residual: (number | null)[] = observed.map((v, i) => {
      if (trend[i] === null) return null;
      return seasonality === "additive"
        ? v - (trend[i] as number) - seasonal[i]
        : v / ((trend[i] as number) * seasonal[i]);
    });

    return { dates, observed, trend, seasonal, residual };
  }

  /**
   * Mean-shift changepoint detection via CUSUM on the standardized series.
   * Single-pass, deterministic, returns indices of detected breaks plus
   * per-segment means.
   */
  static changepoint(params: {
    records: Record<string, unknown>[];
    dateColumn?: string;
    valueColumn: string;
    threshold?: number;
    minSegmentLength?: number;
  }): ChangepointResult {
    const sorted = params.dateColumn
      ? [...params.records].sort(
          (a, b) =>
            new Date(a[params.dateColumn!] as string).getTime() -
            new Date(b[params.dateColumn!] as string).getTime()
        )
      : [...params.records];

    const values = this.extractNumericColumn(sorted, params.valueColumn);
    const n = values.length;
    const threshold = params.threshold ?? 5;
    const minSeg =
      params.minSegmentLength ?? Math.max(5, Math.ceil(n / 20));

    if (n === 0) {
      return { changepoints: [], segmentMeans: [], segments: [] };
    }

    if (n < 2 * minSeg) {
      return {
        changepoints: [],
        segmentMeans: [ss.mean(values)],
        segments: [{ start: 0, end: n - 1 }],
      };
    }

    const sigma = ss.standardDeviation(values);
    if (sigma === 0) {
      const result: ChangepointResult = {
        changepoints: [],
        segmentMeans: [ss.mean(values)],
        segments: [{ start: 0, end: n - 1 }],
      };
      if (params.dateColumn) result.changepointDates = [];
      return result;
    }

    // CUSUM with segment-local baseline. Initialize the baseline to the
    // first window's mean so the first segment's CUSUM doesn't accumulate
    // against the global mean (which would falsely flag the start).
    const k = 0.5;
    const changepoints: number[] = [];
    let segmentMean = ss.mean(values.slice(0, Math.min(minSeg, n)));
    let sPos = 0;
    let sNeg = 0;
    let i = 0;
    while (i < n) {
      const z = (values[i] - segmentMean) / sigma;
      sPos = Math.max(0, sPos + z - k);
      sNeg = Math.min(0, sNeg + z + k);
      if (sPos > threshold || -sNeg > threshold) {
        changepoints.push(i);
        sPos = 0;
        sNeg = 0;
        // Re-baseline to the new segment's leading window mean
        const winEnd = Math.min(i + minSeg, n);
        segmentMean = ss.mean(values.slice(i, winEnd));
        i += minSeg;
      } else {
        i += 1;
      }
    }

    const boundaries = [0, ...changepoints, n];
    const segments: { start: number; end: number }[] = [];
    const segmentMeans: number[] = [];
    for (let s = 0; s < boundaries.length - 1; s++) {
      const start = boundaries[s];
      const end = boundaries[s + 1] - 1;
      segments.push({ start, end });
      segmentMeans.push(ss.mean(values.slice(start, end + 1)));
    }

    const result: ChangepointResult = {
      changepoints,
      segmentMeans,
      segments,
    };
    if (params.dateColumn) {
      result.changepointDates = changepoints.map((idx) =>
        String(sorted[idx][params.dateColumn!])
      );
    }
    return result;
  }

  /**
   * Increment a trend bucket label by `n` periods at the given interval.
   * Mirrors the date-stringification logic in `trend(...)` so forecast
   * dates render in the same shape as observed bucket labels.
   */
  private static stepBucket(
    last: string,
    interval: "day" | "week" | "month" | "quarter" | "year",
    n: number
  ): string {
    switch (interval) {
      case "day": {
        const d = new Date(`${last}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      }
      case "week": {
        const d = new Date(`${last}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n * 7);
        return d.toISOString().slice(0, 10);
      }
      case "month": {
        const [yStr, mStr] = last.split("-");
        const yearStart = parseInt(yStr, 10);
        const monthStart = parseInt(mStr, 10); // 1-12
        const total = (yearStart * 12 + (monthStart - 1)) + n;
        const newYear = Math.floor(total / 12);
        const newMonth = (total % 12) + 1;
        return `${newYear}-${String(newMonth).padStart(2, "0")}`;
      }
      case "quarter": {
        const [yStr, qStr] = last.split("-Q");
        const yearStart = parseInt(yStr, 10);
        const quarterStart = parseInt(qStr, 10); // 1-4
        const total = (yearStart * 4 + (quarterStart - 1)) + n;
        const newYear = Math.floor(total / 4);
        const newQuarter = (total % 4) + 1;
        return `${newYear}-Q${newQuarter}`;
      }
      case "year": {
        return String(parseInt(last, 10) + n);
      }
    }
  }

  /**
   * Run a hypothesis test (one-sample / two-sample / paired t-test,
   * Mann-Whitney U, or chi-squared) and return the statistic and a
   * two-tailed p-value.
   */
  static hypothesisTest(params: {
    test:
      | "t_test_one_sample"
      | "t_test_two_sample"
      | "t_test_paired"
      | "mann_whitney"
      | "chi_squared";
    records?: Record<string, unknown>[];
    columnA?: string;
    columnB?: string;
    mu?: number;
    observed?: number[];
    expected?: number[];
    df?: number;
  }): { statistic: number; pValue: number; df?: number } {
    const { test } = params;

    const requiredFor: Record<typeof test, (keyof typeof params)[]> = {
      t_test_one_sample: ["records", "columnA"],
      t_test_two_sample: ["records", "columnA", "columnB"],
      t_test_paired: ["records", "columnA", "columnB"],
      mann_whitney: ["records", "columnA", "columnB"],
      chi_squared: ["observed", "expected"],
    };
    const missing = requiredFor[test].filter(
      (k) => params[k] === undefined
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing input for test="${test}": ${missing.join(", ")}`
      );
    }

    switch (test) {
      case "t_test_one_sample": {
        const x = this.extractNumericColumn(params.records!, params.columnA!);
        if (x.length < 2) {
          throw new Error(
            "t_test_one_sample: at least 2 values required"
          );
        }
        const mu = params.mu ?? 0;
        const t = this.studentT(x, mu);
        const df = x.length - 1;
        return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
      }
      case "t_test_two_sample": {
        const x = this.extractNumericColumn(params.records!, params.columnA!);
        const y = this.extractNumericColumn(params.records!, params.columnB!);
        if (x.length < 2 || y.length < 2) {
          throw new Error(
            "t_test_two_sample: degenerate inputs (each sample needs ≥ 2 values)"
          );
        }
        const t = this.studentTTwoSample(x, y);
        const df = x.length + y.length - 2;
        return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
      }
      case "t_test_paired": {
        const x = this.extractNumericColumn(params.records!, params.columnA!);
        const y = this.extractNumericColumn(params.records!, params.columnB!);
        if (x.length !== y.length) {
          throw new Error("columns must be same length for paired test");
        }
        if (x.length < 2) {
          throw new Error("t_test_paired: at least 2 pairs required");
        }
        const diffs = x.map((xi, i) => xi - y[i]);
        const t = this.studentT(diffs, 0);
        const df = diffs.length - 1;
        return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
      }
      case "mann_whitney": {
        const x = this.extractNumericColumn(params.records!, params.columnA!);
        const y = this.extractNumericColumn(params.records!, params.columnB!);
        const W = ss.wilcoxonRankSum(x, y);
        const nx = x.length;
        const ny = y.length;
        const U = W - (nx * (nx + 1)) / 2;
        const meanU = (nx * ny) / 2;
        const sdU = Math.sqrt((nx * ny * (nx + ny + 1)) / 12);
        const z = sdU === 0 ? 0 : (U - meanU) / sdU;
        const p = 2 * (1 - this.normalCDF(Math.abs(z)));
        return { statistic: z, pValue: p };
      }
      case "chi_squared": {
        const observed = params.observed!;
        const expected = params.expected!;
        if (observed.length !== expected.length) {
          throw new Error(
            "observed and expected must have the same length"
          );
        }
        let stat = 0;
        for (let i = 0; i < observed.length; i++) {
          const diff = observed[i] - expected[i];
          stat += (diff * diff) / expected[i];
        }
        const df = params.df ?? observed.length - 1;
        const p = 1 - this.chiSquaredCDF(stat, df);
        return { statistic: stat, pValue: p, df };
      }
    }
  }

  /**
   * Group-by + reduce backed by Arquero. Generic primitive that sidesteps
   * the long tail of one-off count_by/sum_by tools.
   */
  static aggregate(params: {
    records: Record<string, unknown>[];
    groupBy: string[];
    metrics: {
      column?: string;
      op:
        | "count"
        | "sum"
        | "mean"
        | "median"
        | "min"
        | "max"
        | "stddev"
        | "p25"
        | "p75";
      as?: string;
    }[];
  }): { rows: Record<string, unknown>[] } {
    for (const m of params.metrics) {
      if (m.op !== "count" && !m.column) {
        throw new Error(`Aggregation op "${m.op}" requires a column`);
      }
    }

    const dt = aq.from(params.records);
    const grouped =
      params.groupBy.length === 0 ? dt : dt.groupby(...params.groupBy);

    const rollupArgs: Record<string, unknown> = {};
    for (const m of params.metrics) {
      const alias = m.as ?? (m.column ? `${m.op}_${m.column}` : "count");
      const col = m.column!;
      switch (m.op) {
        case "count":
          rollupArgs[alias] = aq.op.count();
          break;
        case "sum":
          rollupArgs[alias] = aq.op.sum(col);
          break;
        case "mean":
          rollupArgs[alias] = aq.op.mean(col);
          break;
        case "median":
          rollupArgs[alias] = aq.op.median(col);
          break;
        case "min":
          rollupArgs[alias] = aq.op.min(col);
          break;
        case "max":
          rollupArgs[alias] = aq.op.max(col);
          break;
        case "stddev":
          rollupArgs[alias] = aq.op.stdev(col);
          break;
        case "p25":
          rollupArgs[alias] = aq.op.quantile(col, 0.25);
          break;
        case "p75":
          rollupArgs[alias] = aq.op.quantile(col, 0.75);
          break;
      }
    }

    const out = grouped.rollup(rollupArgs as Parameters<typeof grouped.rollup>[0]);
    return { rows: out.objects() as Record<string, unknown>[] };
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
   * NPV over irregular-date cash flows (Excel XNPV semantics, 365-day year).
   */
  static xnpv(params: {
    rate: number;
    cashFlows: { date: string; amount: number }[];
  }): { xnpv: number } {
    const sorted = this.parseAndSortFlows(params.cashFlows);
    return { xnpv: this.xnpvOnSorted(params.rate, sorted) };
  }

  private static parseAndSortFlows(
    flows: { date: string; amount: number }[]
  ): { time: number; amount: number }[] {
    const parsed = flows.map((f) => {
      const t = Date.parse(f.date);
      if (Number.isNaN(t)) {
        throw new Error(`Invalid cash-flow date: ${f.date}`);
      }
      return { time: t, amount: f.amount };
    });
    parsed.sort((a, b) => a.time - b.time);
    return parsed;
  }

  private static xnpvOnSorted(
    rate: number,
    sorted: { time: number; amount: number }[]
  ): number {
    const anchor = sorted[0].time;
    const yearMs = 365 * 86400 * 1000;
    let sum = 0;
    for (const f of sorted) {
      const years = (f.time - anchor) / yearMs;
      sum += f.amount / Math.pow(1 + rate, years);
    }
    return sum;
  }

  /**
   * IRR over irregular-date cash flows (Excel XIRR semantics).
   * Newton-Raphson on xnpv with a 100-iteration cap.
   */
  static xirr(params: {
    cashFlows: { date: string; amount: number }[];
    guess?: number;
  }): { xirr: number } {
    const sorted = this.parseAndSortFlows(params.cashFlows);
    const hasPositive = sorted.some((f) => f.amount > 0);
    const hasNegative = sorted.some((f) => f.amount < 0);
    if (!hasPositive || !hasNegative) {
      throw new Error(
        "xirr requires at least one positive and one negative amount"
      );
    }

    const anchor = sorted[0].time;
    const yearMs = 365 * 86400 * 1000;
    const dxnpv = (rate: number): number => {
      let sum = 0;
      for (const f of sorted) {
        const years = (f.time - anchor) / yearMs;
        sum += (-years * f.amount) / Math.pow(1 + rate, years + 1);
      }
      return sum;
    };

    let rate = params.guess ?? 0.1;
    for (let i = 0; i < 100; i++) {
      const f = this.xnpvOnSorted(rate, sorted);
      const fp = dxnpv(rate);
      if (Math.abs(fp) < 1e-12) {
        throw new Error("xirr did not converge (zero derivative)");
      }
      const next = rate - f / fp;
      if (Math.abs(next - rate) < 1e-10) {
        return { xirr: next };
      }
      rate = next;
    }
    throw new Error("xirr did not converge after 100 iterations");
  }

  /**
   * Depreciation schedule (or single period) under straight-line,
   * declining-balance, or double-declining-balance.
   */
  static depreciation(params: {
    cost: number;
    salvage: number;
    life: number;
    method:
      | "straight_line"
      | "declining_balance"
      | "double_declining_balance";
    period?: number;
    factor?: number;
  }): DepreciationResult {
    const { cost, salvage, life, method, period } = params;
    if (period !== undefined && period > life) {
      throw new Error(`period ${period} exceeds life ${life}`);
    }

    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const schedule: DepreciationRow[] = [];

    if (method === "straight_line") {
      const expense = (cost - salvage) / life;
      let accumulated = 0;
      for (let i = 1; i <= life; i++) {
        accumulated += expense;
        schedule.push({
          period: i,
          depreciation: round2(expense),
          accumulated: round2(accumulated),
          bookValue: round2(cost - accumulated),
        });
      }
    } else {
      const factor =
        params.factor ?? (method === "double_declining_balance" ? 2 : 1);
      const rate = factor / life;
      let bookValue = cost;
      let accumulated = 0;
      for (let i = 1; i <= life; i++) {
        let expense = rate * bookValue;
        if (bookValue - expense < salvage) expense = bookValue - salvage;
        if (expense < 0) expense = 0;
        accumulated += expense;
        bookValue -= expense;
        schedule.push({
          period: i,
          depreciation: round2(expense),
          accumulated: round2(accumulated),
          bookValue: round2(bookValue),
        });
      }
    }

    if (period !== undefined) {
      return { row: schedule[period - 1] };
    }
    return { schedule };
  }

  /**
   * Time-value-of-money. Picks one of pv/fv/pmt/nper/rate to solve for,
   * given the others. Forwards to the `financial` package.
   */
  static tvm(params: {
    op: "pv" | "fv" | "pmt" | "rate" | "nper";
    rate?: number;
    nper?: number;
    pmt?: number;
    pv?: number;
    fv?: number;
    guess?: number;
  }): { result: number } {
    const { op } = params;

    const required: Record<typeof op, (keyof typeof params)[]> = {
      pv: ["rate", "nper", "pmt"],
      fv: ["rate", "nper", "pmt", "pv"],
      pmt: ["rate", "nper", "pv"],
      nper: ["rate", "pmt", "pv"],
      rate: ["nper", "pmt", "pv", "fv"],
    };
    const missing = required[op].filter((k) => params[k] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Missing input for op="${op}": ${missing.join(", ")}`
      );
    }

    switch (op) {
      case "pv":
        return {
          result: financial.pv(
            params.rate!,
            params.nper!,
            params.pmt!,
            params.fv ?? 0
          ),
        };
      case "fv":
        return {
          result: financial.fv(
            params.rate!,
            params.nper!,
            params.pmt!,
            params.pv!
          ),
        };
      case "pmt":
        return {
          result: financial.pmt(
            params.rate!,
            params.nper!,
            params.pv!,
            params.fv ?? 0
          ),
        };
      case "nper":
        return {
          result: financial.nper(
            params.rate!,
            params.pmt!,
            params.pv!,
            params.fv ?? 0
          ),
        };
      case "rate":
        return {
          result: financial.rate(
            params.nper!,
            params.pmt!,
            params.pv!,
            params.fv!,
            undefined,
            params.guess
          ),
        };
    }
  }

  /**
   * Fixed-coupon bond math: price, yield-to-maturity (Newton-Raphson),
   * Macaulay + modified duration, and convexity. No day-count
   * conventions, callable / floating / inflation-linked features.
   */
  static bondMath(params: {
    op: "price" | "ytm" | "duration" | "convexity";
    face: number;
    couponRate: number;
    maturity: number;
    frequency?: number;
    yield?: number;
    price?: number;
    guess?: number;
  }): BondMathResult {
    const { op, face, couponRate, maturity } = params;
    const f = params.frequency ?? 2;
    const N = Math.round(maturity * f);
    const C = (couponRate * face) / f;

    const priceFromYield = (y: number): number => {
      const r = y / f;
      if (r === 0) return C * N + face;
      const annuity = (C * (1 - Math.pow(1 + r, -N))) / r;
      const principal = face / Math.pow(1 + r, N);
      return annuity + principal;
    };

    if (op === "price") {
      if (params.yield === undefined) {
        throw new Error("yield is required for op = price");
      }
      return { price: priceFromYield(params.yield) };
    }

    if (op === "ytm") {
      if (params.price === undefined) {
        throw new Error("price is required for op = ytm");
      }
      const targetPrice = params.price;
      const dPriceDY = (y: number): number => {
        const r = y / f;
        let sum = 0;
        for (let t = 1; t <= N; t++) {
          const cf = t === N ? C + face : C;
          sum += (-t * cf) / (f * Math.pow(1 + r, t + 1));
        }
        return sum;
      };
      let y = params.guess ?? 0.05;
      let iterations = 0;
      for (let i = 0; i < 100; i++) {
        iterations = i + 1;
        const fVal = priceFromYield(y) - targetPrice;
        const fp = dPriceDY(y);
        if (Math.abs(fp) < 1e-12) {
          throw new Error("ytm did not converge (zero derivative)");
        }
        const next = y - fVal / fp;
        if (Math.abs(next - y) < 1e-10) {
          return { yield: next, iterations };
        }
        y = next;
      }
      throw new Error("ytm did not converge after 100 iterations");
    }

    if (op === "duration") {
      if (params.yield === undefined) {
        throw new Error("yield is required for op = duration");
      }
      const r = params.yield / f;
      const P = priceFromYield(params.yield);
      let weightedSum = 0;
      for (let t = 1; t <= N; t++) {
        const cf = t === N ? C + face : C;
        weightedSum += (t * cf) / Math.pow(1 + r, t);
      }
      const macaulayPeriods = weightedSum / P;
      const macaulayDuration = macaulayPeriods / f;
      const modifiedDuration = macaulayDuration / (1 + r);
      return { macaulayDuration, modifiedDuration };
    }

    // convexity
    if (params.yield === undefined) {
      throw new Error("yield is required for op = convexity");
    }
    const r = params.yield / f;
    const P = priceFromYield(params.yield);
    let weightedSum = 0;
    for (let t = 1; t <= N; t++) {
      const cf = t === N ? C + face : C;
      weightedSum += (t * (t + 1) * cf) / Math.pow(1 + r, t + 2);
    }
    const convexityPeriods = weightedSum / P;
    const convexity = convexityPeriods / (f * f);
    return { convexity };
  }

  /**
   * Portfolio analytics — total return, CAGR, Sortino, Calmar, max drawdown.
   * When a benchmark is supplied, also returns beta, alpha, information
   * ratio, tracking error, and up/down capture ratios.
   */
  static portfolioMetrics(params: {
    records: Record<string, unknown>[];
    returnColumn: string;
    benchmarkRecords?: Record<string, unknown>[];
    benchmarkReturnColumn?: string;
    riskFreeRate?: number;
    periodicity?: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  }): PortfolioMetricsResult {
    const r = this.extractNumericColumn(
      params.records,
      params.returnColumn
    );
    const n = r.length;
    if (n < 2) {
      throw new Error("portfolio_metrics: at least 2 returns required");
    }

    const periodsPerYear = {
      daily: 252,
      weekly: 52,
      monthly: 12,
      quarterly: 4,
      annual: 1,
    }[params.periodicity ?? "annual"];
    const annualize = params.periodicity !== undefined;

    // Cumulative wealth + drawdown
    let wealth = 1;
    const wealthSeries: number[] = [];
    for (const ri of r) {
      wealth *= 1 + ri;
      wealthSeries.push(wealth);
    }
    const totalReturn = wealth - 1;

    let peak = wealthSeries[0];
    let mdd = 0;
    for (const w of wealthSeries) {
      if (w > peak) peak = w;
      const dd = peak === 0 ? 0 : (peak - w) / peak;
      if (dd > mdd) mdd = dd;
    }

    const cagr = annualize
      ? Math.pow(1 + totalReturn, periodsPerYear / n) - 1
      : Math.pow(1 + totalReturn, 1 / n) - 1;

    // Sortino — downside deviation over full count n
    const rfr = params.riskFreeRate ?? 0;
    const excessReturns = r.map((ri) => ri - rfr);
    const downsideSqSum = excessReturns
      .map((e) => (e < 0 ? e * e : 0))
      .reduce((a, b) => a + b, 0);
    const downsideDev = Math.sqrt(downsideSqSum / n);
    const meanExcess = ss.mean(excessReturns);
    let sortino = downsideDev === 0 ? 0 : meanExcess / downsideDev;
    if (annualize) sortino *= Math.sqrt(periodsPerYear);

    const calmar =
      mdd === 0 ? Number.POSITIVE_INFINITY : cagr / mdd;

    const result: PortfolioMetricsResult = {
      totalReturn,
      cagr,
      sortino,
      calmar,
      maxDrawdown: mdd,
    };

    if (params.benchmarkRecords && params.benchmarkReturnColumn) {
      const rb = this.extractNumericColumn(
        params.benchmarkRecords,
        params.benchmarkReturnColumn
      );
      if (rb.length !== n) {
        throw new Error("benchmark length must match portfolio length");
      }

      const varB = ss.sampleVariance(rb);
      const beta = varB === 0 ? 0 : ss.sampleCovariance(r, rb) / varB;
      const meanR = ss.mean(r);
      const meanB = ss.mean(rb);
      let alpha = meanR - rfr - beta * (meanB - rfr);
      if (annualize) alpha = Math.pow(1 + alpha, periodsPerYear) - 1;

      const diff = r.map((ri, i) => ri - rb[i]);
      let trackingError =
        diff.length > 1 ? ss.sampleStandardDeviation(diff) : 0;
      if (annualize) trackingError *= Math.sqrt(periodsPerYear);

      const meanDiff = ss.mean(diff);
      const sdDiff =
        diff.length > 1 ? ss.sampleStandardDeviation(diff) : 0;
      let informationRatio = sdDiff === 0 ? 0 : meanDiff / sdDiff;
      if (annualize) informationRatio *= Math.sqrt(periodsPerYear);

      // Up/down capture
      const upR: number[] = [];
      const upB: number[] = [];
      const downR: number[] = [];
      const downB: number[] = [];
      for (let i = 0; i < n; i++) {
        if (rb[i] > 0) {
          upR.push(r[i]);
          upB.push(rb[i]);
        } else if (rb[i] < 0) {
          downR.push(r[i]);
          downB.push(rb[i]);
        }
      }
      const meanUpB = upB.length ? ss.mean(upB) : 0;
      const meanDownB = downB.length ? ss.mean(downB) : 0;

      result.beta = beta;
      result.alpha = alpha;
      result.trackingError = trackingError;
      result.informationRatio = informationRatio;
      if (upB.length > 0 && meanUpB !== 0) {
        result.upCapture = ss.mean(upR) / meanUpB;
      }
      if (downB.length > 0 && meanDownB !== 0) {
        result.downCapture = ss.mean(downR) / meanDownB;
      }
    }

    return result;
  }

  /**
   * Historical or parametric Value-at-Risk and Conditional VaR.
   * Returned as positive loss magnitudes — at confidence c, VaR is the
   * loss not exceeded with probability c.
   */
  static varCvar(params: {
    records: Record<string, unknown>[];
    returnColumn: string;
    confidence?: number;
    method?: "historical" | "parametric";
  }): VarCvarResult {
    const returns = this.extractNumericColumn(
      params.records,
      params.returnColumn
    );
    if (returns.length < 2) {
      throw new Error("var_cvar: at least 2 returns required");
    }
    const conf = params.confidence ?? 0.95;
    const method = params.method ?? "historical";

    if (method === "historical") {
      const sorted = [...returns].sort((a, b) => a - b);
      const tailFrac = 1 - conf;
      const cutoff = ss.quantile(sorted, tailFrac);
      const tail = sorted.filter((v) => v <= cutoff);
      const varVal = -cutoff;
      const cvarVal = tail.length > 0 ? -ss.mean(tail) : varVal;
      return {
        var: varVal,
        cvar: cvarVal,
        confidence: conf,
        method,
        tailCount: tail.length,
      };
    }

    // parametric (normal)
    const mu = ss.mean(returns);
    const sigma = ss.sampleStandardDeviation(returns);
    if (sigma === 0) {
      return { var: 0, cvar: 0, confidence: conf, method };
    }
    // Standard-normal quantile via large-df t (matches forecast convention).
    const z = this.tInverseCDF(1 - conf, 1000);
    const varVal = -(mu + z * sigma);
    const phi = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
    const cvarVal = -(mu - sigma * (phi / (1 - conf)));
    return { var: varVal, cvar: cvarVal, confidence: conf, method };
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
   * Regularized incomplete beta function I_x(a, b).
   * Numerical Recipes §6.4 — Lentz continued fraction with the symmetry
   * transformation for faster convergence.
   */
  private static regularizedIncompleteBeta(
    x: number,
    a: number,
    b: number
  ): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (x > (a + 1) / (a + b + 2)) {
      return 1 - this.regularizedIncompleteBeta(1 - x, b, a);
    }

    const lnBeta = ss.gammaln(a) + ss.gammaln(b) - ss.gammaln(a + b);
    const front = Math.exp(
      a * Math.log(x) + b * Math.log(1 - x) - lnBeta - Math.log(a)
    );

    const eps = 1e-12;
    const tiny = 1e-30;
    let c = 1;
    let d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let cf = d;

    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      // even step
      let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      cf *= d * c;
      // odd step
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      cf *= delta;
      if (Math.abs(delta - 1) < eps) break;
    }
    return front * cf;
  }

  /**
   * Regularized lower incomplete gamma γ(s, x) / Γ(s).
   * Series for x < s+1, continued fraction otherwise (Numerical Recipes §6.2).
   */
  private static regularizedIncompleteGamma(s: number, x: number): number {
    if (x < 0 || s <= 0) return 0;
    if (x === 0) return 0;

    if (x < s + 1) {
      // series
      let term = 1 / s;
      let sum = term;
      for (let n = 1; n <= 200; n++) {
        term *= x / (s + n);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
      }
      return sum * Math.exp(-x + s * Math.log(x) - ss.gammaln(s));
    }

    // continued fraction (Lentz)
    const eps = 1e-12;
    const tiny = 1e-30;
    let b = x + 1 - s;
    let c = 1e30;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i <= 200; i++) {
      const an = -i * (i - s);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < eps) break;
    }
    return 1 - h * Math.exp(-x + s * Math.log(x) - ss.gammaln(s));
  }

  /**
   * Student's t-distribution CDF.
   */
  private static tCDF(t: number, df: number): number {
    const x = df / (df + t * t);
    const p = 0.5 * this.regularizedIncompleteBeta(x, df / 2, 0.5);
    return t >= 0 ? 1 - p : p;
  }

  /**
   * Chi-squared CDF.
   */
  private static chiSquaredCDF(x: number, df: number): number {
    return this.regularizedIncompleteGamma(df / 2, x / 2);
  }

  /**
   * Two-tailed p-value for a t-statistic with df degrees of freedom.
   */
  private static tTwoTailedPValue(t: number, df: number): number {
    return 2 * (1 - this.tCDF(Math.abs(t), df));
  }

  /**
   * Inverse Student's t CDF. Bisection on `tCDF` over a wide bracket;
   * clamps at ±50 for tail probabilities below 1e-15.
   */
  private static tInverseCDF(p: number, df: number): number {
    if (p <= 1e-15) return -50;
    if (p >= 1 - 1e-15) return 50;
    let lo = -50;
    let hi = 50;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const cdf = this.tCDF(mid, df);
      if (Math.abs(cdf - p) < 1e-10) return mid;
      if (cdf < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * Solve y = X β by ordinary least squares. Returns the coefficient
   * vector AND the inverted normal-equations matrix (X'X)⁻¹, which the
   * caller multiplies by σ² to get the coefficient covariance matrix.
   */
  private static solveOLS(
    X: number[][],
    y: number[]
  ): {
    coefficients: number[];
    xtxInverse: number[][];
    residuals: number[];
  } {
    const n = X.length;
    const k = X[0].length;
    if (n < k) {
      throw new Error(
        `Need at least ${k} rows for the regression; got ${n}`
      );
    }

    // Build X'X and X'y
    const xtx: number[][] = Array.from({ length: k }, () =>
      new Array(k).fill(0)
    );
    const xty: number[] = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const row = X[i];
      for (let a = 0; a < k; a++) {
        xty[a] += row[a] * y[i];
        for (let b = 0; b < k; b++) {
          xtx[a][b] += row[a] * row[b];
        }
      }
    }

    // Gauss-Jordan inversion of X'X via [X'X | I] → [I | (X'X)⁻¹]
    const aug: number[][] = xtx.map((row, i) => [
      ...row,
      ...new Array(k).fill(0).map((_, j) => (i === j ? 1 : 0)),
    ]);

    for (let col = 0; col < k; col++) {
      let pivot = col;
      for (let r = col + 1; r < k; r++) {
        if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
      }
      if (Math.abs(aug[pivot][col]) < 1e-12) {
        throw new Error("design matrix is singular (collinear columns?)");
      }
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

      const piv = aug[col][col];
      for (let j = 0; j < 2 * k; j++) aug[col][j] /= piv;
      for (let r = 0; r < k; r++) {
        if (r === col) continue;
        const factor = aug[r][col];
        if (factor === 0) continue;
        for (let j = 0; j < 2 * k; j++) {
          aug[r][j] -= factor * aug[col][j];
        }
      }
    }

    const xtxInverse = aug.map((row) => row.slice(k));

    // β̂ = (X'X)⁻¹ X'y
    const coefficients: number[] = new Array(k).fill(0);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        coefficients[i] += xtxInverse[i][j] * xty[j];
      }
    }

    // Residuals = y - X β̂
    const residuals: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let predicted = 0;
      for (let j = 0; j < k; j++) predicted += X[i][j] * coefficients[j];
      residuals[i] = y[i] - predicted;
    }

    return { coefficients, xtxInverse, residuals };
  }

  /**
   * Standard-normal CDF via the error function. More accurate than
   * simple-statistics' cumulativeStdNormalProbability (which is a 4-sig-fig
   * table lookup) — needed for tail p-values on Mann-Whitney.
   */
  private static normalCDF(z: number): number {
    return 0.5 + 0.5 * ss.errorFunction(z / Math.sqrt(2));
  }

  /**
   * Student's t-statistic with sample (n-1) standard deviation, matching
   * scipy/Excel/R conventions. simple-statistics' built-in tTest uses the
   * population (n) stddev, which differs at small n.
   */
  private static studentT(x: number[], mu: number): number {
    const n = x.length;
    const mean = ss.mean(x);
    const sd = ss.sampleStandardDeviation(x);
    if (sd === 0) return mean === mu ? 0 : Number.POSITIVE_INFINITY;
    return (mean - mu) / (sd / Math.sqrt(n));
  }

  /**
   * Pooled-variance two-sample t-statistic (Student's, equal-variance
   * assumption). Matches scipy's `ttest_ind(equal_var=True)`.
   */
  private static studentTTwoSample(x: number[], y: number[]): number {
    const nx = x.length;
    const ny = y.length;
    const xMean = ss.mean(x);
    const yMean = ss.mean(y);
    const xVar = ss.sampleVariance(x);
    const yVar = ss.sampleVariance(y);
    const pooledVar = ((nx - 1) * xVar + (ny - 1) * yVar) / (nx + ny - 2);
    const se = Math.sqrt(pooledVar * (1 / nx + 1 / ny));
    if (se === 0) return xMean === yMean ? 0 : Number.POSITIVE_INFINITY;
    return (xMean - yMean) / se;
  }
}
