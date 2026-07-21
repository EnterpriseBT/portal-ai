# Stripe CLI operations runbook

The **agent- and human-operable runbook** for Stripe **inspection and price/lookup-key config** on Portal.ai environments — the runbook the [CLI Operations Charter](./CLI_OPERATIONS_CHARTER.md)'s Stripe table points at (#225, epic #222). Every inspection command is non-interactive and emits JSON.

**Boundary.** This is for **inspecting** billing state (events, subscriptions, customers, prices) and **operating the price/lookup-key identity** that `portalops tier apply` consumes (#218). It is **not** the server-side webhook/subscription runtime (#176) — inspection only. The **local webhook harness** (`stripe listen`, `stripe trigger`, `npm run webhook:toolpack`, `npm run tunnel`) lives in the [local development runbook](./LOCAL_DEVELOPMENT.md) (#244), not here.

## Auth

Stripe's axis is **test-mode (default) vs live-mode (`--live`)**, and **each Portal env is a separate Stripe account** — never assume an id from one env exists in another. Test-mode everywhere except `prod`.

Use a **dedicated read-only restricted key** for inspection (distinct from the app's write-scoped `stripe-secret-key`). Create it per account: Dashboard → **Developers → API keys → Create restricted key** → name `Portal CLI (read-only)` → all resources **None** except **Read** on Events, Subscriptions, Customers, Prices, Products, Invoices, Webhook Endpoints.

- **Humans:** `stripe login` (interactive device pairing). For per-env accounts, add named profiles: `stripe login --project-name app-dev`, then pass `--project-name app-dev` on commands.
- **Agents / CI:** pass the key explicitly — `--api-key rk_test_…` or `export STRIPE_API_KEY=rk_test_…` (no interactive login, no callback).

> **Safety model — the credential is the gate, not the prompt.** A read-only restricted key **cannot** create prices or update subscriptions: Stripe rejects the write with a permissions error. That server-side rejection — **not** the `.claude` allowlist and **not** a Claude Code permission prompt — is the mutation-safety boundary. The allowlist only reduces prompts for *reads*, and whether an un-allowlisted command prompts depends on the session's mode (it is **not** a guarantee). Run the agent path with the read-only key; the config verbs below require a **write-capable** key and deliberate operator intent.

**Per-env key source:** `local` reads `STRIPE_SECRET_KEY` from `.env`; AWS envs read the `stripe-secret-key` Secrets Manager entry (cross-ref charter finding (a): not yet wired into `backend.yml` for app-dev — set it via `portalops vars set STRIPE_SECRET_KEY … --env app-dev --yes`). `prod` uses a live-mode key with `--live`, gated.

## Invariants

- **JSON is the default output** — resource commands (`events`/`subscriptions`/`customers`/`prices`/`products` `list`/`retrieve`) print JSON. There is **no `--json` flag** (`stripe events list --json` errors).
- **A price id is env-local** — never reuse a `price_…` across envs. The **lookup key** is the only stable cross-env handle (`portalops tier apply` resolves it per env).
- **Scope to one tenant** via the customer's `metadata.organizationId` (stamped by the app's `createCustomer`).
- **Select the account** with `--project-name <env>` (or `--api-key`); **test-mode is default**, add `--live` only for prod.

## Inspection operations

### List / retrieve events
```bash
stripe events list --limit 10                 # JSON by default
stripe events retrieve <event-id>
```

### Inspect a customer's subscriptions
```bash
stripe subscriptions list --customer <cus-id>
```

### Look up a customer by email (scope to an org)
```bash
stripe customers list --email user@example.com
# then correlate metadata.organizationId to confirm the tenant
```

### List prices (incl. lookup keys) and products
```bash
stripe prices list --lookup-keys <key> --active
stripe products list --limit 10
```

## Correlating events to server-side outcomes

The app records every webhook at `POST /api/webhooks/stripe` (`apps/api/src/routes/webhook.router.ts`) into the **`stripe_events`** table, one row per `event_id`, with an `outcome` of `applied | noop | unmatched | ignored | foreign`. To debug "Stripe says delivered, nothing changed": find the event via `stripe events retrieve <id>`, then check the ledger row's `outcome` (e.g. `foreign` = a subscription owned by another env/account; `unmatched` = no org for that customer). The Stripe dashboard's webhook-endpoint delivery log is the vendor-side record of delivery attempts.

## Price + lookup-key config (require a write key — not agent-auto)

These mutate Stripe. Per the [safety model](#auth), the gate is the **key**: a read-only restricted key can't run them (Stripe → permissions error); they require a **write-capable** key + deliberate operator intent, and are **not** in the agent allowlist. Do not treat the absence of a prompt as safety. Pricing lives in Stripe (resolve, never create from code).

```bash
# New tier price + lookup key
stripe prices create --product <prod-id> --currency usd --unit-amount <cents> --lookup-key <key>
# Price change: mint a new price and MOVE the lookup key to it (prices are immutable)
stripe prices create --product <prod-id> --currency usd --unit-amount <new-cents> --lookup-key <key> --transfer-lookup-key
# Move a subscription to a new price
stripe subscriptions update <sub-id> -d "items[0][price]"=<price-id>
```

## Tier price-identity flow (#218)

End-to-end, CLI-operable — the operator owns the Stripe half, `portalops tier apply` owns the DB convergence:

1. **Stripe** — create / transfer the lookup key (above); the price id is env-local, the lookup key is the handle.
2. **core** — ensure the tier entry in `packages/core/src/registries/tier-catalog.ts` references that `stripeLookupKey`.
3. **portalops** — converge: `portalops tier apply --env <env> --yes` runs a read-only `stripe.prices.list({ lookup_keys })`, resolves `lookup_key → env-local price_id`, and upserts the tier row (a declared key with no price fails closed).

See the charter's "Add a subscription tier" / "Update a tier's price" recipes for the full cross-surface sequence.

## Gotchas

- **Separate accounts per env** — a `price_…` / `cus_…` / `sub_…` from `local` does not exist in `app-dev`. Only lookup keys cross envs.
- **App key ≠ inspection key** — the app's `stripe-secret-key` is write-scoped; use a separate read-only `rk_test_…` for CLI inspection.
- **No `--json` flag** — JSON is the default; adding `--json` errors.
- **Test-mode data is disposable; prod is real billing** — always confirm mode (`--live` is opt-in) before any config verb.

## prod (pending #83)

`prod` uses a **live-mode** key (`--live`) and is gated. Its account is separate from test-mode; lookup keys are declared the same way but resolve to prod-account price ids. **Unexercised until #83.**
