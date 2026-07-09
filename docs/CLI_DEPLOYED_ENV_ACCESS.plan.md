# CLI deployed-environment access & authorization — Plan

**TDD-sequenced implementation of `@portalai/cli-env`: the env registry + guards (pure), AWS secret/SSM resolution, the shared SSM tunnel primitive, the Auth0 device-flow session, and the `resolveEnvConnection` seam + audit + docs.**

Spec: `docs/CLI_DEPLOYED_ENV_ACCESS.spec.md`. Discovery: `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md`. Issue: #194 (epic #191; consumers #190, #192). Additive — no existing package depends on it until #190/#192 wire in.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/cli-deployed-env-access` / PR #195** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from the package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/cli-env && npm run test:unit     # test:integration is a no-op ("true") — live paths are smoke-verified
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** — the pure core (registry/errors/guards): no I/O, every later slice imports it, and it carries the package scaffold so the toolchain is proven before any SDK code.
- **Slice 2** — AWS resolution: first I/O layer; needs only the registry's prefix helpers. Unblocks 3 and 4 (both read AWS values).
- **Slice 3** — the tunnel primitive: needs slice 2's client plumbing (CloudFormation export lookup) and the registry naming. **This is the slice #192 will consume** — it lands before the composition so it can be validated in isolation.
- **Slice 4** — Auth0 device-flow session: needs slice 2 (`auth0-domain`/`auth0-audience`/`auth0-cli-client-id` params); independent of 3.
- **Slice 5** — `resolveEnvConnection` composes 1–4; audit, README/provisioning, `.smoke.md`, and doc-sync close the PR.

---

## Slice 1 — Package scaffold + registry + errors + guards (pure logic)

The package skeleton and everything that needs no I/O.

**Files**

