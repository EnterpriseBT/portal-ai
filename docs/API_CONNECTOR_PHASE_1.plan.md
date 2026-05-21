# API connector — Phase 1 — Plan

**TDD-sequenced implementation of the phase-1 cut: `api_endpoint_configs` table + repository, Zod models, `RestApiAdapter` (none-auth + single-shot fetch), endpoint CRUD routes, frontend workflow + SDK, end-to-end happy path. Activation (seed row + adapter registry + connector catalog wiring) lands in the final slice so the connector is invisible to users until every slice below is green.**

Spec: `docs/API_CONNECTOR_PHASE_1.spec.md`. Discovery: `docs/API_CONNECTOR.discovery.md`.

The change is layered; seven slices, each behind a green test suite. Slices are ordered so each red→green loop tightens around one concern, the system stays compilable between slices, and merging any slice cannot half-expose the new connector.

Run tests with:

```bash
# from apps/api — never invoke jest directly (NODE_OPTIONS sets ESM)
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration

# from apps/web
cd apps/web && npm run test:unit

# whole-repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice follows the same loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. Run lint + type-check at slice boundary.
5. Move to the next slice.

The slices are sequenced so that:

- **Slice 1** lands the schema + migration + repository + new `ApiCode` entries — pure DB plumbing, no service code, no behaviour change.
- **Slice 2** lands the Zod models in `@portalai/core` — leaf-shaped; nothing imports them yet.
- **Slice 3** lands `RestApiAdapter` with unit tests that mock `fetch` — adapter is implemented end-to-end but registered nowhere.
- **Slice 4** lands the endpoint CRUD routes + router. Routes resolve the adapter through dependency injection (test-double); the router is mounted but unreachable from the frontend catalog yet.
- **Slice 5** lands the frontend SDK module + workflow scaffolding. The workflow component renders in isolation (Storybook + unit tests); no catalog entry directs users to it.
- **Slice 6** lands an end-to-end integration test that drives the full sync against a mocked open-data endpoint — exercises the adapter + routes + entity_records pipeline without UI.
- **Slice 7** activates: seeds the `rest-api` connector definition, registers `RestApiAdapter` in `ConnectorAdapterRegistry`, wires the connector catalog component to launch `RestApiConnectorWorkflow`. This is the "go live" slice; everything before it was dormant.

After every slice, the repo type-checks, the existing test suite is green, and the new connector is still invisible to end users until slice 7.

---

## Slice 1 — `api_endpoint_configs` schema + repository + error codes

The smallest diff. New table, new repo, seven new error-code constants. Nothing calls the repo yet.

**Files**

- New: `apps/api/src/db/schema/api-endpoint-configs.table.ts`
- New: `apps/api/src/db/repositories/api-endpoints.repository.ts`
- New: `apps/api/src/__tests__/__integration__/db/repositories/api-endpoints.repository.integration.test.ts`
- New: `apps/api/src/__tests__/__integration__/db/migrations/api_connector_phase_1.test.ts`
- New: Drizzle migration `<timestamp>_api_connector_phase_1.sql` (generated, then reviewed)
- Edit: `apps/api/src/db/schema/index.ts` — re-export `apiEndpointConfigs`.
- Edit: `apps/api/src/db/schema/zod.ts` — `createSelectSchema(apiEndpointConfigs)` + insert schema.
- Edit: `apps/api/src/db/schema/type-checks.ts` — bidirectional `IsAssignable` block.
- Edit: `apps/api/src/db/repositories/index.ts` — register `apiEndpoints`.
- Edit: `apps/api/src/services/db.service.ts` — bind `repository.apiEndpoints`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add the seven phase-1 `REST_API_*` codes.

**Steps**

1. **Write the integration tests (cases 1–9).** Each test seeds an org + connector_instance (slug `rest-api` — but the definition row doesn't exist yet, so use a raw insert) + connector_entity, then exercises the repo. Cases:
   1. `findByInstance` returns empty array when no endpoints configured.
   2. `findByInstance` returns a joined row after `createWithEntity`.
   3. `findByEntityId` returns the joined row; returns `null` for unknown entity.
   4. `updateConfig` mutates only the config columns; entity row untouched.
   5. `softDeleteWithEntity` soft-deletes both rows atomically.
   6. `createWithEntity` rejects when entity key collides org-wide (existing `connector_entities_org_key_unique`).
   7. The CHECK constraint refuses `method` values outside `('GET', 'POST')`.
   8. The CHECK constraint refuses `pagination` values other than `'none'`.
   9. Migration apply + rollback round-trip cleanly.
   Run; all fail (table does not exist).

2. **Author the table** per spec — `api_endpoint_configs` with the columns listed in the spec, plus `baseColumns`. Two CHECK constraints (`method IN ('GET', 'POST')`, `pagination = 'none'`), one partial unique index on `connector_entity_id` where `deleted IS NULL`.

3. **Generate the migration.** From `apps/api`: `npm run db:generate -- --name api_connector_phase_1`. Review the generated SQL — should contain only the `CREATE TABLE`, the two CHECKs, and the one index. Apply with `npm run db:migrate`.

4. **Author the repository.** Extends `Repository<typeof apiEndpointConfigs, ApiEndpointConfigSelect, ApiEndpointConfigInsert>`. Phase-1 surface:
   - `findByInstance(connectorInstanceId, opts?, client?)` — joins `connector_entities` ON `entity_id`, filters by instance, returns `{ entity, config }` pairs.
   - `findByEntityId(connectorEntityId, client?)` — single-row join lookup; returns `null` on miss.
   - `createWithEntity(input: { organizationId, connectorInstanceId, key, label, config }, actor, client?)` — opens a transaction (or accepts the caller's client), inserts the `connector_entities` row, then the `api_endpoint_configs` row, returns the joined pair.
   - `updateConfig(connectorEntityId, patch, actor, client?)` — updates only the config columns.
   - `softDeleteWithEntity(connectorEntityId, actor, client?)` — soft-deletes both rows in a transaction.

5. **Wire the Zod / type-checks / repo registration / error codes.** Standard plumbing. The eight new `ApiCode` entries (`REST_API_FETCH_FAILED`, `REST_API_INVALID_JSON`, `REST_API_RECORDS_PATH_NOT_FOUND`, `REST_API_RECORDS_PATH_NOT_ARRAY`, `REST_API_ENDPOINT_NOT_FOUND`, `REST_API_NO_ENDPOINTS_CONFIGURED`, `REST_API_INVALID_CONFIG`, `REST_API_RESPONSE_TOO_LARGE`).

6. **Run focused tests.** `cd apps/api && npm run test:integration -- api-endpoints`. All 9 cases green.

7. **Lint + type-check.** `npm run lint && npm run type-check` from repo root. Clean.

**Done when:** cases 1–9 pass; the migration round-trips; nothing else in the codebase references `apiEndpointConfigs` yet.

---

## Slice 2 — Zod models in `@portalai/core`

Pure leaf change. New file in `packages/core/src/models/`, exported through the package barrel. Nothing else changes.

**Files**

- New: `packages/core/src/models/api-connector.model.ts`
- New: `packages/core/src/__tests__/models/api-connector.model.test.ts`
- Edit: `packages/core/src/models/index.ts` — re-export `ApiAuthConfigSchema`, `ApiAuthConfig`, `RestApiInstanceConfigSchema`, `RestApiInstanceConfig`, `ApiEndpointConfigSchema`, `ApiEndpointConfig`.

**Steps**

1. **Write the model unit tests.** Cases:
   1. `ApiAuthConfigSchema.parse({ mode: "none" })` succeeds.
   2. `ApiAuthConfigSchema.parse({ mode: "apiKey", ... })` fails in phase 1 (only `none` ships).
   3. `RestApiInstanceConfigSchema.parse({ baseUrl: "https://example.com", auth: { mode: "none" } })` succeeds.
   4. `RestApiInstanceConfigSchema.parse({ baseUrl: "not-a-url", auth: { mode: "none" } })` fails.
   5. `ApiEndpointConfigSchema.parse({ path: "/x", method: "GET", recordsPath: "" })` succeeds.
   6. `ApiEndpointConfigSchema.parse({ path: "", method: "GET", recordsPath: "" })` fails (path required).
   7. `ApiEndpointConfigSchema.parse({ path: "/x", method: "PATCH", recordsPath: "" })` fails (only GET/POST).
   8. `ApiEndpointConfigSchema.parse({ path: "/x", method: "GET" })` succeeds; `recordsPath` defaults to `""`.
   Run; all fail (schemas don't exist).

2. **Author the models** per spec. Three schemas + their `z.infer` types. Discriminated union for auth (phase-1 has only the `none` arm, but the discriminator scaffolding is in place so phase 2 just adds arms).

3. **Wire the barrel export.**

4. **Run focused tests.** `npx jest packages/core/src/__tests__/models/api-connector.model.test.ts`. All 8 green.

5. **Lint + type-check.** Clean.

**Done when:** cases 1–8 pass; `import { RestApiInstanceConfigSchema } from "@portalai/core/models"` resolves; no other file references these symbols yet.

---

## Slice 3 — `RestApiAdapter` (unit-tested, mocked `fetch`)

The behavioral heart of the phase. Adapter is fully implemented and unit-tested in isolation against a mock `fetch`. Not registered in `ConnectorAdapterRegistry`; routes don't call it.

**Files**

- New: `apps/api/src/adapters/rest-api.adapter.ts`
- New: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts`
- New: `apps/api/src/adapters/rest-api.fetch.util.ts` — thin wrapper around `fetch` that the adapter consumes; injectable for tests.
- Edit: `apps/api/src/adapters/adapter.interface.ts` — no changes (existing interface is sufficient).

