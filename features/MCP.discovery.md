# MCP Data Analysis Discovery

## Goal

Enable natural language queries against arbitrary entity records in the organization using MCP servers backed by Node.js data analytics libraries. Render results in a chat-like UI within the existing Portal.ai web app.

---

## Hybrid Analytics Architecture (SQL + Programmatic)

The recommended approach combines two complementary strategies. The LLM (Claude) acts as the natural language layer — interpreting user queries and routing them to the appropriate analytics backend.

### Strategy A: SQL via AlaSQL

**Library:** [AlaSQL](https://github.com/AlaSQL/alasql)

- In-memory SQL engine that operates directly on JavaScript objects and arrays
- Supports SELECT, JOIN, GROUP BY, HAVING, ORDER BY, subqueries, window functions
- Zero infrastructure — no database server needed for analytics queries
- LLMs are highly proficient at generating SQL, making this the most reliable code-generation path

**Best for:** Aggregations, filtering, grouping, joins, pivots, and any structured tabular query.

**Example flow:**
```
User: "What's the average order value by customer tier for Q4?"
Claude generates: SELECT tier, AVG(order_value) FROM orders WHERE quarter = 'Q4' GROUP BY tier
AlaSQL executes against in-memory entity records
```

### Strategy B: Programmatic Analysis via Arquero + Statistics Libraries

**Libraries:**

| Library | Purpose | NPM |
|---------|---------|-----|
| [Arquero](https://github.com/uwdata/arquero) | Columnar data transforms, pivots, rollups, joins | `arquero` |
| [simple-statistics](https://github.com/simple-statistics/simple-statistics) | Descriptive stats, regression, distributions, outlier detection | `simple-statistics` |
| [ml.js](https://github.com/mljs/ml) | K-means clustering, PCA, decision trees, regression, SVM | `ml` |

- Arquero provides a fluent, composable API for data transformation (similar to dplyr/Pandas)
- simple-statistics covers standard statistical operations (mean, median, standard deviation, z-scores, linear regression, Bayesian classifiers)
- ml.js provides unsupervised learning (clustering, dimensionality reduction) and supervised models without heavy dependencies like TensorFlow

**Best for:** Statistical summaries, outlier/anomaly detection, correlation analysis, clustering/segmentation, trend detection, regression/forecasting.

**Example flow:**
```
User: "Are there any anomalous transactions in the last 30 days?"
Claude selects: detect_outliers tool with IQR method on transaction_amount column
simple-statistics computes IQR bounds → flags outliers
```

---

## Tool Packs

All tools are organized into named packs. A station must have at least one pack selected before a portal can be opened — there are no implicit or always-on tools. The tools available to Claude during a portal session are the exact union of tools from the station's selected packs plus any custom webhook tools registered on the station.

Tools are grouped into five curated packs, each addressing a distinct analytical domain. Users select packs per station from a palette in the station settings UI.

---

### Pack: `data_query`

SQL querying and chart visualization against in-memory entity records.

| Tool | Backed By | Input Parameters | Use Case |
|------|-----------|-----------------|----------|
| `sql_query` | AlaSQL | `{ sql: string }` | Flexible querying: aggregations, filters, joins, pivots. Tables named by `connectorEntity.key`. |
| `visualize` | AlaSQL + Vega-Lite | `{ sql: string, vegaLiteSpec: object }` | Run a SQL query and render the result as any chart type (bar, line, scatter, heatmap, etc.) |

> The `entity` key (e.g. `"orders"`, `"customers"`) is the table name registered in AlaSQL when the portal opens. For `sql_query` and `visualize`, reference it directly in the SQL statement.

---

### Pack: `statistics`

Descriptive statistics, correlation, outlier detection, and clustering.

| Tool | Backed By | Input Parameters | Use Case |
|------|-----------|-----------------|----------|
| `describe_column` | simple-statistics | `{ entity: string, column: string }` | Summary stats: count, mean, median, stddev, min, max, p25, p75 |
| `correlate` | simple-statistics | `{ entity: string, columnA: string, columnB: string }` | Pearson correlation between two numeric columns |
| `detect_outliers` | simple-statistics | `{ entity: string, column: string, method: "iqr" \| "zscore" }` | Flag records with anomalous values |
| `cluster` | ml-kmeans | `{ entity: string, columns: string[], k: number }` | Segment records into k groups based on selected numeric features |

---

### Pack: `regression`

Regression modelling and time-series trend analysis.

| Tool | Backed By | Input Parameters | Use Case |
|------|-----------|-----------------|----------|
| `regression` | simple-statistics | `{ entity: string, x: string, y: string, type: "linear" \| "polynomial" }` | Fit a regression model; returns coefficients and R-squared |
| `trend` | simple-statistics + Arquero | `{ entity: string, dateColumn: string, valueColumn: string, interval: string }` | Time-series aggregation with a linear trend line overlay |

---

### Pack: `financial`

Technical indicators, capital budgeting math, and risk metrics.

| Tool | Backed By | Input Parameters | Use Case |
|------|-----------|-----------------|----------|
| `technical_indicator` | technicalindicators | `{ entity, dateColumn, valueColumn, indicator: "SMA"\|"EMA"\|"RSI"\|"MACD"\|"BB"\|"ATR"\|"OBV", params? }` | Price/time-series technical analysis |
| `npv` | financial | `{ rate: number, cashFlows: number[] }` | Net present value of a cash flow series |
| `irr` | financial | `{ cashFlows: number[] }` | Internal rate of return |
| `amortize` | financial | `{ principal: number, annualRate: number, periods: number }` | Loan amortization schedule — returns one row per period |
| `sharpe_ratio` | simple-statistics | `{ entity, valueColumn, riskFreeRate?: number, annualize?: boolean }` | Risk-adjusted return: (mean − risk-free rate) / stddev |
| `max_drawdown` | Arquero | `{ entity, dateColumn, valueColumn }` | Peak-to-trough decline as a percentage of peak value |
| `rolling_returns` | Arquero | `{ entity, dateColumn, valueColumn, window: number }` | Period-over-period return series within a rolling window |

---

### Pack: `web_search`

Real-time web search via Tavily. Wraps the existing `AiService.buildWebSearchTool()` — the same tool used elsewhere in the platform, exposed here as an opt-in pack.

| Tool | Backed By | Input Parameters | Use Case |
|------|-----------|-----------------|----------|
| `web_search` | Tavily | `{ query: string }` | Search the web for current information to supplement entity data analysis |

---

### Stations and Portals

A **Station** is a named grouping of one or more connector instances. Users create stations to define a data context, then spawn **Portals** (chat sessions) from a station. All connector entities across every instance in the station are available to the agent during a portal session.

#### Database Schema

**`stations` table** — user-defined data context for chat sessions

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Display name (e.g., "Sales Pipeline", "Customer Analytics") |
| `description` | text | Optional description of the station's purpose |
| `organizationId` | uuid | FK → organizations |
| `createdBy` | uuid | FK → users |
| `created` | timestamp | |
| `updated` | timestamp | |
| `deleted` | timestamp | Soft delete |

**`station_instances` join table** — maps stations to their constituent connector instances

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `stationId` | uuid | FK → stations |
| `connectorInstanceId` | uuid | FK → connector_instances |
| `created` | timestamp | |

A Station referencing two connector instances (e.g., a CRM instance with "contacts" and "deals", and a CSV instance with "products") means the agent can query across all of their entities within a portal — enabling cross-entity SQL joins, correlations, and visualizations.

**`portals` table** — a chat session opened from a station

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `organizationId` | uuid | FK → organizations |
| `stationId` | uuid | FK → stations |
| `name` | text | Auto-generated (e.g. "Portal — Mar 20 2026") or user-renamed |
| `createdBy` | uuid | FK → users |
| `created` | timestamp | |
| `updated` | timestamp | |
| `deleted` | timestamp | Soft delete |

**`portal_messages` table** — ordered message history for a portal

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `portalId` | uuid | FK → portals |
| `organizationId` | uuid | FK → organizations |
| `role` | enum (`user` \| `assistant`) | |
| `blocks` | jsonb | Ordered `ContentBlock[]` — `{ type: "text", content: string }` or `{ type: "vega-lite", spec: object }` |
| `created` | timestamp | Insertion order defines message sequence |

The user turn is written immediately on receipt. The assistant turn is written once the SSE stream completes — the full `blocks` array is assembled server-side before flush.

**`portal_results` table** — user-pinned content blocks from portal messages

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `organizationId` | uuid | FK → organizations |
| `stationId` | uuid | FK → stations (denormalized — allows listing without joining portals) |
| `portalId` | uuid | FK → portals (nullable — result survives portal deletion) |
| `name` | text | User-given name (e.g. "Q4 Revenue by Tier") |
| `type` | enum (`text` \| `vega-lite`) | Content block type |
| `content` | jsonb | Full block payload (Vega-Lite spec or text string) |
| `createdBy` | uuid | FK → users |
| `created` | timestamp | |
| `updated` | timestamp | |
| `deleted` | timestamp | Soft delete |

Saved results are stored denormalized so they survive portal deletion. Users pin any individual assistant content block (chart, table, stat summary) and give it a name.

### Data Loading Pattern

When a portal is opened from a Station, the server loads all connector instances associated with that station, then all connector entities belonging to each instance. Each tool's `entity` parameter refers to a `connectorEntity.key` — one of the station's registered connector entities.

```
stationId → StationRepository.findById() → station
  → StationInstanceRepository.findByStationId() → stationInstances[]
  → For each stationInstance.connectorInstanceId:
      ConnectorEntityRepository.findByConnectorInstanceId() → connectorEntities[]
      → For each connectorEntity:
          1. Schema discovery:
             connectorEntity → fieldMappings → columnDefinitions
               → { columnKey, label, type, required }[]  (typed column catalog for system prompt)
          2. Data loading:
             EntityRecordRepository.findMany({ connectorEntityId, organizationId }) → records[]
               → Use normalizedData (already mapped via fieldMappings)
               → AlaSQL: register as named table (using connectorEntity.key as table name) for cross-entity joins
               → Arquero: aq.from(records)
               → ml.js: extract numeric columns into feature matrix
```

The field mappings and column definitions are derived from each entity record's associated `connectorEntity`. Since entity records store both raw `data` and `normalizedData` (mapped via `fieldMappings` to the organization's `columnDefinitions`), the analytics layer operates on `normalizedData` — which uses the standardized column keys. This means the schema passed to the LLM in the system prompt matches the actual column names in the data, enabling accurate SQL and tool parameter generation.

All connector entities across all station instances are loaded as named tables in AlaSQL (using `connectorEntity.key` as the table name), allowing the agent to write cross-entity SQL joins (e.g., `SELECT c.name, SUM(o.amount) FROM customers c JOIN orders o ON c.id = o.customerId`).

---

## Integration into Portal.ai

### Default Station

Each organization can designate one station as its **default station** — the pre-selected station in the "Create Portal" flow and the one highlighted on the dashboard. This is stored as a nullable FK on the `organizations` table.

**Schema change — `organizations` table:** add `defaultStationId text REFERENCES stations(id)` (nullable).

The station list page allows any org member to update the default station. On `PATCH /api/organizations/:id` the `defaultStationId` field is updated.

---

### Frontend: Dashboard

**Route:** `/` (existing `DashboardView`)

The existing dashboard is a placeholder. It gains three new sections:

**1. Default station card** — shows the current default station name, description, and its connector instances. Includes a "Launch Portal" button (creates a portal from the default station and navigates to it) and a "Change default" link that navigates to `/stations`.

**2. Recent portals list** — the 5 most recently created portals across all stations, showing portal name, station name, and created-at. Clicking any row navigates to `/portals/:portalId`.

**3. Create portal button** — a prominent CTA in the header area. Opens a `CreatePortalDialog` — a small modal with:
- A station select pre-populated with the default station (if set)
- A confirm button that calls `POST /api/portals { stationId }` and navigates to the new portal

**New components:**

| Component | Path | Purpose |
|-----------|------|---------|
| `DefaultStationCard.component.tsx` | `apps/web/src/components/` | Displays default station info + "Launch Portal" button |
| `RecentPortalsList.component.tsx` | `apps/web/src/components/` | Fetches and renders the 5 most recent portals |
| `CreatePortalDialog.component.tsx` | `apps/web/src/components/` | Modal with station select + confirm; navigates to new portal on success |

---

### Frontend: Station List

**Route:** `/stations`

Paginated list of all stations in the organization. Each row shows station name, description, number of connector instances, and a "Default" badge if it is the current default station. A "Set as default" action on each row calls `PATCH /api/organizations/:id { defaultStationId }`.

Includes a "New Station" button to create a station (name + description + connector instance picker).

**New components:**

| Component | Path | Purpose |
|-----------|------|---------|
| `StationList.component.tsx` | `apps/web/src/components/` | Data-fetching wrapper + pure UI table for stations |
| `StationsView.tsx` | `apps/web/src/views/` | Page view — breadcrumbs, `StationList`, "New Station" button |

**Route files:**

| File | Purpose |
|------|---------|
| `apps/web/src/routes/_authorized/stations.tsx` | Index route rendering `StationsView` |
| `apps/web/src/routes/_authorized/stations.$stationId.tsx` | Station detail — portal history + instance list for one station |

---

### Frontend: Portal UI

**Route:** `/portals/:portalId`

**Approach:** Leverage the existing `ChatWindowUI` component (`apps/web/src/components/ChatWindow.component.tsx`) which already provides:
- Multiline text input with Enter-to-submit
- Cancel, Reset, Submit actions
- Mobile-responsive layout

**New components needed:**

| Component | Path | Purpose |
|-----------|------|---------|
| `PortalSession.component.tsx` | `apps/web/src/components/` | Container that manages message state, streams responses, renders message history above `ChatWindowUI` |
| `PortalMessage.component.tsx` | `apps/web/src/components/` | Single message bubble — supports text, tables, and chart placeholders; includes pin button on assistant blocks |
| `PortalRoute` | `apps/web/src/routes/_authorized/portals.$portalId.tsx` | TanStack Router route, wraps `PortalSession` in `AuthorizedLayout` |

**Message rendering considerations:**
- Claude's markdown responses handle tabular data natively (markdown tables rendered by `react-markdown` + `remark-gfm`)
- Chart visualizations rendered via `react-vega` using Vega-Lite specs returned from the `visualize` tool
- More block types can be added later as needs arise

**Streaming:** Reuse the existing SSE pattern (`job-events.router.ts` + `job-stream.util.ts`) for real-time token streaming from Claude.

### Response Rendering Strategy

The server streams mixed content — narrative text and rich visualizations — using typed SSE events. The frontend maps each event type to the appropriate renderer.

#### SSE Event Types

```
event: delta
data: {"content": "Here are the top customers by revenue..."}
→ Accumulated into a string, rendered with react-markdown + remark-gfm

event: tool_result
data: {"type": "vega-lite", "spec": { "mark": "bar", "encoding": {...}, "data": {...} }}
→ Rendered with react-vega's VegaLite component
```

Markdown and Vega-Lite are the only two content block types for now. Claude's markdown responses handle tabular data natively (markdown tables rendered by `react-markdown` + `remark-gfm`), and Vega-Lite covers all chart/visualization needs. More block types can be added later as needs arise.

#### Why Vega-Lite for Charts

Rather than building individual chart components for every possible visualization, the server returns [Vega-Lite](https://vega.github.io/vega-lite/) JSON specifications. A single `<VegaLite spec={spec} />` component on the frontend renders any chart type — bar, line, scatter, heatmap, histogram, area, pie, faceted, layered, and more.

This works well because:
- Vega-Lite specs are declarative JSON — LLMs are highly proficient at generating them
- The grammar is well-documented and in Claude's training data
- One frontend component handles unlimited chart variety
- No new frontend code needed when a new chart type is required
- Specs can include interactivity (tooltips, zoom, selection) without custom code

The `visualize` MCP tool lets Claude generate the appropriate spec:

```
visualize: {
  sql: string,           // query to get the data (references tables by connectorEntity.key)
  vegaLiteSpec: object   // Claude generates the full Vega-Lite spec
}
```

#### Frontend Content Block Renderer

The `ChatMessage` component switches on block type. Only two block types are needed initially — more can be added later by extending the union and adding a new case to the renderer.

```tsx
type ContentBlock =
  | { type: "text"; content: string }
  | { type: "vega-lite"; spec: VisualizationSpec }

const ContentBlockRenderer: React.FC<{ block: ContentBlock }> = ({ block }) => {
  switch (block.type) {
    case "text":
      return <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>;
    case "vega-lite":
      return <VegaLite spec={block.spec} />;
  }
};
```

#### Frontend Dependencies

```json
{
  "react-markdown": "^9.x",
  "remark-gfm": "^4.x",
  "react-vega": "^7.x",
  "vega": "^5.x",
  "vega-lite": "^5.x"
}
```

Added to `apps/web/package.json`.

### Backend: API + MCP Server

**Option 1: MCP Server as Internal Service**

The MCP server runs as a separate process alongside the API. The API acts as a proxy — receives chat requests, forwards to the MCP server via stdio/SSE transport, and streams results back to the frontend.

```
Frontend → POST /api/chat → API Server → MCP Server (stdio) → Analytics Tools
                                ↓
                          SSE stream back to frontend
```

**Option 2: Analytics Tools Embedded in API (Recommended)**

Skip the separate MCP server process. Implement the analytics tools directly as service methods in the API, and use the Vercel AI SDK (already in use via `AiService`) with `tool_use` to orchestrate them. The MCP protocol can be adopted later if the tools need to be shared across multiple AI consumers.

```
Frontend
  ↓ POST /api/portals  { stationId }  →  portalId
  ↓ POST /api/portals/:portalId/messages  { message }
  ↓ GET  /api/sse/chat/:sessionId/stream  (SSE, query-param auth)
API Server
  ├── ChatService        → manages sessions, message history, Claude orchestration
  ├── AnalyticsService   → executes analytics tools (AlaSQL, Arquero, simple-statistics, ml.js)
  └── AiService          → Claude API provider + tool definitions (existing)
        ↓ tool_use loop
        Claude ←→ AnalyticsService methods
        ↓
  SSE stream → frontend (delta + tool_result events)
```

#### Why This Approach

- Aligns with the existing `AiService` pattern — tool definitions use the Vercel AI SDK `tool()` helper with Zod input schemas, same as `buildWebSearchTool()`
- No new infrastructure — no sidecar process, no stdio transport, no MCP client/server handshake
- Reuses the existing `SseUtil` class and SSE auth middleware for streaming
- Analytics tools are just static service methods — easy to unit test in isolation
- Can extract to a standalone MCP server later by wrapping the same service methods in MCP tool handlers

---

#### New Backend Files

| File | Path | Purpose |
|------|------|---------|
| `organizations.table.ts` | `apps/api/src/db/schema/` | Add `defaultStationId` (nullable FK → stations) |
| `stations.table.ts` | `apps/api/src/db/schema/` | Drizzle table definition for `stations` |
| `station-instances.table.ts` | `apps/api/src/db/schema/` | Drizzle table definition for `station_instances` join table |
| `portals.table.ts` | `apps/api/src/db/schema/` | Drizzle table definition for `portals` |
| `portal-messages.table.ts` | `apps/api/src/db/schema/` | Drizzle table definition for `portal_messages` |
| `portal-results.table.ts` | `apps/api/src/db/schema/` | Drizzle table definition for `portal_results` |
| `stations.repository.ts` | `apps/api/src/db/repositories/` | Repository for station CRUD + loading associated connector instances |
| `station-instances.repository.ts` | `apps/api/src/db/repositories/` | Repository for the station↔instance join table |
| `portals.repository.ts` | `apps/api/src/db/repositories/` | Repository for portal CRUD + listing portals by station |
| `portal-messages.repository.ts` | `apps/api/src/db/repositories/` | Repository for appending and loading portal message history |
| `portal-results.repository.ts` | `apps/api/src/db/repositories/` | Repository for pinned result CRUD |
| `station.model.ts` | `packages/core/src/models/` | Zod model for Station (follows dual-schema pattern) |
| `portal.model.ts` | `packages/core/src/models/` | Zod model for Portal |
| `portal-result.model.ts` | `packages/core/src/models/` | Zod model for PortalResult |
| `analytics.service.ts` | `apps/api/src/services/` | Static methods for each analytics operation (SQL, stats, clustering, visualization) |
| `analytics.tools.ts` | `apps/api/src/services/` | Vercel AI SDK `tool()` definitions that wrap `AnalyticsService` methods — registered alongside existing tools |
| `portal.service.ts` | `apps/api/src/services/` | Portal management, message persistence, Claude API agentic loop orchestration |
| `portal.router.ts` | `apps/api/src/routes/` | `POST /api/portals` — opens a portal from a station; `POST /api/portals/:portalId/messages` — sends a message |
| `portal-results.router.ts` | `apps/api/src/routes/` | `POST /api/portal-results` — pin a result; `GET /api/portal-results` — list saved results by station |
| `portal-events.router.ts` | `apps/api/src/routes/` | `GET /api/sse/portals/:portalId/stream` — SSE endpoint for streaming responses |
| `portal.contract.ts` | `packages/core/src/contracts/` | Zod schemas for portal request/response payloads, SSE event types, and saved result payloads |

#### AnalyticsService

Stateless service with static methods. Each method loads entity records, runs the analysis, and returns structured results.

```typescript
import alasql from "alasql";
import * as aq from "arquero";
import * as ss from "simple-statistics";
import { kmeans } from "ml-kmeans";

export class AnalyticsService {

  /** Load all connector entities for a station into memory (called when a portal is opened) */
  private static async loadStation(stationId: string, organizationId: string): Promise<{
    entities: Array<{ key: string; label: string; schema: Record<string, string> }>;
    records: Map<string, Record<string, unknown>[]>;
  }> {
    // 1. Resolve stationId → stationInstances → connectorInstanceIds
    //    → For each connectorInstanceId: ConnectorEntityRepository.findByConnectorInstanceId()
    // 2. For each connectorEntity:
    //    a. Derive schema: connectorEntity → fieldMappings → columnDefinitions
    //       → produces { columnKey, label, type }[] for the system prompt
    //    b. Fetch records: EntityRecordRepository.findMany({ connectorEntityId, organizationId })
    //       → extract normalizedData (already mapped to standardized column keys)
    //    c. Register as named AlaSQL table (using connectorEntity.key) for cross-entity joins
    // 3. Return entity schemas (for system prompt) and records map keyed by connectorEntity.key
  }

  /** Load records for a single connector entity */
  private static async loadRecords(entity: string, organizationId: string): Promise<Record<string, unknown>[]> {
    // Resolve connectorEntity.key → connectorEntity → entity records
    // Return normalizedData from each record as plain JS objects
  }

  /** Execute arbitrary SQL against in-memory entity records (tables named by connectorEntity.key) */
  static async sqlQuery(params: {
    sql: string;
    organizationId: string;
  }): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    // Tables are pre-registered in AlaSQL by connectorEntity.key when the portal is opened
    const rows = alasql(params.sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }

  /** Descriptive statistics for a single column */
  static async describeColumn(params: {
    entity: string;
    column: string;
    organizationId: string;
  }): Promise<{
    count: number; mean: number; median: number;
    stddev: number; min: number; max: number;
    p25: number; p75: number;
  }> {
    const records = await this.loadRecords(params.entity, params.organizationId);
    const values = records.map((r) => Number(r[params.column])).filter((v) => !isNaN(v));
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

  /** Detect outliers using IQR or Z-score method */
  static async detectOutliers(params: {
    entity: string;
    column: string;
    method: "iqr" | "zscore";
    organizationId: string;
  }): Promise<{ outliers: Record<string, unknown>[]; threshold: { lower: number; upper: number } }> {
    const records = await this.loadRecords(params.entity, params.organizationId);
    const values = records.map((r) => Number(r[params.column])).filter((v) => !isNaN(v));

    let lower: number, upper: number;
    if (params.method === "iqr") {
      const q1 = ss.quantile(values, 0.25);
      const q3 = ss.quantile(values, 0.75);
      const iqr = q3 - q1;
      lower = q1 - 1.5 * iqr;
      upper = q3 + 1.5 * iqr;
    } else {
      const m = ss.mean(values);
      const sd = ss.standardDeviation(values);
      lower = m - 3 * sd;
      upper = m + 3 * sd;
    }

    const outliers = records.filter((r) => {
      const v = Number(r[params.column]);
      return v < lower || v > upper;
    });

    return { outliers, threshold: { lower, upper } };
  }

  /** Pearson correlation between two numeric columns */
  static async correlate(params: {
    entity: string;
    columnA: string;
    columnB: string;
    organizationId: string;
  }): Promise<{ correlation: number; sampleSize: number }> {
    const records = await this.loadRecords(params.entity, params.organizationId);
    const pairs = records
      .map((r) => [Number(r[params.columnA]), Number(r[params.columnB])] as [number, number])
      .filter(([a, b]) => !isNaN(a) && !isNaN(b));
    return {
      correlation: ss.sampleCorrelation(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
      sampleSize: pairs.length,
    };
  }

  /** K-means clustering on selected numeric columns */
  static async cluster(params: {
    entity: string;
    columns: string[];
    k: number;
    organizationId: string;
  }): Promise<{ clusters: { centroid: number[]; size: number; records: Record<string, unknown>[] }[] }> {
    const records = await this.loadRecords(params.entity, params.organizationId);
    const matrix = records.map((r) => params.columns.map((c) => Number(r[c])));
    const result = kmeans(matrix, params.k);

    const clusters = Array.from({ length: params.k }, (_, i) => ({
      centroid: result.centroids[i],
      size: result.clusters.filter((c: number) => c === i).length,
      records: records.filter((_, idx) => result.clusters[idx] === i),
    }));

    return { clusters };
  }

  /** Execute SQL query and pair results with a Vega-Lite spec for visualization */
  static async visualize(params: {
    sql: string;
    vegaLiteSpec: Record<string, unknown>;
    organizationId: string;
  }): Promise<{ spec: Record<string, unknown> }> {
    const { rows } = await this.sqlQuery({
      sql: params.sql,
      organizationId: params.organizationId,
    });
    // Inject queried data into the spec
    const spec = {
      ...params.vegaLiteSpec,
      data: { values: rows },
    };
    return { spec };
  }
}
```

#### Analytics Tool Definitions

Registered on `AiService` alongside the existing `webSearch` tool. Each tool wraps an `AnalyticsService` method with a Zod input schema.

```typescript
import { tool } from "ai";
import { z } from "zod";
import { AnalyticsService } from "./analytics.service.js";
import { AiService } from "./ai.service.js";
import { stationToolsRepo, stationsRepo } from "../db/index.js";

/**
 * Build the complete tool map for a portal session.
 *
 * Every tool available to Claude is determined exclusively by:
 *   1. The packs selected on the station (station.toolPacks)
 *   2. The custom webhook tools registered on the station (station_tools rows)
 *
 * There are no implicit or always-on tools. If a station has no packs selected,
 * this function throws — portal creation should have already blocked that case.
 */
export async function buildAnalyticsTools(
  organizationId: string,
  stationId: string
): Promise<Record<string, ReturnType<typeof tool>>> {
  const station = await stationsRepo.findById(stationId);
  const packs = new Set(station.toolPacks);

  if (packs.size === 0) {
    throw new Error("Station has no tool packs selected — cannot open a portal");
  }

  const tools: Record<string, ReturnType<typeof tool>> = {};

  // ── Pack: data_query ────────────────────────────────────────────────
  if (packs.has("data_query")) {
    tools.sql_query = tool({
      description: "Execute a SQL query against entity records. Supports SELECT, JOIN, GROUP BY, HAVING, ORDER BY, aggregation functions, and subqueries. Tables are named by connectorEntity.key.",
      inputSchema: z.object({
        sql: z.string().describe("SQL query — reference tables by their connectorEntity.key, e.g. SELECT * FROM orders"),
      }),
      execute: (input) => AnalyticsService.sqlQuery({ ...input, organizationId }),
    });
    tools.visualize = tool({
      description: "Query entity data and render a chart. Generate a complete Vega-Lite specification for the desired chart type. Data is injected automatically — do not include a data property in the spec.",
      inputSchema: z.object({
        sql: z.string().describe("SQL query to fetch chart data — reference tables by connectorEntity.key"),
        vegaLiteSpec: z.record(z.unknown()).describe("Vega-Lite spec without data — include mark, encoding, and any transforms"),
      }),
      execute: (input) => AnalyticsService.visualize({ ...input, organizationId }),
    });
  }

  // ── Pack: statistics ────────────────────────────────────────────────
  if (packs.has("statistics")) {
    tools.describe_column = tool({
      description: "Get descriptive statistics for a numeric column: count, mean, median, standard deviation, min, max, and percentiles.",
      inputSchema: z.object({
        entity: z.string().describe("The connectorEntity.key identifying which entity to analyze"),
        column: z.string().describe("The numeric column to analyze"),
      }),
      execute: (input) => AnalyticsService.describeColumn({ ...input, organizationId }),
    });
    tools.correlate = tool({
      description: "Calculate the Pearson correlation coefficient between two numeric columns.",
      inputSchema: z.object({
        entity: z.string(),
        columnA: z.string(),
        columnB: z.string(),
      }),
      execute: (input) => AnalyticsService.correlate({ ...input, organizationId }),
    });
    tools.detect_outliers = tool({
      description: "Detect outlier records in a numeric column using IQR or Z-score method.",
      inputSchema: z.object({
        entity: z.string(),
        column: z.string(),
        method: z.enum(["iqr", "zscore"]).default("iqr"),
      }),
      execute: (input) => AnalyticsService.detectOutliers({ ...input, organizationId }),
    });
    tools.cluster = tool({
      description: "Segment records into k groups using k-means clustering on selected numeric columns.",
      inputSchema: z.object({
        entity: z.string(),
        columns: z.array(z.string()).describe("Numeric columns to cluster on"),
        k: z.number().int().min(2).max(20).describe("Number of clusters"),
      }),
      execute: (input) => AnalyticsService.cluster({ ...input, organizationId }),
    });
  }

  // ── Pack: regression ────────────────────────────────────────────────
  if (packs.has("regression")) {
    tools.regression = tool({
      description: "Fit a linear or polynomial regression model between two numeric columns. Returns coefficients and R-squared.",
      inputSchema: z.object({
        entity: z.string(),
        x: z.string().describe("Independent variable column"),
        y: z.string().describe("Dependent variable column"),
        type: z.enum(["linear", "polynomial"]).default("linear"),
      }),
      execute: (input) => AnalyticsService.regression({ ...input, organizationId }),
    });
    tools.trend = tool({
      description: "Aggregate a numeric value over time intervals and fit a linear trend line.",
      inputSchema: z.object({
        entity: z.string(),
        dateColumn: z.string(),
        valueColumn: z.string(),
        interval: z.enum(["day", "week", "month", "quarter", "year"]),
      }),
      execute: (input) => AnalyticsService.trend({ ...input, organizationId }),
    });
  }

  // ── Pack: financial ─────────────────────────────────────────────────
  if (packs.has("financial")) {
    tools.technical_indicator = tool({
      description: "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV) over a time-series value column.",
      inputSchema: z.object({
        entity: z.string(),
        dateColumn: z.string(),
        valueColumn: z.string(),
        indicator: z.enum(["SMA", "EMA", "RSI", "MACD", "BB", "ATR", "OBV"]),
        params: z.record(z.unknown()).optional().describe("Indicator-specific parameters, e.g. { period: 14 }"),
      }),
      execute: (input) => AnalyticsService.technicalIndicator({ ...input, organizationId }),
    });
    tools.npv = tool({
      description: "Calculate the net present value of a series of cash flows at a given discount rate.",
      inputSchema: z.object({ rate: z.number(), cashFlows: z.array(z.number()) }),
      execute: (input) => AnalyticsService.npv(input),
    });
    tools.irr = tool({
      description: "Calculate the internal rate of return for a series of cash flows.",
      inputSchema: z.object({ cashFlows: z.array(z.number()) }),
      execute: (input) => AnalyticsService.irr(input),
    });
    tools.amortize = tool({
      description: "Generate a full loan amortization schedule. Returns one row per period.",
      inputSchema: z.object({ principal: z.number(), annualRate: z.number(), periods: z.number().int() }),
      execute: (input) => AnalyticsService.amortize(input),
    });
    tools.sharpe_ratio = tool({
      description: "Compute the Sharpe ratio (risk-adjusted return) for a return series. Optionally annualize by multiplying by √252.",
      inputSchema: z.object({
        entity: z.string(),
        valueColumn: z.string(),
        riskFreeRate: z.number().default(0),
        annualize: z.boolean().default(false),
      }),
      execute: (input) => AnalyticsService.sharpeRatio({ ...input, organizationId }),
    });
    tools.max_drawdown = tool({
      description: "Calculate the maximum peak-to-trough decline as a percentage of peak value.",
      inputSchema: z.object({ entity: z.string(), dateColumn: z.string(), valueColumn: z.string() }),
      execute: (input) => AnalyticsService.maxDrawdown({ ...input, organizationId }),
    });
    tools.rolling_returns = tool({
      description: "Compute a period-over-period return series within a rolling window.",
      inputSchema: z.object({ entity: z.string(), dateColumn: z.string(), valueColumn: z.string(), window: z.number().int() }),
      execute: (input) => AnalyticsService.rollingReturns({ ...input, organizationId }),
    });
  }

  // ── Pack: web_search ────────────────────────────────────────────────
  if (packs.has("web_search")) {
    tools.web_search = AiService.buildWebSearchTool();
  }

  // ── Custom webhook tools ────────────────────────────────────────────
  // Appended from station_tools rows — always included regardless of packs
  const customToolDefs = await stationToolsRepo.findByStation(stationId, organizationId);
  for (const def of customToolDefs) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchemaToZod(def.parameterSchema),
      execute: async (input) => callWebhook(def.implementation, input),
    });
  }

  return tools;
}
```

#### PortalService — Agentic Tool Loop

The core orchestration layer. Calls Claude with the analytics tools, handles the tool_use loop (Claude may call multiple tools in sequence), and streams results to the frontend via SSE.

```typescript
import { streamText } from "ai";
import { AiService } from "./ai.service.js";
import { buildAnalyticsTools } from "./analytics.tools.js";
import { SseUtil } from "../utils/sse.util.js";

export class PortalService {

  /** Run a portal turn: stream Claude's response while executing tool calls */
  static async streamResponse(params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    stationContext: { stationId: string; stationName: string; entities: Array<{ key: string; label: string; schema: Record<string, string> }> };
    organizationId: string;
    sse: SseUtil;
  }): Promise<void> {
    const { messages, stationContext, organizationId, sse } = params;

    // All tools come exclusively from the station's selected packs and custom webhook tools.
    // No implicit tools are included — AiService.tools is NOT merged here.
    const tools = await buildAnalyticsTools(organizationId, stationContext.stationId);

    const entitySchemas = stationContext.entities
      .map((e) => `### ${e.label} (table: \`${e.key}\`)\n${JSON.stringify(e.schema, null, 2)}`)
      .join("\n\n");

    const availableToolNames = Object.keys(tools).join(", ");

    const systemPrompt = [
      "You are a data analyst assistant.",
      `The user is working with station "${stationContext.stationName}" which contains the following entities:`,
      "",
      entitySchemas,
      "",
      `You have access to the following tools: ${availableToolNames}`,
      "Use only the tools listed above. Respond in markdown. Keep explanations concise.",
      "When presenting tabular results, format them as markdown tables.",
    ].join("\n");

    const result = streamText({
      model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
      system: systemPrompt,
      messages,
      tools,
      maxSteps: 10,  // Allow up to 10 tool calls in a single turn
      onStepFinish: ({ toolResults }) => {
        // Only visualize results need a dedicated content block — all other tool
        // results are interpreted by Claude and included in its markdown response
        for (const toolResult of toolResults) {
          if (toolResult.toolName === "visualize") {
            sse.send("tool_result", { type: "vega-lite", ...toolResult.result });
          }
        }
      },
    });

    // Stream text deltas as they arrive
    for await (const delta of result.textStream) {
      sse.send("delta", { content: delta });
    }

    sse.send("done", {});
    sse.end();
  }
}
```

#### Portal SSE Router

Follows the same pattern as `job-events.router.ts` — mounted outside `protectedRouter`, uses query-param auth via `sseAuth` middleware.

```typescript
// apps/api/src/routes/portal-events.router.ts
import { Router, Request, Response, NextFunction } from "express";
import { sseAuth } from "../middleware/sse-auth.middleware.js";
import { SseUtil } from "../utils/sse.util.js";
import { PortalService } from "../services/portal.service.js";

export const portalEventsRouter = Router();

portalEventsRouter.get(
  "/:portalId/stream",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sse = new SseUtil(res);

      // Load portal messages and station context
      const portal = await PortalService.getPortal(req.params.portalId);

      await PortalService.streamResponse({
        messages: portal.messages,
        stationContext: portal.stationContext,
        organizationId: portal.organizationId,
        sse,
      });
    } catch (error) {
      next(error);
    }
  }
);
```

Mounted in `app.ts` alongside the existing SSE route:

```typescript
app.use("/api/sse/jobs", jobEventsRouter);
app.use("/api/sse/portals", portalEventsRouter);  // new
```

#### Portal REST Router

Handles portal creation and message submission. The POST triggers the SSE stream — the client immediately connects to the SSE endpoint after submitting.

```typescript
// apps/api/src/routes/portal.router.ts
import { Router } from "express";
import { PortalService } from "../services/portal.service.js";

