# AWS CLI operations guide — Smoke Suite

Manual smoke for [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) — the AWS CLI operations runbook (`docs/AWS_CLI_OPS.md`), its read-only `.claude` allowlist, and the charter stack-name fix. **Branch under test:** `feat/aws-cli-ops-guide` (PR [#243](https://github.com/EnterpriseBT/portal-ai/pull/243) → `epic/cli-first-ops`).

The deliverable is documentation + config, so this smoke proves the guide is *true*: pick the guide's commands and confirm they actually run against your `app-dev` AWS account with machine-readable output, that the allowlist auto-runs the reads (prompt-reduction), that the **read-only IAM identity** is the real mutation gate (a permission prompt is not), and that the charter fix resolves live. You run these against **your own** AWS account (real creds). Boxes start unchecked; checking them is your confirmation.

## Preflight

### Environment

- [ ] `git checkout feat/aws-cli-ops-guide && git pull --ff-only`
- [ ] `npm install` — **no build, no migration** (the deliverable is a markdown doc + a JSON allowlist).
- [ ] Open `docs/AWS_CLI_OPS.md` in a viewer to follow along.

### Tooling & auth

- [ ] `aws` CLI installed; region `us-east-1` (`aws configure set region us-east-1`).
- [ ] Authenticated to the account behind `app-dev`: `aws login --remote` in a real terminal (the guide's agent path), then `aws sts get-caller-identity --output json` returns your identity (acct `028987315524`).

### Fixtures

- [ ] None needed — every step below is a **read** against existing `app-dev` resources (the one optional mutation in §3 is clearly marked and reversible).

### Reset between runs

- [ ] **No reset needed** — all steps are read-only except the optional, clearly-marked §3 mutation check.

## §1 — Charter stack-name fix *(AC6)*

- [ ] `grep -n 'portalai-backend-dev' docs/CLI_OPERATIONS_CHARTER.md` returns **nothing** (the old wrong name is gone).
- [ ] The corrected name resolves live: `aws cloudformation describe-stacks --stack-name portalai-dev-backend --output json` returns a stack (not a `ValidationError: does not exist`).

## §2 — Guide runbook is operable from the doc alone *(AC1, AC2)*

Follow **only** what `docs/AWS_CLI_OPS.md` says — the point is that a reader needs nothing else.

- [ ] **Logging:** `aws logs tail /ecs/portalai-api-dev --since 10m --format short` returns recent API log lines (add `--follow` to stream). *(AC1 — read logs without the console.)*
- [ ] **Maintenance:** `aws ecs describe-services --cluster portalai-dev --services portalai-api-dev --query "services[].{status:status,running:runningCount}" --output json` returns JSON with `status: ACTIVE` and a `runningCount`. *(AC2 — non-interactive, JSON.)*
- [ ] **Identifier table is accurate:** spot-check two more from the guide's table — e.g. `aws s3 ls s3://portalai-dev-uploads/` lists objects, and `aws elbv2 describe-target-groups --names portalai-dev-api-tg --output json` returns the target group. Confirm `portalai-dev-uploads` (not `portalai-uploads-dev`) is the one with app uploads.
- [ ] **Auth section works as written:** you reached this point using only the guide's auth path (ambient or `aws login --remote` + `export-credentials`).

## §3 — Allowlist auto-runs reads; the read-only IAM identity gates mutations *(AC3)*

The allowlist loads at **session start**, so check the read behavior in a **fresh Claude Code session** on this branch. **The allowlist is prompt-reduction for reads — it is NOT the mutation gate.** The mutation gate is the **IAM identity** (a read-only identity → AWS denies writes); a permission prompt is *not* a reliable gate (it's bypassable per session mode).

- [ ] **Reads auto-run:** in a fresh session, an allowlisted read (`aws logs tail /ecs/portalai-api-dev --since 5m`) executes with **no permission prompt**.
- [ ] **The credential is the real gate:** assumed a **read-only IAM identity**, `aws ecs update-service --cluster portalai-dev --service portalai-api-dev --force-new-deployment` returns **`AccessDenied`** — the redeploy cannot happen regardless of any prompt. (On an admin identity it *would* run — which is the point: the identity, not the prompt, is the boundary. Don't run this on an admin identity unless you intend the redeploy.)
- [ ] `jq -r '.permissions.allow[] | select(startswith("Bash(aws"))' .claude/settings.local.json | wc -l` returns `12`, and no mutating verb (`update-service`, `run-task`, `execute-command`, `cloudformation deploy`, `export-credentials`) is allowlisted (defense-in-depth: keeps agents from *auto-running* writes, but the IAM identity is the actual gate).

## §4 — Scope & coverage *(AC4, AC5)*

- [ ] Every AWS operation in the charter's AWS table (`docs/CLI_OPERATIONS_CHARTER.md`) is present in `docs/AWS_CLI_OPS.md` — either as a runnable command or explicitly deferred (the "inject a secret" row → the `ValueFrom`/CI note). *(AC5)*
- [ ] Mutating operations (`execute-command`, `run-task`, `update-service`, `cloudformation deploy`) appear **only** under "Operator actions (not agent-auto)" with the IAM safety-model note, and the doc's boundary states infra mutation is CI/IaC. *(AC4)*

## §5 — Gotchas call out real traps

- [ ] The `"env":"production"` caveat is true on your stack: a log line from `aws logs tail /ecs/portalai-api-dev` shows `"env":"production"` even though this is app-dev (confirming the guide's warning that an `env`-field filter won't separate app-dev from prod).
- [ ] Secret **values** are genuinely not CLI-readable: `aws secretsmanager get-secret-value --secret-id portalai/dev/database-url` is denied/blocked (matching the guide's note to use `portalops vars get` instead).

## Sign-off

- [ ] §1 charter fix verified (old name gone, new name resolves live)
- [ ] §2 guide is operable from the doc alone (logging + maintenance reads return JSON)
- [ ] §3 allowlist auto-runs reads (fresh session); a read-only IAM identity denies a mutation (AccessDenied)
- [ ] §4 scope/coverage holds (all charter ops present; mutations flagged operator-only)
- [ ] §5 gotchas are real
- [ ] Any command/identifier corrections noted for the guide
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:     (e.g. §2 guide operable)
Expected:    (per docs/AWS_CLI_OPS.md — this exact command, this output shape)
Got:         (what actually happened)
Repro:       (exact command + env)
Identifiers: (account / cluster / stack / bucket ids)
Fix:         (correct the guide's command/identifier, the allowlist entry, or the charter row)
```
