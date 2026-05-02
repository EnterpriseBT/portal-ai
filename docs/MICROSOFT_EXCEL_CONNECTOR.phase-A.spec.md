# Microsoft Excel Cloud Connector — Phase A Spec

**OAuth client + credential plumbing + shared-infrastructure refactors.**

This spec covers the foundational slice: the Microsoft identity-platform OAuth dance, the access-token cache (with refresh-token rotation), the per-`(organization, tenantId, microsoftAccountUpn)` `ConnectorInstance` find-or-update, and the small generalization pass on three pieces of Google-flavoured infrastructure that the Excel connector will share.

After Phase A: a curl/Postman exercise of the consent → callback dance produces a `connector_instances` row with encrypted `credentials`, `config: null`, `status: "pending"`, and the connector definition is seeded `is_active: false` so the UI keeps the row hidden until Phase C lands.

Discovery doc: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`. Resolved open questions used by this spec:

- **Q3 (tenant scoping):** include `tenantId` in the credentials blob and key uniqueness on `(organization, tenantId, microsoftAccountUpn)`. Done in Phase A.
- **Q4 (state TTL):** leave at 5 min — no change to `oauth-state.util.ts`.

---

## Scope

### In scope

1. **Refactor pass** (must land first so subsequent slices use the shared surface):
   - Hoist `useGooglePopupAuthorize` to `apps/web/src/utils/oauth-popup.util.ts` as `useOAuthPopupAuthorize`, parameterized by `slug` (drives `popupName` and `messageType`).
   - Hoist `renderCallbackHtml` from `google-sheets-connector.router.ts` to `apps/api/src/utils/oauth-callback-html.util.ts`, parameterized by `slug`.
   - Rename cache keys: `gsheets:wb:{id}` → `connector:wb:google-sheets:{id}`, `gsheets:access:{id}` → `connector:access:google-sheets:{id}`. The Excel connector then mints `connector:wb:microsoft-excel:{id}` / `connector:access:microsoft-excel:{id}` from the same helper.
2. **`MicrosoftAuthService`** (`apps/api/src/services/microsoft-auth.service.ts`):
   - `buildConsentUrl({ userId, organizationId })` → consent URL targeting `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`, with `prompt=select_account`, `response_type=code`, scopes per discovery doc, signed `state` via the existing `oauth-state.util.ts`.
   - `exchangeCode({ code })` → POST to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`. Returns `{ accessToken, refreshToken, idToken, expiresIn, scope }`. Throws `no_refresh_token` when the response omits `refresh_token` (treated as a configuration error — `offline_access` scope was missing or the user declined).
   - `refreshAccessToken(refreshToken)` → returns `{ accessToken, refreshToken: NEW, expiresIn, scope }`. Note the refresh token field — Microsoft rotates on every call, so the new value MUST be persisted by the caller. On `invalid_grant` from upstream, throws `MicrosoftAuthError("refresh_failed", ...)`.
   - `fetchUserProfile(accessToken)` → GET `https://graph.microsoft.com/v1.0/me`, returns `{ upn, email, displayName, tenantId }` (decoded from `userPrincipalName`, `mail`, `displayName`, and the `id_token`'s `tid` claim respectively). `mail` may be null for personal MSAs — `email` is `null` in that case, never the empty string.
3. **`MicrosoftAccessTokenCacheService`** (`apps/api/src/services/microsoft-access-token-cache.service.ts`):
   - Same shape as `GoogleAccessTokenCacheService`: `getOrRefresh(connectorInstanceId)`, `__resetInflightForTests()`.
   - Cache key: `connector:access:microsoft-excel:{connectorInstanceId}` (via the renamed shared helper).
   - On every successful refresh, the service:
     1. Reads the instance, decrypts credentials, calls `MicrosoftAuthService.refreshAccessToken`.
     2. **Writes the new `refresh_token` back to `connector_instances.credentials`** (re-encrypted) along with `lastRefreshedAt: Date.now()`. Other credential fields (UPN, email, displayName, tenantId, scopes) are preserved.
     3. Sets the access token in Redis with TTL `expiresIn - 600s`, floored at 60s.
   - On `invalid_grant`: marks the instance `status="error"` with `lastErrorMessage`, re-throws (Phase E surfaces the Reconnect button from this state).
   - In-memory `inflight` Map de-dups concurrent misses inside a single process. Cross-process coordination is out of scope (same posture as Google).
4. **`MicrosoftExcelConnectorService.handleCallback`** (`apps/api/src/services/microsoft-excel-connector.service.ts`):
   - Verifies the signed `state` token via `verifyState`.
   - Calls `MicrosoftAuthService.exchangeCode`, then `MicrosoftAuthService.fetchUserProfile`.
   - Find-or-update by `(organizationId, definitionId, tenantId, upn)` — the tuple from Open Question 3.
   - Pending instances created here have `name: "Microsoft 365 Excel ({upn})"`, `status: "pending"`, `config: null`.
   - Returns `{ connectorInstanceId, accountInfo }` for the callback HTML to postMessage.
5. **Routers** (`apps/api/src/routes/microsoft-excel-connector.router.ts`):
   - `POST /api/connectors/microsoft-excel/authorize` — JWT-protected. Returns `{ url }`.
   - `GET  /api/connectors/microsoft-excel/callback?code&state` — JWT-unprotected. Returns the shared callback HTML (postMessage `type: "microsoft-excel-authorized"`).
6. **Connector definition seed** (`apps/api/src/services/seed.service.ts`): `slug: "microsoft-excel"`, `display: "Microsoft 365 Excel"` (Open Question 5), `category: "File-based"`, `authType: "oauth2"`, `isActive: false` (flipped to `true` in Phase C), capability flags `{ sync: true, read: true, write: false, push: false }`, icon URL TBD.
7. **`MicrosoftExcelConnectorDefinition*`** (`packages/core/src/models/connector-definition.model.ts`): mirror of `GoogleSheetsConnectorDefinition*`. Display "Microsoft 365 Excel".
8. **API codes** (`apps/api/src/constants/api-codes.constants.ts`):
   - `MICROSOFT_OAUTH_NOT_CONFIGURED`, `MICROSOFT_OAUTH_AUTHORIZE_FAILED`, `MICROSOFT_OAUTH_INVALID_STATE`, `MICROSOFT_OAUTH_EXCHANGE_FAILED`, `MICROSOFT_OAUTH_USERINFO_FAILED`, `MICROSOFT_OAUTH_DEFINITION_NOT_FOUND`, `MICROSOFT_OAUTH_REFRESH_FAILED`, `MICROSOFT_OAUTH_NO_REFRESH_TOKEN`.
9. **Environment** (`apps/api/src/environment.ts`):
   - `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`, `MICROSOFT_OAUTH_TENANT` (default `"common"`).
   - `backend.yml` / `deploy-dev.yml` get the SSM parameter (non-secret) + Secrets Manager ARN (secret) entries; new `SecretArnMicrosoftOauthClientSecret` parameter.

### Out of scope (subsequent phases)

- Workbook discovery / download (Phase B).
- Sheet-slice route — the route exists in Phase B because it depends on a cached workbook.
- Frontend workflow shell (Phase C).
- Sync (Phase D).
- Reconnect UX (Phase E — most of the wiring lives there; Phase A stops at "instance is marked status=error on `invalid_grant`").

---

## Credential blob shape

Encrypted into `connector_instances.credentials`:

```ts
{
  refresh_token: string,                    // rotates on every refresh — owned by the cache layer
  scopes: string[],                          // e.g. ["openid","profile","email","offline_access","User.Read","Files.Read.All"]
  microsoftAccountUpn: string,               // canonical identity, e.g. "alice@contoso.com"
  microsoftAccountEmail: string | null,      // graph `mail` — null for personal MSAs
  microsoftAccountDisplayName: string,
  tenantId: string,                          // graph `id_token.tid`; "9188040d-…" for personal MSA
  lastRefreshedAt: number                    // Date.now() updated by the cache service
}
```

Unique key for find-or-update: `(organizationId, connectorDefinitionId, tenantId, microsoftAccountUpn)`. A user with one personal MSA + one work account in two different tenants → two `ConnectorInstance` rows; the chip on each card disambiguates by UPN with the tenant id available in the metadata for tooltips.

`toPublicAccountInfo` returns:

```ts
{
  identity: microsoftAccountUpn,
  metadata: {
    email: microsoftAccountEmail,
    displayName: microsoftAccountDisplayName,
    tenantId
  }
}
```

---

## Refactor surface (the three generalizations)

### R1 — Hoisted OAuth popup hook

**New file:** `apps/web/src/utils/oauth-popup.util.ts`.

Exports `useOAuthPopupAuthorize({ slug, allowedOrigin })`. Same internals as `useGooglePopupAuthorize` (window.open inside the click handler, postMessage listener with origin allowlist, 5-minute timeout, `PopupClosedError`). The two parameterizations:

- `popupName` derived from slug: `${slug}-oauth`.
- `messageType` derived from slug: `${slug}-authorized`.

**Removed:** `apps/web/src/workflows/GoogleSheetsConnector/utils/google-sheets-popup.util.ts`. Its tests move to `apps/web/src/utils/__tests__/oauth-popup.util.test.tsx` and gain Excel-slug parameterized cases.

Per `feedback_no_compat_aliases`: no re-export under the old path. Update all callers.

### R2 — Hoisted callback HTML renderer

**New file:** `apps/api/src/utils/oauth-callback-html.util.ts`.

Exports `renderOAuthCallbackHtml({ slug, connectorInstanceId, accountInfo })`. Body byte-identical to today's Google version except the JSON-encoded `type` field is `${slug}-authorized`.

**Removed:** the inline `renderCallbackHtml` at `apps/api/src/routes/google-sheets-connector.router.ts:487-510`. The Google router imports the new util and calls it with `slug: "google-sheets"`.

### R3 — Cache-key prefix rename

**Cache-key helpers** move into `apps/api/src/utils/connector-cache-keys.util.ts`:

```ts
export function workbookCacheKey(slug: string, connectorInstanceId: string): string {
  return `connector:wb:${slug}:${connectorInstanceId}`;
}
export function accessTokenCacheKey(slug: string, connectorInstanceId: string): string {
  return `connector:access:${slug}:${connectorInstanceId}`;
}
```

Existing constants (`googleSheetsWorkbookCacheKey` in `google-sheets-connector.service.ts`, the inline `cacheKey` in `google-access-token-cache.service.ts`) are removed and call sites updated. No backward-compat alias for the old key prefix — these are short-lived TTL'd caches that survive at most ~1h past the deploy and the worst case is a few extra Drive/Graph round-trips after rollout.

The Microsoft cache services use the same helpers with `slug: "microsoft-excel"`.

---

## Test plan (TDD ordering)

Tests are written before the production code in each slice. Each bullet below is a checkpoint where the test must fail for the right reason before the corresponding code is written.

### Unit tests (Jest, `apps/api/src/__tests__/...`)

1. **`utils/oauth-callback-html.util.test.ts`** — `renderOAuthCallbackHtml` returns HTML containing `type: "microsoft-excel-authorized"` when slug=microsoft-excel; same for `google-sheets`. Refuses an empty slug.
2. **`utils/connector-cache-keys.util.test.ts`** — formatting (`connector:wb:google-sheets:abc`, `connector:wb:microsoft-excel:abc`), refuses empty slug or empty id.
3. **`services/microsoft-auth.service.test.ts`** (mirror of `google-auth.service.test.ts`):
   - `buildConsentUrl` targets `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`, includes all required query params (`response_type=code`, `prompt=select_account`, `client_id`, `redirect_uri`, `scope`), embeds verifiable signed `state`.
   - Scope set includes `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`.
   - Tenant defaults to `common`; respects `MICROSOFT_OAUTH_TENANT` override.
   - `exchangeCode` returns `{ accessToken, refreshToken, idToken, expiresIn, scope }` on a 200.
   - `exchangeCode` throws `no_refresh_token` when response omits `refresh_token` (offline_access missing scenario).
   - `refreshAccessToken` returns the **new** `refreshToken` and `accessToken`/`expiresIn`/`scope` from the response (the rotation surface — must not silently swallow the new refresh token).
   - `refreshAccessToken` throws `MicrosoftAuthError("refresh_failed", …)` on a 400 `invalid_grant`.
   - `fetchUserProfile` parses `userPrincipalName`, `mail`, `displayName`, `id` from `/me`. `email` is `null` when `mail` is null. `tenantId` source comes from the id-token decoder helper (covered separately).
4. **`services/microsoft-access-token-cache.service.test.ts`** (mirror + Microsoft-specific cases):
   - Cache hit: returns cached token without refreshing.
   - Cache miss: calls `refreshAccessToken`, writes Redis with TTL `expiresIn - 600`, floored at 60.
   - **Refresh-token rotation persistence:** `connectorInstances.update` called with the **new** refresh token under encrypted `credentials.refresh_token`, preserving the other credential fields (UPN, email, displayName, tenantId, scopes), and `lastRefreshedAt` updated.
   - **Single-flight de-dup:** two concurrent `getOrRefresh` calls share one upstream refresh; both resolve to the same access token; rotation persistence runs once.
   - **`invalid_grant` path:** instance is updated `status="error"` with the upstream message; the original error is re-thrown unchanged.
5. **`services/microsoft-excel-connector.service.handleCallback.test.ts`**:
   - Invalid state → throws `ApiError(400, MICROSOFT_OAUTH_INVALID_STATE)`.
   - First-time `(org, tenant, upn)` → creates a `connector_instances` row with `status: "pending"`, `name: "Microsoft 365 Excel ({upn})"`, encrypted `credentials` containing all required fields including `tenantId`.
   - Existing `(org, tenant, upn)` (Reconnect path) → updates the row in place, resets `status: "active"`, clears `lastErrorMessage`.
   - **Disambiguation:** same UPN in two tenants creates two separate rows (the personal-MSA-vs-work-account scenario from Open Question 3).
   - Definition not seeded → `ApiError(500, MICROSOFT_OAUTH_DEFINITION_NOT_FOUND)`.

### Frontend unit tests (Jest, `apps/web/src/utils/__tests__/oauth-popup.util.test.tsx`)

6. Pulled-up tests for the existing Google popup hook **renamed and slug-parameterized**:
   - With `slug: "google-sheets"`: postMessage of `{ type: "google-sheets-authorized", ... }` resolves the start promise.
   - With `slug: "microsoft-excel"`: postMessage of `{ type: "microsoft-excel-authorized", ... }` resolves; messages with `google-sheets-authorized` are ignored.
   - Origin allowlist still rejects mismatched origins.
   - 5-minute timeout still rejects with `PopupClosedError`.

### Integration tests (`apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts`)

7. **`POST /authorize`** — returns 200 + `{ url }` whose hostname is `login.microsoftonline.com`; the `state` round-trips through `verifyState` to the requester.
8. **`POST /authorize`** without env vars set — returns 500 `MICROSOFT_OAUTH_NOT_CONFIGURED`.
9. **`GET /callback`** end-to-end:
   - Mock `MicrosoftAuthService.exchangeCode` + `fetchUserProfile`.
   - Round-trip: signed state → 200 HTML response → DB has new `connector_instances` row with encrypted credentials decrypting to expected payload (including `tenantId`).
   - Repeated callback for the same `(org, tenant, upn)` → same row id (UPDATE, not INSERT).
   - Different tenant for the same UPN → separate row (Open Question 3 verification).
10. **`GET /callback`** with stale state (>5 min) → 400 `MICROSOFT_OAUTH_INVALID_STATE`.

### Verification (manual)

After the slice ships:

```sh
# 1. Mint consent URL
curl -X POST -H "Authorization: Bearer $JWT" \
  http://localhost:3001/api/connectors/microsoft-excel/authorize | jq .payload.url

# 2. Open the URL in a browser, complete the consent, observe the popup HTML
#    POST /callback runs server-side; check the DB for the new row.

# 3. Confirm the row
psql -c "SELECT id, status, name, config FROM connector_instances WHERE name LIKE 'Microsoft 365 Excel%';"

# 4. Confirm the credentials decrypt (in a node REPL on the API container)
> const { decryptCredentials } = require("./dist/utils/crypto.util.js");
> decryptCredentials(<the encrypted blob>)
{ refresh_token: "0.AX...", scopes: [...], microsoftAccountUpn: "...", tenantId: "...", ... }
```

---

## Risks & open issues to track

- **Microsoft tenant misconfiguration** — `MICROSOFT_OAUTH_TENANT=common` may be blocked by some enterprise admins. Surfaced via the `502 MICROSOFT_OAUTH_EXCHANGE_FAILED` path; the user gets the upstream error message verbatim. Acceptable for v1; deployment-time config is the workaround.
- **Refresh-token rotation under multi-process load** — single-flight is per-process. If we scale beyond one API process before Phase E lands, simultaneous refreshes from two processes can both consume the same refresh token; one will hit `invalid_grant`. Phase E adds the user-facing recovery; multi-process Redis SET NX is a follow-up if scale forces it (same posture as Google).
- **`mail` is null** for personal MSAs — UI must render UPN as the identity; email is metadata only. Caught by the `email: null` fallback in the credentials blob and verified in the unit tests.
