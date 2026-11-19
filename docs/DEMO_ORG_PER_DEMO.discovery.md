# Demo org per demo — Discovery

**Issue:** [EnterpriseBT/portal-ai#1035](https://github.com/EnterpriseBT/portal-ai/issues/1035)

**Why this exists.** `portalai demo seed --org <id>` loads the demo dataset into an org that already exists, and `demo reset` puts it back. That only works if the seed can predict everything people have changed in the org since it was last seeded, and it can't. #848 made the failure concrete: a new org now has two stations (Administrate and Playground), and `DemoSeedService` attaches the demo connectors and packs to `stations.findByOrganizationId(orgId)[0]`, an unordered read that can land on either one.

The fix is to stop reusing orgs. Each demo gets a newly provisioned org that the command creates itself, so the command already knows every id it needs. The org can be changed freely during the demo, and afterwards it is kept as a reference or deleted. This is the command that creates one throwaway demo org per client.

## The current shape

### The seed

| Piece | Location | Note |
|---|---|---|
| `DemoSeedService.seed({orgId, rows?})` | `apps/api/src/services/demo-seed.service.ts:173` | Connectors → station links → 10 demo entities → `transactions` → packs |
| `reset({orgId, rows?})` | `demo-seed.service.ts:255-337` | Hard-deletes portals, then each demo entity's records and `er__` table, then calls `seed` again |
| `DEFAULT_TRANSACTION_ROWS` | `demo-seed.service.ts:66` | 1,000,000 |
| First-station lookups | `demo-seed.service.ts:352-357` (`seedToolpacks`), `:513-518` (`ensureStationLinks`) | `findByOrganizationId` has no `ORDER BY` (`stations.repository.ts:28-38`) |
| Sandbox requirement | `demo-seed.service.ts:540-580` | Throws "provision the org first" when the org has no Sandbox |
| Custom toolpack | `demo-seed.service.ts:361`, `:409-430`, `:441-494` | URL from `process.env.DEMO_TOOLPACK_URL`; signing secret from `DEMO_TOOLPACK_SIGNING_SECRETS`, then the existing row, then a freshly minted one. **A registration failure is only a warning** (`:364-378`) |
| Scripts | `apps/api/package.json:43-44` → `src/db/demo-seed.ts`, `src/db/demo-reset.ts` | Parse args by hand; print one JSON line; exit 1 on failure |

The seed is idempotent, because every write is an upsert, but it is not transactional, so a failure partway leaves a partial org behind.

### Provisioning, tier, delete

| Piece | Location | Note |
|---|---|---|
| `provisionOrganizationWorkspace(orgId, tx)` | `apps/api/src/services/application.service.ts:792-878` | Column definitions, RBAC, Sandbox, `PROVISIONED_STATIONS` (`constants/provisioned-stations.constants.ts:25-42`), `defaultStationId` = Administrate |
| `provisionOrganizationInTx` / `provisionOrganizationFor` | `application.service.ts:700-768`, `:511` | Creates the org, the owner membership and owner role, then the workspace |
| `createOrganizationForEmail` | `application.service.ts:521-527` | Plain `Error("User … not found")` |
| `assignOrgTier` (private, can run inside a transaction) | `application.service.ts:681-697` | Already used by `seedOrganization`'s `opts.tier` (`:532-675`) |
| `org create` | `packages/admin-cli/src/commands/provision.ts:195-214` → `apps/api/src/db/create-org.ts` | Spawned. A missing owner exits **7**, not 8 (`COMMANDS.md:48`) |
| `org delete` | `packages/admin-cli/src/commands/org.ts:143-152` → `store.softDeleteOrg` (`store.ts:318-325`) | In-process `UPDATE` of `deleted`/`deletedBy` on the org row only. No cascade, no job check. Destructive class |
| Guard | `packages/cli-env/src/guard.ts:132-161` | prod: destructive → exit 6; mutation → needs `--yes --confirm-prod` |
| Demo commands | `packages/admin-cli/src/commands/demo.ts:30-63`, `bin.ts:307-346` | `beginMutation` → `runApiScript` → `lastJsonLine` → `audit` |
| `runApiScript` | `packages/cli-env/src/spawn.ts:61-101` | Injects `DATABASE_URL`, and on AWS envs `ENCRYPTION_KEY` and `SYSTEM_ID` (`getParam(def,"system-id")`). Nothing else |
| Catalog | `packages/devops-cli/src/catalog.ts:72` (`DEMO_TOOLPACK_SIGNING_SECRETS`, secret), `:109` (`DEMO_TOOLPACK_URL`, SSM) | The comment at `:106-108` says the CLI passes the URL to the seed. It doesn't |

### Model, tests, docs

- Org schema: `organizations.table.ts:17-61`, `organization.model.ts:12-32`, `type-checks.ts:169-180`, and the admin-cli mirror `packages/admin-cli/src/tables.ts:25-36` (pinned by `tables-parity.test.ts`). Organizations has no boolean column yet. Precedents elsewhere: `tiers.selectable` and `column_definitions.system`, both `boolean().notNull().default(false)`. The next migration is **0137**.
- Integration tests `demo-seed.{counts,reset,toolpacks}.integration.test.ts` (29s, 25s and 51s in `durations.json:164-166`), plus `utils/demo-seed.util.ts`. Admin-cli unit tests are at `commands.test.ts:410-460`.
- Docs that describe the old flow: `docs/DEMO_ORG.runbook.md` (provisioning `:20-50`, reset `:17`, `:144`), `packages/admin-cli/COMMANDS.md:25-26,32,87-92`, `docs/CLI_OPERATIONS_CHARTER.md:150-151,214`, `docs/PROD_PROVISIONING.runbook.md:238`, `packages/devops-cli/COMMANDS.md` (the `demo` tier), and `catalog.ts:66,106-108`.

## The design space

### Decision 1 — Where `demo create` runs

**A. Compose from the CLI.** Run `org create`, then `org set-tier`, then a modified `demo seed --org`. That is three spawns and three audit lines. The CLI would have to write the marker and create the station, and it would have to clean up across process boundaries.

**B. One new API script, `db:demo:create`.** A single process runs `provisionOrganizationInTx`, then the tier, the marker and the demo station in **one transaction**, then the dataset load. It catches any failure after commit and soft-deletes the org it created.

**C. In-process store calls.** This would mean reimplementing provisioning inside admin-cli, which is ruled out because provisioning lives in the API.

| | A | B | C |
|---|---|---|---|
| Ids known without a lookup | Through stdout JSON | Yes, in memory | Yes |
| Cleanup on failure | Across processes | One `try`/`catch` | One `try`/`catch` |
| Reuses provisioning | Yes | Yes | No (duplicates it) |

**Lean: B.** One process owns the org from creation to cleanup. The CLI side becomes the same `beginMutation` → `runApiScript` → `audit` shape as today.

### Decision 2 — Owner not found → exit 8

A spawned script's failure reaches the CLI as exit 7 (`EnvInfraError`). The issue needs exit 8 with nothing created. **A.** Map a typed exit code from the script, for example exit 8 → `ADMIN_NOT_FOUND`, in `runApiScript`. **B.** Have the CLI check the owner in-process first (`withStore` → `getUserByEmail`, which already exits 8) before spawning, and have the script re-check.

**Lean: B.** It uses an existing path, it refuses before anything is spawned, and it doesn't add an exit-code protocol to `runApiScript` for a single caller. The script's own check is defense in depth, for the case where the user is deleted between the two checks.

### Decision 3 — The marker

**A.** `is_demo boolean not null default false`. **B.** A nullable timestamp, `demo_created_at`. **C.** A `kind` enum (`customer | demo | qa`).

**Lean: A.** The issue asks only "is this a demo org", and the marker is internal. Org creation time already lives in `created`. A `kind` enum would invite QA orgs into scope, which is explicitly out of scope. The migration is additive with no backfill, because existing demo orgs are deleted rather than marked.

### Decision 4 — The demo station and the seed's signature

`DemoSeedService.seed` becomes `seed({orgId, stationId, rows})`. Both lookups at `:352-357` and `:513-518` use the passed `stationId`, so the service no longer reads stations at all. The create script makes a station named **"Demo"** with no packs, and `seed` writes the packs (`replaceForStation`) and the connector links. **Lean: this shape.** The station is created alongside the org in the provisioning transaction, so if the dataset load fails, the cleanup already covers it.

### Decision 5 — Toolpack configuration from the catalog

A fresh org has no existing registration to inherit a secret from, so the seed would mint a new one. On app-dev and prod the demo Lambda verifies every request against its allow-list (`packages/demo-toolpack/src/handler.ts:94-101`), so a minted secret makes the registration fetch fail. Reading only the URL from SSM is therefore not enough. **Lean:** `demo create` resolves both `DEMO_TOOLPACK_URL` (SSM, `getParam`) and `DEMO_TOOLPACK_SIGNING_SECRETS` (Secrets Manager, `getSecret`) on AWS envs, and **fails with exit 3 before spawning** when either is missing. It passes them through a new optional `extraEnv` on `runApiScript`. Local keeps reading both from the shell or the package `.env`. In the create path a registration failure becomes **fatal**, which triggers cleanup, because "every demo gets the custom toolpack" is now a requirement.

### Decision 6 — Removing the pre-existing demo orgs on prod

They predate the marker, and `org delete` is refused on prod. **A.** Set `is_demo = true` on those ids with `portalops db psql`, then run `demo delete`, which goes through the guard and the audit log. **B.** Soft-delete them directly with SQL. **C.** A one-time migration keyed by id.

**Lean: A.** The deletion goes through the same guarded, audited command operators will use from now on. The only manual SQL is the one-row marker update, recorded with the ids on the issue. C would put environment-specific ids in a migration that every residency install also runs.

## Tradeoff comparison

| | D1 one script | D2 CLI pre-check | D3 boolean | D4 `stationId` param | D5 URL + secret from catalog | D6 mark then `demo delete` |
|---|---|---|---|---|---|---|
| New pattern | No (spawned script) | No | No | No | Small (`extraEnv`) | No |
| Changes a contract | admin-cli commands | — | Org model | Service signature | `runApiScript` (additive) | — |
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Release notes |

## Recommendation

1. Add `apps/api/src/db/demo-create.ts` (`db:demo:create --name --owner-email [--tier] [--rows]`). In one transaction it calls `provisionOrganizationInTx`, sets `is_demo = true`, runs `assignOrgTier(tier ?? "enterprise")` (made reachable from the script), and creates the "Demo" station. After commit it calls `DemoSeedService.seed({orgId, stationId, rows: rows ?? 10_000})`. On any failure after commit it soft-deletes the org and exits 1. It prints `{organizationId, stationId, tier, rows}`.
2. `portalai demo create` runs `beginMutation(def, flags, false)`, checks the owner in-process (exit 8), resolves the toolpack URL and signing secret on AWS envs (exit 3 if missing), spawns, audits, and prints the `--rows` and `demo delete` reminder to stderr.
3. `portalai demo delete <id>` runs `beginMutation(def, flags, false)` and calls a new `store.softDeleteDemoOrg`. Its `UPDATE … WHERE id = $1 AND is_demo AND deleted IS NULL` refuses an unmarked org with exit 9 and a missing one with exit 8, matching `org delete`'s semantics otherwise.
4. Add `isDemo` to the core model, the Drizzle table, the type-checks, the admin-cli `tables.ts` mirror, and migration `0137`.
5. `seed` takes `stationId`. Delete `reset`, `demo-seed.ts`, `demo-reset.ts`, both npm scripts, the `demo seed`/`demo reset` commands and their tests, `demo-seed.reset.integration.test.ts`, and its `durations.json` entry.
6. A registration failure in `seedToolpacks` throws instead of warning.
7. Update `COMMANDS.md`, `CLI_OPERATIONS_CHARTER.md` (rows and counts), `DEMO_ORG.runbook.md` (rewritten around create and delete), `PROD_PROVISIONING.runbook.md:238`, and the `catalog.ts` comments.

## Open questions

1. **Default tier: `enterprise` or `demo`?** The issue says `enterprise`. The runbook's `demo` tier (free, unlimited, every pack) was built for exactly this purpose, but on app-dev and prod it is created scoped to one org (`--visible-to-org`), so a new org may not be able to select it. `enterprise` comes from the catalog in every env but has finite allocations, so a busy demo could run into quota. **Lean: keep `enterprise`** as the issue says, and have spec check whether `assignOrgTier` honours tier visibility. If it doesn't, the runbook can recommend `--tier demo`.
2. **Should the Demo station become the org's default?** The issue says the provisioned stations stay exactly as a new org has them, but `defaultStationId` is an org field, and presenters land on the default station. **Lean: leave Administrate as the default.** The presenter script opens the Demo station by name, and the org then matches a normal new org.
3. **What if the process is killed mid-load?** A `SIGKILL`, a dropped tunnel or a sleeping laptop gives the `catch` no chance to run, so a marked org is left behind. **Lean: accept it.** The org is marked, so `demo delete <id>` removes it. The script prints the new org id to stderr before the load starts so the operator has it. At 10K rows the window is short.
4. **Is `demo delete` while jobs are running safe?** It does what `org delete` does: it tombstones the org row only, with no job check. Per the PRD amendment, it adds no demo-specific rule. **Lean: same as `org delete`.** Running jobs finish against a deleted org, and retention reclaims the data.

## Enterprise-scale considerations

- **Concurrency & correctness.** Each run creates its own org, so two concurrent creates never share state, and the station lookup bug disappears by construction. Provisioning, marker, tier and station commit together. Lean: no locking needed.
- **Accuracy & auditability.** Both commands write the CLI audit line, and the marker is durable on the row. Lean: enough for an operator-only tool.
- **Failure modes.** Fail closed on missing toolpack config before anything is created. A failed load triggers a compensating soft-delete. A killed process leaves a marked org that `demo delete` can remove. Lean: as above.
- **Scale & unbounded growth.** Lowering the default from 1M to 10K rows removes the ~110-minute tunnel transfer. Finished demos are soft-deleted, and record retention reclaims them. Lean: the reminder line is the backstop. A sweep of old demo orgs isn't needed while they are created by hand.
- **Multi-tenancy.** One org per client isolates demos from each other and from QA orgs. `demo delete` can't touch a customer org because of the marker filter. Lean: as above.
- **Contract stability.** A boolean marker is enough for now. Lean: if QA or sandbox org kinds appear later, migrate to a `kind` column then.
- **Data lifecycle.** Soft delete plus the existing retention purge, with no new window. N/A beyond that.

## What this doesn't decide

- Any UI for demo orgs, hard deletion, changes to the dataset itself, and the e2e QA orgs. All are out of scope in the issue.
- Running `demo create` from inside the env (bastion or one-off task). At 10K rows the tunnel is fine, and `--rows 1000000` keeps the runbook's transport caveat.
- Whether the `demo` tier should be unscoped on app-dev and prod (open question 1). That is a tier-catalog decision, not this ticket's.

## Next step

`docs/DEMO_ORG_PER_DEMO.spec.md` pins the commands' flags, exit codes and JSON, the `isDemo` field, the `seed` signature and the `extraEnv` contract. `docs/DEMO_ORG_PER_DEMO.plan.md` slices it roughly as:
1. The marker: model, table, migration, mirror.
2. `seed({stationId})` and fatal registration.
3. The `db:demo:create` script with cleanup, plus an integration test.
4. `runApiScript` `extraEnv` and `demo create`.
5. `demo delete`.
6. Removing seed and reset.
7. Docs and the release-notes step for the old orgs.