**Steps**

1. **Write the adapter unit tests.** Each test instantiates `RestApiAdapter` with a mock `apiEndpointsRepo` + mock `entityRecordsService` + a stub `fetch`. Cases:
   1. `discoverColumns` always returns `[]` (phase 1 has no probe).
   2. `discoverEntities` returns one `DiscoveredEntity` per joined-config row from `apiEndpointsRepo.findByInstance`.
   3. `assertSyncEligibility` returns `{ ok: false, reasonCode: "REST_API_NO_ENDPOINTS_CONFIGURED" }` when the instance has zero endpoints.
   4. `assertSyncEligibility` returns `{ ok: true }` when ≥ 1 endpoint and auth mode is `none`.
   5. `syncInstance` against a single endpoint with `recordsPath: ""` and a JSON array response: inserts one `entity_records` row per element with the watermark.
   6. `syncInstance` against an endpoint with `recordsPath: "data.items"`: walks the dotted path, finds the array, inserts records.
   7. `syncInstance` raises `REST_API_RECORDS_PATH_NOT_FOUND` when the path resolves to `undefined`.
   8. `syncInstance` raises `REST_API_RECORDS_PATH_NOT_ARRAY` when the path resolves to a non-array.
   9. `syncInstance` raises `REST_API_INVALID_JSON` when response body isn't parseable.
   10. `syncInstance` raises `REST_API_FETCH_FAILED` on non-2xx response or network error.
   11. `syncInstance` raises `REST_API_RESPONSE_TOO_LARGE` when the mock response advertises `Content-Length` > 50 MB (fast path).
   12. `syncInstance` raises `REST_API_RESPONSE_TOO_LARGE` when the mock streams more than 50 MB across chunks without a `Content-Length` (slow path).
   13. `syncInstance` with `idField` set: each record's `record[idField]` becomes its `sourceId`; second sync with one record dropped reports `deleted: 1`.
   14. `syncInstance` with `idField` unset: every sync generates synthetic ids (`api:<runStartedAt>:<index>`); second sync reports `created: N, deleted: N_prev`.
   15. `syncInstance` returns the `{ created, updated, unchanged, deleted }` tally.
   16. `queryRows` delegates to the shared entity-records reader and never hits the network.
   Run; all fail (adapter doesn't exist).

2. **Author `rest-api.fetch.util.ts`.** A function `fetchJson(url, init): Promise<{ status, body }>` that:
   - Throws `ApiError("REST_API_FETCH_FAILED", ..., { status, url })` on `!response.ok`.
   - Enforces `MAX_RESPONSE_BYTES` (module-level constant, default 50 * 1024 * 1024). If `Content-Length` is set and exceeds the cap, throw `REST_API_RESPONSE_TOO_LARGE` immediately with `details: { bytesObserved: contentLength, limit }` (fast path). Otherwise read the body via a streaming reader (e.g. `response.body.getReader()` or `for await (const chunk of response.body)`), accumulate bytes, and abort + throw the same error as soon as the running total exceeds the cap (slow path for responses without `Content-Length`).
   - Throws `ApiError("REST_API_INVALID_JSON", ..., { url })` if the accumulated text doesn't parse as JSON.
   - Returns `{ status, body }` otherwise.
   Phase 1 has no retry / backoff (phase 3). The cap exists to convert OOM into a clear configuration error; streaming JSON parse to lift the cap is tracked in [#72](https://github.com/EnterpriseBT/portal-ai/issues/72).

3. **Author the adapter.** Per the spec's pseudocode. Key helpers:
   - `walkRecordsPath(body, path): unknown` — dotted lookup. Empty string returns `body`. Throws `REST_API_RECORDS_PATH_NOT_FOUND` on miss.
   - `buildUrl(baseUrl, path, queryParams?): string` — joins baseUrl + path; appends `queryParams` as `URLSearchParams`. Trim trailing slash on baseUrl; ensure leading slash on path; never double-slash.
   - `deriveSourceId(record, idField | null, runStartedAt, index): string` — `record[idField]` (coerced to string) or `api:${runStartedAt}:${index}`.

4. **Run focused tests.** `cd apps/api && npm run test:unit -- rest-api.adapter`. All 16 cases green.

5. **Lint + type-check.** Clean.

**Done when:** cases 1–16 pass; `RestApiAdapter` compiles in isolation; no other file imports it yet.

---

## Slice 4 — Endpoint CRUD routes + router

The routes mount, accept requests, and call into the slice-1 repository. The adapter is *not* yet wired through these routes — they only manage configuration, not sync invocation (sync runs through the existing shared `/api/connector-instances/:id/sync` route).

**Files**

- New: `apps/api/src/routers/api-endpoints.router.ts`
- New: `apps/api/src/__tests__/__integration__/routers/api-endpoints.router.integration.test.ts`
- New: `apps/api/src/middleware/require-rest-api-instance.middleware.ts` — guards routes against being invoked on non-`rest-api` connector instances.
- Edit: `apps/api/src/app.ts` (or wherever routers mount) — register `apiEndpointsRouter` at `/api/connector-instances/:instanceId/api-endpoints`.

**Steps**

1. **Write the integration tests.** Cases (one per spec table row, plus guards):
   1. `POST /` with valid body creates entity + config; returns 201; persisted via repo.
   2. `POST /` with invalid Zod payload returns 400 / `REST_API_INVALID_CONFIG`.
   3. `POST /` against an instance whose definition slug isn't `rest-api` returns 404 (the middleware short-circuits).
   4. `POST /` with a duplicate org-wide entity key returns 409 / `ENTITY_KEY_CONFLICT`.
   5. `GET /` lists all endpoints for the instance.
   6. `GET /:entityId` returns the joined `{ entity, config }`; 404 / `REST_API_ENDPOINT_NOT_FOUND` on miss.
   7. `PATCH /:entityId` updates a subset of config fields; round-trip via GET reflects the patch.
   8. `PATCH /:entityId` with mid-sync entity-lock returns 409 / `ENTITY_LOCKED_BY_JOB` (existing job-lock middleware reused).
   9. `DELETE /:entityId` soft-deletes both rows; subsequent GET returns 404.
   Run; all fail (router doesn't exist).

2. **Author the middleware.** `requireRestApiInstance(req, res, next)`:
   - Reads `req.params.instanceId`.
   - Loads the instance with `connectorDefinition` joined.
   - 404s if instance not found OR if `definition.slug !== "rest-api"`.
   - Stashes the loaded instance on `req.locals.connectorInstance` for the route handlers.

3. **Author the router.** Routes per the spec table. Each handler:
   - Validates the payload through the slice-2 Zod schemas via `validateRequestBody` (existing helper).
   - Delegates to `repository.apiEndpoints.*`.
   - Wraps writes in the existing job-lock guard for `PATCH` / `DELETE`.
   - Logs at the start and end via the existing Pino route logger.

4. **Run focused tests.** `cd apps/api && npm run test:integration -- api-endpoints.router`. All 9 cases green.

5. **Lint + type-check.** Clean.

**Done when:** cases 1–9 pass; the router is mounted; existing test suite is unaffected.

---

## Slice 5 — Frontend SDK + workflow scaffolding (no catalog entry yet)

The workflow component is fully built and storybook-renderable, the SDK module is wired, but the connector catalog doesn't link to it — users can't reach it.

**Files**

- New: `apps/web/src/api/api-connector.api.ts`
- New: `apps/web/src/workflows/RestApiConnector/index.ts`
- New: `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/BasicsStep.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/EndpointsStep.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/FieldMappingsStep.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/ReviewStep.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/*.test.tsx` (one per step + the workflow container)
- New: `apps/web/src/workflows/RestApiConnector/stories/*.stories.tsx`
- Edit: `apps/web/src/api/keys.ts` — add `apiEndpoints: { root: [...], byInstance: (id) => [...] }`.
- Edit: `apps/web/src/api/sdk.ts` — re-export `sdk.apiConnector.endpoints.*`.

**Steps**

1. **Write the validation util tests** (`rest-api-validation.util.test.ts`). Cases:
   1. `validateBasics({ name, baseUrl, auth })` — required fields + URL format.
   2. `validateEndpoint({ path, method, recordsPath, idField })` — required path; method enum; recordsPath defaults to empty.
   3. Mirrors the validation per-step before allowing `onNext`. The util returns `FormErrors`; the workflow handles focus-first-invalid-field via the existing utility.
   Run; fail.

2. **Author the validation util.** Wraps `validateWithSchema` from `form-validation.util.ts` per the established pattern.

3. **Write the step-component tests.** Each `*UI` (pure) component test uses `render(<XStepUI {...props} />)` and drives behavior via props. Cases per step:
   - `BasicsStepUI`: renders fields; reports `onChange`; disabled auth options other than `none` show a tooltip.
   - `EndpointsStepUI`: renders the list; "Add endpoint" opens the form modal; submitting calls `onCreate`.
   - `ApiEndpointFormUI`: validation errors on invalid input; `Enter` submits; Cancel calls `onClose`.
   - `FieldMappingsStepUI`: embeds the existing `FieldMappingsTable` per endpoint; no new behavior.
   - `ReviewStepUI`: renders summary; "Commit" calls `onCommit` with the full draft.

4. **Author the step components and their `*UI` pair** per the Component File Policy. The container component (`RestApiConnectorWorkflow.component.tsx`) wires the SDK hooks and drives state.

5. **Write the SDK module tests.** Cases:
   1. `useApiEndpointsList(instanceId)` hits the right URL; respects auth.
   2. `useCreateApiEndpoint` invalidates `apiEndpoints.root` + `connectorEntities.root` on success.
   3. `useDeleteApiEndpoint` invalidates `apiEndpoints.root` + `connectorEntities.root` + `fieldMappings.root` on success.

6. **Author the SDK module.** Five hooks per the spec, each built on `useAuthQuery` / `useAuthMutation`. Wire query keys + sdk re-exports.

7. **Run focused tests.** `cd apps/web && npm run test:unit -- RestApiConnector`. All green.

8. **Storybook smoke.** `npm run storybook` (web) — the new stories render without console errors.

9. **Lint + type-check.** Clean.

**Done when:** the workflow renders in Storybook; SDK hooks compile and pass tests; no path from the existing connector catalog points at the new workflow yet.

---

## Slice 6 — End-to-end happy-path integration test

A single big integration test that exercises the full pipeline: configure an endpoint via the routes from slice 4, invoke the existing shared sync route, watch `entity_records` get populated. Network is mocked at the `fetchJson` level via DI.

**Files**

- New: `apps/api/src/__tests__/__integration__/connectors/rest-api.end-to-end.integration.test.ts`

**Steps**

1. **Write the test.** Sequence:
   1. Seed: org + user + a `rest-api` connector definition (raw insert, since slice 7 hasn't run yet) + a `connector_instances` row referencing that definition with `config = { baseUrl: "https://mock.example.com", auth: { mode: "none" } }`.
   2. Inject a stub `fetchJson` that returns `{ status: 200, body: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }] }` for the first sync and `{ ... [{ id: "a", name: "Alice (updated)" }, { id: "c", name: "Charlie" }] }` for the second.
   3. POST `/api/connector-instances/:id/api-endpoints` with `{ key: "users", label: "Users", config: { path: "/users", method: "GET", recordsPath: "", idField: "id" } }`.
   4. POST `/api/field-mappings` for `name → display_name` against the new entity.
   5. POST `/api/connector-instances/:id/sync` to enqueue the sync.
   6. Drain the queue (test harness exposes a `runQueuedJobs()` helper — reuse the existing one from Google Sheets connector tests).
   7. Assert `entity_records` for the entity has two rows with `sourceId in ("a", "b")` and the right data.
   8. Re-run sync with the second payload; assert one row updated, one created, one deleted.

2. **If the test harness doesn't yet allow injecting `fetchJson` at the adapter level,** wire DI through the adapter registry's factory (the registry already supports `register(slug, adapterInstance)`; tests can register a `RestApiAdapter` instance constructed with a stub fetch).

3. **Run focused test.** `cd apps/api && npm run test:integration -- rest-api.end-to-end`. Green.

4. **Lint + type-check.** Clean.

**Done when:** the end-to-end test passes deterministically; running it twice in a row produces identical results; the sync produces the documented counts.

---

## Slice 7 — Activation: seed row + adapter registry + connector catalog wiring

The "go live" slice. Adds the connector definition seed, registers the adapter, and wires the frontend connector catalog so users can discover and configure the new connector. After this slice, the feature is reachable end-to-end through the UI.

**Files**

- Edit: `apps/api/src/services/seed.service.ts` — add the `rest-api` connector definition entry per the spec.
- Edit: `apps/api/src/adapters/adapter.registry.ts` — `register("rest-api", new RestApiAdapter({ ... }))` with the wired-up dependencies.
- Edit: `apps/web/src/views/Connectors/*` (the connector catalog view — exact path TBD by Explore) — add an entry mapping `rest-api` → `RestApiConnectorWorkflow`.
- Edit: `apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts` (if it exists; otherwise no edit) — assert the new definition is seeded.
- New: `apps/web/src/__tests__/views/connector-catalog.test.tsx` — confirms the catalog renders the new card and clicking it launches the workflow.

**Steps**

1. **Write the catalog tests.** Cases:
   1. The connector-catalog component renders a card titled "REST API" with the right category.
   2. Clicking the card launches the `RestApiConnectorWorkflow`.

2. **Write a seed-service assertion test** (or extend the existing one). After `seed.run()`, `connector_definitions` has a row with `slug = "rest-api"` and the documented capability flags.

3. **Write an adapter-registry assertion test.** After bootstrapping the registry, `registry.get("rest-api")` returns an instance of `RestApiAdapter`.

4. **Implement the three wires:**
   - Add the seed entry.
   - Register the adapter (with the actual `apiEndpointsRepo`, `entityRecordsService`, `connectorInstancesRepo`, and `fetchJson` from `rest-api.fetch.util.ts`).
   - Add the catalog entry.

5. **Run full test suites.** `npm run test:unit && npm run test:integration` from repo root.

6. **Manual smoke** (documented as a checklist, executed by the implementer):
   - Boot the stack (`npm run dev`).
   - Open the app, navigate to "Add connector", confirm the REST API card appears.
   - Walk through the workflow against `https://api.coingecko.com/api/v3/coins/list` (or equivalent zero-auth JSON endpoint).
   - Run a sync; confirm `entity_records` populates and the wide-table view renders.

7. **Lint + type-check.** Clean.

**Done when:** the manual smoke passes; the new test cases green; all prior phase-1 tests still green; the PR is mergeable.

---

## Cross-cutting notes

- **No new job type.** Phase 1 reuses `connector_sync` unchanged. The existing processor (`connector-sync.processor.ts`) resolves the adapter through the registry and calls `syncInstance` — no edits there.
- **No new SSE channel.** The existing `/api/sse/jobs/:id/events` carries phase-1 sync progress.
- **No new entity-lock semantics.** The `ENTITY_LOCKED_BY_JOB` check at the route layer reuses the existing middleware; phase-1 endpoint mutations gate on the same lock model as Google Sheets / Excel.
- **Dual-schema discipline.** Slice 1 (table + drizzle-zod) and slice 2 (`@portalai/core` model) land in separate slices but the build will fail on slice 1 if `apiEndpointConfigs`' `createSelectSchema` doesn't compile — at slice 1 boundary the type-checks are slice-1-side only; slice 2 introduces the `@portalai/core` model and the cross-package assertion fires there. Run `npm run type-check` at the slice 1 and slice 2 boundaries to catch drift before it spreads.
- **Open-data smoke endpoint.** Use the same endpoint across every phase's manual smoke if possible — keeps a single end-to-end happy path well-known.
- **Phase-2 forward-compat.** The auth Zod schema's discriminated union, the `connector_definitions.authType` placeholder, and the workflow's disabled-auth-dropdown items all leave clean extension points for phase 2 — no rewrite needed when apiKey/bearer/basic arrive.
