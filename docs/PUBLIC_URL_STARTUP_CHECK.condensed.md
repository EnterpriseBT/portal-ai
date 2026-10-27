# Say clearly when the API's public URLs aren't set — Condensed design (#891)

**Issue:** [EnterpriseBT/portal-ai#891](https://github.com/EnterpriseBT/portal-ai/issues/891) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The API reads two externally-reachable URLs whose defaults are loopback.
- **`WEB_APP_URL`** builds invite links. Unset on deployed envs, every invite pointed at localhost (#889). Since #889, production refuses an invite rather than hand out such a link.
- **`PUBLIC_API_BASE_URL`** is the address webhook toolpacks call **back** on. Unset, the runtime is told to call its own loopback (#382). Nothing checks it, and it only matters to the webhook tools that use a callback.

On ECS both are set by `backend.yml` and held there by `deploy-parity.test.ts` (#889). The remaining gap is a **Helm install**, where nothing sets `PUBLIC_API_BASE_URL`.

So the installer is told, at install and at startup, which URL is missing and what that breaks. A webhook tool that needs a callback refuses with a message saying why, and everything else (plain webhook tools included) carries on. No refusal to start: an install that doesn't use streaming or large-result webhook tools shouldn't be blocked over a URL it never needs. `apps/api`, plus the Helm chart.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Defaults | `apps/api/src/environment.ts:2`, `:111`, `:115` | `NODE_ENV` → `development`; `PUBLIC_API_BASE_URL` → `http://localhost:3001`; `WEB_APP_URL` → `http://localhost:3000` |
| Who gets a callback URL | `apps/api/src/tools/webhook.tool.ts:147`, `:174` | only a `streaming` tool given a `queryHandle` (read grant, `buildPullGrant` `:280`) and a tool declaring `production: rows, onLarge: handle` (write grant, `buildOutputGrant` `:220`); a plain tool gets neither |
| Typed tool refusal | `apps/api/src/services/input-character-gate.service.ts:6` | `{ error: { code, message } }`, returned (not thrown) so the agent relays it |
| #889's invite check | `apps/api/src/utils/invite-link.util.ts:18` (`isLoopback`), `:32`, `:47` | production + loopback → `503 INVITATION_LINK_UNCONFIGURED`; stays |
| Startup | `apps/api/src/index.ts:55` | the deploy-mode check runs first; warnings go beside it |
| ECS | `infra/cloudformation/backend.yml` | sets both; `deploy-parity.test.ts` holds them (#889) |
| Helm | `deploy/helm/portalai/templates/configmap.yaml`, `NOTES.txt` | `WEB_APP_URL` defaults from `ingress.host` (#889); `PUBLIC_API_BASE_URL` has none; NOTES prints rollout and readiness hints after install |
| Toolpack author contract | `docs/CUSTOM_TOOLPACK_INTEGRATION.md:345`–`:363` | documents `source.readUrl` / `output.writeUrl` |

## Decision — tell, don't block

- **Helm defaults `PUBLIC_API_BASE_URL`** from `ingress.host` (`https` with `ingress.tls`, since `/api` shares the host), unless `config.PUBLIC_API_BASE_URL` is set. This mirrors #889's `WEB_APP_URL` default and closes the common case.
- **Helm NOTES name a missing URL at install.** When neither the ingress nor `config` supplies a URL, NOTES says so, in what-it-breaks terms:
  - "`PUBLIC_API_BASE_URL` isn't set. Webhook tools that stream data in or return large results need it to call back, and will refuse until it's set. Plain webhook tools and the rest of the app don't need it."
  - "`WEB_APP_URL` isn't set. Invitations are refused until it is."
- **The API warns at startup** (production only), once per unusable setting, with code `PUBLIC_URL_UNCONFIGURED`, the setting's name, its value and the same consequence text. That's the line a Helm or ECS operator finds in the logs.
- **A webhook tool that needs a callback says why, and only when it really needs one** (code review). In production without a public `PUBLIC_API_BASE_URL`:
  - **A `streaming` pull of a `queryHandle`** makes no webhook call. It returns the typed result `{ error: { code: "WEBHOOK_CALLBACK_UNCONFIGURED", message } }`, naming the setting and suggesting inline `rows`, which need no callback.
  - **A large-result tool** is called without its write grant, since most results fit inline. Only a result over the inline cap (`TOOLPACK_RUNTIME_TOO_LARGE`) becomes `WEBHOOK_CALLBACK_UNCONFIGURED`, saying staging needs the address.
  - **A plain webhook tool** never reaches the check.
  - The agent relays the message. Custom tools cost 0, so nothing is charged.
  - Grant URLs are built on the address with any trailing slash trimmed.
- **Rejected: refusing to start.** It would block a whole install over a feature it may not use.
- **Rejected: warning only.** The runtime would still be handed a loopback URL, and fail somewhere the portal can't see.
- **Only loopback counts as not public** (code review, declined). Private ranges (10.x, 192.168.x) and in-cluster names pass the check. A residency install's webhook runtime can sit on the customer's own network, where such an address is the right one; only loopback is always wrong.
- **An empty Helm `config` value counts as unset.** The ingress default still applies, and the notes still name it.
- **One judge for both URLs.** `isLoopback`/`isPublicOrigin` move from `invite-link.util.ts` to a new `public-url.util.ts`, used by the invite check, the webhook check and the startup warnings.

## Plan — 1 slice

**Files**
- New: `apps/api/src/utils/public-url.util.ts`: `isPublicOrigin(raw)` (moved with `isLoopback`), `publicUrlWarnings(env): { setting, value, message }[]` (empty outside production), and the two consequence messages.
- Edit: `apps/api/src/utils/invite-link.util.ts`: uses `isPublicOrigin`; behaviour unchanged.
- Edit: `apps/api/src/index.ts`: after the deploy-mode check, `logger.warn({ code: ApiCode.PUBLIC_URL_UNCONFIGURED, setting, value }, message)` per warning.
- Edit: `apps/api/src/tools/webhook.tool.ts`: before `buildPullGrant` / `buildOutputGrant`, the production check returns the `WEBHOOK_CALLBACK_UNCONFIGURED` result.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: `PUBLIC_URL_UNCONFIGURED`, `WEBHOOK_CALLBACK_UNCONFIGURED`.
- Edit: `deploy/helm/portalai/templates/configmap.yaml`, `NOTES.txt`, `values.yaml`, `README.md`; `scripts/check-helm.mjs`.
- Edit: `docs/CUSTOM_TOOLPACK_INTEGRATION.md`: a streaming or large-result tool needs the install's `PUBLIC_API_BASE_URL`, and refuses with `WEBHOOK_CALLBACK_UNCONFIGURED` without it. `apps/api/.env.example`: both comments match.

**Tests** (`npm run test:unit` / `npm run test:integration`, from each package; `npm run lint:helm`)
- New: `apps/api/src/__tests__/utils/public-url.util.test.ts`: #889's loopback table via `isPublicOrigin`; a warning per bad setting naming it, its value and its consequence; none for real origins; none outside production.
- Edit: `apps/api/src/__tests__/tools/webhook.tool.test.ts`: in production with a loopback `PUBLIC_API_BASE_URL`, a `streaming` tool given a `queryHandle` and a `HANDLE_PROD` tool return `WEBHOOK_CALLBACK_UNCONFIGURED` without calling the webhook or minting a token. A plain tool calls its webhook as before. Development is unchanged.
- Edit: `scripts/check-helm.mjs`: it renders the install notes (as a `tpl`'d ConfigMap in a scratch copy, since `helm template` skips NOTES). It asserts the notes for no ingress, a TLS ingress, config-only and an empty config value, and that their consequence sentences are `public-url.util.ts`'s. Also, `PUBLIC_API_BASE_URL` renders `https://app.example.com` with a TLS ingress, `http://portal.corp` without TLS, the config value when set, and nothing with no ingress.
- Unchanged and still green: `invite-link.util.test.ts`, the seat integration tests.

## Smoke (manual, against your dev stack)

1. `cd apps/api && npm run build`, then `NODE_ENV=production PORT=3011 WEB_APP_URL=https://app.example PUBLIC_API_BASE_URL= npm run start`: it starts (`:3011/api/health` → 200). The log has one `PUBLIC_URL_UNCONFIGURED` warning naming `PUBLIC_API_BASE_URL`, its value and the webhook consequence, and none for `WEB_APP_URL`.
2. `helm install p deploy/helm/portalai --dry-run=client` with the image values and no ingress: NOTES names both URLs with their consequences. With `--set ingress.enabled=true --set ingress.host=app.example.com --set ingress.tls.enabled=true`, neither note appears, and the ConfigMap carries both `https://app.example.com` defaults.
3. Your normal `npm run dev` starts with no warning (development).
4. After merge — backend: Deploy Dev is green, and the `portalai-dev` API log has no `PUBLIC_URL_UNCONFIGURED` line.

## Out of scope

- **Refusing to start on a missing URL** (rejected above).
- **Checking a URL that's wrong but public** (a typo'd host). Only unset or loopback is detectable.
- **A general startup validation for every production env var.**
