# MCP Data Analysis Feature

## Overview

Stations, Portals, and an embedded analytics engine that lets users query their connector entity data using natural language. Claude orchestrates a set of analytics tools (SQL via AlaSQL, stats via simple-statistics, clustering via ml-kmeans, visualization via Vega-Lite) embedded directly in the API. Results are streamed to a chat-like Portal UI and can be pinned as named saved results.

**Architecture decision — Option 2: Analytics Tools Embedded in API.** Analytics tools are implemented as static `AnalyticsService` methods and registered as Vercel AI SDK `tool()` definitions in `analytics.tools.ts`, alongside the existing `AiService.tools`. No separate MCP server process is needed. The MCP protocol can be adopted later by wrapping the same service methods in MCP tool handlers.

**Custom tooling — Option A: Webhook-based custom tools.** Users can register per-station custom tools that point to external webhook endpoints. Phase 1 ships curated built-in tool packs (`regression`, `trend`) via `AnalyticsService`. Phase 2 adds the `station_tools` database table, `StationToolsRepository`, and station-tools REST routes so users can register arbitrary webhook tools. `buildAnalyticsTools(organizationId, stationId)` is async from the start to accommodate Phase 2 without a future signature break.

Reference discovery doc: `features/MCP.discovery.md`

---

## Phase 1 — Core models (`packages/core`)

Add Zod models for all new domain objects following the existing dual-schema pattern. Includes the `StationTool` model needed for webhook-based custom tools (Phase 2 DB + routes, but model defined here to keep the dual-schema pattern intact).

### Checklist
- [ ] Add `StationSchema` + `StationModel` + `StationModelFactory` in `station.model.ts`
- [ ] Add `PortalSchema` + `PortalModel` + `PortalModelFactory` in `portal.model.ts`
- [ ] Add `PortalResultSchema` + `PortalResultModel` + `PortalResultModelFactory` in `portal-result.model.ts`
- [ ] Add `StationToolSchema` + `StationToolModel` + `StationToolModelFactory` in `station-tool.model.ts` — fields: `id`, `organizationId`, `stationId`, `name`, `description`, `parameterSchema` (jsonb), `implementation` (jsonb: `{ type: "webhook", url: string, headers?: Record<string,string> }`) + baseColumns
- [ ] Add `portal.contract.ts` — Zod schemas for `CreatePortalBody`, `SendMessageBody`, `PinResultBody`, `PortalMessageResponse`, SSE event payloads (`DeltaEvent`, `ToolResultEvent`, `DoneEvent`)
- [ ] Add `station.contract.ts` — Zod schemas for `CreateStationBody`, `UpdateStationBody`, `StationListResponse`
- [ ] Add `station-tool.contract.ts` — Zod schemas for `CreateStationToolBody`, `UpdateStationToolBody`, `StationToolListResponse`
- [ ] Export all new models and contracts from `packages/core/src/index.ts`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

### Files
| Action | File |
|--------|------|
| Create | `packages/core/src/models/station.model.ts` |
| Create | `packages/core/src/models/portal.model.ts` |
| Create | `packages/core/src/models/portal-result.model.ts` |
| Create | `packages/core/src/models/station-tool.model.ts` |
| Create | `packages/core/src/contracts/station.contract.ts` |
| Create | `packages/core/src/contracts/portal.contract.ts` |
| Create | `packages/core/src/contracts/station-tool.contract.ts` |
| Modify | `packages/core/src/index.ts` |

---

## Phase 2 — Database schema + migrations (`apps/api`)

Define Drizzle tables for all new entities, update `organizations`, add type-check assertions, and generate + apply migrations. Includes the `station_tools` table for webhook-based custom tools.

