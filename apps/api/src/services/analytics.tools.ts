/**
 * Analytics Tool Definitions — Vercel AI SDK `tool()` wrappers around
 * `AnalyticsService` methods and user-registered webhook tools.
 *
 * Every tool is conditional on a pack being selected for the station —
 * there are no always-on tools.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global AbortController, fetch */

import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  AnalyticsService,
  type StationData,
  type EntityGroupContext,
} from "./analytics.service.js";
import { AiService } from "./ai.service.js";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "analytics-tools" });

// ---------------------------------------------------------------------------
// Pack tool names — used to detect shadow conflicts with webhook tools
// ---------------------------------------------------------------------------

const PACK_TOOL_NAMES = new Set([
  "sql_query",
  "visualize",
  "visualize_tree",
  "build_tree",
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
]);

// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 30_000;

export interface WebhookImplementation {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
}

/**
 * POST to a webhook URL with auth headers and a 30 s timeout.
 * Returns parsed JSON response.
 */
export async function callWebhook(
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

// ---------------------------------------------------------------------------
// JSON Schema → Zod conversion (lightweight)
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema object to a Zod schema at runtime.
 * Supports the subset of JSON Schema commonly used by webhook tool definitions.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(
        schema.items
          ? jsonSchemaToZod(schema.items as Record<string, unknown>)
          : z.unknown()
      );
    case "object": {
      const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const required = new Set(
        (schema.required as string[] | undefined) ?? []
      );
      const shape: Record<string, z.ZodType> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.has(key) ? zodProp : zodProp.optional();
      }

      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Build all analytics tools for a station based on its enabled tool packs.
 *
 * @throws If `station.toolPacks` is empty.
 */
export async function buildAnalyticsTools(
  organizationId: string,
  stationId: string
): Promise<Record<string, Tool>> {
  const repo = DbService.repository;

  // Load station and validate packs
  const station = await repo.stations.findById(stationId);
  if (!station) throw new Error(`Station not found: ${stationId}`);

  const toolPacks = (station as any).toolPacks as string[];
  if (!toolPacks || toolPacks.length === 0) {
    throw new Error("Station must have at least one tool pack enabled");
  }

  const packs = new Set<string>(toolPacks);

  // Load station data into memory
  const stationData = await AnalyticsService.loadStation(
    stationId,
    organizationId
  );

  const tools: Record<string, Tool> = {};

  // -----------------------------------------------------------------------
  // Pack: data_query
  // -----------------------------------------------------------------------
  if (packs.has("data_query")) {
    tools.sql_query = tool({
      description:
        "Execute a SQL query against the station's loaded data tables. " +
        "Each entity is a table named by its key. Use standard SQL syntax.",
      inputSchema: z.object({
        sql: z.string().describe("The SQL query to execute"),
      }),
      execute: async ({ sql }) =>
        AnalyticsService.sqlQuery({ sql, stationId }),
    });

    tools.visualize = tool({
      description:
        "Run a SQL query and inject the results into a Vega-Lite specification for charting.",
      inputSchema: z.object({
        sql: z.string().describe("SQL query to fetch chart data"),
        vegaLiteSpec: z
          .record(z.string(), z.unknown())
          .describe("Vega-Lite spec (data field will be overwritten)"),
      }),
      execute: async ({ sql, vegaLiteSpec }) =>
        AnalyticsService.visualize({ sql, vegaLiteSpec, stationId }),
    });

    tools.visualize_tree = tool({
      description:
        "Build a full Vega spec for hierarchical or network visualizations " +
        "(trees, treemaps, sunbursts, force-directed graphs). " +
        "Use this instead of visualize when the chart requires Vega transforms " +
        "like stratify, tree, force, or treemap.",
      inputSchema: z.object({
        sql: z.string().describe("SQL query to fetch node/link data"),
        vegaSpec: z
          .record(z.string(), z.unknown())
          .describe(
            "Full Vega spec — data[0].values will be overwritten with query results"
          ),
      }),
      execute: async ({ sql, vegaSpec }) =>
        AnalyticsService.visualizeVega({ sql, vegaSpec, stationId }),
    });

    tools.build_tree = tool({
      description:
        "Build an interactive tree diagram from flat parent-child data. " +
        "Returns a nested hierarchy for rendering as a collapsible tree.",
      inputSchema: z.object({
        sql: z
          .string()
          .describe(
            "SQL returning rows with at least `id`, `parentId`, and `name` columns"
          ),
        labelColumn: z
          .string()
          .describe("Column to use as node labels")
          .default("name"),
        attributeColumns: z
          .array(z.string())
          .describe("Extra columns to display on each node")
          .optional(),
      }),
      execute: async ({ sql, labelColumn, attributeColumns }) =>
        AnalyticsService.buildTree({
          sql,
          labelColumn,
          attributeColumns,
          stationId,
        }),
    });

    // resolve_identity — only when ≥1 Entity Group has ≥2 loaded members
    if (stationData.entityGroups.length > 0) {
      tools.resolve_identity = buildResolveIdentityTool(
        stationId,
        stationData.entityGroups
      );
    }
  }

  // -----------------------------------------------------------------------
  // Pack: statistics
  // -----------------------------------------------------------------------
  if (packs.has("statistics")) {
    tools.describe_column = tool({
      description:
        "Compute descriptive statistics (count, mean, median, stddev, min, max, p25, p75) for a numeric column.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        column: z.string().describe("Numeric column key"),
      }),
      execute: async ({ entity, column }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.describeColumn({ records, column });
      },
    });

    tools.correlate = tool({
      description:
        "Compute Pearson correlation coefficient between two numeric columns.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        columnA: z.string().describe("First numeric column"),
        columnB: z.string().describe("Second numeric column"),
      }),
      execute: async ({ entity, columnA, columnB }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.correlate({ records, columnA, columnB });
      },
    });

    tools.detect_outliers = tool({
      description:
        "Detect outliers in a numeric column using IQR or Z-score method.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        column: z.string().describe("Numeric column key"),
        method: z
          .enum(["iqr", "zscore"])
          .describe("Detection method: iqr or zscore"),
      }),
      execute: async ({ entity, column, method }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.detectOutliers({ records, column, method });
      },
    });

    tools.cluster = tool({
      description:
        "Perform k-means clustering on specified numeric columns.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        columns: z
          .array(z.string())
          .describe("Numeric columns to cluster on"),
        k: z.number().int().min(2).describe("Number of clusters"),
      }),
      execute: async ({ entity, columns, k }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.cluster({ records, columns, k });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Pack: regression
  // -----------------------------------------------------------------------
  if (packs.has("regression")) {
    tools.regression = tool({
      description:
        "Perform linear or polynomial regression between two numeric columns. Returns coefficients and R-squared.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        x: z.string().describe("Independent variable column"),
        y: z.string().describe("Dependent variable column"),
        type: z
          .enum(["linear", "polynomial"])
          .describe("Regression type"),
      }),
      execute: async ({ entity, x, y, type }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.regression({ records, x, y, type });
      },
    });

    tools.trend = tool({
      description:
        "Aggregate a time series by interval and compute a linear trend line.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        dateColumn: z.string().describe("Date column key"),
        valueColumn: z.string().describe("Numeric value column key"),
        interval: z
          .enum(["day", "week", "month", "quarter", "year"])
          .describe("Aggregation interval"),
      }),
      execute: async ({ entity, dateColumn, valueColumn, interval }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.trend({
          records,
          dateColumn,
          valueColumn,
          interval,
        });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Pack: financial
  // -----------------------------------------------------------------------
  if (packs.has("financial")) {
    tools.technical_indicator = tool({
      description:
        "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV) on a time series.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        dateColumn: z.string().describe("Date column key"),
        valueColumn: z.string().describe("Price/value column key"),
        indicator: z
          .enum(["SMA", "EMA", "RSI", "MACD", "BB", "ATR", "OBV"])
          .describe("Indicator type"),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional indicator parameters (e.g. period, stdDev)"),
      }),
      execute: async ({ entity, dateColumn, valueColumn, indicator, params }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.technicalIndicator({
          records,
          dateColumn,
          valueColumn,
          indicator,
          params,
        });
      },
    });

    tools.npv = tool({
      description:
        "Compute net present value given a discount rate and cash flow series.",
      inputSchema: z.object({
        rate: z.number().describe("Discount rate (e.g. 0.1 for 10%)"),
        cashFlows: z
          .array(z.number())
          .describe("Cash flows (first is usually negative initial investment)"),
      }),
      execute: async ({ rate, cashFlows }) =>
        AnalyticsService.npv({ rate, cashFlows }),
    });

    tools.irr = tool({
      description:
        "Compute internal rate of return for a cash flow series.",
      inputSchema: z.object({
        cashFlows: z
          .array(z.number())
          .describe("Cash flows (first is usually negative initial investment)"),
      }),
      execute: async ({ cashFlows }) =>
        AnalyticsService.irr({ cashFlows }),
    });

    tools.amortize = tool({
      description:
        "Generate a loan amortization schedule with payment, principal, interest, and balance per period.",
      inputSchema: z.object({
        principal: z.number().describe("Loan principal amount"),
        annualRate: z
          .number()
          .describe("Annual interest rate (e.g. 0.06 for 6%)"),
        periods: z.number().int().describe("Number of payment periods"),
      }),
      execute: async ({ principal, annualRate, periods }) =>
        AnalyticsService.amortize({ principal, annualRate, periods }),
    });

    tools.sharpe_ratio = tool({
      description:
        "Compute the Sharpe ratio from a series of values. Optionally annualize for daily data.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        valueColumn: z.string().describe("Value/price column key"),
        riskFreeRate: z
          .number()
          .optional()
          .describe("Risk-free rate (default 0)"),
        annualize: z
          .boolean()
          .optional()
          .describe("Multiply by √252 for daily data"),
      }),
      execute: async ({ entity, valueColumn, riskFreeRate, annualize }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.sharpeRatio({
          records,
          valueColumn,
          riskFreeRate,
          annualize,
        });
      },
    });

    tools.max_drawdown = tool({
      description:
        "Compute maximum drawdown (peak-to-trough decline) from a time series.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        dateColumn: z.string().describe("Date column key"),
        valueColumn: z.string().describe("Value/price column key"),
      }),
      execute: async ({ entity, dateColumn, valueColumn }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.maxDrawdown({
          records,
          dateColumn,
          valueColumn,
        });
      },
    });

    tools.rolling_returns = tool({
      description:
        "Compute period-over-period returns within a rolling window.",
      inputSchema: z.object({
        entity: z.string().describe("Entity key (table name)"),
        dateColumn: z.string().describe("Date column key"),
        valueColumn: z.string().describe("Value/price column key"),
        window: z.number().int().min(1).describe("Rolling window size"),
      }),
      execute: async ({ entity, dateColumn, valueColumn, window: w }) => {
        const records = getRecords(stationData, entity);
        return AnalyticsService.rollingReturns({
          records,
          dateColumn,
          valueColumn,
          window: w,
        });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Pack: web_search
  // -----------------------------------------------------------------------
  if (packs.has("web_search")) {
    tools.web_search = AiService.buildWebSearchTool();
  }

  // -----------------------------------------------------------------------
  // Custom webhook tools
  // -----------------------------------------------------------------------
  const stationToolRows = await repo.stationTools.findByStationId(stationId);

  for (const row of stationToolRows) {
    const def = row.organizationTool;
    const toolName = def.name;

    // Validate no shadow conflict with pack tools
    if (PACK_TOOL_NAMES.has(toolName)) {
      throw new Error(
        `Custom tool "${toolName}" conflicts with a built-in pack tool name`
      );
    }

    const parameterSchema = jsonSchemaToZod(
      def.parameterSchema as Record<string, unknown>
    );
    const implementation = def.implementation as unknown as WebhookImplementation;

    tools[toolName] = tool({
      description: def.description ?? `Custom tool: ${toolName}`,
      inputSchema: parameterSchema as any,
      execute: async (input: Record<string, unknown>) => {
        logger.info(
          { toolName, stationId, url: implementation.url },
          "Calling webhook tool"
        );
        const result = await callWebhook(implementation, input);

        // Propagate vega-lite and vega chart results
        if (
          result &&
          typeof result === "object" &&
          (result as any).type === "vega-lite" &&
          (result as any).spec
        ) {
          return { type: "vega-lite", spec: (result as any).spec };
        }
        if (
          result &&
          typeof result === "object" &&
          (result as any).type === "vega"
        ) {
          return result;
        }

        return result;
      },
    });
  }

  logger.info(
    { stationId, toolCount: Object.keys(tools).length, packs: toolPacks },
    "Analytics tools built"
  );

  return tools;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResolveIdentityTool(
  stationId: string,
  entityGroups: EntityGroupContext[]
): Tool {
  return tool({
    description:
      "Find all records across an Entity Group's member entities that share a given link value. " +
      "Returns matches grouped by source entity with the primary entity first.",
    inputSchema: z.object({
      entityGroupName: z.string().describe("Name of the Entity Group"),
      linkValue: z
        .string()
        .describe("The link value to search for across member entities"),
    }),
    execute: async ({ entityGroupName, linkValue }) =>
      AnalyticsService.resolveIdentity({
        entityGroupName,
        linkValue,
        stationId,
        entityGroups,
      }),
  });
}

function getRecords(
  stationData: StationData,
  entityKey: string
): Record<string, unknown>[] {
  const records = stationData.records.get(entityKey);
  if (!records) {
    throw new Error(`Entity "${entityKey}" not found in loaded station data`);
  }
  return records;
}
