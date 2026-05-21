# API connector — Phase 2 — Plan

**TDD-sequenced implementation of phase 2: widen the auth Zod schemas, ship the `applyAuth` util, wire it into the adapter, add `testConnection` to the shared `ConnectorAdapter` interface plus a route + `RestApiAdapter` implementation, and upgrade the workflow's BasicsStep + EndpointsStep so users can configure credentials and dry-run an endpoint before committing.**

Spec: `docs/API_CONNECTOR_PHASE_2.spec.md`. Phase 1 spec + plan: `docs/API_CONNECTOR_PHASE_1.{spec,plan}.md`.

Seven slices, each behind a green test suite. The first three slices are backend-only and don't expose new modes to users (the workflow still presents only `none` as enabled). Slice 5 is the de-facto activation of phase 2 — the BasicsStep dropdown lights up the new modes.

Run tests with the same commands as phase 1.

The slices are sequenced so that:

- **Slice 1** widens the Zod auth schemas + introduces `ApiCredentialsSchema` in `@portalai/core`. Leaf change.
- **Slice 2** lands the `applyAuth` util in `apps/api`. Leaf — used by nothing yet.
- **Slice 3** integrates `applyAuth` into the existing `syncInstance` path; phase-1 adapter tests gain auth scenarios; `assertSyncEligibility` step 2 starts firing for non-`none` modes.
- **Slice 4** lands `testConnection` on the adapter interface, the `RestApiAdapter` implementation, and the shared route. Includes the parallel widening of `toPublicAccountInfo` (signature change on the interface).
- **Slice 5** wires up the frontend BasicsStep: dropdown enables all four modes, per-mode credentials sub-forms render and validate. This is when users first see the new modes.
- **Slice 6** lands the EndpointsStep "Test" button + `EndpointTestDialog`. Users can dry-run any endpoint before commit.
- **Slice 7** wires `toPublicAccountInfo` so the connector card chip shows the baseUrl; small seed-row tweak if `authType` value needs to change.

After every slice, the repo type-checks, the existing test suite is green, and unused-pre-slice-5 modes remain inaccessible from the UI.

---

## Slice 1 — Widen Zod auth schemas + add `ApiCredentialsSchema`

Leaf change to `@portalai/core`. Schemas widen, new credentials schema lands. Nothing imports the new arms yet.

**Files**

- Edit: `packages/core/src/models/api-connector.model.ts` — extend `ApiAuthConfigSchema`, add `ApiCredentialsSchema`.
- Edit: `packages/core/src/__tests__/models/api-connector.model.test.ts` — new cases.
- Edit: `packages/core/src/models/index.ts` — re-export `ApiCredentialsSchema`, `ApiCredentials`.

**Steps**

1. **Write the new model cases:**
   1. `ApiAuthConfigSchema.parse({ mode: "apiKey", keyName: "X-API-Key", placement: "header" })` succeeds.
   2. `ApiAuthConfigSchema.parse({ mode: "apiKey", keyName: "", placement: "header" })` fails (keyName min 1).
   3. `ApiAuthConfigSchema.parse({ mode: "apiKey", keyName: "x", placement: "form" })` fails (placement enum).
   4. `ApiAuthConfigSchema.parse({ mode: "bearer" })` succeeds.
   5. `ApiAuthConfigSchema.parse({ mode: "basic" })` succeeds.
   6. `ApiCredentialsSchema.parse({ mode: "none" })` succeeds.
   7. `ApiCredentialsSchema.parse({ mode: "apiKey", value: "abc" })` succeeds; empty value fails.
   8. `ApiCredentialsSchema.parse({ mode: "bearer", token: "tok" })` succeeds.
   9. `ApiCredentialsSchema.parse({ mode: "basic", username: "u", password: "p" })` succeeds.
   10. `ApiCredentialsSchema.parse({ mode: "bearer", token: "" })` fails.
   11. `ApiCredentialsSchema.parse({ mode: "apiKey" })` fails (missing value).
   Run; all fail.

2. **Author the widened schemas** per the phase-2 spec.