### Checklist
- [ ] Create `stations.table.ts` — `id`, `organizationId`, `name`, `description`, `createdBy` + baseColumns
- [ ] Create `station-instances.table.ts` — `id`, `stationId`, `connectorInstanceId`, `created` (join table, no soft delete)
- [ ] Create `portals.table.ts` — `id`, `organizationId`, `stationId`, `name`, `createdBy` + baseColumns
- [ ] Create `portal-messages.table.ts` — `id`, `portalId`, `organizationId`, `role` enum (`user`|`assistant`), `blocks` jsonb, `created`
- [ ] Create `portal-results.table.ts` — `id`, `organizationId`, `stationId`, `portalId` (nullable), `name`, `type` enum (`text`|`vega-lite`), `content` jsonb, `createdBy` + baseColumns
- [ ] Create `station-tools.table.ts` — `id`, `organizationId`, `stationId`, `name`, `description`, `parameterSchema` jsonb, `implementation` jsonb + baseColumns
- [ ] Modify `organizations.table.ts` — add `defaultStationId` (nullable text FK → stations)
- [ ] Add drizzle-zod `createSelectSchema` / `createInsertSchema` entries in `zod.ts`
- [ ] Add bidirectional `IsAssignable` type guards in `type-checks.ts` for all new tables
- [ ] Export new tables from `apps/api/src/db/schema/index.ts`
- [ ] `npm run db:generate` — generates migration SQL
- [ ] `npm run db:migrate` — applies migration
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/db/schema/stations.table.ts` |
| Create | `apps/api/src/db/schema/station-instances.table.ts` |
| Create | `apps/api/src/db/schema/portals.table.ts` |
| Create | `apps/api/src/db/schema/portal-messages.table.ts` |
| Create | `apps/api/src/db/schema/portal-results.table.ts` |
| Create | `apps/api/src/db/schema/station-tools.table.ts` |
| Modify | `apps/api/src/db/schema/organizations.table.ts` |
| Modify | `apps/api/src/db/schema/zod.ts` |
| Modify | `apps/api/src/db/schema/type-checks.ts` |
| Modify | `apps/api/src/db/schema/index.ts` |

---

## Phase 3 — Repositories (`apps/api`)

One repository per new table, extending the base `Repository` class.

### Checklist
- [ ] `StationsRepository` — `findById`, `findMany` (by org), `create`, `update`, `softDelete`
- [ ] `StationInstancesRepository` — `findByStationId`, `create`, `hardDelete` (join table — no soft delete)
- [ ] `PortalsRepository` — `findById`, `findByStation`, `findRecentByOrg(limit)`, `create`, `update`, `softDelete`
- [ ] `PortalMessagesRepository` — `findByPortal` (ordered by `created` asc), `create`
- [ ] `PortalResultsRepository` — `findById`, `findByStation`, `create`, `update`, `softDelete`
- [ ] `StationToolsRepository` — `findById`, `findByStation(stationId, organizationId)`, `create` (validate name does not shadow a built-in tool name), `update`, `softDelete`
- [ ] Register all new repositories on `DbService.repository` in `db.service.ts`
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/db/repositories/stations.repository.ts` |
| Create | `apps/api/src/db/repositories/station-instances.repository.ts` |
| Create | `apps/api/src/db/repositories/portals.repository.ts` |
| Create | `apps/api/src/db/repositories/portal-messages.repository.ts` |
| Create | `apps/api/src/db/repositories/portal-results.repository.ts` |
| Create | `apps/api/src/db/repositories/station-tools.repository.ts` |
| Modify | `apps/api/src/services/db.service.ts` |

---

## Phase 4 — Analytics Service (`apps/api`)

Stateless service with static methods. Each method receives pre-loaded records and runs the analysis. All methods are organized by pack — there is no distinction between "core" and "curated" at the service layer. Pack membership only affects whether a tool is registered in `buildAnalyticsTools()`.

### Checklist
- [ ] Install dependencies: `alasql`, `arquero`, `simple-statistics`, `ml-kmeans`, `technicalindicators`, `financial` in `apps/api/package.json`
- [ ] Install type stubs where needed (`@types/alasql`, `@types/simple-statistics`)
- [ ] Implement `AnalyticsService.loadStation(stationId, organizationId)`:
  - [ ] Resolve `stationId → station_instances → connectorInstanceIds`
  - [ ] For each instance: `ConnectorEntityRepository.findByConnectorInstanceId()`
  - [ ] For each entity: walk `fieldMappings → columnDefinitions` to build typed schema catalog
  - [ ] Fetch `EntityRecordRepository.findMany({ connectorEntityId })` → extract `normalizedData`
  - [ ] Register each entity as a named AlaSQL table (`connectorEntity.key`)
  - [ ] Return `{ entities: EntitySchema[], records: Map<key, rows[]> }`
