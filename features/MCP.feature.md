# MCP Data Analysis Feature

## Overview

Stations, Portals, and an embedded analytics engine that lets users query their connector entity data using natural language. Claude orchestrates a set of analytics tools (SQL via AlaSQL, stats via simple-statistics, clustering via ml-kmeans, visualization via Vega-Lite) embedded directly in the API. Results are streamed to a chat-like Portal UI and can be pinned as named saved results.

Reference discovery doc: `features/MCP.discovery.md`

---

## Phase 1 — Core models (`packages/core`)

Add Zod models for all new domain objects following the existing dual-schema pattern.

### Checklist
- [ ] Add `StationSchema` + `StationModel` + `StationModelFactory` in `station.model.ts`
- [ ] Add `PortalSchema` + `PortalModel` + `PortalModelFactory` in `portal.model.ts`
- [ ] Add `PortalResultSchema` + `PortalResultModel` + `PortalResultModelFactory` in `portal-result.model.ts`
- [ ] Add `portal.contract.ts` — Zod schemas for `CreatePortalBody`, `SendMessageBody`, `PinResultBody`, `PortalMessageResponse`, SSE event payloads (`DeltaEvent`, `ToolResultEvent`, `DoneEvent`)
- [ ] Add `station.contract.ts` — Zod schemas for `CreateStationBody`, `UpdateStationBody`, `StationListResponse`
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
| Create | `packages/core/src/contracts/station.contract.ts` |
| Create | `packages/core/src/contracts/portal.contract.ts` |
| Modify | `packages/core/src/index.ts` |

---

## Phase 2 — Database schema + migrations (`apps/api`)

Define Drizzle tables for all new entities, update `organizations`, add type-check assertions, and generate + apply migrations.

### Checklist
- [ ] Create `stations.table.ts` — `id`, `organizationId`, `name`, `description`, `createdBy` + baseColumns
- [ ] Create `station-instances.table.ts` — `id`, `stationId`, `connectorInstanceId`, `created` (join table, no soft delete)
- [ ] Create `portals.table.ts` — `id`, `organizationId`, `stationId`, `name`, `createdBy` + baseColumns
- [ ] Create `portal-messages.table.ts` — `id`, `portalId`, `organizationId`, `role` enum (`user`|`assistant`), `blocks` jsonb, `created`
- [ ] Create `portal-results.table.ts` — `id`, `organizationId`, `stationId`, `portalId` (nullable), `name`, `type` enum (`text`|`vega-lite`), `content` jsonb, `createdBy` + baseColumns
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
| Modify | `apps/api/src/services/db.service.ts` |

---

## Phase 4 — Analytics Service (`apps/api`)

Stateless service with static methods. Each method receives pre-loaded records and runs the analysis. Install new dependencies first.

### Checklist
- [ ] Install dependencies: `alasql`, `arquero`, `simple-statistics`, `ml-kmeans` in `apps/api/package.json`
- [ ] Install type stubs where needed (`@types/alasql`, `@types/simple-statistics`)
- [ ] Implement `AnalyticsService.loadStation(stationId, organizationId)`:
  - [ ] Resolve `stationId → station_instances → connectorInstanceIds`
  - [ ] For each instance: `ConnectorEntityRepository.findByConnectorInstanceId()`
  - [ ] For each entity: walk `fieldMappings → columnDefinitions` to build typed schema catalog
  - [ ] Fetch `EntityRecordRepository.findMany({ connectorEntityId })` → extract `normalizedData`
  - [ ] Register each entity as a named AlaSQL table (`connectorEntity.key`)
  - [ ] Return `{ entities: EntitySchema[], records: Map<key, rows[]> }`
- [ ] Implement `AnalyticsService.loadRecords(entityKey, organizationId)` — resolves key → records
- [ ] Implement `AnalyticsService.sqlQuery({ sql, organizationId })` — executes against AlaSQL
- [ ] Implement `AnalyticsService.describeColumn({ entity, column, organizationId })` — count, mean, median, stddev, min, max, p25, p75
- [ ] Implement `AnalyticsService.correlate({ entity, columnA, columnB, organizationId })` — Pearson correlation
- [ ] Implement `AnalyticsService.detectOutliers({ entity, column, method, organizationId })` — IQR or Z-score
- [ ] Implement `AnalyticsService.cluster({ entity, columns, k, organizationId })` — k-means via ml-kmeans
- [ ] Implement `AnalyticsService.visualize({ sql, vegaLiteSpec, organizationId })` — runs SQL then injects rows into spec
- [ ] Unit tests for each method with fixture records
- [ ] Validate AlaSQL SQL against an allowlist of operations (block `SELECT INTO`, `ATTACH`)
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

Vercel AI SDK `tool()` wrappers around `AnalyticsService` methods. Registered per-portal so each tool call is org-scoped.

