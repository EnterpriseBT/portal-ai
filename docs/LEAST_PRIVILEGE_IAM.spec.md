# Least-privilege IAM — Spec

Pins the contract for scoping the AWS deploy roles and replacing the standing admin operator user with an assumed, per-env role. **Discovery:** `docs/LEAST_PRIVILEGE_IAM.discovery.md`. **Issue:** [#397](https://github.com/EnterpriseBT/portal-ai/issues/397) (epic #578, off `main` — `epic/security-readiness` retired at the #616 merge).

This is an **infrastructure/IaC ticket**: it adds one CloudFormation stack and does live AWS role/policy work. It touches **no application code**, no DB schema, no Zod/Drizzle surface — so there is no migration, no seed, and no jest test plan. The verification plan (below) is static template validation + a CloudTrail-evidence rollout.

## Key decisions (confirmed from discovery)

1. **D1 — scoped deploy policy from CloudTrail evidence.** Replace `AdministratorAccess` on `github-cicd-deploy-dev` / `github-cicd-deploy-prod` with one scoped customer-managed policy each, authored by mining CloudTrail for the roles' actually-called actions.
2. **D2 — operator identity is an assume-only IAM user.** AWS IAM Identity Center / SSO is **not** set up (`sso-admin list-instances` empty), so the operator identity is a low-privilege IAM user whose only permission is `sts:AssumeRole` onto per-env operator roles. No `cli-env` code change — it keeps using ambient creds, now the assumed role's.
3. **D3 — read/write operator-role split per env** (confirmed lean, matching `docs/AWS_CLI_OPS.md`'s already-documented model): `portalai-{dev,prod}-operator-read` (default, inspection) and `-operator-write` (assumed for mutations).
4. **D4 — env-scoped trust + prod barrier.** dev roles cannot assume prod or reach `portalai/prod/*`; the **prod-write** role additionally requires MFA on `AssumeRole`.
5. **D5 — define in CFN** (`infra/cloudformation/iam.yml`); the scoped deploy policies attach to the console-created deploy roles by **name** (via the ManagedPolicy `Roles` property) — no risky CFN *import* of the live roles.
6. **D6 — rollout policy-alongside-admin → deploy → diff `AccessDenied` → detach.** No deploy ever runs on an incomplete policy.
7. **OQ1 — a fresh `portalai-operator` user** (not re-scoping `Admin` in place, which risks a lockout window); `Admin` is removed from `EBT_Administrator` after cutover.
8. **OQ2 — `github-actions-deploy` (empty, unreferenced by any workflow) is deleted** after a CloudTrail check confirms no recent activity.

**Live facts pinned** (account `028987315524`, `us-east-1`): OIDC provider `arn:aws:iam::028987315524:oidc-provider/token.actions.githubusercontent.com`; deploy-dev trust `sub` StringLike `repo:EnterpriseBT/portal-ai:ref:refs/heads/main*`; deploy-prod trust `sub` StringEquals `repo:EnterpriseBT/portal-ai:environment:prod`; both `aud = sts.amazonaws.com`. **These trust documents are preserved unchanged** — #397 changes only the *permission* policies attached to the roles, never their trust.

## Scope

### In scope

1. **`infra/cloudformation/iam.yml`** — one **account-global** CFN stack (`portalai-iam`, deployed once by an admin, not per-env — IAM identities here are account-global, not workload-per-env), defining:
   - the `portalai-operator` assume-only IAM user;
   - four operator roles (`portalai-{dev,prod}-operator-{read,write}`) with env-scoped trust to that user + prod-write MFA;
   - two scoped deploy managed-policies attached by name to the existing `github-cicd-deploy-{dev,prod}` roles.
2. **CloudTrail-mined scoped deploy policies** — the actual action list for each deploy role, authored from evidence (slice 2).
3. **Rollout execution** — attach-alongside-admin, a full dev deploy + a prod release, the `AccessDenied` diff, then detach `AdministratorAccess`; then cut over the operator user and retire `Admin`'s standing grant; delete `github-actions-deploy`.
4. **Doc-sync** — `docs/AWS_CLI_OPS.md` (concrete role names + the assume-role operator flow), `docs/CLI_OPERATIONS_CHARTER.md` (guard-convention row now true for AWS), `docs/PROD_DEPLOY.runbook.md` / `docs/PROD_PROVISIONING.runbook.md` (role creation now IaC, not console).

### Out of scope

- **Enabling AWS IAM Identity Center / SSO** — a separate, larger effort; the assume-only user works without it and is swappable for permission sets later (the roles stay).
- **Moving prod to its own AWS account** — the ticket's explicit out-of-scope (the shared-account decision is #83's).
- **The `cli-env` / `portalops` / `portalai` guard model** (`packages/cli-env/src/guard.ts`) — correct as-is; it stays the ergonomic barrier while IAM becomes the real one. No CLI code changes.
- **GitHub `prod` environment reviewer gate** — #83's.
- **Rotating/creating the operator user's access keys in code** — key material is generated out-of-band by an admin (CFN creates the user + policy, not long-lived keys in the template).

## Surface

### `infra/cloudformation/iam.yml` (new) — stack `portalai-iam`

Authored in the house CFN style (see `backend.yml` `TaskExecutionManagedPolicy`/`TaskRole`: `AWS::IAM::ManagedPolicy` + `AWS::IAM::Role` with an explicit `AssumeRolePolicyDocument`). Region/account via `AWS::Region`/`AWS::AccountId`/`AWS::Partition` pseudo-parameters. No `Environment` parameter — this stack holds both envs' operator roles (it is global), so env is a literal per resource.

#### 1. Assume-only operator user

```yaml
OperatorUser:
  Type: AWS::IAM::User
  Properties:
    UserName: portalai-operator
    # No group, no inline admin. Only the assume-role policy below.

OperatorAssumePolicy:
  Type: AWS::IAM::ManagedPolicy
  Properties:
    ManagedPolicyName: portalai-operator-assume
    Users: [!Ref OperatorUser]
    PolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Effect: Allow
          Action: sts:AssumeRole
          Resource:
            - !GetAtt DevOperatorReadRole.Arn
            - !GetAtt DevOperatorWriteRole.Arn
            - !GetAtt ProdOperatorReadRole.Arn
            - !GetAtt ProdOperatorWriteRole.Arn
```

The user holds **no** permission beyond assuming these four roles; standing creds on a laptop are inert without an `AssumeRole` step.

#### 2. Operator roles — per env, read + write (D3)

Trust: `Principal: { AWS: !GetAtt OperatorUser.Arn }`, `Action: sts:AssumeRole`. **Prod-write only** adds `Condition: { Bool: { aws:MultiFactorAuthPresent: "true" } }` (D4). Each role attaches its env's scoped managed policy. Example shape (dev-read shown; the four differ only in env literal, read-vs-write policy, and the prod-write MFA condition):

```yaml
DevOperatorReadRole:
  Type: AWS::IAM::Role
  Properties:
    RoleName: portalai-dev-operator-read
    MaxSessionDuration: 3600          # ~1h; the ~15min note in AWS_CLI_OPS is the export-credentials refresh cadence
    AssumeRolePolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Effect: Allow
          Principal: { AWS: !GetAtt OperatorUser.Arn }
          Action: sts:AssumeRole
    ManagedPolicyArns: [!Ref DevOperatorReadPolicy]
```

**Read policy** (`portalai-{env}-operator-read`) — the inspection surface, matching `AWS_CLI_OPS.md`'s documented read set, scoped to the env:

| Action family | Resource scope | Serves |
|---|---|---|
| `logs:Get*`, `logs:FilterLogEvents`, `logs:Describe*`, `logs:StartQuery`/`GetQueryResults` | `/ecs/portalai-api-{env}*` | log tail/search |
| `ecs:Describe*`, `ecs:List*` | cluster/service/task `portalai*-{env}` | service health |
| `rds:Describe*` | `portalai-{env}*` | DB status |
| `cloudformation:Describe*`, `cloudformation:ListExports`, `cloudformation:ListStack*` | `portalai-{env}-*` | tunnel (bastion id from an export), stack status |
| `elasticloadbalancing:Describe*` | `*` (Describe is list-only) | target health |
| `s3:List*`, `s3:Get*` | `arn:…:portalai-{env}-uploads`, `/*` | upload inspection |
| `ssm:GetParameter*`, `ssm:DescribeParameters` | `parameter/portalai/{env}/*` | `vars get` / `vars describe` |
| `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret` | `secret:portalai/{env}/*`, `secret:rds!*` | `vars get` of secret-backed values, `db url` |
| `ssm:StartSession`, `ssmmessages:*`, `ssm:DescribeSessions`, `ssm:TerminateSession` | bastion instance / `AWS-StartPortForwardingSession*` document | `db psql` / `db studio` tunnel |

> **`ssm:StartSession` (the bastion tunnel) sits in READ, deliberately.** The tunnel is the operator's daily DB-inspection path; the DB-level write guard is the CLI's own `prod` barrier + `--yes`, not IAM. A tunnel forwards bytes — IAM cannot see the SQL inside it — so gating it behind an MFA-assume would tax every read to no IAM-visible safety gain. Recorded as a conscious call.

**Write policy** (`portalai-{env}-operator-write`) — attaches the read policy **plus**:

| Action family | Resource scope | Serves |
|---|---|---|
| `ssm:PutParameter` | `parameter/portalai/{env}/*` | `vars set` |
| `secretsmanager:PutSecretValue`, `secretsmanager:CreateSecret`, `secretsmanager:TagResource` | `secret:portalai/{env}/*` | `vars set` of secret-backed values |
| `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:StopTask` | task family `portalai-api-{env}` | `db seed` / `db upgrade` / `db reset` one-off tasks |
| `iam:PassRole` | `portalai-{env}-task-role`, `portalai-{env}-task-execution-role` | required to `RunTask` with those roles |

`db reset` (destructive) stays blocked on **prod** at the CLI guard (exit 6); the prod-write IAM role still technically permits `RunTask` — the two layers are independent, as designed.

#### 3. Scoped deploy policies — attached to the console roles by name (D5)

```yaml
DeployDevPolicy:
  Type: AWS::IAM::ManagedPolicy
  Properties:
    ManagedPolicyName: portalai-deploy-dev-scoped
    Roles: [github-cicd-deploy-dev]     # attaches to the existing console role by NAME — no CFN import
    PolicyDocument: { … }               # the CloudTrail-mined document (slice 2)
DeployProdPolicy:
  Type: AWS::IAM::ManagedPolicy
  Properties:
    ManagedPolicyName: portalai-deploy-prod-scoped
    Roles: [github-cicd-deploy-prod]
    PolicyDocument: { … }
```

The **document contents** are authored in slice 2 from CloudTrail evidence. The expected action families (from the deploy op surface — `deploy-dev.yml` / `deploy-prod.yml`) the mining must cover:

- **CloudFormation** deploy/changeset/describe on `portalai-{env}-*` stacks.
- **IAM for `CAPABILITY_NAMED_IAM`** — `iam:CreateRole`/`DeleteRole`/`AttachRolePolicy`/`DetachRolePolicy`/`PutRolePolicy`/`GetRole`/`PassRole`/`Tag*` **scoped to `portalai-{env}-*` role names** (the stacks manage the task/execution/bastion/lambda roles). This is the highest-blast-radius grant and the one most likely to surface `AccessDenied` in the diff — mine it carefully.
- **ECR** push (`GetAuthorizationToken` on `*`, layer/image put on the repo).
- **ECS** `RegisterTaskDefinition`, `RunTask`, `DescribeTasks`, `UpdateService`, `DescribeServices`, `Wait`.
- **RDS** `CreateDBSnapshot` (prod only) + `Describe*`.
- **S3** `sync` (`Put/Get/Delete/List`) on the frontend/site buckets; **CloudFront** `CreateInvalidation` + `GetInvalidation`.
- **Route 53** change/get for dns stacks.
- **Secrets Manager / SSM** reads consumed at deploy.
- **Lambda** `UpdateFunctionCode` + `GetFunction`.
- **cosign keyless** — the OIDC token is workflow-side; the `sts:GetCallerIdentity` + any KMS/ECR describe it needs.

**The mining is the source of truth** — this list is the coverage checklist to reconcile the evidence against, not the final policy. Anything CloudTrail shows the role calling that isn't here is added; anything here CloudTrail never shows is dropped (with a note).

#### 4. Stack outputs

`Export` the four operator-role ARNs and the operator user ARN (so a future SSO permission-set or a CI reference can resolve them), following the `Outputs`/`Export` convention the other stacks use.

### No workflow change

`deploy-dev.yml` / `deploy-prod.yml` (and the site deploys) reference the deploy roles by the `AWS_ROLE_ARN` / `PROD_AWS_ROLE_ARN` **repo secrets**, which hold the *existing* role ARNs. #397 re-scopes those roles' *policies* in place; the ARNs are unchanged, so **no workflow or secret edit is needed**.

## Migration / Seed

**None.** No DB schema change, no Zod/Drizzle surface, no seed row. Stated explicitly so the plan doesn't scaffold a migration slice.

## Verification plan

There are **no unit/integration tests** — this is IaC + live IAM. The gate is static validation, a change-set dry run, and the CloudTrail-evidence rollout. (Consistent with `CLAUDE.md` → "Don't assert query plans in the test suites": the correctness of an IAM policy is proven by a real deploy succeeding under it + a clean `AccessDenied` diff, not by a fixture.)

### Static (pre-apply)

1. `aws cloudformation validate-template --template-body file://infra/cloudformation/iam.yml` passes.
2. A change-set (`aws cloudformation create-change-set … --change-set-type CREATE`) previews exactly: 1 user, 1 user-policy, 4 roles, 4 role-policies (or 6 managed policies), 2 deploy policies — and **no modification to the deploy roles' trust documents**.
3. `npm run lint` / `npm run type-check` at root stay green (no code touched — a sanity gate, not a real risk here).

### Live rollout (the real gate — slices 3–4)

4. **Deploy policies attached alongside admin.** After `portalai-iam` applies, `github-cicd-deploy-dev` carries both `AdministratorAccess` *and* `portalai-deploy-dev-scoped`.
5. **Full dev deploy** (`deploy-dev.yml`, `workflow_dispatch`) succeeds with both attached.
6. **Detach admin on dev; re-deploy.** Remove `AdministratorAccess` from `github-cicd-deploy-dev`; a second full dev deploy succeeds on the scoped policy alone. Any failure is a missing action → add it → repeat. (Admin re-attachable instantly if a deploy is blocked — reversible until the final detach.)
7. **CloudTrail `AccessDenied` diff** over the dev deploy window shows **zero** denials for `github-cicd-deploy-dev`.
8. **Same for prod** — attach-alongside, cut a prod release, detach, diff clean. Prod is done only after dev proves the policy shape.
9. **Operator cutover.** From a shell assuming `portalai-dev-operator-read`, a representative `portalops`/`portalai` **read** (`portalops vars describe --env app-dev`, `portalai org list --env app-dev`) succeeds; the same **write** (`portalops vars set … --env app-dev --yes`) fails from the read role and succeeds from `portalai-dev-operator-write`. Prod-write refuses without MFA.
10. **`Admin` retired** — removed from `EBT_Administrator`; a spot-check confirms the operator flow still works end-to-end without it. `github-actions-deploy` deleted after a CloudTrail no-activity check.

## Acceptance criteria

- [ ] `infra/cloudformation/iam.yml` validates and deploys as `portalai-iam` (one global stack).
- [ ] `github-cicd-deploy-dev` and `-prod` no longer carry `AdministratorAccess`; each carries only its scoped policy, and a full deploy (dev + prod) succeeds on it with a **zero-`AccessDenied`** CloudTrail diff.
- [ ] The two deploy roles' **trust documents are byte-unchanged** from the pinned live values (OIDC federated, `sub`/`aud` conditions intact).
- [ ] `portalai-operator` exists, holds **only** `sts:AssumeRole` on the four operator roles, and carries no admin/group grant.
- [ ] An operator assuming `-operator-read` can run the read CLI surface but **cannot** mutate (`vars set` / `RunTask` denied); `-operator-write` can; **prod-write requires MFA**.
- [ ] A dev-scoped session **cannot** assume any prod role or read `portalai/prod/*`.
- [ ] The `Admin` IAM user no longer holds a standing admin grant; `github-actions-deploy` is deleted.
- [ ] `AWS_CLI_OPS.md`, `CLI_OPERATIONS_CHARTER.md`, `PROD_DEPLOY.runbook.md`, `PROD_PROVISIONING.runbook.md` name the concrete roles + the assume-role operator flow.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A too-tight scoped policy **fails a deploy** (`AccessDenied`). | The attach-**alongside**-admin rollout means the first scoped deploy still has admin as a backstop; admin is detached only after a clean run + zero-denial diff. Re-attaching admin is one `attach-role-policy` call — reversible until the final detach. |
| The `CAPABILITY_NAMED_IAM` `iam:*` subset is the hardest to scope; a missing `iam:PassRole`/`AttachRolePolicy` silently breaks a stack update. | It is the explicit focus of the CloudTrail mining (§3) and the primary thing the `AccessDenied` diff (verify 7) catches; prod is scoped only after dev proves it. |
| **Fail-closed cost:** an operator locked out mid-incident because the read role is missing an inspection action. | The read policy is a superset of `AWS_CLI_OPS.md`'s documented set (proven in daily use); `Admin` stays available (verify 10 is the *last* step) until the operator flow is confirmed end-to-end. Detaching admin is the deliberate final act, not the first. |
| CFN attaching a policy to a role it doesn't own (`Roles:` by name) drifts if the console role is later edited by hand. | Acceptable and intended (D5) — importing the live deploy roles into CFN is riskier (a bad import orphans a role mid-deploy). Drift is visible via `describe-role`/CloudTrail; the roles change rarely. |
| Prod-write MFA blocks a legitimate automated prod mutation. | There is none — prod mutations run through CI (the OIDC deploy role), not the operator user; the operator write path is human + deliberate, exactly what MFA is for (`AWS_CLI_OPS.md` → "any mutation runs through CI"). |
| Deleting `github-actions-deploy` breaks a forgotten caller. | Deleted only after a CloudTrail check shows no recent `AssumeRoleWithWebIdentity` for it, and no workflow references it (confirmed: grep of `.github/workflows/` finds none). |

**Rollback:** the stack is `delete`-able (removes the operator user/roles + detaches the scoped deploy policies, reverting the deploy roles to admin-only if admin is still attached). Re-attaching `AdministratorAccess` to a deploy role is a single CLI call. No data is at risk (IAM only).

## Files touched

- **New:** `infra/cloudformation/iam.yml`.
- **Edit (doc-sync):** `docs/AWS_CLI_OPS.md`, `docs/CLI_OPERATIONS_CHARTER.md`, `docs/PROD_DEPLOY.runbook.md`, `docs/PROD_PROVISIONING.runbook.md`.
- **No code, no workflow, no secret, no DB change.**

The live AWS work (attach/detach policies, apply the stack, create/retire the user, delete the legacy role, CloudTrail diffs) is operator action performed during slices 2–4 against the account — not files, but the substance of the ticket.

## Next step

`docs/LEAST_PRIVILEGE_IAM.plan.md` — slices: **(1)** author `infra/cloudformation/iam.yml` for the operator user + 4 roles (read/write policies from the documented set) with **placeholder deploy policies**, validate + change-set, deploy the stack, and prove an operator can assume-and-read (verify 1–3, 9-read); **(2)** mine CloudTrail → author the two scoped deploy policies, update the stack, attach alongside admin (verify 4–5); **(3)** dev cutover — detach admin, re-deploy, zero-denial diff (verify 6–7); **(4)** prod cutover + operator cutover + retire `Admin`/legacy role + doc-sync (verify 8, 10, and the doc updates). Each slice is a commit on `chore/397-least-privilege-iam`; the live steps are gated behind the prior slice's clean diff and reversible until slice 4's final detach.
