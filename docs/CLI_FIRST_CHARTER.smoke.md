# CLI-first operations charter — Manual smoke checklist (#223)

Manual smoke for [#223](https://github.com/EnterpriseBT/portal-ai/issues/223) — the CLI Operations Charter (`docs/CLI_OPERATIONS_CHARTER.md`), a thin op→CLI index for `local`/`app-dev`. **Branch under test:** `feat/cli-first-charter` (PR [#240](https://github.com/EnterpriseBT/portal-ai/pull/240) → `epic/cli-first-ops`).

The deliverable is a document, so this smoke has two halves: a **structural review** (§1 — read the charter, confirm it is complete and self-consistent) and a **correctness walk** (§2–§6 — pick a representative row per surface and confirm its canonical `Command` actually runs against your stack and returns machine-readable output). The correctness walk is the part that proves the charter is *true*, not just filled in.

You run these against **your own** environments (real AWS creds, your Auth0 tenants, your Stripe test-mode key, your `local`/`app-dev` DB). Boxes start unchecked; checking them is your confirmation.

## Preflight

### Environment

- [ ] `git checkout feat/cli-first-charter && git pull --ff-only`
- [ ] `npm install` — **no migration, no build of app code needed** (the deliverable is a markdown doc). For the native-CLI rows, rebuild the CLIs first so `npx` doesn't run stale `dist`: `npm run build` (or build `packages/devops-cli` + `packages/admin-cli`), then invoke via `npx portalops …` / `npx portalai …`.
- [ ] Open `docs/CLI_OPERATIONS_CHARTER.md` in a viewer for §1.

### Tooling & auth (only what each surface's walk needs)

- [ ] `aws` CLI installed and authenticated to the account behind `app-dev` (SSO / `AWS_PROFILE`), region `us-east-1`.
- [ ] `auth0` CLI installed; `auth0 login` completed; the **app-dev** tenant selected (`auth0 tenants use portalsai-staging.us.auth0.com`).
- [ ] `stripe` CLI installed and configured with a **test-mode** key for the account.
- [ ] `portalops` / `portalai` authenticated for `--env app-dev` (`npx portalai login`; `aws login` fresh for infra/DB), per `packages/*/COMMANDS.md`.

### Fixtures

- [ ] An `app-dev` org + user exist to read back (any real one is fine — these steps are read-only unless noted).

### Reset between runs

- [ ] **No reset needed** — every step below is read-only **except** the clearly-marked optional mutations in §6, which are test-mode/reversible and tell you how to undo them.

## §1 — Charter structure & self-audit (read-only)

Open `docs/CLI_OPERATIONS_CHARTER.md` and confirm:

- [ ] The doc has the sections: **How to read this**, **AWS**, **Auth0**, **Stripe**, **Native**, **Common workflows**, **Overlap decisions**, **Gap list & findings**, **Coverage** — and the "How to read this" block defines the column schema, the CLI-operable predicate, the coverage formula, the guard convention, and the overlap rule (self-contained). *(AC1)*
- [ ] Every operations row has all **eight** columns filled and **no blank `Disposition`**. *(AC2)*
- [ ] The **Coverage** section reports maintenance+config `39/40 = 97.5%` (≥90%), logging `6/6`, `46/46` classified, and "no parity defects". Spot-check the per-surface table totals against the surface tables. *(AC3)*
- [ ] AWS and Auth0 tables are at least as populated as Native, and every row's `Guide ref` links to #224 (AWS) / #225 (Stripe) / #226 (Auth0) / #227 (native). *(AC4)*
- [ ] **Overlap decisions** states the compose-test rule + the three precedent rows (`vars`, `db`, `tier apply`) + the standing rule. *(AC5)*
- [ ] **Gap list & findings** carries the one non-operable row (AWS secret-injection) + finding (a) `stripe-secret-key` wiring + finding (b) audit-log reader declined, each with a disposition. *(AC6)*

## §2 — AWS surface is operable (live app-dev)

Pick representative AWS rows and confirm the canonical `Command` runs non-interactively with machine-readable output:

- [ ] **Logging:** `aws logs tail /ecs/portalai-api-dev --since 10m --format short` returns recent API log lines (add `--follow` to stream). *(AC8)*
- [ ] **Maintenance:** `aws ecs describe-services --cluster portalai-dev --services portalai-api-dev` returns JSON with a `runningCount`. *(confirms the ECS cluster/service names in the charter are correct.)*
- [ ] Confirm one identifier the charter left as `<placeholder>` (e.g. the exact S3 upload-bucket name, RDS instance id) resolves in your account — note any correction for the #224 guide.

## §3 — Auth0 surface is operable (app-dev tenant)

- [ ] `auth0 tenants use portalsai-staging.us.auth0.com` selects the app-dev tenant, then `auth0 users search --query "email:<a-known-user>" --json` returns that user as JSON. *(AC8)*
- [ ] `auth0 logs list --json` (or `auth0 logs tail`) returns tenant log events as JSON. *(AC4 — Auth0 logging is operable.)*
- [ ] Confirm `local` uses a **different** Auth0 tenant than app-dev (the charter claims they are separate) — e.g. `auth0 tenants list` shows both, and the local API's issuer is not the staging tenant.

## §4 — Stripe surface is operable (test mode)

- [ ] `stripe events list --limit 3` returns recent events (JSON). *(AC8)*
- [ ] `stripe prices list --limit 5` returns prices; confirm at least one carries a `lookup_key` (the app's handle). *(confirms the "prices resolved by lookup key" claim.)*

## §5 — Native surface is operable (app-dev)

- [ ] `npx portalops vars list --env app-dev --json` returns the config catalog as JSON (secrets masked). *(AC8)*
- [ ] `npx portalai org list --env app-dev --json` returns orgs as JSON. *(AC8)*
- [ ] `npx portalops db psql --env app-dev -- -tAc "select 1"` returns `1` through a fresh tunnel (confirms the one-shot form the charter rates operable).

## §6 — Common workflow & findings

**"Add a subscription tier" recipe** (verify each step is runnable; the create is test-mode + reversible):

- [ ] Step 1 read-check: `stripe prices list --json` works, so you could `stripe prices create … --lookup-key <throwaway>` (optionally do it in **test mode** with a throwaway lookup key, then delete/deactivate it after). *(AC7 step 1)*
- [ ] Step 3 read-check: `npx portalops tier apply --env app-dev --dry-run` (if `--dry-run` exists) or against `local` shows the convergence plan without erroring. *(AC7 step 3)*

**Finding (a) — `stripe-secret-key` wiring:**

- [ ] `npx portalops vars set STRIPE_SECRET_KEY <test-value> --env app-dev --yes` succeeds (the **config-value half is operable**), and `~/.portalai/audit.log` gains a `vars set` line with **no value** in it. *(Reset: re-set it to the correct value, or leave if not yet provisioned.)*
- [ ] Confirm the **wiring half is genuinely missing**: `infra/cloudformation/backend.yml` has no Stripe secret `ValueFrom` (so the running app-dev task would not receive it) — matching finding (a)'s disposition.

**Finding (b) — audit-log reader declined:**

- [ ] `~/.portalai/audit.log` exists and gains lines as you run mutating commands, and there is **no** `portalops audit` / `portalai audit` read command (`--help` shows none) — confirming the log is intentionally write-only.

## §7 — Reader/agent usability

- [ ] Pick an arbitrary operator task not walked above (e.g. "force a redeploy of the API"), find its row in the charter, and confirm you can either run the canonical `Command` or follow its `Guide ref` — with no ambiguity about which CLI owns it. *(AC8 end-to-end.)*

## Sign-off

- [ ] §1 structural review verified
- [ ] §2–§5 one representative operable row per surface actually ran and returned machine-readable output
- [ ] §6 workflow steps runnable; both findings confirmed as described
- [ ] §7 an unrehearsed task was answerable from the charter
- [ ] Any command/identifier corrections noted for the owning guide (#224–#227)
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:        (e.g. §2 AWS)
Charter row:    (the Operation cell)
Expected:       (per the charter — operable, this exact command, this output shape)
Got:            (what actually happened)
Repro:          (exact command + env)
Fix:            (correct the row's Command/Operable?/Disposition, or route to the owning guide #224–#227)
```
