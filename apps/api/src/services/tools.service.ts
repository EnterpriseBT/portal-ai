/**
 * Tool Service — orchestrates tool registration for stations.
 *
 * Each tool is defined in its own class under `tools/`. This service
 * builds the full tool set for a station based on its enabled tool packs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { RegressionTool } from "../tools/regression.tool.js";
import { TrendTool } from "../tools/trend.tool.js";
import { TechnicalIndicatorTool } from "../tools/technical-indicator.tool.js";
import { NpvTool } from "../tools/npv.tool.js";
import { IrrTool } from "../tools/irr.tool.js";
import { AmortizeTool } from "../tools/amortize.tool.js";
import { SharpeRatioTool } from "../tools/sharpe-ratio.tool.js";
import { MaxDrawdownTool } from "../tools/max-drawdown.tool.js";
import { RollingReturnsTool } from "../tools/rolling-returns.tool.js";
import { WebSearchTool } from "../tools/web-search.tool.js";
import { WebhookTool } from "../tools/webhook.tool.js";

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

export class ToolService {
  // -----------------------------------------------------------------------
  // Static look-ups
  // -----------------------------------------------------------------------

  /** All built-in tool names — used to detect webhook name conflicts. */
  private static readonly PACK_TOOL_NAMES = new Set([
    "sql_query",
    "visualize",
    "visualize_tree",
    "resolve_identity",
    "describe_column",
    "correlate",
    "detect_outliers",
    "cluster",
    "regression",
    "trend",
    "technical_indicator",
    "npv",
    "irr",
    "amortize",
    "sharpe_ratio",
    "max_drawdown",
    "rolling_returns",
    "web_search",
    "entity_list",
    "entity_record_list",
    "entity_record_create",
    "entity_record_update",
    "entity_record_delete",
    "connector_entity_update",
    "connector_entity_delete",
    "column_definition_create",
    "column_definition_update",
    "column_definition_delete",
    "field_mapping_create",
    "field_mapping_delete",
  ]);

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
    const timeout = setTimeout(
      () => controller.abort(),
      WEBHOOK_TIMEOUT_MS
    );

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
  ): Promise<Record<string, Tool>> {
    const repo = DbService.repository;

    // Load station and validate packs
    const station = await repo.stations.findById(stationId);
    if (!station) throw new Error(`Station not found: ${stationId}`);

    const toolPacks = (station as any).toolPacks as string[];
    if (!toolPacks || toolPacks.length === 0) {
      throw new Error("Station must have at least one tool pack enabled");
    }

    const enabledPacks = new Set<string>(toolPacks);

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
    }

    // -------------------------------------------------------------------
    // Pack: regression
    // -------------------------------------------------------------------
    if (enabledPacks.has("regression")) {
      tools.regression = new RegressionTool().build(stationData);
      tools.trend = new TrendTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: financial
    // -------------------------------------------------------------------
    if (enabledPacks.has("financial")) {
      tools.technical_indicator = new TechnicalIndicatorTool().build(stationData);
      tools.npv = new NpvTool().build();
      tools.irr = new IrrTool().build();
      tools.amortize = new AmortizeTool().build();
      tools.sharpe_ratio = new SharpeRatioTool().build(stationData);
      tools.max_drawdown = new MaxDrawdownTool().build(stationData);
      tools.rolling_returns = new RollingReturnsTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: web_search
    // -------------------------------------------------------------------
    if (enabledPacks.has("web_search")) {
      tools.web_search = new WebSearchTool().build();
    }

    // -------------------------------------------------------------------
    // Custom webhook tools
    // -------------------------------------------------------------------
    await this.buildCustomWebhookTools(tools, stationId);

    logger.info(
      {
        stationId,
        toolCount: Object.keys(tools).length,
        packs: toolPacks,
      },
      "Analytics tools built"
    );

    return tools;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private static async buildCustomWebhookTools(
    tools: Record<string, Tool>,
    stationId: string,
  ): Promise<void> {
    const repo = DbService.repository;
    const stationToolRows = await repo.stationTools.findByStationId(stationId);

    for (const row of stationToolRows) {
      const def = row.organizationTool;
      const toolName = def.name;

      if (ToolService.PACK_TOOL_NAMES.has(toolName)) {
        throw new Error(
          `Custom tool "${toolName}" conflicts with a built-in pack tool name`
        );
      }

      tools[toolName] = new WebhookTool(
        toolName,
        def.description ?? `Custom tool: ${toolName}`,
        def.parameterSchema as Record<string, unknown>,
        def.implementation as unknown as WebhookImplementation,
        stationId,
      ).build();
    }
  }
}
