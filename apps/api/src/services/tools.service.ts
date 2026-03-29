/**
 * Tool Service — orchestrates tool registration for stations.
 *
 * Each tool is defined in its own class under `tools/`. This service
 * builds the tool set for a station based on its enabled tool packs.
 *
 * Lazy loading: Only packs relevant to the current user message are
 * included in the `streamText` call. A lightweight `request_tools`
 * meta-tool lets the model request additional packs mid-turn if needed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global AbortController, fetch */

import { z } from "zod";
import { type Tool, tool } from "ai";

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
] as const;

export type ToolPackName = (typeof ALL_TOOL_PACKS)[number];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ToolService {
  // -----------------------------------------------------------------------
  // Static look-ups
  // -----------------------------------------------------------------------

  /** Map from tool name → owning pack. */
  private static readonly TOOL_TO_PACK: Record<string, ToolPackName> = {
    sql_query: "data_query",
    visualize: "data_query",
    visualize_tree: "data_query",
    resolve_identity: "data_query",
    describe_column: "statistics",
    correlate: "statistics",
    detect_outliers: "statistics",
    cluster: "statistics",
    regression: "regression",
    trend: "regression",
    technical_indicator: "financial",
    npv: "financial",
    irr: "financial",
    amortize: "financial",
    sharpe_ratio: "financial",
    max_drawdown: "financial",
    rolling_returns: "financial",
    web_search: "web_search",
  };

  /** All built-in tool names — used to detect webhook name conflicts. */
  private static readonly PACK_TOOL_NAMES = new Set(
    Object.keys(ToolService.TOOL_TO_PACK)
  );

  /**
   * Keywords that signal a tool pack is likely needed for the current turn.
   * Matched case-insensitively against the latest user message.
   */
  private static readonly PACK_KEYWORDS: Record<ToolPackName, RegExp> = {
    data_query:
      /\b(chart|graph|plot|visual|diagram|bar\s*chart|line\s*chart|pie\s*chart|scatter|heatmap|histogram|tree|hierarchy|vega)\b/i,
    statistics:
      /\b(statistic|describe|distribution|correlat|outlier|anomal|cluster|segment|group.*similar|mean|median|std\s*dev|variance|percentile)\b/i,
    regression:
      /\b(regress|trend|forecast|predict|fit\s*line|slope|linear\s*model|growth\s*rate|project)\b/i,
    financial:
      /\b(financ|npv|irr|amortiz|sharpe|drawdown|rolling\s*return|technical\s*indicator|moving\s*average|bollinger|rsi|macd|present\s*value|cash\s*flow)\b/i,
    web_search:
      /\b(search|web|google|look\s*up|find\s*online|browse|internet)\b/i,
  };

  // -----------------------------------------------------------------------
  // Pack selection
  // -----------------------------------------------------------------------

  /**
   * Select which tool packs are relevant for a given user message.
   *
   * Always returns `data_query` in "core" mode (sql_query + resolve_identity).
   * The heavier viz tools within data_query are only included when the message
   * matches visualization keywords.
   */
  static selectToolPacks(
    userMessage: string,
    enabledPacks: string[]
  ): { activePacks: Set<ToolPackName>; needsViz: boolean } {
    const enabled = new Set(enabledPacks);
    const activePacks = new Set<ToolPackName>();
    let needsViz = false;

    // data_query core (sql_query, resolve_identity) is always active
    if (enabled.has("data_query")) {
      activePacks.add("data_query");
      needsViz = this.PACK_KEYWORDS.data_query.test(userMessage);
    }

    // Check remaining packs against keywords
    for (const pack of ALL_TOOL_PACKS) {
      if (pack === "data_query") continue;
      if (enabled.has(pack) && this.PACK_KEYWORDS[pack].test(userMessage)) {
        activePacks.add(pack);
      }
    }

    return { activePacks, needsViz };
  }

  /**
   * Given a set of tool names from conversation history, return the packs
   * that must be loaded so every referenced tool has a definition.
   */
  static packsForToolNames(toolNames: Set<string>): Set<ToolPackName> {
    const packs = new Set<ToolPackName>();
    for (const name of toolNames) {
      const pack = this.TOOL_TO_PACK[name];
      if (pack) packs.add(pack);
    }
    return packs;
  }
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
   * Build analytics tools for a station, filtered to only the packs
   * relevant to the current user message.
   *
   * When `activePacks` is omitted, all enabled packs are included
   * (legacy behaviour for backward-compat).
   */
  static async buildAnalyticsTools(
    organizationId: string,
    stationId: string,
    options?: { activePacks?: Set<ToolPackName>; needsViz?: boolean }
  ): Promise<Record<string, Tool>> {
    const repo = DbService.repository;

    // Load station and validate packs
    const station = await repo.stations.findById(stationId);
    if (!station) throw new Error(`Station not found: ${stationId}`);

    const toolPacks = (station as any).toolPacks as string[];
    if (!toolPacks || toolPacks.length === 0) {
      throw new Error("Station must have at least one tool pack enabled");
    }

    // If no selection was provided, include everything (backward-compat)
    const activePacks = options?.activePacks ?? new Set<ToolPackName>(toolPacks as ToolPackName[]);
    const needsViz = options?.needsViz ?? true;
    const enabledPacks = new Set<string>(toolPacks);

    // Load station data into memory
    const stationData = await AnalyticsService.loadStation(
      stationId,
      organizationId
    );

    const tools: Record<string, Tool> = {};

    // -------------------------------------------------------------------
    // Pack: data_query (core tools always included; viz tools are lazy)
    // -------------------------------------------------------------------
    if (activePacks.has("data_query")) {
      tools.sql_query = new SqlQueryTool().build(stationId);

      // Only include the heavy Vega-Lite/Vega schema tools when viz is needed
      if (needsViz) {
        tools.visualize = new VisualizeTool().build(stationId);
        tools.visualize_tree = new VisualizeTreeTool().build(stationId);
      }

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
    if (activePacks.has("statistics")) {
      tools.describe_column = new DescribeColumnTool().build(stationData);
      tools.correlate = new CorrelateTool().build(stationData);
      tools.detect_outliers = new DetectOutliersTool().build(stationData);
      tools.cluster = new ClusterTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: regression
    // -------------------------------------------------------------------
    if (activePacks.has("regression")) {
      tools.regression = new RegressionTool().build(stationData);
      tools.trend = new TrendTool().build(stationData);
    }

    // -------------------------------------------------------------------
    // Pack: financial
    // -------------------------------------------------------------------
    if (activePacks.has("financial")) {
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
    if (activePacks.has("web_search")) {
      tools.web_search = new WebSearchTool().build();
    }

    // -------------------------------------------------------------------
    // Custom webhook tools (always included — they're user-configured)
    // -------------------------------------------------------------------
    await this.buildCustomWebhookTools(tools, stationId);

    // -------------------------------------------------------------------
    // Meta-tool: request_tools — lets the model request packs it needs
    // that were not initially selected by the keyword heuristic.
    // -------------------------------------------------------------------
    const deferredPacks = ALL_TOOL_PACKS.filter(
      (p) => enabledPacks.has(p) && !activePacks.has(p)
    );
    if (deferredPacks.length > 0) {
      tools.request_tools = this.buildRequestToolsMeta(
        deferredPacks,
        stationId,
        organizationId,
        stationData,
        enabledPacks
      );
    }

    logger.info(
      {
        stationId,
        toolCount: Object.keys(tools).length,
        activePacks: [...activePacks],
        deferred: deferredPacks,
      },
      "Analytics tools built (lazy)"
    );

    return tools;
  }

  // -----------------------------------------------------------------------
  // Meta-tool builder
  // -----------------------------------------------------------------------

  /**
   * Build a `request_tools` meta-tool that lets the model dynamically
   * load tool packs that were deferred during the initial selection.
   *
   * The tool returns a confirmation message listing the newly available
   * tools. Because `streamText` does not support mutating the tool set
   * mid-stream, the result instructs the model to inform the user and
   * the next turn will automatically include the requested packs (the
   * conversation history will contain the request_tools call, which
   * the system uses to expand packs on the following stream).
   */
  private static buildRequestToolsMeta(
    deferredPacks: string[],
    _stationId: string,
    _organizationId: string,
    _stationData: unknown,
    _enabledPacks: Set<string>
  ): Tool {
    const packDescriptions: Record<string, string> = {
      data_query: "visualize, visualize_tree — chart and diagram generation",
      statistics:
        "describe_column, correlate, detect_outliers, cluster — statistical analysis",
      regression: "regression, trend — regression and forecasting",
      financial:
        "technical_indicator, npv, irr, amortize, sharpe_ratio, max_drawdown, rolling_returns — financial analysis",
      web_search: "web_search — internet search",
    };

    const available = deferredPacks
      .map((p) => `• ${p}: ${packDescriptions[p] ?? p}`)
      .join("\n");

    return tool({
      description:
        `Request additional tool packs that are not currently loaded. ` +
        `Call this when you need a capability not available in your current tools. ` +
        `Available packs:\n${available}`,
      inputSchema: z.object({
        packs: z
          .array(z.enum(deferredPacks as [string, ...string[]]))
          .describe("Tool pack names to load"),
      }),
      execute: async ({ packs }) => {
        return {
          status: "deferred",
          message:
            `Tool packs [${packs.join(", ")}] will be available on your next response. ` +
            `Let the user know you are loading additional tools and will continue in your next turn.`,
          requestedPacks: packs,
        };
      },
    });
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
