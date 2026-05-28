# API connector — Phase 1 — Spec

**End-to-end skeleton: register the `rest-api` connector definition, land the `api_endpoint_configs` table, implement `RestApiAdapter` against a single in-scope path (`none` auth, no pagination, no probe, no templating, no rate-limit handling), and wire the frontend workflow so a user can configure an open-data endpoint and sync real records into `entity_records`.** After this phase, a Portal.ai user can point the connector at a public JSON endpoint, manually declare its columns through the existing field-mapping UI, run a sync, and see records appear — but only against endpoints that return all records in one response (no pagination) and require no authentication.

Discovery: `docs/API_CONNECTOR.discovery.md`. Resolved phase-1 decisions:

- **Auth modes in scope:** `none` only. The auth-helper module lands in phase 2.
- **Pagination strategies in scope:** `none` only (single-shot fetch). Page/offset, cursor, link-header land in phase 3.
- **Column discovery:** none. `discoverColumns` returns `[]`; the user adds field mappings through the existing `POST /api/field-mappings` route, declaring each column's `sourceField` and `normalizedKey` by hand. Probe + hybrid review lands in phase 4.
- **Request templating:** none. `{{cursor}}` / `{{pageNumber}}` only exist with non-none pagination, which is phase 3. Phase 1's fetch is a literal URL with literal headers.
- **Rate-limit handling:** none in phase 1's hot path. The adapter's `fetch` wrapper exists, but it just raises on `429` / `5xx`. Backoff + `Retry-After` honoring is phase 3.
- **Test-connection button:** deferred to phase 2. Phase 1's workflow has no test-connection affordance; the user finds out the endpoint is wrong by running a sync and reading the error toast.

After this phase: `seed_connector_definitions` has a `rest-api` row; `api_endpoint_configs` has one row per configured endpoint; `RestApiAdapter` is registered in `ConnectorAdapterRegistry`; a manual integration test against `https://api.coingecko.com/api/v3/coins/list` (or similar zero-auth open-data endpoint) succeeds end-to-end — sync completes, records land in `entity_records`, the wide table reflects the declared field mappings.

---

## Scope

### In scope

