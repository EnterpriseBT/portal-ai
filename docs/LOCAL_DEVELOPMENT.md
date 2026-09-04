# Local development & testing

The runbook for the **local inner-loop**: running the stack and standing up fake/forwarded external callers against your local API (`:3001`). These are **local development tools** — distinct from operating a *deployed* environment (that's the [CLI Operations Charter](./CLI_OPERATIONS_CHARTER.md) and the per-surface vendor guides). None of this is agent-auto: the commands here forward, mock, or trigger against your own machine and are run by a developer.

## Running the stack

```bash
npm run dev          # all dev servers — web :3000, api :3001
```
`apps/api`'s `dev` runs the server (nodemon) **and** an ngrok tunnel concurrently (`concurrently --names server,tunnel`). To run just the API without the tunnel: `npm run dev:server` (from `apps/api`).

## Fresh reset → fully provisioned

After a full local reset (`docker compose down -v` + devcontainer rebuild, or `portalops db reset --env local --yes`), **one command** provisions everything — pending migrations, the system seed (bootstrap `standard` tier + connector definitions), and the tier catalog with env-local Stripe price ids. The last step matters: `db:seed` alone is deliberately bootstrap-only (#218), so without it a freshly reset stack silently shows only the `standard` tier.

```bash
DATABASE_URL=postgresql://… STRIPE_SECRET_KEY=sk_test_… \
  npx portalops local provision --env local --yes
```

It also creates the standing **`demo` tier** (#511) if absent — free, unlimited, all toolpacks, so any local org can `portalai org set-tier <org> demo --env local` and run the demo dataset. Idempotent — a re-run reports every step `ok` (tier apply all-noop, `demo-tier` `exists`) and changes nothing. Add `--e2e-org` to also seed the `e2e-fixture` org (a bare flag reads the email from `E2E_AUTH0_USERNAME`; the test user must have logged in once via `e2e:auth`, which stays a separate, interactive step — see `packages/e2e/README.md`). Local-only by contract: `--env app-dev`/`prod` exit 2 — deployed envs are provisioned by CI/deploy. Full contract, per-step `--json` output, and failure semantics: [packages/devops-cli/COMMANDS.md → local](../packages/devops-cli/COMMANDS.md#local).

## Local Stripe webhook loop

Forward live test-mode Stripe events to your local webhook endpoint and fire test events:

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

## Turborepo cache on your machine

`turbo` is on your PATH in the devcontainer — a symlink to `node_modules/.bin/turbo`, so it is always exactly the version in the lockfile. Two turbo versions compute different task hashes, which is why this is a symlink and not `npm install -g turbo`.

Your container is **not** linked to the shared remote cache, and that is deliberate. CI is the only writer. A developer machine is not a reproducible build environment — uncommitted edits, a local `apps/api/.env` that the API build reads through `dotenv-cli`, whatever happens to be in `node_modules` — so an artifact it uploaded would later be consumed by CI on trust. Keeping provenance inside CI is also what makes the artifact signing meaningful.

Your local `.turbo/` cache still works normally and gives you the same skipping between local runs.

If you ever want to *read* the shared cache (e.g. to skip building dependencies you have not touched), do it read-only and per-shell, never by linking the repo:

```bash
TURBO_TOKEN=<token> TURBO_TEAM=<slug> npx turbo run build --cache=remote:r,local:rw
```

The guard (`npm run lint:ci-cache`) enforces the CI half of this; nothing enforces the local half, so it is on you.

## Smoke (manual, against your dev stack)

1. `npm run dev` boots cleanly — web on `:3000`, api on `:3001` (health: `curl localhost:3001/api/health` → 200).
2. **Stripe loop:** `stripe listen --forward-to localhost:3001/api/webhooks/stripe` prints a `whsec_…`; with it set as `STRIPE_WEBHOOK_SECRET`, `stripe trigger checkout.session.completed` shows the event forwarded and a `200` from the local endpoint (no `400 WEBHOOK_INVALID_SIGNATURE`).
3. **Mock toolpack:** `npm run webhook:toolpack` starts the mock server; a toolpack registered against its local URL passes schema fetch + a runtime call (with `MOCK_TOOLPACK_SIGNING_SECRET` set, unsigned calls get `401`).
4. **Tunnel:** `npm run tunnel` prints a public `https://…ngrok…` URL that reaches `curl <ngrok-url>/api/health` → 200.

## Out of scope

- **Deployed-env operations** — inspecting/operating `app-dev`/`prod` is the [charter](./CLI_OPERATIONS_CHARTER.md) + vendor guides (#224–#226) and the native CLIs (#227), not this runbook.
- **Allowlisting** — these commands are local, interactive/hold-open (`listen`, `tunnel`) or event-creating (`trigger`); they are run by a developer, not agent-auto.