- [ ] Implement `AnalyticsService.loadRecords(entityKey, organizationId)` — resolves key → records
- [ ] **Pack `data_query` — `AnalyticsService.sqlQuery({ sql, organizationId })`** — executes against AlaSQL; validates SQL against an allowlist (block `SELECT INTO`, `ATTACH`)
- [ ] **Pack `data_query` — `AnalyticsService.visualize({ sql, vegaLiteSpec, organizationId })`** — runs SQL then injects rows into spec
- [ ] **Pack `statistics` — `AnalyticsService.describeColumn({ entity, column, organizationId })`** — count, mean, median, stddev, min, max, p25, p75
- [ ] **Pack `statistics` — `AnalyticsService.correlate({ entity, columnA, columnB, organizationId })`** — Pearson correlation
- [ ] **Pack `statistics` — `AnalyticsService.detectOutliers({ entity, column, method, organizationId })`** — IQR or Z-score
- [ ] **Pack `statistics` — `AnalyticsService.cluster({ entity, columns, k, organizationId })`** — k-means via ml-kmeans
- [ ] **Pack `regression` — `AnalyticsService.regression({ entity, x, y, type, organizationId })`** — linear or polynomial regression via simple-statistics; returns coefficients and R-squared
- [ ] **Pack `regression` — `AnalyticsService.trend({ entity, dateColumn, valueColumn, interval, organizationId })`** — time-series aggregation via Arquero + linear trend line via simple-statistics
- [ ] **Pack `financial` — `AnalyticsService.technicalIndicator({ entity, dateColumn, valueColumn, indicator, params, organizationId })`** — SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV via `technicalindicators`; returns `{ dates: string[], values: number[] | object[] }` aligned to input series
- [ ] **Pack `financial` — `AnalyticsService.npv({ rate, cashFlows })`** — net present value via `financial`; returns `{ npv: number }`
- [ ] **Pack `financial` — `AnalyticsService.irr({ cashFlows })`** — internal rate of return via `financial`; returns `{ irr: number }`
- [ ] **Pack `financial` — `AnalyticsService.amortize({ principal, annualRate, periods })`** — loan amortization schedule via `financial`; returns one row per period with `{ period, payment, principal, interest, balance }`
- [ ] **Pack `financial` — `AnalyticsService.sharpeRatio({ entity, valueColumn, riskFreeRate, annualize, organizationId })`** — `(mean − riskFreeRate) / stddev` via simple-statistics; `annualize: boolean` multiplies by `√252` for daily data
- [ ] **Pack `financial` — `AnalyticsService.maxDrawdown({ entity, dateColumn, valueColumn, organizationId })`** — rolling peak then `(peak − trough) / peak` via Arquero; returns `{ maxDrawdown: number, peakDate, troughDate }`
- [ ] **Pack `financial` — `AnalyticsService.rollingReturns({ entity, dateColumn, valueColumn, window, organizationId })`** — period-over-period return series within a rolling window via Arquero; returns `{ dates: string[], returns: number[] }`
- [ ] Unit tests for each method with fixture records
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/services/analytics.service.ts` |
| Create | `apps/api/src/__tests__/services/analytics.service.test.ts` |
| Modify | `apps/api/package.json` |

---

## Phase 5 — Analytics Tool Definitions (`apps/api`)

Vercel AI SDK `tool()` wrappers around `AnalyticsService` methods and user-registered webhook tools. Every tool is conditional on a pack being selected for the station — there are no always-on tools. `web_search` is a first-class pack, not a platform default.

### Checklist
- [ ] Define `StationToolPack` enum in `packages/core/src/models/station.model.ts`: `"data_query" | "statistics" | "regression" | "financial" | "web_search"`
- [ ] Update `StationSchema` to include `toolPacks: z.array(StationToolPackSchema).min(1)` — enforces the ≥1 pack requirement at the model layer
- [ ] Implement `buildAnalyticsTools(organizationId, stationId)` as an **async** factory in `analytics.tools.ts`; throw if `station.toolPacks` is empty
- [ ] Pack `data_query` — register tools only when `packs.has("data_query")`:
  - [ ] `sql_query` — Zod input `{ sql: string }`
  - [ ] `visualize` — Zod input `{ sql, vegaLiteSpec }`
- [ ] Pack `statistics` — register tools only when `packs.has("statistics")`:
  - [ ] `describe_column` — Zod input `{ entity, column }`
  - [ ] `correlate` — Zod input `{ entity, columnA, columnB }`
  - [ ] `detect_outliers` — Zod input `{ entity, column, method }`
  - [ ] `cluster` — Zod input `{ entity, columns, k }`
- [ ] Pack `regression` — register tools only when `packs.has("regression")`:
  - [ ] `regression` — Zod input `{ entity, x, y, type }`
  - [ ] `trend` — Zod input `{ entity, dateColumn, valueColumn, interval }`
- [ ] Pack `financial` — register tools only when `packs.has("financial")`:
  - [ ] `technical_indicator` — Zod input `{ entity, dateColumn, valueColumn, indicator: enum["SMA","EMA","RSI","MACD","BB","ATR","OBV"], params? }`
  - [ ] `npv` — Zod input `{ rate: number, cashFlows: number[] }`
  - [ ] `irr` — Zod input `{ cashFlows: number[] }`
  - [ ] `amortize` — Zod input `{ principal: number, annualRate: number, periods: number }`
  - [ ] `sharpe_ratio` — Zod input `{ entity, valueColumn, riskFreeRate?: number, annualize?: boolean }`
  - [ ] `max_drawdown` — Zod input `{ entity, dateColumn, valueColumn }`
  - [ ] `rolling_returns` — Zod input `{ entity, dateColumn, valueColumn, window: number }`
- [ ] Pack `web_search` — register tool only when `packs.has("web_search")`:
  - [ ] `web_search` — delegate to `AiService.buildWebSearchTool()` (no `organizationId` scoping needed)
- [ ] Custom webhook tools — always appended from `StationToolsRepository.findByStation(stationId, organizationId)`:
  - [ ] Convert each tool's `parameterSchema` (JSON Schema) to a Zod schema at runtime
  - [ ] Tool `execute` calls `callWebhook(def.implementation, input)` with a 30 s timeout
  - [ ] If webhook response contains `{ type: "vega-lite", spec }`, propagate as a chart result
  - [ ] Validate custom tool names do not shadow any pack tool name (throw on conflict)
- [ ] Implement `callWebhook(implementation, input)` helper — POST to URL, inject auth headers, enforce timeout, return parsed JSON
- [ ] Unit tests: each pack's tools are present only when the pack is in `station.toolPacks`; absent otherwise
- [ ] Unit tests: `callWebhook` called with correct URL + headers for a webhook tool; timeout enforced; response returned
- [ ] Unit tests: throws when `station.toolPacks` is empty
- [ ] `npm run type-check` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/services/analytics.tools.ts` |
| Create | `apps/api/src/__tests__/services/analytics.tools.test.ts` |

