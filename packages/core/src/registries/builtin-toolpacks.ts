/**
 * Built-in toolpack registry.
 *
 * Source of truth for the six built-in tool packs and the tools they
 * contain. Imported by both API and web — the API hydrates its
 * `GET /api/toolpacks` response from this list and the web app uses
 * the same records to render the metadata modal and label the
 * `ToolPackChip`.
 *
 * The actual executable tool implementations remain in
 * `apps/api/src/tools/`; this registry only documents what each pack
 * exposes. Descriptions and parameter schemas here are hand-authored
 * to match the corresponding `Tool` class. If they drift, the modal
 * and `tools.service.ts` disagree — a follow-up may codegen this from
 * the Zod input schemas to eliminate the drift risk.
 */

import { z } from "zod";

// ── Slugs ─────────────────────────────────────────────────────────────

export const BuiltinToolpackSlugSchema = z.enum([
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
]);

export type BuiltinToolpackSlug = z.infer<typeof BuiltinToolpackSlugSchema>;

// ── Tool & example shapes ─────────────────────────────────────────────

export interface ToolpackToolExample {
  title?: string;
  description?: string;
  input?: unknown;
  output?: unknown;
}

/**
 * Opt-in metadata that allows a tool to be dispatched per-record by
 * the bulk-transform processor (#85 Phase 4). When set, the tool is
 * eligible for `bulk_transform_entity_records` with
 * `expression.kind === "tool"`; the dispatcher uses these values to
 * fan out within bounded concurrency / rate / timeout.
 *
 * `costHint` drives the route's cost-acknowledgement gate:
 *  - "free": no gate; agent dispatches freely.
 *  - "metered": agent surfaces cost + ETA to user, no API gate.
 *  - "expensive": route requires `acknowledgeCost: true`; agent
 *    must confirm before dispatching.
 */
export interface BulkDispatchMetadata {
  maxConcurrency: number;
  timeoutMs: number;
  ratePerSec?: number;
  idempotent: boolean;
  estimatedMsPerCall?: number;
  costHint?: "free" | "metered" | "expensive";
}

export interface ToolpackTool {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  examples?: ToolpackToolExample[];
  /** Opt-in: declares the tool can be bulk-dispatched per-record by
   *  `bulk_transform_entity_records`. Tools without this field are
   *  rejected from the tool-kind dispatch route. */
  bulkDispatch?: BulkDispatchMetadata;
}

export interface BuiltinToolpack {
  slug: BuiltinToolpackSlug;
  name: string;
  description: string;
  iconSlug: string;
  tools: ToolpackTool[];
}

// ── Helpers for declaring schemas inline ──────────────────────────────

/** Build a JSON-Schema-shaped object literal for a tool's inputs. */
function objectSchema(
  properties: Record<string, Record<string, unknown>>,
  required?: string[]
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (required && required.length > 0) schema.required = required;
  return schema;
}

const stringField = (description: string) => ({ type: "string", description });
const numberField = (description: string) => ({ type: "number", description });
const integerField = (description: string) => ({
  type: "integer",
  description,
});
const booleanField = (description: string) => ({
  type: "boolean",
  description,
});
const stringArrayField = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});
const numberArrayField = (description: string) => ({
  type: "array",
  items: { type: "number" },
  description,
});
const enumField = (values: string[], description: string) => ({
  type: "string",
  enum: values,
  description,
});

// ── Registry ──────────────────────────────────────────────────────────

