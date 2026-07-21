# Stripe CLI operations guide — Spec

**Issue:** [EnterpriseBT/portal-ai#225](https://github.com/EnterpriseBT/portal-ai/issues/225) · **Epic:** #222 · **Discovery:** `docs/STRIPE_CLI_OPS_GUIDE.discovery.md`

Pins the contract for #225: a new vendor-CLI runbook (`docs/STRIPE_CLI_OPS.md`) for deployed-env Stripe **inspection + price/lookup-key config**, a read-only `stripe` allowlist in `.claude/settings.local.json`, and a Guide-ref repoint of the charter's two local-webhook rows to #244. Docs + config only — no code, no schema.

## Key decisions (flag for review)

Resolved in discovery, ratified here:

1. **Read-only restricted key for CLI inspection** — a dedicated `rk_test_…` scoped **read-only** (Events, Subscriptions, Customers, Prices, Products, Invoices, Webhook Endpoints), distinct from the app's write-scoped key. Test-mode default; live key only for prod, gated.
2. **`local` and `app-dev` are separate Stripe accounts** — per-env auth; a price id never crosses envs, only the **lookup key** does.
3. **`stripe listen` / `stripe trigger` are out of scope** — moved to #244 (`docs/LOCAL_DEVELOPMENT.md`). #225 repoints the charter's two rows (lines 105–106) `#225 → #244`.
4. **Read-only allowlist = prompt-reduction, not a gate** — inspection verbs auto-run; `prices create` / `subscriptions update` are not allowlisted. The mutation-safety gate is the **read-only restricted key** (Stripe rejects writes server-side with a permissions error), **not** a permission prompt (per `feedback_no_prompt_safety_gates` — prompting is bypassable per session mode).
5. **Inspection correlates to the server-side ledger** — the guide shows how CLI `events` map to the `stripe_events.outcome` enum (`applied|noop|unmatched|ignored|foreign`) and how to scope to one org via `metadata.organizationId`.

## Scope

### In scope
1. `docs/STRIPE_CLI_OPS.md` — the runbook (auth, invariants, inspection ops, price/lookup-key config, #218 lookup-key procedure, gotchas, prod).
2. `.claude/settings.local.json` — append read-only `stripe` allow-entries.
3. `docs/CLI_OPERATIONS_CHARTER.md` — repoint the two local-webhook rows' Guide-ref to #244.

### Out of scope
- The local inner-loop harness itself (`stripe listen`/`trigger`, `webhook:toolpack`, `tunnel`) — #244.
- The server-side webhook/subscription runtime (#176) — inspection only.
- `portalops tier apply` implementation (#218) — coordination documented, not re-implemented.
- The `stripe-secret-key` → `backend.yml` wiring (finding a) — AWS/deploy concern, cross-referenced.
- Wrapping `stripe` behind `portalops`; live `prod` execution (#83).

## Surface

### A. `docs/STRIPE_CLI_OPS.md` (new) — section layout

House COMMANDS style, matching `docs/AWS_CLI_OPS.md`. Ordered sections:

1. **Purpose & boundary** — vendor CLI for Stripe audit/inspection + price/lookup-key config, human **or** agent; not the #176 runtime; local webhook harness lives in #244.
2. **Auth** — test-mode default; a **read-only restricted key** (`rk_test_…`, scopes: Events/Subscriptions/Customers/Prices/Products/Invoices/Webhook Endpoints **read**), distinct from the app's write key. Configure via `stripe login` (humans) or `~/.config/stripe/config.toml` / `--api-key` (agents/CI). **Per-env separate accounts:** `local` key from `.env`, `app-dev` from Secrets Manager `stripe-secret-key` (cross-ref finding a: not yet wired into `backend.yml`); live key only for `prod`, gated.
3. **Invariants** — `--json` (or `-d`/`--data`) on reads; a price id is env-local (never reuse across envs); the **lookup key** is the stable cross-env handle; scope to one tenant via `metadata.organizationId`.
4. **Inspection operations** (`###` each, canonical command + note): list/retrieve **events** (`stripe events list --json`, `stripe events retrieve <id>`); inspect a customer's **subscriptions** (`stripe subscriptions list --customer <cus-id>`); look up a **customer** by email (`stripe customers list --email …`); list **prices** incl. lookup keys (`stripe prices list --lookup-keys <key> --json`); list **products**. Each notes the JSON shape.
5. **Correlating events to server-side outcomes** — map CLI `events` to the `stripe_events` ledger (`outcome` enum) and the `POST /api/webhooks/stripe` handler; how to tell "delivered but noop/unmatched/foreign".
6. **Price + lookup-key config (require a write key — not agent-auto)** — `stripe prices create --product <id> --currency usd --unit-amount <cents> --lookup-key <key>` (new tier) and `--transfer-lookup-key` (price change); `stripe subscriptions update <sub-id> -d "items[0][price]"=<price-id>`. The read-only key can't run them; not allowlisted; the prompt is not the gate.
7. **Tier price-identity flow (#218)** — end-to-end: operator creates/transfers a lookup key here → `portalops tier apply --env <env> --yes` resolves `lookup_key → env-local price_id`. Cross-link the charter's "Add/Update a tier" recipe. "Resolve, never create from code."
8. **Gotchas** — separate accounts per env (no cross-env price ids); the app's write key ≠ this read key; test-mode data disposable, prod real.
9. **prod** — live-mode key, gated; unexercised until #83.

### B. `.claude/settings.local.json` — appended `permissions.allow` entries

Append these read-only matchers (house `Bash(<prefix>:*)` shape):

```json
"Bash(stripe events list:*)",
"Bash(stripe events retrieve:*)",
"Bash(stripe subscriptions list:*)",
"Bash(stripe subscriptions retrieve:*)",
"Bash(stripe customers list:*)",
"Bash(stripe customers retrieve:*)",
"Bash(stripe prices list:*)",
"Bash(stripe prices retrieve:*)",
"Bash(stripe products list:*)"
```

**Excluded (not allowlisted — safety is the read-only key, not a prompt):** `stripe prices create`, `stripe subscriptions update`, `stripe trigger`, `stripe listen`, `stripe login`.

### C. `docs/CLI_OPERATIONS_CHARTER.md` — repoint local-webhook rows

Lines 105–106 (`stripe listen …` and `stripe trigger …`): change the Guide-ref cell `[#225](…/225)` → `[#244](…/244)`. The Command/Envs/Disposition cells stay; only the owning-guide link moves (those ops now live in the local-dev runbook).

## Migration / Seed

**None** — no DB schema change. No migration, no seed.

## TDD test plan

Docs + JSON-config ticket; no code to unit-test and no pinning test covers `docs/*.md` or `settings.local.json`. Verification:

1. **Config validity** — `jq empty .claude/settings.local.json` parses clean; `jq -r '.permissions.allow[]|select(startswith("Bash(stripe"))' | wc -l` returns `9`; excluded verbs absent.
2. **Charter repoint** — `grep -n 'stripe listen\|stripe trigger' docs/CLI_OPERATIONS_CHARTER.md` shows both rows now linking `#244`, none linking `#225`.
3. **Manual smoke** (`/smoke 225`, merge gate) — inspection reads against **app-dev test mode**: `stripe events list`, `stripe subscriptions list --customer`, `stripe prices list --lookup-keys` return JSON; confirm a lookup key resolves.
4. **Doc-consistency (manual)** — every charter Stripe *non-webhook* row appears in the guide; endpoint/ledger references match `webhook.router.ts` / `stripe-events.table.ts`.

**Totals ≈ 0 automated cases** (JSON-validity + grep + manual smoke). No jest/integration tests warranted.

## Acceptance criteria

- [ ] From `docs/STRIPE_CLI_OPS.md` alone, a human or agent authenticates to Stripe for `app-dev` (test-mode read-only key) and inspects events/subscriptions/customers/prices without the dashboard.
- [ ] Every inspection command is non-interactive and emits parseable JSON.
- [ ] The tier price-identity flow (lookup key → env price id) is documented as a CLI-operable procedure alongside #218.
- [ ] Every Stripe op the charter assigned to #225 is documented (the 7 non-webhook ops) or relocated (the 2 webhook rows → #244 via repoint).
- [ ] The 9 read-only `stripe` allow-entries exist and auto-run reads; mutations are **not** allowlisted, and a **read-only restricted key cannot perform them (Stripe permissions error)** — the credential, not a prompt, is the gate.
- [ ] The charter's `stripe listen`/`trigger` rows link `#244`, not `#225`.

## Risks & rollback

- **Wrong key scope** (a write key handed out) — mitigated by explicitly specifying a **read-only** restricted key; a read key **cannot mutate**, so the inspection surface is fail-safe by construction.
- **Cross-env price-id confusion** — mitigated by the "separate accounts, lookup-key is the only cross-env handle" invariant stated up front.
- **Rollback:** docs + config only — revert the commit; no runtime/DB impact.

## Files touched

- **NEW** `docs/STRIPE_CLI_OPS.md`
- **EDIT** `.claude/settings.local.json` (+9 read-only `stripe` allow-entries)
- **EDIT** `docs/CLI_OPERATIONS_CHARTER.md` (lines 105–106 Guide-ref → #244)
- (already committed on this branch) `docs/STRIPE_CLI_OPS_GUIDE.discovery.md`

## Next step

`docs/STRIPE_CLI_OPS_GUIDE.plan.md` (`/plan 225`) sequences ~3 slices on this branch: (1) charter row repoint (small, independent); (2) `docs/STRIPE_CLI_OPS.md` runbook; (3) `.claude/settings.local.json` allowlist + `jq` validity + acceptance reconcile. The smoke (`/smoke 225`) follows as the merge gate.