---

## Phase 6 — Portal Service (`apps/api`)

Orchestrates portal lifecycle: creation, message persistence, Claude agentic streaming loop.

### Checklist
- [ ] Implement `PortalService.createPortal({ stationId, organizationId, userId })`:
  - [ ] Validate station exists and belongs to org
  - [ ] Validate `station.toolPacks.length >= 1` — return `PORTAL_STATION_NO_TOOLS` error if not
  - [ ] Create `portals` row with auto-generated name (`Portal — <date>`)
  - [ ] Call `AnalyticsService.loadStation()` and cache result in memory keyed by `portalId`
  - [ ] Return `{ portalId, stationContext }`
- [ ] Implement `PortalService.getPortal(portalId)` — loads portal + full message history from DB
- [ ] Implement `PortalService.addMessage(portalId, { role, content })` — persists message row; assembles `blocks[]` for assistant turns
- [ ] Implement `PortalService.streamResponse({ portalId, messages, stationContext, organizationId, sse })`:
  - [ ] Build system prompt from station name + entity schemas; append list of custom tool names + descriptions if any are registered on the station
  - [ ] Call `await buildAnalyticsTools(organizationId, stationContext.stationId)` — the returned map is the complete and exclusive tool set for this session
  - [ ] Call `streamText()` with the tool map only — do **not** merge `AiService.tools`; `web_search` is available via the `web_search` pack
  - [ ] Stream `delta` SSE events for text chunks
  - [ ] Stream `tool_result` SSE events for `visualize` results and any webhook tool results returning `{ type: "vega-lite", spec }`
  - [ ] On stream complete: assemble full assistant `blocks[]` and persist via `PortalMessagesRepository.create()`
  - [ ] Send `done` SSE event
