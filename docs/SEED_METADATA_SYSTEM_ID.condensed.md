# Seed, metadata-error and SYSTEM_ID faults — Condensed design (#948)

**Issue:** [EnterpriseBT/portal-ai#948](https://github.com/EnterpriseBT/portal-ai/issues/948) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #946's live Helm install hit three API faults that each hid a failure. The install looked healthy while sign-in and seeding were broken. A failed global seed exits 0. A non-`ApiError` failure behind `METADATA_FETCH_FAILED` is logged as `{"type":"string"}`. The API boots without `SYSTEM_ID` and fails only at the first user creation. The fix is in `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Global seed | `apps/api/src/services/seed.service.ts:361-377` | `catch` logs, rolls back, **returns**; callers can't tell it failed |
| Seed entrypoint | `apps/api/src/db/seed.ts` | exits 1 only on a throw, so prints "Seeding completed successfully." after a failure |
| Upgrade | `apps/api/src/scripts/db-upgrade.ts:86-89,107,146` | comment relies on the swallow; a throwing seed already becomes `UPGRADE FAILED` + exit 1 |
| Metadata catch | `apps/api/src/middleware/metadata.middleware.ts:144-152` | logs `{ error: error.message }`, a string |
| Error serializer | `apps/api/src/utils/logger.util.ts:36-41,133-136` | `err`/`error` → `sanitizeError`; a non-`Error` becomes `{ type }` by design (#540: a string may carry customer data) |
| Same pattern elsewhere | 158 logger calls, mostly `routes/*.router.ts` | `(error|err): x instanceof Error ? x.message : …` → all log `{"type":"string"}` |
| System principal | `apps/api/src/utils/system.util.ts:39` | `environment.SYSTEM_ID!`: undefined passes type-check, fails `createdBy` validation at runtime |
| Boot guard | `apps/api/src/config/deploy-mode.ts:77`, called first in `index.ts:52` | checks residency OIDC/Stripe only |

## Decision — the seed fails loudly

`seed()` rethrows after the rollback. `db/seed.ts` then exits 1, and `db:upgrade` logs `UPGRADE FAILED` and exits 1, both paths that exist today. The Helm seed and upgrade hooks and `portalops db seed`/`db upgrade` all report the failure. The stale comment at `db-upgrade.ts:86` is corrected.

## Decision — log the Error, not its message

Every logger call passes the error object, keeping the key it uses today (`err` or `error`): `{ err: error }`. That gives `sanitizeError` an `Error`, so it keeps a non-DB message and the stack and redacts DB messages as #540 intends. Rejected: letting `sanitizeError` keep strings. These strings are `error.message`, which for a DB error is SQL plus bound customer values, exactly what #540 strips. All 158 calls are swept (the issue's fix direction names this). A guard test, `log-error-object.guard.test.ts`, fails CI on a logger call carrying `(error|err): x instanceof Error ? x.message`. The 7 non-logger matches (tool results, a job row, the mock toolpack server) carry messages on purpose and stay.

## Decision — SYSTEM_ID is required at boot

The boot guard refuses to start in **every** mode when `SYSTEM_ID` is empty or blank ("SYSTEM_ID is required: the system principal for platform-created rows"). `SystemUtilities.id.system` throws the same message, so the seed and upgrade entrypoints name the variable rather than failing `createdBy` validation (added in code review). Any non-empty value boots, with no warning: prod's is a UUID by design (`docs/PROD_PROVISIONING.runbook.md` step 7), so a warning on a value other than `SYSTEM` would fire on every prod boot. (Drafted as a warning, then dropped during implementation once the runbook turned up.) `DeployModeEnv` gains `SYSTEM_ID`.

## Plan — 3 slices

1. **Seed rethrows.** Files: `seed.service.ts`, the `db-upgrade.ts` comment. Tests (first):
   - `__tests__/__integration__/services/seed.service.integration.test.ts`: a failing step rejects `seed()` and leaves no partial rows.
   - `__tests__/__integration__/scripts/db-upgrade.integration.test.ts`: a rejecting seed makes `runUpgrade` throw.
   - Run with `npm run test:integration -- --testPathPattern 'seed.service|db-upgrade'`.
2. **Boot guard.** Files: `config/deploy-mode.ts`. Tests: `__tests__/config/deploy-mode.test.ts`. An empty `SYSTEM_ID` refuses in saas and in residency; any non-empty value (a UUID) boots. Run with `npm run test:unit -- --testPathPattern deploy-mode`.
3. **Log the Error.** Files: `middleware/metadata.middleware.ts` plus the 158 logger calls (mechanical; reviewed per file). New `__tests__/log-error-object.guard.test.ts`, written first and red on today's tree. `__tests__/middleware/metadata.middleware.test.ts`: a non-`ApiError` failure logs an `Error` whose message survives serialization. Run with `npm run test:unit -- --testPathPattern 'log-error-object|metadata.middleware'`, then `npm run lint` and `npm run type-check`.

## Smoke (manual, against your dev stack)

1. In `apps/api`, run `npm run build`, then `SYSTEM_ID= node --env-file=.env dist/index.js`, and again with `SYSTEM_ID="  "`. Each refuses to boot, naming `SYSTEM_ID`, with a non-zero exit (not `npm start`, which orphans the process).
2. The seed fails only on a fresh DB, and only with `SYSTEM_ID` **unset**. An already-seeded DB writes nothing, and `SYSTEM_ID=` (empty) passes validation. Make a scratch DB: `docker exec portalai-postgres-test-1 psql -U postgres -c "CREATE DATABASE smoke948"`, set `U=postgresql://postgres:postgres@postgres-test:5432/smoke948`, then run `DATABASE_URL=$U node --env-file=.env dist/scripts/db-migrate.js`. Write an env file without the variable: `grep -v '^SYSTEM_ID' .env > /tmp/env-nosysid`. Then `env -u SYSTEM_ID DATABASE_URL=$U node --env-file=/tmp/env-nosysid dist/db/seed.js` logs `Error during seeding: Error: SYSTEM_ID is required: …` and exits 1 (`echo $?`). With `--env-file=.env` it prints `Seeding completed successfully.` and exits 0.
3. Before the step-2 success run (the failed seed rolled back, so `smoke948` is still unseeded), the same unset-`SYSTEM_ID` command with `dist/scripts/db-upgrade.js` logs `UPGRADE FAILED: Error: SYSTEM_ID is required: …` and exits 1. Afterwards, `DROP DATABASE smoke948`.
4. With `npm run dev` running, stop the dev Postgres and load the dashboard. The API's error lines carry `err.message` (e.g. `connect ECONNREFUSED …`) and a stack, not `{"type":"string"}`. Restart Postgres.
5. `SYSTEM_ID=5f0c2a7e-0000-4000-8000-000000000000 node --env-file=.env dist/index.js` boots normally (prod's value is a UUID).

## Out of scope

- Migrations 0065, 0066 and 0080 write the literal `'SYSTEM'`, while prod's `SYSTEM_ID` is a UUID, so those rows may not read as `created_by_system` in prod. That's a separate question, not this ticket.
- Logs already emitted: no backfill of past `{"type":"string"}` lines.
- The 7 non-logger message carriers (intentional result/row payloads).
- Non-DB error messages now reach the logs in full, per #540's design (only DB errors are redacted). A few can quote customer values: the SQL tool's `ApiError` wrapping a Postgres 22xxx input error, a workbook-cache `JSON.parse` `SyntaxError`. Accepted in code review; narrowing that belongs to the redaction itself, not this ticket.