const DATA_QUERY_PACK: BuiltinToolpack = {
  slug: "data_query",
  name: "Data Query",
  description:
    "Run SQL queries against entity data, render Vega-Lite or Vega charts from query results, and resolve identities across an Entity Group.",
  iconSlug: "Storage",
  tools: [
    {
      name: "sql_query",
      description:
        "Executes a SQL query against a specified database connection and returns the results as JSON.",
      parameterSchema: objectSchema(
        { sql: stringField("The SQL query to execute") },
        ["sql"]
      ),
      examples: [
        {
          title: "Aggregate orders by status",
          input: {
            sql: "SELECT status, COUNT(*) AS n FROM orders GROUP BY status",
          },
          output: {
            rows: [
              { status: "open", n: 12 },
              { status: "shipped", n: 87 },
            ],
          },
        },
      ],
    },
    {
      name: "visualize",
      description:
        "Run a SQL query and inject the results into a Vega-Lite specification for charting.",
      parameterSchema: objectSchema(
        {
          sql: stringField("The SQL query whose rows feed the chart"),
          spec: {
            type: "object",
            description:
              "A Vega-Lite v5 spec. Do NOT include a `data` field — it is populated from the SQL query results.",
          },
        },
        ["sql", "spec"]
      ),
    },
    {
      name: "visualize_tree",
      description:
        "Build a full Vega spec for hierarchical or network visualizations (trees, treemaps, sunbursts, force-directed graphs).",
      parameterSchema: objectSchema(
        {
          sql: stringField("The SQL query whose rows feed the chart"),
          spec: {
            type: "object",
            description:
              "A Vega v5 spec. Must include a `data` array; data[0].values is overwritten with SQL results.",
          },
        },
        ["sql", "spec"]
      ),
    },
    {
      name: "resolve_identity",
      description:
        "Find all records across an Entity Group's member entities that share a given link value. Returns matches grouped by source entity with the primary entity first.",
      parameterSchema: objectSchema(
        {
          entityGroupName: stringField("Name of the Entity Group"),
          linkValue: stringField(
            "The link value to search for across member entities"
          ),
        },
        ["entityGroupName", "linkValue"]
      ),
    },
  ],
};

const STATISTICS_PACK: BuiltinToolpack = {
  slug: "statistics",
  name: "Statistics",
  description:
    "Descriptive statistics, correlation, outlier detection, k-means clustering, group-by aggregation, and hypothesis testing for numeric columns.",
  iconSlug: "BarChart",
  tools: [
    {
      name: "describe_column",
      description:
        "Compute descriptive statistics (count, mean, median, stddev, variance, mode, min/max, p25/p75, IQR, skewness, kurtosis) for a numeric column. Optionally include arbitrary percentiles.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key (table name)"),
          column: stringField("Numeric column key"),
          percentiles: {
            type: "array",
            items: { type: "number", minimum: 0, maximum: 1 },
            description:
              "Optional list of percentiles to compute (each in [0, 1]).",
          },
        },
        ["entity", "column"]
      ),
      examples: [
        {
          title: "Describe order amounts",
          input: { entity: "orders", column: "amount" },
          output: {
            count: 144,
            mean: 312.4,
            median: 250,
            p25: 110,
            p75: 480,
            stddev: 215.7,
          },
        },
      ],
    },
    {
      name: "correlate",
      description:
        "Compute the correlation between two numeric columns. Supports Pearson (default), Spearman (rank-based, monotonic), and Kendall τ-b.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key (table name)"),
          columnA: stringField("First numeric column"),
          columnB: stringField("Second numeric column"),
          method: enumField(
            ["pearson", "spearman", "kendall"],
            "Correlation method. Default 'pearson'."
          ),
        },
        ["entity", "columnA", "columnB"]
      ),
    },
    {
      name: "detect_outliers",
      description:
        "Detect outliers in a numeric column using IQR, Z-score, or modified Z (MAD).",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key (table name)"),
          column: stringField("Numeric column key"),
          method: enumField(
            ["iqr", "zscore", "mad"],
            "Detection method: iqr, zscore, or mad (median absolute deviation)"
          ),
          threshold: numberField(
            "Cutoff: IQR multiplier (default 1.5), |z| cutoff (default 3), or |modified z| cutoff (default 3.5)"
          ),
        },
        ["entity", "column", "method"]
      ),
    },
    {
      name: "cluster",
      description: "Perform k-means clustering on specified numeric columns.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key (table name)"),
          columns: stringArrayField("Numeric columns to cluster on"),
          k: integerField("Number of clusters (>= 2)"),
          standardize: booleanField(
            "Z-score each column before clustering. Centroids are returned in original units. Default false."
          ),
          seed: integerField("Seed for reproducible cluster initialization"),
          maxIterations: integerField("Maximum k-means iterations"),
        },
        ["entity", "columns", "k"]
      ),
    },
    {
      name: "aggregate",
      description:
        "Group-by + reduce. Produces one row per group with the requested metrics.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity (table) to aggregate"),
          groupBy: stringArrayField(
            "Columns to group by. Pass [] to aggregate over the whole table."
          ),
          metrics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                column: stringField(
                  "Numeric column the operation runs over. Omit when op is 'count'."
                ),
                op: enumField(
                  [
                    "count",
                    "sum",
                    "mean",
                    "median",
                    "min",
                    "max",
                    "stddev",
                    "p25",
                    "p75",
                  ],
                  "Aggregation operator"
                ),
                alias: stringField("Output column name (defaults to op_column)"),
              },
              required: ["op"],
            },
            description: "List of metrics to compute per group.",
          },
        },
        ["entity", "groupBy", "metrics"]
      ),
    },
    {
      name: "hypothesis_test",
      description:
        "Run a hypothesis test (one-sample / two-sample / paired t-test, Mann-Whitney U, or chi-squared) and return the statistic and a two-tailed p-value.",
      parameterSchema: objectSchema(
        {
          test: enumField(
            [
              "t_test_one_sample",
              "t_test_two_sample",
              "t_test_paired",
              "mann_whitney",
              "chi_squared",
            ],
            "Which test to run."
          ),
          entity: stringField("Entity key. Required for column-based tests."),
          column: stringField("Numeric column for one-sample / paired tests"),
          columnB: stringField("Second column for two-sample / paired tests"),
          mu0: numberField(
            "Hypothesized mean for one-sample t-test. Default 0."
          ),
        },
        ["test"]
      ),
    },
  ],
};