- [ ] Unit tests for `createPortal`, `addMessage`, `streamResponse` (mock AiService + AnalyticsService)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/services/portal.service.ts` |
| Create | `apps/api/src/__tests__/services/portal.service.test.ts` |

---

## Phase 7 — API Routes (`apps/api`)

Wire all new routes into the Express app. All except the SSE stream use the existing `protectedRouter`.

### Checklist

#### Station routes (`station.router.ts`)
- [ ] `GET /api/stations` — list stations for org (paginated)
- [ ] `GET /api/stations/:id` — get station with instance list
- [ ] `POST /api/stations` — create station (name, description, connectorInstanceIds)
- [ ] `PATCH /api/stations/:id` — update name / description / instances
- [ ] `DELETE /api/stations/:id` — soft delete

#### Organization route extension
- [ ] `PATCH /api/organizations/:id` — add `defaultStationId` to updatable fields; validate station belongs to org

#### Portal routes (`portal.router.ts`)
- [ ] `POST /api/portals` — body `{ stationId }` → creates portal, returns `{ portalId }`
- [ ] `GET /api/portals` — list portals for org (filter by `stationId`, paginated)
- [ ] `GET /api/portals/:id` — get portal with message history
- [ ] `POST /api/portals/:id/messages` — body `{ message }` → persists user turn, returns `{ portalId, status: "streaming" }`

#### Portal SSE route (`portal-events.router.ts`)
- [ ] `GET /api/sse/portals/:portalId/stream` — query-param auth via `sseAuth` middleware; calls `PortalService.streamResponse()`
- [ ] Mount outside `protectedRouter` alongside existing `jobEventsRouter`

#### Portal results routes (`portal-results.router.ts`)
- [ ] `POST /api/portal-results` — body `{ portalId, blockIndex, name }` → pins result; returns saved result
- [ ] `GET /api/portal-results` — list saved results (filter by `stationId`, paginated)
- [ ] `PATCH /api/portal-results/:id` — rename a saved result
- [ ] `DELETE /api/portal-results/:id` — soft delete

#### Station tool routes (`station-tools.router.ts`)
- [ ] `GET /api/stations/:stationId/tools` — list custom tools registered on a station
- [ ] `POST /api/stations/:stationId/tools` — register a new webhook tool; validate name does not shadow a built-in
- [ ] `PATCH /api/stations/:stationId/tools/:toolId` — update name / description / parameterSchema / implementation URL
- [ ] `DELETE /api/stations/:stationId/tools/:toolId` — soft delete

#### Wire-up
- [ ] Register all new routers in `apps/api/src/app.ts`
- [ ] Add new `ApiCode` error codes: `STATION_NOT_FOUND`, `PORTAL_NOT_FOUND`, `PORTAL_RESULT_NOT_FOUND`, `PORTAL_INVALID_STATION`, `PORTAL_STATION_NO_TOOLS`, `STATION_TOOL_NOT_FOUND`, `STATION_TOOL_NAME_CONFLICT`
- [ ] Integration tests for station CRUD, portal create + message, portal-results pin + list, station-tools CRUD
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/routes/station.router.ts` |
| Create | `apps/api/src/routes/portal.router.ts` |
| Create | `apps/api/src/routes/portal-events.router.ts` |
| Create | `apps/api/src/routes/portal-results.router.ts` |
| Create | `apps/api/src/routes/station-tools.router.ts` |
| Modify | `apps/api/src/routes/organization.router.ts` |
| Modify | `apps/api/src/app.ts` |
| Modify | `apps/api/src/constants/api-codes.constants.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/station-tools.router.integration.test.ts` |

---

## Phase 8 — Frontend SDK (`apps/web`)

API hooks following the existing `useAuthQuery` / `useAuthMutation` pattern. Install new frontend dependencies.

### Checklist
- [ ] Install frontend dependencies in `apps/web/package.json`: `react-markdown`, `remark-gfm`, `react-vega`, `vega`, `vega-lite`
- [ ] Add query key namespaces to `apps/web/src/api/keys.ts`: `stations`, `portals`, `portalResults`, `stationTools`
- [ ] Create `stations.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `update(id, body)`, `setDefault(orgId, stationId)`
- [ ] Create `portals.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `sendMessage(portalId, message)`
- [ ] Create `portal-results.api.ts` — `list(params?, options?)`, `pin(body)`, `rename(id, name)`, `remove(id)`
- [ ] Create `station-tools.api.ts` — `list(stationId, params?, options?)`, `create(stationId, body)`, `update(stationId, toolId, body)`, `remove(stationId, toolId)`
- [ ] Register all new API modules on `sdk` in `apps/web/src/api/sdk.ts`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/api/stations.api.ts` |
| Create | `apps/web/src/api/portals.api.ts` |
| Create | `apps/web/src/api/portal-results.api.ts` |
| Create | `apps/web/src/api/station-tools.api.ts` |
| Modify | `apps/web/src/api/keys.ts` |
| Modify | `apps/web/src/api/sdk.ts` |
| Modify | `apps/web/package.json` |

---

## Phase 9 — Frontend: Portal UI (`/portals/:portalId`)

The core chat interface. Loads message history on mount, streams new responses via SSE, renders content blocks, supports pinning.

### Checklist
- [ ] Implement `ContentBlockRenderer` — switches on `block.type`: `"text"` → `<ReactMarkdown>`, `"vega-lite"` → `<VegaLite>`
- [ ] Implement `PortalMessage.component.tsx` (container + UI):
  - [ ] Renders user messages as plain text bubbles
  - [ ] Renders assistant messages as a sequence of `ContentBlockRenderer` instances
  - [ ] Shows a pin icon button on each assistant block; clicking opens a name dialog → calls `sdk.portalResults.pin()`
- [ ] Implement `PortalSession.component.tsx` (container + UI):
  - [ ] On mount: calls `sdk.portals.get(portalId)` to load message history
  - [ ] Renders message list above `ChatWindowUI`
  - [ ] On submit: calls `sdk.portals.sendMessage()`, then opens SSE connection to `/api/sse/portals/:portalId/stream`
  - [ ] Accumulates `delta` events into a streaming assistant bubble
  - [ ] Inserts `tool_result` blocks inline at their position in the stream
  - [ ] On `done`: finalises the assistant message in local state
- [ ] Create route `apps/web/src/routes/_authorized/portals.$portalId.tsx`
- [ ] Add `Portals = "/portals/$portalId"` to `routes.util.ts` enum
- [ ] Unit tests for `PortalMessage` (renders text block, renders vega-lite block, pin button visible on assistant messages)
- [ ] Unit tests for `PortalSession` (loads history on mount, renders messages, submit triggers sendMessage)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/components/PortalMessage.component.tsx` |
| Create | `apps/web/src/components/PortalSession.component.tsx` |
| Create | `apps/web/src/routes/_authorized/portals.$portalId.tsx` |
| Modify | `apps/web/src/utils/routes.util.ts` |

