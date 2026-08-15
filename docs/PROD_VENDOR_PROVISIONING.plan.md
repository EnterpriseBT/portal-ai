# Production vendor tenants & config provisioning — Plan

**Implements the spec's contract TDD-first: the `prod` registry entry, the two `cli-env` helpers and the CloudFormation output they read, `portalops db url`, prod coverage on the deploy-parity guard, and the provisioning runbook.**

Spec: `docs/PROD_VENDOR_PROVISIONING.spec.md`. Discovery: `docs/PROD_VENDOR_PROVISIONING.discovery.md`. Issue: #384 (epic #83). Builds on #382, which adds the Mapbox catalog entry and the deploy-parity guard that slice 4 extends.

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/prod-vendor-provisioning`**, which PRs into `epic/prod-environment` — never into `main` (per `CLAUDE.md` → "Epic branches").

Run tests from each package (never invoke jest directly):

```bash
npm run test:unit -w @portalai/cli-env
npm run test:unit -w @portalai/devops-cli
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is first because it is what **unblocks every sibling child of the epic** — no `portalops … --env prod` command resolves until it lands, so it should be reviewable on its own and not held behind the `db url` work. Slice 2 is pure leaf helpers plus an additive CloudFormation output, with no consumer yet. Slice 3 is the consumer, so it depends on 2 and on nothing later. Slice 4 is **gated on #382 reaching this branch** and is deliberately isolated so that gate can't stall the rest. Slice 5 is the runbook, which can only be accurate once the commands it invokes exist.

---

## Slice 1 — the `prod` registry entry

Adds `prod` to `BUILTIN_ENVIRONMENTS` with `kind: "production"`, activating guards that have been written and unit-tested since #194 but never had an environment to apply to. **This is the slice the rest of the epic waits on.**

**Files**

- Edit: `packages/cli-env/src/registry.ts` — the entry, replacing the placeholder comment at `:57`.
- Edit: `packages/cli-env/src/__tests__/registry.test.ts` — resolution + derived names + the shadow rejection.
- Edit: `packages/cli-env/src/__tests__/guard.test.ts` — the three guard outcomes against the real definition.

**Steps**

1. **Tests (spec `cli-env` cases 1–3, 4).** `prod` resolves with `kind: "production"`, `apiBaseUrl: "https://api.portalsai.io"`, `envName: "prod"`; derived `secretsPrefix` → `portalai/prod`, `ssmPrefix` → `/portalai/prod`, `clusterName` → `portalai-prod`, `bastionExportName` → `prod-BastionInstanceId`; an override named `prod` is **rejected** as shadowing a built-in. In `guard.test.ts`: destructive → `EnvDestructiveBlockedError`; mutation with `--yes` only → `EnvConfirmationRequiredError`; both flags → allowed. Run; fail.
2. **Implement** the five-line entry. Green.
3. Lint + type-check.

