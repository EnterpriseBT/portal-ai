# Literal system principal in data migrations and CLI scripts — Spec

Pins the contract for [#952](https://github.com/EnterpriseBT/portal-ai/issues/952) from `docs/MIGRATION_SYSTEM_PRINCIPAL.discovery.md`:
- the migration connection carries the environment's principal;
- one repair migration relabels literal rows;
- a lint rule stops new literals;
- CLI-spawned scripts get the target env's `SYSTEM_ID`.

## Key decisions (flag for review)

1. **One setting, one SQL accessor.** Every migration runner passes the startup parameter `portalai.system_id`. The repair migration creates `portalai_system_id()`, which returns it or **raises** when it's empty. Later data migrations call the function, never a literal. (Discovery D1.)
2. **The repair sweeps tables rather than naming them.** Discovery D2 listed tables. The audit on 2026-11-03 found literal rows in 19 prod tables and 22 app-dev tables, including some the discovery list missed (`station_instances`, `wide_table_columns`, `users`). So the migration loops over every `public` table that has a `created_by`/`updated_by`/`deleted_by` column, **minus a fixed exclusion list**:
   - `entity_records` and every `er__%` table: provenance-only parts with large volume (#829; 253,595 prod rows);
   - `audit_log`, `commercial_events`, `tool_usage_ledger`: records of truth, whose history isn't rewritten.
3. **The rule.** `SET <col> = portalai_system_id() WHERE <col> IN ('SYSTEM','system') AND <col> IS DISTINCT FROM portalai_system_id()`, per column, per table. It's idempotent: a no-op where the principal already matches (app-dev and local `'SYSTEM'`).
4. **Fail closed.** `runMigrations` refuses to start without `SYSTEM_ID` (`requireSystemId`, #948), and the repair raises if the setting is empty. A runner that forgot the parameter fails its batch rather than marking the repair applied.
5. **Local, e2e and `portalops local provision` move off drizzle-kit.** `npm run db:migrate` runs `src/scripts/db-migrate.ts`, the same runner prod uses, so it carries the setting.
6. **Records keep `'SYSTEM'`** (discovery Open question 2). **The Helm pin stays** and moves to #953.

## Scope

### In scope
- `db-migrate.ts`, the integration migrate client, and the `db:migrate` npm script.
- Migration `0133_repair-system-principal.sql` (with its journal entry and snapshot) and `portalai_system_id()`.
- A `check-migrations.mjs` principal-literal rule.
- `runApiScript` injecting `SYSTEM_ID`.
- Docs: `CLAUDE.md`, the PROD_PROVISIONING runbook, admin-cli COMMANDS.

### Out of scope
- Rewriting records, `er__` tables, or the audit and ledger tables.
- The Helm `SYSTEM_ID` pin (#953).
- Re-seeding prod's Demo dataset, which an operator can do with `portalai demo reset` + `demo seed` after this ships.
- Editing history migrations 0065–0129. They're applied and immutable; the repair corrects their rows.

## Surface

### `apps/api/src/scripts/db-migrate.ts`

```ts
export function buildMigrationClientOptions(
  resolver: DbPasswordResolver,
  readerRole: string = environment.PORTAL_SQL_READER_ROLE,
  systemId: string = requireSystemId(environment.SYSTEM_ID)
): { max: number; password: () => Promise<string>; connection: Record<string, string> }
// connection: { "portalai.sql_reader_role": readerRole, "portalai.system_id": systemId }
```

- `MIGRATION_SYSTEM_ID_SETTING = "portalai.system_id"` is exported, so `setup.ts` and the tests share the name.
- `runMigrations()` resolves `requireSystemId(environment.SYSTEM_ID)` before opening any connection. An unset or blank value throws `SYSTEM_ID is required…` and the entrypoint exits 1 with `Migration failed`.
- The provisioning pass (`buildProvisionClientOptions`, 0118's role DDL) doesn't change; it runs no data migration.

### `apps/api/package.json`

`"db:migrate": "dotenv -e .env -- tsx src/scripts/db-migrate.ts"`, replacing the drizzle-kit invocation. `db:migrate:ci` (`node dist/scripts/db-migrate.js`) doesn't change. The file's entrypoint guard (`import.meta.url === pathToFileURL(process.argv[1])`) holds under tsx. `migrationsFolder` resolves to `apps/api/drizzle` from both `src/scripts` and `dist/scripts`, and the test asserts that.

### `apps/api/src/__tests__/__integration__/setup.ts`

Its migrate client (`:97-100`) passes `connection: { [MIGRATION_SYSTEM_ID_SETTING]: process.env.SYSTEM_ID }`, which is `SYSTEM_TEST` there.

### Migration `apps/api/drizzle/0133_repair-system-principal.sql`

Generated with `npm run db:generate -- --custom --name repair-system-principal`, so `meta/_journal.json` and `meta/0133_snapshot.json` are committed with it. Body, in order:

1. `CREATE OR REPLACE FUNCTION portalai_system_id() RETURNS text LANGUAGE plpgsql STABLE`. It returns `nullif(btrim(current_setting('portalai.system_id', true)), '')`, or raises `'portalai.system_id is not set: run migrations through db-migrate (#952)'` when that's null.
2. A `DO $$ … $$` block that calls `portalai_system_id()` once, which raises before any write. It then loops `information_schema.columns` over `public` tables with `column_name IN ('created_by','updated_by','deleted_by')`, excluding `entity_records`, `er\_\_%`, `audit_log`, `commercial_events` and `tool_usage_ledger`. For each pair it runs `EXECUTE format('UPDATE %I SET %I = $1 WHERE %I IN (''SYSTEM'',''system'') AND %I IS DISTINCT FROM $1', …) USING principal`.
3. A header comment covering:
   - the rule;
   - the exclusion list and why each table is excluded;
   - a pointer to the #952 audit comment as the before-state;
   - `-- principal-literal-ok: matches the literals 0065–0129 wrote`.

It runs inside drizzle's single migration transaction, so it's atomic with the batch. It writes no new rows.

### `scripts/check-migrations.mjs`: principal-literal rule

- `PRINCIPAL_BASELINE_MAX_MIGRATION_INDEX = 133`. Files at or below it are grandfathered: 0065–0129 are history, and 0133 is the repair, whose literals are comparisons.
- `findPrincipalLiterals(sql) → Array<{ line, text }>` is pure. It flags every line (comments stripped, strings **not** blanked) containing the exact literal `'SYSTEM'` or `'system'`, unless `-- principal-literal-ok: <non-empty reason>` is on that line or the line above.
- The failure message names `portalai_system_id()`. It also tells authors to ack a legitimate `'system'`, such as `kind = 'system'`, with a reason.
- Fixtures in `FIXTURES` cover:
  - a flagged `'SYSTEM'` in `VALUES`;
  - a flagged `'system'` created_by;
  - an acked `kind = 'system'`;
  - an empty-reason ack, which is still flagged;
  - `portalai_system_id()`, which passes.
- `runSelfTest` runs them, and `runRealTree` runs the rule over files with index > 133.

### `packages/cli-env/src/spawn.ts`: `runApiScript`

On `def.aws`, alongside `ENCRYPTION_KEY`, it sets `injected.SYSTEM_ID = await getParam(def, "system-id")` (`aws.ts:126`; SSM `/portalai/<env>/system-id`, the catalog's `ssm("SYSTEM_ID","system-id")`). Local envs keep `.env`. A failed read throws before spawning, so no script runs with the wrong principal. The header comment's list of injected values gains `SYSTEM_ID`.

### Docs

- **`CLAUDE.md` → "Adding a system column definition":** 0080 stays the shape template. A new data migration writes `created_by` as `portalai_system_id()` (never a literal), and `lint:migrations` enforces it. The "API Database Scripts" line for `db:migrate` says it runs `db-migrate.ts`.
- **`docs/PROD_PROVISIONING.runbook.md` step 7:** migrations and CLI-spawned scripts now read the env's `SYSTEM_ID`.
- **`packages/admin-cli/COMMANDS.md`:** `demo seed`, `seed org` and the other spawned scripts receive the target env's `SYSTEM_ID`.

## Migration

`0133_repair-system-principal.sql` is a custom data migration with no schema change beyond the function. It is forward-only, so there's no down migration. It needs no `destructive-ok`: it uses no DDL, only `UPDATE`.

## Seed

No seed change. Seeds already write `SystemUtilities.id.system`.

## TDD test plan

### `apps/api`, unit (`npm run test:unit -- --testPathPattern db-migrate`)

`src/__tests__/scripts/db-migrate.test.ts`:
- `buildMigrationClientOptions` carries `portalai.system_id` equal to the given id, alongside the reader role;
- it defaults the id from `environment.SYSTEM_ID`;
- it throws `SYSTEM_ID is required` for an unset or blank id;
- `migrationsFolder` resolves to `apps/api/drizzle`.

4 cases.

### `apps/api`, integration (`npm run test:integration -- --testPathPattern repair-system-principal`)

`src/__tests__/__integration__/db/repair-system-principal.integration.test.ts` executes the migration file's SQL in a transaction with `set_config('portalai.system_id', 'SYSTEM_TEST', true)`. Its fixture org has rows carrying `'SYSTEM'` and `'system'`. Cases:
1. A station, connector instance, entity, curated view and system column definition carrying `'SYSTEM'`/`'system'` are rewritten to `SYSTEM_TEST`.
2. A role, policy, statement, attachment and `user_role` carrying `'system'` are rewritten.
3. `updated_by` is rewritten too.
4. A user-owned row (`created_by` = a user id) is untouched.
5. `entity_records` with `'SYSTEM'` is untouched.
6. An `audit_log` row with `'SYSTEM'` is untouched.
7. A second run changes nothing.
8. With the setting unset, it raises `portalai.system_id is not set`, and nothing is written (the transaction rolls back).
9. After rewriting, a member reads the system column definition and the station through `created_by_system`, via `PermissionSet`/the column-definition list.
10. `portalai_system_id()` exists after the global setup's migrate.

10 cases.

### Lint (`npm run lint:migrations`, which self-tests first)

5 fixtures, plus the real tree passing.

### `packages/cli-env` (`npm run test:unit` in the package)

`src/__tests__/spawn.test.ts`:
- AWS env: `getParam` is called with `(def, "system-id")` and `SYSTEM_ID` is injected;
- local: not injected, no `getParam`;
- a `getParam` failure rejects and the spawner is never called.

3 cases.

### Regression

`npm run type-check`, `lint`, `test:unit`, the existing integration suites (CI), and E2E (its stack now migrates through `db-migrate.ts`).

**Totals ≈ 22 cases + 5 lint fixtures.**

## Acceptance criteria

- [ ] On a DB holding literal rows, a migrate with `SYSTEM_ID=<uuid>` leaves no row outside the exclusion list with `created_by`/`updated_by`/`deleted_by` in `('SYSTEM','system')`.
- [ ] A migrate without `SYSTEM_ID` fails with `SYSTEM_ID is required`, and nothing is applied.
- [ ] `npm run db:migrate` (local), the E2E stack, `portalops local provision`, the ECS deploy migrate and the Helm migrate/upgrade jobs all apply 0133 successfully.
- [ ] `npm run lint:migrations` fails a new migration with an unacked `'SYSTEM'`/`'system'` literal.
- [ ] `portalai demo seed --env app-dev` (or any `runApiScript` script) writes the target env's `SYSTEM_ID`.
- [ ] After the prod release, re-running the #952 audit shows 0 literal rows in the swept tables, and a member added to the prod Demo org would read its stations, views and column definitions. This is checked by a read-only query, not by adding a member.

## Risks & rollback

- **A runner that doesn't pass the setting.** The migrate fails closed and the deploy's migrate step goes red. The fix is to pass the setting; no data was changed.
- **A table the sweep shouldn't touch.** Caught by test cases 5–6, plus the exclusion comment. A wrong rewrite is undone by a new forward migration. Before-state values: the #952 audit, plus the literal itself (every rewritten value was `'SYSTEM'` or `'system'`).
- **Lock time during deploy.** The swept tables are small: ~556 prod rows, with seq scans on non-excluded tables. The largest table is excluded.
- **The `tsx` runner for local `db:migrate`.** If it misbehaves locally, `db:migrate:ci` (`node dist/...`) after a build is the same runner.

## Files touched

- **New:**
  - `apps/api/drizzle/0133_repair-system-principal.sql`
  - `apps/api/drizzle/meta/0133_snapshot.json`
  - `src/__tests__/__integration__/db/repair-system-principal.integration.test.ts`
- **Edit:**
  - `apps/api/drizzle/meta/_journal.json`
  - `apps/api/src/scripts/db-migrate.ts`
  - `apps/api/package.json`
  - `src/__tests__/__integration__/setup.ts`
  - `src/__tests__/scripts/db-migrate.test.ts`
  - `scripts/check-migrations.mjs`
  - `packages/cli-env/src/spawn.ts`
  - `packages/cli-env/src/__tests__/spawn.test.ts`
  - `CLAUDE.md`
  - `docs/PROD_PROVISIONING.runbook.md`
  - `packages/admin-cli/COMMANDS.md`

## Next step

`docs/MIGRATION_SYSTEM_PRINCIPAL.plan.md`, in four slices on this branch:
1. The runner carries the setting: `db-migrate.ts`, `db:migrate` and `setup.ts`.
2. The repair migration and its integration test.
3. The lint rule.
4. The spawn injection and docs.
