# Connector Instance Detail View

## Overview

Enhance the ConnectorInstance detail page (`/connectors/:connectorInstanceId`) to display full instance information, a paginated list of associated connector entities, and each entity's column metadata (field mappings with column definitions).

## User Stories

### Instance Information
- As a user, I can view a connector instance's name, status, connector definition, configuration, last sync time, and error messages on its detail page.

### Entity List
- As a user, I can see a paginated list of connector entities associated with this instance.
- As a user, I can sort entities by key, label, or created date.
- As a user, I can control page size and navigate between pages.

### Column Metadata
- As a user, I can expand an entity to see its field mappings and associated column definitions.
- Each field mapping shows: source field, column label, column key, data type, required flag, and primary key flag.
- Entities with no field mappings display an appropriate empty state.

## Architecture

### Data Flow
ConnectorInstance → ConnectorEntity[] (paginated) → FieldMapping[] → ColumnDefinition

### API Changes
1. `GET /api/connector-instances/:id` — returns instance with connector definition attached
2. `GET /api/connector-entities?connectorInstanceId=X&include=fieldMappings` — returns entities with nested field mappings and column definitions (batch-loaded, no N+1)

### Frontend Changes
1. New SDK hooks for connector entities (`connector-entities.api.ts`)
2. New components: `ConnectorEntityDataList`, `ConnectorEntityCardUI`, `FieldMappingTableUI`
3. Enhanced `ConnectorInstanceView` with instance details section + paginated entity list

### Implementation Phases
1. **Contracts** — Enriched Zod schemas for entities with mappings; update instance GET response
2. **Repository** — `findManyWithFieldMappings()` with batch loading
3. **API Router** — `include=fieldMappings` parameter support
4. **Frontend SDK** — Query hooks and keys for connector entities
5. **Frontend Components** — Data list, card, field mapping table
6. **Frontend View** — Wire together in ConnectorInstanceView

## Acceptance Criteria
- [x] Instance detail page shows name, status chip, connector definition name, config, sync info
- [x] Paginated entity list renders below instance details
- [x] Pagination toolbar supports sort (key/label/created), page size, and page navigation
- [x] Expanding an entity reveals field mapping table with column metadata
- [x] Empty states for no entities and no field mappings
- [x] `include=fieldMappings` is opt-in; without it, entity list returns flat data (backward compat)
- [x] Soft-deleted field mappings and column definitions are excluded
- [x] All type checks pass (`npm run type-check`)

## Test Plan
- [x] **Unit**: ConnectorEntityCardUI renders label, key, mapping count; FieldMappingTableUI renders rows
- [x] **Unit**: ConnectorInstanceView renders instance details and entity list sections
- [x] **Integration**: `GET /api/connector-entities?include=fieldMappings` returns nested data
- [x] **Integration**: `GET /api/connector-entities` without include returns flat data
- [x] **Integration**: `GET /api/connector-instances/:id` returns connectorDefinition
- [x] **Integration**: Pagination (limit/offset) applies to entities, not flattened join rows
- [x] **Manual**: Navigate to instance detail, verify all sections render, pagination works, expansion works
