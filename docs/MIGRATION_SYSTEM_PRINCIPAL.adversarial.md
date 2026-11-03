# migration-system-principal — Adversarial Review

Adversarial probes for [#952](https://github.com/EnterpriseBT/portal-ai/issues/952): migration 0133 relabels literal system principals to the environment's `SYSTEM_ID` (carried as the `portalai.system_id` setting), and spawned CLI scripts inject the target env's id. **Branch under test:** `fix/952-migration-system-principal` (PR [#954](https://github.com/EnterpriseBT/portal-ai/pull/954)).

The change has no UI of its own, so almost every probe is `— backend`: a migrate, psql, lint or CLI run against a scratch DB or a target env. The one browser probe (§5) checks that relabeled system rows stay inside their org.

## Preflight

### Environment
- [ ] On the branch, `npm install`, with the dev DB migrated (0133 applied; smoke §1).
- [ ] The test Postgres container `portalai-postgres-test-1` is up for the scratch DBs. Below, `P="docker exec portalai-postgres-test-1 psql -U postgres"` and `U=postgresql://postgres:postgres@postgres-test:5432/<db>`.

### Fixtures
- [ ] For §5: `npm run dev`, with the e2e fixtures (`e2e:auth:all`, `e2e:seed`), and a second org's Sandbox connector id on hand (`SELECT id, organization_id FROM connector_instances WHERE created_by='SYSTEM'`).
- [ ] For §7: a `portalai login --env app-dev` session — manual

### Reset between runs
- [ ] `$P -c "DROP DATABASE IF EXISTS adv952"` (and any other `adv952*` scratch DB). Delete scratch `apps/api/drizzle/0134_*.sql`. Unset any `SYSTEM_ID` you exported in your shell.

## §1 — Boundary & limit inputs
- [ ] **Whitespace-only principal.** On a fresh scratch DB `adv952`, run `DATABASE_URL=$U SYSTEM_ID="   " npm run db:migrate`. Expected SAFE: `exit 1`, `SYSTEM_ID is required`, nothing applied (no `drizzle` schema). — backend
- [ ] **A near-miss literal isn't touched.** On a migrated scratch DB, run `UPDATE stations SET created_by='System'` on a fixture row (and the same with `' SYSTEM'`). Then re-run 0133's SQL with the setting set (smoke §8's technique: `set_config` then the file). Expected SAFE: both stay as they were. The rule rewrites only the exact `'SYSTEM'`/`'system'` the migrations wrote, never a case-folded guess. — backend
- [ ] **A long principal.** `SYSTEM_ID=$(printf 'x%.0s' {1..300}) npm run db:migrate` against `adv952`. Expected SAFE: it applies, and `tiers.created_by` is the full 300-char value. The `text` columns don't truncate, and no length assumption breaks the rewrite. — backend

## §2 — Malformed & injection input
- [ ] **A hostile principal.** On a fresh scratch DB, run `SYSTEM_ID="x'); DROP TABLE tiers; --" npm run db:migrate`. Expected SAFE:
  - it applies;
  - `tiers` still exists;
  - `SELECT created_by FROM tiers` returns the string verbatim.

  The value reaches SQL only as a startup parameter read by `current_setting` and bound with `USING $1`, never concatenated. — backend
- [ ] **A hostile table or column name.** Create `$P -d adv952 -c 'CREATE TABLE "x; DROP TABLE tiers; --" (created_by text); INSERT INTO "x; DROP TABLE tiers; --" VALUES ($$SYSTEM$$)'`, then re-run 0133's SQL with the setting set. Expected SAFE:
  - the oddly named table's row is relabeled;
  - `tiers` is intact;
  - `format('%I')` quotes the identifier.

  — backend
- [ ] **Lint evasion.** A scratch `0134` writing the principal as `$$SYSTEM$$` (dollar-quoted) or `E'SYSTEM'`. Expected: `E'SYSTEM'` is flagged, because the regex matches the quoted body. The dollar-quoted form is **not** flagged. Record that as a known gap in the lint (a text match by design: discovery Decision 4, spec Surface), not a runtime vulnerability: the sweep itself rewrites only literal-valued rows, and code review catches a deliberate evasion. — backend

## §3 — Concurrency & races
- [ ] **Two migrators at once.** On a fresh scratch DB, start two `DATABASE_URL=$U SYSTEM_ID=SYSTEM npm run db:migrate` runs together (`… & … & wait`). Expected SAFE: one applies everything; the other no-ops or fails on the journal/schema race and can be re-run. Afterwards the tiers row is relabeled exactly once, with no duplicate journal rows (`SELECT count(*), count(DISTINCT hash) FROM drizzle.__drizzle_migrations` are equal). Deploys don't run this way: Helm upgrades serialize on `db:upgrade`'s advisory lock, and ECS runs one task. This probe only checks that a stray parallel run can't corrupt anything. — backend
- [ ] **An API write during the repair.** Against a scratch copy, hold 0133's transaction open: in psql, `BEGIN; SELECT set_config('portalai.system_id','SYSTEM',true);`, paste the DO block, don't commit. Meanwhile update a rewritten station by id from a second session. Expected SAFE: the second session waits, then applies after `COMMIT`, with no deadlock and no lost update. This is the accepted lock cost in spec Risks. — backend

## §4 — Auth & permission boundaries
- [ ] **Relabeling grants read only.** On the dev DB, as the e2e **member**, try to edit or delete a system-provisioned connector (the org's Sandbox), whose `created_by` is now the principal. Expected SAFE: the UI shows no Edit/Delete (hidden by the `ActionGate`), and a direct `DELETE /api/connector-instances/<id>` with the member's token answers 403. `created_by_system` grants `read` only, so the repair can't widen write. — backend

## §5 — Multi-tenant isolation
- [ ] As the e2e **member**, open `http://localhost:3000/connectors/<another org's Sandbox connector id>`. That row is also `created_by` the principal. Expected SAFE: not found (404 on `GET /api/connector-instances/<id>`). `created_by_system` is evaluated inside the caller's org, so every org's system rows sharing one principal never makes another org's system rows readable.

## §6 — State & lifecycle abuse
- [ ] **Changing SYSTEM_ID after the repair.** On a scratch DB already migrated with `SYSTEM_ID=A`, run `npm run db:migrate` again with `SYSTEM_ID=B`. Expected SAFE: nothing pending, nothing rewritten (0133 already applied), and rows keep `A`. This is the documented write-once rule (`PROD_PROVISIONING.runbook.md` step 7). The repair is not a re-labeler for arbitrary principal changes, and must not become one silently. — backend
- [ ] **Bypassing the runner.** On a scratch DB at 0132, run `npx drizzle-kit migrate` directly (no setting). Expected SAFE: 0133 raises `portalai.system_id is not set`, drizzle's single transaction rolls back, and `__drizzle_migrations` still ends at 0132. That's fail closed, not "applied without repairing". — backend
- [ ] **Soft-deleted rows.** A soft-deleted station with `created_by='SYSTEM'` is relabeled too. Expected SAFE: relabeled, with `deleted` and `deleted_by` unchanged unless `deleted_by` was itself a literal. Restoring it later doesn't resurrect a no-one's row. — backend

## §7 — Misuse sequences
- [ ] **A shell export can't override the injection.**
  1. `export SYSTEM_ID=SHELL-PROBE-952`
  2. `npx portalai seed org --name adv952 --env app-dev --yes --json`
  3. Read the new org's station `created_by`.

  Expected SAFE: `SYSTEM` (app-dev's SSM value). The injected value is spread after `process.env` (`spawn.ts` npmSpawner), so the target env wins. Clean up with `org delete` and `unset SYSTEM_ID`. — manual
- [ ] **An operator without SSM read.** Run a spawned command against app-dev with credentials that can read Secrets Manager but not SSM `system-id`. Expected SAFE: the command fails before spawning (`AccessDenied`), and nothing is written with a fallback principal. — manual
- [ ] **A copied 0080-style backfill.** A scratch `0134` that copies 0080's `INSERT … 'SYSTEM'` verbatim. Expected SAFE: `npm run lint:migrations` fails naming `portalai_system_id()`, the trap CLAUDE.md's backfill section now warns about. — backend

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
