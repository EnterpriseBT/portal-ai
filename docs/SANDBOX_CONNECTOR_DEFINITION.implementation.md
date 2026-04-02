# Sandbox Connector Definition — Implementation Plan

Step-by-step implementation checklist with tests and verification gates.

> **Note:** This plan is based on the corresponding spec and discovery docs:
> `SANDBOX_CONNECTOR_DEFINITION.spec.md` and `SANDBOX_CONNECTOR_DEFINITION.discovery.md`.

---

## Step 1: Core Model — Sandbox Connector Definition

**File:** `packages/core/src/models/connector-definition.model.ts`

Append after the CSV section (after line 107), following the identical pattern:

- [x] Add `SandboxConnectorDefinitionSchema` extending `ConnectorDefinitionSchema.extend({})`
- [x] Add `SandboxConnectorDefinition` type export
- [x] Add `SandboxConnectorDefinitionModel` class extending `CoreModel<SandboxConnectorDefinition>` with `parse()` and `validate()`
- [x] Add `SandboxConnectorDefinitionModelFactory` class extending `ModelFactory` with `create(createdBy)`

### Verify

```bash
npm run type-check          # No new errors
```

---

## Step 2: Extract Shared Adapter Utility

Extract the generic import-mode `queryRows` logic from `csv.adapter.ts` into a shared utility. The existing CSV adapter test suite serves as the regression safety net for this refactor.

### 2a. Create shared utility

**New file:** `apps/api/src/utils/adapter.util.ts`

- [x] Move `resolveColumns()` helper (csv.adapter.ts lines 39–75) into this file
- [x] Move the `queryRows` body (csv.adapter.ts lines 82–194) into an exported `importModeQueryRows(instance, query)` function
- [x] Import dependencies from their existing locations:
  - `connectorEntitiesRepo` from `../db/repositories/connector-entities.repository.js`
  - `entityRecordsRepo` from `../db/repositories/entity-records.repository.js`
  - `fieldMappingsRepo` from `../db/repositories/field-mappings.repository.js`
  - `columnDefinitionsRepo` from `../db/repositories/column-definitions.repository.js`
  - Types `ConnectorAdapter`, `EntityDataQuery`, `EntityDataResult`, `ColumnDefinitionSummary` from `../adapters/adapter.interface.js`
  - Type `ConnectorInstance` from `@portalai/core/models`
  - Type `ColumnDataType` from `@portalai/core/models`
  - Type `DbClient` from `../db/repositories/base.repository.js`

### 2b. Refactor CSV adapter

**File:** `apps/api/src/adapters/csv/csv.adapter.ts`

- [x] Remove the inline `resolveColumns` helper and `queryRows` implementation
- [x] Import `importModeQueryRows` from `../../utils/adapter.util.js`
- [x] Set `queryRows: importModeQueryRows` on the adapter object
- [x] Keep `syncEntity`, `discoverEntities`, `discoverColumns` as existing no-ops

The refactored CSV adapter should be ~15 lines:

```typescript
import type { ConnectorAdapter } from "../adapter.interface.js";
import { importModeQueryRows } from "../../utils/adapter.util.js";

export const csvAdapter: ConnectorAdapter = {
  accessMode: "import",
  queryRows: importModeQueryRows,
  async syncEntity() { return { created: 0, updated: 0, unchanged: 0, errors: 0 }; },
  async discoverEntities() { return []; },
  async discoverColumns() { return []; },
};
```

### Verify

```bash
npm run type-check                                                     # No new errors
npx jest apps/api/src/__tests__/adapters/csv/csv.adapter.test.ts       # All existing tests pass
```

---

## Step 3: Sandbox Adapter

### 3a. Create adapter

**New file:** `apps/api/src/adapters/sandbox/sandbox.adapter.ts`

- [x] Import `ConnectorAdapter` type from `../adapter.interface.js`
- [x] Import `importModeQueryRows` from `../../utils/adapter.util.js`
- [x] Export `sandboxAdapter: ConnectorAdapter` with:
  - `accessMode: "import"`
  - `queryRows: importModeQueryRows`
  - `syncEntity` → returns `{ created: 0, updated: 0, unchanged: 0, errors: 0 }`
  - `discoverEntities` → returns `[]`
  - `discoverColumns` → returns `[]`

