# tier-catalog — Smoke Suite

Manual smoke test for [#218](https://github.com/EnterpriseBT/portal-ai/issues/218) — the declarative tier catalog (`packages/core/src/registries/tier-catalog.ts`) + `portalops tier apply`: resolve-only convergence of declared tier rows per environment (dry-run/diff, fail-closed on missing Stripe prices, converge-declared-only, per-slug audit), seed demoted to bootstrap-only. **Policy lives in git; pricing lives in Stripe; apply is the join.**

**Branch under test:** `feat/tier-catalog` (PR [#228](https://github.com/EnterpriseBT/portal-ai/pull/228) into `epic/subscription-billing`).

Run **§Preflight** once. §1–§2 and §4–§5 need only the local dev DB; **§3 needs your Stripe test-mode account** (the #176 sandbox) and involves a temporary, uncommitted catalog edit — revert it at the end of §3.

Acceptance-criterion "suites + lint/type-check green" is CI's half of the merge gate. The webhook's warn-and-keep on a rotated-away price id (AC 5, second half) is pinned by unit test (`billing.service.test.ts` "post-rotation…") — staging a live old-price subscription is disproportionate; the Stripe-side half of rotation is walked in §3c.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout feat/tier-catalog && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core --workspace=@portalai/devops-cli` — `npx portalops` runs `dist/`, so both the new core registry and the CLI must be freshly built. **No migration** (no schema change this ticket).
- [x] Dev DB up (docker-compose Postgres). The walkthrough drives psql + the CLI directly; the web/API stack is only needed for §4's seed step (`apps/api` scripts).
- [x] `export DATABASE_URL=postgresql://postgres:postgres@postgres:5432/portal_ai` in the shell you'll run `portalops` from (`--env local` reads the process env).

### Fixtures

- [x] The seeded `standard` tier row (any dev DB post-`db:seed`). §2 creates its own ad-hoc row; §3 needs a Stripe **test-mode** secret (an `rk_` with Prices read is enough) + the Stripe CLI or dashboard.

### Reset between runs

- [x] §1/§2 are self-restoring if walked to the end. After §3, revert the temporary catalog edit (`git checkout -- packages/core/src/registries/tier-catalog.ts`) and rebuild core + devops-cli.

## §1 — Dry-run, converge, idempotence, audit (spec AC 1, 2)

- [x] Baseline: `npx portalops tier apply --env local --dry-run` → `standard: noop`, `dry run — nothing written`.
- [x] Drift a policy field: `psql "$DATABASE_URL" -c "UPDATE tiers SET selectable = false WHERE slug='standard';"`
- [x] `npx portalops tier apply --env local --dry-run` → `standard: update` with exactly `selectable: false → true`; psql confirms the row is **still** `selectable = false` (dry-run wrote nothing).
- [x] Real run: `npx portalops tier apply --env local --json` → `{"dryRun":false,"changes":[{"slug":"standard","action":"update","fields":{"selectable":{"from":false,"to":true}},...}],"unmanaged":[]}`.
- [x] psql: `selectable = t`, `updated_by = 'portalops'`, `updated` freshly stamped.
- [x] Idempotence: run the same apply again → `standard: noop`; `tail -1 ~/.portalai/audit.log` shows the **first** apply's record (`"command":"tier apply","args":{"slug":"standard","action":"update","fields":["selectable"]}`) and no second record for the noop run.

## §2 — Undeclared rows are invisible (spec AC 4)

- [x] Insert an ad-hoc enterprise row: `psql "$DATABASE_URL" -c "INSERT INTO tiers (id, created, created_by, slug, display_name, period_kind, period_anchor_day, overage, selectable, builtin_toolpacks, custom_toolpacks) VALUES (gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'SMOKE', 'enterprise-acme', 'Acme Deal', 'monthly', 1, 'hard-deny', false, '[\"web_search\"]'::jsonb, true);"`
- [x] `npx portalops tier apply --env local` → output lists `unmanaged (untouched): enterprise-acme`; `standard: noop`.
- [x] psql: the `enterprise-acme` row is byte-identical (no `updated`/`updated_by` stamps), and repeat applies never touch it.
- [x] Clean up: `psql "$DATABASE_URL" -c "DELETE FROM tiers WHERE slug='enterprise-acme';"`

## §3 — Stripe lookup-key resolution (spec AC 3, 5-Stripe-half) — test-mode account required

Temporary catalog edit (uncommitted): in `packages/core/src/registries/tier-catalog.ts`, set the standard entry's `stripeLookupKey: "standard-smoke"`, then rebuild (`npm run build --workspace=packages/core --workspace=@portalai/devops-cli`).

### §3a — Fail-closed on a missing price

- [x] With `STRIPE_SECRET_KEY=<your test key>` exported and **no** price carrying `standard-smoke` in the account: `npx portalops tier apply --env local --dry-run` → exits non-zero with `No Stripe price found for lookup key(s): standard-smoke` + the runbook pointer; psql confirms zero row changes.
- [x] Unset `STRIPE_SECRET_KEY` and run again → typed `ENV_NOT_CONFIGURED` error naming the variable (the key is only demanded when the catalog has lookup keys).

### §3b — Resolution adopts the env-local price id

- [x] Create the price (Stripe CLI): `stripe prices create -d "product_data[name]=Standard (smoke)" -d "unit_amount=900" -d "currency=usd" -d "recurring[interval]=month" -d "lookup_key=standard-smoke"` (or dashboard equivalent). Note the `price_…` id.
- [x] Re-export the key; `npx portalops tier apply --env local` → `standard: update` with `stripePriceId: null → "price_…"`; psql shows `stripe_price_id` = that id.
- [x] Re-run → `noop` (resolution is stable).

### §3c — Rotation runbook (Stripe-side price change)

- [x] `stripe prices create -d "product=<product id from §3b>" -d "unit_amount=1900" -d "currency=usd" -d "recurring[interval]=month" -d "lookup_key=standard-smoke" -d "transfer_lookup_key=true"` — the lookup key moves to the new price.
- [x] `npx portalops tier apply --env local` → `standard: update`, `stripePriceId: "price_old" → "price_new"`. The old price still exists in Stripe (existing subscriptions would stay on it — the webhook's warn-and-keep for that case is unit-pinned).
- [x] **Revert**: `git checkout -- packages/core/src/registries/tier-catalog.ts`, rebuild core + devops-cli, run apply once more → `stripePriceId: "price_new" → null` (a null lookup key converges the price id away). Archive the smoke prices in Stripe if you like the sandbox tidy.

## §4 — Seed is bootstrap-only (spec AC 6)

- [x] Drift again: `psql "$DATABASE_URL" -c "UPDATE tiers SET selectable = false WHERE slug='standard';"`
- [x] `cd apps/api && npm run db:seed` → completes; psql: `selectable` is **still false** (seed no longer converges anything; the API log-style warn about unlisted packs is unrelated and fine).
- [x] `npx portalops tier apply --env local` → heals it back to `true` (apply, not seed, is the convergence path).
- [x] Fresh-DB bootstrap (optional — pinned by integration test): after any full `portalops db reset --env local --yes` + `db:migrate` + `db:seed`, the `standard` row carries the catalog's values (metered 2500/20, expensive 300/5, all packs, `custom_toolpacks = t`, `stripe_price_id` NULL).

## §5 — Config-catalog surface (spec AC 7)

- [x] `npx portalops vars describe --env app-dev` (offline — fetches no values) lists `STRIPE_SECRET_KEY  secret  portalai/dev/stripe-secret-key` among the managed keys.

Walk notes (2026-07-18): all sections green. Two walk-borne fixes landed on the branch: the all-noop run footer now reads "nothing to apply — already converged" (was "applied"), and the runbook gained the default-price archiving caveat (a `product_data`-created price can't be archived until its product is).

## Sign-off

- [x] §1 (dry-run/converge/idempotence/audit) — diff-first, one audit record per change, noop is silent.
- [x] §2 (unmanaged) — ad-hoc rows immune and listed.
- [x] §3 (Stripe) — fail-closed missing price; adoption; rotation re-points; revert converges to null.
- [x] §4 (seed) — drift survives db:seed; apply heals; bootstrap sources the catalog.
- [x] §5 (vars) — STRIPE_SECRET_KEY is a managed key.
- [x] 2026-07-18 Ben Turner — confirmed against my own running stack + Stripe test sandbox (walked live with session-verified CLI/psql/audit/Stripe checks; smoke prices archived after).

## Bug-filing template

```
**Section:** §<X> · **Step:** <which>
**Expected:** <doc says> · **Got:** <CLI output / psql rows / audit lines>
**Repro:** <exact command + DB state>
```
