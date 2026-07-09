# CLI deployed-environment access & authorization — Spec

Pins the contract for `@portalai/cli-env` — the shared environment-access layer of the Portal CLIs epic: the env registry, both authorization paths (AWS IAM infra/DB + Auth0 device-flow API), the `resolveEnvConnection` seam, and the safety/operability guardrails. Discovery: `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md` (reviewed decision-by-decision). Issue: [#194](https://github.com/EnterpriseBT/portal-ai/issues/194) (epic #191; consumers #190, #192).

## Key decisions (flag for review)

1. **Hybrid registry with `kind` classification** — checked-in non-secret facts; secrets from AWS at runtime; `kind: development|staging|production` is what destructive-op gating keys on (hard-block in `production`); `~/.portalai/environments.json` override forced to `development`.
2. **Both auth paths ship**: AWS IAM (`aws sso login` gates `portalai/${awsEnvName}/*` + tunnel) and Auth0 **device-code** login per env with a `~/.portalai/` file session cache (0600) — confirmed over M2M for audit attribution (agent actions trace to the human who authorized).
3. **Agent & programmatic operability are hard requirements**: library-first (exported functions, no TTY coupling), typed errors, non-interactive guardrails, `local` frictionless (zero AWS/Auth0).
4. **Naming subtlety pinned:** the deployed env is publicly `app-dev` (`api-dev.portalsai.io`) but its **AWS env name is `dev`** (`api-cli.sh:65,72-73`) — the registry carries both (`name: "app-dev"`, `aws.envName: "dev"`).
5. **Tunnel primitive is order-independent with #192** — implemented here by spawning `aws ssm start-session` (lifecycle-managed); #192 consumes the same primitive.

## Scope

### In scope
- New package `packages/cli-env` (`@portalai/cli-env`): registry, AWS secret/SSM resolution, SSM tunnel primitive, Auth0 device-flow session, `resolveEnvConnection`, guardrails (kind-gating, prod barrier, env banner, audit log), typed errors.
- Registry entries for `local` and `app-dev`; `prod` entry shape defined, activated when #83 provisions it.
- Provisioning note: one **CLI-type Auth0 app per env** + a new SSM param `auth0-cli-client-id` per env (manual Auth0 setup + `vars set`, documented).

### Out of scope
- The consuming CLIs' commands (#190 org CRUD/seed, #192 ops commands) and their bins.
- The admin RBAC check on the API (what makes a token *admin*) — lands with #190's admin endpoints.
- Retiring `api-cli.sh` / npm scripts (the retire map executes in #190/#192).
- Prod provisioning itself (#83); CI consuming the registry (accepted-drift follow-up).

## Surface

All paths below are new, under `packages/cli-env/`. Package: `"name": "@portalai/cli-env"`, `"type": "module"`, tsc build to `dist/` (`tsconfig.build.json`), root-only export (no subpaths yet), `files: ["dist"]`, scripts `build`/`lint`/`type-check`/`test:unit` matching `packages/core` conventions (`test:integration": "true"` — no DB). Dependencies: `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-ssm`, `zod`. **No `bin`** — this is a library; the CLIs own binaries. **Never imported by `apps/web` or `packages/core`.**

### `src/registry.ts` — the env registry

```ts
export type EnvKind = "development" | "staging" | "production";

export const EnvironmentDefinitionSchema = z.object({
  name: z.string().min(1),              // "local" | "app-dev" | "prod" | override names
  kind: z.enum(["development", "staging", "production"]),
  apiBaseUrl: z.string().url(),
  /** null ⇒ no AWS (local): db comes from .env, no tunnel/secrets. */
  aws: z.object({
    region: z.string(),                 // "us-east-1"
    /** The AWS-side env name — drives every AWS naming convention.
     *  NOTE: app-dev's awsEnvName is "dev" (api-cli.sh:65,72-73). */
    envName: z.string(),
  }).nullable(),
});
export type EnvironmentDefinition = z.infer<typeof EnvironmentDefinitionSchema>;

/** Built-in, checked-in entries: local (kind development, apiBaseUrl http://localhost:3001, aws null),
 *  app-dev (kind staging, apiBaseUrl https://api-dev.portalsai.io, aws {region us-east-1, envName "dev"}).
 *  prod is added (kind production, envName "prod") when #83 provisions it. */
export const BUILTIN_ENVIRONMENTS: Record<string, EnvironmentDefinition>;

/** Built-ins merged with ~/.portalai/environments.json (validated per entry;
 *  override entries have kind FORCED to "development"; an override may not
 *  shadow a built-in name — throws EnvNotConfiguredError-adjacent validation error). */
export function loadEnvironments(): Record<string, EnvironmentDefinition>;

/** Lookup or throw EnvNotConfiguredError (names the known envs in .message). */
export function getEnvironment(name: string): EnvironmentDefinition;
```

AWS naming helpers (pure, mirror `api-cli.sh:68-74`): `secretsPrefix(def) = "portalai/${envName}"`, `ssmPrefix(def) = "/portalai/${envName}"`, `clusterName(def) = "portalai-${envName}"`, `bastionExportName(def) = "${envName}-BastionInstanceId"`. Each throws `EnvNotConfiguredError` if `def.aws === null`.

### `src/errors.ts` — typed errors (the agent-facing contract)

```ts
export class CliEnvError extends Error { readonly code: CliEnvErrorCode; }
export type CliEnvErrorCode =
  | "ENV_NOT_CONFIGURED"        // unknown env name / no AWS config for an AWS-only op
  | "ENV_NOT_AUTHORIZED"        // no/expired session and refresh failed → run `login` / `aws sso login`
  | "ENV_DESTRUCTIVE_BLOCKED"   // destructive op against kind=production (never allowed)
  | "ENV_CONFIRMATION_REQUIRED" // staging/production op lacking its explicit confirm flag
  | "ENV_INFRA_ERROR";          // AWS/tunnel/Auth0 transport failures (wraps cause)
export class EnvNotConfiguredError / EnvNotAuthorizedError / EnvDestructiveBlockedError /
             EnvConfirmationRequiredError / EnvInfraError extends CliEnvError;
```

Consumers map `code` → exit codes/JSON; no prose-parsing.

### `src/aws.ts` — secret/param resolution (IAM path)

```ts
export function getSecret(def: EnvironmentDefinition, name: string): Promise<string>;   // SecretsManager GetSecretValue `${secretsPrefix}/${name}`
export function getParam(def: EnvironmentDefinition, name: string): Promise<string>;    // SSM GetParameter `${ssmPrefix}/${name}`
export function getDatabaseUrl(def: EnvironmentDefinition): Promise<string>;            // getSecret(def, "database-url")
```

AWS SDK v3 clients with **ambient credentials** (`aws sso login` / `AWS_PROFILE` / CI OIDC — never cached by us); region from `def.aws.region`. Credential/permission failures → `EnvNotAuthorizedError`; transport failures → `EnvInfraError`. Known names follow the existing catalog (`api-cli.sh:77-98`), plus the new `auth0-cli-client-id` SSM param.

### `src/tunnel.ts` — the SSM tunnel primitive (shared with #192)

```ts
export interface Tunnel { localPort: number; close(): Promise<void>; }
export function openDbTunnel(def, opts?: { localPort?: number }): Promise<Tunnel>;
```

Spawns `aws ssm start-session --target <bastion-instance-id> --document-name AWS-StartPortForwardingSessionToRemoteHost` (bastion instance id resolved via the CloudFormation export `bastionExportName(def)`, as `api-cli.sh:70-71,182-214` does), default local port 15432, readiness-waited, lifecycle-managed (`close()` terminates the process group; process-exit hook prevents orphans). Missing plugin/creds → `EnvNotAuthorizedError`/`EnvInfraError`.

### `src/auth0.ts` — device-flow session (API path)

```ts
export function login(envName: string, io?: { onUserCode(verificationUriComplete: string, userCode: string): void }): Promise<void>;
export function logout(envName: string): Promise<void>;   // clears cache entry (best-effort revoke)
export function getToken(envName: string): Promise<string>; // cached access token; transparent refresh; no session → EnvNotAuthorizedError
```

Device Authorization Grant against the env's Auth0 domain/audience (resolved from SSM `auth0-domain`/`auth0-audience` + the new `auth0-cli-client-id` for AWS envs; from `.env` `AUTH0_DOMAIN`/`AUTH0_AUDIENCE`/`AUTH0_CLI_CLIENT_ID` for `local`). `login` is the **only** human-interactive function in the package, and even it is non-TTY (emits the verification URI + code via the `io` callback; the CLI decides how to present it).

**Session cache:** `~/.portalai/credentials.json`, mode **0600** (directory 0700), shape `{ [envName]: { accessToken, refreshToken, expiresAt } }`. Writes are **atomic** (temp file + rename) so concurrent CLI/agent invocations can't corrupt it; refresh uses read-check-write with a last-writer-wins rename (both writers produce a valid session).

### `src/guard.ts` — kind-gated operation guards

```ts
export function assertOperationAllowed(def: EnvironmentDefinition, opts: {
  destructive: boolean;          // seed/mock/reset/teardown-class ops
  confirmed: boolean;            // the caller's --yes
  prodConfirmed: boolean;        // the caller's distinct prod barrier flag
}): void;
```

Matrix: `development` → always allowed. `staging` → requires `confirmed`; else `EnvConfirmationRequiredError`. `production` → `destructive: true` ⇒ **`EnvDestructiveBlockedError` unconditionally**; non-destructive mutations require `prodConfirmed` (and `confirmed`). Plus `envBanner(def): string` — the `[env: app-dev (staging)]` line every command prints.

### `src/audit.ts` — local audit log

```ts
export function recordAudit(entry: { env: string; operator: string; command: string; args?: unknown; }): Promise<void>;
```

Appends JSONL (timestamped) to `~/.portalai/audit.log` (0600). `operator` = Auth0 `sub` when a session exists, else the AWS STS identity ARN, else `"unknown"` — best-effort, never blocks the operation (append failure logs to stderr only).

### `src/connection.ts` — the seam

```ts
export interface DbHandle { connectionString: string; close(): Promise<void>; }
export interface EnvConnection {
  readonly env: string; readonly kind: EnvKind; readonly apiBaseUrl: string;
  db(): Promise<DbHandle>;      // LAZY: local → .env DATABASE_URL (close() no-op); AWS → getDatabaseUrl + openDbTunnel, rewritten to localhost:port
  token(): Promise<string>;     // LAZY: delegates to auth0.getToken(env)
  dispose(): Promise<void>;     // closes any opened tunnel; idempotent
}
export function resolveEnvConnection(name: string): Promise<EnvConnection>;
```

`resolveEnvConnection` itself does **no I/O** beyond registry lookup (so `--json` metadata commands pay nothing); repeated `db()` calls reuse the open handle.

## Migration / Seed

**None.** No app DB schema change. External provisioning (documented in the package README; **walked through together during implementation** — confirmed in review): create the CLI-type Auth0 application per env; `vars set`-style upsert of `auth0-cli-client-id` into each env's SSM.

## TDD test plan

```bash
cd packages/cli-env && npm run test:unit
```

Unit tests only (AWS SDK clients + Auth0 HTTP + `child_process` mocked; `HOME` pointed at a temp dir). **No CI integration tests** — live-AWS behavior is covered by the manual smoke doc (`.smoke.md`, written with the plan).

### Layer 1 — registry (`src/__tests__/registry.test.ts`)
Built-ins resolve (`local` kind development aws null; `app-dev` kind staging **`aws.envName === "dev"`**); prefix helpers mirror api-cli.sh naming; unknown name → `EnvNotConfiguredError`; override file merges, forces `kind: development`, rejects shadowing a built-in; malformed override → validation error naming the file. ≈ 7 cases.

### Layer 2 — aws + tunnel (`aws.test.ts`, `tunnel.test.ts`)
`getSecret`/`getParam` hit the exact `portalai/dev/...` paths for `app-dev`; credential failure → `EnvNotAuthorizedError`; transport → `EnvInfraError`; local (aws null) → `EnvNotConfiguredError`. Tunnel: spawns expected argv, resolves on readiness, `close()` terminates, spawn failure → typed error. ≈ 7 cases.

### Layer 3 — auth0 session (`auth0.test.ts`)
Device flow: `login` polls to completion and writes cache 0600; `getToken` returns cached, refreshes expired (atomic write), no-session → `EnvNotAuthorizedError`; refresh failure → `EnvNotAuthorizedError`; `logout` clears entry. ≈ 6 cases.

### Layer 4 — guard + audit + connection (`guard.test.ts`, `audit.test.ts`, `connection.test.ts`)
Guard matrix (6 combinations incl. prod destructive **always** blocked); banner format. Audit appends JSONL, never throws on append failure. Connection: lazy (no tunnel/token calls until `db()`/`token()`); local `db()` reads `.env` without AWS; AWS `db()` returns localhost-rewritten connection string; `dispose()` idempotent. ≈ 10 cases.

**Totals ≈ 30 cases**, all unit. Migration test: none needed.

## Acceptance criteria
- [ ] `resolveEnvConnection("app-dev").db()` yields a working localhost connection string via a live SSM tunnel (manual smoke), and `dispose()` leaves no orphan process.
- [ ] `login --env app-dev` (via a consuming CLI or a test harness) completes the device flow; `getToken` then returns silently, including after access-token expiry (refresh).
- [ ] `local` requires zero AWS/Auth0 setup: `db()` from `.env`, instant.
- [ ] A destructive op against a `production`-kind env throws `ENV_DESTRUCTIVE_BLOCKED` regardless of flags; staging ops without `--yes` throw `ENV_CONFIRMATION_REQUIRED`.
- [ ] All failures reach the caller as typed `CliEnvError` codes; nothing requires a TTY except `login`'s browser confirmation (surfaced via callback).
- [ ] Session cache file is 0600; concurrent invocations never corrupt it.
- [ ] Neither `apps/web` nor `packages/core` imports `@portalai/cli-env` (dependency direction is one-way).

## Risks & rollback
- **Session-manager-plugin dependency**: the tunnel needs the AWS session-manager-plugin installed; detected at spawn and surfaced as a typed error with install guidance. Validated against live app-dev before `api-cli.sh`'s tunnel is retired (#192's job).
- **On-disk refresh token** (accepted in review): 0600 file, per-env revocation via `logout`; OS-keychain hardening is a follow-up.
- **Fail-closed**: lost AWS creds or failed refresh → typed authorization errors, never silent fallback to another env; no implicit env default anywhere in the package.
- **Rollback**: the package is additive — nothing depends on it until #190/#192 wire in; revert = delete the package.

## Files touched
- New: `packages/cli-env/package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `README.md` (provisioning + usage).
- New: `src/registry.ts`, `src/errors.ts`, `src/aws.ts`, `src/tunnel.ts`, `src/auth0.ts`, `src/guard.ts`, `src/audit.ts`, `src/connection.ts`, `src/index.ts` (barrel).
- New: `src/__tests__/` per the test plan.
- Edit: root workspace picks the package up via the existing `packages/*` glob (no root config change expected; verify turbo pipeline coverage).

## Next step
`docs/CLI_DEPLOYED_ENV_ACCESS.plan.md` — likely **5 slices**: (1) package scaffold + registry + errors + guards (pure logic, no I/O); (2) AWS secret/SSM resolution; (3) tunnel primitive; (4) Auth0 device-flow session + cache; (5) `resolveEnvConnection` + audit + README/provisioning + the `.smoke.md` manual checklist. Each a green-testable commit on `feat/cli-deployed-env-access`.
