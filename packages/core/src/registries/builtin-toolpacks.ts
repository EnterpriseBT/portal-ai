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

import type { BulkDispatchMetadata } from "../models/organization-toolpack.model.js";
import type {
  ToolCapability,
  ResultKind,
  ComputeShape,
  CostHint,
} from "../models/tool-capability.model.js";

export type { BulkDispatchMetadata };

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
 * `BulkDispatchMetadata` is defined in `organization-toolpack.model.ts`
 * so the schema + type are the single source of truth for both the
 * built-in registry (this file) and the webhook-toolpack schema
 * endpoint shape. Re-exported above.
 *
 * `costHint` drives the route's cost-acknowledgement gate:
 *  - "free": no gate; agent dispatches freely.
 *  - "metered": agent surfaces cost + ETA to user, no API gate.
 *  - "expensive": route requires `acknowledgeCost: true`; agent
 *    must confirm before dispatching.
 */

export interface ToolpackTool {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  examples?: ToolpackToolExample[];
  /** Opt-in: declares the tool can be bulk-dispatched per-record by
   *  `transform_entity_records`. Tools without this field are
   *  rejected from the tool-kind dispatch route. */
  bulkDispatch?: BulkDispatchMetadata;
  /** Declared capability metadata — the taxonomy substrate (#121).
   *  The three projections (UI/enablement/enforcement) + runtime
   *  cardinality selection all read from this. Attached from the
   *  `CAPABILITIES` matrix below at registry-build time. */
  capability: ToolCapability;
}

/** A tool literal as authored in a pack below — capability is attached
 *  from the `CAPABILITIES` matrix, not declared inline, so the whole
 *  capability matrix stays auditable in one place. */
export type ToolpackToolSpec = Omit<ToolpackTool, "capability">;

export interface BuiltinToolpack {
  slug: BuiltinToolpackSlug;
  name: string;
  description: string;
  iconSlug: string;
  tools: ToolpackTool[];
}

/** A pack as authored below — its tools carry no inline capability. */
export type BuiltinToolpackSpec = Omit<BuiltinToolpack, "tools"> & {
  tools: ToolpackToolSpec[];
};

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

/** The standard pure-compute data source (#114): exactly one of a query
 *  handle or inline rows. Spread into a compute tool's `properties`; the
 *  XOR is enforced by the tool's Zod schema, not the JSON-schema `required`. */
const computeSourceFields = (): Record<string, Record<string, unknown>> => ({
  queryHandle: stringField(
    "A queryHandle from sql_query or display_entity_records; the rows it staged are the dataset to compute over. Provide this OR `rows`, not both."
  ),
  rows: {
    type: "array",
    items: { type: "object" },
    description:
      "Inline rows to compute over (alternative to `queryHandle`), keyed by column name.",
  },
});

// ── Registry ──────────────────────────────────────────────────────────

const DATA_QUERY_PACK: BuiltinToolpackSpec = {
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
      name: "display_entity_records",
      description:
        "Render every record of an entity as a single live table widget for the user. Use for 'show / display / list' requests regardless of row count; rows stream through a query-handle and the UI renders them in one hydrating table. For analytical work (filters, joins, aggregations) use `sql_query` instead.",
      parameterSchema: objectSchema(
        {
          entityKey: stringField(
            "The entity's table key as listed in `_meta_entities` (e.g. 'parcels', 'contacts')."
          ),
          columns: stringArrayField(
            "Optional list of wide-column names (`c_<normalized_key>`) to project. Omit to project every column."
          ),
        },
        ["entityKey"]
      ),
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

const STATISTICS_PACK: BuiltinToolpackSpec = {
  slug: "statistics",
  name: "Statistics",
  description:
    "K-means clustering and hypothesis testing for numeric columns. Descriptive statistics, correlation, outlier detection, and group-by aggregation are expressed directly in sql_query.",
  iconSlug: "BarChart",
  tools: [
    {
      name: "cluster",
      description: "Perform k-means clustering on specified numeric columns.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          columns: stringArrayField(
            "Numeric columns to cluster on (keys in the rows)"
          ),
          k: integerField("Number of clusters (>= 2)"),
          standardize: booleanField(
            "Z-score each column before clustering. Centroids are returned in original units. Default false."
          ),
          seed: integerField("Seed for reproducible cluster initialization"),
          maxIterations: integerField("Maximum k-means iterations"),
        },
        ["columns", "k"]
      ),
      examples: [
        {
          title: "Segment customers into 3 clusters by spend and frequency",
          input: { queryHandle: "qh-9f3c", columns: ["spend", "frequency"], k: 3 },
          output: {
            clusters: [0, 2, 1, 0, 2],
            centroids: [
              [120.5, 2.1],
              [880.0, 9.4],
              [430.2, 5.0],
            ],
          },
        },
      ],
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
          // Optional data source: column-based tests need rows; chi_squared
          // uses observed/expected directly and needs neither.
          ...computeSourceFields(),
          columnA: stringField(
            "First numeric column (one-sample sample, or sample 1)"
          ),
          columnB: stringField("Second numeric column (sample 2)"),
          mu: numberField(
            "Hypothesized mean for one-sample t-test. Default 0."
          ),
          observed: {
            type: "array",
            items: { type: "number", minimum: 0 },
            description: "Observed counts for chi_squared.",
          },
          expected: {
            type: "array",
            items: { type: "number" },
            description:
              "Expected counts for chi_squared (same length as observed; each > 0).",
          },
          df: integerField(
            "Degrees of freedom for chi_squared. Default observed.length - 1."
          ),
        },
        ["test"]
      ),
    },
  ],
};

