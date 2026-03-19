# Connector Adapter Pattern + Unified Data Layer

## Overview

Introduce a connector-agnostic data layer that allows reading and viewing entity records from any connector source (CSV, Airtable, HubSpot, etc.) through a unified API and frontend. Each connector implements a standard adapter interface; the API and UI are built once and work for all connectors.

## User Stories

### Viewing Entity Data
- As a user, I can navigate to a connector entity and see its records in a paginated data table.
- As a user, I can sort and filter entity records by any mapped column.
- As a user, I can see column headers derived from the entity's field mappings and column definitions.
- As a user, I can see where the data came from (cached vs. live) for hybrid connectors.

### Browsing Entities
- As a user, I can view a list of all entities across my organization, regardless of which connector instance they belong to.
- As a user, I can filter the entities list by connector instance.
- As a user, I can paginate through the entities list.

### Syncing Data
- As a user, I can trigger a manual sync/refresh for an entity to pull the latest data from the source.
- As a user, I can see when an entity was last synced.
- As a user, I can re-import a CSV file to update an entity's records.

### Entity & Column Discovery
- As a user, I can discover available entities and columns from a connected source (e.g., list Airtable tables, HubSpot object types).
- As a user, I can confirm discovered entities and column mappings before syncing data.

## Architecture

### Connector Adapter Interface

Every connector implements a standard `ConnectorAdapter` interface:

```ts
interface EntityDataQuery {
  entityKey: string;
  columns?: string[];
  limit: number;
  offset: number;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters?: Record<string, { op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt'; value: unknown }>;
}

interface EntityDataResult {
  rows: Record<string, unknown>[];
  total: number;
  columns: ColumnDefinitionSummary[];
  source: 'cache' | 'live';
}

interface ConnectorAdapter {
  readonly accessMode: 'import' | 'live' | 'hybrid';
  queryRows(instance: ConnectorInstance, query: EntityDataQuery): Promise<EntityDataResult>;
  syncEntity(instance: ConnectorInstance, entityKey: string): Promise<SyncResult>;
  discoverEntities(instance: ConnectorInstance): Promise<DiscoveredEntity[]>;
  discoverColumns(instance: ConnectorInstance, entityKey: string): Promise<DiscoveredColumn[]>;
}
```

### Access Modes

| Mode | `queryRows` | `syncEntity` | Connectors |
|------|-------------|--------------|------------|
| **import** | Reads from local `entity_records` only | Parses source → bulk inserts | CSV, Excel, flat files |
| **live** | Proxies to vendor API every time | No-op | Low-volume real-time sources |
| **hybrid** | Reads local store; falls back to API if stale | Pulls from API → upserts locally | Airtable, HubSpot, most SaaS APIs |

### Adapter Registry

Maps connector definition slugs to adapter implementations:

```
apps/api/src/adapters/
  connector-adapter.interface.ts
  connector-adapter.registry.ts     # slug → adapter lookup
  csv/
    csv.adapter.ts                  # accessMode: 'import'
  airtable/
    airtable.adapter.ts            # accessMode: 'hybrid'
  hubspot/
    hubspot.adapter.ts             # accessMode: 'hybrid'
```

### Data Store: `entity_records` Table

JSONB row store for `import` and `hybrid` mode connectors. Chosen over dynamic physical tables because:
- No runtime DDL — works within standard DB permissions
- Schema changes from external sources (e.g., Airtable column additions) are handled gracefully
- SaaS connector volumes (typically <50K records per entity) are well within JSONB + GIN index performance
- Avoids table proliferation across many connector instances and entities

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Record identity |
| `organizationId` | uuid FK | Tenant scoping |
| `connectorEntityId` | uuid FK | Parent entity |
| `data` | jsonb | Raw source fields as-is |
| `normalizedData` | jsonb | Mapped to column definition keys via field mappings |
| `sourceId` | text | Vendor's unique ID (HubSpot record ID, Airtable `rec_xxx`, CSV row index) |
| `checksum` | text | Hash of `data` for dedup/change detection on sync |
| `syncedAt` | timestamptz | When this record was last synced |
| + baseColumns | — | created, updated, deleted, createdBy, updatedBy |

**Indexes:**
- `(connectorEntityId, sourceId)` UNIQUE — upsert target for syncs
- GIN on `normalizedData` — filter/sort support
- `(connectorEntityId, syncedAt)` — staleness checks

### Data Flow

