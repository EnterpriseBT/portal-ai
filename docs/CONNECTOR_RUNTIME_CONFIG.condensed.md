# Connector runtime-config endpoint (build-time → runtime) — Condensed design (#580)

**Issue:** [EnterpriseBT/portal-ai#580](https://github.com/EnterpriseBT/portal-ai/issues/580) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#569](https://github.com/EnterpriseBT/portal-ai/issues/569) — branches off `epic/enterprise-deployment`.

**Why.** The web bundle bakes Google connector client config at **build time** — `google-picker.util.ts` reads `VITE_GOOGLE_OAUTH_CLIENT_ID` / `VITE_GOOGLE_PICKER_API_KEY` / `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` from `import.meta.env` into module consts. A prebuilt marketplace image can't be rebuilt per customer, so a self-hosted (BYO-Google) install can't supply its own client id. Move these **public, non-secret** browser values to a runtime endpoint the SPA fetches. Touches `apps/api` + `packages/core` + `apps/web`; SaaS behavior unchanged (same values, now delivered at runtime).

**On exposure (why these values are fine to serve).** All three are Google *browser* identifiers — the OAuth **client id**, the Picker **browser API key**, and the Cloud **project number** — public by design and **already compiled into the client bundle today** via `VITE_*`. The Picker runs in the browser, so the key must reach the browser regardless; its control is **GCP-side referrer + API restrictions** on the key, not secrecy. The OAuth **client secret** stays server-side and is **not** in this endpoint. Because the consumer is the **authenticated** web app (the picker only runs in the logged-in connector workflow) — not the anonymous marketing site — the endpoint is **authenticated** (`GET /api/connector-config`), *not* `/api/public`: tighter than anonymous, and it reuses the existing authenticated SDK so no new fetch pattern is added.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Endpoint template | `public-site.router.ts:89,116` + `site-config.service.ts` | Anonymous `GET /api/public/site-config`, router-level `publicRateLimit`, TTL cache, re-validated `{success,payload}`, `Cache-Control`. Mounted `app.ts:76` **before** `protectedRouter` (so `jwtCheck` never sees it). |
| Contract pattern | `packages/core/src/contracts/site-config.contract.ts` | `z.strictObject` response schema, `@portalai/core/contracts`. Split rule: `null` for a legitimately-absent optional value; 503 only for a value that *should* resolve and fails. |
| Web reads (to replace) | `google-picker.util.ts:288-293` | `PICKER_API_KEY`/`PICKER_CLIENT_ID`/`PICKER_APP_ID` from `import.meta.env?.VITE_GOOGLE_* ?? ""`, **synchronous at import**. `isPickerConfigured()` (`:301`) = all three truthy. |
| Web consumer | `use-picker-selection.util.ts:4-7,57,80-81,102` | `usePickerSelection` imports the consts, passes them to `requestBrowserToken`/`openSheetPicker` (already param-based), sets `pickerUnavailable: … || !isPickerConfigured()`. |
| Server Google config | `environment.ts:96-99`, `google-auth.service.ts` | `GOOGLE_OAUTH_CLIENT_ID` exists server-side (public, servable); secret stays server-only. **Picker key + project number are NOT server-side** — web-build-only today. |
| Web SDK (authed) | `apps/web/src/api/sdk.ts`, `api.util.ts` `useAuthQuery` | The whole SDK is Auth0-authenticated — the right fit here, since the picker only runs in the logged-in workflow. A new `sdk.connectorConfig.get` via `useAuthQuery` reuses the existing pattern; **no new fetch mechanism**. |
| Capability gating | `use-picker-selection.util.ts:102`, `SelectSheetStep.component.tsx:72-96` | Client-side soft: empty config → `pickerUnavailable` → disabled "Choose a spreadsheet" button + error Alert. No server capability endpoint; connector always offered, degrades in the picker step. |

## Decision — an authenticated `connector-config` endpoint, consumed via the SDK

- **API:** add **authenticated** `GET /api/connector-config` (a new `connector-config.router.ts` mounted on `protectedRouter`, so `jwtCheck` gates it — *not* `/api/public`). Response contract `{ google: { clientId, pickerApiKey, cloudProjectNumber } | null }`. `google` is **`null`** when the server's Google config is incomplete (any of the three absent) — the `null`-degrade half of the site-config rule, **not** a 503 (an unconfigured optional connector is *legitimately* absent; the "disabled, no UI" effect is delivered by the web's existing `isPickerConfigured` gate seeing `null`). A `ConnectorConfigService` assembles it from server env (no secret material).
- **Env:** reuse `GOOGLE_OAUTH_CLIENT_ID`; add public `GOOGLE_PICKER_API_KEY` + `GOOGLE_CLOUD_PROJECT_NUMBER` to `environment.ts` + `.env.example` (they exist only in the web build today).
- **Contract:** `packages/core/src/contracts/connector-config.contract.ts` — `ConnectorConfigResponseSchema` (`z.strictObject`), re-exported from `@portalai/core/contracts`.
- **Web:** add `sdk.connectorConfig.get` (a `useAuthQuery` keyed by a stable `queryKeys.connectorConfig` entry) — the **existing authenticated SDK pattern**, no new fetch mechanism. `google-picker.util.ts` drops the three module consts and `import.meta.env` reads; `isPickerConfigured(cfg)` takes the runtime config; `usePickerSelection` reads the SDK query and passes the values into the (unchanged, param-based) token/picker functions. Remove the `VITE_GOOGLE_*` dependency for these three.

