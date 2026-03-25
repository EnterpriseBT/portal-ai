# MCP Data Analysis Feature

## Overview

Stations, Portals, and an embedded analytics engine that lets users query their connector entity data using natural language. Claude orchestrates a set of analytics tools (SQL via AlaSQL, stats via simple-statistics, clustering via ml-kmeans, visualization via Vega-Lite) embedded directly in the API. Results are streamed to a chat-like Portal UI and can be pinned as named saved results.

**Architecture decision — Option 2: Analytics Tools Embedded in API.** Analytics tools are implemented as static `AnalyticsService` methods and registered as Vercel AI SDK `tool()` definitions in `analytics.tools.ts`, alongside the existing `AiService.tools`. No separate MCP server process is needed. The MCP protocol can be adopted later by wrapping the same service methods in MCP tool handlers.

**Custom tooling — Option A: Webhook-based custom tools.** Users can register custom tools at the organization level that point to external webhook endpoints, then assign them to one or more stations via a join table. Phase 1 ships curated built-in tool packs (`regression`, `trend`) via `AnalyticsService`. Phase 2 adds the `organization_tools` table (org-scoped tool definitions) and `station_tools` join table (station ↔ tool assignments), plus `OrganizationToolsRepository`, `StationToolsRepository`, and REST routes so users can manage a shared tool library and assign tools to stations. `buildAnalyticsTools(organizationId, stationId)` is async from the start to accommodate Phase 2 without a future signature break.

Reference discovery doc: `features/MCP.discovery.md`

---

## Phase 1 — Core models (`packages/core`)

Add Zod models for all new domain objects following the existing dual-schema pattern. Includes the `OrganizationTool` model for org-scoped webhook tool definitions and the `StationTool` join model for station ↔ tool assignments (Phase 2 DB + routes, but models defined here to keep the dual-schema pattern intact).

### Checklist
- [x] Add `StationSchema` + `StationModel` + `StationModelFactory` in `station.model.ts`
- [x] Add `PortalSchema` + `PortalModel` + `PortalModelFactory` in `portal.model.ts`
- [x] Add `PortalResultSchema` + `PortalResultModel` + `PortalResultModelFactory` in `portal-result.model.ts`
- [x] Add `OrganizationToolSchema` + `OrganizationToolModel` + `OrganizationToolModelFactory` in `organization-tool.model.ts` — fields: `id`, `organizationId`, `name`, `description`, `parameterSchema` (jsonb), `implementation` (jsonb: `{ type: "webhook", url: string, headers?: Record<string,string> }`) + baseColumns
- [x] Add `StationToolSchema` in `station-tool.model.ts` — join table model, fields: `id`, `stationId`, `organizationToolId`, `created` (no soft delete, mirrors `station_instances` pattern)
- [x] Add `portal.contract.ts` — Zod schemas for `CreatePortalBody`, `SendMessageBody`, `PinResultBody`, `PortalMessageResponse`, SSE event payloads (`DeltaEvent`, `ToolResultEvent`, `DoneEvent`)
- [x] Add `station.contract.ts` — Zod schemas for `CreateStationBody`, `UpdateStationBody`, `StationListResponse`
- [x] Add `organization-tool.contract.ts` — Zod schemas for `CreateOrganizationToolBody`, `UpdateOrganizationToolBody`, `OrganizationToolListResponse`
- [x] Add `station-tool.contract.ts` — Zod schemas for `AssignStationToolBody`, `StationToolListResponse`
- [x] Export all new models and contracts from `packages/core/src/index.ts`
- [x] Unit tests for `StationModel` — validate schema parsing, factory `create()`, `toJSON()`, `update()`, invalid input rejection
- [x] Unit tests for `PortalModel` — validate schema parsing, factory `create()`, `toJSON()`, `update()`, invalid input rejection
- [x] Unit tests for `PortalResultModel` — validate schema parsing, factory `create()`, `toJSON()`, `update()`, invalid input rejection
- [x] Unit tests for `OrganizationToolModel` — validate schema parsing (including `parameterSchema` jsonb and `implementation` jsonb), factory `create()`, `toJSON()`, `update()`, invalid input rejection
- [x] Unit tests for `StationToolSchema` — validate schema parsing for join table fields, reject missing required fields
- [x] Unit tests for contract schemas — `CreateStationBody`, `UpdateStationBody`, `CreatePortalBody`, `SendMessageBody`, `PinResultBody`, `CreateOrganizationToolBody`, `UpdateOrganizationToolBody`, `AssignStationToolBody` all parse valid input and reject invalid input
- [x] Unit tests for SSE event payload schemas — `DeltaEvent`, `ToolResultEvent`, `DoneEvent` parse valid payloads and reject malformed payloads
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

