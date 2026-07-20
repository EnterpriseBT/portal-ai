# AWS CLI operations guide — Discovery

**Issue:** [EnterpriseBT/portal-ai#224](https://github.com/EnterpriseBT/portal-ai/issues/224)

**Why this exists.** Today AWS log inspection and diagnostic reads for `app-dev` (and, once #83 lands, `prod`) happen largely in the AWS console. The #223 charter already maps every AWS operation to its owning CLI and rates it operable, but it is a *thin index* — it points at this guide for the actual runbook. The `cli-env` layer establishes ambient IAM auth per env (`packages/cli-env/src/aws.ts:1-13`), so the missing piece is a documented, agent-operable runbook plus a `.claude/` allowlist so a human **or** a Claude agent can perform the common AWS auditing / troubleshooting / logging tasks from the CLI. Infra *mutation* is out of scope — that belongs in CI/IaC. This is the guide that turns the charter's AWS rows into a real, credentialed runbook.

## The current shape

### Env model & AWS auth (cli-env)

| Piece | Location | Note |
|---|---|---|
| Env registry | `packages/cli-env/src/registry.ts:44-58` | `local` (`kind development`, `aws: null` — **no AWS surface**), `app-dev` (`kind staging`, `aws.envName "dev"`, region `us-east-1`), `prod` commented out (#83). |
| `kind` enum | `registry.ts:22` | `development \| staging \| production` — drives guards; distinct from the `local/app-dev/prod` env *names*. |
| Naming helpers | `registry.ts:152-164` | `secretsPrefix` `portalai/${envName}`, `ssmPrefix` `/portalai/${envName}`, `clusterName` `portalai-${envName}`, `bastionExportName` `${envName}-BastionInstanceId`. |
| Ambient auth | `aws.ts:1-13`, `aws.ts:38-64` | Never caches creds; the IAM identity is the per-env boundary. `CREDENTIAL_ERROR_NAMES` → `EnvNotAuthorizedError`; else `EnvInfraError` (`errors.ts:9-19`). |

### How portalops already reaches AWS

- `db tunnel`/`db psql` (`packages/devops-cli/src/commands/db.ts:49-110`) open an SSM port-forward to RDS through the bastion resolved from CloudFormation export `${envName}-BastionInstanceId` (`cli-env/tunnel.ts:71-194`, `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost`).
- `db seed` (`ecs.ts:32-96`) runs a FARGATE one-off (`npm run db:seed:ci`) against service `portalai-api-${envName}` / cluster `portalai-${envName}`.
- Guards: `assertOperationAllowed` (`cli-env/guard.ts:31-60`) — dev free, staging needs `--yes`, prod blocks destructive + needs `--yes` + prod barrier.

### Runtime identifiers (verified live, acct `028987315524`, `us-east-1`, `app-dev`→`dev`)

Pinned during the #223 smoke walk + this survey — these are what the charter left as `<placeholder>`:

| Logical | Runtime id | Source |
|---|---|---|
| ECS cluster | `portalai-dev` | `backend.yml:156` / `describe-services` |
| ECS service + task family | `portalai-api-dev` | `backend.yml:511,403` |
| CloudWatch log group | `/ecs/portalai-api-dev` | `backend.yml:205` |
| S3 upload bucket | `portalai-dev-uploads` | task def `UPLOAD_S3_BUCKET` ⚠️ stray `portalai-uploads-dev` also exists — **not** the app's |
| ALB target group | `portalai-dev-api-tg` (`…/3238982494240b12`) | `describe-target-groups` |
| RDS instance | `portalai-dev` (postgres 17) | `database.yml:64` |
| Redis | `portalai-dev.8hcfso.0001.use1.cache.amazonaws.com:6379` | task def `REDIS_URL` |
| CloudFormation stacks | `portalai-dev-{backend,network,database,cache,dns-certs,frontend,bastion}` | `describe-stacks` — **not** `portalai-backend-dev` |

**Naming formula for prod derivation:** `portalai-${envName}` (cluster), `portalai-api-${envName}` (service), `/ecs/portalai-api-${envName}` (logs), `portalai-${envName}-<component>` (stacks). `envName`: `app-dev`→`dev`, `prod`→`prod`.

### Docs & allowlist anchors

- House runbook style: `packages/devops-cli/COMMANDS.md` — invariants header, exit-code table, guard-class matrix (development/staging/production columns), per-command `###` sections with a `--json` shape line.
- Allowlist: `.claude/settings.local.json` → `permissions.allow`, a flat array of `Bash(<prefix>:*)` matchers (e.g. `"Bash(npm run:*)"`). No `deny`/`ask` blocks today.
- The charter's AWS table (`docs/CLI_OPERATIONS_CHARTER.md:50-69`) is the op→command index this guide expands; CloudTrail is named there as the AWS audit path (`:181`).

## The design space

### Decision 1 — Guide location & format

| | A: new `docs/AWS_CLI_OPS.md` | B: extend `devops-cli/COMMANDS.md` | C: inline into the charter |
|---|---|---|---|
| Fit | AWS CLI is a vendor CLI, not native | COMMANDS.md is `portalops`/`portalai` only | charter is a thin index, not a runbook |
| Discoverability | charter's Guide-ref links resolve to it | miscategorizes a vendor CLI | bloats the index |

**Lean: A** — a standalone `docs/AWS_CLI_OPS.md` in the house COMMANDS runbook style (auth preamble → invariants → per-operation sections grouped logging / maintenance-diagnostic). It is a *vendor* CLI, so it must not live in the native COMMANDS.md; the charter already points its AWS Guide-ref at #224.

### Decision 2 — Auth documentation (the agent/non-interactive path)

The deliverable calls out "the non-SSO/OIDC path an agent needs (SSO expiry is a known agent blocker)." The smoke walk established the concrete recipe in this devcontainer.

| | A: generic ambient only (SSO / `AWS_PROFILE` / CI OIDC) | B: generic **+** the `aws login --remote` agent recipe |
|---|---|---|
| Human/CI | covered | covered |
| Agent in devcontainer | blocked — plain `aws login` redirects to an unreachable ephemeral localhost callback → 400 | covered — `aws login --remote` (AWS-hosted code page) + `eval "$(aws configure export-credentials --format env)"` bridges the JS SDK |

**Lean: B.** Document both: ambient creds for humans/CI, and the `--remote` + export-credentials bridge as the explicit agent path (temp creds ~15 min; re-export on `ExpiredToken`). This is the deliverable's whole point.

### Decision 3 — Allowlist scope (which `aws` verbs auto-run)

| | A: read-only verbs only | B: read + convenience mutations | C: everything the charter lists |
|---|---|---|---|
| Auto-run set | `logs tail/filter-log-events`, `ecs describe-*/list-*`, `rds describe-*`, `s3 ls`, `elbv2 describe-*`, `cloudformation describe-*` | + `ecs update-service`/`run-task` | + `execute-command`, `cloudformation deploy` |
| Safety | fail-closed; mutations still prompt | a redeploy runs unprompted | interactive/mutating run unprompted |

**Lean: A.** Only pure-read/diagnostic verbs go in `permissions.allow`; every mutating or interactive op (`update-service`, `run-task`, `execute-command`, `deploy`) stays prompt-gated. Matches "safe read-only/diagnostic" and keeps the allowlist fail-closed.

### Decision 4 — Identifier pinning

**Lean:** pin the verified runtime ids in a table **and** state the naming formula, so `app-dev` is copy-paste-correct today and `prod` derives mechanically when #83 lands. Don't hard-code only literals (breaks for prod) and don't give only the formula (loses the copy-paste value + the `portalai-dev-uploads` trap).

## Tradeoff comparison

|  | D1: standalone doc | D2: +agent recipe | D3: read-only allowlist | D4: ids+formula |
|---|---|---|---|---|
| Spread to spec | Yes (file + section layout) | Yes (auth section) | Yes (exact allow-entries) | Yes (identifier table) |

## Recommendation

1. Ship `docs/AWS_CLI_OPS.md` — a vendor-CLI runbook in COMMANDS house style: auth preamble, invariants, then per-operation sections grouped **logging** and **maintenance / diagnostic**, each with a canonical command + `--output json` note, mirroring the charter's AWS rows.
2. Document two auth paths: ambient (SSO/`AWS_PROFILE`/OIDC) and the agent recipe (`aws login --remote` + `export-credentials`), with the `ExpiredToken` re-login note.
3. Add a read-only `aws` allowlist to `.claude/settings.local.json`; mutations stay prompt-gated.
4. Pin the verified identifier table + naming formula; call out the `portalai-dev-uploads` trap and the `"env":"production"` log-field caveat.
5. Fix the charter's stack-name error (`portalai-backend-dev` → `portalai-dev-backend`) in the same PR — a shipped-doc correctness bug this survey surfaced.

## Open questions

1. **Do `ecs execute-command` / `run-task` belong in the guide at all** given the "no manual infra mutation" scope? They are *diagnostic* (shell into a task) / *operational* (one-off), not IaC. **Lean: document them as prompt-gated (not allowlisted), flagged "operator action, not agent-auto"** — they're audit/troubleshoot, not provisioning, so in-scope but never auto-run.
2. **Charter stack-name fix — same PR or separate?** The charter is already merged into the epic. **Lean: fix it in this PR** (it's the AWS surface, and the guide must be internally consistent with the charter it expands).
3. **Prod command forms now or deferred?** Prod isn't provisioned (#83). **Lean: document prod forms with guard notes but mark them unexercised** — the naming formula makes them free to write and contract-stable for when #83 lands.
4. **CloudTrail runbook depth.** The charter names CloudTrail as the AWS audit path. **Lean: a short "auditing AWS operations" section pointing at CloudTrail `lookup-events`, not a full CloudTrail runbook** — auditability is real but a thin pointer is proportionate here.

## Enterprise-scale considerations

- **Multi-tenancy** — N/A per-org: AWS ops are **env-level**, not per-tenant; the IAM identity is the per-env isolation boundary (`aws.ts:1-13`). Worth one sentence in the guide so nobody expects org scoping.
- **Accuracy & auditability** — **Lean:** reference **CloudTrail** as the durable record of who ran what; build nothing (mirrors the charter's finding (b) decision that the native audit log is write-only and AWS-side audit is CloudTrail's job).
- **Failure modes** — **Lean: fail-closed allowlist.** Only enumerated read verbs auto-run; anything unlisted prompts. A stale-cred read fails safe (`ExpiredToken` → re-login), never mutates.
- **Contract stability** — **Lean:** the per-env structure (`local` N/A, `app-dev`, `prod`-pending) + naming formula must let `prod` slot in with zero re-plumbing when #83 lands; the guide is written against `envName`, not literals.
- **Scale & unbounded growth** — **Lean:** log commands are bounded by default (`--since`/`--start-time`); the guide shows bounded forms first so an agent doesn't stream an unbounded group.
- **Concurrency / data lifecycle** — N/A because this is a read/diagnostic docs surface with no shared mutable state or business-period windows.

## What this doesn't decide

- **The other vendor guides** (#225 Stripe, #226 Auth0) — separate children; corrections for those already live on their tickets.
- **Native-side gaps** (#227) — audit-log query, CLAUDE.md contract section — owned there.
- **Live `prod` execution** — env pending #83; prod forms are documented, not exercised.
- **Wrapping AWS behind `portalops`** — explicitly rejected by the charter's overlap rule; this guide documents direct `aws` use only.

## Next step

Write `docs/AWS_CLI_OPS_GUIDE.spec.md` (contract: the guide's exact section layout, the enumerated allowlist entries, acceptance mapped to #224's criteria) and `.plan.md` (slices). Likely slicing: (1) `docs/AWS_CLI_OPS.md` skeleton + auth preamble + identifier table; (2) logging + maintenance/diagnostic operation sections; (3) `.claude/settings.local.json` allowlist + charter stack-name fix; (4) acceptance reconcile + a smoke that re-runs a representative read per group. All four land on this branch (`feat/aws-cli-ops-guide` → base `epic/cli-first-ops`).