---

## Phase 10 — Frontend: Station management (`/stations`)

CRUD for stations, connector instance picker, and default station control.

### Checklist
- [ ] Implement `StationList.component.tsx` (container + UI):
  - [ ] Fetches `sdk.stations.list()` with pagination
  - [ ] Table columns: name, description, instance count, "Default" badge, "Set as default" action, "Open" link
  - [ ] "Set as default" calls `sdk.stations.setDefault()` → invalidates org query
  - [ ] "New Station" button opens `CreateStationDialog`
- [ ] Implement `CreateStationDialog.component.tsx`:
  - [ ] Fields: name (text), description (text), connector instances (multi-select from `sdk.connectorInstances.list()`)
  - [ ] On confirm: calls `sdk.stations.create()` → closes dialog → refreshes list
- [ ] Implement `StationsView.tsx` — breadcrumbs + `StationList`
- [ ] Implement `StationDetailView.tsx` (`/stations/:stationId`):
  - [ ] Station metadata header (name, description, instances)
  - [ ] Paginated list of portals for this station; clicking navigates to `/portals/:portalId`
  - [ ] "New Portal" button → `CreatePortalDialog`
- [ ] Create route `apps/web/src/routes/_authorized/stations.tsx`
- [ ] Create route `apps/web/src/routes/_authorized/stations.$stationId.tsx`
- [ ] Add `Stations = "/stations"`, `StationDetail = "/stations/$stationId"` to `routes.util.ts`
- [ ] Add `Stations` entry to `SidebarNav`
- [ ] Unit tests for `StationList` (renders rows, default badge, set-as-default action)
- [ ] Unit tests for `CreateStationDialog` (submits correct payload, closes on success)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/components/StationList.component.tsx` |
| Create | `apps/web/src/components/CreateStationDialog.component.tsx` |
| Create | `apps/web/src/views/StationsView.tsx` |
| Create | `apps/web/src/views/StationDetailView.tsx` |
| Create | `apps/web/src/routes/_authorized/stations.tsx` |
| Create | `apps/web/src/routes/_authorized/stations.$stationId.tsx` |
| Modify | `apps/web/src/utils/routes.util.ts` |
| Modify | `apps/web/src/components/SidebarNav.component.tsx` |

---

## Phase 11 — Frontend: Dashboard (`/`)

Extends the existing `DashboardView` placeholder with portal-aware sections.

### Checklist
- [ ] Implement `DefaultStationCard.component.tsx` (container + UI):
  - [ ] Fetches org to read `defaultStationId`; fetches station detail if set
  - [ ] Shows station name, description, connector instance names
  - [ ] "Launch Portal" button → calls `sdk.portals.create({ stationId })` → navigates to new portal
  - [ ] "Change default" link → navigates to `/stations`
  - [ ] Empty state when no default is set: "No default station — go to Stations to set one"
- [ ] Implement `RecentPortalsList.component.tsx` (container + UI):
  - [ ] Fetches `sdk.portals.list({ limit: 5 })` (most recent across org)
  - [ ] Table columns: portal name, station name, created-at (relative)
  - [ ] Row click navigates to `/portals/:portalId`
  - [ ] Empty state when no portals exist yet
- [ ] Implement `CreatePortalDialog.component.tsx`:
  - [ ] Station select pre-populated with default station if set; user can change
  - [ ] On confirm: calls `sdk.portals.create({ stationId })` → navigates to new portal
- [ ] Update `DashboardView`:
  - [ ] Add "New Portal" button in page header → opens `CreatePortalDialog`
  - [ ] Render `DefaultStationCard`
  - [ ] Render `RecentPortalsList`
- [ ] Unit tests for `DefaultStationCard` (renders station info, empty state, launch button navigates)
- [ ] Unit tests for `RecentPortalsList` (renders rows, empty state, row click navigates)
- [ ] Unit tests for `CreatePortalDialog` (station select defaults to org default, submit navigates to new portal)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/components/DefaultStationCard.component.tsx` |
| Create | `apps/web/src/components/RecentPortalsList.component.tsx` |
| Create | `apps/web/src/components/CreatePortalDialog.component.tsx` |
| Modify | `apps/web/src/views/Dashboard.view.tsx` |

