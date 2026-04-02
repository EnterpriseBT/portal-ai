# Sandbox Connector Definition — Specification

## 1. Overview

The sandbox connector is a built-in connector type that requires no external data source. It enables users to create arbitrary entities, field mappings, and column definitions using the established app architecture. Upon new user signup, a sandbox connector instance and default station are automatically provisioned so users can immediately launch portals.

### Capabilities

| Capability | Enabled |
|------------|---------|
| `query`    | `true`  |
| `write`    | `true`  |
| `sync`     | `false` |

### Behavior

- **No external data source** — the sandbox connector reads/writes to the local `entity_records` table exclusively (`accessMode: "import"`)
- **Sync is a no-op** — there is no upstream to sync from
- **Discovery is a no-op** — entities and columns are created manually by the user through the app UI

---

## 2. Connector Definition Seed Record

Added to the `connector_definitions` table via `SeedService.seedConnectorDefinitions()`.

```typescript
{
  slug: "sandbox",
  display: "Sandbox",
  category: "Built-in",
  authType: "none",
  isActive: true,
  configSchema: {},
  capabilityFlags: { sync: false, query: true, write: true },
  version: "1.0.0",
  iconUrl: null,
}
```

Seeded via `upsertManyBySlug()` — idempotent on the `slug` column. Runs at app startup before any HTTP traffic.

**File:** `apps/api/src/services/seed.service.ts`

---

## 3. Core Model

Follow the CSV subclass pattern in `connector-definition.model.ts` (lines 78–107).

### Schema

```typescript
export const SandboxConnectorDefinitionSchema = ConnectorDefinitionSchema.extend({});
export type SandboxConnectorDefinition = z.infer<typeof SandboxConnectorDefinitionSchema>;
```

### Model Class

```typescript
export class SandboxConnectorDefinitionModel extends CoreModel<SandboxConnectorDefinition> {
  get schema() { return SandboxConnectorDefinitionSchema; }
  parse(): SandboxConnectorDefinition { return this.schema.parse(this._model); }
  validate(): z.ZodSafeParseResult<SandboxConnectorDefinition> { return this.schema.safeParse(this._model); }
}
```

### Factory

```typescript
export class SandboxConnectorDefinitionModelFactory extends ModelFactory<
  SandboxConnectorDefinition,
  SandboxConnectorDefinitionModel
> {
  create(createdBy: string): SandboxConnectorDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new SandboxConnectorDefinitionModel(baseModel.toJSON());
  }
}
```

**File:** `packages/core/src/models/connector-definition.model.ts`
**Exports:** Auto-exported via existing `export * from "./connector-definition.model.js"` barrel in `packages/core/src/models/index.ts`.

---

## 4. Adapter

### 4a. Import-Mode Query Helper

The CSV adapter's `queryRows` implementation (lines 39–194 of `csv.adapter.ts`) contains zero CSV-specific logic — it operates generically on `entity_records`, `field_mappings`, and `column_definitions`. Extract this into a reusable utility.

**New file:** `apps/api/src/utils/adapter.util.ts`

Exports:

```typescript
/**
 * Resolve column metadata for an entity by loading its field mappings
 * and their associated column definitions.
 */
export async function resolveColumns(
  connectorEntityId: string,
  organizationId: string,
  client?: DbClient
): Promise<ColumnDefinitionSummary[]>;

/**
 * Generic queryRows implementation for import-mode adapters.
 * Reads from entity_records with filter/sort/pagination support.
 */
export async function importModeQueryRows(
  instance: ConnectorInstance,
  query: EntityDataQuery
): Promise<EntityDataResult>;
```

`importModeQueryRows` performs:
1. Resolve connector entity by key via `connectorEntitiesRepo.findByKey(instance.id, query.entityKey)`
2. Load column metadata via `resolveColumns(entity.id, entity.organizationId)`
3. Fetch records from `entityRecordsRepo.findByConnectorEntityId(entity.id, { limit, offset })`
4. Count total via `entityRecordsRepo.countByConnectorEntityId(entity.id)`
5. Map records to `normalizedData` rows, optionally filtering to `query.columns`
6. Apply `query.filters` (eq, neq, contains, gt, lt operators)
7. Apply `query.sort` (string locale compare, numeric compare)
8. Return `{ rows, total, columns, source: "cache" }`

**Dependencies (imported from existing modules):**
- `connectorEntitiesRepo` from `../db/repositories/connector-entities.repository.js`
- `entityRecordsRepo` from `../db/repositories/entity-records.repository.js`
- `fieldMappingsRepo` from `../db/repositories/field-mappings.repository.js`
- `columnDefinitionsRepo` from `../db/repositories/column-definitions.repository.js`
- Types from `../adapters/adapter.interface.js`

### 4b. Refactor CSV Adapter

**File:** `apps/api/src/adapters/csv/csv.adapter.ts`

Remove the inline `resolveColumns` helper and `queryRows` body. Replace with:

```typescript
import { importModeQueryRows } from "../../utils/adapter.util.js";

export const csvAdapter: ConnectorAdapter = {
  accessMode: "import",
  queryRows: importModeQueryRows,
  async syncEntity() { return { created: 0, updated: 0, unchanged: 0, errors: 0 }; },
  async discoverEntities() { return []; },
  async discoverColumns() { return []; },
};
```

### 4c. Sandbox Adapter

**New file:** `apps/api/src/adapters/sandbox/sandbox.adapter.ts`

```typescript
import type { ConnectorAdapter } from "../adapter.interface.js";
import { importModeQueryRows } from "../../utils/adapter.util.js";

export const sandboxAdapter: ConnectorAdapter = {
  accessMode: "import",
  queryRows: importModeQueryRows,

  async syncEntity() {
    return { created: 0, updated: 0, unchanged: 0, errors: 0 };
  },

  async discoverEntities() {
    return [];
  },

  async discoverColumns() {
    return [];
  },
};
```

