# DevOps CLI — Spec

Pins the contract for `@portalai/devops-cli` (`portalops`): the faithful TS port of `apps/api/scripts/api-cli.sh` onto `@portalai/cli-env`, plus the cli-env write primitives, the docs deliverables, and the retirement checklist. Discovery: `docs/DEVOPS_CLI.discovery.md` (reviewed; bin renamed `portalops`). Issue: [#192](https://github.com/EnterpriseBT/portal-ai/issues/192) (epic #191).

## Key decisions (flag for review)

1. **`--env` is required — no default** (deliberate break from bash `ENV=dev`); unknown/missing env → `ENV_NOT_CONFIGURED` naming the known envs.
2. **Prod connect barrier:** `db tunnel`/`db psql` against a `production`-kind env require `--confirm-prod`; `db reset`/`db reset-seed` are **destructive** (prod hard-blocked); `db seed`, `vars set/apply` are mutations (staging `--yes`; prod `--yes --confirm-prod`).
3. **`db reset` ports `reset-hard.ts` semantics, not the bash's** — DROP dynamic `er__*` wide tables, TRUNCATE … CASCADE the rest, exclude `__drizzle_migrations` (the bash's naive TRUNCATE-all orphans wide tables, #106). No `--hard` flag. Works for every env via `resolveEnvConnection` (local `.env` DB included).
4. **`putSecret`/`putParam` land in `@portalai/cli-env`** (symmetric with its getters); `getParam` also gains `WithDecryption: true` (parity with the bash's `--with-decryption`).
5. **Agent contract**: stable exit codes mapped from `CliEnvError` codes, `--json` on every read, library-first (every command an exported function; commander only wires the bin).
6. **npm scripts removed here:** `cli`, `db:tunnel`, `db:reset:hard`. **`db:reset` stays** (org-scoped app-data reset → #190).

## Scope

### In scope
- New package `packages/devops-cli` (`@portalai/devops-cli`, `bin: portalops`): `db` group (tunnel, psql, reset, seed, reset-seed) + `vars` group (describe, list, get, set, apply, template), guards + audit + `--json`, catalog.
- `@portalai/cli-env` edits: `putSecret`, `putParam`, `getParam` decryption.
- Docs: package `README.md` (human) + `COMMANDS.md` (agent-operable CLI reference) + quickstarts.
- Retirement: delete `api-cli.sh`, remove the three npm scripts, sync `apps/api/README.md` + `CLAUDE.md` (+ copilot mirror), correct #194's retire-map table; manual smoke doc.

### Out of scope
- Org-scoped app-data reset/seed (`db:reset`, mock data) — #190. New capabilities beyond the port (log tailing, ECS exec) — follow-ups. Prod env entries — #83.

## Surface

### `packages/devops-cli` package

`"name": "@portalai/devops-cli"`, `"type": "module"`, tsc build to `dist/`, **`"bin": { "portalops": "./dist/bin.js" }`** (`#!/usr/bin/env node`), scripts/toolchain cloned from `packages/cli-env` (`test:integration: "true"`). Deps: `@portalai/cli-env` (workspace `*`), `commander` (^14), `@aws-sdk/client-ecs`, `zod`. Node-only; never imported by web/core.

### `src/catalog.ts` — the config-key catalog (data, not code)

```ts
export type CatalogKind = "secret" | "ssm";
export interface CatalogEntry { key: string; kind: CatalogKind; name: string; ssmType?: "String" | "SecureString"; }
export const CATALOG: CatalogEntry[]; // the 8 SECRETS + 8 PARAMS from api-cli.sh:77-98, verbatim keys/names/types
export function lookupKey(key: string): CatalogEntry;            // unknown → EnvNotConfiguredError naming `vars describe`
export function pathFor(def: EnvironmentDefinition, e: CatalogEntry): string; // secretsPrefix()/name or ssmPrefix()/name
export function mask(value: string): string;                      // "" → "(empty)"; len ≤ 8 → "********"; else `${v.slice(0,4)}…${v.slice(-2)} (len=N)`
```

### `@portalai/cli-env` additions (`src/aws.ts`)

```ts
/** Update-or-create (PutSecretValue; CreateSecret on ResourceNotFound). Returns
 *  { created: boolean } — a created secret WARNS (its ARN must be added to the
 *  deploy workflow / CloudFormation before the next deploy, per the bash). */
export async function putSecret(def, name, value): Promise<{ created: boolean }>;
/** SSM PutParameter { Overwrite: true, Type: e.ssmType }. */
export async function putParam(def, name, value, type?): Promise<void>;
// getParam: GetParameterCommand gains WithDecryption: true.
```
Same error taxonomy as the getters (credential → `ENV_NOT_AUTHORIZED`, transport → `ENV_INFRA_ERROR`).

### Global CLI behavior (`src/bin.ts` + `src/output.ts`)

- Globals: `--env <name>` (required), `--json`, `--yes`, `--confirm-prod`, `--unmask`, `--local-port <n>` (db group).
- Every command prints `envBanner(def)` to **stderr** (keeps stdout clean for `--json`/piping).
- Every mutating command calls `recordAudit({ env, operator, command, args })` (operator: Auth0 `sub` if a session exists, else STS ARN, else `"unknown"`).
- **Exit codes (the agent contract):** `0` success · `2` usage error (commander) · `3` ENV_NOT_CONFIGURED · `4` ENV_NOT_AUTHORIZED · `5` ENV_CONFIRMATION_REQUIRED · `6` ENV_DESTRUCTIVE_BLOCKED · `7` ENV_INFRA_ERROR · `1` anything else. `--json` errors emit `{ "error": { "code", "message" } }` on stdout.
- Library-first: each command is an exported async function `(def: EnvironmentDefinition, opts) => result`; `bin.ts` only parses args, resolves the env, applies guards, prints.

### `src/commands/vars.ts`

| Command | Behavior | `--json` shape |
|---|---|---|
| `describe` | env/region + every catalog entry with its resolved path + type — **no values** | `{ env, region, entries: [{ key, kind, path, ssmType? }] }` |
| `list` | table `KEY KIND VALUE`; secrets masked (`--unmask` reveals), SSM plain; unset → `(unset)` | `{ entries: [{ key, kind, value, masked }] }` (values masked unless `--unmask`) |
| `get <KEY>` | raw value to stdout (never masked — it's an explicit single read, matching bash) | `{ key, value }` |
| `set <KEY> <VALUE\|->` | `-` reads stdin; refuses empty; guard: mutation; audit; warns on secret **creation** | `{ key, updated: true, created }` |
| `apply <FILE>` | parse KEY=VALUE env file (comments/blank ok, quote-stripping, **every key validated before any write**, any error aborts whole file); guard once; audit per key | `{ applied: [keys] }` |
| `template [out]` | default `./cloud-vars.<env>.env`; refuses overwrite; pre-filled from live values; **written 0600**; plaintext warning to stderr | n/a (writes a file) |

### `src/commands/db.ts` + `src/ecs.ts` + `src/reset.ts`

- **`tunnel`** — `resolveEnvConnection(env).db()` (local: prints the `.env` connection string; AWS: opens the #194 tunnel), prints a ready-to-copy `psql` hint, stays open until SIGINT (the #194 signal hooks own cleanup). Prod: requires `--confirm-prod`.
- **`psql [-- args…]`** — same connection; spawns `psql <connectionString> [args…]` with inherited stdio (interactive REPL, or one-shot via passthrough e.g. `-- -tAc "select 1"`); exits with psql's code; disposes the tunnel. Prod: `--confirm-prod`. Missing `psql` binary → `ENV_INFRA_ERROR` with install guidance.
- **`reset`** — guard destructive; over the same connection (via psql spawns): query `pg_tables where schemaname='public' and tablename != '__drizzle_migrations'`; partition `er__*` → `DROP TABLE … CASCADE`, rest → one `TRUNCATE … CASCADE` (semantics of `apps/api/src/db/reset-hard.ts:14-27`, duplicated with a #106 pointer — no cross-import from an app); audit. `--json`: `{ dropped: [..], truncated: [..] }`.
- **`seed`** — guard mutation; **AWS envs only** (`local` → `ENV_NOT_CONFIGURED` pointing at `npm run db:seed`). Ports `api-cli.sh:235-286` on `@aws-sdk/client-ecs`: `DescribeServices(cluster: clusterName(def), services: ["portalai-api-<awsEnvName>"])` → `networkConfiguration` + `taskDefinition`; `DescribeTaskDefinition` → first container name; `RunTask` (FARGATE, command override `["npm","run","db:seed:ci"]`); `waitUntilTasksStopped`; `DescribeTasks` → container exit code; non-zero → `ENV_INFRA_ERROR` naming CloudWatch. `--json`: `{ taskArn, exitCode }`.
- **`reset-seed`** — destructive guard; reset then seed.

### Documentation deliverables

- **`packages/devops-cli/README.md`** (human): prerequisites (`aws login`/SSO, psql, session-manager-plugin), every command, guard semantics per `kind`, catalog reference, troubleshooting table (exit code / `CliEnvError` code → fix), and the **quickstart before→after table** (all removed npm scripts + common bash invocations, per the discovery).
- **`packages/devops-cli/COMMANDS.md`** (agent reference): one section per command — synopsis, flags, `--json` output shape, exit codes, guard class — written to be sufficient to operate the CLI without trial and error; `--help` text generated from the same commander definitions must not contradict it.

### Retirement checklist (same PR, after smoke)

1. Delete `apps/api/scripts/api-cli.sh`.
2. `apps/api/package.json`: remove `cli` (`:37`), `db:tunnel` (`:38`), `db:reset:hard`; delete `apps/api/src/db/reset-hard.ts` (absorbed).
3. Rewrite `apps/api/README.md:319+` (Operator CLI section → pointer to `packages/devops-cli`).
4. `CLAUDE.md`: monorepo table row for `@portalai/devops-cli`; **API Database Scripts** block drops `db:reset:hard`; copilot mirror updated.
5. Correct the retire-map table in `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md` (`db:reset` → stays/#190).
6. `docs/DEVOPS_CLI.smoke.md` — manual checklist (tunnel, psql passthrough, reset vs local, seed against app-dev, vars round-trip, guards, exit codes).

## Migration / Seed

**None.** No app DB schema change.

## TDD test plan

```bash
cd packages/cli-env && npm run test:unit      # put*/decryption additions
cd packages/devops-cli && npm run test:unit   # everything else (AWS/child_process/fs mocked)
```

### cli-env additions (`packages/cli-env/src/__tests__/aws.test.ts`, extend)
`putSecret` updates existing (PutSecretValue); creates on ResourceNotFound (`created: true`); `putParam` upserts with type + Overwrite; `getParam` sends `WithDecryption: true`; error taxonomy holds for writes. ≈ 5 cases.

### catalog + mask (`packages/devops-cli/src/__tests__/catalog.test.ts`)
CATALOG carries the exact 16 bash entries (pinning test); `lookupKey` unknown → typed; `pathFor` uses cli-env prefixes; `mask` rules (empty/short/long). ≈ 5 cases.

### vars commands (`…/vars.test.ts`)
describe (no values fetched); list masked vs `--unmask`, `(unset)` handling, `--json` shape; get raw; set: stdin `-`, refuse-empty, created-secret warn, guard + audit called; apply: valid file batch, per-line validation aborts before any write, quote stripping; template: refuses overwrite, 0600, pre-filled. ≈ 11 cases.

### db commands (`…/db.test.ts`, `…/ecs.test.ts`, `…/reset.test.ts`)
reset partitions `er__*`→DROP / rest→TRUNCATE, excludes `__drizzle_migrations`, destructive guard (prod blocked); seed: happy path (network config → run-task override → wait → exit 0), non-zero exit → `ENV_INFRA_ERROR`, `local` → typed pointer at `npm run db:seed`; psql passthrough argv + missing-binary error; tunnel/psql prod `--confirm-prod` barrier. ≈ 10 cases.

### bin wiring (`…/bin.test.ts`)
`--env` required; exit-code mapping for `ENV_CONFIRMATION_REQUIRED` / `ENV_DESTRUCTIVE_BLOCKED` / `ENV_NOT_CONFIGURED`; `--json` error envelope on stdout, banner on stderr. ≈ 4 cases.

**Totals ≈ 35 cases** (5 cli-env + 30 devops-cli), all unit; live paths via the manual smoke. No migration test.

## Acceptance criteria
- [ ] Every api-cli.sh capability has a `portalops` equivalent (the discovery's inventory table), verified against app-dev in the smoke.
- [ ] `--env` is mandatory everywhere; prod: connect barrier, mutation barrier, destructive hard-block — all typed + correct exit codes.
- [ ] `db reset` never touches `__drizzle_migrations`, DROPs `er__*`, works for `--env local`.
- [ ] `vars` round-trip (describe/list/get/set/apply/template) matches bash behavior incl. masking + created-secret warning.
- [ ] Every mutation writes an audit line; `--json` outputs match `COMMANDS.md`.
- [ ] `api-cli.sh`, `reset-hard.ts`, and the three npm scripts are gone; `apps/api/README.md`/`CLAUDE.md` updated; no repo reference to the deleted script remains.
- [ ] README + COMMANDS.md shipped; quickstart table covers every removed script.

## Risks & rollback
- **Deleting live tooling** — the cut lands only after the smoke passes against app-dev in the same PR; rollback = revert (bash returns intact).
- **`db reset` semantic change** (partition-aware vs bash TRUNCATE-all) — deliberate bug fix (#106); called out in README.
- **Created-secret drift** — `putSecret` create path warns about CloudFormation/deploy-workflow ARNs exactly as bash did; not silently absorbed.
- **Fail-closed posture** unchanged from the epic: required env, typed errors, guards.

## Files touched
- New: `packages/devops-cli/*` (package scaffold, `src/{catalog,output,ecs,reset}.ts`, `src/commands/{vars,db}.ts`, `src/bin.ts`, `src/__tests__/*`, `README.md`, `COMMANDS.md`).
- Edit: `packages/cli-env/src/aws.ts` (+ its test), `packages/cli-env/README.md` (put* mention).
- Edit/Delete (retirement): `apps/api/scripts/api-cli.sh` (delete), `apps/api/src/db/reset-hard.ts` (delete), `apps/api/package.json`, `apps/api/README.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md` (retire-map correction).
- New: `docs/DEVOPS_CLI.smoke.md`.

## Next step
`docs/DEVOPS_CLI.plan.md` — **4 slices**: (1) cli-env put*/decryption + devops-cli scaffold + catalog/mask + `vars` reads; (2) `vars` writes (set/apply/template) with guards+audit; (3) `db` group (reset, ECS seed, tunnel/psql wiring) + bin + exit codes; (4) docs (README/COMMANDS/quickstarts) + smoke + retirement + doc-sync.