export const portalRouter = Router();

/** Open a new portal from a station */
portalRouter.post("/", async (req, res, next) => {
  try {
    const { stationId } = req.body;
    const organizationId = req.auth!.payload.org_id as string;
    const portal = await PortalService.createPortal({ stationId, organizationId });
    res.json({ portalId: portal.id });
  } catch (error) {
    next(error);
  }
});

/** Send a message — appends to portal history, returns portalId for SSE connection */
portalRouter.post("/:portalId/messages", async (req, res, next) => {
  try {
    const { message } = req.body;
    await PortalService.addMessage(req.params.portalId, { role: "user", content: message });
    res.json({ portalId: req.params.portalId, status: "streaming" });
    // Client connects to GET /api/sse/portals/:portalId/stream to receive the response
  } catch (error) {
    next(error);
  }
});
```

Mounted on the protected router:

```typescript
protectedRouter.use("/portals", portalRouter);  // new
```

---

#### Frontend Data Flow

```
1. User opens a Station and clicks "New Portal"
2. POST /api/portals { stationId } → { portalId }
3. User types: "Show me revenue trends by quarter"
4. POST /api/portals/:portalId/messages { message }
5. Connect to GET /api/sse/portals/:portalId/stream?token=<jwt>
6. Receive SSE events:
     event: delta    → data: {"content": "Here are the revenue"}
     event: delta    → data: {"content": " trends by quarter:\n\n"}
     event: tool_result → data: {"type": "vega-lite", "spec": { "mark": "line", ... }}
     event: delta    → data: {"content": "Revenue shows a steady upward..."}
     event: done     → data: {}