const REGRESSION_PACK: BuiltinToolpackSpec = {
  slug: "regression",
  name: "Regression",
  description:
    "Linear, multivariate, polynomial, and logistic regression, and time-series forecasting. Trend lines, decomposition, and changepoint detection are expressed directly in sql_query.",
  iconSlug: "TrendingUp",
  tools: [
    {
      name: "regression",
      description:
        "Perform linear, multivariate-linear, or polynomial regression over a dataset you provide. Returns coefficients, a parallel `direction` array (increasing/decreasing/flat per coefficient), R-squared, residuals, standard errors, t-statistics, p-values, and confidence intervals on each coefficient. Report a trend's direction from the `direction` field — do not infer it from the coefficient's sign yourself.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          x: stringField(
            "Independent variable column (a key in the rows). Use this OR `xColumns`."
          ),
          xColumns: stringArrayField(
            "Independent variables for multivariate-linear regression (keys in the rows)"
          ),
          y: stringField("Dependent variable column (a key in the rows)"),
          type: enumField(["linear", "polynomial"], "Regression type"),
          degree: integerField(
            "Polynomial degree (default 2; ignored for linear)"
          ),
          confidence: numberField(
            "Confidence level for the coefficient intervals (default 0.95)"
          ),
        },
        ["y", "type"]
      ),
      examples: [
        {
          title: "Linear fit of price vs. square footage",
          input: { queryHandle: "qh-9f3c", x: "sqft", y: "price", type: "linear" },
          output: { coefficients: [25000, 188.4], rSquared: 0.74 },
        },
      ],
    },
    {
      name: "logistic_regression",
      description:
        "Binary logistic regression via IRLS over a dataset you provide. Returns coefficients (intercept first), per-row predicted probabilities, log-loss, accuracy at threshold 0.5, and IRLS iteration count.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          x: stringField("Single predictor column. Use this OR `xColumns`."),
          xColumns: stringArrayField("Predictor columns (keys in the rows)"),
          y: stringField("Binary outcome column (0/1, true/false)"),
          maxIterations: integerField("Maximum IRLS iterations (default 100)"),
        },
        ["y"]
      ),
    },
    {
      name: "forecast",
      description:
        "Holt-Winters exponential smoothing forecast over a dataset you provide. Returns in-sample fits, multi-step point forecasts, prediction intervals, and MAPE.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          dateColumn: stringField("Date column (a key in the rows)"),
          valueColumn: stringField("Numeric column to forecast (a key in the rows)"),
          horizon: integerField("Number of future periods to forecast"),
          seasonalPeriod: integerField("Seasonal period (omit for non-seasonal)"),
          seasonality: enumField(
            ["none", "additive", "multiplicative"],
            "Seasonal component (default none)"
          ),
          trend: enumField(["none", "additive"], "Trend component (default additive)"),
          alpha: numberField("Level smoothing parameter (default 0.5)"),
          beta: numberField("Trend smoothing parameter (default 0.1)"),
          gamma: numberField("Seasonal smoothing parameter (default 0.1)"),
          confidence: numberField(
            "Confidence level for the prediction intervals (default 0.95)"
          ),
        },
        ["dateColumn", "valueColumn", "horizon"]
      ),
    },
  ],
};

