# DevOps CLI — Discovery

**Issue:** [EnterpriseBT/portal-ai#192](https://github.com/EnterpriseBT/portal-ai/issues/192) · epic **Portal CLIs** (#191) · foundation **#194 (`@portalai/cli-env`, shipped)**

**Why this exists.** `apps/api/scripts/api-cli.sh` (625 lines of bash) is the operator tool for deployed environments — DB tunnels, truncate/seed, and the Secrets Manager/SSM config catalog. It's untestable, a second toolchain, and its env/secret/tunnel guts now duplicate what #194 shipped as tested TypeScript. This ticket ports it to `@portalai/devops-cli` — the **infrastructure** CLI of the epic (AWS-IAM domain; customer app-data is #190) — built on `cli-env`'s primitives, agent-operable per the epic's design requirements, and retires the bash.

## The current shape

### The full api-cli.sh surface (the port inventory)

| Group | Command | Does | Key lines |
|---|---|---|---|
| db | `tunnel` | SSM port-forward via bastion; prints psql hint; Ctrl+C closes | `:182-214, 295-305` |
| db | `psql` | interactive psql through the tunnel | `:214, 327-335` |
| db | `reset` | TRUNCATE every public table except `__drizzle_migrations`, CASCADE | `:217-233, 306-312` |
| db | `seed` | `db:seed:ci` as an ECS one-off `run-task` (cluster/service `portalai-${ENV}`) | `:235-286, 314-316` |
| db | `reset-seed` | reset + seed | `:318-326` |
| vars | `describe` / `list` | the SECRETS (8) + PARAMS (8) catalog; secrets masked (`UNMASK=1` reveals), SSM shown plain | `:345-479` |
| vars | `get` / `set` | read / write one key (set accepts `-` = stdin; refuses empty) | `:481-508` |
| vars | `apply` | batch-apply a KEY=VALUE env file (validates every key first) | `:510-551` |
| vars | `template` | generate a pre-filled `cloud-vars.${ENV}.env` (refuses overwrite; warns plaintext) | `:553-581` |

Catalog entries map `ENV_VAR → path (+ SSM type)` under `portalai/${ENV}` / `/portalai/${ENV}` (`:77-98`). No CI references the script.

### npm scripts removed by THIS ticket (the retire list)

| Script (`apps/api/package.json`) | Fate in #192 | Replacement |
|---|---|---|
| `cli` (`:37`) | **Removed** — wrapper of the deleted `api-cli.sh` | `portalops …` |
| `db:tunnel` (`:38`) | **Removed** | `portalops db tunnel --env <env>` |
| `db:reset:hard` | **Removed** — absorbed: `db reset` adopts reset-hard's partition semantics over `resolveEnvConnection` | `portalops db reset --env local` |

*(Corrections: `db:reset` (npm) is `ResetService.resetOrganization` — an **org-scoped app-data reset**, #190's domain — it **stays** and moves to the App-admin CLI later. `db:reset:hard` (`apps/api/src/db/reset-hard.ts`) is the infra reset, and its semantics supersede the bash `do_reset`: it DROPs dynamic `er__*` wide tables (truncating them orphans them — #106) and truncates the rest, excluding `__drizzle_migrations`. `portalops db reset` ports THOSE semantics — no `--hard` flag; the bash's naive TRUNCATE-all was a latent #106 bug. `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md`'s retire-map table is corrected accordingly in this PR.)*

**Explicitly staying:** `db:seed` (the `predev` bootstrap) and `db:seed:ci` (the command the ECS one-off task runs *inside* the container — deleting it would break `db seed` itself); `db:reset` (org-scoped app-data reset → #190); the drizzle workflow (`db:generate/migrate/push/studio`); `tunnel` (ngrok webhook dev) and `webhook:toolpack`.

### Documentation deliverables (first-class, for humans AND agents)

Per the epic's agent-operability requirement, docs are a shipped artifact, not an afterthought:

- **`packages/devops-cli/README.md`** — detailed human docs: install/auth prerequisites, every command with flags, guard semantics per env kind, catalog reference, troubleshooting (typed error codes → fixes).
- **CLI reference for agent use** — a complete, structured command reference (every command's synopsis, flags, `--json` output shape, exit codes / `CliEnvError` codes) written so an AI agent can operate the CLI from the doc alone; generated `--help` must match it.
- **Quickstarts** — a "common commands" section mapping the muscle-memory workflows, including every removed npm script's equivalent:

  | Before | Now |
  |---|---|
  | `npm run db:tunnel` | `portalops db tunnel --env app-dev` |
  | `npm run cli -- db psql` | `portalops db psql --env app-dev` |
  | `npm run db:reset:hard` | `portalops db reset --env local` |
  | `ENV=dev ./scripts/api-cli.sh vars list` | `portalops vars list --env app-dev` |
  | `ENV=dev ./scripts/api-cli.sh db seed` | `portalops db seed --env app-dev --yes` |

### What #194 already provides (don't re-port)

`@portalai/cli-env` ships tested: the env **registry** (`--env`, `kind`, AWS naming incl. `app-dev`→`dev`), **`getSecret`/`getParam`**, the **SSM tunnel** (signal-safe, orphan-proof — smoke-hardened), **guards** (`assertOperationAllowed`, `envBanner`), **audit** (`recordAudit`), typed `CliEnvError` codes, and `resolveEnvConnection`. The bash equivalents of all of that delete rather than port. **Gaps cli-env doesn't cover:** `putSecret`/`putParam` (it's read-only today), ECS `run-task`, psql spawning, truncate, masking, template/apply.

### Toolchain precedent

No direct CLI-framework dependency exists (`commander` appears only as a transitive d3 dep). `packages/cli-env` is the package-scaffold template (tsc, ESM jest, eslint flat config, node-only).

## The design space

### Decision 1 — Command surface: faithful port vs reshape

**Lean: faithful, verb-for-verb** — `portalops db tunnel|psql|reset|seed|reset-seed` and `vars describe|list|get|set|apply|template`, with `ENV=x` replaced by the global `--env <name>` flag and new globals `--json`, `--yes`, `--confirm-prod`, `--unmask` (replacing `UNMASK=1`). Muscle memory and existing README examples carry over; reshaping the verbs is churn with no capability gain.

### Decision 2 — What extends cli-env vs lives here

The write primitives (`putSecret`, `putParam`) are generic AWS ops, exactly symmetric with the getters cli-env already owns — **Lean: add them to `@portalai/cli-env`** (small, tested, second consumer is plausible: #190's future needs). Everything app-inventory- or ops-specific stays in devops-cli: the **catalog** (which keys exist, secret-vs-SSM, types — API-app configuration inventory), ECS `run-task`, psql spawn, truncate SQL, masking, template/apply. ECS stays here per `feedback_no_speculative_infra` — one consumer.

### Decision 3 — CLI framework

| | A. `commander` | B. `node:util` parseArgs (zero-dep) |
|---|---|---|
| Nested subcommands (`db tunnel`, `vars set K V`) | native | hand-rolled dispatch |
| Help/usage generation | free | hand-written |
| Cost | one tiny, ubiquitous dep | none |

**Lean: A — commander.** Two command groups × ~11 verbs with per-command flags is exactly what it's for; hand-rolling dispatch is where CLIs breed bugs. Library-first still holds: every command body is an exported function; commander is only the thin `bin` wiring.

### Decision 4 — Agent-operability of the interactive bits

`db psql` (a human REPL, stdio-inherited) stays — but every capability needs a non-interactive path: **Lean:** pass-through args (`portalops db psql --env app-dev -- -tAc "select 1"`) so an agent runs one-shot SQL through the same tunnel plumbing; `vars get/list --json` for structured reads; `vars set` accepts stdin (`-`) as today. `login`-style prompts don't exist in this CLI at all (AWS auth is ambient).

### Decision 5 — Guard classification per command

Keyed on cli-env's `kind` gating (dev free / staging `--yes` / prod barrier; destructive **hard-blocked** in prod):

| Command | Class | Prod behavior |
|---|---|---|
| `db reset`, `db reset-seed` | **destructive** | blocked unconditionally |
| `db seed` | mutating (idempotent system-def upserts) | `--yes` + `--confirm-prod` |
| `vars set`, `vars apply` | mutating (Secrets Manager keeps `AWSPREVIOUS`, so one-step recoverable) | `--yes` + `--confirm-prod` |
| `db tunnel`, `db psql`(read), `vars get/list/describe/template` | read/connect | allowed (psql *can* write — see OQ2) |

Every mutating command records `recordAudit` and echoes `envBanner`.

### Decision 6 — Retirement mechanics

**Lean: same-PR clean cut.** Repoint `apps/api/package.json` `cli` + `db:tunnel` at the workspace bin, rewrite `apps/api/README.md`'s Operator CLI section, update the `CLAUDE.md` monorepo table (+ copilot mirror), delete `scripts/api-cli.sh` — after a manual smoke of the live paths (tunnel/seed/vars against app-dev), mirroring the #194 walkthrough. No compat shim (`feedback_no_compat_aliases`).

## Tradeoff comparison

|  | D1 faithful verbs | D2 put* → cli-env | D3 commander | D4 psql passthrough | D5 guard classes | D6 same-PR retirement |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes (cli-env edit) | Yes | Yes | Yes | Yes |
| Touches cli-env | — | small, tested addition | — | — | consumes as-is | — |
| Risk | none | low | none | low | policy call (OQ2) | gated on smoke |

## Recommendation

1. **`@portalai/devops-cli`** package (`packages/devops-cli`, scaffold cloned from cli-env), `bin: portalops` (short for portal-ops), library-first (exported command functions; commander as thin wiring).
2. **Faithful command surface** (`db` + `vars` groups, all 11 verbs) with `--env`/`--json`/`--yes`/`--confirm-prod`/`--unmask` globals.
3. **Extend cli-env with `putSecret`/`putParam`**; devops-cli owns the catalog, ECS `run-task` (`@aws-sdk/client-ecs`), psql spawn, truncate, masking, template/apply.
4. **Guards + audit on every mutating command** per the Decision-5 table; `db reset*` destructive (prod-blocked).
5. **Retire `api-cli.sh` in this PR** after a manual smoke against app-dev; **remove** the three redundant npm scripts (`cli`, `db:tunnel`, `db:reset:hard` — absorbed by `db reset` with reset-hard's partition semantics); sync README/CLAUDE.md + correct #194's retire-map table (`db:reset` stays → #190).
6. **Ship the documentation deliverables**: a detailed `README.md` (human), a structured CLI reference an agent can operate from alone (synopsis/flags/`--json` shapes/exit codes, matching `--help`), and a quickstart table mapping every removed npm script + common bash invocation to its new command.

## Open questions

1. **`db seed` for local?** The bash version is ECS-only (deployed). Local seeding is `npm run db:seed` today and the App-admin CLI's job later (#190). **Lean: keep ECS-only**; `--env local` gets a typed error pointing at `npm run db:seed`.
2. **`db psql` against prod** — an interactive psql can write, so is it "read/connect"? **Lean: allowed but gated** — opening `psql`/`tunnel` to a `production` env requires `--confirm-prod` (connect-time barrier), without classifying it destructive. Matches "prod access is a deliberate act."
3. **`vars template` writes plaintext secrets to disk** (bash version warns). Keep? **Lean: keep** — genuinely useful for env bootstrap — but write the file `0600` (improvement over bash) and keep the refuse-overwrite + warning.
4. **Default `--env`?** The bash default was `ENV=dev`. An implicit default contradicts the epic's no-implicit-env rule. **Lean: `--env` is required** (no default) — breaking from bash deliberately; the error names the known envs.

## Enterprise-scale considerations

- **Failure modes** — *engaged.* Fail-closed everywhere: required `--env` (no default — a deliberate break from bash's `ENV=dev`), kind-gated guards with prod destructive hard-blocked, typed errors, tunnel is #194's signal-safe primitive.
- **Accuracy & auditability** — *engaged.* Every mutating command (`vars set/apply`, `db seed/reset*`) writes `recordAudit` (operator/env/command/args); `vars` masks secrets by default.
- **Concurrency & correctness** — *lean:* two concurrent tunnels collide on the default local port → `--local-port` flag surfaces cli-env's existing option; ECS `run-task` is fire-and-watch (poll task status to terminal, as the bash does) — no new races.
- **Multi-tenancy** — `N/A because` this is per-environment infra tooling; isolation is IAM via cli-env.
- **Contract stability** — *engaged.* The catalog is **data** (one exported table), so new secrets/params are one-line additions; commands are exported functions a future automation (or agent harness) imports directly.
- **Scale / Data lifecycle** — `N/A` — operator tooling, no growth surface; `template` files are explicitly untracked artifacts with a plaintext warning.

## What this doesn't decide

- **Customer-org data commands** (seed/mock of app data, org CRUD) — #190's domain; this CLI stays infra-only.
- **New capabilities beyond the port** (log tailing, ECS exec, deploy helpers) — deliberately excluded so the port is reviewable; file follow-ups once the base lands.
- **Prod wiring** — the guards treat prod as first-class now; actual prod entries arrive with #83.

## Next step

`docs/DEVOPS_CLI.spec.md` (the package + bin contract, the catalog data shape, per-command signatures incl. guard class and `--json` output shapes, the cli-env `putSecret`/`putParam` addition, ECS run-task behavior, the documentation deliverables, retirement checklist) then `docs/DEVOPS_CLI.plan.md` — likely **4 slices**: (1) scaffold + catalog + `vars` read commands (describe/list/get, masking, `--json`); (2) cli-env put* + `vars set/apply/template` with guards+audit; (3) `db` group (tunnel/psql/reset with reset-hard partition semantics incl. `--env local`, ECS seed); (4) docs (README + agent CLI reference + quickstarts) + smoke + retire api-cli.sh + remove the four npm scripts + doc-sync (apps/api README, CLAUDE.md, #194 retire-map correction).
