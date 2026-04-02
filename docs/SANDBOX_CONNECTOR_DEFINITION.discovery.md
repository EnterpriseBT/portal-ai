# Sandbox Connector Definition — Discovery

## Context

New users sign up and get an empty organization with no connector instances or stations. They must manually create a connector instance before launching portals. The sandbox connector is a built-in, no-external-datasource connector that lets users immediately create entities, field mappings, and launch portals from an auto-provisioned default station.

## Architecture Summary

### Existing Patterns (Reference: CSV Connector)

- **Model layer** (`packages/core/src/models/connector-definition.model.ts`): `ConnectorDefinitionSchema` → per-connector subclasses (`CSVConnectorDefinition{Schema,Model,ModelFactory}`)
- **Adapter interface** (`apps/api/src/adapters/adapter.interface.ts`): `ConnectorAdapter` with `accessMode`, `queryRows`, `syncEntity`, `discoverEntities`, `discoverColumns`
- **Adapter registry** (`apps/api/src/adapters/adapter.registry.ts`): static `Map<slug, ConnectorAdapter>`, registered at startup via `apps/api/src/adapters/register.ts`
- **Seed** (`apps/api/src/services/seed.service.ts`): `seedConnectorDefinitions()` uses `upsertManyBySlug()` for idempotent seeding
- **Signup flow** (`apps/api/src/services/application.service.ts`): `setupOrganization()` creates user + org + org-user link in a transaction. Currently does NOT create connector instances or stations.

### Key Repositories (via `DbService.repository`)

`connectorDefinitions` (has `findBySlug(slug, client)`), `connectorInstances`, `connectorEntities`, `stations`, `stationInstances`, `organizations`, `users`, `organizationUsers`, `fieldMappings`, `columnDefinitions`, `entityRecords`

## Implementation Plan

### Phase 1: Core Model

**`packages/core/src/models/connector-definition.model.ts`** — Add at bottom, following CSV pattern:
- `SandboxConnectorDefinitionSchema` (extends `ConnectorDefinitionSchema`, empty)
- `SandboxConnectorDefinitionModel` (extends `CoreModel`, with `parse()` / `validate()`)
- `SandboxConnectorDefinitionModelFactory` (extends `ModelFactory`, with `create(createdBy)`)

Auto-exported via existing barrel `export * from "./connector-definition.model.js"`.

### Phase 2: Sandbox Adapter

**New `apps/api/src/adapters/sandbox/sandbox.adapter.ts`**
- `accessMode: "import"` — reads from `entity_records`, same as CSV
- `queryRows` — same logic as CSV adapter (resolve entity, load columns, fetch records, apply filters/sort)
- `syncEntity`, `discoverEntities`, `discoverColumns` — all no-ops

**Extract shared helper** (`apps/api/src/utils/adapter.util.ts`):
- The CSV `queryRows` + `resolveColumns` logic (~155 lines) is entirely generic. Extract as `importModeQueryRows()` and `resolveColumns()`. Both CSV and sandbox delegate to it.
- Refactor `apps/api/src/adapters/csv/csv.adapter.ts` to use the shared helper.

**`apps/api/src/adapters/register.ts`** — Register `"sandbox"` → `sandboxAdapter`.

### Phase 3: Seed the Definition

**`apps/api/src/services/seed.service.ts`** — Add to `connectors` array:
- slug: `"sandbox"`, display: `"Sandbox"`, category: `"Built-in"`, authType: `"none"`
- capabilityFlags: `{ sync: false, query: true, write: true }`
- configSchema: `{}`, isActive: `true`, version: `"1.0.0"`, iconUrl: `null`

Seed runs at app startup before HTTP traffic — definition guaranteed to exist before webhooks.

### Phase 4: Auto-Provision on Signup

**`apps/api/src/services/application.service.ts`** — Expand `setupOrganization()` inside existing transaction, after org-user creation:

1. Look up sandbox definition by slug (`findBySlug("sandbox", tx)`). If missing, log warning and return early — don't break signup.
2. Create connector instance (name="Sandbox", status="active", enabledCapabilityFlags={ read: true, write: true, sync: false })
3. Create default station (name="Default Station", toolPacks=["data_query"])
4. Link via station_instances join table
5. Set `organization.defaultStationId` to the new station

All atomic within the same transaction.

### Files Changed

| File | Action |
|------|--------|
| `packages/core/src/models/connector-definition.model.ts` | Add Sandbox model/factory |
| `apps/api/src/utils/adapter.util.ts` | **New** — shared queryRows logic |
| `apps/api/src/adapters/sandbox/sandbox.adapter.ts` | **New** — sandbox adapter |
| `apps/api/src/adapters/csv/csv.adapter.ts` | Refactor to use shared import-query |
| `apps/api/src/adapters/register.ts` | Register sandbox adapter |
| `apps/api/src/services/seed.service.ts` | Add sandbox to seed array |
| `apps/api/src/services/application.service.ts` | Auto-provision sandbox + station on signup |

### Verification

1. `npm run type-check` — dual-schema alignment
2. `npm run db:seed` — seeds sandbox definition alongside CSV
3. `npm run test` — no regressions
4. Manual: trigger new-user webhook → verify sandbox connector instance, default station with data_query, station-instance link, and org.defaultStationId in DB
