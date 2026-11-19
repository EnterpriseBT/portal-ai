# Demo org per demo — Plan

**This plan implements `portalai demo create` / `demo delete` over a new `organizations.is_demo` marker, and removes `demo seed` / `demo reset`. It is sequenced test-first, so each slice's tests are written before its code.**

Spec: `docs/DEMO_ORG_PER_DEMO.spec.md`. Discovery: `docs/DEMO_ORG_PER_DEMO.discovery.md`. Issue: #1035. Builds on #848, which added the Administrate and Playground stations.

The work is six slices. Each one has a green test suite and leaves the repo compilable. They land as **commits on `feat/1035-demo-fresh-org-per-demo` / PR #1087**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`). Locally, run only the touched files with `--testPathPattern`; the full suites are CI's job.

```bash
cd apps/api && npm run test:integration -- --testPathPattern demo-
cd packages/admin-cli && npm run test:unit
cd packages/cli-env && npm run test:unit
cd packages/core && npm run test:unit -- --testPathPattern organization.model
```

Each slice goes through five steps:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary. Slice 1 also runs the root `npm run build`, because a core model change ripples into typed fixtures.
5. Move to the next slice.

Sequencing rationale, from the leaves to the wiring, with removals placed where they keep the tree compiling:

- **Slice 1:** the marker (core, table, migration, admin-cli mirror). Everything later reads or writes `isDemo`.
- **Slice 2:** `seed` takes `stationId`, registration becomes fatal, and `reset` goes. Changing `seed`'s signature breaks `db:demo:seed` / `db:demo:reset`, so both scripts and the admin-cli `demo seed` / `demo reset` commands that spawn them are removed **in this slice**. Between slices 2 and 5 the CLI has no demo command, but nothing is broken.
- **Slice 3:** `createDemoOrganization` and the `db:demo:create` script with cleanup. Uses slices 1 and 2.
- **Slice 4:** `cli-env`'s `extraEnv` and `isAwsNotFound`. These are pure transport, kept separate so slice 5's tests can rely on them.
- **Slice 5:** `demo create` / `demo delete`, plus `store.getTier` and `softDeleteDemoOrg`. Uses slices 1, 3 and 4.
- **Slice 6:** docs and the release-notes step.

---

## Slice 1 — The `is_demo` marker

This slice adds the column end to end. Nothing sets it yet.

**Files**

- Edit:
  - `packages/core/src/models/organization.model.ts`: add `isDemo: z.boolean().default(false)`.
  - `apps/api/src/db/schema/organizations.table.ts`: add `isDemo: boolean("is_demo").notNull().default(false)`.
  - `packages/admin-cli/src/tables.ts`: mirror the column.
- New: `apps/api/drizzle/0137_organization-is-demo.sql`, `meta/0137_snapshot.json`, and the `meta/_journal.json` entry, created by `npm run db:generate -- --name organization-is-demo`.
- Edit (tests): `packages/core/src/__tests__/models/organization.model.test.ts`.

**Steps**

1. **Tests (spec: core case).** `OrganizationSchema.parse` without `isDemo` gives `false`. Run it and confirm it fails.
2. **Implement** the model field, the table column and the mirror. Generate the migration and check that it is the one `ADD COLUMN … DEFAULT false NOT NULL` statement. Turn the tests green. Also check that `tables-parity.test.ts` and the `type-checks.ts` assertions compile.
3. Run `npm run lint:migrations` from the root, then lint, type-check and the root `npm run build`. The build catches any typed `Organization` fixture in web or site that now lacks `isDemo`; add `isDemo: false` to those fixtures.

**Done when:** the core case and parity pass, the migration applies locally (`npm run db:migrate`), and the build is green.

**Risk:**
- The journal and snapshot must be committed with the `.sql` file (`project_drizzle_journal_must_be_committed`).
- Web and site fixtures that type an `Organization` literally will need the new field.

