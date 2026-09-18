# fleet-upgrade — Smoke Suite

Manual smoke test for [#581](https://github.com/EnterpriseBT/portal-ai/issues/581) — the per-install `db:upgrade` path (advisory-locked migrate + seed), the `lint:migrations` and backfill-coverage CI guards, the `pre-upgrade` chart job, and `portalops db upgrade`. **Branch under test:** `feat/581-fleet-upgrade` (PR [#611](https://github.com/EnterpriseBT/portal-ai/pull/611)).

**No browser surface.** This ticket is CLI/CI/chart only, so there is nothing for `/smoke-walk` (Playwright) to drive — every step below is `— manual`, run against your own stack. Steps marked `(agent-runnable)` are plain commands I can run for you on request; the cluster step (§4b) needs a real EKS/k8s and is yours.

## Preflight

### Environment

- [ ] `git checkout feat/581-fleet-upgrade && git pull --ff-only`
- [ ] `npm install`
- [ ] **No new schema migration** — this branch adds only inert comment markers to `0080`. Your local DB needs the existing migrations applied: `cd apps/api && npm run db:migrate` (once).
- [ ] `docker compose up -d postgres redis` (local DB + Redis reachable) and `DATABASE_URL` set in `apps/api/.env`.
- [ ] `helm` on PATH (`helm version --short`) for §4.

### Fixtures

- [ ] A local DB with the schema migrated and seeded at least once (`cd apps/api && npm run db:seed`). `db:upgrade` is idempotent, so a normal local DB is fine.

### Reset between runs

- [ ] None needed — `db:upgrade` is idempotent (migrate no-ops when current, seed is bootstrap-only). Re-run freely.

## §1 — `db:upgrade` entrypoint (AC1, AC7) — manual (agent-runnable)

- [ ] `cd apps/api && npm run db:upgrade` against the local DB.
- [ ] **Expected:** the final log line is `UPGRADE COMPLETE (migrations: 0, seed: ok)` (0 because your DB is already migrated), and the process **exits 0** (`echo $?` → `0`).
- [ ] Run it a **second** time immediately.
- [ ] **Expected:** identical `UPGRADE COMPLETE (migrations: 0, seed: ok)`, exit 0 — a safe no-op re-run (AC1 "re-run is a safe no-op").
- [ ] **AC7 — tiers are not converged.** Confirm the run logs no tier-policy convergence (no `tier apply` output); `db:upgrade` runs only bootstrap seeds. Tier changes still require `portalops tier apply`.

## §2 — `lint:migrations` destructive-DDL guard (AC5) — manual (agent-runnable)

- [ ] `npm run lint:migrations -- --self-test` → **Expected:** `self-test: 9 fixture(s) passed`, exit 0.
- [ ] `npm run lint:migrations` (real tree) → **Expected:** `no unacknowledged destructive DDL in migrations > 95`, exit 0.
- [ ] **Prove it bites:** create a probe `printf 'ALTER TABLE "t" DROP COLUMN "c";\n' > apps/api/drizzle/0096_probe.sql`, run `npm run lint:migrations`.
- [ ] **Expected:** it **fails** (exit non-zero) naming `0096_probe.sql:1 [DROP COLUMN]`. Then add `-- destructive-ok: probe` above the statement and re-run → **passes**. Delete the probe file.

## §3 — backfill-coverage guard (AC4) — manual (agent-runnable)

- [ ] `cd apps/api && npm run test:unit -- src/__tests__/services/seed-backfill-coverage.test.ts` → **Expected:** 3 passed (real tree covered; the `0080` markers are discovered; a synthetic non-baseline key fails).
- [ ] **Prove it bites:** temporarily add a 30th entry to `SYSTEM_COLUMN_DEFINITIONS` in `apps/api/src/services/seed.service.ts` (e.g. `key: "probe_key"`, minimal fields) and re-run the test.
- [ ] **Expected:** the "every system column key is baseline or proven by a backfill migration" case **fails**, naming the uncovered key. Revert the edit.

## §4 — chart `upgrade-job` (AC1 job shape, AC3 posture)

### §4a — render (manual, agent-runnable)

- [ ] `npm run lint:helm` → **Expected:** all checks pass, including `upgrade hook: pre-upgrade + db-upgrade command`, `migrate hook: pre-install only`, and (hooks-disabled scenario) `no migrate/seed/upgrade jobs render when disabled`.
- [ ] `helm template p deploy/helm/portalai --set image.api.repository=x --set image.api.tag=t --set image.web.repository=y --set image.web.tag=t | grep -A2 'db-upgrade.js'` → **Expected:** the upgrade Job runs `["node", "dist/scripts/db-upgrade.js"]` under `"helm.sh/hook": pre-upgrade`.

### §4b — live upgrade on a cluster (AC1 end-to-end, AC3 --atomic) — manual, needs EKS/k8s

- [ ] On a real cluster with an existing release: `helm upgrade <release> deploy/helm/portalai --atomic …` with a new image tag.
- [ ] **Expected:** the `<release>-upgrade` job runs before the API rolls; `kubectl logs job/<release>-upgrade` ends with `UPGRADE COMPLETE`; the API rolls to the new image.
- [ ] **AC3 fail-closed:** deploy a build whose migrate step fails; **Expected:** the pre-upgrade job exits non-zero, `helm upgrade --atomic` rolls the workloads back, and the previous image serves against the (expand-only) schema. *(This is the residency/app-dev cluster smoke — not verifiable on the local stack.)*

## §5 — `portalops db upgrade` (AC6) — manual (agent-runnable, local)

- [ ] `npx portalops db upgrade --env local` (after `npm run build -w @portalai/devops-cli`, per the stale-dist rule).
- [ ] **Expected:** it spawns the app's `db:upgrade` (local env has no ECS), prints `UPGRADE COMPLETE`, `--json` gives `{ "via": "local", "script": "db:upgrade" }`.
- [ ] **AC6 deployment-agnostic:** confirm the command has no `saas`/`residency` branch — routing is by env shape only (covered by unit test case 16); a residency install upgrades via Helm (§4) and never invokes this command.

## §6 — CI gates (AC8) — manual (agent-runnable)

- [ ] `npm run type-check` and `npm run lint` at repo root → both green (13/13 tasks).
- [ ] `npm run lint:migrations`, `npm run lint:helm`, `npm run lint:doc-pointers` → all green.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` → green; `cd packages/devops-cli && npm run test:unit` → green.

## §7 — Error & edge cases (AC2, AC3)

- [ ] **AC2 concurrent lock (integration-covered).** The advisory lock is exercised by `apps/api/src/__tests__/__integration__/scripts/db-upgrade.integration.test.ts` case 3 (a held lock → `acquiredLock: false`, no migrate/seed). To observe it live: hold the lock from a `psql` session — `SELECT pg_advisory_lock(1431324498, hashtext('db-upgrade'));` (`1431324498` = `0x55504752`, `UPGRADE_LOCK_NAMESPACE`) — then run `npm run db:upgrade` in another session and **Expected:** it logs `UPGRADE SKIPPED: another upgrade is already running` and exits non-zero. Release with `SELECT pg_advisory_unlock_all();`.
- [ ] **AC3 forward-only.** Confirm there is no down-migration path and the runbook/README state "a mistake is undone by a new forward migration."

## Sign-off

- [ ] Every section above verified (§4b on a cluster, or explicitly deferred to the app-dev/residency epic smoke with a recorded reason)
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (env / migration file / job name):