7. Frontend accumulates deltas into text blocks, inserts tool_result blocks inline
8. Renders: [markdown paragraph] [Vega-Lite chart] [markdown paragraph]
```

---

#### Frontend Dependencies

```json
{
  "react-markdown": "^9.x",
  "remark-gfm": "^4.x",
  "react-vega": "^7.x",
  "vega": "^5.x",
  "vega-lite": "^5.x"
}
```

Added to `apps/web/package.json`.

#### Backend Dependencies

```json
{
  "alasql": "^4.x",
  "arquero": "^7.x",
  "simple-statistics": "^7.x",
  "ml-kmeans": "^6.x"
}
```

Added to `apps/api/package.json`. Note: `ml-kmeans` is the specific ml.js sub-package for k-means — import only what's needed rather than the full `ml` bundle.

---

---

## Custom Tool Extensibility

The built-in analytics tools (SQL, stats, clustering, visualization) cover common patterns, but users may need domain-specific analysis beyond what the platform hard-codes — custom scoring models, industry-specific metrics, proprietary algorithms, or integrations with external computation services. This section explores how to support user-defined tools within the existing architecture.

---

### The Extension Point

`buildAnalyticsTools()` is already a factory function that composes a tool map at portal-open time. It accepts `organizationId` for scoping and returns a plain object consumed by the Vercel AI SDK's `tools` parameter. This is the natural extension point: the factory can be made async and extended to merge in station-scoped custom tools alongside the built-ins.

```typescript
// Current signature
export function buildAnalyticsTools(organizationId: string): Record<string, Tool>

