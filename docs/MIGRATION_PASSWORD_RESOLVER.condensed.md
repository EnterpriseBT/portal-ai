# Migrate task bypasses the #500 password resolver — Condensed design (#505)

**Issue:** [EnterpriseBT/portal-ai#505](https://github.com/EnterpriseBT/portal-ai/issues/505) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #500 made the app pool resolve its DB password **per new connection** from the RDS-managed master secret (`client.ts`, TTL-cached, fail-open), so the weekly managed rotation is absorbed by running tasks instead of breaking fresh connections. The **deploy migrate task** never got that fix: `db:migrate:ci` is `drizzle-kit migrate`, which builds its own postgres-js connection from `drizzle.config.ts`'s `dbCredentials.url = process.env.DATABASE_URL` — the **static composed** URL whose embedded password goes stale the moment the master secret rotates. Result: every deploy whose migrate step runs after a rotation fails at `CREATE SCHEMA … drizzle` with `28P01 password authentication failed`, until an operator recomposes `database-url`. Prod's master secret rotates **weekly**, so this is a standing race on every prod deploy. Single-package (`apps/api`); reuse the existing #500 resolver.

## Current shape

| Piece | Location | Note |
|---|---|---|
| CI/deploy migrate script | `apps/api/package.json:29` (`"db:migrate:ci": "drizzle-kit migrate"`) | the entrypoint the deploy runs; bypasses the resolver |
| drizzle-kit connection source | `apps/api/drizzle.config.ts` (`dbCredentials.url = process.env.DATABASE_URL`) | static URL password, resolved once, no per-connection hook |
| The #500 resolver (reuse) | `apps/api/src/db/credentials.util.ts` (`createDbPasswordResolver`, `fallbackPasswordFromUrl`) | ARN → fetch master secret (TTL, fail-open); no ARN → constant = URL password |
| App-pool wiring (mirror this) | `apps/api/src/db/client.ts:20-40` | `postgres(DATABASE_URL, { password: () => resolver.resolve() })` — the exact precedent |
| `migrate()` call precedent | `apps/api/src/__tests__/__integration__/setup.ts:88` | `migrate(db, { migrationsFolder })` from `drizzle-orm/postgres-js/migrator` |
| Env inputs (already exist) | `apps/api/src/environment.ts:21,25,28` | `DATABASE_URL`, `DB_MASTER_SECRET_ARN`, `DB_PASSWORD_CACHE_TTL_MS` |
| Prod image / runtime | `apps/api/Dockerfile:59,87` | `--omit=dev`, runs `node dist/…`; migrations copied to `/app/drizzle`; `drizzle-kit`/`drizzle-orm`/`postgres` are all prod deps |
| Deploy migrate step | `.github/workflows/deploy-dev.yml:419,426` · `deploy-prod.yml:468,475` | `run-task … command:["npm","run","db:migrate:ci"]` — unchanged by this fix |

## Decision — replace `drizzle-kit migrate` with a resolver-aware migrate script (issue option a)

drizzle-kit's config is static/synchronous — `dbCredentials` takes a fixed `url`/`password`, with **no per-connection password callback** — so the resolver can't be threaded through `drizzle.config.ts` (option b would mean constructing a SecretsManager client inside the config file and hoping drizzle-kit's async-config support holds; rejected). The clean root fix is a tiny **own migrate entrypoint** that reuses the #500 mechanism verbatim: build the resolver from the same env inputs, hand postgres-js a `password: () => resolver.resolve()` callback, and run `migrate()` from `drizzle-orm/postgres-js/migrator`. One-shot task → one connection → one resolve; with no `DB_MASTER_SECRET_ARN` (local/dev) the resolver is a constant equal to the URL password, so local behavior is byte-identical to today.

`db:migrate:ci` becomes `node dist/scripts/db-migrate.js` (the prod image has no `tsx`; scripts already compile to `dist/scripts/` — cf. `migrate-signing-secrets.ts`). The deploy `command:["npm","run","db:migrate:ci"]` override is unchanged.

## Plan — 1 slice

**Files**
- **New:** `apps/api/src/scripts/db-migrate.ts` — resolves the migrations folder from `import.meta.url` (`dist/scripts/…/../../drizzle` = `/app/drizzle` in-image, `apps/api/drizzle` locally); builds `createDbPasswordResolver({ masterSecretArn: environment.DB_MASTER_SECRET_ARN, fallbackPassword: fallbackPasswordFromUrl(environment.DATABASE_URL), ttlMs: environment.DB_PASSWORD_CACHE_TTL_MS })`; `postgres(environment.DATABASE_URL, { max: 1, password: () => resolver.resolve() })`; `await migrate(drizzle(sql), { migrationsFolder })`; `await sql.end()`; exit non-zero on failure. Export a small `buildMigrationClientOptions(resolver)` for the test.
- **Edit:** `apps/api/package.json:29` — `"db:migrate:ci": "node dist/scripts/db-migrate.js"`. Leave `db:migrate` (local, `drizzle-kit migrate` via `dotenv -e .env`) as-is: local never rotates, and it keeps loading `.env`.

**Tests**
- **New:** `apps/api/src/__tests__/scripts/db-migrate.test.ts` — assert `buildMigrationClientOptions` sets `password` to a **function** (not a static string) and that invoking it returns the injected resolver's value (mirrors the #500 `credentials.util` tests). This is the regression guard: the migrate path must go through the resolver, not the URL's embedded password.
- Run: `npm run test:unit -- --testPathPattern db-migrate`; then `npm run type-check`, `npm run lint`, `npm run build` (confirms the script compiles to `dist/scripts/db-migrate.js`).

## Smoke (manual, against your dev stack)

1. **Local applies/no-ops cleanly.** From `apps/api`, with a local Postgres up and `DATABASE_URL` set (no `DB_MASTER_SECRET_ARN`), run `npm run build` then `node dist/scripts/db-migrate.js`. Confirm it connects and reports migrations applied (or a clean no-op on an up-to-date DB), exit 0 — proving the new entrypoint replaces `drizzle-kit migrate` without behavior change locally.
2. **Rotation absorption is deploy-only (app-dev/prod).** Cannot be reproduced locally (no managed secret). Verify on the next app-dev deploy after a forced master-secret rotation: the `deploy-backend → Run database migrations` step succeeds where run 33812388263 failed with `28P01`. Records as manual, closed on the deploy following merge (prod's next weekly rotation is the standing proof — see [[project_rds_rotation_vs_static_database_url]]).

## Seed task — investigated, already safe (no change)

The deploy's other one-off task, `db:seed:ci` (`node dist/db/seed.js`, `.github/workflows/deploy-dev.yml:447`), was checked for the same bug and is **not affected**: `seed.ts` → `SeedService` → `DbClient` from `apps/api/src/db/index.ts:1`, which re-exports `db` from `./client.js` — the **app pool #500 already fixed**. It never builds its own connection, so it inherits `password: () => resolver.resolve()` and absorbs a rotation. The migrate task is the *only* deploy path that bypasses the resolver (drizzle-kit owns its own connection); seeding needs no change. Recorded so the "why only migrate?" question is closed, not left open.

## Out of scope

- **The runtime app pool** — already fixed by #500; untouched here.
- **Local `db:migrate`** (drizzle-kit via dotenv) — left as-is; local has no rotation, and it loads `.env` for the dev workflow.