### Files
| Action | File |
|--------|------|
| Create | `packages/core/src/models/station.model.ts` |
| Create | `packages/core/src/models/portal.model.ts` |
| Create | `packages/core/src/models/portal-result.model.ts` |
| Create | `packages/core/src/models/organization-tool.model.ts` |
| Create | `packages/core/src/models/station-tool.model.ts` |
| Create | `packages/core/src/contracts/station.contract.ts` |
| Create | `packages/core/src/contracts/portal.contract.ts` |
| Create | `packages/core/src/contracts/organization-tool.contract.ts` |
| Create | `packages/core/src/contracts/station-tool.contract.ts` |
| Modify | `packages/core/src/index.ts` |
| Create | `packages/core/src/__tests__/models/station.model.test.ts` |
| Create | `packages/core/src/__tests__/models/portal.model.test.ts` |
| Create | `packages/core/src/__tests__/models/portal-result.model.test.ts` |
| Create | `packages/core/src/__tests__/models/organization-tool.model.test.ts` |
| Create | `packages/core/src/__tests__/models/station-tool.model.test.ts` |
| Create | `packages/core/src/__tests__/contracts/station.contract.test.ts` |
| Create | `packages/core/src/__tests__/contracts/portal.contract.test.ts` |
| Create | `packages/core/src/__tests__/contracts/organization-tool.contract.test.ts` |
| Create | `packages/core/src/__tests__/contracts/station-tool.contract.test.ts` |

---

## Phase 2 — Database schema + migrations (`apps/api`)

Define Drizzle tables for all new entities, update `organizations`, add type-check assertions, and generate + apply migrations. Includes `organization_tools` (org-scoped tool definitions) and `station_tools` (join table assigning tools to stations).

### Checklist
- [x] Create `stations.table.ts` — `id`, `organizationId`, `name`, `description`, `createdBy` + baseColumns
- [x] Create `station-instances.table.ts` — uses baseColumns (standardized to CoreSchema for consistency)
- [x] Create `portals.table.ts` — `id`, `organizationId`, `stationId`, `name`, `createdBy` + baseColumns
- [x] Create `portal-messages.table.ts` — uses baseColumns (standardized to CoreSchema for consistency)
- [x] Create `portal-results.table.ts` — `id`, `organizationId`, `stationId`, `portalId` (nullable), `name`, `type` enum (`text`|`vega-lite`), `content` jsonb, `createdBy` + baseColumns
- [x] Create `organization-tools.table.ts` — `id`, `organizationId`, `name`, `description`, `parameterSchema` jsonb, `implementation` jsonb + baseColumns
- [x] Create `station-tools.table.ts` — uses baseColumns (standardized to CoreSchema for consistency)
- [x] Modify `organizations.table.ts` — add `defaultStationId` (nullable text FK → stations)
- [x] Add drizzle-zod `createSelectSchema` / `createInsertSchema` entries in `zod.ts`
- [x] Add bidirectional `IsAssignable` type guards in `type-checks.ts` for all new tables
- [x] Export new tables from `apps/api/src/db/schema/index.ts`
- [x] `npm run db:generate` — generates migration SQL
- [x] `npm run db:migrate` — migration applied successfully
- [x] Unit tests for `IsAssignable` type guards — verify bidirectional assignability between Zod models and Drizzle select types for all new tables (enforced at compile time via `type-checks.ts`)
- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run test` passes (929 core + 275 API unit + 453 integration = all green)

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/db/schema/stations.table.ts` |
| Create | `apps/api/src/db/schema/station-instances.table.ts` |
| Create | `apps/api/src/db/schema/portals.table.ts` |
| Create | `apps/api/src/db/schema/portal-messages.table.ts` |
| Create | `apps/api/src/db/schema/portal-results.table.ts` |
| Create | `apps/api/src/db/schema/organization-tools.table.ts` |
| Create | `apps/api/src/db/schema/station-tools.table.ts` |
| Modify | `apps/api/src/db/schema/organizations.table.ts` |
| Modify | `apps/api/src/db/schema/zod.ts` |
| Modify | `apps/api/src/db/schema/type-checks.ts` |
| Modify | `apps/api/src/db/schema/index.ts` |
| Create | `apps/api/src/__tests__/db/schema/new-tables.schema.test.ts` |