### 3b. Register adapter

**File:** `apps/api/src/adapters/register.ts`

- [x] Import `sandboxAdapter` from `./sandbox/sandbox.adapter.js`
- [x] Add `ConnectorAdapterRegistry.register("sandbox", sandboxAdapter)` inside `registerAdapters()`

### 3c. Write unit tests

**New file:** `apps/api/src/__tests__/adapters/sandbox/sandbox.adapter.test.ts`

Follow the pattern of `apps/api/src/__tests__/adapters/csv/csv.adapter.test.ts`:

- [x] Mock the same four repository modules using `jest.unstable_mockModule()`:
  - `../../../db/repositories/connector-entities.repository.js`
  - `../../../db/repositories/entity-records.repository.js`
  - `../../../db/repositories/field-mappings.repository.js`
  - `../../../db/repositories/column-definitions.repository.js`
- [x] Dynamic import `sandboxAdapter` after mocks
- [x] Reuse the same fixture objects (stubInstance, stubEntity, stubMappings, stubColDefs, stubRecords) with sandbox-appropriate names
- [x] Reuse `setupMocks()` and `baseQuery()` helpers

**Test cases:**

- [x] `has accessMode "import"`
- [x] `queryRows` — returns rows from entity_records
- [x] `queryRows` — returns `source: "cache"`
- [x] `queryRows` — returns column metadata from field mappings
- [x] `queryRows` — returns empty result for unknown entity key
- [x] `syncEntity` — returns zero counts (no-op)
- [x] `discoverEntities` — returns empty array
- [x] `discoverColumns` — returns empty array

### Verify

```bash
npm run type-check                                                           # No new errors
npx jest apps/api/src/__tests__/adapters/sandbox/sandbox.adapter.test.ts     # All new tests pass
npx jest apps/api/src/__tests__/adapters/                                    # CSV + sandbox + registry all pass
```

---

## Step 4: Seed the Sandbox Definition

**File:** `apps/api/src/services/seed.service.ts`

- [x] Import `SandboxConnectorDefinitionModelFactory` from `@portalai/core/models`
- [x] Add sandbox entry to the `connectors` array in `seedConnectorDefinitions()`:

```typescript
new SandboxConnectorDefinitionModelFactory().create(SystemUtilities.id.system)
  .update({
    slug: "sandbox",
    display: "Sandbox",
    category: "Built-in",
    authType: "none",
    isActive: true,
    configSchema: {},
    capabilityFlags: { sync: false, query: true, write: true },
    version: "1.0.0",
    iconUrl: null,
  }).parse()
```

### Update existing integration tests

**File:** `apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts`

The existing tests assert `rows.length >= 1`. These will still pass, but add explicit sandbox coverage:

- [x] Add test: `should create a Sandbox connector definition with correct fields` — after `seed()`, find row with `slug === "sandbox"` and assert:
  - `display` === `"Sandbox"`
  - `category` === `"Built-in"`
  - `authType` === `"none"`
  - `isActive` === `true`
  - `capabilityFlags` deep equals `{ sync: false, query: true, write: true }`
  - `configSchema` deep equals `{}`
  - `version` === `"1.0.0"`
- [x] Add test: `should be idempotent for sandbox — running seed twice should not duplicate rows` — seed twice, filter by `slug === "sandbox"`, assert length 1
- [x] Update existing count assertion in `should insert connector definitions into the database` from `>= 1` to `>= 2` (now seeds both CSV and sandbox)

### Verify

```bash
npm run type-check                                                                                 # No new errors
npx jest apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts          # All tests pass
```

---

## Step 5: Auto-Provision on Signup

**File:** `apps/api/src/services/application.service.ts`

### 5a. Add imports

- [x] Add to existing imports from `@portalai/core/models`:
  - `ConnectorInstanceModelFactory`
  - `StationModelFactory`
  - `StationInstanceModelFactory`

### 5b. Expand `setupOrganization()`

Inside the existing `DbService.transaction(async (tx) => { ... })` block, after the org-user creation (after line 77):