**Done when:** the guards demonstrably apply to a real `prod` definition, and the override-shadowing test pins the property that makes them unbypassable (discovery Decision 1 — the reason this entry cannot be left to #387).

**Risk:** none to existing behavior — `local` and `app-dev` are untouched, and nothing yet resolves `prod` at runtime. The one consequence is that `portalops … --env prod` stops erroring and starts reaching AWS, which is the point.

---

## Slice 2 — `resolveExport`, `getSecretByArn`, and the master-secret output

Two leaf helpers and one additive CloudFormation output. No consumer yet — slice 3 is the caller.

**Files**

- Edit: `packages/cli-env/src/tunnel.ts` — extract the `ListExportsCommand` lookup out of `resolveBastionInstanceId` (`:42-56`) into an exported `resolveExport`, and re-implement the bastion resolver on it.
- Edit: `packages/cli-env/src/aws.ts` — `getSecretByArn`, mirroring `getSecret`'s client construction and `classify()` handling (`:78-97`) but passing the ARN through as `SecretId` with no path composition.
- Edit: `packages/cli-env/src/index.ts` — re-export both.
- Edit: `infra/cloudformation/database.yml` — the `DbMasterSecretArn` output beside the existing exports (`:85-98`).
- Edit: `packages/cli-env/src/__tests__/{tunnel,aws}.test.ts`.

**Steps**

1. **Tests (spec `cli-env` cases 5–8).** `resolveExport` returns a present export's value and throws `ENV_NOT_CONFIGURED` **naming the export** when absent; `resolveBastionInstanceId` behaves identically after the extraction (regression pin). `getSecretByArn` sends the ARN verbatim as `SecretId` — asserted against the mocked `GetSecretValueCommand` input, which is what catches an accidental prefix composition; a missing secret classifies to `EnvInfraError`. Run; fail.
2. **Implement** the extraction, the new helper, the re-exports, the YAML output. Green.
3. Lint + type-check.

**Done when:** both helpers are exported and covered, `resolveBastionInstanceId` is unchanged in behavior, and `database.yml` declares the export — verified for real by the **app-dev** database-stack deploy, since CloudFormation has no unit-test surface.

**Risk:** the extraction touches a live code path (`db tunnel`/`db psql` resolve the bastion through it). The regression pin is the mitigation, and the refactor is behavior-preserving by construction.

---

## Slice 3 — `portalops db url`

The command that composes the database credential from stack exports and the RDS-managed master secret, so a production DB password never renders to a human.

**Files**

- Edit: `packages/devops-cli/src/commands/db.ts` — `dbUrl`, `DbUrlOptions`, `DbUrlResult` per the spec's Surface.
- Edit: `packages/devops-cli/src/bin.ts` — register `db url` under the existing `db` group (`:176-239`), matching its siblings' flag and `--json` envelope conventions.
- Edit: `packages/devops-cli/src/__tests__/helpers/cli-env-mock.ts` — add `resolveExport` and `getSecretByArn` to the `mocks` object (`:78`) and to `cliEnvMockModule()` (`:120`).
- Edit: `packages/devops-cli/src/__tests__/db.test.ts`.

**Steps**

1. **Tests (spec `devops-cli` cases 1–7).** The default composition is pinned **byte-for-byte** against dev's live value shape — `postgresql://portalai:<pw>@<endpoint>:5432/portal_ai?sslmode=require`; `--db-name postgres` reaches the maintenance database and `--ssl-mode` overrides the query segment; a password containing `@ : / # ?` is URL-encoded; **the default result redacts the password and no returned field carries it**; `--write` calls `putSecret("database-url", …)` and reports `created`; `--write --env prod` without `--confirm-prod` throws `EnvConfirmationRequiredError` and with both flags proceeds; the audit record carries endpoint and `created` but **never** the password or the composed string; `local` (`aws: null`) throws `ENV_NOT_CONFIGURED`. Run; fail.
2. **Implement** `dbUrl` and its bin wiring. Green.
3. Lint + type-check.

**Done when:** every spec case passes, and the redaction and audit assertions hold — those two are the slice's reason for existing, not incidental checks.

**Risk:** the guard must fire **before** the write, not after the compose. Test case 6 pins the ordering; a compose-then-guard implementation would still pass a naive "throws" assertion while having already read the master secret, so assert on `putSecret` never being called.

---

## Slice 4 — prod coverage on the deploy-parity guard

Extends #382's guard so a prod-only catalog gap is caught by the same mechanism.

> **Gated on #382.** `deploy-parity.test.ts` does not exist on this branch until #382 merges to `main` and `main` merges into `epic/prod-environment` (the epic keep-pace rule). If that hasn't happened when slices 1–3 are done, **skip to slice 5 and return here** — nothing else depends on it.

**Files**

- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts`.

**Steps**

1. **Tests (spec `devops-cli` case 8).** The secret-catalog and required-parameter assertions run against the `prod` definition as well as `app-dev`. Run; fail only if a prod-specific gap exists (it should already pass — this is a coverage extension, so a green-on-arrival result is the expected outcome and worth stating so nobody "fixes" a passing test).
2. **Implement** the parameterization if the assertions aren't already env-agnostic. Green.
3. Lint + type-check.

**Done when:** the parity guard names `prod` among the environments it covers.

**Risk:** none — test-only.

---

## Slice 5 — the provisioning runbook

The operator-facing artifact. Most of this ticket's actual work is vendor-console provisioning, and this is where it lives.

**Files**

- New: `docs/PROD_PROVISIONING.runbook.md`.
- Edit: `packages/devops-cli/COMMANDS.md` — the `db url` entry (a new command is a documented capability; stale docs are a bug in this PR).

**Steps**

1. **No unit tests** — this is prose. The verification is `/smoke`, whose checklist maps from the spec's acceptance criteria.
2. **Write** the runbook in the spec's order: vendor accounts → generated secrets → SSM config → contact addresses → **[#383 database stack]** → the four-step database bootstrap → capture the twelve ARNs → **[#383 backend stack]**. Every value written with `portalops vars set KEY - --env prod --yes --confirm-prod` reading stdin, with `vars template`/`apply` named as non-prod tooling **and the reason given**. Include the `openssl rand -base64 32` one-liners, the `describe-secret --query ARN` → `gh secret set` pairing, and the write-once warning on `NAMESPACE`/`SYSTEM_ID` **at the step that writes them**, not in a footnote.
3. Lint + format (markdown is not Prettier-formatted; `format:check` skips `docs/`).

**Done when:** the runbook is re-runnable for any future environment, not a prod-only checklist, and every command in it exists.

**Risk:** the runbook can drift from the CLI. Mitigated by writing it last, after slices 1–3 have fixed the actual flag names.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | `prod` in `BUILTIN_ENVIRONMENTS` | `cli-env` registry + guard suites green; **unblocks #383/#385/#386/#387** |
| 2 | `resolveExport`, `getSecretByArn`, `DbMasterSecretArn` output | `cli-env` suite green; bastion regression pin holds |
| 3 | `portalops db url` | `devops-cli` suite green; redaction + audit + guard-before-write assertions hold |
| 4 | prod on the parity guard | `devops-cli` suite green (**needs #382 merged into the epic branch**) |
| 5 | runbook + `COMMANDS.md` | prose; verified by `/smoke` |

## Cross-slice notes

- **Slice 1 is separately valuable.** If review on `db url` drags, slice 1 can be split into its own PR to the epic branch so the sibling children aren't blocked. Prefer keeping one PR, but this is the seam if it's needed.
- **The `database.yml` output reaches dev first.** It is additive, but it does mean an app-dev database-stack update — which is exactly how the export gets proven before prod consumes it.
- **Nothing here provisions anything.** Slices 1–4 are code; the twenty-four values, the vendor accounts, and the database bootstrap are operator acts performed against the runbook and verified by `/smoke`. The PR merging does not mean prod is provisioned.
- **Doc surfaces in this PR:** `packages/devops-cli/COMMANDS.md` (new `db url`). `CLAUDE.md`'s "`local` · `app-dev` · future `prod`" phrasing and the "pending #83" runbook sections are **#387's**, deliberately — they describe the whole epic's outcome, not this slice's.
- **The `dbName` default is `portal_ai`, verified against live dev.** It is not RDS's default (`DBName` is null on the instance); the application database is created by hand and nothing in the repo does it. Slice 5's bootstrap sequence is the only place that step is written down.

## Next step

Implementation begins on this branch once discovery, spec and plan are confirmed — slice 1 first, tests-first, one commit per slice, PR into `epic/prod-environment`.
