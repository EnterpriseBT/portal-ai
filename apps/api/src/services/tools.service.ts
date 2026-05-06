/**
 * Tool Service — orchestrates tool registration for stations.
 *
 * Each tool is defined in its own class under `tools/`. This service
 * builds the full tool set for a station based on its enabled tool packs.
 */

/* global AbortController, fetch */

import { type Tool } from "ai";

import { AnalyticsService } from "./analytics.service.js";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";

// Tool classes
import { SqlQueryTool } from "../tools/sql-query.tool.js";
import { VisualizeTool } from "../tools/visualize.tool.js";
import { VisualizeTreeTool } from "../tools/visualize-tree.tool.js";
import { ResolveIdentityTool } from "../tools/resolve-identity.tool.js";
import { DescribeColumnTool } from "../tools/describe-column.tool.js";
import { CorrelateTool } from "../tools/correlate.tool.js";
import { DetectOutliersTool } from "../tools/detect-outliers.tool.js";
import { ClusterTool } from "../tools/cluster.tool.js";
import { AggregateTool } from "../tools/aggregate.tool.js";
import { HypothesisTestTool } from "../tools/hypothesis-test.tool.js";
import { RegressionTool } from "../tools/regression.tool.js";
import { LogisticRegressionTool } from "../tools/logistic-regression.tool.js";
import { ChangepointTool } from "../tools/changepoint.tool.js";
import { DecomposeTool } from "../tools/decompose.tool.js";
import { ForecastTool } from "../tools/forecast.tool.js";
import { TrendTool } from "../tools/trend.tool.js";
import { TechnicalIndicatorTool } from "../tools/technical-indicator.tool.js";
import { NpvTool } from "../tools/npv.tool.js";
import { IrrTool } from "../tools/irr.tool.js";
import { TvmTool } from "../tools/tvm.tool.js";
import { XnpvTool } from "../tools/xnpv.tool.js";
import { XirrTool } from "../tools/xirr.tool.js";
import { DepreciationTool } from "../tools/depreciation.tool.js";
import { VarCvarTool } from "../tools/var-cvar.tool.js";
import { PortfolioMetricsTool } from "../tools/portfolio-metrics.tool.js";
import { BondMathTool } from "../tools/bond-math.tool.js";
import { AmortizeTool } from "../tools/amortize.tool.js";
import { SharpeRatioTool } from "../tools/sharpe-ratio.tool.js";
import { MaxDrawdownTool } from "../tools/max-drawdown.tool.js";
import { RollingReturnsTool } from "../tools/rolling-returns.tool.js";
import { WebSearchTool } from "../tools/web-search.tool.js";
import { WebhookTool } from "../tools/webhook.tool.js";
import { EntityRecordCreateTool } from "../tools/entity-record-create.tool.js";
import { EntityRecordUpdateTool } from "../tools/entity-record-update.tool.js";
import { EntityRecordDeleteTool } from "../tools/entity-record-delete.tool.js";
import { ConnectorEntityCreateTool } from "../tools/connector-entity-create.tool.js";
import { ConnectorEntityUpdateTool } from "../tools/connector-entity-update.tool.js";
import { ConnectorEntityDeleteTool } from "../tools/connector-entity-delete.tool.js";
import { FieldMappingCreateTool } from "../tools/field-mapping-create.tool.js";
import { FieldMappingUpdateTool } from "../tools/field-mapping-update.tool.js";
import { FieldMappingDeleteTool } from "../tools/field-mapping-delete.tool.js";
import { resolveStationCapabilities } from "../utils/resolve-capabilities.util.js";

