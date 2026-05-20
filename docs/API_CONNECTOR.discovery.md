# API connector — Discovery

**Issue:** [EnterpriseBT/portal-ai#65](https://github.com/EnterpriseBT/portal-ai/issues/65)
**Status:** Decisions locked. Ready for `docs/API_CONNECTOR.spec.md`.

**Why this exists.** Portal.ai today ingests data through four connector kinds — file upload, Google Sheets, Microsoft Excel, and the sandbox. All four assume the source is either a file or a spreadsheet-shaped cloud document. A large class of real customer sources don't fit that shape: government open-data endpoints, third-party SaaS REST APIs, and internal organization APIs. A generic "REST API connector" lets users point Portal at any HTTP endpoint that returns JSON and have its records materialize into `entity_records` on the same sync cadence as every other connector.

## The current shape

### Connector machinery we plug into

The connector subsystem is already factored around an adapter interface and registry. New connector types do not need new processors, new job types, or new SSE channels — they implement an adapter and register it.

| Piece | File | What it gives us |
|---|---|---|
| `ConnectorDefinitionSchema` | `packages/core/src/models/connector-definition.model.ts:13` | Catalog row: `slug`, `display`, `authType`, `configSchema` (JSON), `capabilityFlags` |
| `ConnectorInstanceSchema` | `packages/core/src/models/connector-instance.model.ts:14` | Org-scoped instance with `config` (JSON), `credentials` (encrypted), `enabledCapabilityFlags` override |
| `ConnectorAdapter` interface | `apps/api/src/adapters/adapter.interface.ts` | `discoverEntities`, `discoverColumns`, `syncInstance`, `assertSyncEligibility`, `toPublicAccountInfo` |
| `ConnectorAdapterRegistry` | `apps/api/src/adapters/adapter.registry.ts` | Slug → adapter lookup; sync processor resolves through this |
| `connector_sync` job | `packages/core/src/models/job.model.ts:85`, `apps/api/src/queues/processors/connector-sync.processor.ts` | Metadata `{ connectorInstanceId, organizationId, userId }`; processor calls `adapter.syncInstance` and reports `{ created, updated, unchanged, deleted }` |
| `entity_records` + wide table `er__<entityId>` | `apps/api/src/db/schema/entity-records.table.ts` | Materialization target — raw `data` JSONB + typed wide columns |
| `field_mappings` | `apps/api/src/db/schema/field-mappings.table.ts` | Source column → column definition; primary key flag; reference fields |
| Per-connector auth services | `apps/api/src/services/google-auth.service.ts`, `microsoft-auth.service.ts` | Each handles its own OAuth code/refresh; credentials encrypted into `connectorInstances.credentials` |
| Frontend workflow shape | `apps/web/src/workflows/GoogleSheetsConnector/` | Four-step pattern: OAuth → pick source → region/columns → review + commit |

### Capability-flag semantics

`resolveCapabilities(definition, instance)` (`apps/api/src/utils/resolve-capabilities.util.ts:24`) treats the definition's flags as the ceiling and the instance's `enabledCapabilityFlags` as a narrowing override. Sync gates on `assertSyncEligibility`; write gates on `assertWriteCapability`. The API connector starts as `sync + read` only — write/push are out of scope.

### Schema discovery, today

Spreadsheet connectors defer schema discovery to the **layout-plan workflow** — `discoverEntities` / `discoverColumns` are called when the user opens the region editor, not at instance creation. Sandbox and file-upload return empty discovery and let the user define entities + columns through field mappings. The API connector has to pick its lane between these two precedents.

## Decisions

### 1. Instance ↔ entity cardinality — many endpoints per instance

One connector instance owns one API (base URL + auth) and many entities, each backed by its own endpoint. Mirrors the cloud-spreadsheet pattern (one Google account → many sheets), avoids re-authenticating per endpoint, and lets users add endpoints to an existing API without recreating credentials.

*Alternative considered:* one-instance-per-endpoint. Rejected — auth duplication, and awkward when the user wants to ingest multiple endpoints of the same API.

### 2. Column discovery — hybrid probe-then-review

On entity creation, the adapter probes the endpoint once, walks the JSON at `recordsPath`, and seeds column candidates from the top-level scalar keys of the first page. The user reviews and edits before commit. Same shape as how the layout-plan workflow seeds a region.

Tactical details:

- **Sample size:** one page, or 25 records, whichever is smaller. If shapes vary across pages, the user catches it in review.
- **Probe caching:** response cached for 60s keyed by `connectorEntityId`, so the review UI can re-render without re-firing the request.
- **Nested / array fields:** flattened to a JSONB column on the wide table. Projection-out (e.g. exploding a `tags` array into rows) is a follow-up; the wide-table mode already supports JSONB.

*Alternatives considered:* pure probe-and-infer (silent column changes confuse users); pure user-declare (tedious for APIs with 30+ fields).

### 3. v1 auth modes — none, API key, bearer, basic

All four are non-interactive: credentials are pasted into the connector-add modal, encrypted into `connectorInstances.credentials`, no popup flow. API key supports both header (`X-API-Key: …`) and query-param placement.

*Deferred to v2:* OAuth2 client-credentials, OAuth2 authorization-code. The adapter contract leaves room for them without rework.

### 4. Request templating — fixed substitution variables

Headers, query params, and body templates accept three placeholders — `{{lastSyncAt}}`, `{{cursor}}`, `{{pageNumber}}` — substituted by the adapter per page. No arbitrary expressions; the variable set is closed.

The closed set is what makes this safe to ship without a sandbox: every substitution is a string interpolation against a value the adapter controls, not user-supplied code.

### 5. Pagination — all four strategies, per-endpoint

Page/offset, cursor, link-header (RFC 5988), and none. Configured per-entity since different endpoints in the same API may paginate differently. Each strategy is small enough that implementing all four costs less than picking a subset and revisiting later.

### 6. Endpoint config storage — dedicated `api_endpoint_configs` table

One row per `connector_entity_id`. Strict columns for `path`, `method`, `headers` (JSONB), `queryParams` (JSONB), `bodyTemplate` (text), `pagination` (enum + strategy-specific JSONB), `recordsPath`, `idField`. The shape is stable enough that JSONB-on-`connector_entities` would only obscure it; strict columns also give us cheap queries for "which entities use cursor pagination?" type follow-ups.

### 7. Rate limiting / backoff — `Retry-After` + exponential backoff

Respect `Retry-After` on `429`. Exponential backoff `250ms → 8s`, max 5 retries on `5xx`. The adapter owns this internally; no new queue config. Per-instance configurable rate cap is a v2 feature.

### 8. Incremental sync — opt-in per endpoint

If the endpoint supports a "since" filter, the user templates `{{lastSyncAt}}` into the query or body. If not, full re-fetch every sync. The checksum diff in `entity_records` produces correct `created / updated / unchanged` counts in either case, so the choice is a performance lever, not a correctness one.

### 9. Sync eligibility — auth present + ≥1 endpoint + not in flight

`adapter.assertSyncEligibility` gates on: credentials present, at least one endpoint configured, no in-flight sync. The "no in-flight" check piggybacks on the existing entity-lock model (see `feedback_connector_domain_model`).

### 10. Record origin — `sync`

Records from this connector use the existing `sync` origin on `entity_records`, same as Google Sheets and Excel. No enum change needed; called out only so a future reader doesn't wonder.

## Architecture summary

1. **One adapter** registered as `rest-api` in `ConnectorAdapterRegistry`. Implements `syncInstance` by iterating the instance's entities, fetching each per its pagination strategy, and feeding records through the existing field-mapping → `entity_records` pipeline.

2. **Instance config** = `{ baseUrl, auth: { mode, params } }`. Credentials portion (token, password) goes to encrypted `credentials`; non-secret portion (header name for API key, base URL) goes to `config`.

3. **Entity config** = `api_endpoint_configs` row keyed by `connector_entity_id`. Carries `{ path, method, headers, queryParams, bodyTemplate, pagination, recordsPath, idField }`.

4. **Frontend workflow** mirrors the spreadsheet workflows: step 1 = name + base URL + auth (with "Test connection" button), step 2 = add endpoints (one or more), step 3 = per-endpoint probe + column review, step 4 = review + commit. Each endpoint becomes one `connector_entity` with seeded columns + a default field-mapping draft.

5. **Sync** reuses the existing `connector_sync` job and processor. The adapter handles pagination loops, templating, and rate-limit backoff internally. No new job type, no new SSE channel.

New code surface: one adapter + one auth-helper module + one workflow + one `api_endpoint_configs` table. Everything else — sync queue, locking, field mappings, entity records, SSE — is reused as-is.

## What this doesn't decide

- **OAuth2 modes** (client-credentials and authorization-code). Deferred to v2 once the v1 connector is in users' hands. The adapter contract leaves room for them without rework.
- **Webhook-driven sync.** v1 is poll-only via the existing `connector_sync` job. Webhooks would mean a new `api_webhook_received` job type, an HMAC-verification surface, and inbound HTTP routing — large enough to be its own ticket.
- **Push capability** (writing records back to the API). Out of scope; the connector ships `read + sync` only.
- **Schema-drift UI** specifically for API endpoints. The hybrid probe (decision 2) covers it on the way in; re-probe on drift is a follow-up.
- **GraphQL / gRPC / SOAP** endpoints. v1 is JSON REST only.

## Next step

Write `docs/API_CONNECTOR.spec.md` (the contract — adapter interface implementation, `api_endpoint_configs` table shape, seed row, workflow API surfaces) and `docs/API_CONNECTOR.plan.md` (phased TDD slices).

Likely slicing:

1. Adapter + seed + `api_endpoint_configs` table + minimal `none`-auth flow against one open-data endpoint, end-to-end.
2. The other three auth modes (API key, bearer, basic).
3. Pagination strategies beyond "none" (page/offset, cursor, link header).
4. Probe + hybrid column discovery.
5. Templating + incremental sync.

Each phase green-testable and shippable.