const REGRESSION_PACK: BuiltinToolpack = {
  slug: "regression",
  name: "Regression",
  description:
    "Linear, multivariate, polynomial, and logistic regression; trend lines; time-series decomposition, forecasting, and changepoint detection.",
  iconSlug: "TrendingUp",
  tools: [
    {
      name: "regression",
      description:
        "Perform linear, multivariate-linear, or polynomial regression. Returns coefficients, R-squared, residuals, standard errors, t-statistics, p-values, and confidence intervals on each coefficient.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          x: stringField(
            "Independent variable column (linear / polynomial only)"
          ),
          xColumns: stringArrayField(
            "Independent variables for multivariate-linear regression"
          ),
          y: stringField("Dependent variable column"),
          type: enumField(
            ["linear", "multivariate", "polynomial"],
            "Regression type"
          ),
          degree: integerField(
            "Polynomial degree (default 2; ignored for linear/multivariate)"
          ),
          intercept: booleanField(
            "Fit an intercept term (default true). Force through origin when false."
          ),
        },
        ["entity", "y", "type"]
      ),
      examples: [
        {
          title: "Linear fit of price vs. square footage",
          input: {
            entity: "listings",
            x: "sqft",
            y: "price",
            type: "linear",
          },
          output: {
            coefficients: [25000, 188.4],
            rSquared: 0.74,
          },
        },
      ],
    },
    {
      name: "logistic_regression",
      description:
        "Binary logistic regression via IRLS. Returns coefficients (intercept first), per-row predicted probabilities, log-loss, accuracy at threshold 0.5, and IRLS iteration count.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          xColumns: stringArrayField("Predictor columns"),
          y: stringField("Binary outcome column (0/1, true/false)"),
        },
        ["entity", "xColumns", "y"]
      ),
    },
    {
      name: "trend",
      description:
        "Aggregate a time series by interval and compute a linear trend line.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          dateColumn: stringField("Date / timestamp column"),
          valueColumn: stringField("Numeric column to aggregate"),
          interval: enumField(
            ["day", "week", "month", "quarter", "year"],
            "Bucket size"
          ),
          forecastPeriods: integerField(
            "Periods past the last bucket to project the linear fit"
          ),
        },
        ["entity", "dateColumn", "valueColumn", "interval"]
      ),
    },
    {
      name: "changepoint",
      description:
        "Detect mean-shift changepoints in a numeric series via CUSUM. Returns indices, optional dates, per-segment means, and segment ranges.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          column: stringField("Numeric column"),
          dateColumn: stringField(
            "Optional date column to attach to each changepoint"
          ),
          minSegmentSize: integerField(
            "Minimum points per segment (default 5)"
          ),
        },
        ["entity", "column"]
      ),
    },
    {
      name: "decompose",
      description:
        "Classical seasonal decomposition of a time series into trend, seasonal, and residual components. Additive or multiplicative.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          dateColumn: stringField("Date column"),
          valueColumn: stringField("Numeric column to decompose"),
          period: integerField(
            "Seasonal period (e.g. 12 for monthly data with annual seasonality)"
          ),
          model: enumField(
            ["additive", "multiplicative"],
            "Decomposition model"
          ),
        },
        ["entity", "dateColumn", "valueColumn", "period"]
      ),
    },
    {
      name: "forecast",
      description:
        "Holt-Winters exponential smoothing forecast. Returns in-sample fits, multi-step point forecasts, prediction intervals, and MAPE.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          dateColumn: stringField("Date column"),
          valueColumn: stringField("Numeric column to forecast"),
          horizon: integerField("Number of future periods to forecast"),
          period: integerField("Seasonal period (omit for non-seasonal)"),
          alpha: numberField("Level smoothing parameter (default 0.5)"),
          beta: numberField("Trend smoothing parameter (default 0.1)"),
          gamma: numberField("Seasonal smoothing parameter (default 0.1)"),
        },
        ["entity", "dateColumn", "valueColumn", "horizon"]
      ),
    },
  ],
};

