# least-privilege-iam — Smoke Suite

Manual smoke for [#397](https://github.com/EnterpriseBT/portal-ai/issues/397) — scoped AWS deploy roles + an assumed, per-env operator identity replacing the standing admin user. **Branch under test:** `chore/397-least-privilege-iam` (PR [#618](https://github.com/EnterpriseBT/portal-ai/pull/618)).

This is an **IaC + live-AWS** ticket: there is no browser walk. Steps are AWS CLI checks against account `028987315524` (`us-east-1`). The agent has already executed the dev-side steps and recorded evidence inline; **the human reviews the evidence and checks the boxes**. Prod-side steps are **deferred to the combined app-dev-deployment + security-epic smoke window** (per the ticket owner) — they are the last, one-way acts and run only after both epics are proven together.

## Preflight

- [ ] AWS auth live in the shell (`aws sts get-caller-identity` → `user/Admin` or an equivalent admin, for the cutover verbs).
- [ ] `portalai-iam` stack is `UPDATE_COMPLETE` (`aws cloudformation describe-stacks --stack-name portalai-iam --query 'Stacks[0].StackStatus'`). *Evidence: applied through slice 3; status `UPDATE_COMPLETE`.*

## §1 — Operator identity boundary (dev) — agent-walked

- [ ] `portalai-operator` exists and holds **only** `sts:AssumeRole` on the four operator roles (`aws iam list-attached-user-policies --user-name portalai-operator` → `portalai-operator-assume`; no admin/group). *Evidence: verified; the user carries only the assume policy.*
- [ ] Assuming `portalai-dev-operator-read`, a scoped read succeeds (`ssm get-parameters-by-path /portalai/dev/`, `ecs list-clusters`). *Evidence: both returned data.*
- [ ] From the **read** role, a write is **denied** (`ssm put-parameter`, `secretsmanager put-secret-value` → `AccessDenied`). *Evidence: both AccessDenied.*
- [ ] Assuming `portalai-dev-operator-write`, the same `ssm put-parameter` **succeeds** (test param cleaned up by Admin). *Evidence: succeeded; `/portalai/dev/_iam397_smoke` written then deleted.*
- [ ] `portalai-prod-operator-write` **refuses** `AssumeRole` without MFA. *Evidence: `AccessDenied` on AssumeRole (Bool `aws:MultiFactorAuthPresent` condition).*

## §2 — Scoped deploy role, dev — agent-walked

- [ ] `github-cicd-deploy-dev` carries **only** `portalai-deploy-dev-{app,infra}` (no `AdministratorAccess`). *Evidence: admin detached (slice 3); `list-attached-role-policies` → the two scoped policies only.*
- [ ] A full dev deploy runs green on the scoped policy alone. *Evidence: run [35405165249](https://github.com/EnterpriseBT/portal-ai/actions/runs/35405165249) — deploy-infra/backend/frontend/tag all success.*
- [ ] CloudTrail shows **zero `AccessDenied`** for `github-cicd-deploy-dev` across the deploy window. *Evidence: 307 events, zero denials, after the one iterate fix (AWS public AMI SSM param for the bastion stack).*
- [ ] The deploy role's **trust document is unchanged** (OIDC federated, `sub` `…:ref:refs/heads/main*`, `aud` `sts.amazonaws.com`). *Evidence: verified unchanged post-update.*

## §3 — Scoped deploy role, prod — **deferred to combined epic smoke (manual)**

Run these only in the combined smoke window, after app-dev deployment + security epics are proven together. Fully reversible until the detach + release both succeed.

- [ ] `github-cicd-deploy-prod` carries admin **+** `portalai-deploy-prod-{app,infra}` before cutover (`list-attached-role-policies`). *(Already staged in slice 2.)* — manual
- [ ] Detach admin from `github-cicd-deploy-prod`, cut a prod release, iterate on any `AccessDenied` (add to `iam.yml`, re-apply), confirm green. — manual
- [ ] CloudTrail zero-`AccessDenied` for `github-cicd-deploy-prod` across the prod release. — manual
- [ ] prod deploy-role trust unchanged. — manual

## §4 — Operator cutover + retirements — **deferred to combined epic smoke (manual)**

- [ ] The full `portalops`/`portalai` operator flow works end-to-end from the assumed roles (dev + prod, read + write) with a `portalai-operator` key. — manual
- [ ] `Admin` removed from `EBT_Administrator`; the operator flow still works without it. — manual
- [ ] `github-actions-deploy` (legacy, empty, unreferenced) deleted after a CloudTrail no-activity check. — manual

## Sign-off

- [ ] §§1–2 (dev) evidence reviewed and confirmed against the account.
- [ ] §§3–4 (prod + retirements) completed during the combined epic smoke window.
- [ ] <date + name> — confirmed.

## Bug-filing template

Section: · Expected: · Got: · Repro (CLI command + role assumed): · Identifiers (role/policy ARNs, CloudTrail request id):
