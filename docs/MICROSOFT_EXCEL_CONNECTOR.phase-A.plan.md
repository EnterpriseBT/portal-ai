# Microsoft Excel Cloud Connector — Phase A Plan

**OAuth client + credential plumbing + shared-infrastructure refactors.**

Spec: `docs/MICROSOFT_EXCEL_CONNECTOR.phase-A.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`.

This plan is sequenced TDD-first: each slice writes failing tests, then the production code that makes them pass. Slices are merge-shippable in order; do not interleave.

Run tests with `cd apps/api && npm run test:unit`, integration with `npm run test:integration` (per `feedback_use_npm_test_scripts` — never invoke jest directly).

---

## Slice 1 — Refactor: hoist callback HTML renderer

**Files**

- New: `apps/api/src/utils/oauth-callback-html.util.ts`.
- New: `apps/api/src/__tests__/utils/oauth-callback-html.util.test.ts`.
- Edit: `apps/api/src/routes/google-sheets-connector.router.ts` (delete inline `renderCallbackHtml`, import + call the util).

**Steps**

1. Write `oauth-callback-html.util.test.ts` covering: HTML body contains JSON-encoded `type: "google-sheets-authorized"` for slug=google-sheets and `type: "microsoft-excel-authorized"` for slug=microsoft-excel; refuses empty slug; preserves the existing data-testid for the connector instance id. Run; verify they fail (module doesn't exist).
2. Implement the util by extracting the body from the existing renderer, replacing the hard-coded `"google-sheets-authorized"` with a `slug` parameter, and JSON-stringify-ing the resulting payload.
3. Update `google-sheets-connector.router.ts` to import + call the util with `slug: "google-sheets"`. Delete the inline function.
4. Re-run unit tests + the existing google-sheets integration test (`google-sheets-connector.router.integration.test.ts`) — both must stay green.

**Done when:** new util passes its tests; google-sheets integration test still passes against the refactored router.

---

## Slice 2 — Refactor: shared cache-key helpers

**Files**

- New: `apps/api/src/utils/connector-cache-keys.util.ts`.
- New: `apps/api/src/__tests__/utils/connector-cache-keys.util.test.ts`.
- Edit: `apps/api/src/services/google-sheets-connector.service.ts` (replace `googleSheetsWorkbookCacheKey` call sites with `workbookCacheKey("google-sheets", id)`; delete the local helper).
- Edit: `apps/api/src/services/google-access-token-cache.service.ts` (replace inline `cacheKey` with `accessTokenCacheKey("google-sheets", id)`).
- Edit existing tests for the access-token cache and gsheets connector service to reference the new key format (`connector:access:google-sheets:…` and `connector:wb:google-sheets:…`).

**Steps**

1. Write `connector-cache-keys.util.test.ts`: format checks for both helpers across both slugs, refusal of empty inputs.
2. Implement the helpers (trivial).
3. Sweep call sites — single grep for `gsheets:wb:` / `gsheets:access:` / `googleSheetsWorkbookCacheKey`. Update production code first, then tests.
4. Run `npm run test:unit` from `apps/api`. The two existing google-sheets tests that asserted the old key strings must be updated; once green, this slice is done.

**Done when:** all `gsheets:` cache prefixes are gone; tests pass with the new prefix.

**Risk:** any in-flight Redis entries cached under the old prefix become orphans for one TTL window post-deploy. Acceptable — these caches are short-lived (workbook ~30 min, access token <1 h) and there is no persistent state to migrate.

---

## Slice 3 — Refactor: hoist OAuth popup hook

**Files**

- New: `apps/web/src/utils/oauth-popup.util.ts`.
- New: `apps/web/src/utils/__tests__/oauth-popup.util.test.tsx` (move + extend the existing google-sheets popup tests).
- Delete: `apps/web/src/workflows/GoogleSheetsConnector/utils/google-sheets-popup.util.ts`.
- Delete: `apps/web/src/workflows/GoogleSheetsConnector/utils/__tests__/google-sheets-popup.util.test.tsx`.
- Edit: `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsConnectorWorkflow.component.tsx` to call `useOAuthPopupAuthorize({ slug: "google-sheets", allowedOrigin: apiOrigin() })`.

**Steps**

1. Move the existing tests to the new path; rewrite the title/imports; add the slug parameter to every `useGooglePopupAuthorize(...)` call → `useOAuthPopupAuthorize({ slug, allowedOrigin })`.
2. Add new test cases: with `slug: "microsoft-excel"`, only `microsoft-excel-authorized` messages resolve; `google-sheets-authorized` messages are ignored.
3. Run; tests fail (module doesn't exist at the new path).
4. Implement `useOAuthPopupAuthorize` by lifting the existing implementation; replace the constants `MESSAGE_TYPE` / `POPUP_NAME` with values derived from `slug`.
5. Update `GoogleSheetsConnectorWorkflow.component.tsx` and its test (`__tests__/GoogleSheetsConnectorWorkflow.test.tsx` if present) to call the new hook.
6. Run `cd apps/web && npm run test:unit`. Green.

**Done when:** the popup hook lives in `utils/`, the google-sheets workflow uses it, the new file's tests cover both slugs.

---

## Slice 4 — `MicrosoftAuthService`

**Files**

- New: `apps/api/src/services/microsoft-auth.service.ts`.
- New: `apps/api/src/__tests__/services/microsoft-auth.service.test.ts`.
- Edit: `apps/api/src/environment.ts` (add the four new env vars with defaults; `MICROSOFT_OAUTH_TENANT` defaults to `"common"`).
- Edit: `apps/api/src/constants/api-codes.constants.ts` (add the eight `MICROSOFT_OAUTH_*` codes per the spec).

**Steps**

1. Write the env additions and api-codes additions first — they're trivial and Slice 4's tests reference them.
2. Write `microsoft-auth.service.test.ts` covering each method per the spec's test plan §3. Use `jest.unstable_mockModule` for `fetch` (per the existing `google-auth.service.test.ts` pattern). Cover at minimum:
   - `buildConsentUrl` URL host, path, and required params (including the configurable `MICROSOFT_OAUTH_TENANT`).
   - Scope set composition.
   - Embedded `state` round-trips through `verifyState`.
   - `exchangeCode` happy path (returns all fields including `idToken`).
   - `exchangeCode` `no_refresh_token` path (response missing `refresh_token`).
   - `refreshAccessToken` happy path returns the **new** `refreshToken` (this is the load-bearing assertion — the rotation pattern must not silently drop it).
   - `refreshAccessToken` `invalid_grant` path → throws `MicrosoftAuthError("refresh_failed", …)`.
   - `fetchUserProfile` happy path with `mail` populated.
   - `fetchUserProfile` with `mail: null` (personal MSA) → returned `email` is `null`, not `""`.
3. Run; verify failures (module doesn't exist).
4. Implement `MicrosoftAuthService` by templating `GoogleAuthService` — the diffs are the URLs, the scope list, the `prompt=select_account` (vs. `prompt=consent`), the `idToken` field in the exchange result, and the new-`refresh_token`-in-the-response handling for `refreshAccessToken`. Define `MicrosoftAuthError` with the same `kind` enum plus `no_refresh_token`.
5. Wire `verifyStateOrApiError`-style helper inside the service or leave for the connector service — match Google's split (helper lives in connector-service).
6. Re-run; green.

**Done when:** all `MicrosoftAuthService` unit tests pass.

---

## Slice 5 — `MicrosoftAccessTokenCacheService` (refresh-token rotation)

**Files**

- New: `apps/api/src/services/microsoft-access-token-cache.service.ts`.
- New: `apps/api/src/__tests__/services/microsoft-access-token-cache.service.test.ts`.

**Steps**

1. Write `microsoft-access-token-cache.service.test.ts` mirroring `google-access-token-cache.service.test.ts`, plus the new rotation cases:
   - **Cache hit / cache miss / TTL floor / single-flight** — copy from the Google test, swap to `connector:access:microsoft-excel:{id}`.
   - **Rotation persistence (the key new case):** `refreshAccessToken` mock returns `{ accessToken: "fresh", refreshToken: "ROTATED-NEW", expiresIn: 3600, scope: "..." }`. Assert that `connectorInstances.update` was called with credentials whose decrypted JSON has `refresh_token: "ROTATED-NEW"` and `lastRefreshedAt` close to `Date.now()`, while preserving `microsoftAccountUpn`, `microsoftAccountEmail`, `microsoftAccountDisplayName`, `tenantId`, and `scopes` from the pre-refresh credentials.
   - **Concurrent refresh idempotency:** two simultaneous `getOrRefresh` calls produce one upstream `refreshAccessToken` call (in-process single-flight) and one `connectorInstances.update` write (no double-rotation).
   - **`invalid_grant` path:** identical to Google — instance flipped to `status="error"`, original error re-thrown unchanged.
2. Run; verify failures.
3. Implement the service by templating `GoogleAccessTokenCacheService`. The single material divergence is `refreshAndStore` ALSO writes credentials back. Read the instance with `findById` (the repo decrypts), spread the existing credentials, overwrite `refresh_token` and `lastRefreshedAt`, then call `update` with the new (re-encrypted) credentials. Use the existing `crypto.util.ts` encrypt path — repository's `update` accepts the credentials object directly via the standard column path (matching Google's `credentials: credentials as unknown as string` pattern).
4. Re-run; green.

**Done when:** all unit tests pass, including the rotation persistence and idempotency cases.

**Risk:** `connectorInstances.update` failure mid-rotation leaves Redis with the new access token but the DB with the old refresh token. On the next miss, the cache will refresh against the old refresh token — which has just been consumed by the prior call — and fail with `invalid_grant`, marking the instance `status="error"`. This is acceptable failure-mode behaviour: the user reconnects via Phase E. Document the case in the service's header comment, and add a test that simulates the failure and asserts the next call surfaces a clean error.

---

## Slice 6 — `MicrosoftExcelConnectorService.handleCallback`

**Files**

- New: `apps/api/src/services/microsoft-excel-connector.service.ts` (only `handleCallback` for this slice; other methods land in Phase B).
- New: `apps/api/src/__tests__/services/microsoft-excel-connector.service.handleCallback.test.ts`.

**Steps**

1. Write the unit tests covering the spec §test-plan-#5 cases. Use `jest.unstable_mockModule` for the auth service, the connector-instances repository, and the connector-definitions repository.
2. Run; verify failures.
3. Implement `handleCallback`:
   - `verifyState` → on `OAuthStateError` throws `ApiError(400, MICROSOFT_OAUTH_INVALID_STATE)`.
   - `exchangeCode` → on `MicrosoftAuthError("exchange_failed" | "no_refresh_token")` throws `ApiError(502, MICROSOFT_OAUTH_EXCHANGE_FAILED | MICROSOFT_OAUTH_NO_REFRESH_TOKEN)`.
   - `fetchUserProfile` → on `MicrosoftAuthError("userinfo_failed")` throws `ApiError(502, MICROSOFT_OAUTH_USERINFO_FAILED)`.
   - Find-or-update via the new helper `findByOrgTenantAndUpn(organizationId, definitionId, tenantId, upn)` — implemented as a private static on the service (linear scan over `findByOrgAndDefinition` + post-decrypt match, matching Google's pattern).
   - On match: update credentials, `status: "active"`, `lastErrorMessage: null` (Phase E reconnect path).
   - On miss: insert new row with `name: "Microsoft 365 Excel ({upn})"`, `status: "pending"`, `config: null`, `enabledCapabilityFlags` cloned from the definition.
4. Add `MicrosoftExcelConnectorDefinitionModel` + factory in `packages/core/src/models/connector-definition.model.ts` (mirror of Google) so the seed step has the model available.
5. Add the seed entry in `apps/api/src/services/seed.service.ts` (`isActive: false`).
6. Re-run; green.

**Done when:** unit tests pass; `(org, tenant, upn)` uniqueness verified — the same UPN under two different tenant ids creates two separate rows.

---

## Slice 7 — Routers + wiring

**Files**

- New: `apps/api/src/routes/microsoft-excel-connector.router.ts` (two routers: `microsoftExcelConnectorRouter` for `/authorize`, `microsoftExcelConnectorPublicRouter` for `/callback`).
- Edit: `apps/api/src/index.ts` (or wherever routers are registered) to mount both.
- New: `apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts`.

**Steps**

1. Write integration tests covering the spec's test-plan §7-10:
   - `POST /authorize` → 200 + `{ url }` with hostname `login.microsoftonline.com`; embedded `state` decodes to caller identity.
   - `POST /authorize` without env → 500 `MICROSOFT_OAUTH_NOT_CONFIGURED`.
   - `GET /callback` happy path → DB row with decryptable credentials including `tenantId`; HTML body contains `type: "microsoft-excel-authorized"`.
   - Repeated callback for `(org, tenant, upn)` → same row id (UPDATE).
   - Same UPN, different tenant → two separate rows.
   - Stale state → 400 `MICROSOFT_OAUTH_INVALID_STATE`.
2. Run; verify failures (router not mounted yet).
3. Implement the router by templating `google-sheets-connector.router.ts`. Reuse `mapMicrosoftAuthError` (parallel to `mapGoogleAuthError`). The callback handler imports `renderOAuthCallbackHtml({ slug: "microsoft-excel", … })`.
4. Mount both routers in the app entry — protected under `protectedRouter`, public on the app.
5. Re-run; green.

**Done when:** integration tests pass; manual curl/Postman dance produces a `connector_instances` row.

---

## Slice 8 — Frontend SDK stubs (no UI)

The workflow shell is Phase C, but Phase A wires the SDK and contracts so the integration of Phase B's API calls is friction-free. Two-line additions only.

**Files**

- New: `packages/core/src/contracts/microsoft-excel.contract.ts` (only the `Authorize` schemas for this slice; list/select/slice land in Phase B).
- Edit: `apps/web/src/api/microsoft-excel.api.ts` (new file, only `authorize()` for this slice).
- Edit: `apps/web/src/api/sdk.ts` (export `microsoftExcel`).
- Edit: `apps/web/src/api/keys.ts` (add `queryKeys.microsoftExcel.root`).

**Steps**

1. Write contract tests (`packages/core/src/__tests__/contracts/microsoft-excel.contract.test.ts`) for the authorize-response schema (mirror of `google-sheets.contract.test.ts` if it exists; otherwise a small new file with shape + parse-failure cases).
2. Write `apps/web/src/__tests__/api/microsoft-excel.api.test.ts` asserting `sdk.microsoftExcel.authorize` is callable and produces a `useAuthMutation` hook against `/api/connectors/microsoft-excel/authorize`.
3. Implement contracts → `microsoft-excel.api.ts` → SDK export → query keys.
4. Run web + core unit tests; green.

**Done when:** `sdk.microsoftExcel.authorize()` is callable from the frontend and the contract round-trips a sample payload.

---

## Slice 9 — Deployment plumbing

Non-code-but-load-bearing. Needs to land before any non-local environment can exercise the OAuth dance.

**Files**

- Edit: `infra/backend.yml` — add `MicrosoftOauthClientId`, `MicrosoftOauthClientSecret` (Secrets Manager ARN), `MicrosoftOauthRedirectUri`, `MicrosoftOauthTenant` parameters; pass through to the API task definition env.
- Edit: `infra/deploy-dev.yml` — supply matching values from SSM / Secrets Manager.
- Manual / out-of-repo: register the dev redirect URI (`https://api-dev.portalsai.io/api/connectors/microsoft-excel/callback`) in the Microsoft Entra app registration; create + populate the SSM and Secrets Manager entries; smoke-test in the dev env.

No automated tests; covered by the manual verification in the spec.

---

## Cross-slice checklist before declaring Phase A complete

- [ ] `npm run test:unit && npm run test:integration` green in `apps/api` and `apps/web`.
- [ ] `npm run lint && npm run type-check && npm run build` green at the monorepo root.
- [ ] No `gsheets:` cache prefixes remain in source (`grep -rn "gsheets:" apps/api/src` returns nothing).
- [ ] No `useGooglePopupAuthorize` references remain in source.
- [ ] `connector_definitions` seed includes `microsoft-excel` row with `is_active: false`.
- [ ] Manual OAuth dance against the dev environment produces a `pending` row with decryptable credentials including `tenantId`.
- [ ] Re-running the OAuth dance for the same `(org, tenant, upn)` updates the row in place; for the same UPN in a different tenant creates a new row.
