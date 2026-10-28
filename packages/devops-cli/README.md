# @portalai/devops-cli — `portalops`

Portal's **infrastructure operator CLI**: DB tunnels/psql/reset/seed and the managed Secrets Manager + SSM config catalog, per environment. The TypeScript port of the retired `apps/api/scripts/api-cli.sh`, built on [`@portalai/cli-env`](../cli-env/README.md) (#192, epic #191). Infra only — customer application data (orgs, users, app seeding) is the App-admin CLI's domain (#190).

**Agent-operable by design**: non-interactive flags, `--json` everywhere, stable exit codes, library-first (every command is an importable function; the bin is thin wiring). The complete machine-readable reference is [`COMMANDS.md`](./COMMANDS.md); the agent-operability contract (exit codes, server-enforced guards, auth, audit) is in [CLAUDE.md → Operating the Portal CLIs](../../CLAUDE.md).

## Running it

From the **repo root** (the workspace bin resolves via `node_modules/.bin`):

```bash
npm install && npx turbo run build --filter=@portalai/devops-cli   # one-time; rebuild after pulling CLI changes
npx portalops --help
npx portalops vars list --env app-dev
```

Want it bare? `alias portalops="npx portalops"`, or `npm link` inside `packages/devops-cli` to put `portalops` on your PATH.

For `--env local`, the CLI auto-loads `DATABASE_URL` from its **own package `.env`** — `packages/devops-cli/.env`, git-ignored; copy it from the committed `.env.example` (#632). An explicit shell export still wins, and `app-dev`/`prod` ignore the file.

```bash
cp packages/devops-cli/.env.example packages/devops-cli/.env   # once; set DATABASE_URL
npx portalops db reset --env local
```

## Prerequisites

- **AWS credentials** (deployed envs): `aws login` / SSO — your IAM identity is the per-env authorization (`portalai/<awsEnvName>/*`).
- **psql** (PostgreSQL client tools) for `db psql` / `db reset`.
- **session-manager-plugin** for tunnels ([install](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)).
- `local` needs none of the above — it uses `DATABASE_URL` from `packages/devops-cli/.env` (or the process env, which wins).

## Quickstart (before → after)

| You used to run | Now |
|---|---|
| `npm run db:tunnel` | `portalops db tunnel --env app-dev` |
| `npm run cli -- db psql` | `portalops db psql --env app-dev` |
| `npm run db:reset:hard` | `portalops db reset --env local --yes`* |
| `ENV=dev ./scripts/api-cli.sh db seed` | `portalops db seed --env app-dev --yes` |
| `ENV=dev ./scripts/api-cli.sh db reset-seed` | `portalops db reset-seed --env app-dev --yes` |
| `ENV=dev ./scripts/api-cli.sh vars list` | `portalops vars list --env app-dev` |
| `UNMASK=1 … vars list` | `portalops vars list --env app-dev --unmask` |
| `… vars set TAVILY_API_KEY -` | `portalops vars set TAVILY_API_KEY - --env app-dev --yes` |
| `… vars template` | `portalops vars template --env app-dev` |

\* `local` is `kind: development` — no `--yes` needed there; shown for the staging habit.

One-shot SQL for scripts/agents (no REPL):

```bash
portalops db psql --env app-dev -- -tAc "select count(*) from organizations"
```

## The rules the CLI enforces

- **`--env` is required everywhere. There is no default environment** — a deliberate break from the bash's `ENV=dev`.
- **Guards key on the environment's `kind`** (from the cli-env registry), not its name:
  - `development` (local): everything allowed, no flags.
  - `staging` (app-dev): any mutation needs `--yes`.
  - `production`: destructive ops (`db reset`, `db reset-seed`) are **refused unconditionally**; other mutations need `--yes --confirm-prod`; even *connecting* (`db tunnel`/`db psql`) needs `--confirm-prod`.
- **Every mutation is audited** to `~/.portalai/audit.log` (JSONL; never contains secret values).
- **Banner on stderr, payload on stdout** — pipe or `--json` safely.
- `db reset` is the *infra* reset (drops dynamic `er__*` wide tables, truncates the rest, never touches `__drizzle_migrations` — #106). It is **not** the org-scoped app-data reset, which is `portalai org reset` (`packages/admin-cli`).

## Troubleshooting (exit codes → fixes)

| Exit | Code | Fix |
|---|---|---|
| 2 | usage | check flags; `--env` is required |
| 3 | `ENV_NOT_CONFIGURED` | unknown env / key — `portalops vars describe`; local missing `.env` values |
| 4 | `ENV_NOT_AUTHORIZED` | `aws login` (or SSO) expired / IAM lacks the env's secrets |
| 5 | `ENV_CONFIRMATION_REQUIRED` | add `--yes` (staging) / `--confirm-prod` (production) |
| 6 | `ENV_DESTRUCTIVE_BLOCKED` | you asked for a destructive op against production — there is no override |
| 7 | `ENV_INFRA_ERROR` | AWS/tunnel/psql failure — message carries the cause (CloudWatch for seed tasks) |
| 8 | `TIER_NOT_FOUND` / `TIER_APPLY_MISSING_PRICES` | `tier update`/`description` named a slug that doesn't exist, or a tier's Stripe lookup key resolves to no price in the env's account |
| 9 | `TIER_ALREADY_EXISTS` | `tier create` named a slug that already exists |

## The managed config catalog

`portalops vars describe --env <env>` prints the live table. Keys map to `portalai/<awsEnvName>/<name>` (secrets) and `/portalai/<awsEnvName>/<name>` (SSM params) — note `app-dev`'s AWS env name is `dev`. Adding a managed key is a one-line entry in `src/catalog.ts`.

**`vars set` on a brand-new secret** creates it and warns: the new secret's ARN must be added to the deploy workflow / CloudFormation parameters before the next deploy.

**`vars template`** writes a pre-filled `cloud-vars.<env>.env` (0600) containing **plaintext secrets** — never commit it; `vars apply <file>` pushes it back.

## Library use

```ts
import { listVars, dbSeed } from "@portalai/devops-cli";
import { getEnvironment } from "@portalai/cli-env";

const def = getEnvironment("app-dev");
const { entries } = await listVars(def, {});          // same guards as the CLI
await dbSeed(def, { yes: true });                     // audited, typed errors
```

Guards and audit live in the command functions, not the bin — programmatic consumers (tests, CI, agents) inherit them.
