# db-secret-rotation — Smoke Suite

Manual smoke test for [#500](https://github.com/EnterpriseBT/portal-ai/issues/500) — rotation-proof DB credentials: the app resolves its password per new connection from the RDS-managed master secret; the CLI composes live. **Branch under test:** `fix/db-secret-rotation` (PR [#501](https://github.com/EnterpriseBT/portal-ai/pull/501)).

This suite is a **rollout walkthrough**: its centerpiece (§3) deliberately forces a real rotation of app-dev's database master password — that is the exact event the fix must absorb. Prod's §5 closes on the *natural* rotation of **2026-09-08**.

## Preflight

### Environment

- [ ] CI green on PR #501 (`gh pr checks 501`) — no migration on this branch
- [ ] AWS authenticated (`aws sts get-caller-identity`) — manual (operator credentials)

### Fixtures

- [ ] None to create — §3–§5 run against the real app-dev/prod stacks

### Reset between runs

- [ ] §2 read-only. §3's forced rotation is not reversible (nor needs to be — the new password is authoritative the moment it exists); re-running §3 just rotates again.

## §1 — Artifacts + gates (AC1, AC6)

- [ ] All three CI checks pass on the merge commit (`gh pr checks 501` / the merged run on `main`)
- [ ] `docs/PROD_PROVISIONING.runbook.md` §10 and `packages/devops-cli/COMMANDS.md` describe the shipped contract: connect commands compose live, `--db-name postgres` is the bootstrap hatch, `database-url` is a bootstrap artifact whose password freshness no longer matters — manual read

## §2 — Local inertness (AC3)

- [ ] With no `DB_MASTER_SECRET_ARN` in `.env`, `npm run dev` boots and serves DB-backed endpoints exactly as before (e.g. `curl localhost:3001/api/health` → 200 and any authenticated list endpoint works) — and no AWS SDK call is attempted (no credential errors in API logs)
- [ ] `npx portalops db psql --env local -- -c "SELECT 1"` still uses the `.env` `DATABASE_URL` untouched (local branch unchanged)

## §3 — app-dev: forced-rotation absorption (AC2) — the centerpiece

Pre-step: PR merged → `deploy-dev` (auto on push to `main`) completes, so app-dev tasks run the new code **and** the new task definition (`DB_MASTER_SECRET_ARN` + task-role grant).

- [ ] Baseline: `curl https://api-dev.portalsai.io/api/public/site-config` → 200 (a DB-backed read)
- [ ] Force the rotation: `aws secretsmanager rotate-secret --secret-id "$(aws cloudformation list-exports --query "Exports[?Name=='dev-DbMasterSecretArn'].Value" --output text)"` and wait for `LastRotatedDate` to advance (`describe-secret`)
- [ ] **Without any restart or repair**, within one TTL window (≤5 min): `site-config` (and other DB-backed endpoints) still 200 on fresh connections
- [ ] CloudWatch logs for the app-dev API task show exactly one `rotation absorbed — database password re-fetched and changed` warn per task, and no sustained `password authentication failed` stream
- [ ] `portalops db psql --env app-dev --yes -- -c "SELECT 1"` works immediately post-rotation with **no** `db url --write` re-run (AC5)

## §4 — Operator CLI surfaces (AC5 + diff sweep)

- [ ] `portalops db url --env app-dev` prints the redacted composed URL (unchanged shape); `--write` still stores the bootstrap artifact and audits
- [ ] The new `--db-name` flag: `portalops db psql --env app-dev --yes --db-name postgres -- -c "SELECT current_database()"` → `postgres` (the bootstrap hatch works end-to-end)

## §5 — prod rollout + the natural-rotation close (AC4)

- [ ] Prod deploy (manual trigger from `main`, with the environment approval) completes **before 2026-09-08**; task definition carries `DB_MASTER_SECRET_ARN` (`aws ecs describe-task-definition` or the deploy diff)
- [ ] Prod still healthy post-deploy: `api.portalsai.io/api/health` 200, `api/public/site-config` 200
- [ ] **On/after 2026-09-08:** the natural rotation passes with no incident — `site-config` stays 200, one `rotation absorbed` warn per task in prod logs, `db psql --env prod --yes --confirm-prod` works with no repair. This box is the ticket's closing observation — manual (calendar)

## Sign-off

- [ ] Every section above verified (or its blocker/date named inline)
- [ ] <date + name> — confirmed against the live environments

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (secret ARN / task id / log stream):