- New: `packages/cli-env/package.json` (`@portalai/cli-env`, `"type": "module"`, tsc build, `test:integration: "true"`, scripts per `packages/core` conventions), `tsconfig.json`, `tsconfig.build.json`, `jest.config.js` (mirror `packages/core`'s ESM jest setup).
- New: `src/errors.ts` — `CliEnvError` + the 5 typed subclasses/codes (spec Surface).
- New: `src/registry.ts` — `EnvironmentDefinitionSchema`, `BUILTIN_ENVIRONMENTS` (`local`, `app-dev` with `aws.envName: "dev"`), `loadEnvironments()` (override merge, kind forced, no shadowing), `getEnvironment()`, the four AWS naming helpers.
- New: `src/guard.ts` — `assertOperationAllowed` matrix + `envBanner`.
- New: `src/index.ts` — barrel.
- New: `src/__tests__/registry.test.ts`, `src/__tests__/guard.test.ts`.

**Steps**

1. **Tests (spec Layer 1 ≈7 + guard portion of Layer 4 ≈7).** Built-ins resolve (`local` dev/aws-null; `app-dev` staging/`envName==="dev"`); prefix helpers mirror `api-cli.sh` naming; unknown env → `EnvNotConfiguredError`; override merge/kind-forcing/shadow-rejection/malformed-file (temp `HOME`); guard matrix (6 combos, prod destructive always blocked) + banner format. Run; fail.
2. **Implement** the scaffold + the three pure modules. Green.
3. Lint + type-check; confirm `turbo run build,test:unit` picks the package up via the `packages/*` glob.

**Done when:** ≈14 cases pass; the package builds standalone; nothing else imports it yet.

**Risk:** jest ESM config friction (copy `packages/core`'s working config verbatim).

---

## Slice 2 — AWS secret/SSM resolution

The IAM-path I/O layer.

**Files**

- New: `src/aws.ts` — `getSecret`/`getParam`/`getDatabaseUrl` on AWS SDK v3 clients (ambient credentials, region from the definition); credential failures → `EnvNotAuthorizedError`, transport → `EnvInfraError`, `aws: null` → `EnvNotConfiguredError`.
- Edit: `package.json` — add `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-ssm`.
- New: `src/__tests__/aws.test.ts` (SDK clients mocked).

**Steps**

1. **Tests (spec Layer 2, aws half ≈4).** `app-dev` reads hit exactly `portalai/dev/<name>` / `/portalai/dev/<name>`; credential-shaped failure → `EnvNotAuthorizedError`; transport failure → `EnvInfraError`; `local` → `EnvNotConfiguredError`. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the 4 cases pass; slice-1 suite still green.

**Risk:** none — thin typed wrappers.

---

## Slice 3 — The SSM tunnel primitive (the #192-shared piece)

`openDbTunnel` with managed lifecycle.

**Files**

- New: `src/tunnel.ts` — bastion instance id via the CloudFormation export (`bastionExportName`), spawn `aws ssm start-session … AWS-StartPortForwardingSessionToRemoteHost`, readiness wait, `Tunnel.close()` terminating the process group, process-exit hook.
- Edit: `package.json` — add `@aws-sdk/client-cloudformation` (the export lookup; an implementation detail the spec's dependency list folds under "AWS SDK v3").
- New: `src/__tests__/tunnel.test.ts` (`child_process` + CloudFormation client mocked).

**Steps**

1. **Tests (spec Layer 2, tunnel half ≈3).** Spawns the expected argv (target from the mocked export, port document, localPort); resolves on readiness output; `close()` terminates; spawn/ENOENT (missing session-manager-plugin) → typed error with install guidance. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the tunnel cases pass; no orphan-process path exists (exit hook covered by a test).

**Risk:** readiness detection (parse the plugin's "Waiting for connections" output) — pin the marker in one place; the live behavior is a `.smoke.md` item.

---

## Slice 4 — Auth0 device-flow session + cache

`login` / `logout` / `getToken` with the atomic 0600 cache.

**Files**

- New: `src/auth0.ts` — device authorization grant (config from slice 2's params for AWS envs; `.env` `AUTH0_DOMAIN`/`AUTH0_AUDIENCE`/`AUTH0_CLI_CLIENT_ID` for `local`), poll loop, `~/.portalai/credentials.json` cache (0600/0700, temp-file+rename atomic writes), transparent refresh, `io.onUserCode` callback (no TTY).
- New: `src/__tests__/auth0.test.ts` (fetch mocked; temp `HOME`).

**Steps**

1. **Tests (spec Layer 3 ≈6).** `login` polls to completion and writes the 0600 cache; `getToken` returns cached; expired → refresh + atomic rewrite; no session → `EnvNotAuthorizedError`; refresh failure → `EnvNotAuthorizedError`; `logout` clears the entry. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the 6 cases pass; file modes asserted in tests.

**Risk:** device-flow polling edge cases (`authorization_pending`/`slow_down`) — cover both in the poll-loop test.

---

## Slice 5 — `resolveEnvConnection` + audit + docs + smoke

Compose the seam; close out operability + doc-sync.

**Files**

- New: `src/connection.ts` — `resolveEnvConnection` (no I/O at resolve; lazy `db()` — `.env` for local, secret+tunnel for AWS, handle reuse; lazy `token()`; idempotent `dispose()`).
- New: `src/audit.ts` — JSONL append to `~/.portalai/audit.log` (0600); operator = Auth0 `sub` → STS ARN → `"unknown"`; never throws.
- Edit: `src/index.ts` — full public barrel.
- New: `packages/cli-env/README.md` — usage + the **external provisioning walkthrough** (CLI Auth0 app per env, `auth0-cli-client-id` SSM param, local `.env` keys — to be executed together during rollout).
- New: `docs/CLI_DEPLOYED_ENV_ACCESS.smoke.md` — manual checklist: live app-dev tunnel open/query/dispose (no orphans), device-flow login + silent re-auth + refresh, local zero-setup path, guard behavior against app-dev (staging confirm) — per spec Acceptance criteria.
- Edit: `CLAUDE.md` → Monorepo Structure table (+ mirror `.github/copilot-instructions.md`) — add `@portalai/cli-env`.

**Steps**

1. **Tests (spec Layer 4 remainder ≈10 minus guard's 7 done in slice 1 — connection ≈4 + audit ≈2, plus banner already covered).** Laziness (no tunnel/token calls until `db()`/`token()`); local `db()` from `.env` with no AWS client constructed; AWS `db()` returns localhost-rewritten connection string and reuses the handle; `dispose()` idempotent; audit appends valid JSONL and swallows append failures. Run; fail.
2. **Implement + write the docs.** Green.
3. Lint + type-check; full `npm run test:unit` for the package.

**Done when:** all ≈30 spec cases pass across the five suites; README + smoke doc exist; CLAUDE.md table updated.

**Risk:** none functional — the composition is thin over slices 1–4.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | scaffold + registry/errors/guards (pure) | ≈14 unit cases; package builds under turbo |
| 2 | AWS secret/SSM resolution | ≈4 cases; exact `portalai/dev/*` paths |
| 3 | SSM tunnel primitive (shared with #192) | ≈3 cases; no orphan path |
| 4 | Auth0 device-flow session + 0600 cache | ≈6 cases; refresh + atomicity |
| 5 | `resolveEnvConnection` + audit + README/smoke/doc-sync | ≈6 cases; full suite ≈30 green |

## Cross-slice notes

- **`@aws-sdk/client-cloudformation`** joins the dependency list in slice 3 (the bastion-export lookup) — an implementation detail under the spec's "AWS SDK v3" umbrella, noted here so it isn't mistaken for scope creep.
- **Temp-`HOME` test helper** (cache + override-file tests) is written once in slice 1 and reused by slices 4–5.
- **Nothing outside the package changes until slice 5's doc-sync** (CLAUDE.md/copilot mirror) — the package is invisible to `apps/*` throughout.
- **The live-path validation is the smoke doc, not CI** — `test:integration` stays `"true"`; the `.smoke.md` walkthrough (with the provisioning steps) is executed together against app-dev before #192 retires the bash tunnel.
- **#192 unblocks after slice 3** (the tunnel primitive) and #190's deployed DB-fallback after slice 5 (`resolveEnvConnection`).

## Next step

Implementation begins on `feat/cli-deployed-env-access` — slice 1 first, tests-red-then-green, one commit per slice — once discovery + spec + this plan are confirmed.