---

## Slice 2 — `seed({orgId, stationId, rows})`, fatal registration, and removing `reset`

The seed stops looking up a station. The old reset and refresh path goes away.

**Files**

- Edit:
  - `apps/api/src/services/demo-seed.service.ts`:
    - `seed` takes `stationId` and a required `rows`, and returns `stationId`.
    - `ensureStationLinks(stationId, ids)` and `seedToolpacks(orgId, stationId)` take the id; both `findByOrganizationId` reads go.
    - Registration failure rethrows.
    - Delete `reset`, `DemoResetResult`, the reset helpers and `DEFAULT_TRANSACTION_ROWS`.
  - `apps/api/src/__tests__/__integration__/utils/demo-seed.util.ts`: the helper provisions an org, creates a station, and passes its id.
  - `demo-seed.counts.integration.test.ts` and `demo-seed.toolpacks.integration.test.ts`: the cases below.
  - `apps/api/package.json`: remove `db:demo:seed` and `db:demo:reset`.
  - `packages/admin-cli/src/commands/demo.ts`: remove `demoSeed` / `demoReset`. The file keeps only its header until slice 5, or is deleted if it would be empty.
  - `packages/admin-cli/src/bin.ts`: remove the `demo` group.
  - `packages/admin-cli/src/__tests__/commands.test.ts`: remove the tests at `:410-460`.
  - `apps/api/src/__tests__/__integration__/durations.json`: drop the reset entry.
  - `packages/cli-env/src/__tests__/spawn.test.ts`: its sample script name `db:demo:seed` becomes `db:create-org`. It is only a sample.
- Delete:
  - `apps/api/src/db/demo-seed.ts`
  - `apps/api/src/db/demo-reset.ts`
  - `apps/api/src/__tests__/__integration__/services/demo-seed.reset.integration.test.ts`

**Steps**

1. **Tests (spec: the counts and toolpacks cases).**
   - Counts: every demo instance links to the passed station and none link to Administrate or Playground, and `transactions` equals `rows` (use a small `rows`, such as 50).
   - Toolpacks:
     - packs land on the passed station only;
     - an unreachable `DEMO_TOOLPACK_URL` rejects;
     - with no URL set, only built-ins are enabled.

   Run them and confirm they fail, including on type errors.
2. **Implement** the signature change and rethrow, then the deletions. Turn the tests green.
3. Run lint and type-check across api, admin-cli and cli-env.

**Done when:**
- the two remaining demo-seed suites pass;
- `grep -rn "db:demo:seed\|db:demo:reset\|DemoSeedService.reset" apps packages` returns only docs, which are handled in slice 6;
- type-check is green.

**Risk:**
- `system-principal.guard.test.ts` names demo-seed. Re-run it in case the `SEED_USER` usage moved.
- The `durations.json` total shrinks. That's fine, because the planner recomputes it.

---

## Slice 3 — `createDemoOrganization` and the `db:demo:create` script

This slice is the API half of `demo create`: one transaction, then the load, then cleanup if the load fails.

**Files**

- Edit:
  - `apps/api/src/demo/dataset-manifest.ts`: export `DEMO_STATION_NAME` and `DEMO_STATION_DESCRIPTION`.
  - `apps/api/src/services/application.service.ts`: add `createDemoOrganization({ownerEmail, name, tier})`, following the spec's §Surface.
  - `apps/api/package.json`: add `"db:demo:create"`.
- New:
  - `apps/api/src/db/demo-create.ts`: arg validation, then create, then the stderr id line, then `seed`, then a soft delete on failure, then one JSON line. `main` is exported so the test can drive it, and runs only when the file is executed directly.
  - `apps/api/src/__tests__/__integration__/services/demo-create.integration.test.ts`
  - `apps/api/src/__tests__/__integration__/scripts/demo-create.script.integration.test.ts`

**Steps**