const logger = createLogger({ module: "tools-service" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookImplementation {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
}

/** All recognized tool pack names. */
export const ALL_TOOL_PACKS = [
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
] as const;

export type ToolPackName = (typeof ALL_TOOL_PACKS)[number];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** All built-in tool names — used to detect webhook name conflicts. */
export const BUILTIN_TOOL_NAMES = new Set<string>([
  "sql_query",
  "visualize",
  "visualize_tree",
  "resolve_identity",
  "describe_column",
  "correlate",
  "detect_outliers",
  "cluster",
  "aggregate",
  "hypothesis_test",
  "regression",
  "logistic_regression",
  "changepoint",
  "decompose",
  "forecast",
  "trend",
  "technical_indicator",
  "npv",
  "irr",
  "tvm",
  "xnpv",
  "xirr",
  "depreciation",
  "var_cvar",
  "portfolio_metrics",
  "bond_math",
  "amortize",
  "sharpe_ratio",
  "max_drawdown",
  "rolling_returns",
  "web_search",
  "entity_record_create",
  "entity_record_update",
  "entity_record_delete",
  "connector_entity_create",
  "connector_entity_update",
  "connector_entity_delete",
  "field_mapping_create",
  "field_mapping_update",
  "field_mapping_delete",
]);

export class ToolService {
  // -----------------------------------------------------------------------
  // Static look-ups
  // -----------------------------------------------------------------------

  /** Re-exported for any caller still going via the class. */
  static readonly PACK_TOOL_NAMES = BUILTIN_TOOL_NAMES;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * POST to a webhook URL with auth headers and a 30 s timeout.
   * Returns parsed JSON response.
   */
  static async callWebhook(
    implementation: WebhookImplementation,
    input: Record<string, unknown>
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(implementation.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(implementation.headers ?? {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Webhook returned ${response.status}: ${response.statusText}`
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build all analytics tools for a station based on its enabled tool packs.
   */
  static async buildAnalyticsTools(
    organizationId: string,
    stationId: string,
    userId: string
  ): Promise<Record<string, Tool>> {
    const repo = DbService.repository;

    // Load station and validate packs
    const station = await repo.stations.findById(stationId);
    if (!station) throw new Error(`Station not found: ${stationId}`);

    const enabledRows = await repo.stationToolpacks.findByStationId(stationId);
    const builtinSlugs = enabledRows
      .map((r) => r.builtinSlug)
      .filter((s): s is string => s !== null);
    const customPackIds = enabledRows
      .map((r) => r.organizationToolpackId)
      .filter((id): id is string => id !== null);

    if (builtinSlugs.length === 0 && customPackIds.length === 0) {
      throw new Error("Station must have at least one tool pack enabled");
    }

    const toolPacks = builtinSlugs;
    const enabledPacks = new Set<string>(builtinSlugs);

    // Load station data into memory
    const stationData = await AnalyticsService.loadStation(
      stationId,
      organizationId
    );

    const tools: Record<string, Tool> = {};

    // -------------------------------------------------------------------
    // Pack: data_query
    // -------------------------------------------------------------------
    if (enabledPacks.has("data_query")) {
      tools.sql_query = new SqlQueryTool().build(stationId);
      tools.visualize = new VisualizeTool().build(stationId);
      tools.visualize_tree = new VisualizeTreeTool().build(stationId);

      if (stationData.entityGroups.length > 0) {
        tools.resolve_identity = new ResolveIdentityTool().build(
          stationId,
          stationData.entityGroups
        );
      }
    }

    // -------------------------------------------------------------------
    // Pack: statistics
    // -------------------------------------------------------------------
    if (enabledPacks.has("statistics")) {
      tools.describe_column = new DescribeColumnTool().build(stationData);
      tools.correlate = new CorrelateTool().build(stationData);
      tools.detect_outliers = new DetectOutliersTool().build(stationData);
      tools.cluster = new ClusterTool().build(stationData);
      tools.aggregate = new AggregateTool().build(stationData);
      tools.hypothesis_test = new HypothesisTestTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: regression
    // -------------------------------------------------------------------
    if (enabledPacks.has("regression")) {
      tools.regression = new RegressionTool().build(stationData);
      tools.logistic_regression = new LogisticRegressionTool().build(stationData);
      tools.trend = new TrendTool().build(stationData);
      tools.changepoint = new ChangepointTool().build(stationData);
      tools.decompose = new DecomposeTool().build(stationData);
      tools.forecast = new ForecastTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: financial
    // -------------------------------------------------------------------
    if (enabledPacks.has("financial")) {
      tools.technical_indicator = new TechnicalIndicatorTool().build(
        stationData
      );
      tools.npv = new NpvTool().build();
      tools.irr = new IrrTool().build();
      tools.tvm = new TvmTool().build();
      tools.xnpv = new XnpvTool().build();
      tools.xirr = new XirrTool().build();
      tools.depreciation = new DepreciationTool().build();
      tools.amortize = new AmortizeTool().build();
      tools.sharpe_ratio = new SharpeRatioTool().build(stationData);
      tools.max_drawdown = new MaxDrawdownTool().build(stationData);
      tools.rolling_returns = new RollingReturnsTool().build(stationData);
      tools.var_cvar = new VarCvarTool().build(stationData);
      tools.portfolio_metrics = new PortfolioMetricsTool().build(stationData);
      tools.bond_math = new BondMathTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: web_search
    // -------------------------------------------------------------------
    if (enabledPacks.has("web_search")) {
      tools.web_search = new WebSearchTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: entity_management
    // -------------------------------------------------------------------
    if (enabledPacks.has("entity_management")) {
      // Write tools — only if any attached instance has write capability
      const stationCaps = await resolveStationCapabilities(stationId);
      const hasWrite = stationCaps.some((sc) => sc.capabilities.write);

      if (hasWrite) {
        tools.entity_record_create = new EntityRecordCreateTool().build(
          stationId,
          organizationId,
          userId
        );
        tools.entity_record_update = new EntityRecordUpdateTool().build(
          stationId,
          userId
        );
        tools.entity_record_delete = new EntityRecordDeleteTool().build(
          stationId,
          userId
        );
        tools.connector_entity_create = new ConnectorEntityCreateTool().build(
          stationId,
          userId
        );
        tools.connector_entity_update = new ConnectorEntityUpdateTool().build(
          stationId,
          userId
        );
        tools.connector_entity_delete = new ConnectorEntityDeleteTool().build(
          stationId,
          userId
        );
        tools.field_mapping_create = new FieldMappingCreateTool().build(
          stationId,
          organizationId,
          userId
        );
        tools.field_mapping_update = new FieldMappingUpdateTool().build(
          stationId,
          organizationId,
          userId
        );
        tools.field_mapping_delete = new FieldMappingDeleteTool().build(
          stationId,
          organizationId,
          userId
        );
      }
    }

    // -------------------------------------------------------------------
    // Custom toolpacks
    // -------------------------------------------------------------------
    if (customPackIds.length > 0) {
      const customPacks =
        await repo.organizationToolpacks.findManyByIds(customPackIds, {
          organizationId,
        });
      for (const pack of customPacks) {
        for (const tool of pack.tools) {
          if (tool.name in tools) {
            throw new Error(
              `Tool "${tool.name}" is provided by more than one enabled toolpack on this station`
            );
          }
          tools[tool.name] = new WebhookTool(
            tool.name,
            tool.description,
            tool.parameterSchema as Record<string, unknown>,
            {
              type: "webhook",
              url: pack.endpoints.runtime,
              headers:
                (pack.authHeaders as Record<string, string> | null) ??
                undefined,
            },
            stationId
          ).build();
        }
      }
    }

    logger.info(
      {
        stationId,
        toolCount: Object.keys(tools).length,
        packs: toolPacks,
        customPackIds,
      },
      "Analytics tools built"
    );

    return tools;
  }
}
