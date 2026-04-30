# Google Sheets Connector — Phase A Implementation Plan

Companion to `GOOGLE_SHEETS_CONNECTOR.discovery.md`. Phase A scope (verbatim from the discovery doc):

> OAuth2 client + credentials encryption + seed `google-sheets` definition. No UI yet. Verifiable by running the OAuth dance in Postman/curl and seeing a `connector_instances` row with encrypted credentials.

## What already exists (do not rebuild)

- **AES-256-GCM credential encryption** — `apps/api/src/utils/crypto.util.ts` exports `encryptCredentials` / `decryptCredentials` keyed off `ENCRYPTION_KEY`. The format includes a key-version field for future rotation. Covered by `__tests__/utils/crypto.util.test.ts`.
- **`connector_instances.credentials` column + transparent crypt** — `ConnectorInstancesRepository` overrides `create` / `update` / `upsert` / `findById` / `findMany` etc. to encrypt-on-write and decrypt-on-read (`apps/api/src/db/repositories/connector-instances.repository.ts:62-135`).
- **`SeedService`** — `apps/api/src/services/seed.service.ts` already seeds the sandbox + file-upload connector definitions on boot. Adding `google-sheets` is one row.
- **Auth0 JWT middleware** — `getApplicationMetadata` is already used by every protected route; reused as-is for the authorize endpoint.
- **`@portalai/api` env plumbing** — `environment.ts` is the single source of truth; new vars go here.

So Phase A is **net-new code** for: env vars, OAuth state signing, `GoogleAuthService`, two routes, the seed row, the `PublicAccountInfo` contract + adapter projection method, a stub `google-sheets.adapter.ts`, and a `redactInstance` serializer applied to every connector-instance response. Roughly 7 files of source + matching tests.

## TDD discipline

Every slice lands in this order: **red** (write the failing test, run `npm run test:unit` or `npm run test:integration` and watch it fail for the right reason) → **green** (smallest code change that makes it pass) → **refactor**. No code is added without a test that fails before it. Tests run via `npm run test:unit` / `npm run test:integration` from `apps/api/` (per `feedback_use_npm_test_scripts` — `NODE_OPTIONS='--experimental-vm-modules'` lives in those scripts).

A slice is "done" when its tests pass and the full `npm run test:unit` + `npm run type-check` from the repo root are green. Don't move to the next slice with a red one outstanding.

---

## Slice 1 — Environment plumbing

### Goal

Surface the four new env vars so every later slice can reference `environment.GOOGLE_OAUTH_*` and `environment.OAUTH_STATE_SECRET` without ad-hoc `process.env` reads.

| Var | Source | Notes |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | SSM `/portalai/{env}/google-oauth-client-id` | Public, env-specific. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secrets Manager `portalai/{env}/google-oauth-client-secret` | Required for token exchange. |
| `GOOGLE_OAUTH_REDIRECT_URI` | env, derived from `api-{env}.portalsai.io/api/connectors/google-sheets/callback` | Must match Google Cloud Console exactly. |
| `OAUTH_STATE_SECRET` | Secrets Manager `portalai/{env}/oauth-state-secret` | HMAC key for signing the OAuth `state` token. **Separate from `ENCRYPTION_KEY`** — different concerns (signing vs encryption). |

### Red

