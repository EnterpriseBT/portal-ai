# AWS CLI operations guide — Spec

**Issue:** [EnterpriseBT/portal-ai#224](https://github.com/EnterpriseBT/portal-ai/issues/224) · **Epic:** #222 · **Discovery:** `docs/AWS_CLI_OPS_GUIDE.discovery.md`

Pins the contract for #224: a new vendor-CLI runbook (`docs/AWS_CLI_OPS.md`) that makes AWS auditing / troubleshooting / logging on `app-dev` (and future `prod`) agent-operable, a read-only `aws` allowlist in `.claude/settings.local.json`, and a correctness fix to the charter's CloudFormation stack name. No code, no schema — the "surface" is documents + config.

## Key decisions (flag for review)

The discovery's four open questions are resolved here **per their leans** (you said proceed; these are the vetoable calls):

1. **`ecs execute-command` / `run-task` / `update-service` / `cloudformation deploy` are documented but NOT allowlisted** — they're operator/diagnostic actions, kept prompt-gated (never agent-auto). Only pure-read verbs are allowlisted (D3).
2. **The charter stack-name bug is fixed in this PR** (`portalai-backend-dev` → `portalai-dev-backend`, charter lines 63–64).
3. **`prod` command forms are documented via the naming formula, marked unexercised** (env pending #83).
4. **CloudTrail gets a short "auditing AWS operations" pointer section**, not a full runbook.
5. **`aws configure export-credentials` is documented in the auth section but NOT allowlisted** — it prints credential material, so it stays prompt-gated even though it's read-only. (New call, flagged: it's the one read verb we deliberately exclude.)

## Scope

### In scope
1. `docs/AWS_CLI_OPS.md` — the runbook (auth, invariants, identifier table, logging + maintenance/diagnostic operation sections, CloudTrail pointer, gotchas, prod notes).
2. `.claude/settings.local.json` — append read-only `aws` allow-entries.
3. `docs/CLI_OPERATIONS_CHARTER.md` — fix the two `cloudformation` rows' stack name.

### Out of scope
- Stripe (#225) / Auth0 (#226) guides; native gaps (#227).
- Any infra-mutating runbook content beyond documenting that mutation is CI/IaC.
- Live `prod` execution (#83).
- Wrapping `aws` behind `portalops` (charter overlap rule).

## Surface

### A. `docs/AWS_CLI_OPS.md` (new) — section layout

House COMMANDS style (preamble → invariants → per-operation `###`). Ordered sections:

1. **Purpose & boundary** — vendor CLI for audit/troubleshoot/log, human **or** agent; infra mutation is CI/IaC (out of scope). `local` has no AWS surface (`registry.ts:44-58`).
2. **Auth setup** — two paths:
   - *Ambient* (humans / CI): SSO / `AWS_PROFILE` / OIDC; region `us-east-1`.
   - *Agent (devcontainer)*: `aws configure set region us-east-1` → `aws login --remote` (interactive terminal; cross-device code, no localhost callback) → `eval "$(aws configure export-credentials --format env)"` to bridge the JS SDK. Temp creds ~15 min; on `ExpiredToken`/`NoCredentials` re-run the login/export. Note plain `aws login` fails here (ephemeral localhost callback → 400).
3. **Invariants** — `--output json` (or `--query`) on every read; naming formula `portalai-${envName}` (cluster) / `portalai-api-${envName}` (service) / `/ecs/portalai-api-${envName}` (logs) / `portalai-${envName}-<component>` (stacks); `envName`: `app-dev`→`dev`, `prod`→`prod`.
4. **Identifier reference (app-dev, verified)** — table:

   | Resource | Runtime id |
   |---|---|
   | ECS cluster | `portalai-dev` |
   | ECS service / task family | `portalai-api-dev` |
   | CloudWatch log group | `/ecs/portalai-api-dev` |
   | S3 upload bucket | `portalai-dev-uploads` (⚠️ **not** `portalai-uploads-dev`) |
   | ALB target group | `portalai-dev-api-tg` |
   | RDS instance | `portalai-dev` |
   | CloudFormation stacks | `portalai-dev-{backend,network,database,cache,dns-certs,frontend,bastion}` |

5. **Logging operations** (`###` each, canonical command + note): tail live API logs (`aws logs tail /ecs/portalai-api-dev --since 10m --follow`); search a window (`aws logs filter-log-events --log-group-name … --filter-pattern ERROR --start-time <epoch-ms>`).
6. **Maintenance / diagnostic operations** (`###` each): service health (`ecs describe-services … --query …runningCount`); list tasks / get id (`ecs list-tasks`); inspect task def (`ecs describe-task-definition`); ALB target health (`elbv2 describe-target-health --target-group-arn <arn>`, plus `describe-target-groups` to resolve the arn); RDS status (`rds describe-db-instances --query …`); CFN stack status/outputs (`cloudformation describe-stacks --stack-name portalai-dev-backend`); inspect uploads (`s3 ls s3://portalai-dev-uploads/`).
7. **Operator actions (prompt-gated, not agent-auto)** — `ecs execute-command` (shell into a task), `ecs run-task` (one-off), `ecs update-service --force-new-deployment`, `cloudformation deploy`. Documented for completeness; explicitly flagged not-allowlisted.
8. **Auditing AWS operations** — short CloudTrail pointer: `aws cloudtrail lookup-events --lookup-attributes …` for who-ran-what (the charter's AWS audit path).
9. **Gotchas** — app-dev tasks log `"env":"production"` (their `NODE_ENV`), so `env`-field log filters don't separate app-dev from prod; secret *values* are not CLI-readable (Secrets Manager policy — use `portalops vars`); the `portalai-dev-uploads` vs `portalai-uploads-dev` trap.
10. **prod** — forms derive from the naming formula; guard note (read-only is safe; mutations are CI); marked **unexercised until #83**.

### B. `.claude/settings.local.json` — appended `permissions.allow` entries

Append these read-only matchers (house `Bash(<prefix>:*)` shape) to the existing 46-entry array:

```json
"Bash(aws logs tail:*)",
"Bash(aws logs filter-log-events:*)",
"Bash(aws ecs describe-services:*)",
"Bash(aws ecs describe-task-definition:*)",
"Bash(aws ecs list-tasks:*)",
"Bash(aws ecs describe-tasks:*)",
"Bash(aws rds describe-db-instances:*)",
"Bash(aws cloudformation describe-stacks:*)",
"Bash(aws s3 ls:*)",
"Bash(aws elbv2 describe-target-health:*)",
"Bash(aws elbv2 describe-target-groups:*)",
"Bash(aws sts get-caller-identity:*)"
```

**Excluded (stay prompt-gated):** `ecs update-service`, `ecs run-task`, `ecs execute-command`, `cloudformation deploy`, `configure export-credentials` (creds exposure).

### C. `docs/CLI_OPERATIONS_CHARTER.md` — stack-name fix

Lines 63–64: replace `portalai-backend-dev` → `portalai-dev-backend` in both the `describe-stacks` and `deploy` commands. (Line 154's prose references `infra/cloudformation/backend.yml`, the *template file* — correct, leave it.)

## Migration / Seed

**None** — no DB schema change. No migration, no seed.

## TDD test plan

This is a docs + JSON-config ticket; there is **no code to unit-test** and no pinning test covers `docs/*.md` or `settings.local.json`. Verification is therefore:

1. **Config validity** — `jq empty .claude/settings.local.json` parses clean (a malformed permissions file breaks Claude Code). Run after the edit.
2. **Manual smoke** (`/smoke 224`, the merge gate) — re-run one representative read per group against **app-dev** and confirm JSON output + no permission prompt: a logging read (`logs tail`), a maintenance read (`ecs describe-services`), and confirm the fixed CFN stack name resolves (`cloudformation describe-stacks --stack-name portalai-dev-backend`).
3. **Doc-consistency check (manual)** — every identifier in the guide's table matches the charter and the `infra/cloudformation/*.yml` logical names.

**Totals ≈ 0 automated cases** (1 JSON-validity command + the manual smoke). No jest/integration tests are warranted or added.

## Acceptance criteria

- [ ] From `docs/AWS_CLI_OPS.md` alone, a human or agent can authenticate to `app-dev` (both paths documented) and read CloudWatch/ECS logs without the console.
- [ ] Every read command in the guide is non-interactive and emits JSON (`--output json` / `--query`).
- [ ] The 12 read-only `aws` allow-entries exist; running them raises **no** permission prompt, and mutations (`update-service`/`run-task`/`execute-command`/`deploy`) still prompt.
- [ ] The guide is scoped to audit/troubleshoot/log; every mutating op is labeled operator-action/CI, not agent-auto.
- [ ] Every AWS operation the charter (#223) assigned to #224 is documented or explicitly deferred.
- [ ] The charter's `cloudformation` rows name `portalai-dev-backend`; `describe-stacks --stack-name portalai-dev-backend` resolves live.

## Risks & rollback

- **Identifier drift** (guide's literal ids vs infra over time) — *detected* by the smoke's live re-run; *mitigated* by pairing every literal with the naming formula and citing `infra/cloudformation/*.yml`. Low: no prod data, docs-only.
- **Allowlist too permissive** — mitigated by **read-only verbs only + fail-closed** (anything unlisted prompts); no mutating verb is allowlisted. A stale-cred read fails safe (`ExpiredToken`), never mutates.
- **Rollback:** docs + config only — revert the commit; no runtime/DB impact.

## Files touched

- **NEW** `docs/AWS_CLI_OPS.md`
- **EDIT** `.claude/settings.local.json` (+12 read-only `aws` allow-entries)
- **EDIT** `docs/CLI_OPERATIONS_CHARTER.md` (lines 63–64 stack-name fix)
- (already committed on this branch) `docs/AWS_CLI_OPS_GUIDE.discovery.md`

## Next step

`docs/AWS_CLI_OPS_GUIDE.plan.md` (`/plan 224`) sequences this into ~3 TDD-light slices on this same branch: (1) charter stack-name fix (smallest, independently correct); (2) `docs/AWS_CLI_OPS.md` — auth + invariants + identifier table + operation sections; (3) `.claude/settings.local.json` allowlist + `jq` validity check + acceptance reconcile. The smoke (`/smoke 224`) follows implementation as the merge gate.
