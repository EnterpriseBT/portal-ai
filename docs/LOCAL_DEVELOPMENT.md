# Local development & testing

The runbook for the **local inner-loop**: running the stack and standing up fake/forwarded external callers against your local API (`:3001`). These are **local development tools** — distinct from operating a *deployed* environment (that's the [CLI Operations Charter](./CLI_OPERATIONS_CHARTER.md) and the per-surface vendor guides). None of this is agent-auto: the commands here forward, mock, or trigger against your own machine and are run by a developer.

## Running the stack

```bash
npm run dev          # all dev servers — web :3000, api :3001
```
`apps/api`'s `dev` runs the server (nodemon) **and** an ngrok tunnel concurrently (`concurrently --names server,tunnel`). To run just the API without the tunnel: `npm run dev:server` (from `apps/api`).

## Local Stripe webhook loop

Forward live test-mode Stripe events to your local webhook endpoint and fire test events (see the [Stripe billing spec](./STRIPE_SUBSCRIPTION_BILLING.spec.md)):

```bash
# 1. Forward events → local endpoint. Prints a whsec_… signing secret —
#    put it in apps/api/.env as STRIPE_WEBHOOK_SECRET so signature verify passes.
stripe listen --forward-to localhost:3001/api/webhooks/stripe

# 2. In another shell, fire a test event:
stripe trigger checkout.session.completed
```
The API records each delivery in the `stripe_events` ledger (`outcome`: `applied|noop|unmatched|ignored|foreign`). **Deployed-env** Stripe *inspection* (events/subscriptions/prices) lives in the [Stripe CLI ops guide](./STRIPE_CLI_OPS.md), not here — `listen`/`trigger` are local-only.

## Testing custom webhook tools (toolpacks)

`webhook:toolpack` runs a **mock custom-toolpack server** (`apps/api/src/scripts/mock-toolpack-server.ts`) exposing the schema/metadata/runtime endpoints a registered toolpack must implement — for exercising the registration + call flow locally without a real external service.

```bash
npm run webhook:toolpack     # from apps/api — starts the mock toolpack server
```
- Set `MOCK_TOOLPACK_SIGNING_SECRET` in `.env` to make the mock **verify** the outbound signing headers (`X-Portalai-Signature`/`-Timestamp`/`-Webhook-Id`) and return `401 SIGNATURE_MISSING`/`TIMESTAMP_STALE`/`SIGNATURE_INVALID` on failure; unset, it warns and accepts unsigned requests (useful before a registration exists).
- In non-production the SSRF guard already allows loopback (`127.0.0.1`/`localhost`), so registering a toolpack pointed at the mock works without flipping `TOOLPACK_DISABLE_SSRF_FILTER`.
- Author contract (header shapes, verification recipes, failure modes): [`docs/CUSTOM_TOOLPACK_INTEGRATION.md`](./CUSTOM_TOOLPACK_INTEGRATION.md).

## Exposing local `:3001` (ngrok tunnel)

For flows that need a **public** URL hitting your local API — OAuth provider callbacks (Google Sheets / Microsoft Excel connectors) or real webhook delivery from a provider:

```bash
npm run tunnel               # from apps/api — dotenv -e .env -- ngrok http 3001
```
Set `NGROK_AUTHTOKEN` in `apps/api/.env`. Point the provider's redirect/webhook URL at the ngrok host (matching `*_OAUTH_REDIRECT_URI`). `npm run dev` already starts a tunnel; `tunnel` is the standalone form.

## Smoke (manual, against your dev stack)

1. `npm run dev` boots cleanly — web on `:3000`, api on `:3001` (health: `curl localhost:3001/api/health` → 200).
2. **Stripe loop:** `stripe listen --forward-to localhost:3001/api/webhooks/stripe` prints a `whsec_…`; with it set as `STRIPE_WEBHOOK_SECRET`, `stripe trigger checkout.session.completed` shows the event forwarded and a `200` from the local endpoint (no `400 WEBHOOK_INVALID_SIGNATURE`).
3. **Mock toolpack:** `npm run webhook:toolpack` starts the mock server; a toolpack registered against its local URL passes schema fetch + a runtime call (with `MOCK_TOOLPACK_SIGNING_SECRET` set, unsigned calls get `401`).
4. **Tunnel:** `npm run tunnel` prints a public `https://…ngrok…` URL that reaches `curl <ngrok-url>/api/health` → 200.

## Out of scope

- **Deployed-env operations** — inspecting/operating `app-dev`/`prod` is the [charter](./CLI_OPERATIONS_CHARTER.md) + vendor guides (#224–#226) and the native CLIs (#227), not this runbook.
- **Allowlisting** — these commands are local, interactive/hold-open (`listen`, `tunnel`) or event-creating (`trigger`); they are run by a developer, not agent-auto.
