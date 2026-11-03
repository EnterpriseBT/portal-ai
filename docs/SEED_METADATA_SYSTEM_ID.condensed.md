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

The boot guard refuses to start in **every** mode when `SYSTEM_ID` is empty ("SYSTEM_ID is required: the system principal for platform-created rows"). A value other than `SYSTEM` logs a boot warning but doesn't refuse: the migrations write the literal `'SYSTEM'` (0065, 0066, 0080), but the SaaS value lives in SSM (`/portalai/<env>/system-id`) and isn't verified here. A refusal there would be a prod outage on an unverified assumption. `DeployModeEnv` gains `SYSTEM_ID`.

## Plan — 3 slices

1. **Seed rethrows.** Files: `seed.service.ts`, the `db-upgrade.ts` comment. Tests (first):
   - `__tests__/__integration__/services/seed.service.integration.test.ts`: a failing step rejects `seed()` and leaves no partial rows.
   - `__tests__/__integration__/scripts/db-upgrade.integration.test.ts`: a rejecting seed makes `runUpgrade` throw.
   - Run with `npm run test:integration -- --testPathPattern 'seed.service|db-upgrade'`.
2. **Boot guard.** Files: `config/deploy-mode.ts`. Tests: `__tests__/config/deploy-mode.test.ts`. An empty `SYSTEM_ID` refuses in saas and in residency; a non-`SYSTEM` value warns and boots. Run with `npm run test:unit -- --testPathPattern deploy-mode`.
3. **Log the Error.** Files: `middleware/metadata.middleware.ts` plus the 158 logger calls (mechanical; reviewed per file). New `__tests__/log-error-object.guard.test.ts`, written first and red on today's tree. `__tests__/middleware/metadata.middleware.test.ts`: a non-`ApiError` failure logs an `Error` whose message survives serialization. Run with `npm run test:unit -- --testPathPattern 'log-error-object|metadata.middleware'`, then `npm run lint` and `npm run type-check`.

## Smoke (manual, against your dev stack)

1. In `apps/api`, run `npm run build`, then `SYSTEM_ID= node --env-file=.env dist/index.js`. It refuses to boot, naming `SYSTEM_ID`, with a non-zero exit (not `npm start`, which orphans the process).
2. `SYSTEM_ID= node --env-file=.env dist/db/seed.js` prints the connector-definition error and exits 1 (`echo $?`). With `SYSTEM_ID` set, it exits 0.
3. `SYSTEM_ID= node --env-file=.env dist/scripts/db-upgrade.js` logs `UPGRADE FAILED: …` and exits 1.
4. With `npm run dev` running, stop the dev Postgres and load the dashboard. The API's error lines carry `err.message` (e.g. `connect ECONNREFUSED …`) and a stack, not `{"type":"string"}`. Restart Postgres.
5. `SYSTEM_ID=OTHER node --env-file=.env dist/index.js` boots and logs the `SYSTEM_ID` warning once.

## Out of scope

- Refusing a non-`SYSTEM` `SYSTEM_ID`. That waits until app-dev's and prod's SSM values are confirmed; then the warning becomes a refusal.
- Logs already emitted: no backfill of past `{"type":"string"}` lines.
- The 7 non-logger message carriers (intentional result/row payloads).
