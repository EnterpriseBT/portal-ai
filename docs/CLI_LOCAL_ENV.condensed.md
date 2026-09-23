# CLI local-env auto-load — Condensed design (#632)

**Issue:** [EnterpriseBT/portal-ai#632](https://github.com/EnterpriseBT/portal-ai/issues/632) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Running `portalai` / `portalops` against `--env local` from a bare shell fails with `ENV_NOT_CONFIGURED` because `cli-env` reads `DATABASE_URL` (and `AUTH0_*` for `login`) from `process.env` for local envs, and an ad-hoc operator/agent shell hasn't exported them (the dev stack loads them via `dotenv -e .env`). Every local DB command had to be wrapped in `dotenv -e apps/api/.env --` or a manual export — friction for an "agent-operable" CLI.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Local DB read + throw | `packages/cli-env/src/connection.ts:77-86` | `!def.aws` branch reads `process.env.DATABASE_URL`, throws `EnvNotConfiguredError` if absent |
| Local AUTH0 read | `packages/cli-env/src/auth0.ts:50-68` | same `!def.aws` gate; app-dev/prod read from SSM |
| Shared `execute()` wrapper | `admin-cli/src/bin.ts:45`, `devops-cli/src/bin.ts:68` | both call `getEnvironment(opts.env)`; `opts.env` is known here |
| `.env` ignored repo-wide | root `.gitignore` (`.env`) | so `packages/*/,env` are ignored; `.env.example` is not |

## Decision — package-scoped `.env`, loaded only for local

A new `cli-env` helper `loadLocalEnv(envName, packageDir)`: if the resolved env is **local** (`!def.aws`), dotenv-load `<packageDir>/.env` (non-overriding); no-op for AWS envs and unknown env names. Each CLI calls it in its shared `execute()` wrapper with **its own** package dir (`resolve(dirname(import.meta.url), "..")` — `dist/bin.js` and `src/bin.ts` both sit one dir under the package root). The `.env` lives in each CLI package (`packages/admin-cli/.env`, `packages/devops-cli/.env`), git-ignored, with a committed `.env.example`.

- **Scoped to local by construction** — only local reads connection config from `process.env`; app-dev/prod compose from AWS and never consult a `.env`, so a value here can never reach them. (Rejected: reading `apps/api/.env` — the user chose a package-scoped file.)
- **Non-overriding** — an explicit export, or the spawn-injected target-env value, still wins (dotenv default).
- **No contract change** — `resolveEnvConnection` is untouched; this is an additive helper called before it.

## Plan — 1 slice

**Files** — New: `packages/cli-env/src/local-env.ts` + its export in `index.ts`; `packages/{admin,devops}-cli/.env.example`; `cli-env` unit test. Edit: `cli-env/package.json` (+`dotenv`), both `bin.ts` (compute `PACKAGE_DIR`, call `loadLocalEnv` in `execute()`), doc-sync (`CLAUDE.md`, `CLI_OPERATIONS_CHARTER.md`, both `COMMANDS.md`).
**Tests** — `packages/cli-env` unit (`local-env.test.ts`): loads for local; no-op for app-dev/prod; non-override; missing file; unknown env. `cd packages/cli-env && npm run test:unit`. (Rebuild the three packages' `dist` — the CLIs run from `dist/`.)

## Smoke (manual, against your dev stack)

1. `npm run build` for `@portalai/cli-env`, `@portalai/admin-cli`, `@portalai/devops-cli` (the CLIs run from `dist/`).
2. `cp packages/admin-cli/.env.example packages/admin-cli/.env` and set `DATABASE_URL` to your local DB (from `apps/api/.env`). Same for `packages/devops-cli/.env`.
3. In a shell with **no** `DATABASE_URL` exported: `portalai org list --env local --json` → returns the org list (not `ENV_NOT_CONFIGURED`). `portalops db url --env local` likewise resolves.
4. Export a bogus `DATABASE_URL` in the shell and re-run `portalai org list --env local` → it uses the **exported** value (non-override), proving the shell still wins.
5. `--env app-dev`/`prod` behavior is unchanged (still resolves from AWS; the local `.env` is ignored).

## Out of scope

- Reading the API's `apps/api/.env` (deliberately rejected — package-scoped file instead).
- Any change to the AWS-env resolution path or `resolveEnvConnection`.
