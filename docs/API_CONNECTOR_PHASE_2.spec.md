# API connector — Phase 2 — Spec

**Add the three non-interactive authentication modes — API key (header or query), bearer token, HTTP basic — and the per-endpoint "Test connection" affordance that exercises auth + endpoint reachability + recordsPath shape in one round-trip.** After this phase, the connector can ingest from authenticated APIs (most third-party SaaS, most private organization APIs); credentials are pasted into the workflow, encrypted into `connectorInstances.credentials`, and applied per-request by a single `applyAuth` util. The workflow's basics step lights up all four auth modes (none from phase 1 plus the three new ones), and each configured endpoint exposes a Test button that runs a dry sync against just that endpoint and renders the first record or the failure reason.

Discovery: `docs/API_CONNECTOR.discovery.md`. Phase 1 spec: `docs/API_CONNECTOR_PHASE_1.spec.md`.

Resolved phase-2 decisions:

- **Credentials shape.** Per-mode discriminated union stored in `connectorInstances.credentials` (encrypted text → JSON on decrypt). `apiKey` carries `{ value }`; `bearer` carries `{ token }`; `basic` carries `{ username, password }`; `none` is `null`.
- **Where each piece of auth lives.** `connectorInstances.config.auth` carries the *non-secret* part (mode, key name, header-vs-query placement). `connectorInstances.credentials` carries the *secret* part (the actual value/token/password). Splitting along the secrecy axis keeps everything that's safe to log in `config` and everything that needs encryption in `credentials`.
- **Test-connection placement.** Per-endpoint Test button in the EndpointsStep — fires a single request against the configured endpoint with auth applied, validates `recordsPath` resolves to an array, and returns the first record as a preview. Lives in the workflow before commit, so users iterate without persisting.
- **`toPublicAccountInfo` for non-OAuth auth.** Returns `{ name: <baseUrl> }` — there is no "account" for these auth modes, but the card chip should show *something*. Base URL is the most useful non-secret label for the connector instance.
- **`testConnection` on `ConnectorAdapter`.** New optional method on the shared interface (not just on `RestApiAdapter`). Other adapters that want a parallel "dry run" affordance can implement it; absent the method, the shared route 404s. Single cross-cutting change to `adapter.interface.ts`.

After this phase: a user can configure a connector against `https://api.github.com/users/<org>/repos` (bearer token) or `https://api.openai.com/v1/models` (apiKey header) or a privately-hosted endpoint behind HTTP basic. The Test button in step 2 of the workflow returns a parsed first record before commit. The card chip on the connector list view reads `https://api.github.com` (or similar) with the auth-mode glyph.

---

## Scope

### In scope

1. **Widen `ApiAuthConfigSchema`** in `packages/core/src/models/api-connector.model.ts` from `[none]` to `[none, apiKey, bearer, basic]`. Each non-`none` arm carries only the *non-secret* configuration; the secret lives in `connectorInstances.credentials`.
2. **`ApiCredentialsSchema`** — new discriminated union in the same file, modeling what's encrypted into `connectorInstances.credentials` per mode. `none` → `null`; `apiKey` → `{ mode, value }`; `bearer` → `{ mode, token }`; `basic` → `{ mode, username, password }`. The mode tag is duplicated in `config` and `credentials` to prevent decryption-time mismatches.
3. **`applyAuth` util** (`apps/api/src/adapters/rest-api/auth.util.ts`) — a single function `applyAuth(request, authConfig, credentials): { url, init }` that returns a new URL + RequestInit with the auth applied per mode. Pure; no I/O; trivially testable.
4. **Adapter integration.** `RestApiAdapter.syncInstance` (and the new `testConnection`) calls `applyAuth` before `fetchJson`. The adapter loads + decrypts credentials once per sync run; auth is applied per-endpoint within the loop.
5. **`testConnection` on `ConnectorAdapter`.** Optional method on the interface, signature `testConnection(instance, params): Promise<TestConnectionResult>`. `RestApiAdapter` implements it; other adapters omit it. The shared route 404s when the resolved adapter doesn't implement it.
6. **`TestConnectionResult` Zod schema** + matching `EntityDataPreview` type in `packages/core/src/contracts` — `{ ok: true, sample: unknown[] } | { ok: false, code: string, message: string, details?: Record<string,unknown> }`.
7. **Shared `POST /api/connector-instances/:id/test-connection` route** — accepts `{ endpointEntityId: string }` (REST-API-specific param; other adapters that implement `testConnection` can ignore it). Resolves the adapter through the registry, delegates, returns the `TestConnectionResult` verbatim.
8. **Adapter `assertSyncEligibility` step 2 activation.** Phase 1 hardcoded `none` so the credentials check always passed; phase 2 makes it real — if `auth.mode !== "none"` and credentials are missing/malformed, return `{ ok: false, reasonCode: "REST_API_MISSING_CREDENTIALS" }`.
9. **Frontend BasicsStep upgrade.** Auth dropdown becomes functional; selecting a non-`none` mode reveals a mode-specific sub-form. Credentials never leave the client until commit; the workflow holds them in component state, then submits them through the connector-instance create/update route (existing pattern — Google Sheets does the same with OAuth tokens).
10. **Frontend EndpointsStep upgrade.** Each endpoint row gets a "Test" button that opens a small dialog calling `sdk.connectorInstances.testConnection({ endpointEntityId })`, then renders the first sample record (or the error).
11. **`toPublicAccountInfo` implementation** on `RestApiAdapter`. Returns `{ name: <baseUrl> }` per the resolved decision. Phase 1 left this unimplemented (defaulted to `EMPTY_ACCOUNT_INFO`).
12. **Seed-row update.** Phase 1's `authType: "apiToken"` placeholder is replaced with `"multi"` (or whatever value the existing `connector_definitions.authType` strings actually use — TBD by inspection at implementation time; the field is free-form). Recorded here as a decision-point rather than a fixed value to avoid drift if `authType` semantics shift between now and implementation.
13. **New `ApiCode` entries** — `REST_API_AUTH_FAILED` (401/403 from upstream), `REST_API_MISSING_CREDENTIALS` (eligibility gate).
14. **Tests** — Zod unit tests for the widened schemas, `applyAuth` unit tests covering every mode, adapter unit tests covering auth + `testConnection`, route integration test, frontend tests for the BasicsStep + EndpointsStep changes.

