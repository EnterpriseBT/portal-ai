# portalops db reset keeps extension-owned tables — Condensed design (#784)

**Issue:** [EnterpriseBT/portal-ai#784](https://github.com/EnterpriseBT/portal-ai/issues/784) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalops db reset` (and `db reset-seed`, which calls it) truncates every table in `public` except `__drizzle_migrations`. That includes PostGIS's `spatial_ref_sys`, which nothing reseeds: `db seed`, `local provision` and the migrations don't touch it, and `CREATE EXTENSION IF NOT EXISTS postgis` is a no-op. After a reset every SRID is unknown and geometry writes fail with `GIS_SRID_UNSUPPORTED`. This affects `local` and `app-dev`; `prod` refuses destructive ops. The change is confined to `packages/devops-cli`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Table selection | `packages/devops-cli/src/reset.ts:93-94` | `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations'` |
| Drop vs truncate | `reset.ts` `partitionTables` | `er__*` DROP; everything else one `TRUNCATE … CASCADE` |
| Executor | `reset.ts` `psqlExec` / `SqlExec` | injectable, so the logic is unit-tested without a DB |
| Tests | `packages/devops-cli/src/__tests__/reset.test.ts` | the mocked exec answers any SQL containing `pg_tables` |
| Docs | `packages/devops-cli/COMMANDS.md:110-119` | `db reset` / `db reset-seed` entries |
| The API's `db:reset` | `apps/api/src/db/reset.ts` → `ResetService` | org-scoped, never lists tables: **not affected** |

Measured against the local DB: the current query lists 47 tables. One that excludes extension members lists 46, and the only difference is `spatial_ref_sys`. The other extension-owned tables (`tiger.*`, `topology.*`) are outside `public` and were never at risk.

## Decision — exclude extension-owned tables by catalog, not by name

Options:
- **(a)** Add `AND tablename != 'spatial_ref_sys'`. It's simple, but the next extension that puts a table in `public` repeats the bug.
- **(b)** Exclude any table an extension owns. Postgres records that as a `pg_depend` row with `deptype = 'e'`.

**Chosen: (b).** It's generic, it's what Postgres itself means by "belongs to an extension", and it measured exactly right (above). The list query becomes:

```sql
SELECT c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relname <> '__drizzle_migrations'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');
```

It moves from `pg_tables` to `pg_class` so it can join `pg_depend` by oid. `relkind IN ('r','p')` keeps ordinary and partitioned tables, the same set `pg_tables` returned. The query becomes a named, exported constant, so tests assert on it rather than on a substring.

## Plan — one slice

**Files**
- `packages/devops-cli/src/reset.ts`: export `LIST_RESETTABLE_TABLES_SQL` (the query above) with a `#784` comment, and use it in `runReset`.
- `packages/devops-cli/COMMANDS.md`: `db reset` entry gains "extension-owned tables (e.g. PostGIS's `spatial_ref_sys`) are left untouched (#784)".
- `packages/devops-cli/.env.example`: add the commented `STRIPE_SECRET_KEY=` line that COMMANDS.md already says belongs in this file (the `local provision` tier step reads it). Same package, found while filing #784.

**Tests**
- `packages/devops-cli/src/__tests__/reset.test.ts`: the mock exec keys on the exported constant instead of the `pg_tables` substring. A new case asserts the first SQL issued is `LIST_RESETTABLE_TABLES_SQL`, and that it excludes `__drizzle_migrations` and extension members (`deptype = 'e'`).
- `npm run test:unit` (devops-cli), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. `psql "$DATABASE_URL" -Atc "select count(*) from spatial_ref_sys"` → about 8,500.
2. Rebuild the CLI (`npm run build --workspace @portalai/devops-cli`), then `npx portalops db reset --env local --yes --json`. `truncated` doesn't list `spatial_ref_sys` and still lists the app tables (e.g. `users`, `organizations`).
3. Repeat step 1 → the count is unchanged.
4. `npx portalops local provision --env local --yes --json` → every step `ok` (`e2e-org` `skipped`). This also confirms `STRIPE_SECRET_KEY` from `packages/devops-cli/.env` is picked up.
5. Re-run `npm run --workspace @portalai/e2e e2e:auth:all` then `e2e:seed` to restore the fixture org the reset cleared.

## Out of scope

- Restoring an already-emptied `spatial_ref_sys` automatically (e.g. from `db seed`). The issue records the manual recovery: copy from a scratch database with PostGIS.
- Checking whether app-dev's `spatial_ref_sys` was emptied by an earlier `reset-seed`. That needs app-dev DB access; worth a one-off `count(*)` check by whoever holds it.
