# SYSTEM_ID database guard — Condensed design (#956)

**Issue:** [EnterpriseBT/portal-ai#956](https://github.com/EnterpriseBT/portal-ai/issues/956) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `SYSTEM_ID` is write-once: every platform row carries it as `createdBy`, and `created_by_system` grants match only the current value (`apps/api/src/services/permission-set.ts:247,313,385`). Nothing records which principal provisioned a database. So a changed value takes effect silently, and members lose read on every system-provisioned object. That covers:
- a mistaken SSM write on ECS;
- a Helm reinstall over a surviving database (#953's chart guard reads only the release's ConfigMap);
- a GitOps render.

The fix records the principal in the database on first migrate, and refuses a mismatch in both the migration runner and the API boot. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Boot guard (no DB) | `apps/api/src/config/deploy-mode.ts` `assertDeployModeConsistency`, called first in `index.ts` `start()` | refuses a blank `SYSTEM_ID` (#948); can't see the DB |
| Boot DB checks | `apps/api/src/index.ts` `start()`: `connectDatabase()` then the wide-table drift check | each fails `process.exit(1)` with a `logger.fatal` + `ApiCode` |
| Migration runner | `apps/api/src/scripts/db-migrate.ts` `runMigrations` | `requireSystemId`, then `migrate()` on one client; passes `portalai.system_id` (#952) |
| SQL accessor | `portalai_system_id()` (migration 0133) | the setting, or raises |
| Integration setup | `src/__tests__/__integration__/setup.ts` | truncates every `public` table (except `er__*`, `spatial_ref_sys`), then migrates |

## Decision — a one-row `system_principal` table, checked in two places

- **Where to record it.** Options considered:
  - a `COMMENT ON DATABASE` (the database name varies by install, and the app user may not own it);
  - inferring it from an existing platform row such as the `standard` tier's `created_by` (that's data, and an operator or `portalops tier apply` can rewrite it);
  - **chosen:** a dedicated table, `system_principal (id text PRIMARY KEY, created bigint NOT NULL)`, with at most one row.
- **When it's recorded.** Migration `0134` creates the table and records `portalai_system_id()`, so existing envs record their current value on the next deploy (app-dev `SYSTEM`; prod its UUID, already repaired by 0133). `recordSystemPrincipal` also does `INSERT … ON CONFLICT DO NOTHING` after every successful migrate and at boot, so a truncated table (the integration setup) re-records instead of failing open forever.
- **Where it's checked.** A shared `assertSystemPrincipal(read, systemId)` reads the row (absent → no check) and throws `SystemPrincipalMismatchError` naming both values when they differ.
  - `runMigrations` checks **before** `migrate()`, guarded on `to_regclass('public.system_principal')`, since the table doesn't exist before 0134. A wrong principal applies no migration.
  - `start()` checks right after `connectDatabase()`: `logger.fatal({ code: SYSTEM_ID_MISMATCH }, …)`, then exit 1.
- **Refinements from code review:**
  - Boot catches only a real mismatch as `SYSTEM_ID_MISMATCH`. Any other failure is `SYSTEM_PRINCIPAL_CHECK_FAILED`; both exit 1.
  - A database without the table (a local `npm run dev` before `db:migrate`) warns `SYSTEM_PRINCIPAL_UNRECORDED` and boots.
  - `ensureSystemPrincipal` re-checks after recording, so a concurrent first record under another id is refused.
  - 0134 refuses to record a principal that the existing connector definitions don't carry, so the first guarded release can't record a changed value.
  - `runMigrations` checks before the reader-role provisioning pass.
  - The job workers are created after every boot guard, so a refusing task never takes a job.
  - `drizzle.config.ts` excludes the table from `db:push`.
- **Not a Drizzle table.** It's raw SQL, like the advisory lock and the migrations journal. It has no model, no repository and no routes, and it holds one value no feature reads.

## Plan — 1 slice

**Files:**
- New `apps/api/drizzle/0134_system-principal.sql`, from `npm run db:generate -- --custom --name system-principal`, with its journal entry and snapshot. It creates the table and does `INSERT SELECT portalai_system_id(), <now> ON CONFLICT DO NOTHING`.
- New `apps/api/src/db/system-principal.util.ts`, containing:
  - `SystemPrincipalMismatchError`;
  - `assertSystemPrincipal(read, systemId)` (pure, given a reader);
  - `readSystemPrincipal(sql)` (null when the table or row is absent);
  - `recordSystemPrincipal(sql, systemId)`.
- Edits:
  - `scripts/db-migrate.ts`: check, migrate, record;
  - `index.ts` `start()`: check + record after `connectDatabase()`;
  - `constants/api-codes.constants.ts`: `SYSTEM_ID_MISMATCH`;
  - `docs/PROD_PROVISIONING.runbook.md` step 7: write-once is now enforced;
  - `deploy/helm/portalai/README.md`: the write-once note drops "#956 tracks".

**Tests (first):**
- `src/__tests__/db/system-principal.util.test.ts` (unit): match passes; absent passes; mismatch throws naming both values.
- `src/__tests__/__integration__/db/system-principal.integration.test.ts`:
  - 0134 recorded the setup's principal;
  - `runMigrations` with a different `SYSTEM_ID` rejects before applying;
  - record is idempotent;
  - a truncated table re-records.
- Run `npm run test:unit -- --testPathPattern system-principal` and `npm run test:integration -- --testPathPattern 'system-principal|db-upgrade|repair-system-principal'`, then `npm run type-check` / `lint` / `lint:migrations`.

## Smoke (manual, against your dev stack)

1. In `apps/api`, run `npm run db:migrate`, then `psql "$DATABASE_URL" -tAc "SELECT id FROM system_principal"`. It prints `SYSTEM`.
2. `SYSTEM_ID=OTHER npm run db:migrate; echo $?` logs `Migration failed … SYSTEM_ID "OTHER" doesn't match the "SYSTEM" this database was provisioned with` and prints `1`.
3. Run `npm run build`, then `SYSTEM_ID=OTHER node --env-file=.env dist/index.js`. It logs fatal `SYSTEM_ID_MISMATCH` naming both values and exits 1. The plain `node --env-file=.env dist/index.js` boots.
4. On a fresh scratch DB (as #952 smoke §2), `SYSTEM_ID=<uuid> npm run db:migrate` records the UUID, and a second run with `SYSTEM` refuses.
5. **After merge:** app-dev's deploy migrate step succeeds, and `SELECT id FROM system_principal` on app-dev (read-only) prints `SYSTEM`.

## Out of scope

- A deliberate principal change. That needs an audited relabel of every platform row; there's no request for one.
- The Helm chart's release-level check (#953). It stays, as the earlier and friendlier refusal.
