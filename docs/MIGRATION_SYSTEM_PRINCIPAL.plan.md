# Literal system principal in data migrations and CLI scripts — Plan

**This plan implements #952's contract in four TDD slices:**
1. the migration connection carries the environment's principal;
2. migration 0133 relabels literal rows;
3. a lint rule stops new literals;
4. CLI-spawned scripts get the target env's `SYSTEM_ID`.

Spec: `docs/MIGRATION_SYSTEM_PRINCIPAL.spec.md`. Discovery: `docs/MIGRATION_SYSTEM_PRINCIPAL.discovery.md`. Issue: #952. It builds on #948 (`requireSystemId`, `apps/api/src/utils/system.util.ts`). #953 (the Helm pin) follows it.

Each slice is behind a green test suite and leaves the repo compilable. They land as **commits on `fix/952-migration-system-principal`**: one fix, one PR (#954).

Run tests from each package, never jest directly:

```bash
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd packages/cli-env && npm run test:unit
npm run lint:migrations          # repo root; self-tests first
```

Each slice:
1. write failing tests;
2. make the smallest change that turns them green;
3. run them;
4. run `npm run lint && npm run type-check` at the boundary;
5. move to the next slice.

Sequencing rationale:
- **Slice 1** first: the repair raises without the setting, so every runner (integration setup included) must carry it before 0133 exists.
- **Slice 2** needs Slice 1's setting on the integration migrate client.
- **Slice 3**'s baseline is 0133's index, so it follows Slice 2.
- **Slice 4** is independent of the DB slices. It goes last with the docs, so they describe the finished behavior.

---

## Slice 1 — The migration runner carries `portalai.system_id`

`runMigrations` refuses to start without a principal, and every runner passes the setting: `db-migrate.ts`, local `db:migrate` (moved off drizzle-kit), and the integration global setup. No migration reads the setting yet.

**Files**

- Edit: `apps/api/src/scripts/db-migrate.ts`. Export `MIGRATION_SYSTEM_ID_SETTING`. `buildMigrationClientOptions` gains a `systemId` parameter (default `requireSystemId(environment.SYSTEM_ID)`) and puts it in `connection`. `runMigrations` resolves it before connecting.
- Edit: `apps/api/package.json`. `db:migrate` becomes `dotenv -e .env -- tsx src/scripts/db-migrate.ts`.
- Edit: `apps/api/src/__tests__/__integration__/setup.ts`. The migrate client passes `connection: { [MIGRATION_SYSTEM_ID_SETTING]: process.env.SYSTEM_ID }`.
- Edit: `apps/api/src/__tests__/scripts/db-migrate.test.ts`.

**Steps**

1. **Tests (spec unit cases 1–4).** Write these in `db-migrate.test.ts`:
   - the setting equals the given id, alongside the reader role;
   - the id defaults from `environment.SYSTEM_ID`;
   - an unset or blank id throws `SYSTEM_ID is required`;
   - `migrationsFolder` resolves to `apps/api/drizzle`.

   Run them; they fail.
2. **Implement.** Make the `db-migrate.ts` changes, the `db:migrate` script change and the `setup.ts` client options. Green.
3. **Check by hand, then lint and type-check.**
   - `npm run db:migrate` in `apps/api` against the dev DB prints `Migrations completed` with nothing pending. That proves the tsx entrypoint guard and the folder resolution.
   - `npm run test:integration -- --testPathPattern db-upgrade` stays green, since it goes through the real `runMigrations`.
   - Run lint and type-check.

**Done when:**
- the four unit cases pass;
- local `db:migrate` runs `db-migrate.ts`;
- the integration setup's migrate carries the setting;
- nothing reads the setting yet.

**Risk:** `db:migrate` now runs through tsx, so the E2E stack and `portalops local provision` use the same path. E2E Tests in CI is the check.

---

## Slice 2 — Migration 0133 and `portalai_system_id()`

This slice adds the function, then the sweep with the exclusion list. It's idempotent and fails closed.

**Files**

- New: `apps/api/drizzle/0133_repair-system-principal.sql`, from `npm run db:generate -- --custom --name repair-system-principal`. The generator also writes:
  - New: `apps/api/drizzle/meta/0133_snapshot.json`
  - Edit: `apps/api/drizzle/meta/_journal.json`

  Commit all three together.
- New: `apps/api/src/__tests__/__integration__/db/repair-system-principal.integration.test.ts`.

**Steps**

1. **Tests (spec integration cases 1–10).** The test reads the migration file and runs its SQL inside `sql.begin`, after `set_config('portalai.system_id', 'SYSTEM_TEST', true)`. It works against a fixture org that holds:
   - a station, connector instance, entity, curated view and system column definition carrying `'SYSTEM'`/`'system'`;
   - RBAC rows carrying `'system'`, and an `updated_by` literal;
   - a user-owned row;
   - an `entity_records` row and an `audit_log` row carrying `'SYSTEM'`.

   It asserts:
   - the rewrites (cases 1–3);
   - the untouched rows (4–6);
   - that a second run changes nothing (7);
   - the raise, with nothing written, when the setting is unset (8);
   - that a member reads the column definition and station through `created_by_system` after the rewrite (9);
   - that `portalai_system_id()` exists after the global migrate (10).

   Run them; they fail, because there's no file yet.
2. **Implement** the SQL exactly as the spec's Surface says: the function, then the `DO` block with the exclusion list and the `principal-literal-ok` header comment. The global setup applies it (Slice 1 passes the setting), and case 10 turns green with the rest.
3. Run `npm run test:integration -- --testPathPattern 'repair-system-principal|db-upgrade|seed.service'`, then lint and type-check.

**Done when:** cases 1–10 pass, and the migration applies on the integration DB and the dev DB (`npm run db:migrate`).

**Risk:** `audit_log`'s exclusion is required, not optional. Its append-only trigger (`0096_add-audit-log-table.sql:34-43`) raises on any `UPDATE`, so a sweep that included it would fail the whole migration batch. Case 6 pins it. `teardownOrg()` already clears `audit_log` through the trigger's purge path (`__integration__/utils/application.util.ts:450`), so the fixture rows need no manual cleanup.

---

## Slice 3 — `lint:migrations` principal-literal rule

**Files**

- Edit: `scripts/check-migrations.mjs`:
  - `PRINCIPAL_BASELINE_MAX_MIGRATION_INDEX = 133`;
  - pure `findPrincipalLiterals(sql)`;
  - 5 `FIXTURES` (spec lint list);
  - wired into `runSelfTest` and `runRealTree`;
  - a failure message that names `portalai_system_id()` and the ack syntax.

**Steps**

1. **Tests (spec lint fixtures).** Add the 5 fixtures:
   - a `'SYSTEM'` in `VALUES`, flagged;
   - a `'system'` created_by, flagged;
   - an acked `kind = 'system'`, passes;
   - an empty-reason ack, flagged;
   - `portalai_system_id()`, passes.

   `npm run lint:migrations -- --self-test` fails, because the function isn't there.
2. **Implement** `findPrincipalLiterals` and wire it in. The self-test goes green, and the real tree passes: nothing above 0133 yet.
3. **Prove the rule by hand.** A scratch `0134_x.sql` containing `'SYSTEM'` fails `npm run lint:migrations`. Delete it, then run lint.

**Done when:** the self-test passes, the real tree passes, and a scratch literal migration fails with the named message.

**Risk:** none. It's the same CI job (`unit-test.yml:123`).

---

## Slice 4 — `runApiScript` injects `SYSTEM_ID`, plus the docs

**Files**

- Edit: `packages/cli-env/src/spawn.ts`. On `def.aws`, set `injected.SYSTEM_ID = await getParam(def, "system-id")`, and update the header comment.
- Edit: `packages/cli-env/src/__tests__/spawn.test.ts`. Mock `getParam` beside `getSecret`.
- Edit: `CLAUDE.md`:
  - "Adding a system column definition": a new data migration writes `portalai_system_id()`, and `lint:migrations` enforces it;
  - "API Database Scripts": `db:migrate` runs `db-migrate.ts`.
- Edit: `docs/PROD_PROVISIONING.runbook.md` step 7: migrations and spawned scripts read the env's `SYSTEM_ID`.
- Edit: `packages/admin-cli/COMMANDS.md`: spawned scripts receive the target env's `SYSTEM_ID`.

**Steps**

1. **Tests (spec cli-env cases 1–3).**
   - AWS env: `getParam(def, "system-id")` is called and `SYSTEM_ID` is injected.
   - Local: neither happens.
   - A `getParam` rejection rejects the call, and the spawner is never called.

   Run them; they fail.
2. **Implement** the injection. Green. Check that the admin-cli and devops-cli suites (which mock `runApiScript`) stay green.
3. **Docs**, then `npm run lint:doc-pointers`, lint and type-check at the root.

**Done when:** the 3 cases pass, both CLI suites are green, and the docs describe the new behavior.

**Risk:** an operator without SSM read on `system-id` now fails before spawning. That's intended: it's the same credential that already reads `encryption-key`.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | the runner carries the setting; `db:migrate` uses `db-migrate.ts` | 4 unit cases; local migrate; `db-upgrade` integration |
| 2 | 0133 + `portalai_system_id()` | 10 integration cases; dev DB migrate |
| 3 | lint rule | 5 fixtures; real tree; scratch-file failure |
| 4 | spawn injection + docs | 3 cli-env cases; CLI suites; doc-pointers |

## Cross-slice notes

- **Journal discipline:** 0133's `.sql`, its snapshot and `_journal.json` go in one commit, or `migrate()` skips it on CI's fresh DB.
- **Integration durations:** the new integration file has no `durations.json` entry. The planner uses the samples it has, and the weekly refresh picks it up. No manual edit is needed unless `lint:integration-durations` objects.
- **Local dev DB:** once Slice 2 lands, `npm run db:migrate` rewrites the dev DB's lowercase `'system'` RBAC rows to `SYSTEM`. That's expected, and the local audit query shows 0 `lit_lower` afterward.
- **Prod and app-dev get 0133 on their next deploy** (ECS `db-migrate.js`, which already has `SYSTEM_ID`). The PR's smoke covers local and app-dev. The prod check is the acceptance criterion's post-release audit re-run, read-only, recorded on #952.
- **Docs in the same PR:** CLAUDE.md, the runbook and COMMANDS.md land in Slice 4, so no stale guidance (0080's literal as a template) survives the merge.

## Next step

With discovery, spec and plan confirmed, implementation starts on this branch with Slice 1, tests first, one commit per slice.