// Extended signature
export async function buildAnalyticsTools(organizationId: string, stationId: string): Promise<Record<string, Tool>>
```

The result is still merged at the call site in `PortalService.streamResponse()`:

```typescript
const tools = {
  ...AiService.tools,
  ...await buildAnalyticsTools(organizationId, stationId),
};
```

Custom tools are invisible to the platform — Claude sees them exactly like built-ins, with the user-provided name and description guiding tool selection.

---

### Three Implementation Options

#### Option A: Webhook-based custom tools (recommended)

Users register a tool definition per station: a name, description, JSON Schema for input parameters, and a webhook URL. When Claude selects the tool, the API POSTs the resolved parameters to the URL and returns the JSON response to Claude.

**Best for:** Domain-specific computation hosted externally, integration with existing internal services, language-agnostic implementations.

```
Claude calls "score_lead" tool
  → API POSTs { lead_score_id, entity, column } to https://internal.company.com/lead-scorer
  → Webhook returns { score: 0.87, factors: [...] }
  → Claude narrates the result
```

**Pros:** No code execution on the server, clear security boundary, language-agnostic, webhook owner controls rate limits and auth.

**Cons:** Requires the user to host and maintain an endpoint, introduces network latency and availability dependency.

#### Option B: Sandboxed JavaScript snippets

Users write a JavaScript function body stored as a string in the DB. At execution time the API runs it in an isolated sandbox (`isolated-vm` or `vm.runInNewContext`) with a read-only `data` context (the pre-loaded entity records map) and no access to network or filesystem.

**Best for:** Power users who want custom logic without deploying infrastructure.

```typescript
// User-authored snippet (stored in DB)
const values = data.orders.map(r => r.revenue);
return { total: values.reduce((a, b) => a + b, 0), count: values.length };
```

**Pros:** Self-contained, no external dependencies, executes in-process alongside entity data.

**Cons:** Requires robust sandboxing to prevent resource exhaustion and escapes; users must know JavaScript; harder to test and version.

#### Option C: Curated tool packs (opt-in library extensions)

Additional algorithms implemented by the Portal.ai team — ARIMA time-series forecasting (`ml-arima`), text sentiment (`natural`), geospatial analysis (`@turf/turf`) — surfaced as optional "packs" that can be toggled on per station.

**Best for:** Common use cases that are too niche for all stations but safe to offer as a library.

**Pros:** Fully vetted and tested, no user code, consistent behavior.

**Cons:** Each new capability requires an engineering release; users cannot add their own logic.

---

### Recommended Approach: Webhook-first with curated packs

**Phase 1 — Curated packs.** Implement `regression`, `trend`, and the financial analytics pack as additional `AnalyticsService` methods. This covers the highest-value gaps without introducing code execution.

**Phase 2 — Webhook-based custom tools.** Add the `station_tools` table and extend `buildAnalyticsTools()` to load and wrap registered webhooks. This gives users full extensibility without any sandboxing complexity.

**Phase 3 — Sandboxed JS snippets.** Revisit once the webhook pattern is validated; JS snippets can be offered as an alternative implementation type within the same `station_tools` schema.

---

### Financial Analytics Pack

A curated set of tools for financial time-series analysis, capital budgeting math, and risk metrics. Implemented as additional `AnalyticsService` static methods registered in `buildAnalyticsTools()` alongside the core tools.

#### New dependencies

**`technicalindicators`** — the most complete technical indicator library for Node.js. Pure JS, no native bindings, TypeScript types included. Covers 30+ indicators: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV, Stochastic, Williams %R, CCI, and more.

**`financial`** — TypeScript port of Python's `numpy-financial`. Covers time-value-of-money and capital budgeting math: `npv`, `irr`, `pmt` (loan payment), `pv`, `fv`, `mirr`, `nper`, `rate`. Pure ESM, zero deps.

Risk metrics (Sharpe ratio, VaR, drawdown, rolling returns) are derived from `simple-statistics` and `arquero`, which are already in the dependency set — no additional library is needed.

#### Tool surface

| Tool | Library | Input Parameters | Use Case |
|------|---------|-----------------|----------|
| `technical_indicator` | `technicalindicators` | `{ entity, dateColumn, valueColumn, indicator: "SMA"\|"EMA"\|"RSI"\|"MACD"\|"BB"\|"ATR"\|"OBV", params }` | Price/time-series technical analysis |
| `npv` | `financial` | `{ rate: number, cashFlows: number[] }` | Net present value of a cash flow series |
| `irr` | `financial` | `{ cashFlows: number[] }` | Internal rate of return |
| `amortize` | `financial` | `{ principal, annualRate, periods }` | Loan amortization schedule — returns one row per period |
| `sharpe_ratio` | `simple-statistics` | `{ entity, valueColumn, riskFreeRate?, annualize? }` | Risk-adjusted return (mean − risk-free rate) / stddev |
| `max_drawdown` | `arquero` | `{ entity, dateColumn, valueColumn }` | Peak-to-trough decline as a percentage of peak value |
| `rolling_returns` | `arquero` | `{ entity, dateColumn, valueColumn, window }` | Period-over-period return series within a rolling window |

`technical_indicator` exposes the full indicator library through a single tool — Claude selects the appropriate indicator via the `indicator` enum param based on the user's intent, keeping the tool count manageable.

#### What is covered by existing deps

| Capability | How |
|---|---|
| Sharpe ratio | `ss.mean(returns)` and `ss.standardDeviation(returns)` from `simple-statistics` |
| Value at Risk (VaR) | `ss.quantile(returns, 0.05)` from `simple-statistics` |
| Max drawdown | Rolling max window then `(peak − trough) / peak` via `arquero` |
| Rolling returns | `aq.window()` on a date-sorted value column via `arquero` |
| Period-over-period growth | `arquero` derive with lag — no new dep |

---

### Database Schema: `station_tools`

```sql
-- One row per user-defined tool, scoped to a station
id                  uuid PRIMARY KEY
organization_id     uuid REFERENCES organizations(id)
station_id          uuid REFERENCES stations(id)
name                text NOT NULL   -- used as the tool key, e.g. "score_lead" (must be unique within a station, cannot shadow built-in names)
description         text NOT NULL   -- Claude uses this to decide when to call the tool
parameter_schema    jsonb NOT NULL  -- JSON Schema object describing input parameters
implementation      jsonb NOT NULL  -- { type: "webhook", url: string, headers?: Record<string,string> }
                                    -- future: { type: "script", code: string }