```
Frontend (any entity, any connector)
  │
  GET /api/connector-entities/:id/records
  │
  ▼
Router → AdapterRegistry.get(slug)
  │
  ├─ CSVAdapter (import)        → reads entity_records table
  ├─ AirtableAdapter (hybrid)   → checks freshness → local or API
  ├─ HubSpotAdapter (hybrid)    → checks freshness → local or API
  └─ FutureAdapter (live)       → always proxies to source
  │
  ▼
Uniform EntityDataResult → Frontend DataTable
```

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/connector-entities/:id/records` | Paginated records (limit, offset, sort, columns, filter, search) |
| `GET /api/connector-entities/:id/records/count` | Record count |
| `POST /api/connector-entities/:id/records/import` | Bulk import (CSV workflow) |
| `POST /api/connector-entities/:id/sync` | Trigger sync (hybrid/import connectors) |
| `DELETE /api/connector-entities/:id/records` | Clear records (re-import) |
| `POST /api/connector-instances/:id/discover` | Discover entities and columns from source |

**Response shape for `GET .../records`:**
```json
{
  "data": [
    {
      "id": "record-uuid",
      "sourceId": "rec_abc123",
      "data": { "First Name": "Jane", "Email Address": "jane@ex.com" },
      "normalizedData": { "first_name": "Jane", "email": "jane@ex.com" }
    }
  ],
  "pagination": { "total": 1500, "limit": 25, "offset": 0 },
  "columns": [
    { "key": "first_name", "label": "First Name", "type": "string" },
    { "key": "email", "label": "Email", "type": "string" }
  ],
  "source": "cache"
}
```

### Frontend

**New route:** `/entities`

**New view:** `Entities.view.tsx`
- Lists all connector entities across the organization
- Paginated table showing entity label, key, connector instance name, and record count
- Filter by connector instance (dropdown/select)
- Clicking an entity row navigates to the entity detail view

**New route:** `/connectors/:connectorInstanceId/entities/:connectorEntityId`

**New view:** `ConnectorEntityDetail.view.tsx`
- Breadcrumbs: Connectors > Instance Name > Entity Label
- Entity metadata header (key, label, record count, last sync, access mode)
- Paginated data table with columns derived from field mappings + column definitions
- Type-aware cell rendering (dates, booleans, enums, etc.)
- Sync/refresh button for hybrid connectors

**New components:**

| Component | Purpose |
|-----------|---------|
| `EntitiesDataTable` | Data-fetching wrapper for the entities list (calls connector entities API) |
| `EntitiesDataTableUI` | Pure presentational table (entity rows as props, connector instance filter) |
| `EntityRecordDataTable` | Data-fetching wrapper (calls records API) |
| `EntityRecordDataTableUI` | Pure presentational table (rows + column defs as props) |

### Sync Service

```ts
class SyncService {
  // Triggered by: CSV import, manual refresh, scheduled job
  static async syncEntity(connectorEntityId: string): Promise<SyncResult>;
  // 1. Load entity → instance → definition → adapter
  // 2. adapter.syncEntity(instance, entityKey)
  // 3. Update connectorInstance.lastSyncAt
  // 4. Return { created, updated, unchanged, errors }
}
```

## Implementation Phases

| Phase | Scope | Key Files |
|-------|-------|-----------|
| 1 | Adapter interface + registry | `apps/api/src/adapters/` |
| 2 | `entity_records` table, model, migration | `packages/core/`, `apps/api/src/db/schema/` |
| 3 | EntityRecords repository | `apps/api/src/db/repositories/` |
| 4 | CSV adapter (wires existing workflow through adapter) | `apps/api/src/adapters/csv/` |
| 5 | Unified records API endpoint | `apps/api/src/routes/` |
| 6 | Sync service | `apps/api/src/services/` |
| 7 | Frontend SDK hooks for entity records | `apps/web/src/api/` |
| 8 | Frontend entities list view (all entities across org) | `apps/web/src/views/`, `apps/web/src/components/` |
| 9 | Frontend entity detail view + data table | `apps/web/src/views/`, `apps/web/src/components/` |
| 10 | CSV workflow wire-up (ReviewStep calls import) | `apps/web/src/workflows/CSVConnector/` |
| 11 | Airtable / HubSpot adapters | `apps/api/src/adapters/airtable/`, `hubspot/` |

Phases 5-9 are built once and never change. Each new connector is a new adapter registered by slug.

## Acceptance Criteria

- [x] `ConnectorAdapter` interface defined with `accessMode`, `queryRows`, `syncEntity`, `discoverEntities`, `discoverColumns`
- [x] Adapter registry maps connector definition slugs to adapter implementations
- [x] `entity_records` table created with JSONB `data`/`normalizedData`, `sourceId`, `checksum`, `syncedAt`
- [x] GIN index on `normalizedData` and unique constraint on `(connectorEntityId, sourceId)`
- [x] CSV adapter implements `ConnectorAdapter` with `accessMode: 'import'`
- [x] `GET /api/connector-entities/:id/records` returns paginated records with column metadata
- [x] Records API supports `limit`, `offset`, `sort`, `columns` query params
- [x] `POST /api/connector-entities/:id/sync` triggers adapter sync and updates `lastSyncAt`
- [ ] Entity detail view renders paginated data table with column headers from field mappings
- [ ] Data table supports sorting by column
- [ ] Sync/refresh button visible for hybrid connectors
- [x] Soft-deleted records excluded from all queries
- [x] Entities list view renders all entities across organization with pagination
- [x] Entities list view supports filtering by connector instance
- [x] Clicking an entity in the list navigates to the entity detail view
- [ ] All type checks pass (`npm run type-check`)

## Test Plan

### Unit Tests

#### Adapter Registry & Interface (`apps/api/src/adapters/`)
- [x] `ConnectorAdapterRegistry.get(slug)` returns the correct adapter for a registered slug
- [x] `ConnectorAdapterRegistry.get(slug)` throws for an unregistered slug
- [x] Each registered adapter exposes a valid `accessMode` (`import` | `live` | `hybrid`)

#### CSV Adapter (`apps/api/src/adapters/csv/`)
- [x] `queryRows` returns rows from `entity_records` filtered by `connectorEntityId`
- [x] `queryRows` respects `limit` and `offset` pagination params
- [x] `queryRows` applies `sort` by column and direction on `normalizedData`
- [x] `queryRows` applies `filters` operators (`eq`, `neq`, `contains`, `gt`, `lt`) on `normalizedData`
- [x] `queryRows` returns only requested `columns` when specified
- [x] `queryRows` returns `source: 'cache'` for import-mode adapters
- [ ] `syncEntity` parses source CSV and bulk inserts rows with `normalizedData` mapped via field mappings
- [ ] `syncEntity` computes `checksum` for each row and skips unchanged records on re-sync
- [ ] `syncEntity` returns accurate `{ created, updated, unchanged, errors }` counts
- [x] `discoverEntities` / `discoverColumns` return empty or appropriate stubs for CSV

#### Entity Records Repository (`apps/api/src/db/repositories/`)
- [ ] `findMany` filters by `connectorEntityId` and excludes soft-deleted rows
- [ ] `create` / `createMany` persist `data`, `normalizedData`, `sourceId`, `checksum`, `syncedAt`
- [ ] Upsert on `(connectorEntityId, sourceId)` updates existing records instead of duplicating
- [ ] `softDelete` / `softDeleteMany` set `deleted` timestamp without removing rows
- [ ] `count` returns correct total scoped to `connectorEntityId`

#### Sync Service (`apps/api/src/services/`)
- [x] `syncEntity` loads entity → instance → definition → adapter chain correctly
- [x] `syncEntity` delegates to the adapter's `syncEntity` method
- [x] `syncEntity` updates `connectorInstance.lastSyncAt` after successful sync
- [x] `syncEntity` propagates adapter errors without masking them

#### Zod Model (`packages/core/`)
- [x] `EntityRecord` schema validates required fields (`connectorEntityId`, `data`, `sourceId`)
- [x] `EntityRecord` schema rejects missing or malformed fields
- [x] `EntityDataQuery` schema validates `limit`, `offset`, `sort`, `filters`
- [x] `EntityDataResult` schema validates `rows`, `total`, `columns`, `source`

#### Frontend — EntityRecordDataTableUI (`apps/web/`)
- [ ] Renders column headers from `columns` prop (label, key, type)
- [ ] Renders correct number of rows from `rows` prop
- [ ] Renders type-aware cells (dates formatted, booleans as icons, etc.)
- [ ] Calls `onSort` callback with column key and direction when header clicked
- [ ] Calls `onPageChange` callback with new offset on pagination interaction
- [ ] Renders empty state when `rows` is empty
- [ ] Displays `source` badge (`cache` / `live`) when provided

#### Frontend — EntityRecordDataTable (container) (`apps/web/`)
- [ ] Calls records API hook with correct entity ID and query params
- [ ] Passes loading state to UI component while fetching
- [ ] Passes error state to UI component on API failure
- [ ] Maps API response to `EntityRecordDataTableUI` props correctly

#### Frontend — EntitiesDataTableUI (`apps/web/`)
- [x] Renders entity rows with label, key, connector instance name, and record count columns
- [x] Renders connector instance filter dropdown with all available instances
- [ ] Calls `onFilterByInstance` callback when a connector instance is selected
- [ ] Calls `onPageChange` callback with new offset on pagination interaction
- [x] Renders empty state when no entities exist
- [x] Clicking an entity row calls `onEntityClick` with the entity ID

#### Frontend — EntitiesDataTable (container) (`apps/web/`)
- [x] Calls connector entities API hook with correct organization ID and query params
- [x] Passes `connectorInstanceId` filter param to API when selected
- [ ] Passes loading state to UI component while fetching
- [ ] Passes error state to UI component on API failure
- [x] Maps API response to `EntitiesDataTableUI` props correctly

#### Frontend — Entities View (`apps/web/`)
- [x] Renders page title and breadcrumbs
- [x] Renders `EntitiesDataTable` with pagination controls
- [x] Navigates to entity detail view on entity row click

#### Frontend — ConnectorEntityDetail View (`apps/web/`)
- [ ] Renders breadcrumbs: Connectors > Instance Name > Entity Label
- [ ] Renders entity metadata header (key, label, record count, last sync, access mode)
- [ ] Renders sync/refresh button only for `hybrid` and `import` access modes
- [ ] Hides sync button for `live` access mode
- [ ] Calls sync mutation on refresh button click

### Integration Tests

#### Records API (`GET /api/connector-entities/:id/records`)
- [ ] Returns 200 with paginated records, `pagination`, `columns`, and `source` fields
- [ ] Respects `limit` and `offset` query params in response pagination
- [ ] Respects `sort` query param and returns rows in correct order
- [ ] Respects `columns` query param and returns only requested fields
- [ ] Respects `search` query param and filters across normalizedData values
- [ ] Returns 404 for non-existent connector entity ID
- [ ] Returns 401 for unauthenticated requests
- [ ] Excludes soft-deleted records from results

#### Records Count API (`GET /api/connector-entities/:id/records/count`)
- [ ] Returns correct total count scoped to entity
- [ ] Excludes soft-deleted records from count

#### Bulk Import API (`POST /api/connector-entities/:id/records/import`)
- [ ] Inserts new records with `data`, `normalizedData`, `sourceId`, `checksum`
- [ ] Deduplicates on `(connectorEntityId, sourceId)` — re-import with same data produces no duplicates
- [ ] Updates changed records (different checksum) and preserves unchanged ones
- [ ] Returns accurate `{ created, updated, unchanged }` counts
- [ ] Returns 400 for malformed import payload

#### Sync API (`POST /api/connector-entities/:id/sync`)
- [ ] Calls adapter `syncEntity` and returns sync result
- [ ] Updates `connectorInstance.lastSyncAt` timestamp after sync
- [ ] Returns 404 for non-existent connector entity ID
- [ ] Returns 401 for unauthenticated requests

#### Clear Records API (`DELETE /api/connector-entities/:id/records`)
- [ ] Soft-deletes all records for the given entity
- [ ] Subsequent `GET .../records` returns empty result
- [ ] Returns 404 for non-existent connector entity ID

#### Discover API (`POST /api/connector-instances/:id/discover`)
- [ ] Returns discovered entities and columns from adapter
- [ ] Returns 404 for non-existent connector instance ID

#### Database Constraints & Indexes
- [ ] Unique constraint on `(connectorEntityId, sourceId)` prevents duplicate inserts
- [ ] GIN index on `normalizedData` supports filter queries without sequential scan
- [ ] `(connectorEntityId, syncedAt)` index supports staleness check queries

### Manual / E2E Tests
- [ ] Navigate to entities list, verify all entities across organization are shown
- [ ] Filter entities by connector instance, verify list updates correctly
- [ ] Click an entity row, verify navigation to entity detail view
- [ ] Navigate to entity detail, verify data table renders with correct columns and rows
- [ ] Verify pagination controls work (next/prev page, page size)
- [ ] Verify column sorting works (click header, verify order changes)
- [ ] Trigger sync/refresh, verify records update and `lastSyncAt` changes
- [ ] Re-import CSV with same data, verify no duplicate rows appear
- [ ] Re-import CSV with changed data, verify updated rows reflect changes