**Why authenticated, not `/api/public`:** the picker only runs in the logged-in connector workflow, so anonymous exposure buys nothing and the authed SDK is simpler. The values are Google *browser* identifiers (already client-visible today); GCP referrer/API restrictions on the key are the real control.

## Plan — 2 slices

1. **API + contract.** New: `connector-config.contract.ts` (core) + `ConnectorConfigService` + authenticated `GET /api/connector-config` (`connector-config.router.ts` on `protectedRouter`); env vars + `.env.example`; swagger component. **Tests:** contract strict-shape (core); service configured/null projection (unit); `connector-config.router.integration.test.ts` **401 unauthenticated** (gated by `jwtCheck`).
2. **Web SDK + picker rewire** (one slice — the SDK endpoint has no standalone test; its consumer is the proof). New: `sdk.connectorConfig.get` (`api/connector-config.api.ts` + `queryKeys.connectorConfig`) via `useAuthQuery`. Edit: `google-picker.util.ts` (drop the three `import.meta.env` consts; `isPickerConfigured(google)`), `use-picker-selection.util.ts` (take `googleConfig` as an arg), the container (fetch via SDK, pass it down), and `apps/web/.env.example` (the three `VITE_GOOGLE_*` move to the API). **Tests:** `use-picker-selection` unit test — `pickerUnavailable` true when runtime config null, false when complete.

## Smoke (manual, against your dev stack)

Prereq: set `GOOGLE_PICKER_API_KEY` + `GOOGLE_CLOUD_PROJECT_NUMBER` (and `GOOGLE_OAUTH_CLIENT_ID`) in `apps/api/.env` to your current dev Google values; you may drop `VITE_GOOGLE_*` from the web env.

1. **Endpoint requires auth:** `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/connector-config` (no token) → **401**.
2. **Endpoint (configured, authed):** with a Bearer token, `curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/connector-config` → `{"success":true,"payload":{"google":{"clientId":"…","pickerApiKey":"…","cloudProjectNumber":"…"}}}` — non-secret only (no client *secret*).
3. **Endpoint (unconfigured):** unset the three server vars, restart → `payload.google` is `null` (200, not 503).
4. **SaaS unchanged:** in the web app, open the Google Sheets connector → the picker loads and "Choose a spreadsheet" works, using the runtime values (not a baked build value); the DevTools network tab shows the `/api/connector-config` fetch carrying a Bearer token.
5. **Unconfigured → disabled, no rebuild:** with `google: null` from the endpoint, the picker step shows the disabled button + config Alert (existing behavior), and no `VITE_GOOGLE_*` was needed at build.

## Out of scope

- Any connector other than Google Sheets — the endpoint's contract is shaped to add more (`{ google, … }`) but only Google moves now.
- A server-side "hide the connector entirely when unconfigured" surface — the existing client-side `isPickerConfigured` gate (now runtime-driven) is the capability signal; a hard server capability list is a later ticket.
- Rotating the client *secret* to runtime — secrets stay server-side + encrypted, unchanged.
- Deleting `VITE_GOOGLE_*` from every deploy's build config — the code stops reading them; removing them from CI/deploy env is a rollout step, and the API env must carry the two new vars first.