1. **Tests (spec: the `demo-create` and script cases).**
   - `createDemoOrganization` gives:
     - `isDemo`, the tier and the owner;
     - Administrate and Playground as a normal provision has them, plus "Demo";
     - a default station of Administrate.
   - It fails in these cases:
     - An unknown owner throws and leaves no org.
     - An unknown tier throws, and the rollback leaves no org and no station.
   - The same name twice gives two orgs.
   - **Script:**
     - When `DemoSeedService.seed` is stubbed to throw (`jest.unstable_mockModule`), the org is soft-deleted, stderr names its id, and the exit code is 1.
     - A successful run with a small `rows` prints the spec's JSON line.

   Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Add the two new files to `durations.json` with their local times, then run `npm run lint:integration-durations`, lint and type-check.

**Done when:** both new suites pass, and running `npm run db:demo:create -- --name x --owner-email <local user> --tier enterprise --rows 100` from `apps/api` creates a working org.

**Risk:**
- A script's `process.exit` inside a test. Keep the exit in the `import.meta` entry guard and have `main` return a code instead.

---

## Slice 4 — `runApiScript` `extraEnv` and `isAwsNotFound`

This slice is transport only, in `cli-env`.

**Files**

- Edit:
  - `packages/cli-env/src/spawn.ts`: add a trailing `extraEnv: Record<string, string> = {}` parameter, merged under `injected`.
  - `packages/cli-env/src/aws.ts`: add `isAwsNotFound(err)`.
  - `packages/cli-env/src/index.ts`: export it.
  - `src/__tests__/spawn.test.ts` and `src/__tests__/aws.test.ts`.

**Steps**

1. **Tests (spec: the cli-env cases).**
   - `extraEnv` reaches the spawner, and an injected `DATABASE_URL` overrides a colliding `extraEnv` key.
   - `isAwsNotFound` is true for `ParameterNotFound` and `ResourceNotFoundException`, both directly and through `cause`, and false for other errors and for non-errors.

   Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Run lint and type-check, including devops-cli and admin-cli, which consume `runApiScript`.

**Done when:** the cli-env cases pass and the existing callers are unchanged.

**Risk:** none. The new parameter is optional.

---

## Slice 5 — `portalai demo create` / `demo delete`

This slice is the CLI surface, built on slices 1, 3 and 4.

**Files**

- Edit:
  - `packages/admin-cli/src/store.ts`: add `getTier(slug)`, which `setTier` reuses, and `softDeleteDemoOrg(id, actor)`. Add both to the `AdminStore` interface.
  - `packages/admin-cli/src/commands/demo.ts`: add `DEMO_DEFAULT_TIER`, `DEMO_DEFAULT_ROWS`, `demoCreate` with a `readConfig` test seam, and `demoDelete`. Rewrite the header comment.
  - `packages/admin-cli/src/bin.ts`: add the `demo create` / `demo delete` group.
  - The tests: `commands.test.ts`, `store.test.ts` and `bin.test.ts`.

**Steps**

1. **Tests (spec: the admin-cli cases).**
   - **Store (PGlite):**
     - `softDeleteDemoOrg` deletes a demo org.
     - It refuses a non-demo org with exit 9 and leaves the row unchanged.
     - A missing or deleted org gives exit 8.
     - `getTier` behaves as live or not-found.
   - **Commands:**
     - **`demo create`:**
       - It spawns `db:demo:create` with the default flags and with the given flags.
       - The guard gives exit 5 on app-dev without `--yes` and on prod without `--confirm-prod`, with no spawn.
       - An unknown owner or tier gives exit 8 with no spawn.
       - An invalid name or row count gives exit 2.
       - On an AWS env, a missing param or secret (through a fake `readConfig`) gives exit 3 with no spawn.
       - `extraEnv` carries both values.
       - The audit line is written and the reminder goes to stderr.
     - **`demo delete`:** prod succeeds with `--yes --confirm-prod` and gives exit 5 without them.
   - **bin:** `demo seed` / `demo reset` are absent, and the `demo create` defaults are present.

   Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Run lint and type-check, then do a local end-to-end run:
   - `npm run build --workspace @portalai/admin-cli` (npx runs `dist`)
   - `npx portalai demo create --name "Acme demo" --owner-email <local user> --rows 200 --env local`
   - then `npx portalai demo delete <id> --env local`