---

## Phase 12 — Deeper Interaction & Agentic Readiness

Extends the Portal UI and `PortalService` to support richer in-session interaction: tool results rendered as live data objects (not just narrated text), full conversation history reconstructed in Vercel AI SDK format for multi-turn continuity, and explicit LangGraph migration seams documented in code. No LangGraph dependency is introduced — this phase lays the structural groundwork so it can be swapped in later without API or schema changes.

### Checklist

#### Backend

- [ ] **Full CoreMessage[] persistence** — Update `PortalService.streamResponse()` to assemble and persist the complete Vercel AI SDK `CoreMessage[]` representation of the assistant turn (including `toolCall` and `toolResult` content parts) in `portal_messages.blocks`. This is the LangGraph checkpoint format; storing only rendered text blocks now would require a migration later.
- [ ] **Full CoreMessage[] reconstruction on load** — Update `PortalService.getPortal()` to reconstruct the full `CoreMessage[]` array (user + assistant turns, including tool call/result pairs) from `portal_messages` rows. Pass the full array to `streamText` on each new turn so Claude can reason about prior analysis steps.
- [ ] **`data-table` SSE event** — Extend the `onStepFinish` handler in `PortalService.streamResponse()` to emit a `tool_result` SSE event with `type: "data-table"` for tool calls that return row sets: `sql_query`, `detect_outliers`, `cluster`. Scalar results (correlation, describe_column) continue to be narrated; only row sets surface as structured blocks.
- [ ] **`data-table` ContentBlock type** — Add `{ type: "data-table"; columns: string[]; rows: Record<string, unknown>[] }` to the `ContentBlock` union in `portal.contract.ts`. Update `portal-messages.table.ts` comment to document that `blocks` stores full CoreMessage[] parts.
- [ ] **LangGraph seam comment** — Add a comment block in `portal.service.ts` above `streamResponse()` documenting the swap plan: what changes (swap `streamText` for `graph.stream()`), what stays the same (API contract, DB schema, tool definitions), and the mapping table from current primitives to LangGraph equivalents.
- [ ] **Unit tests** — Update `portal.service.test.ts`: verify that assistant turns persist tool-call + tool-result content parts; verify `data-table` SSE events are emitted for row-returning tools; verify `getPortal()` reconstructs full CoreMessage[] including tool turns.
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

#### Frontend

- [ ] **`DataTableBlock` component** — Implement `DataTableBlock.component.tsx`: a compact, non-paginated MUI table that renders a `data-table` content block inline in the chat thread. Columns auto-sized; truncates at 50 rows with a "showing N of M rows" label.
- [ ] **Extend `ContentBlockRenderer`** — Add a `case "data-table"` branch that renders `<DataTableBlock>`.
- [ ] **Progressive block rendering** — Update `PortalSession` SSE handler to insert `data-table` and `vega-lite` blocks inline as they arrive from `tool_result` events, before the final `done` event. The user sees charts and tables appear while Claude is still composing its narrative text.
- [ ] **Unit tests** — `DataTableBlock`: renders columns and rows, truncates at 50 rows, shows row count label. `ContentBlockRenderer`: renders `data-table` block via `DataTableBlock`. `PortalSession`: `tool_result` events insert blocks at correct position in the streaming message.
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files

