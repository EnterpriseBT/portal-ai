# Stripe CLI operations guide — Smoke Suite

Manual smoke for [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) — the Stripe CLI operations runbook (`docs/STRIPE_CLI_OPS.md`), its read-only `.claude` allowlist, the charter `listen`/`trigger` repoint to #244, and the charter `--json` fix. **Branch under test:** `feat/stripe-cli-ops-guide` (PR [#245](https://github.com/EnterpriseBT/portal-ai/pull/245) → `epic/cli-first-ops`).

The deliverable is documentation + config, so this smoke proves the guide is *true*: the guide's inspection commands actually run against your **app-dev test-mode** Stripe account with JSON output, the allowlist auto-runs reads (prompt-reduction), the **read-only key** is the real mutation gate (a permission prompt is not), and the charter edits are correct. You run these against **your own** Stripe test-mode account. Boxes start unchecked; checking them is your confirmation.

## Preflight

### Environment

- [ ] `git checkout feat/stripe-cli-ops-guide && git pull --ff-only`
- [ ] `npm install` — **no build, no migration** (deliverable is a markdown doc + JSON allowlist).
- [ ] Open `docs/STRIPE_CLI_OPS.md` to follow along.

### Tooling & auth

- [ ] `stripe` CLI installed (v1.4x). **Test-mode** — do not pass `--live`.
- [ ] Authenticated to the **app-dev** test-mode Stripe account with a **read-only restricted key** (`rk_test_…`): `stripe login` (interactive) or `export STRIPE_API_KEY=rk_test_…`. `stripe config --list` shows the account. (Per the guide's auth section; `local` and `app-dev` are separate accounts.)

### Fixtures

- [ ] The account has at least one event and one price with a lookup key (any real test-mode data — these steps are read-only). If empty, `stripe trigger checkout.session.completed` once (that's a #244 local-dev command, used here only to seed an event).

### Reset between runs

- [ ] **No reset needed** — every step is read-only. (Any `prices create` in §3 is optional and clearly marked.)

## §1 — Charter edits are correct *(AC4, AC6)*

- [ ] `grep -nE 'stripe listen|stripe trigger' docs/CLI_OPERATIONS_CHARTER.md` shows both rows link **#244** (not #225). *(AC6)*
- [ ] `grep -n 'stripe .*--json' docs/CLI_OPERATIONS_CHARTER.md` returns **nothing** (the broken `--json` flag is gone), and the corrected commands run: `stripe events list --limit 10` and `stripe prices list --lookup-keys <key> --active` both return JSON (no `unknown flag` error).

## §2 — Guide is operable from the doc alone *(AC1, AC2)*

Follow **only** `docs/STRIPE_CLI_OPS.md`.

- [ ] **Events:** `stripe events list --limit 10` returns a JSON `{ "object": "list", "data": [...] }`; `stripe events retrieve <event-id>` returns one event. *(AC1)*
- [ ] **Subscriptions:** `stripe subscriptions list --customer <cus-id>` returns JSON for a known customer. *(AC2)*
- [ ] **Customer by email + org scope:** `stripe customers list --email <known-email>` returns the customer; confirm its `metadata.organizationId` matches the tenant (the guide's org-scoping note). *(AC1)*
- [ ] **Prices/products:** `stripe prices list --lookup-keys <key> --active` returns a price carrying `lookup_key`; `stripe products list --limit 10` returns products. *(confirms lookup-key inspection.)*
- [ ] **Auth worked as written:** you reached this using only the guide's read-only-key path (no `--live`).

## §3 — Tier price-identity flow (#218) is CLI-operable *(AC3)*

- [ ] Read-check: `stripe prices list --lookup-keys <tier-lookup-key> --active` resolves a price id (the handle `tier apply` consumes). *(AC3)*
- [ ] (Optional, reversible) create a throwaway: `stripe prices create --product <prod-id> --currency usd --unit-amount 100 --lookup-key smoke-throwaway`, confirm it appears, then deactivate it. Confirms the operator half of the flow.
- [ ] `npx portalops tier apply --env app-dev --dry-run` shows the convergence plan referencing lookup-key resolution (note: hangs-on-exit per #242 — `Ctrl-C` after the plan prints).

## §4 — Allowlist auto-runs reads; the read-only key gates mutations *(AC5)*

The allowlist loads at **session start**, so check the read behavior in a **fresh Claude Code session** on this branch. **The allowlist is prompt-reduction for reads — it is NOT the mutation gate.** The mutation gate is the **read-only restricted key** (Stripe rejects writes server-side); a permission prompt is *not* a reliable gate (it's bypassable per session mode).

- [ ] **Reads auto-run:** in a fresh session, an allowlisted read (`stripe events list --limit 3`) executes with **no permission prompt**.
- [ ] **The credential is the real gate:** authenticated with the **read-only restricted key** (`rk_test_…`), `stripe prices create …` (or `stripe subscriptions update …`) is **rejected by Stripe with a permissions error** — the write cannot happen regardless of any prompt. This is the server-enforced boundary.
- [ ] `jq -r '.permissions.allow[] | select(startswith("Bash(stripe"))' .claude/settings.local.json | wc -l` returns `9`, and no mutating verb (`prices create`, `subscriptions update`, `trigger`, `listen`, `login`) is allowlisted (defense-in-depth: keeps agents from *auto-running* writes even with a write key, but the key is the actual gate).

## §5 — Scope & coverage *(AC4)*

- [ ] Every **non-webhook** Stripe row in the charter's Stripe table appears in `docs/STRIPE_CLI_OPS.md` (events, subscriptions, customers, prices, products, price create, subscription update). *(AC4)*
- [ ] `stripe listen` / `stripe trigger` do **not** appear as ops in `docs/STRIPE_CLI_OPS.md` (they're deferred to #244 / `docs/LOCAL_DEVELOPMENT.md`); the guide links there.
- [ ] Mutating verbs (`prices create`, `subscriptions update`) appear only under the "require a write key" config section, with the safety-model note (key is the gate, not the prompt).

## §6 — Gotchas are real

- [ ] **Separate accounts:** a `cus_…` / `price_…` from your `local` account is **not** found in `app-dev` (`stripe customers retrieve <local-cus-id>` against app-dev errors / not found) — confirming the guide's "only lookup keys cross envs" warning.
- [ ] **No `--json`:** `stripe events list --json` errors with `unknown flag: --json` (JSON is already the default) — confirming why the charter was fixed.

## Sign-off

- [ ] §1 charter edits correct (repoint + `--json` fix)
- [ ] §2 guide operable from the doc alone (inspection reads return JSON)
- [ ] §3 tier price-identity flow runnable end-to-end
- [ ] §4 allowlist auto-runs reads (fresh session); the read-only key rejects a mutation (Stripe permissions error)
- [ ] §5 scope/coverage holds; listen/trigger deferred to #244
- [ ] §6 gotchas are real
- [ ] Any command/identifier corrections noted for the guide
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:     (e.g. §2 guide operable)
Expected:    (per docs/STRIPE_CLI_OPS.md — this exact command, this output shape)
Got:         (what actually happened)
Repro:       (exact command + env/account)
Identifiers: (account / customer / price / subscription / event ids)
Fix:         (correct the guide's command, the allowlist entry, or the charter row)
```
