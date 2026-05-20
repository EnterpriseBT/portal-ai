# API connector — Discovery

**Issue:** [EnterpriseBT/portal-ai#65](https://github.com/EnterpriseBT/portal-ai/issues/65)

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

## The design space

The novel decisions for a REST API connector aren't in the adapter plumbing — they're in (1) how a single instance maps to entities, (2) how columns are discovered, (3) which auth modes ship in v1, and (4) how flexibly users can template requests.

### Decision 1 — Instance ↔ entity cardinality

How many endpoints does one connector instance own?

**A. One instance = one endpoint = one entity.** Simplest. The instance's `config` carries `{ baseUrl, path, method, queryParams, headers, bodyTemplate, paginationStrategy, recordsPath, idField }`. Discovery returns exactly one entity.

**B. One instance = one API (base URL + auth) = many endpoints/entities.** The instance carries just `{ baseUrl, auth }`; each entity carries its own endpoint config. Closer to how cloud-spreadsheet instances own multiple sheets.

| | A (1 endpoint) | B (many endpoints) |
|---|---|---|
| Instance config shape | Complex single JSON | Slim — base URL + auth |
| Adding endpoints | New instance per endpoint | Add entity under existing instance |
| Auth reuse | Re-enter per endpoint | Once per API |
| Discovery flow | None at instance time | "Add endpoint" UI per entity |
| Field-mapping reuse | Per-instance | Per-entity, shared instance |

**Lean: B.** It matches the spreadsheet-connector mental model (one Google account → many sheets) and avoids forcing users to re-authenticate for every endpoint of the same API. Slight extra UI complexity (an "endpoints" tab per instance) for substantial reuse.

### Decision 2 — Column discovery

**A. Probe-and-infer.** On entity creation, the connector fires one request against the configured endpoint, walks the JSON at `recordsPath`, and infers a column for each top-level scalar key of the first N records (types from `typeof`, nullability from union). Columns land in `connector_entity_columns` as discovered columns. User then maps them via the standard field-mapping flow.

**B. User declares.** No discovery. User adds columns by name + type, like the sandbox connector. Simpler backend, more user effort.

**C. Hybrid.** Probe to seed, user edits before committing.

| | A (probe) | B (declare) | C (hybrid) |
|---|---|---|---|
| First-run effort | Low | High | Low |
| Drift handling | Re-probe on sync? | Manual | Re-probe + diff |
| Nested objects | Punt (flatten? store as JSON?) | Punt | Punt |
| Implementation cost | Medium (probe + infer) | Trivial | Medium + diff UI |

**Lean: C.** A is too magical (silent column changes are confusing); B is too tedious for an API with 30+ fields. Hybrid mirrors how the region editor seeds a layout plan and lets the user correct it.

### Decision 3 — Auth modes for v1

The auth-services pattern (one per connector) suggests each auth mode becomes its own small service. Realistic scope:

- **none** — public APIs (most government / open data). Required.
- **API key** — header (`X-API-Key: …`) or query param. Required; most third-party APIs.
- **Bearer** — `Authorization: Bearer <static-token>`. Required; trivial extension of API key.
- **Basic** — `Authorization: Basic <base64>`. Required for older enterprise APIs.
- **OAuth2 client credentials** — server-to-server, token refresh handled by us. Deferrable.
- **OAuth2 authorization code** — user-delegated, browser popup. Deferrable; reuses the OAuth machinery from Google/Microsoft connectors but generic.

**Lean: ship `none + apiKey + bearer + basic` in v1.** All four are non-interactive — credentials get pasted into the connector-add modal, encrypted into `connectorInstances.credentials`, no popup flow needed. OAuth2 modes follow in a v2 once the v1 connector proves out the rest of the architecture.

### Decision 4 — Request templating

How much can a user customize per-request? Choices:

**A. Static only.** Headers, query params, body are fixed strings declared at config time.

**B. Templated with sync variables.** Allow `{{lastSyncAt}}`, `{{cursor}}`, `{{pageNumber}}` placeholders inside header/query/body. Sync substitutes them per-page.

**C. JS expressions.** Full user-controlled JS. Out of scope — security and sandboxing nightmare.

**Lean: B, with a fixed set of sync variables.** Required for pagination and for incremental sync (`?updatedSince={{lastSyncAt}}`). Limited substitution surface is safe; arbitrary user code is not.

### Decision 5 — Pagination strategies

REST APIs paginate three common ways:

1. **Page/offset** — `?page=N` or `?offset=N&limit=M`; stop when an empty page returns.
2. **Cursor** — response carries `nextCursor`; pass it to the next request until null.
3. **Link header** — RFC 5988 `Link: <…>; rel="next"`.
4. **None** — single-shot endpoint returning all records.

The strategy is per-entity config (different endpoints in the same API may paginate differently). Implement all four — they're cheap individually and together cover ~all REST APIs.

## Tradeoff comparison

|  | Decision lean | Spread to spec |
|---|---|---|
| Instance ↔ entity | B (many endpoints / instance) | Yes — drives instance + entity table shape |
| Column discovery | C (probe → user edits) | Yes — drives an "import schema" step in the add-endpoint flow |
| Auth modes v1 | none, apiKey, bearer, basic | Yes — each auth mode = one small service module |
| Request templating | B (fixed substitution variables) | Yes — declare the variable surface |
| Pagination | All four strategies | Yes — per-entity config |

## Recommendation

Build a generic REST API connector with the leans above. Concretely:

1. **One adapter** registered as `rest-api` in `ConnectorAdapterRegistry`. Implements `syncInstance` by iterating the instance's entities, fetching each according to its pagination strategy, and feeding records through the existing field-mapping → `entity_records` pipeline.

2. **Instance config** = `{ baseUrl, auth: { mode, params } }`. Credentials portion (token, password) goes to encrypted `credentials`; non-secret portion (header name for API key, base URL) goes to `config`.

3. **Entity config** = stored on `connector_entities` via a new nullable JSONB field `sourceConfig` (or, if we want strict typing, a new `api_endpoint_configs` table keyed by `connectorEntityId`). Carries `{ path, method, headers, queryParams, bodyTemplate, pagination, recordsPath, idField }`.

4. **Frontend workflow** mirrors the spreadsheet workflows: step 1 = name + base URL + auth (with "Test connection" button), step 2 = add endpoints (one or more), step 3 = per-endpoint probe + column review, step 4 = review + commit. Each endpoint becomes one `connector_entity` with seeded columns + a default field-mapping draft.

5. **Sync** reuses the existing `connector_sync` job and processor. The adapter handles pagination loops, templating, and rate-limit backoff internally. No new job type.

This keeps the new code surface small: one adapter + one auth-helper module + one workflow + one optional `api_endpoint_configs` table. Everything else — sync queue, locking, field mappings, entity records, SSE — is reused as-is.

## Open questions

1. **Endpoint config — JSONB on `connector_entities` vs. new table?** Strict typing wins for queryability and schema migrations; JSONB wins for flexibility per pagination strategy. **Lean: new table `api_endpoint_configs` with one row per `connector_entity_id`.** The shape is stable enough (pagination is the only variant) that a column-per-field schema beats JSONB.

2. **Probe behavior on `discoverColumns`.** The probe fires a real HTTP request. What if the endpoint is rate-limited or slow on first hit? **Lean: cache the probe response for 60s by `connectorEntityId`** so step 3 of the workflow can re-render without re-probing.

3. **Sample-size for inference.** How many records do we sample to infer column types? **Lean: probe one page (or 25 records, whichever is smaller).** If different pages have different shapes, the user catches it during the review step.

4. **Nested / array fields.** A record like `{ id, name, tags: [...] }` — what becomes of `tags`? **Lean for v1: flatten to a JSONB column.** The wide-table mode already supports JSONB columns; the user can decide whether to project the array out later via a transform that doesn't exist yet. Mark as a follow-up.

5. **Rate limiting / backoff.** Many APIs return `429` or honor `Retry-After`. **Lean: respect `Retry-After`, plus exponential backoff (250ms → 8s, max 5 retries) on `5xx`.** Per-instance configurable rate cap is a v2 feature.

6. **Incremental sync.** Can the connector ask the API for "records since last sync" via `{{lastSyncAt}}`? **Lean: yes if the endpoint supports a filter param the user chooses to template.** If not, full re-fetch every sync — the existing diff machinery in `entity_records` (checksum-based) means a full re-fetch still produces correct created/updated/unchanged counts.

7. **`assertSyncEligibility`.** What invariants gate a sync? **Lean: auth credentials present + at least one endpoint configured + last sync not currently in flight** (lock model is already enforced by [[feedback_connector_domain_model]]).

8. **Custom column on `entity_records.origin`.** Today's enum is `sync / manual / portal`. Records from the API connector use `sync` — same as Google Sheets. No change needed.

## What this doesn't decide

- OAuth2 modes (client-credentials and authorization-code). Deferred to v2 once the v1 connector is in users' hands. The adapter contract leaves room for them without rework.
- Webhook-driven sync. v1 is poll-only via the existing `connector_sync` job. Webhooks would mean a new `api_webhook_received` job type, an HMAC-verification surface, and inbound HTTP routing — large enough to be its own ticket.
- Push capability (writing records back to the API). Out of scope; the connector ships `read + sync` only.
- A schema-drift UI specifically for API endpoints. The hybrid probe (decision 2C) covers it on the way in; re-probe on drift is a follow-up.
- GraphQL / gRPC / SOAP endpoints. v1 is JSON REST only.

## Next step

Write `docs/API_CONNECTOR.spec.md` (the contract — what the adapter, the new table, the seed row, and the workflow expose) and `docs/API_CONNECTOR.plan.md` (phased slices). Likely slicing: phase 1 = adapter + seed + table + minimal `none`-auth flow against one open-data endpoint, end-to-end; phase 2 = the other three auth modes; phase 3 = pagination strategies beyond "none"; phase 4 = probe + hybrid column discovery; phase 5 = templating + incremental sync. Each phase green-testable and shippable.