const FINANCIAL_PACK: BuiltinToolpackSpec = {
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
      name: "var_cvar",
      description:
        "Compute Value-at-Risk and Conditional VaR (Expected Shortfall) at a confidence level, over a returns series you provide. Both return positive loss magnitudes.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          returnColumn: stringField("Returns column (a key in the rows)"),
          confidence: numberField("Confidence level in (0, 1) (default 0.95)"),
          method: enumField(
            ["historical", "parametric"],
            "Estimation method"
          ),
        },
        ["returnColumn"]
      ),
    },
    {
      name: "portfolio_metrics",
      description:
        "Compute portfolio performance metrics over a returns series you provide: total return, CAGR, Sortino, Calmar, max drawdown. With a benchmark source: beta, alpha, information ratio, tracking error, up/down capture.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          returnColumn: stringField("Returns column (a key in the rows)"),
          benchmarkQueryHandle: stringField(
            "Optional queryHandle for benchmark returns (enables beta/alpha/etc.)"
          ),
          benchmarkReturnColumn: stringField(
            "Return column within the benchmark rows. Required when a benchmark source is supplied."
          ),
          riskFreeRate: numberField(
            "Per-period risk-free rate for Sortino / alpha (default 0)"
          ),
          periodicity: enumField(
            ["daily", "weekly", "monthly", "quarterly", "annual"],
            "Annualization periodicity"
          ),
        },
        ["returnColumn"]
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
        "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV, Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud, Donchian Channels) on a time series you provide.",
      parameterSchema: objectSchema(
        {
          ...computeSourceFields(),
          dateColumn: stringField("Date column (a key in the rows)"),
          valueColumn: stringField("Price/value column (a key in the rows)"),
          indicator: enumField(
            [
              "SMA",
              "EMA",
              "RSI",
              "MACD",
              "BB",
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
            "Indicator type"
          ),
          params: {
            type: "object",
            description:
              "Optional indicator parameters (e.g. period, stdDev, signalPeriod, conversionPeriod, basePeriod, spanPeriod, displacement, step, max).",
          },
        },
        ["dateColumn", "valueColumn", "indicator"]
      ),
    },
  ],
};

const WEB_SEARCH_PACK: BuiltinToolpackSpec = {
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

const ENTITY_MANAGEMENT_PACK: BuiltinToolpackSpec = {
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
        "Creates or updates one or more field mappings between source fields and column definitions. Accepts 1–100 items. Get valid `columnDefinitionId`s from `station_context` (the `columnDefinitions` catalog) — map an entity's columns here before creating records, or those records won't be queryable.",
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
    {
      name: "transform_entity_records",
      description:
        "Run a per-record transform across a source entity and upsert the results into one or more target entities, asynchronously. Use for high-cardinality writes (≥100 records) where calling `entity_record_create` in a loop would exhaust the agent's context. Returns a jobId and ETA; the run is tracked as a job and the entity is locked until it completes. Expensive tool dispatches require `acknowledgeCost: true`.",
      parameterSchema: objectSchema(
        {
          sourceConnectorEntityId: stringField(
            "The source entity whose records are transformed (read-only; not locked)."
          ),
          expression: {
            type: "object",
            description:
              "The per-record derivation. `kind: \"sql\"` carries a SQL projection in `value` whose aliases match target wide-columns; `kind: \"tool\"` carries a tool `ref` (+ optional `args`). Both carry a `writes[]` array mapping each derived value into a target wide-column.",
          },
          keyField: stringField(
            "Upsert key on the target's `source_id`."
          ),
          batchSize: integerField(
            "Records per batch (default 1000, max 10000)."
          ),
          acknowledgeCost: booleanField(
            "Set true to proceed past the expensive-tool confirmation gate. Only after the user has confirmed."
          ),
          sourceFilter: {
            type: "object",
            description: "Optional WHERE filter on the source rows.",
            properties: {
              whereSqlFragment: stringField(
                "SQL WHERE fragment scoping which source rows are transformed."
              ),
            },
            required: ["whereSqlFragment"],
          },
        },
        ["sourceConnectorEntityId", "expression", "keyField"]
      ),
    },
  ],
};

