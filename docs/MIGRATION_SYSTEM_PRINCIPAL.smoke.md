# migration-system-principal — Smoke Suite

Manual smoke test for [#952](https://github.com/EnterpriseBT/portal-ai/issues/952): every migration runner passes the environment's system principal, migration 0133 relabels the literal `'SYSTEM'`/`'system'` rows, `lint:migrations` stops new literals, and CLI-spawned scripts get the target env's `SYSTEM_ID`. **Branch under test:** `fix/952-migration-system-principal` (PR [#954](https://github.com/EnterpriseBT/portal-ai/pull/954)).

Almost nothing here is in the browser: the change lives in the migration runner, SQL, a lint script and the CLI. Tags:
- Untagged steps are terminal commands the agent can run and report evidence for, on request.
- `— manual` steps need you: a CLI login session, AWS access, or a release.
- `— post-merge` steps run after #954 merges; `— post-release` after the next prod release.

## Preflight

### Environment

- [ ] `git checkout fix/952-migration-system-principal && git pull --ff-only`
- [ ] `npm install`
- [ ] `apps/api/.env` has `SYSTEM_ID="SYSTEM"` (from `.env.example`)
- [ ] Migration: **0133** (`0133_repair-system-principal.sql`). §1 applies it.

### Fixtures

- [ ] The test Postgres container `portalai-postgres-test-1` is running. The scratch databases in §2 live there and are dropped at the end.
- [ ] The audit query from #952's comment is saved locally as `sysid-audit.sql`. It's SELECT-only, and runs with `-v sid=<principal>`.
- [ ] For §5: an active `portalai login --env app-dev` session — manual
- [ ] For §6 and §7: AWS credentials (`aws login --remote`, then `eval "$(aws configure export-credentials --format env)"`) — manual

### Reset between runs

- [ ] §2: `docker exec portalai-postgres-test-1 psql -U postgres -c "DROP DATABASE IF EXISTS smoke952"` (and `smoke952b`).
- [ ] §4: delete any scratch `apps/api/drizzle/0134_*.sql`.
- [ ] §5: soft-delete the scratch org (`portalai org delete <id> --env app-dev --yes`), and set `apps/api/.env` back to `SYSTEM_ID="SYSTEM"`.
- [ ] §1 and §3 change the dev DB and the Helm install once, by applying 0133. A re-run is a no-op.

## §1 — Local `db:migrate` runs `db-migrate.ts` and applies 0133

- [ ] In `apps/api`, run `npm run db:migrate`. The log shows `module: "db-migrate"`, `migrationsFolder: "/workspace/apps/api/drizzle"`, then `Migrations completed`. No drizzle-kit banner (`Reading config file`).
- [ ] Run `psql "$DATABASE_URL" -tAc "SELECT tag FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1"`, or check the journal: the newest applied migration is 0133. `psql "$DATABASE_URL" -tAc "SELECT proname FROM pg_proc WHERE proname='portalai_system_id'"` prints `portalai_system_id`.
- [ ] Run `psql "$DATABASE_URL" -v sid=SYSTEM -f sysid-audit.sql`. Every row of the per-table table shows `lit_lower = 0` and `lit_upper = 0`. Before this branch, the RBAC tables showed `lit_lower = 1`.

## §2 — A fresh install relabels under a UUID, and refuses without a principal

- [ ] **Fresh DB, UUID principal.**
  1. Create the scratch DB: `docker exec portalai-postgres-test-1 psql -U postgres -c "CREATE DATABASE smoke952"`.
  2. Run `DATABASE_URL=postgresql://postgres:postgres@postgres-test:5432/smoke952 SYSTEM_ID=5f0c2a7e-0000-4000-8000-000000000000 npm run db:migrate`. It ends `Migrations completed`.
- [ ] Run `docker exec portalai-postgres-test-1 psql -U postgres -d smoke952 -tAc "SELECT created_by FROM tiers WHERE slug='standard'"`. It prints `5f0c2a7e-0000-4000-8000-000000000000`, not `SYSTEM`: 0065 wrote the literal, and 0133 relabeled it on the same install.
- [ ] **No principal.**
  1. Create a second scratch DB, `smoke952b`.
  2. Run `DATABASE_URL=…/smoke952b SYSTEM_ID= npm run db:migrate; echo "exit=$?"`. The empty value wins over `.env`, because dotenv doesn't overwrite a set variable.
  3. It logs `Migration failed … SYSTEM_ID is required: the system principal for platform-created rows`, with `exit=1`.
- [ ] Run `docker exec portalai-postgres-test-1 psql -U postgres -d smoke952b -tAc "SELECT count(*) FROM information_schema.schemata WHERE schema_name='drizzle'"`. It prints `0`: the runner refused before connecting, so nothing was applied.
- [ ] Clean up: drop `smoke952` and `smoke952b`.

## §3 — The Helm install's upgrade job applies 0133

- [ ] From the repo root:
  1. Build the image: `docker build -f apps/api/Dockerfile --build-arg BUILD_VERSION=952 -t portalai-api:952 .`
  2. Upgrade the install: `helm upgrade portalai deploy/helm/portalai -n portalai -f <your install's values file> --set-string image.api.tag=952 --atomic`
  3. Check the job's log: `kubectl logs -n portalai -l job-name --tail=20 | grep UPGRADE` shows `UPGRADE COMPLETE (migrations: 1, seed: ok)`.
- [ ] `/api/health` on the install reports `"version":"952"`. Signing in at http://portalai.localhost as `walk946` and opening the Profile and Stations pages works as before.
- [ ] `helm template portalai deploy/helm/portalai --set config.SYSTEM_ID=other` fails with `config.SYSTEM_ID must be "SYSTEM": the chart owns the system principal (#953 tracks a per-install id), so leave it out`. That's the reworded message, with the same refusal.

## §4 — `lint:migrations` refuses a new literal

- [ ] `npm run lint:migrations` (repo root) prints `self-test: 16 fixture(s) passed` and `… no literal system principal in migrations > 133`.
- [ ] Create a scratch file: `printf "INSERT INTO \"t\" (\"n\", \"created_by\") VALUES ('a--b', 'SYSTEM');\n" > apps/api/drizzle/0134_smoke.sql`. Then `npm run lint:migrations` fails with:
  - `1 literal system principal(s) in new migrations:`
  - `0134_smoke.sql:1`
  - the `portalai_system_id()` hint
- [ ] Change the literal to `portalai_system_id()`; the lint passes. Add `-- principal-literal-ok: smoke` above a `'system'` line; it passes. Delete the file.

## §5 — Spawned scripts write the target env's principal — manual

- [ ] Set `apps/api/.env` to `SYSTEM_ID="LOCAL-PROBE-952"`, so a leak of the local value is visible.
- [ ] Run `npx portalai seed org --name smoke952 --env app-dev --yes --json`. Note the `organizationId`.
- [ ] Read back, read-only: `npx portalops db psql --env app-dev -- -tAc "SELECT created_by FROM stations WHERE organization_id='<id>'"`. It prints `SYSTEM` (app-dev's SSM value), **not** `LOCAL-PROBE-952`.
- [ ] Clean up:
  1. `npx portalai org delete <id> --env app-dev --yes`
  2. Set `apps/api/.env` back to `SYSTEM_ID="SYSTEM"`.

## §6 — app-dev after merge — post-merge, manual

- [ ] After #954 merges, `deploy-dev` runs. Its "migrate" step (ECS one-off, `node dist/scripts/db-migrate.js`) succeeds.
- [ ] Re-run the audit on app-dev, read-only: `npx portalops db psql --env app-dev -- -v sid=SYSTEM -f sysid-audit.sql`. Every table shows `lit_lower = 0`. Before: roles 15, policies 15, attachments 15, statements 180, user_role 6.

## §7 — prod after the next release — post-release, manual

- [ ] After the release's migrate step succeeds, re-run the audit read-only:
  ```
  npx portalops db psql --env prod --confirm-prod -- -v sid=<prod SYSTEM_ID> -f sysid-audit.sql
  ```
  - `column_definitions(system)` shows `lit_upper = 0`, where it was 29 before.
  - The RBAC rows show `lit_lower = 0`, where they were 21/21/21/252/7.
  - `tiers` shows `lit_upper = 0`, where it was 1.
  - The member-impact list ("orgs whose system column definitions a member can't read") is empty.
- [ ] The prod Demo org's stations, views, connectors and entities carry prod's principal (`SELECT created_by, count(*) … WHERE organization_id='a02ae918-…'`, per table). Its `entity_records` still read `SYSTEM`, by design.
- [ ] Post both results as a comment on #952.

## §8 — Error & edge cases

- [ ] **A runner that forgot the setting** (spec Risk 1): run `psql` against the dev DB with `-c "SELECT portalai_system_id()"`, without the setting. It raises `portalai.system_id is not set: run migrations through db-migrate (#952)`.
- [ ] **Excluded tables** (spec Risk 2): on the dev DB after §1, `SELECT count(*) FROM audit_log WHERE created_by IN ('SYSTEM','system')` returns the same count as before §1. (Note it before §1, or accept 0 if there are none.) `entity_records` isn't rewritten: any `SYSTEM` records keep it.

## Sign-off

- [ ] Every section above verified; §6 and §7 after merge and release, recorded on #952
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