- [x] **Look up sandbox definition:**
  ```typescript
  const sandboxDef = await DbService.repository.connectorDefinitions.findBySlug("sandbox", tx);
  ```
  If `undefined`, log warning and return early with existing `{ user, organization, organizationUser }`. Do not fail signup.

- [x] **Create connector instance:**
  - Use `ConnectorInstanceModelFactory().create(systemId).update({...}).parse()`
  - Fields: `connectorDefinitionId: sandboxDef.id`, `organizationId: createdOrg.id`, `name: "Sandbox"`, `status: "active"`, `config: {}`, `credentials: null`, `lastSyncAt: null`, `lastErrorMessage: null`, `enabledCapabilityFlags: { read: true, write: true, sync: false }`
  - Call `DbService.repository.connectorInstances.create(model, tx)`

- [x] **Create default station:**
  - Use `StationModelFactory().create(systemId).update({...}).parse()`
  - Fields: `organizationId: createdOrg.id`, `name: "My Station"`, `description: "Default organization sandbox station"`, `toolPacks: ["data_query"]`
  - Call `DbService.repository.stations.create(model, tx)`

- [x] **Link via station_instances:**
  - Use `StationInstanceModelFactory().create(systemId).update({...}).parse()`
  - Fields: `stationId: createdStation.id`, `connectorInstanceId: createdInstance.id`
  - Call `DbService.repository.stationInstances.create(model, tx)`

- [x] **Set defaultStationId on organization:**
  - Call `DbService.repository.organizations.update(createdOrg.id, { defaultStationId: createdStation.id }, tx)`

- [x] **Update return value:**
  - Spread `createdOrg` with updated `defaultStationId`:
    ```typescript
    organization: { ...createdOrg, defaultStationId: createdStation.id }
    ```

- [x] **Add logging** for the full provisioning:
  ```typescript
  logger.info({
    userId: createdUser.id,
    organizationId: createdOrg.id,
    connectorInstanceId: createdInstance.id,
    stationId: createdStation.id,
  }, "Sandbox auto-provisioning complete");
  ```

### 5c. Update existing integration tests

**File:** `apps/api/src/__tests__/__integration__/services/application.service.integration.test.ts`

The existing tests use `teardownOrg()` which already cleans up all related tables in FK-safe order, so no teardown changes needed.

**Important:** These integration tests run against the real database. The sandbox connector definition must exist for auto-provisioning to execute. Either:
- (a) Run `seedService.seedConnectorDefinitions(db)` in `beforeEach`, or
- (b) Insert a minimal sandbox definition row directly

Option (a) is preferred — it mirrors production behavior.

**New tests to add under `describe("setupOrganization")`:**

- [x] `should create a sandbox connector instance for the new organization`
  - After `setupOrganization(owner)`, query `connectorInstances` table
  - Assert row exists with `organizationId` matching created org
  - Assert `name === "Sandbox"` and `status === "active"`
  - Assert `enabledCapabilityFlags` deep equals `{ read: true, write: true, sync: false }`
  - Assert `connectorDefinitionId` matches the sandbox definition's ID

- [x] `should create a default station with data_query tool pack`
  - After `setupOrganization(owner)`, query `stations` table
  - Assert row exists with `organizationId` matching created org
  - Assert `name === "My Station"`
  - Assert `toolPacks` deep equals `["data_query"]`

- [x] `should link the sandbox connector instance to the default station`
  - After `setupOrganization(owner)`, query `stationInstances` table
  - Assert row exists linking the created connector instance to the created station

- [x] `should set defaultStationId on the organization`
  - After `setupOrganization(owner)`, query `organizations` table
  - Assert `defaultStationId` equals the created station's ID
  - Also verify `result.organization.defaultStationId` matches

- [x] `should still succeed if sandbox definition does not exist`
  - Delete sandbox definition from DB before calling `setupOrganization`
  - Assert call does not throw
  - Assert returned `user`, `organization`, `organizationUser` are valid
  - Assert no connector instances or stations were created

- [x] `should roll back sandbox provisioning if station creation fails`
  - Verify that if any provisioning step fails, neither connector instance nor station exist in DB (transaction atomicity)

### Verify