const FINANCIAL_PACK: BuiltinToolpack = {
  slug: "financial",
  name: "Financial",
  description:
    "Time-value-of-money, NPV/IRR (regular and irregular dates), depreciation, amortization, technical indicators, and portfolio risk metrics.",
  iconSlug: "AccountBalance",
  tools: [
    {
      name: "tvm",
      description:
        "Time-value-of-money. Solve for present value, future value, payment, rate, or number of periods given the other inputs.",
      parameterSchema: objectSchema(
        {
          op: enumField(
            ["pv", "fv", "pmt", "rate", "nper"],
            "Which variable to solve for"
          ),
          rate: numberField("Periodic interest rate"),
          nper: numberField("Number of periods"),
          pmt: numberField("Per-period payment"),
          pv: numberField("Present value"),
          fv: numberField("Future value"),
          when: enumField(
            ["end", "begin"],
            "When in the period payments are made (default end)"
          ),
        },
        ["op"]
      ),
      examples: [
        {
          title: "Compute monthly mortgage payment",
          input: {
            op: "pmt",
            rate: 0.06 / 12,
            nper: 360,
            pv: -200000,
            fv: 0,
          },
          output: { pmt: 1199.1 },
        },
      ],
    },
    {
      name: "npv",
      description:
        "Compute net present value given a discount rate and cash flow series.",
      parameterSchema: objectSchema(
        {
          rate: numberField("Periodic discount rate"),
          cashFlows: numberArrayField(
            "Cash flow series (negative = outflow). First element is t=0."
          ),
        },
        ["rate", "cashFlows"]
      ),
    },
    {
      name: "irr",
      description: "Compute internal rate of return for a cash flow series.",
      parameterSchema: objectSchema(
        {
          cashFlows: numberArrayField(
            "Cash flow series. Must contain at least one positive and one negative value."
          ),
          guess: numberField("Initial guess for the rate (default 0.1)"),
        },
        ["cashFlows"]
      ),
    },
    {
      name: "xnpv",
      description:
        "Net present value over irregular-date cashflows (Excel XNPV semantics).",
      parameterSchema: objectSchema(
        {
          rate: numberField("Annualized discount rate"),
          dates: stringArrayField("ISO dates aligned with cashFlows"),
          cashFlows: numberArrayField("Cash flows aligned with dates"),
        },
        ["rate", "dates", "cashFlows"]
      ),
    },
    {
      name: "xirr",
      description:
        "Internal rate of return over irregular-date cashflows (Excel XIRR semantics).",
      parameterSchema: objectSchema(
        {
          dates: stringArrayField("ISO dates aligned with cashFlows"),
          cashFlows: numberArrayField("Cash flows aligned with dates"),
          guess: numberField("Initial guess (default 0.1)"),
        },
        ["dates", "cashFlows"]
      ),
    },
    {
      name: "depreciation",
      description:
        "Compute a depreciation schedule (or a single period) using straight-line, declining-balance, or double-declining-balance.",
      parameterSchema: objectSchema(
        {
          method: enumField(
            ["straight_line", "declining_balance", "double_declining_balance"],
            "Depreciation method"
          ),
          cost: numberField("Asset cost"),
          salvage: numberField("Salvage value"),
          life: integerField("Useful life in periods"),
          period: integerField("Optional single period to return"),
        },
        ["method", "cost", "salvage", "life"]
      ),
    },
    {
      name: "amortize",
      description:
        "Generate a loan amortization schedule with payment, principal, interest, and balance per period. Supports weekly, biweekly, monthly, quarterly, or annual compounding and optional extra principal payments.",
      parameterSchema: objectSchema(
        {
          principal: numberField("Loan principal"),
          annualRate: numberField("Annual interest rate (e.g. 0.06)"),
          periods: integerField("Total number of periods"),
          compounding: enumField(
            ["weekly", "biweekly", "monthly", "quarterly", "annual"],
            "Compounding frequency (default monthly)"
          ),
          extraPayment: numberField(
            "Additional principal payment per period"
          ),
        },
        ["principal", "annualRate", "periods"]
      ),
    },
    {
      name: "sharpe_ratio",
      description:
        "Compute the Sharpe ratio from a series of values. Optionally annualize via the `periodicity` field (daily, weekly, monthly, quarterly, annual).",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          column: stringField("Returns column"),
          riskFreeRate: numberField("Per-period risk-free rate (default 0)"),
          periodicity: enumField(
            ["daily", "weekly", "monthly", "quarterly", "annual"],
            "Annualization periodicity"
          ),
        },
        ["entity", "column"]
      ),
    },
    {
      name: "max_drawdown",
      description:
        "Compute maximum drawdown (peak-to-trough decline) from a time series.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          column: stringField("Numeric column"),
        },
        ["entity", "column"]
      ),
    },
    {
      name: "rolling_returns",
      description:
        "Compute period-over-period returns within a rolling window.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          column: stringField("Numeric column"),
          window: integerField("Rolling window size in periods"),
        },
        ["entity", "column", "window"]
      ),
    },
    {
      name: "var_cvar",
      description:
        "Compute Value-at-Risk and Conditional VaR (Expected Shortfall) at a confidence level. Both return positive loss magnitudes.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          column: stringField("Returns column"),
          confidence: numberField("Confidence level in (0, 1) (default 0.95)"),
          method: enumField(
            ["historical", "parametric"],
            "Estimation method"
          ),
        },
        ["entity", "column"]
      ),
    },
    {
      name: "portfolio_metrics",
      description:
        "Compute portfolio performance metrics: total return, CAGR, Sortino, Calmar, max drawdown. With a benchmark: beta, alpha, information ratio, tracking error, up/down capture.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key holding the returns series"),
          column: stringField("Returns column"),
          benchmarkEntity: stringField("Optional benchmark entity"),
          benchmarkColumn: stringField("Optional benchmark column"),
        },
        ["entity", "column"]
      ),
    },
    {
      name: "bond_math",
      description:
        "Fixed-coupon bond pricing: price, yield-to-maturity, Macaulay/modified duration, and convexity. Bullet bonds only.",
      parameterSchema: objectSchema(
        {
          op: enumField(
            ["price", "ytm", "duration", "convexity"],
            "Which quantity to compute"
          ),
          face: numberField("Face value"),
          coupon: numberField("Annual coupon rate (e.g. 0.05)"),
          maturity: numberField("Years to maturity"),
          frequency: integerField(
            "Coupon payments per year (1, 2, or 4)"
          ),
          price: numberField("Clean price (required when solving for ytm)"),
          yield: numberField(
            "Yield (required when solving for price/duration/convexity)"
          ),
        },
        ["op", "face", "coupon", "maturity", "frequency"]
      ),
    },
    {
      name: "technical_indicator",
      description:
        "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV, Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud, Donchian Channels) on a time series.",
      parameterSchema: objectSchema(
        {
          entity: stringField("Entity key"),
          dateColumn: stringField("Date column"),
          indicator: enumField(
            [
              "SMA",
              "EMA",
              "RSI",
              "MACD",
              "BollingerBands",
              "ATR",
              "OBV",
              "Stochastic",
              "ADX",
              "VWAP",
              "WilliamsR",
              "CCI",
              "ROC",
              "PSAR",
              "Ichimoku",
              "Donchian",
            ],
            "Indicator name"
          ),
          period: integerField("Lookback period"),
          closeColumn: stringField("Close-price column"),
          highColumn: stringField("High-price column (when required)"),
          lowColumn: stringField("Low-price column (when required)"),
          volumeColumn: stringField("Volume column (when required)"),
        },
        ["entity", "dateColumn", "indicator"]
      ),
    },
  ],
};

