# AWS CLI operations runbook

The **agent- and human-operable runbook** for AWS **auditing, troubleshooting, and logging** on Portal.ai environments — the runbook the [CLI Operations Charter](./CLI_OPERATIONS_CHARTER.md)'s AWS table points at (#224, epic #222). Every command here is non-interactive and emits machine-readable output.

**Boundary.** The AWS CLI's role here is **read/diagnostic** — logs, service health, resource inspection. **Infrastructure changes (provisioning, config, IaC) are not operated by hand — they run in CI** (see [Operator actions](#operator-actions-not-agent-auto) for the few mutating commands that exist, documented but never agent-auto). `local` has **no AWS surface** (it runs from `.env` / docker-compose); everything below applies to `app-dev` and, once provisioned (#83), `prod`.

## Auth setup

Region is `us-east-1`. Two ways to get credentials:

### Ambient (humans / CI) — recommended
SSO, `AWS_PROFILE`, or CI OIDC. The IAM identity you assume **is** the per-env permission boundary. Confirm with:
```bash
aws sts get-caller-identity --output json
```

> **Safety model — the IAM identity is the gate, not the prompt.** The mutating ops (`ecs update-service`/`run-task`/`execute-command`, `cloudformation deploy`) are gated by **IAM**: run the agent/inspection path with a **read-only IAM identity** (the AWS-managed `ReadOnlyAccess`, or a scoped read policy — `logs:Get*`/`FilterLogEvents`, `ecs:Describe*`/`List*`, `rds:Describe*`, `cloudformation:Describe*`, `s3:List*`/`Get*`, `elasticloadbalancing:Describe*`) and AWS **rejects** any write. That server-side denial — **not** the `.claude` allowlist and **not** a Claude Code permission prompt — is the mutation-safety boundary. The allowlist only reduces prompts for *reads*, and prompting is bypassable per session mode. Write ops require assuming a separate **write** role + deliberate operator intent.

### Agent / devcontainer path
Plain `aws login` here redirects to an ephemeral **localhost** callback the host browser can't reach → a **400 on redirect**. Use the cross-device flow instead:
```bash
aws configure set region us-east-1          # once
aws login --remote                          # run in a REAL interactive terminal
# → open the printed https://…/authorize URL, sign in, paste the code back
```
To feed the AWS **JS SDK** (what `portalops`/`portalai` use), bridge the session into env vars:
```bash
eval "$(aws configure export-credentials --format env)"
```
Temporary credentials last **~15 min** — on `ExpiredToken` / `NoCredentials`, re-run the `export-credentials` line (or `aws login --remote` if the session itself lapsed).

## Invariants

- **Machine-readable:** pass `--output json` (or a `--query`) on every read.
- **Env → `envName`:** `app-dev` → `dev`, `prod` → `prod` (`local` has no AWS surface).
- **Naming formula** (derive any env's identifiers):
  - ECS cluster — `portalai-${envName}`
  - ECS service / task family — `portalai-api-${envName}`
  - CloudWatch log group — `/ecs/portalai-api-${envName}`
  - CloudFormation stacks — `portalai-${envName}-<component>`

## Identifier reference (app-dev, verified)

| Resource | Runtime id |
|---|---|
| ECS cluster | `portalai-dev` |
| ECS service / task family | `portalai-api-dev` (container `api`, port 3001) |
| CloudWatch log group | `/ecs/portalai-api-dev` |
| S3 upload bucket | `portalai-dev-uploads` — ⚠️ **not** `portalai-uploads-dev` (a stray bucket; the app uses `-dev-uploads`) |
| ALB target group | `portalai-dev-api-tg` |
| RDS instance | `portalai-dev` (Postgres 17) |
| ElastiCache (Redis) | `portalai-dev.8hcfso.0001.use1.cache.amazonaws.com:6379` |
| CloudFormation stacks | `portalai-dev-{backend,network,database,cache,dns-certs,frontend,bastion}` |

## Logging operations

### Tail live API logs
```bash
aws logs tail /ecs/portalai-api-dev --since 10m --format short   # add --follow to stream
```

### Search logs over a window
```bash
aws logs filter-log-events \
  --log-group-name /ecs/portalai-api-dev \
  --filter-pattern ERROR \
  --start-time <epoch-ms>
```
The API logs JSON (pino) — filter on fields with a pattern like `'{ $.level = "error" }'`. ⚠️ app-dev tasks log `"env":"production"` (their `NODE_ENV`), so an `env`-field filter will **not** separate app-dev from prod; scope by log group instead.

## Maintenance / diagnostic operations

### Service health / running count
```bash
aws ecs describe-services --cluster portalai-dev --services portalai-api-dev \
  --query "services[].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount}" --output json
```

### List tasks (get a task id)
```bash
aws ecs list-tasks --cluster portalai-dev --service-name portalai-api-dev --output json
```

### Inspect the deployed task definition (image / revision / env)
```bash
aws ecs describe-task-definition --task-definition portalai-api-dev --output json
```

### ALB target health
```bash
TG=$(aws elbv2 describe-target-groups --names portalai-dev-api-tg --query "TargetGroups[0].TargetGroupArn" --output text)
aws elbv2 describe-target-health --target-group-arn "$TG" --output json
```

### RDS instance status
```bash
aws rds describe-db-instances \
  --query "DBInstances[?contains(DBInstanceIdentifier,'portalai')].{id:DBInstanceIdentifier,status:DBInstanceStatus,engine:Engine}" --output json
```

### CloudFormation stack status / outputs
```bash
aws cloudformation describe-stacks --stack-name portalai-dev-backend --output json
```

### Inspect uploaded files
```bash
aws s3 ls s3://portalai-dev-uploads/
```
Secret **values** are not CLI-readable (Secrets Manager policy blocks `get-secret-value`) — use `portalops vars get <KEY> --env app-dev` for config values. Likewise, **injecting** a secret into the running task is not a single CLI command — it needs a `ValueFrom` mapping in `infra/cloudformation/backend.yml` (CI/IaC), per the charter's finding (a). `portalops vars set` owns the value; deploy/IaC owns wiring it into the task def.

## Operator actions (not agent-auto)

These mutate or open an interactive session. Per the [safety model](#auth-setup), the gate is **IAM**: a read-only IAM identity can't run them (AWS denies the write); they require a **write** role + deliberate operator intent, and provisioning proper belongs in CI/IaC. They are **never** in the agent allowlist — but do not treat the absence of a prompt as safety.

```bash
# Shell into a running task (debug)
aws ecs execute-command --cluster portalai-dev --task <task-id> --container api --interactive --command "/bin/sh"
# Force a redeploy / restart
aws ecs update-service --cluster portalai-dev --service portalai-api-dev --force-new-deployment
# Ad-hoc one-off task (e.g. migration)
aws ecs run-task --cluster portalai-dev --task-definition portalai-api-dev --overrides <json>
# Deploy an infra stack (normal path is CI)
aws cloudformation deploy --stack-name portalai-dev-backend --template-file infra/cloudformation/backend.yml
```

## Auditing AWS operations

Who ran what is recorded by **CloudTrail** (the charter's AWS-side audit path):
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateService \
  --start-time <iso8601> --output json
```

## prod (pending #83)

`prod` is not yet provisioned. Its commands derive from the [naming formula](#invariants) with `envName=prod` (e.g. cluster `portalai-prod`, log group `/ecs/portalai-api-prod`, stack `portalai-prod-backend`). Read/diagnostic commands are safe; any mutation runs through CI. **Unexercised until #83 lands.**