```bash
npm run type-check                                                                                            # No new errors
npx jest apps/api/src/__tests__/__integration__/services/application.service.integration.test.ts              # All tests pass
```

---

## Step 6: Sandbox Connector Workflow (Frontend)

### 6a. Add `create` method to connector instances SDK

**File:** `apps/web/src/api/connector-instances.api.ts`

- [x] Import `ConnectorInstanceCreateRequestBody` and `ConnectorInstanceCreateResponsePayload` from `@portalai/core/contracts`
- [x] Add `create()` method using `useAuthMutation` with `POST /api/connector-instances`

### 6b. Create workflow component

**New file:** `apps/web/src/workflows/SandboxConnector/SandboxConnectorWorkflow.component.tsx`

- [x] Export `SandboxConnectorWorkflowUI` — pure props-only component with Modal, TextField for name, FormAlert, Cancel/Connect buttons
- [x] Export `SandboxConnectorWorkflow` — container component with hooks: state management, Zod validation via `ConnectorInstanceCreateRequestBodySchema`, mutation, cache invalidation
- [x] Follow form & dialog pattern: `slotProps.paper.component="form"`, `useDialogAutoFocus`, `validateWithSchema`, `focusFirstInvalidField`, `FormAlert`

### 6c. Create barrel export

**New file:** `apps/web/src/workflows/SandboxConnector/index.ts`

- [x] Re-export `SandboxConnectorWorkflow`, `SandboxConnectorWorkflowUI`, and `SandboxConnectorWorkflowUIProps`

### 6d. Register in workflow registry

**File:** `apps/web/src/views/Connector.view.tsx`

- [x] Import `SandboxConnectorWorkflow` from `../workflows/SandboxConnector`
- [x] Add `sandbox: SandboxConnectorWorkflow` to `WORKFLOW_REGISTRY`

### Verify

```bash
npm run type-check          # No new errors (web + api)
```

---

## Step 7: Final Verification

Run the complete verification suite to confirm no regressions across the entire codebase.

### Type check

```bash
npm run type-check
```

- [ ] Zero errors

### Lint

```bash
npm run lint
```

- [ ] Zero errors (run `npm run lint:fix` if needed for auto-fixable issues)

### Format

```bash
npm run format
```

- [ ] No unformatted files

### Unit tests

```bash
npm run test
```

- [ ] All existing tests pass
- [ ] All new tests pass

### Integration tests (if CI environment available)

```bash
npx jest --config apps/api/jest.integration.config.ts
```

- [ ] Seed integration tests pass (CSV + sandbox definitions)
- [ ] Application service integration tests pass (auto-provisioning)

### Build

```bash
npm run build
```

- [ ] Clean build across all packages

---

## File Summary

| # | File | Action |
|---|------|--------|
| 1 | `packages/core/src/models/connector-definition.model.ts` | Modify — add Sandbox model/factory |
| 2 | `apps/api/src/utils/adapter.util.ts` | **Create** — shared `resolveColumns` + `importModeQueryRows` |
| 3 | `apps/api/src/adapters/csv/csv.adapter.ts` | Modify — delegate to shared util |
| 4 | `apps/api/src/adapters/sandbox/sandbox.adapter.ts` | **Create** — sandbox adapter |
| 5 | `apps/api/src/adapters/register.ts` | Modify — register sandbox |
| 6 | `apps/api/src/services/seed.service.ts` | Modify — add sandbox to seed |
| 7 | `apps/api/src/services/application.service.ts` | Modify — auto-provision on signup |
| 8 | `apps/api/src/__tests__/adapters/sandbox/sandbox.adapter.test.ts` | **Create** — sandbox adapter unit tests |
| 9 | `apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts` | Modify — add sandbox seed assertions |
| 10 | `apps/api/src/__tests__/__integration__/services/application.service.integration.test.ts` | Modify — add auto-provisioning assertions |
| 11 | `apps/web/src/api/connector-instances.api.ts` | Modify — add `create()` mutation |
| 12 | `apps/web/src/workflows/SandboxConnector/` | **Create** — sandbox connector workflow (modal form) |
| 13 | `apps/web/src/views/Connector.view.tsx` | Modify — register `sandbox` in `WORKFLOW_REGISTRY` |