### 4d. Registration

**File:** `apps/api/src/adapters/register.ts`

```typescript
import { ConnectorAdapterRegistry } from "./adapter.registry.js";
import { csvAdapter } from "./csv/csv.adapter.js";
import { sandboxAdapter } from "./sandbox/sandbox.adapter.js";

export function registerAdapters(): void {
  ConnectorAdapterRegistry.register("csv", csvAdapter);
  ConnectorAdapterRegistry.register("sandbox", sandboxAdapter);
}
```

---

## 5. Auto-Provisioning on Signup

### Trigger

`ApplicationService.setupOrganization(owner)` — called from `WebhookService.syncUser()` when a new user is created via the Auth0 post-login webhook.

### Current Behavior

Creates (within a single transaction):
1. User record
2. Organization record (name: "My Organization")
3. OrganizationUser link record

### New Behavior

After step 3, within the **same transaction**, add:

#### Step 4: Look up sandbox connector definition

```typescript
const sandboxDef = await DbService.repository.connectorDefinitions.findBySlug("sandbox", tx);
```

If `sandboxDef` is `undefined`, log a warning and return early with the existing result. **Do not fail signup** — this handles test environments or edge cases where the seed has not run.

#### Step 5: Create sandbox connector instance

```typescript
const instanceModel = new ConnectorInstanceModelFactory()
  .create(systemId)
  .update({
    connectorDefinitionId: sandboxDef.id,
    organizationId: createdOrg.id,
    name: "Sandbox",
    status: "active",
    config: {},
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: { read: true, write: true, sync: false },
  });

const createdInstance = await DbService.repository.connectorInstances.create(
  instanceModel.parse(), tx
);
```

#### Step 6: Create default station

```typescript
const stationModel = new StationModelFactory()
  .create(systemId)
  .update({
    organizationId: createdOrg.id,
    name: "My Station",
    description: "Default organization sandbox station",
    toolPacks: ["data_query"],
  });

const createdStation = await DbService.repository.stations.create(
  stationModel.parse(), tx
);
```

#### Step 7: Link connector instance to station

```typescript
const stationInstanceModel = new StationInstanceModelFactory()
  .create(systemId)
  .update({
    stationId: createdStation.id,
    connectorInstanceId: createdInstance.id,
  });

await DbService.repository.stationInstances.create(
  stationInstanceModel.parse(), tx
);
```

#### Step 8: Set organization's default station

```typescript
await DbService.repository.organizations.update(
  createdOrg.id,
  { defaultStationId: createdStation.id },
  tx
);
```

#### Step 9: Return expanded result

```typescript
return {
  user: createdUser,
  organization: { ...createdOrg, defaultStationId: createdStation.id },
  organizationUser: createdOrgUser,
};
```

The return shape remains compatible — existing callers destructure `{ user, organization, organizationUser }`. The `organization` object now includes the populated `defaultStationId` field.

### New Imports

```typescript
import {
  ConnectorInstanceModelFactory,
  StationModelFactory,
  StationInstanceModelFactory,
} from "@portalai/core/models";
```

**File:** `apps/api/src/services/application.service.ts`

---

## 6. Transaction & Error Handling

- All provisioning steps (4–8) execute inside the existing `DbService.transaction()` block. If any step fails, the entire transaction rolls back — no orphaned records.
- Missing sandbox definition is a **soft failure**: log warning, return existing result. Signup succeeds without sandbox provisioning.
- `setupOrganization` is only called for genuinely new users (webhook service checks `findByAuth0Id` first). No risk of duplicate sandbox instances per org.
- Seed uses `upsertManyBySlug` with `ON CONFLICT (slug) DO UPDATE` — idempotent and safe to re-run.

---

## 7. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/models/connector-definition.model.ts` | Modify | Add `SandboxConnectorDefinition{Schema,Model,ModelFactory}` |
| `apps/api/src/utils/adapter.util.ts` | Create | `resolveColumns` + `importModeQueryRows` helpers |
| `apps/api/src/adapters/sandbox/sandbox.adapter.ts` | Create | Sandbox adapter (delegates queryRows to shared helper) |
| `apps/api/src/adapters/csv/csv.adapter.ts` | Modify | Refactor to use shared `importModeQueryRows` |
| `apps/api/src/adapters/register.ts` | Modify | Register `"sandbox"` adapter |
| `apps/api/src/services/seed.service.ts` | Modify | Add sandbox definition to seed array |
| `apps/api/src/services/application.service.ts` | Modify | Auto-provision sandbox instance + station on signup |

---

## 8. Verification

### Type Check
```bash
npm run type-check
```
Confirms dual-schema alignment between Zod models and Drizzle tables.

### Seed
```bash
cd apps/api && npm run db:seed
```
Verify both "csv" and "sandbox" definitions exist in `connector_definitions` table.

### Unit Tests
```bash
npm run test
```
Existing tests pass without regression. Specific areas to validate:
- CSV adapter still works after refactoring to shared helper
- `setupOrganization` creates the expected records when sandbox definition exists
- `setupOrganization` completes successfully when sandbox definition is absent (graceful fallback)

### Integration Verification
Trigger Auth0 webhook for a new user and verify the database contains:
1. `connector_instances` row with `connectorDefinitionId` matching sandbox slug and `status = "active"`
2. `stations` row with `toolPacks = ["data_query"]` and matching `organizationId`
3. `station_instances` row linking the connector instance to the station
4. `organizations` row with `defaultStationId` set to the station's ID
