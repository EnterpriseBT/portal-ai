# @portalai/cli-env

The shared **environment-access layer** for the Portal CLIs (epic #191): select, authorize into, and connect to any environment — `local` → `app-dev` → (future) `prod`. Consumed by `@portalai/admin-cli` (#190) and `@portalai/devops-cli` (#192). **Node-only**: never imported by `apps/web` or `packages/core`.

Design docs: `docs/CLI_DEPLOYED_ENV_ACCESS.{discovery,spec,plan}.md` (#194).

## The seam

```ts
import { resolveEnvConnection } from "@portalai/cli-env";

const conn = await resolveEnvConnection("app-dev"); // registry lookup only — no I/O yet
conn.apiBaseUrl;                 // https://api-dev.portalsai.io
conn.kind;                       // "staging" — destructive-op gating keys on this

const db = await conn.db();      // lazily: database-url secret + SSM tunnel → localhost
// … use db.connectionString …
const token = await conn.token(); // lazily: cached device-flow session (auto-refresh)

await conn.dispose();            // closes the tunnel; idempotent
```

Everything is an **exported function with no TTY coupling** — CLIs wrap these in commands; test harnesses, CI, and AI agents call them directly. All failures are typed `CliEnvError`s with stable `code`s (`ENV_NOT_CONFIGURED`, `ENV_NOT_AUTHORIZED`, `ENV_DESTRUCTIVE_BLOCKED`, `ENV_CONFIRMATION_REQUIRED`, `ENV_INFRA_ERROR`).

## The two authorization paths

| Path | Gates | How you authorize |
|---|---|---|
| **AWS IAM** (infra/DB: secrets, SSM params, tunnel) | which env's `portalai/${awsEnvName}/*` you can read | `aws sso login` (ambient credentials — never cached by this package) |
| **Auth0 device flow** (the app API) | admin app endpoints | `login(env)` once — confirm the code in a browser; session cached in `~/.portalai/credentials.json` (0600), refreshed transparently; `logout(env)` clears |

An AI agent drives the CLIs **inside a session a human authorized** — actions attribute to that human in the audit log (`~/.portalai/audit.log`, JSONL via `recordAudit`).

## Environments

Built-ins live in `src/registry.ts` (non-secret facts only — secrets always resolve from AWS at runtime):

| name | kind | apiBaseUrl | AWS env name |
|---|---|---|---|
| `local` | development | `http://localhost:3001` | — (reads `.env`; zero AWS/Auth0 setup) |
| `app-dev` | staging | `https://api-dev.portalsai.io` | **`dev`** (→ `portalai/dev/*`, `/portalai/dev/*`) |
| `prod` | production | *(added with #83)* | `prod` |

**`kind` drives the guards** (`assertOperationAllowed`): `development` free · `staging` requires `--yes` · `production` — destructive ops **hard-blocked unconditionally**, other mutations need `--yes` + the prod barrier flag.

Ad-hoc test targets (scratch DB, docker-compose): add entries to `~/.portalai/environments.json` — they are forced to `kind: "development"` and may not shadow built-ins. `PORTALAI_HOME` relocates `~/.portalai` (tests/CI).

## Provisioning (per environment — walked through at rollout)

The device flow needs a **CLI-type Auth0 application** per environment (Native app, Device Code grant enabled, the API audience authorized, refresh-token rotation on):

1. Auth0 dashboard (the env's tenant) → Applications → Create → **Native**; enable the **Device Authorization** grant; authorize it for the env's API audience; enable offline access / refresh tokens.
2. Store its client id where the registry looks:
   - AWS envs: SSM param `/portalai/<awsEnvName>/auth0-cli-client-id` (e.g. via the ops CLI's `vars set`).
   - `local`: `AUTH0_CLI_CLIENT_ID` in `apps/api/.env` (plus the existing `AUTH0_DOMAIN` / `AUTH0_AUDIENCE`).
3. The tunnel path needs the AWS CLI v2 + [session-manager-plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) installed, and your IAM identity granted the env's secret/SSM/session permissions.

## Testing

`npm run test:unit` — 46 cases; AWS SDK, Auth0 HTTP and `child_process` are mocked (CI has no bastion, IAM secrets, or a human for the device flow). Live paths are verified by the manual checklist in `docs/CLI_DEPLOYED_ENV_ACCESS.smoke.md`.