**Done when:** every admin-cli case passes and the local round trip creates and deletes a demo org.

**Risk:** the `readConfig` default calls the real AWS helpers. Make sure no unit test reaches it, since every AWS-env test injects a fake.

---

## Slice 6 — Docs and release notes

This slice brings every surface that describes the old flow up to date (`CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit:
  - `packages/admin-cli/COMMANDS.md`:
    - the guard tables at `:25-26`: `demo create` and `demo delete` under mutation, `demo reset` gone;
    - the spawn note at `:32`;
    - replace `:87-92` with the `demo create` / `demo delete` entries.
  - `docs/CLI_OPERATIONS_CHARTER.md`: rows `:150-151`, and the counts paragraph at `:214`.
  - `docs/DEMO_ORG.runbook.md`:
    - provisioning becomes `demo create` per client, with `--tier demo` as an option;
    - remove the reset and refresh guidance and the 1M-transport section, keeping its caveat under `--rows`;
    - add the killed-process recovery (`demo delete <id>`).
  - `docs/PROD_PROVISIONING.runbook.md:238`: "`portalai demo seed` and friends" becomes `demo create`.
  - `packages/devops-cli/COMMANDS.md`: the `demo` tier paragraph.
  - `packages/devops-cli/src/catalog.ts:66,106-108`: comments name `demo create` and say it reads both values.
- Also: the PR body's release notes (spec § Release notes), and the old demo org ids recorded on #1035.

**Steps**

1. **Check (no new tests).** Run `npm run lint:doc-pointers` and the permission-copy guards (`npm run test:unit` in api and web, scoped with `--testPathPattern permission-copy`), since both scan the durable `docs/`.
2. Edit the docs, then re-run both.

**Done when:** `grep -rn "demo seed\|demo reset\|db:demo:seed\|db:demo:reset" --include=*.md --include=*.ts . | grep -v node_modules` finds only swept phase docs, git history and this ticket's own docs.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `is_demo` column, model, mirror, migration 0137 | core case, parity, root build |
| 2 | `seed(stationId)`, fatal registration; old scripts, commands and reset removed | demo-seed counts and toolpacks |
| 3 | `createDemoOrganization` and `db:demo:create` with cleanup | demo-create service and script suites |
| 4 | `extraEnv`, `isAwsNotFound` | cli-env spawn and aws |
| 5 | `demo create` / `demo delete`, `getTier`, `softDeleteDemoOrg` | admin-cli commands, store and bin; local round trip |
| 6 | Docs and release notes | doc-pointers, permission-copy guards |

## Cross-slice notes

- **Migration ordering.** 0137 must stay the next index. If `main` gains a migration before merge, regenerate after merging `main`, not by renaming.
- **CLI gap.** Between slices 2 and 5 there is no `portalai demo` command. That's acceptable on a feature branch, and the PR lands all six slices together.
- **The `--rows` cap of 10,000,000** is checked in both the CLI and the script, in slices 3 and 5. Keep the two constants equal: the script owns its own copy, because admin-cli can't import api.
- **Stale builds.** Rebuild core before the api integration tests after slice 1 (`project_stale_core_dist_after_branch_switch`), and rebuild admin-cli before any `npx portalai` run (`project_npx_uses_stale_dist`).
- **Review chain.** After slice 6: `/code-review`, `/security-review` (it touches data access and multi-tenancy deletion), `/smoke`, and `/adversarial-review` (non-demo deletion, prod guard, a killed load).

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