3. **Run focused tests.** `npx jest packages/core/src/__tests__/models/api-connector.model.test.ts`. All green.

4. **Lint + type-check.** Clean. Note: the phase-1 adapter unit tests will start showing TypeScript warnings about exhaustive checks if `auth.mode` switches don't cover the new arms — fix the warnings by adding default branches that raise (the phase-1 adapter code itself doesn't switch on mode yet, so this should be a no-op).

**Done when:** cases 1–11 pass; no other file references the new arms; phase-1 tests still pass.

---

## Slice 2 — `applyAuth` util

Leaf change in `apps/api`. Pure function, no I/O, fully unit-testable.

**Files**

- New: `apps/api/src/adapters/rest-api/auth.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/auth.util.test.ts`

**Steps**

1. **Write the util tests.** Cases:
   1. `none` mode + null credentials → passthrough (url and init unchanged).
   2. `apiKey` + `placement: "header"` → header added; url unchanged.
   3. `apiKey` + `placement: "query"` → query param appended; existing query params preserved.
   4. `apiKey` + `placement: "query"` against a url already containing the same param → the auth one wins (or: error? Decision in implementation; tested either way).
   5. `bearer` → `Authorization: Bearer <token>` added; existing Authorization (if any) is overwritten.
   6. `basic` → `Authorization: Basic <base64(user:pass)>`; the base64 is URL-safe (no newlines).
   7. `bearer` config + `apiKey` credentials → throws `REST_API_AUTH_FAILED` with `details.mismatch`.
   8. `apiKey` config + `null` credentials → throws `REST_API_AUTH_FAILED` with `details.reason: "missing"`.
   9. Existing headers in `init` are preserved (auth header merges, doesn't replace the whole object).
   Run; fail.

2. **Author `applyAuth`.** Pure. No `fetch`, no DB. Branches on `auth.mode`, switches on `credentials.mode` for assertion.

3. **Run focused tests.** `cd apps/api && npm run test:unit -- auth.util`. All 9 green.

4. **Lint + type-check.** Clean.

**Done when:** all 9 cases pass; no other file imports `applyAuth` yet.

---

## Slice 3 — Wire `applyAuth` into the adapter + activate eligibility check

Backend-only. `syncInstance` now applies auth to every request. `assertSyncEligibility` step 2 starts firing for non-`none` modes. Frontend still presents only `none` as enabled, so this is invisible to end users.

**Files**

- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — load credentials in `syncInstance`, call `applyAuth` before each `fetchJson`. Tighten `assertSyncEligibility`.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — new auth-case fixtures.
- Edit: `apps/api/src/adapters/rest-api/credentials.util.ts` (new) — small helper that decrypts + Zod-parses `ApiCredentialsSchema` from a `connector_instances.credentials` blob. Throws `REST_API_AUTH_FAILED` on malformed credentials.

**Steps**

1. **Write the new adapter cases:**
   1. `assertSyncEligibility` against an instance with `auth.mode: "bearer"` and empty credentials → `{ ok: false, reasonCode: "REST_API_MISSING_CREDENTIALS" }`.
   2. `assertSyncEligibility` against an instance with `auth.mode: "bearer"` and a populated token → `{ ok: true }` (assuming endpoints exist).
   3. `syncInstance` with `auth.mode: "apiKey"` (header placement) — the mock `fetch` receives the auth header.
   4. `syncInstance` with `auth.mode: "apiKey"` (query placement) — the mock `fetch` receives the URL with the appended param.
   5. `syncInstance` with `auth.mode: "bearer"` — Authorization header carries the token.
   6. `syncInstance` with `auth.mode: "basic"` — Authorization header carries the base64 user:pass.
   7. `syncInstance` against a mock that returns 401 → throws `REST_API_AUTH_FAILED` (not `REST_API_FETCH_FAILED`).
   8. `syncInstance` with `auth.mode: "bearer"` and decrypted credentials of mode `"apiKey"` (mismatch) → `REST_API_AUTH_FAILED` with `details.mismatch`.
   Run; fail (adapter doesn't apply auth or distinguish 401 yet).

2. **Author `credentials.util.ts`.** `loadCredentials(instance): Promise<ApiCredentials>` — decrypts `instance.credentials`, Zod-parses through `ApiCredentialsSchema`, throws `REST_API_AUTH_FAILED` on parse failure.

3. **Edit `syncInstance`** to:
   - Call `loadCredentials(instance)` once at the top of the run.
   - Branch the auth-mismatch check before the endpoint loop.
   - Call `applyAuth(url, init, instance.config.auth, credentials)` before each `fetchJson`.
   - When `fetchJson` raises and the underlying status is 401/403, rethrow as `REST_API_AUTH_FAILED` (the wrapper in `rest-api.fetch.util.ts` needs to surface status in the error so this is possible).

4. **Edit `fetchJson`** (from phase 1 slice 3) to attach `status` to the `details` object on its `REST_API_FETCH_FAILED` errors. Phase 2 doesn't yet attempt retries — it only categorizes errors more finely.

5. **Edit `assertSyncEligibility`:**
   - Step 2: if `auth.mode !== "none"`, call `loadCredentials`. Missing credentials → return `{ ok: false, reasonCode: "REST_API_MISSING_CREDENTIALS" }`.

6. **Run focused tests.** `cd apps/api && npm run test:unit -- rest-api.adapter`. All cases (phase-1 + phase-2) green.

7. **Lint + type-check.** Clean.

**Done when:** adapter applies auth correctly across all four modes; 401/403 → `REST_API_AUTH_FAILED`; mismatch detection works; phase-1 happy-path test still green.

---

## Slice 4 — `testConnection` on the interface, on the adapter, on the route

Cross-cutting interface change to `ConnectorAdapter`. Optional method plus `TestConnectionResult` shape. Shared route plus `RestApiAdapter` implementation.

**Files**

- Edit: `apps/api/src/adapters/adapter.interface.ts` — add `testConnection` (optional) + `TestConnectionParams` + `TestConnectionResult` types. Also widen `toPublicAccountInfo` to take `(credentials, instance)` — see slice 7.
- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — implement `testConnection`.
- Edit: `apps/api/src/routers/connector-instances.router.ts` — new `POST /:id/test-connection`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `REST_API_AUTH_FAILED`, `REST_API_MISSING_CREDENTIALS`, `TEST_CONNECTION_NOT_SUPPORTED`.
- New: `apps/api/src/__tests__/__integration__/routers/connector-instances.test-connection.integration.test.ts`.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — add `testConnection` cases.

**Steps**

1. **Write the route integration tests:**
   1. `POST /test-connection` against a `rest-api` instance with a valid endpoint + auth → `200` + `{ ok: true, sample: [...] }`.
   2. Same but with the endpoint configured against a mocked 200 returning malformed JSON → `200` + `{ ok: false, code: "REST_API_INVALID_JSON" }` (note: the route returns 200 even on `ok: false` — it's a successful invocation of a check that itself reported failure).
   3. Same but `endpointEntityId` doesn't exist on the instance → `200` + `{ ok: false, code: "REST_API_ENDPOINT_NOT_FOUND" }`.
   4. `POST /test-connection` against a Google Sheets instance (whose adapter doesn't implement `testConnection`) → `404` + `TEST_CONNECTION_NOT_SUPPORTED`.
   5. `POST /test-connection` against an unknown instance → `404` + `INSTANCE_NOT_FOUND`.

2. **Write the `RestApiAdapter.testConnection` unit tests:**
   1. Happy path: returns first 5 records when array length ≥ 5.
   2. Returns all records when array length < 5.
   3. 401 → `{ ok: false, code: "REST_API_AUTH_FAILED" }`.
   4. Non-array recordsPath → `{ ok: false, code: "REST_API_RECORDS_PATH_NOT_ARRAY" }`.

3. **Author the interface changes.** Add `TestConnectionParams`, `TestConnectionResult`, and the optional `testConnection` method to `ConnectorAdapter`. Add three new `ApiCode` entries.

4. **Author `RestApiAdapter.testConnection`** per the spec pseudocode. Reuses `loadCredentials`, `applyAuth`, `fetchJson`, `walkRecordsPath` — every leaf already exists.

5. **Author the route.** Resolve adapter via registry; 404 if not registered or doesn't implement `testConnection`; delegate; return the result verbatim (HTTP 200 for both `ok: true` and `ok: false` — the result *is* the body).

6. **Run focused tests.** Both unit and integration. All green.

7. **Lint + type-check.** Clean.

**Done when:** the route returns `TestConnectionResult` correctly across the case matrix; the adapter unit-tests cover the dry-run pipeline.

---

## Slice 5 — Frontend BasicsStep upgrade

The visible activation of phase 2. The BasicsStep dropdown enables all four modes; selecting a non-`none` mode reveals a mode-specific sub-form. Credentials are held in component state until commit.

**Files**

- Edit: `apps/web/src/workflows/RestApiConnector/BasicsStep.component.tsx` — enable all four dropdown options; render the right sub-form by mode.
- New: `apps/web/src/workflows/RestApiConnector/ApiKeyCredentialsForm.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/BearerCredentialsForm.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/BasicCredentialsForm.component.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts` — add per-mode credential validation.
- Edit: `apps/web/src/workflows/RestApiConnector/__tests__/BasicsStep.test.tsx` — new cases.
- New: `apps/web/src/workflows/RestApiConnector/__tests__/{ApiKey,Bearer,Basic}CredentialsForm.test.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/stories/*` — add stories for each credential form.

**Steps**

1. **Write the new BasicsStep + credentials-form tests:**
   - Each credentials form's `*UI`: renders the required fields, surfaces validation errors via `<FormAlert>` + `aria-invalid`, calls `onChange` on edits.
   - BasicsStep: switching the mode dropdown rerenders the sub-form; switching away clears the credentials state (avoid leaking a bearer token into apiKey state on re-toggle).
   - Validation util cases: per-mode required-field checks; `validateBasics` returns mode-specific errors when credentials incomplete.

2. **Author the credentials forms.** Each follows the Form & Dialog Pattern: `useDialogAutoFocus(open)` on the first field, `<FormAlert>` for server errors, `aria-invalid` + `helperText` for field errors.

3. **Edit BasicsStep**:
   - Remove the disabled-with-tooltip block for non-`none` options.
   - Conditionally render the right credentials sub-form keyed off `auth.mode`.
   - When the mode switches, reset `credentials` state to the new mode's default shape.

4. **Run focused tests.** `cd apps/web && npm run test:unit -- BasicsStep ApiKeyCredentialsForm BearerCredentialsForm BasicCredentialsForm`. All green.

5. **Storybook smoke.** Each new story renders without console errors.

6. **Lint + type-check.** Clean.

**Done when:** the BasicsStep walks through all four modes; credentials forms validate; switching modes doesn't bleed state.

---

## Slice 6 — EndpointsStep Test button + `EndpointTestDialog`

Per-endpoint dry run. The Test button on each endpoint row opens a dialog that calls `/test-connection` and renders the sample (or the error).

**Files**

- New: `apps/web/src/workflows/RestApiConnector/EndpointTestDialog.component.tsx` (container + `EndpointTestDialogUI`).
- Edit: `apps/web/src/workflows/RestApiConnector/EndpointsStep.component.tsx` — render a Test button per row; manage dialog open state.
- Edit: `apps/web/src/api/connector-instances.api.ts` (existing SDK file) — add `useTestConnection`.
- Edit: `apps/web/src/api/sdk.ts` — re-export.
- Edit: `apps/web/src/api/keys.ts` — no new key (mutation; not cached).
- New: `apps/web/src/workflows/RestApiConnector/__tests__/EndpointTestDialog.test.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/__tests__/EndpointsStep.test.tsx`

**Steps**

1. **Write the dialog tests:**
   1. Renders the spinner on mount; calls `useTestConnection.mutateAsync` exactly once.
   2. On success, renders a tabbed (or accordion-ed) preview of the sample records (formatted JSON, monospace).
   3. On failure, renders `<FormAlert>` with the error code + message + a "Edit endpoint" link.
   4. Cancel button calls `onClose`.

2. **Write the EndpointsStep additions:**
   1. Test button appears next to each endpoint row.
   2. Clicking opens the dialog with the right `endpointEntityId`.
   3. Closing the dialog returns focus to the Test button (accessibility).

3. **Author the dialog and the SDK hook.** `EndpointTestDialog` is a pure UI surface + a tiny container that fires the mutation. `useTestConnection` is a vanilla `useAuthMutation`.

4. **Edit EndpointsStep** to render the Test buttons and manage dialog state.

5. **Run focused tests.** `cd apps/web && npm run test:unit -- EndpointTestDialog EndpointsStep`. All green.

6. **Storybook smoke.** Dialog + EndpointsStep stories render.

7. **Lint + type-check.** Clean.

**Done when:** users can hit Test on any endpoint and see the result; the dialog handles both success and failure paths.

---

## Slice 7 — `toPublicAccountInfo` + seed-row polish

Connector card chip reflects the baseUrl. Tidy up the phase-1 `authType` placeholder if needed.

**Files**

- Edit: `apps/api/src/adapters/adapter.interface.ts` — widen `toPublicAccountInfo` signature to `(credentials, instance)`. Update existing adapter implementations (Google Sheets / Excel / Sandbox / File Upload) to ignore the new arg (no behaviour change).
- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — implement `toPublicAccountInfo` returning `{ name: instance.config.baseUrl }`.
- Edit: `apps/api/src/services/seed.service.ts` — review and adjust the `authType` value if appropriate after inspecting other seed entries (likely no edit; this is documented as a check, not a fixed change).
- Edit: tests on each adapter that already had `toPublicAccountInfo` tests — adjust signatures.

**Steps**

1. **Inspect** the existing `authType` values across `connector_definitions` seed rows. If `"apiToken"` (phase 1's placeholder) is consistent with the existing free-form values, leave it. If the convention is more specific (e.g., `"oauth2"`, `"none"`), update the seed entry.

2. **Widen the interface signature.** Change `toPublicAccountInfo?(credentials)` → `toPublicAccountInfo?(credentials, instance)`. Update every existing implementation to accept (and ignore) the new arg.

3. **Implement `RestApiAdapter.toPublicAccountInfo`.** Return `{ name: instance.config.baseUrl ?? "REST API" }`.

4. **Write tests** for the new adapter behavior and for the unchanged behavior of the other adapters.

5. **Manual smoke** (checklist):
   - Reseed (`npm run db:seed`).
   - Configure a REST API connector against an authenticated endpoint.
   - Confirm the connector card on the dashboard shows the baseUrl.
   - Confirm test-connection works from the workflow.

6. **Run all tests.** `npm run test:unit && npm run test:integration` from repo root. Clean.

7. **Lint + type-check.** Clean.

**Done when:** the manual smoke passes; the connector card chip is non-empty for the new modes; cross-adapter signature changes don't break any other adapter's tests.

---

## Cross-cutting notes

- **Encryption surface is unchanged.** Phase 2 doesn't introduce a new credential-encryption path. The existing `connectorInstances.credentials` plumbing (used today by Google Sheets / Excel OAuth) handles the API connector's secrets identically. The only difference is the *shape* of the decrypted blob, which the new `ApiCredentialsSchema` Zod-validates.
- **No new job type.** `connector_sync` is unchanged.
- **`assertSyncEligibility` runs early** — at sync enqueue time and at GET-by-id for the disabled-state affordance. Phase 2's credentials check rejects sync attempts on instances missing credentials before they hit the queue.
- **The interface widening for `toPublicAccountInfo`** is a touchpoint across all adapter files. Keep that slice narrow; do not bundle other adapter logic into it.
- **Logging discipline.** `applyAuth` runs at every fetch; do not log `init.headers` after it executes (would print the bearer token / API key). The phase-1 fetch logger should already redact, but verify before slice 3 lands.