created             timestamp
updated             timestamp
deleted             timestamp       -- soft delete
```

Dual-schema model in `packages/core`: `StationToolSchema` + `StationToolModel` + `StationToolModelFactory` following the existing pattern.

---

### `callWebhook()` behaviour

`callWebhook()` handles: POST to the URL with the input payload, injects optional auth headers, enforces a 30 s timeout (matching AI analysis timeout), and validates that the response is JSON. If the webhook returns `{ type: "vega-lite", spec: {...} }`, `PortalService.streamResponse()` emits it as a `tool_result` SSE event for chart rendering — same as the `visualize` pack tool.

---

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| No implicit tools | Every tool Claude can call is explicitly selected by the station operator. There is no platform-wide default set. |
| Station must have ≥1 pack | `buildAnalyticsTools()` throws if no packs are selected; portal creation validates this before writing the row. Enforced in the Zod model (`toolPacks: z.array(StationToolPackSchema).min(1)`) and at the API layer. |
| Packs are the selection unit, not individual tools | Users choose capabilities (financial analysis, regression, etc.), not individual function names. This keeps the station setup UI simple and prevents partial/broken configurations. |
| Tool names must not shadow pack tool names | Prevent custom webhook tools silently overriding curated pack tools; validated at `station_tools` creation time via `StationToolsRepository.create()`. |
| `web_search` is a pack, not a platform default | Web access is opt-in per station. A support-ticket station should not be able to search the web; a research station should. Explicit selection makes this auditable. |
| System prompt lists only available tools | The system prompt is generated from `Object.keys(tools)` — Claude is told exactly what it can call and never invents tools that aren't in the map. |
| Webhook auth headers stored encrypted | Tool definitions may include API keys; store `headers` field encrypted at rest using the same mechanism as connector credentials. |
| Webhook response schema is open | Claude narrates arbitrary JSON tool results; only `{ type: "vega-lite", spec }` responses get special frontend rendering. |

---

### New Files

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/core/src/models/station-tool.model.ts` | Zod model for StationTool |
| Create | `apps/api/src/db/schema/station-tools.table.ts` | Drizzle table definition |
| Create | `apps/api/src/db/repositories/station-tools.repository.ts` | CRUD + findByStation |
| Create | `apps/api/src/routes/station-tools.router.ts` | REST endpoints: list, create, update, delete |
| Modify | `apps/api/src/services/analytics.tools.ts` | Extend `buildAnalyticsTools()` to accept `stationId`, load and wrap custom tools |
| Modify | `apps/api/src/services/portal.service.ts` | Pass `stationId` into `buildAnalyticsTools()` |