### Out of scope

- **OAuth2** (client-credentials and authorization-code). v2 of the connector itself; deferred per discovery decision 3.
- **Pagination strategies** beyond `none`. Phase 3.
- **Request templating.** Phase 3.
- **Rate-limit / backoff** for 429 and 5xx with retries. Phase 3. (Phase 2 inherits phase 1's "raise on non-2xx" behavior; the new `REST_API_AUTH_FAILED` simply distinguishes 401/403 from other non-2xx for clearer UX copy.)
- **Probe + column discovery.** Phase 4.
- **Token refresh** for bearer tokens that expire. Out of v1 — users update the credential through the workflow's Edit flow if the token rolls.
- **Credential rotation UI.** Out of v1 — same workaround: edit the instance.

---

## Concept changes

### Splitting auth across `config` and `credentials`

The `connectorInstances` table already distinguishes `config` (plain JSONB) from `credentials` (encrypted text). Phase 2 uses both for the first time on the REST API connector:

- `config.auth.mode` — discriminator, always present, free to log.
- `config.auth.keyName` — for `apiKey` mode, the name of the header or query param. Free to log.
- `config.auth.placement` — for `apiKey` mode, `"header"` or `"query"`. Free to log.
- `credentials.value` — for `apiKey` mode, the secret value. Encrypted at rest; never logged.
- `credentials.token` — for `bearer` mode, the secret token.
- `credentials.username` / `credentials.password` — for `basic` mode.

The mode tag is duplicated in both blobs. The adapter rejects the request at runtime if the two modes disagree (`REST_API_AUTH_FAILED` with diagnostic copy "config / credentials auth-mode mismatch — re-save the connector to repair").

### `testConnection` is a dry sync

`testConnection` is a *single-endpoint* version of `syncInstance` that does not write to `entity_records`. The pipeline:

1. Resolve the configured endpoint by `entityEntityId` (404 if not present).
2. Load + decrypt credentials.
3. Build URL + RequestInit; apply auth.
4. Fetch; parse JSON; walk `recordsPath`; assert array.
5. Take the first record (or the array's first element); return `{ ok: true, sample: <first 5 records> }`.
6. Any failure short-circuits to `{ ok: false, code, message, details }`.

The function does not touch `entity_records`, does not enqueue a `connector_sync` job, does not invalidate any caches. It's a read-only validation hook for the workflow UI.

---

## Surface

### Widened `ApiAuthConfigSchema` and new `ApiCredentialsSchema`

**File:** `packages/core/src/models/api-connector.model.ts` (edit)

```ts
// ── Auth (config-side, non-secret) ────────────────────────────────────

export const ApiAuthNoneSchema = z.object({ mode: z.literal("none") });

export const ApiAuthApiKeySchema = z.object({
  mode: z.literal("apiKey"),
  keyName: z.string().min(1),                        // e.g. "X-API-Key" or "api_key"
  placement: z.enum(["header", "query"]),
});

export const ApiAuthBearerSchema = z.object({ mode: z.literal("bearer") });

export const ApiAuthBasicSchema = z.object({ mode: z.literal("basic") });

export const ApiAuthConfigSchema = z.discriminatedUnion("mode", [
  ApiAuthNoneSchema,
  ApiAuthApiKeySchema,
  ApiAuthBearerSchema,
  ApiAuthBasicSchema,
]);
export type ApiAuthConfig = z.infer<typeof ApiAuthConfigSchema>;

// ── Credentials (secret-side, encrypted at rest) ──────────────────────

export const ApiCredentialsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("apiKey"), value: z.string().min(1) }),
  z.object({ mode: z.literal("bearer"), token: z.string().min(1) }),
  z.object({
    mode: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
]);
export type ApiCredentials = z.infer<typeof ApiCredentialsSchema>;
```

`ApiEndpointConfigSchema` and `RestApiInstanceConfigSchema` are unchanged from phase 1.

### `applyAuth` util

**File:** `apps/api/src/adapters/rest-api/auth.util.ts` (new)

```ts
import type { ApiAuthConfig, ApiCredentials } from "@portalai/core/models";

export interface AuthAppliedRequest {
  url: string;          // possibly with auth query params appended
  init: RequestInit;    // possibly with auth headers added
}

/**
 * Apply the configured auth mode to a request. Pure function; no I/O.
 *
 * Throws an `ApiError(REST_API_AUTH_FAILED)` if `auth.mode` and
 * `credentials.mode` disagree, or if credentials are missing for a
 * non-`none` mode.
 */
export function applyAuth(
  url: string,
  init: RequestInit,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null
): AuthAppliedRequest {
  // none → passthrough.
  // apiKey + header → spread headers + add `[auth.keyName]: credentials.value`.
  // apiKey + query → parse url, append search param.
  // bearer → spread headers + add `Authorization: Bearer <token>`.
  // basic → spread headers + add `Authorization: Basic <base64(user:pass)>`.
}
```

### `testConnection` on `ConnectorAdapter`

**File:** `apps/api/src/adapters/adapter.interface.ts` (edit)

```ts
export interface TestConnectionParams {
  // REST-API-specific param. Other adapters that implement
  // testConnection can take their own param types via this loose
  // shape — the route forwards `req.body` verbatim.
  endpointEntityId?: string;
  [key: string]: unknown;
}

export type TestConnectionResult =
  | { ok: true; sample: unknown[] }
  | {
      ok: false;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

export interface ConnectorAdapter {
  // … existing methods …

  /**
   * Optional adapter-specific connectivity check. Called by the shared
   * /test-connection route to let users validate a config before
   * persisting it. Pure read; never enqueues a job or mutates state.
   */
  testConnection?(
    instance: ConnectorInstance,
    params: TestConnectionParams
  ): Promise<TestConnectionResult>;
}
```

### `RestApiAdapter.testConnection`

```ts
async testConnection(
  instance: ConnectorInstance,
  params: TestConnectionParams
): Promise<TestConnectionResult> {
  // 1. Resolve `params.endpointEntityId` via apiEndpointsRepo.findByEntityId.
  //    Missing entity → ok: false, code: REST_API_ENDPOINT_NOT_FOUND.
  // 2. Decode + validate credentials per the instance's auth.mode.
  // 3. Build URL + init; applyAuth; fetchJson.
  // 4. Walk recordsPath; assert array; slice first 5 → sample.
  // 5. Catch ApiError → return { ok: false, code, message, details }.
  // 6. Return { ok: true, sample }.
}
```

### Shared test-connection route

**File:** `apps/api/src/routers/connector-instances.router.ts` (edit — existing router)

Add:

```
POST /api/connector-instances/:id/test-connection
  Body:     TestConnectionParams              (free shape; forwarded to adapter)
  200:      TestConnectionResult              (verbatim from adapter)
  404:      { code: "TEST_CONNECTION_NOT_SUPPORTED" }  // adapter doesn't implement it
  404:      { code: "INSTANCE_NOT_FOUND" }
  401:      auth middleware
```

The route resolves the adapter via `ConnectorAdapterRegistry`, calls `testConnection` if present, and returns the result. No new code path inside the adapter registry.

### Frontend SDK additions

**File:** `apps/web/src/api/connector-instances.api.ts` (edit — existing)

- `useTestConnection()` — `useAuthMutation` against `POST /api/connector-instances/:id/test-connection`. Does **not** invalidate any caches (read-only operation). Consumed by the EndpointsStep.

### Frontend workflow changes

**Files:** `apps/web/src/workflows/RestApiConnector/` (edit)

- `BasicsStep.component.tsx`:
  - The disabled-with-tooltip non-`none` options become enabled.
  - When the user picks a non-`none` mode, the step renders a sub-form below the dropdown for the mode-specific fields. Component-level state holds the credentials until commit; never persisted to anything outside React state before submission.
  - Validation: per-mode required-field checks via `rest-api-validation.util.ts`. Credentials must be present before `onNext` enables.
- `EndpointsStep.component.tsx`:
  - Each row gains a Test button (icon + tooltip "Test this endpoint").
  - Clicking opens `EndpointTestDialog.component.tsx` (new file) that fires `sdk.connectorInstances.testConnection({ endpointEntityId })` on mount, then renders one of:
    - Loading state (spinner).
    - Success: a tabbed view showing the first 5 records (formatted JSON) + a "Looks good" close button.
    - Failure: `<FormAlert>` with the error code + message + `details`. "Edit endpoint" link to re-open the endpoint form.
- `BasicCredentialsForm.component.tsx`, `ApiKeyCredentialsForm.component.tsx`, `BearerCredentialsForm.component.tsx`: small per-mode inputs invoked by BasicsStep. Each follows the Form & Dialog Pattern from CLAUDE.md (FormAlert, validateWithSchema, useDialogAutoFocus on the first field).
- `utils/rest-api-validation.util.ts` (edit) — add per-mode validation for the credentials sub-form.

### New `ApiCode` entries

**File:** `apps/api/src/constants/api-codes.constants.ts` (edit)

| Code | When |
|---|---|
| `REST_API_AUTH_FAILED` | 401/403 response during sync or test-connection; also raised when `config.auth.mode` and `credentials.mode` disagree. 502 (upstream) for runtime, 500 (server) for the mismatch case. |
| `REST_API_MISSING_CREDENTIALS` | `assertSyncEligibility` rejects sync when auth is non-`none` and credentials are missing or empty. 409. |
| `TEST_CONNECTION_NOT_SUPPORTED` | The shared `/test-connection` route resolved an adapter that doesn't implement `testConnection`. 404. (Lives outside the `REST_API_*` namespace because it's a generic route concern.) |

### Updated `toPublicAccountInfo`

```ts
toPublicAccountInfo(
  credentials: Record<string, unknown> | null
): PublicAccountInfo {
  // Phase 2: we don't have an account identity for these auth modes;
  // surface the instance's baseUrl as the "account" label so the card
  // chip is non-empty. The route layer reads the connector instance
  // for us before calling this; we accept `credentials` and ignore it.
  return { name: this.instanceBaseUrl ?? "REST API" };
}
```

(Implementation note: the existing `toPublicAccountInfo` signature only takes `credentials`. To return baseUrl, the adapter needs access to the instance's `config`. Either widen the interface signature to pass `instance` alongside `credentials`, or have the adapter cache the baseUrl on its own state at registration. **Lean: widen the interface.** Tracked as a phase-2 cross-cutting interface change parallel to `testConnection`.)

---

## Failure modes

| Failure | Surface | User-facing copy |
|---|---|---|
| 401/403 from upstream | `REST_API_AUTH_FAILED` | "API rejected the credentials. Check your token / API key and re-save." |
| Bearer mode with empty token | `REST_API_MISSING_CREDENTIALS` (caught at eligibility) | "Add a bearer token before syncing." |
| `config.auth.mode` vs `credentials.mode` mismatch | `REST_API_AUTH_FAILED` with `details.mismatch: { configMode, credentialsMode }` | "Connector is in an inconsistent state — re-save it through the Edit flow." |
| Test-connection called against an instance whose adapter doesn't support it | `TEST_CONNECTION_NOT_SUPPORTED` | (Not user-visible; this is a developer error — the Test button only shows up on REST API instances.) |
| All phase-1 failure modes | Same as phase 1 | (Unchanged.) |

---

## What this phase doesn't decide

- **Rate-limit handling.** Phase 3. Phase 2 still raises on 429.
- **Credential rotation flow.** No new affordance; users update credentials by editing the connector instance through the same workflow (which now exposes credential fields).
- **Cross-adapter `testConnection` semantics.** Phase 2 adds the interface method but only `RestApiAdapter` implements it. The shared route 404s for adapters that don't. Whether Google Sheets / Excel / Sandbox eventually implement it is out of scope.
- **Audit logging for credential changes.** v1 doesn't audit; the existing `connectorInstances.updated` timestamp is the only signal.
- **Secrets-at-rest envelope encryption.** Reuses the existing `credentials` encryption mechanism unchanged.

---

## Next step

Phase 2 plan: `docs/API_CONNECTOR_PHASE_2.plan.md`. Slicing target: ~7 slices in the same shape as phase 1 — Zod schemas first (leaf), then `applyAuth` util (leaf), then adapter integration (auth applied in syncInstance), then `testConnection` + shared route, then frontend BasicsStep, then EndpointsStep + EndpointTestDialog, then `toPublicAccountInfo` polish.