---

## Phase 3 — Repositories (`apps/api`)

One repository per new table, extending the base `Repository` class.

### Checklist
- [ ] `StationsRepository` — `findById`, `findMany` (by org), `create`, `update`, `softDelete`
- [ ] `StationInstancesRepository` — `findByStationId`, `create`, `hardDelete` (join table — no soft delete)
- [ ] `PortalsRepository` — `findById`, `findByStation`, `findRecentByOrg(limit)`, `create`, `update`, `softDelete`
- [ ] `PortalMessagesRepository` — `findByPortal` (ordered by `created` asc), `create`
- [ ] `PortalResultsRepository` — `findById`, `findByStation`, `create`, `update`, `softDelete`
- [ ] `OrganizationToolsRepository` — `findById`, `findMany(organizationId)`, `create` (validate name is unique within org), `update`, `softDelete`
- [ ] `StationToolsRepository` — `findByStationId(stationId)` (returns joined `organization_tools` rows), `create` (assign tool to station; validate tool name does not shadow a built-in pack tool name for that station's selected packs), `hardDelete` (unassign — join table, no soft delete)
- [ ] Register all new repositories on `DbService.repository` in `db.service.ts`
- [ ] Unit tests for `StationsRepository` — `findById` returns station, `findMany` filters by org, `create` persists, `update` modifies fields, `softDelete` sets deleted timestamp
- [ ] Unit tests for `StationInstancesRepository` — `findByStationId` returns instances, `create` persists join row, `hardDelete` removes row
- [ ] Unit tests for `PortalsRepository` — `findById`, `findByStation`, `findRecentByOrg` returns correct limit/order, `create`, `update`, `softDelete`
- [ ] Unit tests for `PortalMessagesRepository` — `findByPortal` returns messages ordered by `created` asc, `create` persists message with blocks
- [ ] Unit tests for `PortalResultsRepository` — `findById`, `findByStation` filters correctly, `create`, `update`, `softDelete`
- [ ] Unit tests for `OrganizationToolsRepository` — `findById`, `findMany` filters by org, `create` validates name uniqueness within org (rejects duplicate), `update`, `softDelete`
- [ ] Unit tests for `StationToolsRepository` — `findByStationId` returns joined org tool definitions, `create` validates no built-in pack name shadowing (rejects shadow), `hardDelete` removes join row
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/api/src/db/repositories/stations.repository.ts` |
| Create | `apps/api/src/db/repositories/station-instances.repository.ts` |
| Create | `apps/api/src/db/repositories/portals.repository.ts` |
| Create | `apps/api/src/db/repositories/portal-messages.repository.ts` |
| Create | `apps/api/src/db/repositories/portal-results.repository.ts` |
| Create | `apps/api/src/db/repositories/organization-tools.repository.ts` |
| Create | `apps/api/src/db/repositories/station-tools.repository.ts` |
| Modify | `apps/api/src/services/db.service.ts` |
| Create | `apps/api/src/__tests__/db/repositories/stations.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/station-instances.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/portals.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/portal-messages.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/portal-results.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/organization-tools.repository.test.ts` |
| Create | `apps/api/src/__tests__/db/repositories/station-tools.repository.test.ts` |

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
  - [ ] **Entity Group discovery** — after all entities are loaded:
    - [ ] For each loaded connectorEntity: `EntityGroupMembersRepository.findByConnectorEntityId(connectorEntity.id)`
    - [ ] Deduplicate by `entityGroupId`; keep only groups where ≥2 member entities are present in this station's loaded entities
    - [ ] For each relevant group: `EntityGroupRepository.findById(groupId)` → resolve each member's `linkFieldMappingId → fieldMapping → columnDefinition` to produce `{ entityKey, linkColumnKey, linkColumnLabel, isPrimary }`
  - [ ] Return `{ entities: EntitySchema[], entityGroups: EntityGroupContext[], records: Map<key, rows[]> }`
- [ ] Implement `AnalyticsService.loadRecords(entityKey, organizationId)` — resolves key → records
- [ ] **Pack `data_query` — `AnalyticsService.sqlQuery({ sql, organizationId })`** — executes against AlaSQL; validates SQL against an allowlist (block `SELECT INTO`, `ATTACH`)
- [ ] **Pack `data_query` — `AnalyticsService.visualize({ sql, vegaLiteSpec, organizationId })`** — runs SQL then injects rows into spec
- [ ] **Pack `data_query` — `AnalyticsService.resolveIdentity({ entityGroupName, linkValue, stationId, organizationId })`** — looks up Entity Group by name within the org, filters members to those loaded in the current station, queries each member's in-memory AlaSQL table (`SELECT * FROM <entityKey> WHERE <linkColumnKey> = '<linkValue>'`), returns matched records grouped by source entity with primary entity first. Operates entirely against in-memory tables (no DB round-trip for record lookup).
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
- [ ] Unit tests: `loadStation` returns `entityGroups` with correct members and link columns when Entity Groups exist; returns empty array when no groups have ≥2 loaded members
- [ ] Unit tests: `resolveIdentity` returns matched records grouped by entity with primary first; returns empty matches for a linkValue with no hits; throws for a non-existent entityGroupName
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
  - [ ] `resolve_identity` — Zod input `{ entityGroupName: string, linkValue: string }` — finds all records across an Entity Group's member entities sharing a given link value; returns matches grouped by source entity with primary entity first. Only registered when the station has ≥1 Entity Group with ≥2 loaded members; omitted otherwise to avoid confusing Claude with an unusable tool.
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
- [ ] Custom webhook tools — load via `StationToolsRepository.findByStationId(stationId)` (returns joined `organization_tools` rows for tools assigned to this station):
  - [ ] Convert each tool's `parameterSchema` (JSON Schema) to a Zod schema at runtime
  - [ ] Tool `execute` calls `callWebhook(def.implementation, input)` with a 30 s timeout
  - [ ] If webhook response contains `{ type: "vega-lite", spec }`, propagate as a chart result
  - [ ] Validate custom tool names do not shadow any pack tool name (throw on conflict)
- [ ] Implement `callWebhook(implementation, input)` helper — POST to URL, inject auth headers, enforce timeout, return parsed JSON
- [ ] Unit tests: each pack's tools are present only when the pack is in `station.toolPacks`; absent otherwise
- [ ] Unit tests: `resolve_identity` tool is registered only when `data_query` pack is selected AND ≥1 Entity Group has ≥2 loaded members; omitted otherwise
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
  - [ ] Call `AnalyticsService.loadStation()` and cache result in memory keyed by `portalId` — cached result includes `entities`, `entityGroups`, and `records`
  - [ ] Return `{ portalId, stationContext }` — `stationContext` includes `stationId`, `stationName`, `entities`, and `entityGroups`
- [ ] Implement `PortalService.getPortal(portalId)` — loads portal + full message history from DB
- [ ] Implement `PortalService.addMessage(portalId, { role, content })` — persists message row; assembles `blocks[]` for assistant turns
- [ ] Implement `PortalService.streamResponse({ portalId, messages, stationContext, organizationId, sse })`:
  - [ ] Build system prompt from station name + entity schemas
  - [ ] **Entity Group prompt section** — if `stationContext.entityGroups` is non-empty, append a "Cross-Entity Relationships" section listing each group's name, member entities, link columns (`entityKey` + `linkColumnKey`), and `isPrimary` flag. Include guidance: "Use the specified link columns when joining across member entities. Prefer data from the primary entity when displaying a unified view." This gives Claude the join metadata it needs for accurate cross-entity SQL without the user having to specify join keys.
  - [ ] Append list of custom tool names + descriptions if any are registered on the station
  - [ ] Call `await buildAnalyticsTools(organizationId, stationContext.stationId)` — the returned map is the complete and exclusive tool set for this session
  - [ ] Call `streamText()` with the tool map only — do **not** merge `AiService.tools`; `web_search` is available via the `web_search` pack
  - [ ] Stream `delta` SSE events for text chunks
  - [ ] Stream `tool_result` SSE events for `visualize` results and any webhook tool results returning `{ type: "vega-lite", spec }`
  - [ ] On stream complete: assemble full assistant `blocks[]` and persist via `PortalMessagesRepository.create()`
  - [ ] Send `done` SSE event
- [ ] Unit tests for `createPortal`, `addMessage`, `streamResponse` (mock AiService + AnalyticsService)
- [ ] Unit tests: `streamResponse` system prompt includes Entity Group section when `stationContext.entityGroups` is non-empty; omitted when empty
- [ ] Unit tests: `streamResponse` system prompt Entity Group section lists correct member entities, link columns, and primary flags
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

#### Organization tool routes (`organization-tools.router.ts`)
- [ ] `GET /api/organization-tools` — list all custom tools for the org
- [ ] `POST /api/organization-tools` — create a new webhook tool definition at org level; validate name is unique within org
- [ ] `PATCH /api/organization-tools/:toolId` — update name / description / parameterSchema / implementation URL
- [ ] `DELETE /api/organization-tools/:toolId` — soft delete

#### Station tool assignment routes (`station-tools.router.ts`)
- [ ] `GET /api/stations/:stationId/tools` — list custom tools assigned to a station (returns joined org tool definitions)
- [ ] `POST /api/stations/:stationId/tools` — assign an existing org tool to a station; body `{ organizationToolId }`; validate name does not shadow a built-in pack tool for this station
- [ ] `DELETE /api/stations/:stationId/tools/:assignmentId` — unassign a tool from a station (hard delete of join row)

#### Wire-up
- [ ] Register all new routers in `apps/api/src/app.ts`
- [ ] Add new `ApiCode` error codes: `STATION_NOT_FOUND`, `PORTAL_NOT_FOUND`, `PORTAL_RESULT_NOT_FOUND`, `PORTAL_INVALID_STATION`, `PORTAL_STATION_NO_TOOLS`, `ORG_TOOL_NOT_FOUND`, `ORG_TOOL_NAME_CONFLICT`, `STATION_TOOL_NAME_SHADOW`
- [ ] Integration tests for station CRUD, portal create + message, portal-results pin + list, organization-tools CRUD, station-tool assignment + unassignment
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
| Create | `apps/api/src/routes/organization-tools.router.ts` |
| Create | `apps/api/src/routes/station-tools.router.ts` |
| Modify | `apps/api/src/routes/organization.router.ts` |
| Modify | `apps/api/src/app.ts` |
| Modify | `apps/api/src/constants/api-codes.constants.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/organization-tools.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/station-tools.router.integration.test.ts` |

---

## Phase 8 — Frontend SDK (`apps/web`)

API hooks following the existing `useAuthQuery` / `useAuthMutation` pattern. Install new frontend dependencies.

### Checklist
- [ ] Install frontend dependencies in `apps/web/package.json`: `react-markdown`, `remark-gfm`, `react-vega`, `vega`, `vega-lite`
- [ ] Add query key namespaces to `apps/web/src/api/keys.ts`: `stations`, `portals`, `portalResults`, `organizationTools`, `stationTools`
- [ ] Create `stations.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `update(id, body)`, `setDefault(orgId, stationId)`
- [ ] Create `portals.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `sendMessage(portalId, message)`
- [ ] Create `portal-results.api.ts` — `list(params?, options?)`, `pin(body)`, `rename(id, name)`, `remove(id)`
- [ ] Create `organization-tools.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `update(toolId, body)`, `remove(toolId)`
- [ ] Create `station-tools.api.ts` — `list(stationId, params?, options?)`, `assign(stationId, body)`, `unassign(stationId, assignmentId)`
- [ ] Register all new API modules on `sdk` in `apps/web/src/api/sdk.ts`
- [ ] Unit tests for `stations.api.ts` — `list` calls correct endpoint with params, `get` calls by id, `create` sends body, `update` sends PATCH, `setDefault` sends correct org PATCH payload
- [ ] Unit tests for `portals.api.ts` — `list` calls correct endpoint with params, `get` calls by id, `create` sends body, `sendMessage` sends POST with message
- [ ] Unit tests for `portal-results.api.ts` — `list` calls correct endpoint, `pin` sends POST body, `rename` sends PATCH, `remove` sends DELETE
- [ ] Unit tests for `organization-tools.api.ts` — `list` calls correct endpoint, `get` calls by id, `create` sends body, `update` sends PATCH, `remove` sends DELETE
- [ ] Unit tests for `station-tools.api.ts` — `list` calls with stationId, `assign` sends POST body, `unassign` sends DELETE with assignmentId
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/api/stations.api.ts` |
| Create | `apps/web/src/api/portals.api.ts` |
| Create | `apps/web/src/api/portal-results.api.ts` |
| Create | `apps/web/src/api/organization-tools.api.ts` |
| Create | `apps/web/src/api/station-tools.api.ts` |
| Modify | `apps/web/src/api/keys.ts` |
| Modify | `apps/web/src/api/sdk.ts` |
| Modify | `apps/web/package.json` |
| Create | `apps/web/src/__tests__/api/stations.api.test.ts` |
| Create | `apps/web/src/__tests__/api/portals.api.test.ts` |
| Create | `apps/web/src/__tests__/api/portal-results.api.test.ts` |
| Create | `apps/web/src/__tests__/api/organization-tools.api.test.ts` |
| Create | `apps/web/src/__tests__/api/station-tools.api.test.ts` |

---

## Phase 9 — Frontend: Portal UI (`/portals/:portalId`)

The core chat interface. Loads message history on mount, streams new responses via SSE, renders content blocks, supports pinning.

Primitive content-block rendering components (`ContentBlockRenderer`, and later `DataTableBlock`) live in `packages/core` alongside the shared `ContentBlock` type — no business logic, no API calls, no hooks. `apps/web` imports these from `@portalai/core`.

### Checklist

#### `packages/core` — content-block rendering components
- [ ] Install peer dependencies in `packages/core/package.json`: `react-markdown`, `remark-gfm`, `react-vega`, `vega`, `vega-lite`
- [ ] Implement `ContentBlockRenderer.component.tsx` in `packages/core/src/components/` — switches on `block.type`: `"text"` → `<ReactMarkdown>`, `"vega-lite"` → `<VegaLite>`; uses `ContentBlock` type from `packages/core/src/contracts/portal.contract.ts`
- [ ] Export `ContentBlockRenderer` from `packages/core/src/index.ts`

#### `apps/web` — Portal UI
- [ ] Install frontend visualization dependencies in `apps/web/package.json`: `react-markdown`, `remark-gfm`, `react-vega`, `vega`, `vega-lite`
- [ ] Implement `PortalMessage.component.tsx` (container + UI):
  - [ ] Renders user messages as plain text bubbles
  - [ ] Renders assistant messages as a sequence of `<ContentBlockRenderer>` instances imported from `@portalai/core`
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
| Create | `packages/core/src/components/ContentBlockRenderer.component.tsx` |
| Modify | `packages/core/src/index.ts` |
| Modify | `packages/core/package.json` |
| Create | `apps/web/src/components/PortalMessage.component.tsx` |
| Create | `apps/web/src/components/PortalSession.component.tsx` |
| Create | `apps/web/src/routes/_authorized/portals.$portalId.tsx` |
| Modify | `apps/web/src/utils/routes.util.ts` |
| Modify | `apps/web/package.json` |

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

- [ ] **`DataTableBlock` component** — Implement `DataTableBlock.component.tsx` in `packages/core/src/components/`: a compact, non-paginated MUI table that renders a `data-table` content block inline in the chat thread. Columns auto-sized; truncates at 50 rows with a "showing N of M rows" label. Export from `packages/core/src/index.ts`.
- [ ] **Extend `ContentBlockRenderer`** — Add a `case "data-table"` branch in `packages/core/src/components/ContentBlockRenderer.component.tsx` that renders `<DataTableBlock>`.
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
| Create | `packages/core/src/components/DataTableBlock.component.tsx` | Compact inline data table renderer (primitive, no business logic) |
| Modify | `packages/core/src/components/ContentBlockRenderer.component.tsx` | Add `data-table` case that renders `DataTableBlock` |
| Modify | `packages/core/src/index.ts` | Export `DataTableBlock` |
| Modify | `apps/web/src/components/PortalMessage.component.tsx` | No renderer changes — imports `ContentBlockRenderer` from `@portalai/core` |
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
| `packages/core/src/__tests__/models/station.model.test.ts` | Create | 1 |
| `packages/core/src/__tests__/models/portal.model.test.ts` | Create | 1 |
| `packages/core/src/__tests__/models/portal-result.model.test.ts` | Create | 1 |
| `packages/core/src/__tests__/models/organization-tool.model.test.ts` | Create | 1 |
| `packages/core/src/__tests__/models/station-tool.model.test.ts` | Create | 1 |
| `packages/core/src/__tests__/contracts/station.contract.test.ts` | Create | 1 |
| `packages/core/src/__tests__/contracts/portal.contract.test.ts` | Create | 1 |
| `packages/core/src/__tests__/contracts/organization-tool.contract.test.ts` | Create | 1 |
| `packages/core/src/__tests__/contracts/station-tool.contract.test.ts` | Create | 1 |
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
| `apps/api/src/__tests__/db/schema/new-tables.schema.test.ts` | Create | 2 |
| `apps/api/src/db/repositories/stations.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/station-instances.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portals.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-messages.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-results.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/station-tools.repository.ts` | Create | 3 |
| `apps/api/src/services/db.service.ts` | Modify | 3 |
| `apps/api/src/__tests__/db/repositories/stations.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/station-instances.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/portals.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/portal-messages.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/portal-results.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/organization-tools.repository.test.ts` | Create | 3 |
| `apps/api/src/__tests__/db/repositories/station-tools.repository.test.ts` | Create | 3 |
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
| `apps/web/src/__tests__/api/stations.api.test.ts` | Create | 8 |
| `apps/web/src/__tests__/api/portals.api.test.ts` | Create | 8 |
| `apps/web/src/__tests__/api/portal-results.api.test.ts` | Create | 8 |
| `apps/web/src/__tests__/api/organization-tools.api.test.ts` | Create | 8 |
| `apps/web/src/__tests__/api/station-tools.api.test.ts` | Create | 8 |
| `apps/api/package.json` | Modify | 4 |
| `packages/core/src/components/ContentBlockRenderer.component.tsx` | Create | 9 |
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
| `packages/core/src/components/DataTableBlock.component.tsx` | Create | 12 |
| `packages/core/src/components/ContentBlockRenderer.component.tsx` | Modify | 12 |
| `apps/web/src/components/PortalMessage.component.tsx` | Modify | 12 |
| `apps/web/src/components/PortalSession.component.tsx` | Modify | 12 |