1. **`rest-api` connector definition seed** in `apps/api/src/services/seed.service.ts` — `authType: "apiToken"` (placeholder; phase 2 widens it), `capabilityFlags: { sync: true, read: true }`, `category: "api"`.
2. **`api_endpoint_configs` Drizzle table** — one row per `connector_entity_id`, holding the endpoint's per-entity request shape. Phase-1 columns reflect the phase-1 scope only: pagination is hardcoded `"none"` (CHECK constraint), method is `"GET"` or `"POST"`, no `body_template` populated yet (column exists but is nullable + unused).
3. **`RestApiInstanceConfig` Zod schema** in `packages/core/src/models/api-connector.model.ts` (new file) — captures `{ baseUrl, auth: { mode: "none" } }`. Phase 2 widens the `auth` discriminated union.
4. **`ApiEndpointConfig` Zod schema** in the same file — `{ path, method, recordsPath, idField?, headers?, queryParams? }`. Pagination is omitted from phase-1's schema (the table column exists for forward-compat but no Zod field surfaces it yet).
5. **`RestApiAdapter`** (`apps/api/src/adapters/rest-api.adapter.ts`) — implements `queryRows`, `discoverEntities`, `discoverColumns` (returns `[]`), `syncInstance`, `assertSyncEligibility`. Single-shot `fetch`; no pagination loop; no templating substitution.
6. **API routes for endpoint CRUD** (`apps/api/src/routers/api-endpoints.router.ts`) — `POST` (create entity + config row in one tx), `GET` (list), `GET /:entityId` (detail), `PATCH /:entityId` (update config), `DELETE /:entityId` (soft-delete both). Mounted at `/api/connector-instances/:id/api-endpoints`.
7. **`api_endpoints` repository** (`apps/api/src/db/repositories/api-endpoints.repository.ts`) — wraps the joined read of `connector_entities` + `api_endpoint_configs`. Phase-1 surface: `findByInstance`, `findByEntityId`, `createWithEntity`, `updateConfig`, `softDeleteWithEntity`.
8. **Frontend workflow** (`apps/web/src/workflows/RestApiConnector/`) — four steps mirroring the existing connector pattern: (1) name + base URL + auth dropdown (only `none` enabled), (2) add endpoints (path / method / recordsPath / idField), (3) per-endpoint field mappings (links into the existing `FieldMappingsTable` module — no new component), (4) review + commit. No probe step in phase 1; field mappings are user-declared.
9. **Frontend SDK module** (`apps/web/src/api/api-connector.api.ts` + `apps/web/src/api/sdk.ts` edits) — `sdk.apiConnector.endpoints.list / get / create / update / delete`, all built on `useAuthQuery` / `useAuthMutation` per the existing pattern.
10. **`MAX_RESPONSE_BYTES` cap in `fetchJson`** (default 50 MB) — guards against OOM on unpaginated huge JSON blobs. Checked against `Content-Length` when present (fast path) and tracked against bytes received when absent (slow path for chunked responses). Above the cap, throws `REST_API_RESPONSE_TOO_LARGE`. Streaming JSON parse for genuinely-huge single responses is tracked separately as [#72](https://github.com/EnterpriseBT/portal-ai/issues/72).
11. **New `ApiCode` entries** — `REST_API_FETCH_FAILED`, `REST_API_INVALID_JSON`, `REST_API_RECORDS_PATH_NOT_FOUND`, `REST_API_RECORDS_PATH_NOT_ARRAY`, `REST_API_ENDPOINT_NOT_FOUND`, `REST_API_NO_ENDPOINTS_CONFIGURED`, `REST_API_RESPONSE_TOO_LARGE`.
12. **One Drizzle migration**, named `api_connector_phase_1`, that creates `api_endpoint_configs`.
13. **Tests** — unit tests for the adapter (mock the network fetch), integration tests for the repository + routes, a workflow component test for the four-step UI.

### Out of scope

- All other auth modes (`apiKey`, `bearer`, `basic`). Phase 2.
- All other pagination strategies. Phase 3.
- Request templating. Phase 3.
- Rate-limit / backoff handling. Phase 3.
- Probe + column discovery. Phase 4.
- "Test connection" button in the workflow. Phase 2.
- Drift detection on re-sync. Out of v1 entirely (the hybrid probe handles drift on the way in).
- OAuth2 modes. v2.
- Webhook-driven sync. Separate ticket.
- Push (writing back to the API). v2+, separate ticket.

---

## Concept changes

### Naming

- **API endpoint** = one configured `(connector_entity, api_endpoint_configs)` pair under a `connector_instance` whose definition slug is `rest-api`. Loosely equivalent to "one endpoint of an API." Always exactly 1:1 with a `connector_entity`.
- **Records path** = a dotted JSON path into the response body where the array of records lives. Examples: `""` (the response *is* the array), `"data"` (the response is `{ data: [...] }`), `"results.items"` (nested). Phase 1 supports literal dot-separated keys only; no array indexing or wildcards.
- **idField** = the JSON key inside each record whose value becomes the record's `sourceId` for reconciliation. Optional per Decision 8 — when unset, every sync replaces the prior cohort wholesale.
- **REST API connector instance config** = the `ConnectorInstance.config` JSON shape for `rest-api` definitions: `{ baseUrl: string, auth: ApiAuthConfig }`.

### How sync reconciles, in phase 1

Single-shot fetch returns the full record set. The adapter walks `recordsPath` to find the array, parses each record, and feeds it to the existing `entity_records` upsert pipeline:

- **`idField` set:** each record's `record[idField]` becomes its `sourceId`. The existing `(connector_entity_id, source_id)` unique index drives `created` / `updated` / `unchanged` / `deleted` accounting. Records absent from the new fetch are soft-deleted at the watermark.
- **`idField` unset:** the adapter generates a synthetic `sourceId` (`api:<runStartedAt>:<index>`) per incoming record. Because every sync produces fresh synthetic ids, the diff resolves to "every prior record deleted, every current record created" — full replacement.

The watermark + soft-delete plumbing is the same path Google Sheets and Excel use today; no new diff machinery is introduced.

---

## Surface

### `api_endpoint_configs` Drizzle table

**File:** `apps/api/src/db/schema/api-endpoint-configs.table.ts` (new)

```ts
import { pgTable, text, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Per-entity endpoint configuration for the REST API connector.
 * One row per connector_entity whose owning connector_instance points
 * at a `rest-api` connector definition.
 *
 * Phase 1 hard-codes `pagination = 'none'` via the CHECK constraint;
 * phase 3 widens the allowed values to ('none', 'pageOffset', 'cursor',
 * 'linkHeader') and adds the strategy-specific JSONB column.
 */
export const apiEndpointConfigs = pgTable(
  "api_endpoint_configs",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    path: text("path").notNull(),                       // e.g. "/api/v3/coins/list"
    method: text("method").notNull(),                   // "GET" | "POST"
    headers: jsonb("headers").$type<Record<string, string>>(),
    queryParams: jsonb("query_params").$type<Record<string, string>>(),
    bodyTemplate: text("body_template"),                // phase 1: always null
    pagination: text("pagination").notNull(),           // phase 1: always "none"
    paginationConfig: jsonb("pagination_config"),       // phase 1: always null
    recordsPath: text("records_path").notNull().default(""),
    idField: text("id_field"),                          // null → synthetic sourceId
  },
  (table) => [
    uniqueIndex("api_endpoint_configs_entity_unique")
      .on(table.connectorEntityId)
      .where(sql`deleted IS NULL`),
    check(
      "api_endpoint_configs_method_check",
      sql`${table.method} IN ('GET', 'POST')`
    ),
    check(
      "api_endpoint_configs_pagination_phase1_check",
      sql`${table.pagination} = 'none'`
    ),
  ]
);
```

Phase 3 drops `api_endpoint_configs_pagination_phase1_check` and rewrites it as a broader `IN (...)` constraint.

### Zod models

**File:** `packages/core/src/models/api-connector.model.ts` (new)

```ts
import { z } from "zod";

// ── Auth ─────────────────────────────────────────────────────────────
// Phase 1 only ships the `none` variant. Phase 2 widens to apiKey /
// bearer / basic by extending the discriminated union below.

export const ApiAuthNoneSchema = z.object({ mode: z.literal("none") });
export type ApiAuthNone = z.infer<typeof ApiAuthNoneSchema>;

export const ApiAuthConfigSchema = z.discriminatedUnion("mode", [
  ApiAuthNoneSchema,
]);
export type ApiAuthConfig = z.infer<typeof ApiAuthConfigSchema>;

// ── Instance config ──────────────────────────────────────────────────

export const RestApiInstanceConfigSchema = z.object({
  baseUrl: z.string().url(),
  auth: ApiAuthConfigSchema,
});
export type RestApiInstanceConfig = z.infer<typeof RestApiInstanceConfigSchema>;

// ── Endpoint config ──────────────────────────────────────────────────
// Pagination is *not* a field here in phase 1 — the table CHECK
// enforces 'none' and surfaces no choice. Phase 3 adds a discriminated
// `pagination` union to this schema.

export const ApiEndpointConfigSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  recordsPath: z.string().default(""),
  idField: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
});
export type ApiEndpointConfig = z.infer<typeof ApiEndpointConfigSchema>;
```

### `RestApiAdapter`

**File:** `apps/api/src/adapters/rest-api.adapter.ts` (new)

```ts
export class RestApiAdapter implements ConnectorAdapter {
  constructor(
    private readonly deps: {
      apiEndpointsRepo: ApiEndpointsRepository;
      entityRecordsService: EntityRecordsService;        // existing
      connectorInstancesRepo: ConnectorInstancesRepository; // existing
      fetch?: typeof globalThis.fetch;                   // injected for tests
    }
  ) {}

  async queryRows(
    instance: ConnectorInstance,
    query: EntityDataQuery
  ): Promise<EntityDataResult> {
    // Delegates to the shared entity-records reader — same path as
    // Google Sheets / Excel. No live API hit.
  }

  async discoverEntities(
    instance: ConnectorInstance
  ): Promise<DiscoveredEntity[]> {
    // Lists this instance's `connector_entities` joined with their
    // endpoint configs. Returns `{ key, label }` per entity.
  }

  async discoverColumns(
    _instance: ConnectorInstance,
    _entityKey: string
  ): Promise<DiscoveredColumn[]> {
    // Phase 1: no discovery. User adds field_mappings manually.
    return [];
  }

  async syncInstance(
    instance: ConnectorInstance,
    userId: string,
    progress?: (percent: number) => void
  ): Promise<SyncInstanceResult> {
    // 1. Resolve endpoint configs for the instance.
    // 2. For each endpoint: build the URL (baseUrl + path + queryParams),
    //    fetch, parse JSON, walk recordsPath, validate it's an array.
    // 3. For each record: derive sourceId (record[idField] or synthetic),
    //    feed into the existing entity_records upsert with the shared
    //    runStartedAt watermark.
    // 4. After all endpoints: soft-delete records with stale watermark.
    // 5. Return counts.
  }

  async assertSyncEligibility(
    instance: ConnectorInstance
  ): Promise<SyncEligibility> {
    // Check, in order (per Decision 9):
    //   1. ≥ 1 endpoint configured → REST_API_NO_ENDPOINTS_CONFIGURED.
    //   2. Auth credentials present *if* mode != 'none'.
    //      Phase 1 hardcodes `none` so this check always passes.
    //   3. No in-flight sync → existing job-lock check.
  }
}
```

Registered in `apps/api/src/adapters/adapter.registry.ts` as `register("rest-api", new RestApiAdapter({...}))`.

### Routes

**File:** `apps/api/src/routers/api-endpoints.router.ts` (new), mounted at `/api/connector-instances/:instanceId/api-endpoints`.

| Method | Path | Body | Response | Error codes |
|---|---|---|---|---|
| `POST`   | `/`         | `{ key, label, config: ApiEndpointConfig }` | `{ entity: ConnectorEntity, config: ApiEndpointConfig }` | `ENTITY_KEY_CONFLICT`, `INSTANCE_NOT_FOUND`, `REST_API_INVALID_CONFIG` |
| `GET`    | `/`         | — | `{ endpoints: { entity, config }[] }` | `INSTANCE_NOT_FOUND` |
| `GET`    | `/:entityId`| — | `{ entity, config }` | `REST_API_ENDPOINT_NOT_FOUND` |
| `PATCH`  | `/:entityId`| `{ label?, config?: Partial<ApiEndpointConfig> }` | `{ entity, config }` | `REST_API_ENDPOINT_NOT_FOUND`, `REST_API_INVALID_CONFIG`, `ENTITY_LOCKED_BY_JOB` |
| `DELETE` | `/:entityId`| — | `{ ok: true }` | `REST_API_ENDPOINT_NOT_FOUND`, `ENTITY_LOCKED_BY_JOB` |

All routes validate `instance.connectorDefinition.slug === "rest-api"` and 404 otherwise (this prevents the routes from being used against Google Sheets / Excel instances).

### Seed row

**File:** `apps/api/src/services/seed.service.ts` (edit) — extend the `seedConnectorDefinitions` block:

```ts
{
  slug: "rest-api",
  display: "REST API",
  category: "api",
  authType: "apiToken",                   // placeholder; phase 2 widens
  configSchema: null,
  capabilityFlags: { sync: true, read: true },
  isActive: true,
  version: "0.1.0",
  iconUrl: null,
}
```

### New ApiCode entries

**File:** `apps/api/src/constants/api-codes.constants.ts` (edit)

| Code | When |
|---|---|
| `REST_API_FETCH_FAILED` | Network error during sync (DNS failure, timeout, connection reset, non-2xx response). 502 from sync route. |
| `REST_API_INVALID_JSON` | Response body isn't valid JSON. 502. |
| `REST_API_RECORDS_PATH_NOT_FOUND` | Walking `recordsPath` returned `undefined`. 502. |
| `REST_API_RECORDS_PATH_NOT_ARRAY` | Walking `recordsPath` returned a non-array value. 502. |
| `REST_API_ENDPOINT_NOT_FOUND` | Endpoint route lookup miss. 404. |
| `REST_API_NO_ENDPOINTS_CONFIGURED` | `assertSyncEligibility` short-circuit. 409. |
| `REST_API_INVALID_CONFIG` | Zod validation failure on endpoint config payload. 400. |
| `REST_API_RESPONSE_TOO_LARGE` | Response body exceeded `MAX_RESPONSE_BYTES` (default 50 MB). Either `Content-Length` was already too high (fast path) or the streaming byte counter tripped (slow path). 502. `details.bytesObserved` carries the count. Tracked in [#72](https://github.com/EnterpriseBT/portal-ai/issues/72) for the streaming-parse v2. |

### Frontend SDK additions

**File:** `apps/web/src/api/api-connector.api.ts` (new)

- `useApiEndpointsList(instanceId)` — `useAuthQuery` against `GET /api/connector-instances/:id/api-endpoints`.
- `useApiEndpoint(instanceId, entityId)` — `useAuthQuery` against `GET /:entityId`.
- `useCreateApiEndpoint()` — `useAuthMutation` against `POST /`. Invalidates `queryKeys.apiEndpoints.root` and `queryKeys.connectorEntities.root`.
- `useUpdateApiEndpoint()` — `useAuthMutation` against `PATCH /:entityId`. Same invalidations.
- `useDeleteApiEndpoint()` — `useAuthMutation` against `DELETE /:entityId`. Invalidates `apiEndpoints.root`, `connectorEntities.root`, `fieldMappings.root` (cascade per CLAUDE.md).

Re-exported through `apps/web/src/api/sdk.ts` as `sdk.apiConnector.endpoints.{list, get, create, update, delete}`. Query keys live in `apps/web/src/api/keys.ts` under `apiEndpoints`.

### Frontend workflow shape

**Folder:** `apps/web/src/workflows/RestApiConnector/`

- `RestApiConnectorWorkflow.component.tsx` — container + `RestApiConnectorWorkflowUI` pair (per the Component File Policy).
- `BasicsStep.component.tsx` — name + base URL + auth dropdown (only `none` enabled in phase 1; others are visible but disabled with a tooltip pointing at phase 2).
- `EndpointsStep.component.tsx` — list / add / edit endpoints. Embeds an `ApiEndpointForm.component.tsx` for the add/edit modal.
- `FieldMappingsStep.component.tsx` — for each endpoint, render the existing `FieldMappingsTable` module. Phase 4 replaces this step with the probe-then-review UI.
- `ReviewStep.component.tsx` — summary + commit button. Commit creates the instance + endpoints + field mappings in a sequence of API calls (no batch endpoint in phase 1 — keeps the surface small).
- `utils/rest-api-validation.util.ts` — Zod-driven validation per step, matching the `CSVConnector` precedent.
- `__tests__/` and `stories/` per the workflow module pattern.

---

## Failure modes

| Failure | Surface | User-facing copy |
|---|---|---|
| Endpoint returns 4xx/5xx during sync | `REST_API_FETCH_FAILED` + status code in `details` | "Endpoint returned HTTP 500. Check the endpoint URL or upstream service." |
| Endpoint returns invalid JSON | `REST_API_INVALID_JSON` | "Response wasn't valid JSON. Check that the endpoint returns `application/json`." |
| `recordsPath` lookup misses | `REST_API_RECORDS_PATH_NOT_FOUND` | "Couldn't find records at `<path>`. Try a different recordsPath." |
| `recordsPath` resolves to a non-array | `REST_API_RECORDS_PATH_NOT_ARRAY` | "`<path>` resolved to a `<typeof>`. Records must be an array." |
| User triggers sync on an instance with no endpoints | `REST_API_NO_ENDPOINTS_CONFIGURED` | "Add at least one endpoint before syncing." |
| Response body exceeds 50 MB | `REST_API_RESPONSE_TOO_LARGE` | "Response exceeded 50 MB. Enable pagination or reduce page size. (Streaming support is tracked in #72.)" |
| User PATCHes/DELETEs an endpoint mid-sync | `ENTITY_LOCKED_BY_JOB` (existing) | Standard locked-entity copy. |

All failures bubble through `next(new ApiError(code, ..., details))` per the API style guide.

---

## What this phase doesn't decide

- **Wide-table column types for synthetic IDs.** Phase 1's synthetic `sourceId` is a string; the wide-table reconciler handles string `sourceId` already. No new types needed.
- **Custom column on `entity_records.origin`.** Per Decision 10, records use the existing `sync` origin.
- **Job metadata changes.** Phase 1 reuses `connector_sync` unchanged. The existing `{ connectorInstanceId, organizationId, userId }` metadata is sufficient; no new job type.
- **Connector-card chip** content for the new connector. Reuse the generic "Last synced X ago" pattern; no `toPublicAccountInfo` until phase 2 introduces auth accounts.
- **Test-connection semantics.** Deferred to phase 2 once auth is meaningful.
- **`headers` and `queryParams`** in the endpoint config are typed on the table but ignored by the adapter in phase 1 (the single-shot fetch uses literal `baseUrl + path`). Phase 3 introduces actual templating against them. Phase 1 round-trips them through the API so future-phase configs can pre-populate them, but doesn't apply them at fetch time.

---

## Next step

Phase 1 plan: `docs/API_CONNECTOR_PHASE_1.plan.md`. Slicing target: ~7 slices, sequenced so each is independently green-testable (table + migration first, repository next, adapter behavior third with mocked network, routes fourth, frontend workflow fifth, end-to-end happy-path integration sixth, the seed row + adapter registration last so the connector is invisible until everything below is green).
