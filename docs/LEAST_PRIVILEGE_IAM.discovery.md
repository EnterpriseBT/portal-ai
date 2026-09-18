# Least-privilege IAM — Discovery

**Issue:** [EnterpriseBT/portal-ai#397](https://github.com/EnterpriseBT/portal-ai/issues/397)

**Why this exists.** Three identities can do anything in the AWS account that hosts production: the two GitHub-OIDC deploy roles (`github-cicd-deploy-dev`, `github-cicd-deploy-prod`) both carry **`AdministratorAccess`**, and the operator/agent identity is a **long-lived IAM user** (`Admin`, admin via the `EBT_Administrator` group). Prod shares dev's AWS account (a recorded #83 decision), so the deploy role and the operator identity are the *only* boundaries between the two environments — and today neither is one. This ticket scopes the deploy roles to what they actually call (from CloudTrail evidence) and replaces the standing admin user with a per-env role an operator *assumes* for a session — making the charter's "mutation safety is the credential, not a prompt" true for AWS at last. This is the ticket that pays back the #83 convenience shortcuts.

## The current shape

### Live IAM (this account, enumerated 2026-09-18)

| Identity | Kind | Grant | Trust / notes |
|---|---|---|---|
| `github-cicd-deploy-dev` | role | **`AdministratorAccess`** | GitHub OIDC (`token.actions.githubusercontent.com`, aud `sts.amazonaws.com`, `sub` StringLike) |
| `github-cicd-deploy-prod` | role | **`AdministratorAccess`** | GitHub OIDC, scoped to `environment:prod` (`PROD_AWS_ROLE_ARN`) |
| `github-actions-deploy` | role | *(no managed policy)* | legacy/empty — cleanup candidate (confirm unused) |
| `Admin` | **IAM user** | `EBT_Administrator` group (full admin) + `IAMUserChangePassword` | long-lived credentials; the operator/agent identity |
| `portalai-{dev,prod}-task-role` / `-task-execution-role` | role | scoped (already least-priv) | CFN-managed workload roles (`backend.yml`) |
| `portalai-{dev,prod}-bastion-BastionRole` | role | `AmazonSSMManagedInstanceCore` | CFN-managed (`bastion.yml`) |

**AWS IAM Identity Center / SSO is not set up** (`sso-admin list-instances` → empty). This is the single most important discovery finding — it settles the operator-identity design (below).

### Repo grounding

| Piece | Location | Note |
|---|---|---|
| cli-env AWS auth | `packages/cli-env/src/aws.ts:1-13` | **Ambient credentials** — no assume-role/STS anywhere; clients built bare (`new SecretsManagerClient({ region })`). "The operator's IAM identity **is** the per-environment permission boundary." |
| Auth failure taxonomy | `aws.ts:38-64` | AccessDenied/ExpiredToken → `EnvNotAuthorizedError`; else `EnvInfraError`. |
| Env connection / tunnel | `connection.ts:52-111`, `tunnel.ts:96-219` | `aws ssm start-session` port-forward to the bastion (id from a CFN export) — rides the caller's ambient identity. |
| Deploy workflows | `.github/workflows/deploy-dev.yml`, `deploy-prod.yml` | OIDC (`id-token: write`) + `configure-aws-credentials` `role-to-assume` (`AWS_ROLE_ARN` / `PROD_AWS_ROLE_ARN`). |
| Deploy op surface | deploy-dev.yml:148,299-353,384-591; deploy-prod.yml:505-591 | `cloudformation deploy` (~9 stacks, `CAPABILITY_NAMED_IAM` → needs `iam:*` on the CFN-managed roles), ECR push, `ecs register/run-task/describe/wait`, `rds create-db-snapshot` (prod), `s3 sync` + `cloudfront create-invalidation`, `ssm get/put-parameter`, `lambda update-function-code`, cosign OIDC signing. |
| CFN-managed IAM | `backend.yml:305-414`, `bastion.yml:18-38`, `demo-toolpack.yml:43-54` | **Only workload roles.** No deploy role, no IAM user, no OIDC provider in CFN — those are console-created out-of-band (#83). |
| Operator AWS surface | `packages/devops-cli/src/{commands/db.ts,commands/vars.ts,ecs.ts}`, `cli-env/src/aws.ts:78-206` | SSM start-session (+`cloudformation:ListExports`), `secretsmanager:GetSecretValue`/`PutSecretValue`/`CreateSecret` (incl. `rds!…` master by ARN), `ssm:Get/PutParameter` on `portalai/${env}/*`, `ecs:Describe*`/`RunTask`/`DescribeTasks`. |
| The documented target | `docs/AWS_CLI_OPS.md:9-30,112-125` | **Already describes the model #397 delivers:** "the IAM identity you assume **is** the per-env boundary; write ops require assuming a separate **write** role; temp creds ~15 min via `aws configure export-credentials`." |
| Charter convention | `docs/CLI_OPERATIONS_CHARTER.md:48` | "Vendor mutation safety is the credential, not a prompt" — a read-scoped credential, not the `.claude` allowlist. #397 makes this real for AWS. |
| CLI guard (ergonomic layer) | `packages/cli-env/src/guard.ts:31-60` | dev unrestricted · staging `--yes` · prod block-destructive + `--yes --confirm-prod`. Stays; IAM becomes the *real* boundary beneath it. |
| Where identities were made | `PROD_DEPLOY.runbook.md:29-33`, `PROD_PROVISIONING.runbook.md:344`, `DEPLOYED_ENV_CONFIG.md:83` | Deploy roles created by hand under #83; the scoped policies + operator role get documented here. |

## The design space

### Decision 1 — Scoped deploy-role policy, authored from CloudTrail

Replace `AdministratorAccess` on both deploy roles with a policy derived from **evidence**: CloudTrail holds every API `github-cicd-deploy-dev` has called across a year of deploys, so authorship is a filtering exercise, not a guess. Expected surface (from §deploy op surface): CloudFormation (deploy/describe/changeset), the `iam:*` subset `CAPABILITY_NAMED_IAM` stacks need, ECS, ECR, RDS (snapshot), S3, CloudFront, Route 53, Secrets Manager / SSM reads, Lambda. **Decided** (it's the ticket's core): one scoped customer-managed policy per deploy role, mined from CloudTrail at implementation time (I have live AWS + CloudTrail access from this container).

### Decision 2 — Operator identity: assume-only IAM user (no SSO)

**Options:** (A) AWS IAM Identity Center / SSO permission sets that assume per-env roles; (B) a low-privilege IAM user whose *only* permission is `sts:AssumeRole` onto per-env operator roles; (C) keep the admin user.

| | A (SSO) | B (assume-only user) | C (status quo) |
|---|---|---|---|
| Available today | **No** (Identity Center not set up) | Yes | Yes |
| Long-lived creds on a laptop | No | Only `sts:AssumeRole` (impotent alone) | **Full admin** |
| Setup cost | High (enable Identity Center) | Low | — |

**Decided: B.** SSO isn't available and enabling Identity Center is its own project (out of scope). The operator identity becomes a low-priv IAM user (re-scope `Admin`, or a fresh `portalai-operator`) that can *only* `sts:AssumeRole` the per-env operator roles; all real permission lives in the assumed role, resolved as ~15-min temp creds via `aws configure export-credentials` (the flow `AWS_CLI_OPS.md` already documents). No cli-env code change — it keeps using ambient creds, which are now the assumed role's.

### Decision 3 — Read vs write operator roles per env

`AWS_CLI_OPS.md:112-125` already splits **read** (inspection, the default) from **write** (mutations require assuming a separate role) — the charter's "read-scoped credential is the safety boundary." The ticket's deliverable text reads as one operator role (reads + the few writes).

**Lean: honor the read/write split** — `portalai-{dev,prod}-operator` (read: SSM session, `secretsmanager:GetSecretValue`, `ssm:GetParameter`, `cloudformation:ListExports`/`Describe*`, `ecs:Describe*`, `rds:Describe*`) and `portalai-{dev,prod}-operator-write` (adds `PutSecretValue`/`CreateSecret`, `PutParameter`, `ecs:RunTask` — the `vars set` / `db url --write` / `tier apply` / `db seed`/`upgrade` surface). Read is the default an operator holds; a mutation means explicitly assuming write. It matches the doc + makes the *default* credential incapable of damage. (If the reviewer prefers the ticket's simpler single-role reading, collapse write into read gated only by the CLI guard — but that weakens the credential-is-the-boundary guarantee.)

### Decision 4 — dev/prod isolation + prod barrier

Each operator/deploy role trusts only its env's principal; a dev-scoped session cannot assume prod or read `portalai/prod/*` (today the path prefixes are a naming convention, not a boundary). **Decided:** per-env roles with env-scoped trust; the prod **write** role additionally requires MFA on the `AssumeRole` (condition `aws:MultiFactorAuthPresent`), mirroring the CLI's `--confirm-prod` barrier at the IAM layer.

### Decision 5 — Define in CFN (IaC) vs console

The deploy roles + Admin are console-created. **Options:** (A) author the scoped policies + new operator roles in a new `infra/cloudformation/iam.yml` (IaC, reviewable, reproducible), attaching to the existing roles; (B) apply everything by hand in the console.

**Lean: A (CFN).** A new `infra/cloudformation/iam.yml` (or extend an existing stack) defines the scoped deploy managed-policies + the operator roles + the assume-only user, so the boundary is version-controlled and re-appliable — consistent with how every *other* role (task, bastion) is CFN-managed. The existing console deploy roles are adopted (import) or the CFN policy is attached to them; their OIDC trust is preserved. The `github-actions-deploy` legacy role is removed if confirmed unused.

### Decision 6 — Rollout without breaking a deploy

**Decided** (ticket deliverable): attach the scoped policy **alongside** `AdministratorAccess`, run a full dev deploy + a prod release, diff CloudTrail for `AccessDenied`, iterate the policy, and **only then detach admin**. Same for the operator role before retiring the Admin user's direct grant.

## Tradeoff comparison

| | D1 scoped deploy | D2 assume-only user | D3 read/write split | D5 CFN |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Live-apply needs AWS | Yes (CloudTrail + attach) | Yes | Yes | Yes (deploy the stack) |
| Reversible mid-rollout | Yes (admin still attached) | Yes | Yes | Yes |

## Recommendation

1. Mine CloudTrail for `github-cicd-deploy-dev`/`-prod`'s called actions; author one scoped customer-managed policy per deploy role covering exactly those (CloudFormation + the `CAPABILITY_NAMED_IAM` `iam:*` subset, ECS, ECR, RDS-snapshot, S3, CloudFront, Route 53, Secrets/SSM reads, Lambda).
2. Replace the operator `Admin` user with a low-priv **assume-only IAM user** (`sts:AssumeRole` only) — SSO is unavailable, so this is the identity, not a fallback.
3. Per-env operator roles, **read (default) + write (assumed for mutations)**, scoped to `portalai/${env}/*` + SSM-session + the specific write APIs `portalops` performs.
4. Env-scoped trust so dev can't reach prod; prod-write requires MFA on `AssumeRole`.
5. Define the scoped policies + operator roles + assume-only user in `infra/cloudformation/iam.yml` (IaC); adopt/attach to the console deploy roles; remove the empty `github-actions-deploy` if unused.
6. Roll out policy-alongside-admin → full dev deploy + prod release → diff CloudTrail `AccessDenied` → iterate → detach admin.
7. Update `AWS_CLI_OPS.md` / `PROD_DEPLOY` / `PROD_PROVISIONING` / the charter with the assumed-role operator flow and the scoped policies.

## Open questions

1. **Re-scope `Admin` vs a fresh `portalai-operator` user?** Re-scoping `Admin` in place risks a lockout window; a fresh user is cleaner. **Lean: a fresh `portalai-operator` assume-only user**, then remove `Admin` from `EBT_Administrator` once the new path is proven.
2. **Is `github-actions-deploy` truly unused?** It has no managed policy but may carry inline policies or be referenced by an old workflow. **Lean: confirm via CloudTrail (no recent activity) then delete.**
3. **Read/write split vs single operator role (D3)?** **Lean: split** (matches `AWS_CLI_OPS.md` + the charter). Flagged because it slightly exceeds the ticket's one-role wording — reconcile the ticket to the doc.
4. **CFN-import the console deploy roles, or attach the scoped policy to them out-of-band and only manage the *policy* in CFN?** Import is cleanest but risky (a bad import can orphan a live role mid-deploy). **Lean: manage the scoped *managed policies* + new operator roles/user in CFN, attach the policy to the existing deploy roles without importing the roles themselves.**

## Enterprise-scale considerations

- **Concurrency & correctness.** IAM changes aren't request-path; the only race is a deploy running mid-rollout. **Lean: the attach-alongside-admin sequence means no deploy ever runs on an incomplete policy.**
- **Accuracy & auditability.** CloudTrail is the record-of-truth — both the *source* of the scoped policy and the *proof* it's sufficient (diff for `AccessDenied`). **Lean: CloudTrail-driven authorship + verification.**
- **Failure modes — fail-closed, safely.** A too-tight policy fails a deploy (`AccessDenied`), which is loud and recoverable while admin is still attached; the danger is detaching admin prematurely. **Lean: detach only after a clean full dev deploy + prod release on the scoped policy.**
- **Multi-tenancy.** Not app-tenancy — but the dev/prod *environment* split in one account is the analog, and the env-scoped trust + `portalai/${env}/*` resource scoping is the isolation. **Lean: env-scoped roles are the boundary.**
- **Contract stability.** The per-env operator role becomes the seam any future operator capability plugs into; new `portalops` writes extend the write role's policy, not a call site. **Lean: the role is the contract.**
- **Data lifecycle.** N/A — no time-windowed data.

## What this doesn't decide

- **Enabling AWS IAM Identity Center / SSO.** A separate, larger effort; D2 works without it. If SSO lands later, the operator user is swapped for permission sets that assume the same roles — the roles stay.
- **Moving prod to its own AWS account.** The ticket's explicit out-of-scope; account separation and least-privilege are independent.
- **The CLI guard model (`guard.ts`).** Correct as-is; it stays the ergonomic barrier while IAM becomes the real one.
- **The GitHub `prod` environment reviewer gate.** That's #83's.

## Next step

`docs/LEAST_PRIVILEGE_IAM.spec.md` pins the exact scoped-policy documents (per deploy role + per operator read/write role), the assume-only user, the trust conditions (OIDC for deploy, `sts:AssumeRole` + MFA-for-prod-write for operator), and the CFN resource shapes in `infra/cloudformation/iam.yml`; `.plan.md` slices it: (1) author + CFN the operator read/write roles + assume-only user (no deploy-role change yet), verify an operator can assume-and-read; (2) mine CloudTrail + author the scoped deploy policies, attach *alongside* admin; (3) full dev deploy + prod release on the scoped policy, diff `AccessDenied`, iterate; (4) detach admin from the deploy roles + retire the `Admin` user's direct grant; (5) docs. Live-apply steps (2–4) are AWS-side and gated behind a clean CloudTrail diff — reversible until the final detach. Each slice is a commit on `chore/397-least-privilege-iam`.