// ── Capability matrix ──────────────────────────────────────────────────
//
// Every built-in tool's declared capability (#121 child A), in one place.
// Attached to the pack tools at registry-build time; a missing entry throws
// (the completeness guarantee that the required `capability` field would
// give if declared inline). Capability semantics + refinements live in
// `tool-capability.model.ts`; the disposition rationale is in
// `docs/TOOLPACK_TAXONOMY.spec.md` (the census + the D4 spike).
//
// NOTE: these declare the *current* behavior (no behavior change in child A).
// The reduce-tier reclassification (10 → SQL, 3 → engine-pushdown) is child E;
// `resultKind`-driven routing is child G. Until then capability is declared
// metadata, read by nothing.

/** Pure-math: touches no backend, computes over inline params. */
const pureMath = (resultKind: ResultKind = "scalar"): ToolCapability => ({
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "none" },
  computeShape: "pure",
  costHint: "free",
  locks: [],
  resultKind,
  alwaysAvailable: false,
});

/** Pure compute consumer over a handed-in dataset. Today the runtime
 *  materializes the handle up to COMPUTE_MAX_ROWS and hard-errors past it
 *  (#114) — i.e. bounded(100k) + onOverflow:error. */
const pureReduce = (
  resultKind: ResultKind,
  costHint: CostHint = "free"
): ToolCapability => ({
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "bounded", maxRows: 100_000, onOverflow: "error" },
  computeShape: "reduce",
  costHint,
  locks: [],
  resultKind,
  alwaysAvailable: false,
});

/** Pure single-pass reduce folded over a record stream (#129) — exact at any
 *  N, one batch resident. `streaming` consumption: the cursor delivers the
 *  full ordered set past the in-memory cap, so there is no `onOverflow:error`
 *  ceiling (a >100k keyed source folds rather than throwing). */
const streamingReduce = (
  resultKind: ResultKind,
  costHint: CostHint = "free"
): ToolCapability => ({
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "streaming" },
  computeShape: "reduce",
  costHint,
  locks: [],
  resultKind,
  alwaysAvailable: false,
});

/** Pushes its O(N) reduction to the engine — a read — with an O(1) residue
 *  computed in-tool (#130 E2c). Exact at any N, no materialization. `pure` is
 *  false because the pushdown is a read (the coherence schema models
 *  engine-pushdown as reads-bearing, not pure). */
const enginePushdownReduce = (
  resultKind: ResultKind = "scalar",
  costHint: CostHint = "free"
): ToolCapability => ({
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "engine-pushdown" },
  computeShape: "reduce",
  costHint,
  locks: [],
  resultKind,
  alwaysAvailable: false,
});

/** Reads the engine (a producer / SQL-pushed read or visualize). */
const engineRead = (
  resultKind: ResultKind,
  computeShape: ComputeShape
): ToolCapability => ({
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "engine-pushdown" },
  computeShape,
  costHint: "free",
  locks: [],
  resultKind,
  alwaysAvailable: false,
});

/** Synchronous entity write (inline payload; mutates; locks). */
const entityWrite = (writes: string[], locks: string[]): ToolCapability => ({
  pure: false,
  reads: [],
  writes,
  consumption: { mode: "none" },
  computeShape: "mutate",
  costHint: "free",
  locks,
  resultKind: "mutation-result",
  alwaysAvailable: false,
});

