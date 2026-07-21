# Stripe CLI operations guide — Discovery

**Issue:** [EnterpriseBT/portal-ai#225](https://github.com/EnterpriseBT/portal-ai/issues/225)

**Why this exists.** Stripe billing state — events, webhook deliveries, subscriptions, customers, and price/lookup-key inspection — is today read from the Stripe dashboard. The app has a shipped server-side integration (#176, `stripe.service.ts`) and in-flight tier price resolution (`portalops tier apply`, #218), but there's no documented, agent-operable runbook for operating Stripe *directly* via its CLI per environment. The #223 charter maps 9 Stripe operations and rates them operable but points here for the runbook. This is the guide that turns those rows into a real, credentialed Stripe runbook — **inspection and price/lookup-key config only**, never re-implementing the #176 runtime, and coordinating with #218 so the tier price-identity flow is CLI-operable end-to-end.

## The current shape

### Server-side Stripe (what the CLI inspects, not replaces)

| Piece | Location | Note |
|---|---|---|
| Sole SDK surface | `apps/api/src/services/stripe.service.ts:10` | customers/checkout/portal/subscriptions/prices/webhooks route through statics |
| Client init + key | `stripe.service.ts:52-62` | lazy singleton from `environment.STRIPE_SECRET_KEY`; API version pinned `"2026-06-24.dahlia"` (`:21`) |
| Config gate | `stripe.service.ts:43` | `isConfigured()` needs `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; absent → 503 but app boots |
| Webhook endpoint | `apps/api/src/routes/webhook.router.ts:237-292` | `POST /api/webhooks/stripe` — raw-body sig verify (fail-closed), 200 on handled/ignored, 500 → Stripe retries |
| Event ledger | `apps/api/src/db/schema/stripe-events.table.ts:33-39` | one row per `event_id` (unique dedup); `outcome` enum `applied\|noop\|unmatched\|ignored\|foreign` — the server-side truth to correlate CLI `events` against |

### Auth & keys

| Piece | Location | Note |
|---|---|---|
| Key guidance | `apps/api/.env.example:29-44` | test-mode keys everywhere except prod; prefer a **restricted key** (`rk_test_…`) scoped Customers/Checkout/Portal/Subscriptions **write**, Prices **read**; `stripe sandbox create` for keyless sandboxes |
| CLI-side key resolution | `packages/devops-cli/src/stripe.ts:43-57` | `resolveStripeKey`: `local` → `process.env.STRIPE_SECRET_KEY`; AWS envs → Secrets Manager `stripe-secret-key` |
| Deploy gap | `docs/CLI_OPERATIONS_CHARTER.md:180` (finding a) | `stripe-secret-key` settable via `portalops vars set` but not yet wired into `backend.yml` for app-dev |

### Tier price resolution (#218 coordination)

`portalops tier apply` (`packages/devops-cli/src/commands/tier.ts:217`) runs a **read-only Stripe phase**: collects each catalog entry's `stripeLookupKey` (`:226`), then one `stripe.prices.list({ lookup_keys, active, limit:100 })` (`stripe.ts:66-85`) → `Map<lookup_key → price_id>`; a declared key with no price → `TierApplyMissingPricesError` (`stripe.ts:21`, fail-closed before any DB write). Lookup keys are declared in `packages/core/src/registries/tier-catalog.ts:46` (the shipped `standard` row has `stripeLookupKey: null`, `:74`). **Pricing is deliberately absent from the catalog (`:8-13`) — Stripe is the record of truth; the app never creates prices, the operator does via the `stripe` CLI.**

### Charter Stripe rows + allowlist mechanism

- Charter Stripe section `docs/CLI_OPERATIONS_CHARTER.md:92-106` — **9 rows** (events list/retrieve, subscriptions list by customer, customers list by email, prices list by lookup-key, price create + lookup key, subscription update to a new price, `stripe listen --forward-to localhost:3001/api/webhooks/stripe`, `stripe trigger`), 9/9 operable. Cross-surface "add/update a tier" recipes at `:133-148` already thread `prices create … --lookup-key` / `--transfer-lookup-key` into `tier apply`.
- Allowlist: `.claude/settings.local.json` `permissions.allow` — flat `Bash(<prefix>:*)` array (mirrors the AWS guide precedent).

### Verified live (smoke §4)

Real Stripe CLI `/usr/bin/stripe` v1.43.8; test-mode key in `~/.config/stripe/config.toml` (sandbox "Portalsai sandbox"); `stripe events list` + `stripe prices list` return JSON; lookup key `standard-smoke` present. (The Stripe MCP plugin was removed — bare `stripe` runs the real CLI in a fresh session.)

## The design space

### Decision 1 — Guide location & format

**Lean: new `docs/STRIPE_CLI_OPS.md`** in the house COMMANDS style, matching the shipped `docs/AWS_CLI_OPS.md` sibling (auth preamble → invariants → identifier/mode notes → per-operation sections grouped logging / maintenance / configuration → gotchas → prod). A vendor CLI, so it stays out of the native COMMANDS.md; the charter's Stripe Guide-ref points at #225.

### Decision 2 — Auth model: mode + which key

Stripe's axis is **test-mode vs live-mode**, and each Portal env runs its own Stripe account (env-local price ids, per `TIER_CATALOG.discovery.md`). The app's key is **write-scoped** (`rk_…` write on customers/subs); a CLI *inspection* guide needs **read** scopes.

| | A: reuse the app's key | B: a separate read-only restricted key for CLI inspection |
|---|---|---|
| Scope fit | over-privileged for read-only inspection | least-privilege: Events/Subscriptions/Customers/Prices/Products **read** |
| Blast radius | app write key in operator hands | can't mutate anything |

**Lean: B.** Document a dedicated **read-only restricted key** (`rk_test_…`, read scopes) for CLI inspection, configured via `stripe login` (humans) or `~/.config/stripe/config.toml` / `--api-key` (agents/CI). Test-mode default; live key only for prod, gated. Note the app's write key is separate.

### Decision 3 — Allowlist scope (which `stripe` verbs auto-run)

| | A: read-only verbs only | B: + `prices create`/`subscriptions update` |
|---|---|---|
| Auto-run | `events list/retrieve`, `subscriptions list`, `customers list`, `prices list`, `products list`, `logs tail` | + mutating price/subscription config |
| Safety | fail-closed; config prompts | mutating prices/subs unprompted |

**Lean: A.** Only pure-read verbs in `permissions.allow`. `prices create` / `subscriptions update` (config) stay prompt-gated. **`stripe listen` / `stripe trigger` are out of #225 entirely** — they're the local inner-loop harness, now owned by [#244](https://github.com/EnterpriseBT/portal-ai/issues/244) (`docs/LOCAL_DEVELOPMENT.md`), alongside `npm run webhook:toolpack` and `npm run tunnel`.

### Decision 4 — The #218 tier price-identity flow

**Lean:** document the operator half end-to-end and point at the charter's recipe — create/transfer a lookup key with the `stripe` CLI (`prices create --lookup-key` / `--transfer-lookup-key`), then `portalops tier apply` resolves `lookup_key → price_id`. The guide owns the Stripe commands; the charter's "Add/Update a tier" recipe owns the cross-surface sequence. Reinforce "resolve, never create from code."

## Tradeoff comparison

|  | D1: standalone doc | D2: read-only inspection key | D3: read-only allowlist | D4: lookup-key flow |
|---|---|---|---|---|
| Spread to spec | Yes (layout) | Yes (auth section + scopes) | Yes (exact allow-entries) | Yes (procedure section) |

## Recommendation

1. Ship `docs/STRIPE_CLI_OPS.md` — vendor-CLI runbook in the `AWS_CLI_OPS.md` house shape: auth (test-mode default + read-only restricted key), invariants (`--api-key`/config, `--json`-style output, mode vs env, org→customer via `metadata.organizationId`), inspection ops (events, webhook deliveries, subscriptions, customers, prices), price/lookup-key config ops (prompt-gated), the #218 lookup-key procedure, gotchas, prod.
2. Recommend a **dedicated read-only restricted key** for CLI inspection, distinct from the app's write key.
3. Add a read-only `stripe` allowlist to `.claude/settings.local.json`; `create`/`update`/`trigger`/`listen` stay prompt-gated.
4. Correlate CLI `events` to the server-side `stripe_events.outcome` ledger for delivery debugging.

## Open questions

1. **Local vs app-dev Stripe accounts — RESOLVED: separate.** Confirmed by the user: `local` and `app-dev` are **separate Stripe accounts** (as are their Auth0 tenants). `local` key from `.env`, `app-dev` from Secrets Manager `stripe-secret-key`; a price id never crosses envs — only the **lookup key** does (`portalops tier apply` resolves it per env). The auth section documents per-env accounts explicitly.
2. **Exact read-only restricted-key scopes.** **Lean:** Events, Subscriptions, Customers, Prices, Products (read); add Invoices/Charges read only if a "billing state check" needs them. The spec pins the final list.
3. **`stripe listen` / `stripe trigger` — RESOLVED: out of #225.** They are the local inner-loop harness, moved to [#244](https://github.com/EnterpriseBT/portal-ai/issues/244) (`docs/LOCAL_DEVELOPMENT.md`) alongside `npm run webhook:toolpack` + `npm run tunnel`. **#225 additionally repoints the charter's two local Stripe rows' Guide-ref (`stripe listen`, `stripe trigger`) from #225 → #244** — a 2-line charter edit, so the index doesn't point at a guide that no longer documents them.
4. **The `stripe-secret-key` deploy gap (finding a).** **Lean: cross-reference only** — it's an AWS/deploy wiring concern (owned on the AWS side / #224), not fixed in #225; the guide notes app-dev's key resolves from Secrets Manager once wired.

## Enterprise-scale considerations

- **Multi-tenancy** — **Lean:** document the **org→customer correlation** (`metadata.organizationId` stamped by `createCustomer`, `stripe.service.ts:95`) so an operator scopes inspection to one tenant (`stripe customers list` → filter by metadata); Stripe ops are otherwise account/env-level, not per-org.
- **Accuracy & auditability** — **Lean:** correlate CLI `events`/deliveries to the durable `stripe_events` ledger (`outcome` enum); Stripe's own event log is the vendor record. No new audit built.
- **Failure modes** — **Lean: fail-safe by construction** — read-only restricted key + test-mode default means the inspection surface *cannot* mutate; the app's own webhook path is already fail-closed on signature.
- **Contract stability** — **Lean:** lookup-key indirection (not price ids) is the stable handle across envs; per-env key resolution (`.env` vs Secrets Manager) extends to prod unchanged.
- **Scale & unbounded growth** — **Lean:** `events`/`subscriptions` lists are paginated; show bounded `--limit` forms first.
- **Data lifecycle** — **Lean:** test-mode data is disposable; prod is real billing — emphasize test-mode default and a prod barrier on any config verb.
- **Concurrency** — N/A because this is a read/inspection docs surface with no shared mutable state (the one mutating flow, price create → `tier apply`, is already a single-transaction converge owned by #218).

## What this doesn't decide

- **The app's server-side webhook/subscription runtime (#176)** — inspection only; not re-implemented here.
- **`portalops tier apply` itself (#218)** — this guide documents the Stripe half + coordination, not the command's implementation.
- **The `stripe-secret-key` → `backend.yml` wiring (finding a)** — AWS/deploy concern, cross-referenced not fixed.
- **The local inner-loop harness (`stripe listen` / `stripe trigger`, `webhook:toolpack`, `tunnel`)** — moved to [#244](https://github.com/EnterpriseBT/portal-ai/issues/244) (`docs/LOCAL_DEVELOPMENT.md`); #225 only repoints the charter rows and cross-links.
- **Wrapping the Stripe CLI behind `portalops`** — rejected by the charter overlap rule; direct `stripe` use only.
- **Live `prod` execution** — env pending #83; prod forms documented, not exercised.

## Next step

Write `docs/STRIPE_CLI_OPS_GUIDE.spec.md` (contract: guide section layout, the read-only restricted-key scope list, exact allowlist entries, acceptance mapped to #225) and `.plan.md` (slices). Likely slicing: (1) repoint the charter's two local Stripe rows (`listen`/`trigger`) Guide-ref → #244 (small, independent); (2) `docs/STRIPE_CLI_OPS.md` — auth + invariants + inspection ops + lookup-key procedure; (3) `.claude/settings.local.json` read-only `stripe` allowlist + `jq` validity + acceptance reconcile. All land on `feat/stripe-cli-ops-guide` → base `epic/cli-first-ops`.