### Checklist
- [ ] Implement `buildAnalyticsTools(organizationId)` factory in `analytics.tools.ts`
- [ ] Define `sql_query` tool — Zod input `{ sql: string }`
- [ ] Define `describe_column` tool — Zod input `{ entity, column }`
- [ ] Define `correlate` tool — Zod input `{ entity, columnA, columnB }`
- [ ] Define `detect_outliers` tool — Zod input `{ entity, column, method }`
- [ ] Define `cluster` tool — Zod input `{ entity, columns, k }`
- [ ] Define `visualize` tool — Zod input `{ sql, vegaLiteSpec }`
- [ ] Unit tests: each tool's `execute` delegates to the correct `AnalyticsService` method with `organizationId` injected
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
  - [ ] Create `portals` row with auto-generated name (`Portal — <date>`)
  - [ ] Call `AnalyticsService.loadStation()` and cache result in memory keyed by `portalId`
  - [ ] Return `{ portalId, stationContext }`
- [ ] Implement `PortalService.getPortal(portalId)` — loads portal + full message history from DB
- [ ] Implement `PortalService.addMessage(portalId, { role, content })` — persists message row; assembles `blocks[]` for assistant turns
- [ ] Implement `PortalService.streamResponse({ portalId, messages, stationContext, organizationId, sse })`:
  - [ ] Build system prompt from station name + entity schemas
  - [ ] Call `streamText()` with `buildAnalyticsTools(organizationId)` + existing `AiService.tools`
  - [ ] Stream `delta` SSE events for text chunks
  - [ ] Stream `tool_result` SSE events for `visualize` results only
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

#### Wire-up
- [ ] Register all new routers in `apps/api/src/app.ts`
- [ ] Add new `ApiCode` error codes: `STATION_NOT_FOUND`, `PORTAL_NOT_FOUND`, `PORTAL_RESULT_NOT_FOUND`, `PORTAL_INVALID_STATION`
- [ ] Integration tests for station CRUD, portal create + message, portal-results pin + list
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
| Modify | `apps/api/src/routes/organization.router.ts` |
| Modify | `apps/api/src/app.ts` |
| Modify | `apps/api/src/constants/api-codes.constants.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts` |
| Create | `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` |

---

## Phase 8 — Frontend SDK (`apps/web`)

API hooks following the existing `useAuthQuery` / `useAuthMutation` pattern. Install new frontend dependencies.

### Checklist
- [ ] Install frontend dependencies in `apps/web/package.json`: `react-markdown`, `remark-gfm`, `react-vega`, `vega`, `vega-lite`
- [ ] Add query key namespaces to `apps/web/src/api/keys.ts`: `stations`, `portals`, `portalResults`
- [ ] Create `stations.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `update(id, body)`, `setDefault(orgId, stationId)`
- [ ] Create `portals.api.ts` — `list(params?, options?)`, `get(id, options?)`, `create(body)`, `sendMessage(portalId, message)`
- [ ] Create `portal-results.api.ts` — `list(params?, options?)`, `pin(body)`, `rename(id, name)`, `remove(id)`
- [ ] Register all new API modules on `sdk` in `apps/web/src/api/sdk.ts`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes

### Files
| Action | File |
|--------|------|
| Create | `apps/web/src/api/stations.api.ts` |
| Create | `apps/web/src/api/portals.api.ts` |
| Create | `apps/web/src/api/portal-results.api.ts` |
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

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/core/src/models/station.model.ts` | Create | 1 |
| `packages/core/src/models/portal.model.ts` | Create | 1 |
| `packages/core/src/models/portal-result.model.ts` | Create | 1 |
| `packages/core/src/contracts/station.contract.ts` | Create | 1 |
| `packages/core/src/contracts/portal.contract.ts` | Create | 1 |
| `packages/core/src/index.ts` | Modify | 1 |
| `apps/api/src/db/schema/stations.table.ts` | Create | 2 |
| `apps/api/src/db/schema/station-instances.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portals.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portal-messages.table.ts` | Create | 2 |
| `apps/api/src/db/schema/portal-results.table.ts` | Create | 2 |
| `apps/api/src/db/schema/organizations.table.ts` | Modify | 2 |
| `apps/api/src/db/schema/zod.ts` | Modify | 2 |
| `apps/api/src/db/schema/type-checks.ts` | Modify | 2 |
| `apps/api/src/db/schema/index.ts` | Modify | 2 |
| `apps/api/src/db/repositories/stations.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/station-instances.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portals.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-messages.repository.ts` | Create | 3 |
| `apps/api/src/db/repositories/portal-results.repository.ts` | Create | 3 |
| `apps/api/src/services/db.service.ts` | Modify | 3 |
| `apps/api/src/services/analytics.service.ts` | Create | 4 |
| `apps/api/src/services/analytics.tools.ts` | Create | 5 |
| `apps/api/src/services/portal.service.ts` | Create | 6 |
| `apps/api/src/routes/station.router.ts` | Create | 7 |
| `apps/api/src/routes/portal.router.ts` | Create | 7 |
| `apps/api/src/routes/portal-events.router.ts` | Create | 7 |
| `apps/api/src/routes/portal-results.router.ts` | Create | 7 |
| `apps/api/src/routes/organization.router.ts` | Modify | 7 |
| `apps/api/src/app.ts` | Modify | 7 |
| `apps/api/src/constants/api-codes.constants.ts` | Modify | 7 |
| `apps/web/src/api/stations.api.ts` | Create | 8 |
| `apps/web/src/api/portals.api.ts` | Create | 8 |
| `apps/web/src/api/portal-results.api.ts` | Create | 8 |
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