const CAPABILITIES: Record<string, ToolCapability> = {
  // data_query
  sql_query: engineRead("data-table", "scan"),
  display_entity_records: engineRead("data-table", "scan"),
  visualize: engineRead("vega-lite", "visualize"),
  visualize_tree: engineRead("vega", "visualize"),
  // resolve_identity returns a structured match set the agent consumes; not
  // auto-surfaced (scalar = no inline display block — preserves prior behavior).
  resolve_identity: engineRead("scalar", "scan"),
  // statistics — describe_column / correlate / detect_outliers / aggregate
  // removed in #130 E2 (expressed directly in sql_query).
  //
  // cluster (k-means) is bounded(100k) + onOverflow:error and costHint
  // expensive (#130 E2b): the in-memory fit is the heavy reduce-tier op
  // whose exact-unbounded upgrade is the mini-batch streaming variant (E3).
  cluster: pureReduce("scalar", "expensive"),
  // hypothesis_test is engine-pushdown (#130 E2c): the t-tests push their
  // O(N) reduction (avg / var_samp / count) into SQL over the source handle;
  // the O(1) statistic + p-value run in-tool. mann_whitney (rank-over-union)
  // and chi_squared (array input) stay on the in-memory path.
  hypothesis_test: enginePushdownReduce("scalar"),
  // regression — trend / changepoint / decompose removed in #130 E2
  // (expressed directly in sql_query). regression itself is engine-pushdown
  // (#130 E2c): X'X / X'y / y'y accumulate as SQL sums over the source
  // handle, the k×k solve + SE/t/p/CI run in-tool (per-row residuals omitted
  // on the pushdown path). Inline rows keep the full in-memory result.
  regression: enginePushdownReduce("scalar"),
  // logistic_regression (IRLS) is bounded(100k) + onOverflow:error and
  // costHint expensive (#130 E2b); the SGD streaming variant is E3.
  logistic_regression: pureReduce("scalar", "expensive"),
  // forecast folds online over the cursor (#129) — streaming, not bounded.
  forecast: streamingReduce("scalar"),
  // financial — pure math
  tvm: pureMath(),
  npv: pureMath(),
  irr: pureMath(),
  xnpv: pureMath(),
  xirr: pureMath(),
  depreciation: pureMath("scalar"),
  amortize: pureMath("scalar"),
  bond_math: pureMath(),
  // financial — compute over a dataset. sharpe_ratio / max_drawdown /
  // rolling_returns removed in #130 E2 (expressed directly in sql_query).
  //
  // var_cvar is engine-pushdown (#130 E2c): the O(N) reduction
  // (percentile_cont / avg / stddev) runs in SQL over the source handle;
  // the O(1) quantile/tail residue runs in-tool. Exact at any N. Falls back
  // to in-memory bounded for inline rows / non-re-executable handles.
  var_cvar: enginePushdownReduce("scalar"),
  portfolio_metrics: pureReduce("scalar"),
  technical_indicator: pureReduce("scalar"),
  // web_search — external read, no record input
  web_search: {
    pure: false,
    reads: [],
    writes: [],
    consumption: { mode: "none" },
    computeShape: "scan",
    costHint: "metered",
    locks: [],
    // not auto-surfaced as a table today (preserves prior behavior).
    resultKind: "scalar",
    alwaysAvailable: false,
  },
  // entity_management — synchronous writes
  entity_record_create: entityWrite(["entity_records"], ["connectorEntityId"]),
  entity_record_update: entityWrite(["entity_records"], ["recordIds"]),
  entity_record_delete: entityWrite(["entity_records"], ["recordIds"]),
  connector_entity_create: entityWrite(
    ["connector_entities"],
    ["connectorInstanceId"]
  ),
  connector_entity_update: entityWrite(
    ["connector_entities"],
    ["connectorInstanceId"]
  ),
  connector_entity_delete: entityWrite(
    ["connector_entities"],
    ["connectorInstanceId"]
  ),
  field_mapping_create: entityWrite(["field_mappings"], ["connectorEntityId"]),
  field_mapping_update: entityWrite(["field_mappings"], ["connectorEntityId"]),
  field_mapping_delete: entityWrite(["field_mappings"], ["connectorEntityId"]),
  // entity_management — async bulk write job (per-record map dispatch)
  transform_entity_records: {
    pure: false,
    reads: ["entity_records"],
    writes: ["entity_records"],
    consumption: { mode: "streaming" },
    computeShape: "map",
    costHint: "expensive",
    locks: ["targetConnectorEntityIds"],
    resultKind: "progress",
    alwaysAvailable: false,
  },
};

/** Attach each tool's declared capability from the matrix; throw on any
 *  tool that lacks one (the completeness guarantee). */
function attachCapabilities(spec: BuiltinToolpackSpec): BuiltinToolpack {
  return {
    ...spec,
    tools: spec.tools.map((tool) => {
      const capability = CAPABILITIES[tool.name];
      if (!capability) {
        throw new Error(
          `builtin-toolpacks: no capability declared for tool '${tool.name}'`
        );
      }
      return { ...tool, capability };
    }),
  };
}

// ── Public registry ──────────────────────────────────────────────────

export const BUILTIN_TOOLPACKS: ReadonlyArray<BuiltinToolpack> = Object.freeze(
  [
    DATA_QUERY_PACK,
    STATISTICS_PACK,
    REGRESSION_PACK,
    FINANCIAL_PACK,
    WEB_SEARCH_PACK,
    ENTITY_MANAGEMENT_PACK,
  ].map(attachCapabilities)
);

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