- New file `apps/api/src/__tests__/environment.test.ts` (or extend an existing one if there's a test for this surface) asserting:
  - Each of the four vars is present on the exported `environment` object.
  - When the underlying `process.env.*` is unset, the value is `""` (empty string default — same convention as existing optional vars). Type is `string`, not `string | undefined`.

### Green

- Add the four entries to `apps/api/src/environment.ts`. Match existing patterns (no validation at module scope; downstream code throws if a required var is empty).

### Refactor

- Group the four under a single block-comment header `// ── Google OAuth (Phase A: docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md)` so future readers can find the cluster.

### Verification

```
cd apps/api && npm run test:unit -- --testPathPattern environment
npm run type-check
```

---

## Slice 2 — OAuth state token (sign + verify)

### Goal

Pure-function module that mints and verifies short-lived signed `state` tokens. The state binds the OAuth callback to the original requester so a redirect from Google can't be replayed by another user.

Format: `base64url({ userId, organizationId, exp, nonce })` `.` `base64url(hmacSha256)`. Five-minute expiry. HMAC keyed by `OAUTH_STATE_SECRET`.

### Red

- New file `apps/api/src/__tests__/utils/oauth-state.util.test.ts`:
  1. **Round-trip** — `verifyState(signState({ userId: "u1", organizationId: "o1" }))` returns `{ userId: "u1", organizationId: "o1" }`.
  2. **Tamper** — flipping any character in the signed token's payload OR signature halves of the dot-separated string causes `verifyState` to throw `OAuthStateError("invalid")`.
  3. **Expiry** — fake `Date.now()` (use Jest `useFakeTimers` or pass an injectable `now()` arg) such that `verifyState` is called >5 min after `signState`; throws `OAuthStateError("expired")`.
  4. **Wrong secret** — instantiate two state utils with different secrets; tokens from one don't verify under the other; throws `OAuthStateError("invalid")`.
  5. **Type discipline** — `signState` rejects payloads missing `userId` or `organizationId` (TS-level + runtime guard).

### Green

- New file `apps/api/src/utils/oauth-state.util.ts`:
  - Exports `signState({ userId, organizationId, now? }): string`, `verifyState(token, { now? }): { userId, organizationId }`, and a `OAuthStateError` subclass with a discriminated `kind: "invalid" | "expired"` field.
  - Implementation: `crypto.createHmac("sha256", environment.OAUTH_STATE_SECRET)`, `crypto.timingSafeEqual` for the compare. Base64url encoding via `Buffer.from(...).toString("base64url")`.
  - Inject `now` for testability — defaults to `() => Date.now()`.

### Refactor

- Add a `STATE_TTL_MS = 5 * 60 * 1000` constant. No comments unless something is non-obvious.

### Verification

```
cd apps/api && npm run test:unit -- --testPathPattern oauth-state
```

---

## Slice 3 — `GoogleAuthService.buildConsentUrl`

### Goal

Pure URL builder. No network calls. Returns the Google consent URL the frontend will open in a popup.

### Red

- New file `apps/api/src/__tests__/services/google-auth.service.test.ts` — first describe block:
  1. URL host = `accounts.google.com`, path = `/o/oauth2/v2/auth`.
  2. Query params include: `client_id` (from env), `redirect_uri` (from env), `response_type=code`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`.
  3. `scope` query param contains both `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/spreadsheets.readonly` (space-separated, URL-encoded).
  4. `state` query param is non-empty and verifies via `verifyState` to the supplied `{ userId, organizationId }`.
  5. Throws if `GOOGLE_OAUTH_CLIENT_ID` is empty (fail fast, don't generate a malformed URL).

### Green

- New file `apps/api/src/services/google-auth.service.ts`:
  - `class GoogleAuthService` with static `buildConsentUrl({ userId, organizationId }): string`.
  - Internal: build a `URL("https://accounts.google.com/o/oauth2/v2/auth")`, set search params from env + a fresh `signState(...)`.
  - Constants for the two scope strings at file scope.

### Refactor

- Extract a `GOOGLE_OAUTH_SCOPES` array constant — easier to extend in Phase B (Drive listing) and Phase C (sheet read).

---

## Slice 4 — `GoogleAuthService.exchangeCode`

### Goal

POST to `https://oauth2.googleapis.com/token` with the auth code; returns `{ accessToken, refreshToken, expiresIn, scope }`.

### Red

- Same test file (`google-auth.service.test.ts`) — second describe:
  1. Mock `fetch` (Jest `unstable_mockModule` per the project's ESM convention). Asserts the request:
     - Method `POST`, URL `https://oauth2.googleapis.com/token`, header `Content-Type: application/x-www-form-urlencoded`.
     - Form body contains `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`.
  2. On 200 with valid JSON, returns the parsed token bundle (camelCased: `accessToken`, `refreshToken`, `expiresIn`, `scope`).
  3. On 4xx, throws `GoogleAuthError` with `kind: "exchange_failed"` and the upstream error message in `cause`.
  4. On a response missing `refresh_token`, throws `GoogleAuthError` with `kind: "no_refresh_token"` — this happens when the user has previously consented and Google reuses the prior grant; we want to surface it clearly because the discovery doc requires `prompt=consent` (Slice 3) precisely to avoid this.
  5. `fetch` is injectable on the service for testability (constructor or static seam — match the project's pattern in `spreadsheet-parsing-llm.service.ts:generateObject`).

### Green

- Extend `GoogleAuthService` with a static `exchangeCode({ code }): Promise<TokenBundle>`.
- Add a `GoogleAuthError extends Error` with `readonly kind: "exchange_failed" | "no_refresh_token" | "userinfo_failed" | "refresh_failed"`.

### Refactor

- Lift the form-encoding into a tiny `formEncode(record)` helper at the bottom of the file. No `qs` / `querystring` dep — `URLSearchParams.toString()` is enough.

---

## Slice 5 — `GoogleAuthService.fetchUserEmail`

### Goal

Given a fresh access token, GET `https://www.googleapis.com/oauth2/v3/userinfo` to capture the authenticated `email`. We persist this in the credentials blob and surface it as `googleAccountEmail` on the connector card.

### Red

- Same test file, third describe:
  1. Mock `fetch`. Asserts request: `GET`, header `Authorization: Bearer <token>`.
  2. On 200 with `{ email, email_verified, sub, ... }`, returns `email`.
  3. On `email_verified === false`, throws `GoogleAuthError("userinfo_failed", "email not verified")` — we don't accept unverified Google emails as account identities.
  4. On non-2xx, throws `GoogleAuthError("userinfo_failed")` with the upstream status in `cause`.

### Green

- Add `static fetchUserEmail(accessToken: string): Promise<string>`.

---

## Slice 6 — Seed `google-sheets` connector definition

### Goal

`SeedService.run()` ensures a `google-sheets` row exists in `connector_definitions` on every API boot. Idempotent (uses `upsertManyBySlug` per the existing pattern).

### Red

- New file `apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts` (or extend the existing seed test if one is already there — check first):
  1. Run `SeedService.run()` against a fresh test DB.
  2. Query `connector_definitions WHERE slug = 'google-sheets'`. Assert one row with:
     - `display: "Google Sheets"`
     - `category: "spreadsheet"` (or whatever the doc's chosen category is — confirm before writing)
     - `auth_type: "oauth2"`
     - `capability_flags: { sync: true, read: true, write: false, push: false }`
     - `config_schema` contains `spreadsheetId`, `title` (no `syncCadence` per discovery)
     - `is_active: false` (Phase A ships with the definition gated off — frontend doesn't see it until Phase C wires the workflow)
     - `version: 1`
  3. Run `SeedService.run()` a second time. Assert still exactly one row (idempotent).

### Green

- Extend `apps/api/src/services/seed.service.ts` — add the `google-sheets` definition object to whatever array it already passes to `upsertManyBySlug`.
- Provide an SVG/PNG icon URL — use the same hosting convention the existing definitions use (or an empty string + a TODO stub if there's no canonical asset yet; flag that as an open item rather than blocking).

### Refactor

- If the seed file is starting to bloat, split definitions into `apps/api/src/services/seed/connector-definitions.seed.ts` and import. Only do this if the file is already over ~300 lines — `feedback_planning_artifacts_in_repo` says no premature abstraction.

---

## Slice 7 — Authorize route

### Goal

`POST /api/connectors/google-sheets/authorize` — authenticated, returns `{ url: string }` for the frontend to open.

### Red

- New file `apps/api/src/__tests__/__integration__/routes/google-sheets-connector.router.integration.test.ts` — first describe:
  1. **401** when called without a valid Auth0 JWT.
  2. **200** with `{ url }` when called with a valid JWT; the URL parses, hits `accounts.google.com`, and the embedded `state` verifies to the JWT's `(userId, organizationId)`.
  3. **500 / `GOOGLE_OAUTH_NOT_CONFIGURED`** when env vars are empty (covers the misconfig case).

### Green

- New file `apps/api/src/routes/google-sheets-connector.router.ts` — single route delegating to `GoogleAuthService.buildConsentUrl`.
- Mount in `apps/api/src/routes/protected.router.ts` under `/connectors/google-sheets`.
- Add `GOOGLE_OAUTH_*` API codes to `apps/api/src/constants/api-codes.constants.ts`: `GOOGLE_OAUTH_NOT_CONFIGURED`, `GOOGLE_OAUTH_AUTHORIZE_FAILED`.

### Refactor

- If `protected.router.ts` is getting long, factor connector routers into a `connectors/` subdir. Lower priority — only if the diff visually screams.

---

## Slice 8 — Callback route + pending-instance creation

### Goal

`GET /api/connectors/google-sheets/callback?code=...&state=...` — the route Google redirects to. Verifies state, exchanges code, fetches email, creates (or re-uses) a `ConnectorInstance` with `status="pending"` and encrypted credentials.

### Red

Same router integration test, second describe (each as a separate `it`):

1. **Invalid state** — query `state` is junk → 400 with `GOOGLE_OAUTH_INVALID_STATE`.
2. **Expired state** — fake clock, `state` ≥ 5 min old → 400 with `GOOGLE_OAUTH_INVALID_STATE`.
3. **Token exchange fails** — mock `GoogleAuthService.exchangeCode` to throw `GoogleAuthError("exchange_failed")` → 502 with `GOOGLE_OAUTH_EXCHANGE_FAILED`.
4. **Userinfo fails** — exchangeCode succeeds, fetchUserEmail throws → 502 with `GOOGLE_OAUTH_USERINFO_FAILED`. **No partial DB state** — `connector_instances` row count for the org is unchanged.
5. **Happy path: new instance** — valid state, exchange + email succeed.
   - Returns 200 with HTML containing the new `connectorInstanceId`. (HTML body shape: a `<script>` that postMessages `{ type: "google-sheets-authorized", connectorInstanceId, accountInfo: { identity, metadata } }` to `window.opener` and calls `window.close()`. Same `accountInfo` shape the redacted API returns — the popup opener gets the chip-ready data immediately. Inline test matcher just checks the id appears in the response body for now; a proper E2E test waits for Phase C.)
   - DB now has one row with `status="pending"`, `connectorDefinitionId` matching the seeded `google-sheets` definition, encrypted `credentials`. Decrypting with `decryptCredentials` yields `{ refresh_token: "...", scopes: [...], googleAccountEmail: "..." }`.
6. **Happy path: re-auth same account** — first run callback to create instance with email `alice@example.com`. Second run callback (different `code`) for the same email + same org. Expect:
   - Same `connector_instance_id` returned in the postMessage HTML.
   - Row count unchanged (still one).
   - `credentials` row updated (decrypts to the new refresh_token).

### Green

- Extend `google-sheets-connector.router.ts` with the `GET /callback` handler.
- Logic in the handler delegates to a new `GoogleSheetsConnectorService.handleCallback({ code, state }) → { connectorInstanceId, accountInfo: PublicAccountInfo }`. The service builds `accountInfo` by calling the same `googleSheetsAdapter.toPublicAccountInfo(credentials)` the serializer uses — single source of truth for the shape. Keep route thin per project style.
- New file `apps/api/src/services/google-sheets-connector.service.ts` (slice scope is just `handleCallback`; later slices grow the file).
  - Looks up the `google-sheets` definition by slug.
  - For "find existing by email", reuse `connectorInstances.findByOrgAndDefinition` then filter in-memory by decrypted `googleAccountEmail`. (A dedicated repository method `findByOrgDefinitionAndCredentialEmail` is an option but premature; keep it simple until a second caller appears.)
  - On creation: `repository.create` with `credentials: { refresh_token, scopes, googleAccountEmail }` — the repository encrypts on write.
  - On re-auth: `repository.update(id, { credentials: ... })`.
- Add API codes: `GOOGLE_OAUTH_INVALID_STATE`, `GOOGLE_OAUTH_EXCHANGE_FAILED`, `GOOGLE_OAUTH_USERINFO_FAILED`.

### Refactor

- The "find by email" loop is O(N) over the org's google-sheets instances. Fine for v1 (each user has 1–3 Google accounts). Add a `// O(N) — see Phase A plan` comment only if N is plausibly large; otherwise nothing.

---

## Slice 9 — Redact credentials + adapter-owned public projection

### Why this slice exists

`ConnectorInstancesRepository` decrypts `credentials` on every read (overrides at `connector-instances.repository.ts:88-110`). Today that's harmless because no connector has secrets in `credentials`. The minute Phase A's callback writes a row with `credentials = { refresh_token, scopes, googleAccountEmail }`, every existing GET / list endpoint that returns a `ConnectorInstanceSelect` starts shipping the refresh token over the wire to anyone authenticated for the org. The UI also needs a tiny slice of that data — `googleAccountEmail` for the account chip.

So this slice is two things: **redact `credentials` from every response shape** (security), and **expose a connector-controlled public projection** (UX). Solve both with one primitive.

### Design: adapter-owned `toPublicAccountInfo` returning `{ identity, metadata }`

Future connectors will each have their own credential shape — Dropbox account name, Notion workspace name, an API-key connector with no recognizable account at all. A switch-on-slug in the route layer would grow with every connector and route. Push the projection down to where the connector already lives: the adapter.

The return shape is **structured, not flat**, so the chip and the detail view each have an obvious contract:

```ts
// apps/api/src/adapters/adapter.interface.ts
export interface PublicAccountInfo {
  /**
   * One-line identity for the connector card chip — typically the
   * authenticated account's email or workspace name. `null` when the
   * connector has no recognizable handle (e.g. an API-key service
   * account); the UI falls back to a generic "Connected" label.
   */
  identity: string | null;
  /**
   * Free-form bag of additional public fields for the detail view to
   * render generically. Keys are connector-defined; values are
   * primitives only (string / number / boolean) so the UI can
   * humanize keys and stringify values without recursion.
   */
  metadata: Record<string, string | number | boolean>;
}

export interface ConnectorAdapter {
  // … existing methods …
  toPublicAccountInfo?(
    credentials: Record<string, unknown> | null
  ): PublicAccountInfo;
}
```

Why this beats a flat `Record<string, unknown>`:

- **Chip contract is explicit in the type.** `identity: string | null` tells every adapter author exactly what the chip will render. No "by convention, put the identity under a key called `identity`".
- **Detail view stays generic.** `metadata` is the bag the UI iterates; the chip never has to skip a magic `identity` key during iteration.
- **Primitive-only values in `metadata`** mean the UI never recurses into nested objects to humanize / stringify. If a connector wants to expose something complex, it pre-formats (e.g. `lastSyncAt: "2026-04-28T17:54:09Z"` not `lastSyncAt: { iso: ..., epoch: ... }`).
- **`identity: null` is a real, intentional state**, not a missing-key accident. Tells the UI: "this connector doesn't have a chip-worthy handle, render the generic state."

The serializer is one slug-free function:

```ts
const EMPTY_ACCOUNT_INFO: PublicAccountInfo = { identity: null, metadata: {} };

function redactInstance(row: ConnectorInstanceSelect, slug: string) {
  const adapter = ConnectorAdapterRegistry.get(slug);
  const accountInfo =
    adapter?.toPublicAccountInfo?.(row.credentials) ?? EMPTY_ACCOUNT_INFO;
  const { credentials: _omit, ...rest } = row;
  return { ...rest, accountInfo };
}
```

New connectors implement `toPublicAccountInfo` if they have anything safe to expose, omit it otherwise. Default behavior (adapter missing the method, or slug not in the registry) is `EMPTY_ACCOUNT_INFO` — defense in depth: an unknown slug never leaks credentials by accident.

The adapter for `google-sheets` doesn't exist yet (Phase D wires its sync methods). For Phase A, register a stub adapter whose only implemented method is `toPublicAccountInfo` — every other adapter method throws `not-implemented`. The stub gets fleshed out in Phase B/D. Its implementation:

```ts
toPublicAccountInfo(credentials) {
  if (!credentials || typeof credentials.googleAccountEmail !== "string") {
    return { identity: null, metadata: {} };
  }
  return {
    identity: credentials.googleAccountEmail,
    metadata: {}, // Phase A surfaces only the email; later phases can add scopes, last refresh, etc.
  };
}
```

`PublicAccountInfo` should live in `@portalai/core/contracts` so the web app can import the same type for the response shape.

### Red

- Extend `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`:
  1. **No credential leak — google-sheets.** Seed a google-sheets instance via the callback flow. `GET /api/connector-instances/:id` returns `accountInfo.identity === "alice@example.com"` and `accountInfo.metadata` is an object. Response body has no `credentials` key, no `refresh_token` substring anywhere (do a deep scan, not just a top-level check), no `scopes` array.
  2. **No credential leak — list endpoint.** `GET /api/connector-instances` returns the same redaction across every row. **This catches the most likely regression** — list endpoints are the easiest place to forget the redaction.
  3. **No credential leak — write endpoints.** `POST /api/connector-instances` (or whatever creates one) and `PATCH` return responses with the same redaction. The repository decrypts on write paths too (see `create` / `update` overrides), so unredacted writes leak just like unredacted reads.
  4. **Connector with no public projection.** Seed a sandbox instance. `accountInfo` is `{ identity: null, metadata: {} }`. The UI's check is `accountInfo.identity != null` for chip-rendering, not `Object.keys(...)`.
  5. **Connector with no adapter at all.** Insert a row referencing a fictitious slug not in the registry. `accountInfo` is `{ identity: null, metadata: {} }`. No exception, no leak.
- Add an adapter unit test `apps/api/src/__tests__/adapters/google-sheets.adapter.test.ts`:
  6. `toPublicAccountInfo({ refresh_token: "secret", scopes: [...], googleAccountEmail: "alice@example.com" })` returns exactly `{ identity: "alice@example.com", metadata: {} }` — `refresh_token` and `scopes` do not leak into either field.
  7. `toPublicAccountInfo(null)` and `toPublicAccountInfo({})` both return `{ identity: null, metadata: {} }` — handles the not-yet-authorized state cleanly.
  8. `toPublicAccountInfo({ googleAccountEmail: 123 })` returns `{ identity: null, metadata: {} }` — defensively rejects a non-string `googleAccountEmail` rather than coercing. The credentials blob is JSON, so a corrupted shape is theoretically reachable; a redaction primitive that trusts its input is the kind of bug that ends up in a security advisory.

### Green

- **`PublicAccountInfo` type** — add to `@portalai/core/contracts` so both the API serializer and the web app can import it. Export `EMPTY_ACCOUNT_INFO` alongside as the canonical default constant.
- **Adapter interface** — add the optional `toPublicAccountInfo` method to `ConnectorAdapter` with the structured return type.
- **Stub adapter** — new file `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts`. Implements `toPublicAccountInfo` only; other methods throw `not-implemented` (Phase B/D fills them in). Register in `ConnectorAdapterRegistry`.
- **Sandbox adapter** — leave as-is (no `toPublicAccountInfo`). Default `EMPTY_ACCOUNT_INFO` falls out of the serializer.
- **Serializer** — single `redactInstance(row, slug)` helper returning the row with `credentials` removed and `accountInfo: PublicAccountInfo` attached. Where it lives: probably `apps/api/src/services/connector-instances.service.ts` (create the file if it doesn't exist; otherwise extend). Routes call the helper before returning.
- **Audit and apply** — every connector-instance route that returns a row or rows: GET-by-id, list, POST, PATCH, and any nested route that embeds an instance (e.g. layout-plan responses that include the instance). Each one calls `redactInstance`. **Don't ship Slice 9 with any of these missed** — the test in step 2/3 above is what enforces this; if a route slips through, the test catches it.

### Refactor

- The serializer needs the `slug` to look up the adapter. Either fetch the definition alongside the instance (most routes already do this via `include=connectorDefinition`) or extend the helper to accept an instance shape that already has the slug attached. Pick whichever leaves the route handlers smallest.
- A `_omit` rename for the destructured `credentials` is a lint-noise dance with `@typescript-eslint/no-unused-vars`; use the project's existing convention (check whether other repos in the codebase prefix with `_` or `// eslint-disable-next-line`).

---

## End-to-end verification gate

After all nine slices land, the discovery doc's Phase A acceptance test must pass manually:

1. Set the four new env vars locally (use `openssl rand -base64 32` for `OAUTH_STATE_SECRET`).
2. Register a dev OAuth client in Google Cloud Console with redirect URI `http://localhost:3001/api/connectors/google-sheets/callback`.
3. From a logged-in Postman session: `POST /api/connectors/google-sheets/authorize` → returns a URL.
4. Open the URL in a browser. Consent.
5. Browser lands on the callback URL; response HTML contains the new `connectorInstanceId`.
6. `psql` against the dev DB: `SELECT id, status, connector_definition_id, credentials FROM connector_instances WHERE …`.
   - `status = 'pending'`.
   - `credentials` is an opaque base64 blob (no plaintext refresh token visible).
7. From `apps/api`:
   ```sh
   node -e "
     const { decryptCredentials } = require('./dist/utils/crypto.util.js');
     console.log(decryptCredentials(process.argv[1]));
   " '<paste credentials value>'
   ```
   Expected: `{ refresh_token: 'ya29...', scopes: [...], googleAccountEmail: 'you@example.com' }`.
8. `GET /api/connector-instances/:id` returns the instance with `accountInfo: { identity: "you@example.com", metadata: {} }` and no `credentials` field anywhere in the response body.

If all eight checks pass, Phase A is done. Phase B (Sheet listing + workbook fetch + cache) can begin against the same `ConnectorInstance` rows.

---

## Out of scope for Phase A

These belong to later phases — explicitly noted so review focuses on what is in scope:

- Sheet listing / Drive search (Phase B).
- Region editor wiring (Phase C).
- Manual sync (Phase D — also where the watermark reconciliation and the identity-strategy guard land).
- Reconnect / `invalid_grant` recovery flow (Phase E).
- Frontend UI of any kind. The integration tests cover the API surface; the popup-postMessage wiring is verified manually until Phase C builds the workflow.

## Risks specific to Phase A

- **Google's `prompt=consent` requirement.** Without it, Google reuses prior grants and the second `exchangeCode` call returns no `refresh_token`. Slice 4's test #4 catches this. Don't drop `prompt=consent` "to make development smoother" — production needs this guarantee.
- **State-secret rotation.** A rotation of `OAUTH_STATE_SECRET` invalidates in-flight authorizes (≤ 5 min window). Acceptable; document in the runbook when added in deploy ops.
- **Race on re-auth same email.** Two simultaneous callback completions for the same email would race on the find-then-update. Not a v1 worry (the user is one human, one popup at a time), but flag for Phase E if it materializes.