const WEB_SEARCH_PACK: BuiltinToolpack = {
  slug: "web_search",
  name: "Web Search",
  description:
    "Search the public web for current information beyond the model's training cutoff.",
  iconSlug: "Search",
  tools: [
    {
      name: "web_search",
      description:
        "Search the web for current information. Use this when the prompt requires real-time or recent data.",
      parameterSchema: objectSchema(
        { query: stringField("Search query") },
        ["query"]
      ),
      examples: [
        {
          title: "Find recent news",
          input: { query: "latest 10-K filing for AAPL" },
        },
      ],
    },
  ],
};

const ENTITY_MANAGEMENT_PACK: BuiltinToolpack = {
  slug: "entity_management",
  name: "Entity Management",
  description:
    "Create, update, and delete entity records, connector entities, and field mappings on stations whose connectors permit writes. Each tool accepts 1–100 items per call.",
  iconSlug: "Edit",
  tools: [
    {
      name: "entity_record_create",
      description:
        "Creates one or more entity records with auto-normalized data. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connectorEntityId: stringField("Target connector entity"),
                data: {
                  type: "object",
                  description: "Record payload keyed by field name",
                },
              },
              required: ["connectorEntityId", "data"],
            },
            description: "1–100 records to create.",
          },
        },
        ["items"]
      ),
      examples: [
        {
          title: "Insert a single customer record",
          input: {
            items: [
              {
                connectorEntityId: "ce_123",
                data: { email: "alice@example.com", name: "Alice" },
              },
            ],
          },
        },
      ],
    },
    {
      name: "entity_record_update",
      description:
        "Updates one or more entity records' data and normalized data. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: stringField("Record id"),
                data: { type: "object" },
              },
              required: ["id", "data"],
            },
          },
        },
        ["items"]
      ),
    },
    {
      name: "entity_record_delete",
      description:
        "Soft-deletes one or more entity records. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        { ids: stringArrayField("Record ids") },
        ["ids"]
      ),
    },
    {
      name: "connector_entity_create",
      description:
        "Creates one or more connector entities under attached connector instances. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connectorInstanceId: stringField("Target connector instance"),
                label: stringField("Entity label"),
                refKey: stringField("Stable external reference key"),
              },
              required: ["connectorInstanceId", "label"],
            },
          },
        },
        ["items"]
      ),
    },
    {
      name: "connector_entity_update",
      description:
        "Updates one or more connector entities' labels. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: stringField("Connector entity id"),
                label: stringField("New label"),
              },
              required: ["id", "label"],
            },
          },
        },
        ["items"]
      ),
    },
    {
      name: "connector_entity_delete",
      description:
        "Deletes one or more connector entities and all dependent records, field mappings, tags, and group memberships. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        { ids: stringArrayField("Connector entity ids") },
        ["ids"]
      ),
    },
    {
      name: "field_mapping_create",
      description:
        "Creates or updates one or more field mappings between source fields and column definitions. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connectorEntityId: stringField("Connector entity"),
                columnDefinitionId: stringField("Column definition"),
                sourceField: stringField("Source field name"),
                isPrimaryKey: booleanField("Mark as primary key"),
              },
              required: [
                "connectorEntityId",
                "columnDefinitionId",
                "sourceField",
              ],
            },
          },
        },
        ["items"]
      ),
    },
    {
      name: "field_mapping_update",
      description:
        "Updates one or more field mappings' source field, primary key flag, normalizedKey, required, defaultValue, format, or enumValues. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: stringField("Field mapping id"),
                sourceField: stringField("New source field name"),
                isPrimaryKey: booleanField("Primary key flag"),
              },
              required: ["id"],
            },
          },
        },
        ["items"]
      ),
    },
    {
      name: "field_mapping_delete",
      description:
        "Deletes one or more field mappings and cascades to dependent group members. Accepts 1–100 items.",
      parameterSchema: objectSchema(
        { ids: stringArrayField("Field mapping ids") },
        ["ids"]
      ),
    },
  ],
};

// ── Public registry ──────────────────────────────────────────────────

export const BUILTIN_TOOLPACKS: ReadonlyArray<BuiltinToolpack> = Object.freeze([
  DATA_QUERY_PACK,
  STATISTICS_PACK,
  REGRESSION_PACK,
  FINANCIAL_PACK,
  WEB_SEARCH_PACK,
  ENTITY_MANAGEMENT_PACK,
]);

export const BUILTIN_TOOLPACK_BY_SLUG: Record<
  BuiltinToolpackSlug,
  BuiltinToolpack
> = Object.freeze(
  Object.fromEntries(BUILTIN_TOOLPACKS.map((p) => [p.slug, p])) as Record<
    BuiltinToolpackSlug,
    BuiltinToolpack
  >
);

export function isBuiltinToolpackSlug(s: string): s is BuiltinToolpackSlug {
  return Object.prototype.hasOwnProperty.call(BUILTIN_TOOLPACK_BY_SLUG, s);
}