| Action | File | Purpose |
|--------|------|---------|
| Modify | `apps/api/src/services/portal.service.ts` | Full CoreMessage[] persistence + reconstruction; data-table SSE events; LangGraph seam comment |
| Modify | `packages/core/src/contracts/portal.contract.ts` | Add `data-table` to ContentBlock union |
| Modify | `apps/api/src/__tests__/services/portal.service.test.ts` | Updated unit tests |
| Create | `apps/web/src/components/DataTableBlock.component.tsx` | Compact inline data table renderer |
| Modify | `apps/web/src/components/PortalMessage.component.tsx` | Add `data-table` case to ContentBlockRenderer |
| Modify | `apps/web/src/components/PortalSession.component.tsx` | Progressive block insertion from SSE tool_result events |

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/core/src/models/station.model.ts` | Create | 1 |
| `packages/core/src/models/portal.model.ts` | Create | 1 |
| `packages/core/src/models/portal-result.model.ts` | Create | 1 |
| `packages/core/src/models/station-tool.model.ts` | Create | 1 |
| `packages/core/src/contracts/station.contract.ts` | Create | 1 |
| `packages/core/src/contracts/portal.contract.ts` | Create | 1 |
| `packages/core/src/contracts/station-tool.contract.ts` | Create | 1 |
| `packages/core/src/index.ts` | Modify | 1 |
| `apps/api/src/db/schema/stations.table.ts` | Create | 2 |
| `apps/api/src/db/schema/station-instances.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portals.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portal-messages.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portal-results.table.ts` | Create | 2 |
| `apps/api/src/db/schema/station-tools.table.ts` | Create | 2 |
| `apps/api/src/db/schema/organizations.table.ts` | Modify | 2 |
| `apps/api/src/db/schema/zod.ts` | Modify | 2 |
| `apps/api/src/db/schema/type-checks.ts` | Modify | 2 |
| `apps/api/src/db/schema/index.ts` | Modify | 2 |
| `apps/api/src/db/repositories/stations.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/station-instances.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portals.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-messages.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-results.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/station-tools.repository.ts` | Create | 3 |
| `apps/api/src/services/db.service.ts` | Modify | 3 |
| `apps/api/src/services/analytics.service.ts` | Create | 4 |
| `apps/api/src/services/analytics.tools.ts` | Create | 5 |
| `apps/api/src/services/portal.service.ts` | Create | 6 |
| `apps/api/src/routes/station.router.ts` | Create | 7 |
| `apps/api/src/routes/portal.router.ts` | Create | 7 |
| `apps/api/src/routes/portal-events.router.ts` | Create | 7 |
| `apps/api/src/routes/portal-results.router.ts` | Create | 7 |
| `apps/api/src/routes/station-tools.router.ts` | Create | 7 |
| `apps/api/src/routes/organization.router.ts` | Modify | 7 |
| `apps/api/src/app.ts` | Modify | 7 |
| `apps/api/src/constants/api-codes.constants.ts` | Modify | 7 |
| `apps/web/src/api/stations.api.ts` | Create | 8 |
| `apps/web/src/api/portals.api.ts` | Create | 8 |
| `apps/web/src/api/portal-results.api.ts` | Create | 8 |
| `apps/web/src/api/station-tools.api.ts` | Create | 8 |
| `apps/web/src/api/keys.ts` | Modify | 8 |
| `apps/web/src/api/sdk.ts` | Modify | 8 |
| `apps/web/package.json` | Modify | 8 |
| `apps/api/package.json` | Modify | 4 |
| `apps/web/src/components/PortalMessage.component.tsx` | Create | 9 |
| `apps/web/src/components/PortalSession.component.tsx` | Create | 9 |
| `apps/web/src/routes/_authorized/portals.$portalId.tsx` | Create | 9 |
| `apps/web/src/components/StationList.component.tsx` | Create | 10 |
| `apps/web/src/components/CreateStationDialog.component.tsx` | Create | 10 |
| `apps/web/src/views/StationsView.tsx` | Create | 10 |
| `apps/web/src/views/StationDetailView.tsx` | Create | 10 |
| `apps/web/src/routes/_authorized/stations.tsx` | Create | 10 |
| `apps/web/src/routes/_authorized/stations.$stationId.tsx` | Create | 10 |
| `apps/web/src/components/DefaultStationCard.component.tsx` | Create | 11 |
| `apps/web/src/components/RecentPortalsList.component.tsx` | Create | 11 |
| `apps/web/src/components/CreatePortalDialog.component.tsx` | Create | 11 |
| `apps/web/src/views/Dashboard.view.tsx` | Modify | 11 |
| `apps/web/src/utils/routes.util.ts` | Modify | 9–10 |
| `apps/web/src/components/SidebarNav.component.tsx` | Modify | 10 |
| `apps/api/src/services/portal.service.ts` | Modify | 12 |
| `packages/core/src/contracts/portal.contract.ts` | Modify | 12 |
| `apps/api/src/__tests__/services/portal.service.test.ts` | Modify | 12 |
| `apps/web/src/components/DataTableBlock.component.tsx` | Create | 12 |
| `apps/web/src/components/PortalMessage.component.tsx` | Modify | 12 |
| `apps/web/src/components/PortalSession.component.tsx` | Modify | 12 |