---

## Agentic Architecture: Deeper Interaction Design

The current design handles a single turn well: user sends a message, Claude calls tools, streams a response. This section documents the decisions that keep the architecture open to richer, multi-turn agentic interaction in the future — without adding that complexity now.

---

### Conversation Thread as a Future-Proof Checkpoint Store

The `portal_messages` table is not just a display history — it is the agent's memory. The schema stores a full ordered sequence of `role` + `blocks` per turn, but `PortalService` should reconstruct the `CoreMessage[]` array (Vercel AI SDK format) when loading a portal for a new turn. This means:

- **User turns** map directly to `{ role: "user", content: string }`
- **Assistant turns** map to `{ role: "assistant", content: ContentBlock[] }` including inline tool-call and tool-result pairs as they were produced by `streamText`
- The full sequence — including tool calls and their results — is passed back to Claude on every new turn so it can reason about prior analysis steps

This is the same structure that [LangGraph's `MessagesAnnotation`](https://langchain-ai.github.io/langgraphjs/concepts/low_level/#messagesannotation) uses for its state. If LangGraph is introduced later, `portal_messages` rows become the PostgreSQL checkpoint store with a schema rename, not a rewrite.

**What this means in practice:** `PortalService.streamResponse()` must store assistant turns as the full Vercel AI SDK `CoreMessage[]` representation (including `toolCall` and `toolResult` content parts), not just the rendered text output. The `blocks` JSONB field should hold this full structure. `ContentBlockRenderer` handles rendering — the storage format is the source of truth.

---

### Tool Results as Interactive UI Objects

The current plan renders vega-lite tool results as charts and all other tool output as Claude's narrated markdown. For deeper interaction, tool results that return structured data should be rendered directly as UI objects the user can read and follow up on — not just described in prose.

**Extended `ContentBlock` union:**

```typescript
type ContentBlock =
  | { type: "text"; content: string }
  | { type: "vega-lite"; spec: VisualizationSpec }
  | { type: "data-table"; columns: string[]; rows: Record<string, unknown>[] }
```

The `data-table` block type covers results from `sql_query`, `detect_outliers`, `cluster`, and any tool returning a row set. The frontend renders it as a compact, non-paginated mini-table directly in the chat thread. This matters because:

- Users can see the exact data Claude reasoned about, building trust
- Users can ask follow-up questions referencing specific rows ("why is record X flagged?")
- The interaction feels like analysis, not conversation

The `PortalService` decides which tool results warrant a `data-table` block vs. passing results silently to Claude for narration. Simple scalar results (correlation coefficient, cluster count) are narrated; row sets are surfaced as blocks.

---

### Multi-step Tool Use Within a Single Turn

`streamText` with `maxSteps: 10` already enables multi-step tool use — Claude can call `sql_query` to filter records, then `describe_column` on the results, then `visualize` to chart them, all within a single user message. This is the single-turn equivalent of a LangGraph cycle and covers most analytical workflows without requiring a graph.

The `onStepFinish` callback in `PortalService.streamResponse()` is the hook for emitting intermediate tool results as SSE events before the final text response arrives. Clients should render these blocks progressively — the user sees the chart appear as Claude is still composing its narrative.

---

### LangGraph Migration Path

When the feature needs to evolve beyond single-turn multi-step — for example, branching analysis paths, parallel subgraph execution, or human-in-the-loop pauses mid-analysis — LangGraph can be introduced without changing the API contract or the database schema.

| Current (Vercel AI SDK) | LangGraph equivalent |
|---|---|
| `portal_messages.blocks: CoreMessage[]` | `MessagesAnnotation` state |
| Each `tool()` definition in `analytics.tools.ts` | A node in `StateGraph` |
| `streamText({ maxSteps })` | `graph.stream()` |
| `POST /api/portals/:id/messages` | Same endpoint — swap `PortalService` internals |
| `portal_messages` rows in PostgreSQL | PostgreSQL checkpointer (`@langchain/langgraph-checkpoint-postgres`) |

**Nothing about the API contract, the DB schema, or the frontend changes.** The migration scope is entirely inside `PortalService.streamResponse()` and `analytics.tools.ts`. The tool definitions move from Vercel AI SDK `tool()` wrappers to LangGraph nodes; the conversation history in Postgres is already the checkpoint store.

---

## Open Questions

1. ~~**Entity schema discovery**~~ — **Resolved.** Each entity record is associated with a `connectorEntity`, which has `fieldMappings` that map source fields to the organization's `columnDefinitions`. When a portal is opened, the schema for each connector entity is derived by walking `connectorEntity → fieldMappings → columnDefinitions` to produce a typed column catalog (name, type, required, etc.) for the system prompt.
2. ~~**Portal persistence**~~ — **Resolved.** Portals and their message history are persisted in `portals` and `portal_messages` tables. Users can pin individual content blocks to `portal_results` for named, durable references. See schema above.
3. **Data size limits** — In-memory analytics work well for thousands of records. For larger datasets, consider pre-aggregation, sampling (pass a `LIMIT` in the data load), or pushing queries to PostgreSQL directly.
4. **Authorization** — Entity data is scoped to `organizationId`. Should there be finer-grained access control (e.g., per-station or per-portal permissions)?
5. **Station management UI** — Where should station CRUD live in the frontend? Dedicated settings page, or inline from the portal creation flow?
6. **Result caching** — Cache loaded entity records in-memory (or Redis) for the duration of a portal session to avoid repeated DB round-trips when Claude calls multiple tools.
7. **SQL injection in AlaSQL** — AlaSQL executes against in-memory arrays (not a real database), so traditional SQL injection risks are limited. However, validate that generated SQL cannot trigger AlaSQL file I/O operations (`SELECT INTO`, `ATTACH`). Consider an allowlist of SQL operations.
8. **Vega-Lite spec validation** — Validate Claude-generated specs against the Vega-Lite JSON schema before sending to the frontend, to prevent rendering errors.
9. **Custom tool response rendering** — Webhook-based custom tools can return arbitrary JSON. If a custom tool returns a `{ type: "vega-lite", spec }` payload, `PortalService` can emit it as a `tool_result` SSE event for chart rendering. How should other rich response types (tables, images, custom UI blocks) be handled? Define a response envelope standard now, or evolve it as needs arise?
10. **JSON Schema → Zod conversion** — `buildAnalyticsTools()` will need to convert user-supplied JSON Schema parameter definitions into Zod schemas at runtime (for the Vercel AI SDK `inputSchema`). Evaluate `json-schema-to-zod` or `zod-from-json-schema`; alternatively, constrain `parameter_schema` to a limited subset of JSON Schema types (string, number, boolean, enum, array of primitives) and map them manually to keep the conversion trivial and predictable.
