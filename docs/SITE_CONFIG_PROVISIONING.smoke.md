# site_config_provisioning — Smoke Suite

Manual smoke test for [#319](https://github.com/EnterpriseBT/portal-ai/issues/319) — fresh-environment site-config provisioning: a deploy **preflight** that names the exact `portalops` remediation, a **`workflow_run` ordering** flip so the site deploy waits for `Deploy Dev`, and a **create-if-absent contact seed** on the dev pipeline. **Branch under test:** `fix/site-config-provisioning` (PR [#323](https://github.com/EnterpriseBT/portal-ai/pull/323)).

Run **§Preflight** once. **§1 is local and can be walked now.** **§2–§4 exercise deploy behavior** — `workflow_run` only fires from `main` and the seed runs inside `Deploy Dev`, so those are walked **after this PR merges** (mirrors `MARKETING_SITE.smoke.md`'s post-merge sections). Nothing here changes the app or the API contract — this is CI/infra only.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout fix/site-config-provisioning && git pull --ff-only`
- [ ] `npm install` — no build/migrate needed; **no DB migration on this branch** (infra/CI only, no schema change).
- [ ] The preflight script is a plain Node ESM script — `node --version` ≥ 20.

### Credentials (only §3 and the live §1d/§4b options)

- [ ] For steps that read/write app-dev SSM or run `portalops`: `aws login --remote` in a real terminal, then `eval "$(aws configure export-credentials --format env)"` in this shell (the JS SDK needs env creds). Confirm `aws sts get-caller-identity` resolves.
- [ ] `portalops` reads run from `dist/` — `npm run build --workspace=@portalai/devops-cli` if you changed its source (you didn't on this branch, so the published dist is fine).

### Reset between runs

- [ ] §1 is read-only against api-dev — no reset. If you walk the optional live §1d (temporarily clearing a contact), **restore it** with the `portalops vars set` command the step gives you before moving on.

---

## §1 — The preflight classifier + runner (local, now) · AC 3, AC 5

### §1a — Unit cases (the remediation copy)

- [ ] `cd apps/site && npm run test:unit -- preflight` → **7 passed**. Skim the case names: empty tiers → `tier apply`; `SITE_CONFIG_CONTACT_UNRESOLVED` → both `vars set SUPPORT_EMAIL`/`SALES_EMAIL`; the prod case adds `--confirm-prod`; `SITE_CONFIG_PRICE_UNRESOLVED` names the slug; `401`/`502` name the status; a malformed 200 body fails safely (no throw).

### §1b — Healthy live endpoint passes (AC 3 pass-path, AC 5)

- [ ] From repo root:
  ```
  SITE_CONFIG_URL='https://api-dev.portalsai.io/api/public/site-config' \
  PORTALOPS_ENV='app-dev' IS_PROD='false' \
  node apps/site/scripts/preflight-site-config.mjs; echo "exit=$?"
  ```
  → prints `site-config preflight OK — …` and `exit=0`. (app-dev is provisioned, so the healthy path is the expected one.)
- [ ] Confirm the app-dev site itself is unchanged by this branch: `curl -s https://site-dev.portalsai.io/pricing/ | grep -oE '\$19|\$49|Free'` still shows the real figures — the preflight/ordering/seed work does not alter published HTML.

### §1c — Unreachable endpoint retries then fails actionably (runner path)

- [ ] ```
  SITE_CONFIG_URL='http://127.0.0.1:9/nope' PORTALOPS_ENV='app-dev' IS_PROD='false' \
  PREFLIGHT_RETRIES=1 PREFLIGHT_RETRY_MS=200 \
  node apps/site/scripts/preflight-site-config.mjs; echo "exit=$?"
  ```
  → logs one `retry 1/1`, then `::error::site-config preflight failed: the endpoint returned 0`, and `exit=1`.

### §1d — (optional, live) the real CONTACT_UNRESOLVED message (AC 3 fail-path)

> Disruptive — it briefly clears an app-dev contact. Only if you want the live 503 path; §1a already asserts the message content.

- [ ] Clear one contact: `npx portalops vars set SUPPORT_EMAIL "" --env app-dev --yes` (or delete the SSM param). Wait ~60s for the endpoint's snapshot cache.
- [ ] Re-run §1b's command → it now fails with `::error::…SITE_CONFIG_CONTACT_UNRESOLVED` and a `Remediation:` block naming `portalops vars set SUPPORT_EMAIL <address> --env app-dev --yes` **and** the `SALES_EMAIL` line, `exit=1`.
- [ ] **Restore:** `npx portalops vars set SUPPORT_EMAIL support@portalsai.io --env app-dev --yes`; re-run §1b → back to `OK`.

---

## §2 — Deploy ordering (after merge to `main`) · AC 2

> `workflow_run` fires only from the default branch, so this is observable only once the PR is on `main`.

- [ ] After merge, note the two workflows on the merge push: `Deploy Dev` runs; **`Deploy Site (dev)` does NOT start immediately on the push** (its `push` trigger is gone).
- [ ] When `Deploy Dev` **completes successfully**, `Deploy Site (dev)` starts — its run's trigger shows **`workflow_run` / "Deploy Dev"** (Actions UI → the site run → "triggered via workflow_run"). No `401` appears in its `Preflight site-config`/`Build site` logs (the API is already deployed).
- [ ] Force the negative gate once: if a `Deploy Dev` run **fails/cancels**, confirm `Deploy Site (dev)` is **skipped** (the job `if:` gate), not run against a half-deployed API.
- [ ] The other triggers still work: `Run workflow` (manual `workflow_dispatch`) on `Deploy Site (dev)` still deploys; a `portalops vars set … --env app-dev` still fires the `repository_dispatch` rebuild.

---

## §3 — Contact seed, create-if-absent (after merge, needs AWS) · AC 1

- [ ] In a post-merge `Deploy Dev` run, open the **"Seed contact config (create-if-absent)"** step log. Because app-dev already has operator values, it prints `…/support-email already set — leaving operator value` for both leaves (it did **not** overwrite).
- [ ] **No-overwrite invariant:** `aws ssm get-parameter --name /portalai/dev/support-email --query Parameter.Value --output text` still returns `support@portalsai.io` (your operator value), unchanged by the deploy.
- [ ] **(optional) create-path:** to see the seed actually write, delete one param first — `aws ssm delete-parameter --name /portalai/dev/sales-email` — then re-run `Deploy Dev` (`Run workflow`). The step log now prints `seeded /portalai/dev/sales-email`, and `get-parameter` returns `sales@portalsai.io`. (Then re-set your intended value if different.)
- [ ] The step exists **only** in the dev pipeline: `grep -rl "Seed contact config" .github/workflows` → only `deploy-dev.yml`.

---

## §4 — Prod fail-closed & edges · AC 4

- [ ] **Prod does no seeding (structural):** confirm no prod workflow seeds contacts — the check above (`grep -rl "Seed contact config" .github/workflows` → only `deploy-dev.yml`) is the proof; `deploy-site-prod.yml` / any prod backend deploy carry no seed step.
- [ ] **Prod remediation copy (local):** simulate the prod preflight against a 503 shape by pointing at any URL that 503s, or trust §1a case 4 — the `--confirm-prod` flag is present in the prod remediation. Concretely, `deploy-site-prod.yml` passes `portalops-env: prod`, and `deploy-static-site.yml` derives `IS_PROD` from `environment == 'prod'`, so a prod deploy with unset contacts fails the preflight with a `portalops vars set … --env prod --yes --confirm-prod` message (fail-closed preserved — no placeholder is ever seeded in prod).
- [ ] **Retry bound:** the runner never hangs — §1c already showed the bounded retry (`PREFLIGHT_RETRIES`) exits after N attempts.

---

## Provisioning notes (operator-facing)

> These document the **deferred** slice-3-of-discovery scope (auto `tier apply`), so the gap is known, not surprising.

- [ ] Understand the standing manual step: on a **truly fresh** environment the DB seed publishes only the **Standard (free)** tier. The **paid tiers** (`plus`/`pro`/`enterprise`) appear on the pricing page only after an operator runs `portalops tier apply --env <env> --yes` — which resolves that env's Stripe prices (`plus_monthly`/`pro_monthly`) and **fails closed** if they don't exist yet. Auto-running `tier apply` at bootstrap is intentionally out of scope here (it depends on per-env Stripe price provisioning; see #319 → Out of scope and #83).
- [ ] If a fresh env's `/pricing/` shows only the Free tier (or the preflight reports empty tiers), the remediation the preflight prints — `portalops tier apply --env <env> --yes` — is the expected operator action, not a bug.

---

## Sign-off

- [ ] §1 (preflight local) verified.
- [ ] §2 (deploy ordering, post-merge) verified.
- [ ] §3 (contact seed, post-merge) verified.
- [ ] §4 (prod fail-closed & edges) verified.
- [ ] Provisioning notes read and understood.
- [ ] <date + name> — confirmed against my own running stack / the post-merge `main` deploys.

## Bug-filing template

Section: · Expected: · Got: · Repro (command / run URL): · Identifiers (workflow run id / SSM param / env):
