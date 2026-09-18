# Least-privilege IAM — Plan

**Evidence-sequenced rollout of the scoped deploy roles + assumed operator identity: the operator identities land first (touching nothing live-critical), then the deploy policies are mined and attached *alongside* admin, then admin is detached per-env behind a clean CloudTrail diff — reversible until the final detach.**

Spec: `docs/LEAST_PRIVILEGE_IAM.spec.md`. Discovery: `docs/LEAST_PRIVILEGE_IAM.discovery.md`. Issue: #397 (epic #578, off `main`). This is **IaC + live AWS**, not application code — so "TDD" adapts: each slice's *fail-first* step is `aws cloudformation validate-template` + a `create-change-set` **dry run** (which fails loudly on a malformed template or an unintended change), and the *green* is the change-set applying + the live verification (`AccessDenied` diff, an assume-and-run check). There are **no jest tests** (the spec says why); root `npm run lint && npm run type-check` stay green trivially since no code is touched.

Four slices land on `chore/397-least-privilege-iam` (PR #618 → `main`). Commits: slice 1 and slice 2 each commit `infra/cloudformation/iam.yml`; slice 4 commits the doc-sync. Slice 3 is a **live operator action with no file change** — its evidence (the zero-denial diff) is recorded in the smoke doc, not a commit.

AWS auth in this container: `aws configure export-credentials` is live as `user/Admin` (account `028987315524`); if a step returns `ExpiredToken`, re-run the export line (`project_aws_login_sdk_limitation`).

Sequencing rationale — **blast radius grows monotonically, and every step before the final detach is reversible:**

- **Slice 1** creates the operator user + 4 roles only. It attaches **nothing** to the live deploy roles, so it cannot break a deploy. Proven by an operator assume-and-read.
- **Slice 2** mines CloudTrail and attaches the scoped deploy policies **alongside** the still-present `AdministratorAccess`. A deploy under both still has admin as backstop — the scoped policy is exercised but not yet load-bearing.
- **Slice 3** removes admin from the *dev* role only and re-deploys; a zero-`AccessDenied` diff proves the scoped policy is complete before prod is touched. Admin re-attaches in one call if a deploy blocks.
- **Slice 4** repeats the detach on prod, cuts the operator user over, retires `Admin`'s standing grant + the legacy role, and syncs the docs — the irreversible acts, last, each behind the prior slice's proof.

---

## Slice 1 — Operator identities (user + 4 roles), no deploy-role change

Author `infra/cloudformation/iam.yml` with **only** the `portalai-operator` user, the four operator roles, and their read/write policies. **No deploy-policy resources yet** — this slice must not attach anything to `github-cicd-deploy-{dev,prod}`, so it is incapable of affecting a deploy.

**Files**

- New: `infra/cloudformation/iam.yml` — `OperatorUser` + `OperatorAssumePolicy`; `{Dev,Prod}OperatorReadRole` + `…ReadPolicy`; `{Dev,Prod}OperatorWriteRole` + `…WritePolicy` (read tables from the spec's Surface §2); prod-write MFA condition; the ARN `Outputs`/`Export`s. (The `Deploy{Dev,Prod}Policy` resources are deliberately absent until slice 2.)

**Steps**

1. **Fail-first (spec verify 1–2).** `aws cloudformation validate-template --template-body file://infra/cloudformation/iam.yml`; then `create-change-set --stack-name portalai-iam --change-set-type CREATE` and inspect it — expect exactly the user + 4 roles + their policies, and **no reference to the deploy roles**. A malformed template or an unexpected resource fails here.
2. **Apply** the change-set (`execute-change-set`) — the `portalai-iam` stack creates the operator identities. `npm run lint && npm run type-check` at root (trivially green — no code).
3. **Green (spec verify 9-read).** Generate an access key for `portalai-operator` (admin, out-of-band), `sts:assume-role` into `portalai-dev-operator-read`, export those creds, and run a representative read: `portalops vars describe --env app-dev --json` and `portalai org list --env app-dev --json` succeed; a **write** (`portalops vars set … --env app-dev --yes`) is **denied** from the read role. Assume `-operator-write` and confirm the same write succeeds; confirm `prod-write` refuses without MFA.

**Done when:** the stack exists; an operator can assume-and-read dev; the read role cannot mutate; write role can; prod-write demands MFA. Nothing on the deploy roles has changed. **Commit** `iam.yml`.

**Risk:** low — no live deploy path touched. The only live effect is new, unused-until-assumed identities. Watch the read/write boundary (the assume-and-check in step 3 *is* the proof it's drawn correctly).

---

## Slice 2 — Mine CloudTrail, author + attach the scoped deploy policies (alongside admin)

Turn the spec's action-family checklist into two real policy documents from evidence, add them to the stack, and attach them to the console deploy roles **without removing admin**.

**Files**

- Edit: `infra/cloudformation/iam.yml` — add `DeployDevPolicy` + `DeployProdPolicy` (`AWS::IAM::ManagedPolicy`, `Roles: [github-cicd-deploy-dev|prod]`), each carrying the mined `PolicyDocument`.

**Steps**

1. **Mine.** For each deploy role, pull its called actions from CloudTrail across a representative window (a recent dev deploy + a recent prod release):
   ```bash
   aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=github-cicd-deploy-dev \
     --start-time <iso> --end-time <iso> --output json \
     | jq -r '.Events[].CloudTrailEvent | fromjson | .eventSource + ":" + .eventName' | sort -u
   ```
   (If the window lacks a full deploy, trigger one `workflow_dispatch` dev deploy first to generate fresh evidence.) Reconcile the distinct `service:action` set against the spec's §3 coverage checklist — **especially the `iam:*` subset for `CAPABILITY_NAMED_IAM`**, scoping IAM actions to `portalai-{env}-*` role names + `iam:PassRole` on them.
2. **Author** the two `PolicyDocument`s from that set; write them into `iam.yml`.
3. **Fail-first.** `validate-template`; `create-change-set --change-set-type UPDATE` on `portalai-iam` — expect exactly the two new managed policies attaching to the two named roles, and **no change to the roles' trust** (the change-set touches policies, not the roles themselves).
4. **Apply.** After execute, `aws iam list-attached-role-policies --role-name github-cicd-deploy-dev` shows **both** `AdministratorAccess` and `portalai-deploy-dev-scoped` (spec verify 4).
5. **Green (spec verify 5).** Trigger a full dev deploy (`workflow_dispatch`); it succeeds (admin is still attached, so this only confirms the stack change didn't break anything and the scoped policy is *present*).

**Done when:** both scoped policies are attached alongside admin; a dev deploy is green. Admin still governs, so the scoped policy is not yet proven sufficient — that is slice 3. **Commit** `iam.yml`.

**Risk:** the mined policy could be incomplete — but admin is still attached, so an incomplete policy is inert here (it can't deny anything while admin allows). The real completeness test is slice 3. `iam:*` scoping is the part to get right; over-broad is safer than under-broad at this stage (slice 3 tightens by evidence).

---

## Slice 3 — Dev cutover: detach admin, re-deploy, zero-denial diff

Make the scoped dev policy load-bearing and prove it. **Live operator action, no file change.**

**Steps**

1. **Detach** `AdministratorAccess` from `github-cicd-deploy-dev` (`aws iam detach-role-policy`). The role now carries only `portalai-deploy-dev-scoped`.
2. **Re-deploy dev** (`workflow_dispatch`). If it **fails** on `AccessDenied`: read the denied action from the run logs / CloudTrail, add it to `DeployDevPolicy` in `iam.yml`, `execute-change-set`, and re-deploy. Iterate until green. (Re-attach admin instantly if you need to unblock an urgent deploy — fully reversible.)
3. **Verify (spec verify 6–7).** A full dev deploy is green on the scoped policy alone; a CloudTrail scan over the deploy window shows **zero** `errorCode: AccessDenied` for `github-cicd-deploy-dev`:
   ```bash
   aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=github-cicd-deploy-dev \
     --start-time <deploy-start> --output json | jq '[.Events[].CloudTrailEvent | fromjson | select(.errorCode=="AccessDenied")]'
   ```
4. If step 2 required policy edits, **commit** the tightened `iam.yml` (amends slice 2's document with the evidence-driven additions).

**Done when:** dev deploys green with admin detached and a zero-denial diff. The dev scoped policy is proven complete. Prod is still on admin (untouched).

**Risk:** this is the first slice where a wrong policy *blocks* a real deploy — but on dev only, and admin re-attaches in one call. Prod is deliberately not touched until this proves the shape.

---

## Slice 4 — Prod cutover + operator cutover + retire `Admin`/legacy + doc-sync

The irreversible acts, last, each behind slice 3's proof.

**Files**

- Edit (doc-sync): `docs/AWS_CLI_OPS.md` (concrete role names + the assume-role operator flow in the Auth-setup section), `docs/CLI_OPERATIONS_CHARTER.md` (the AWS guard-convention row — now credential-enforced), `docs/PROD_DEPLOY.runbook.md` + `docs/PROD_PROVISIONING.runbook.md` (deploy/operator roles are IaC in `portalai-iam`, not console-created).

**Steps**

1. **Prod cutover (spec verify 8).** Repeat slice 3 on `github-cicd-deploy-prod`: detach admin, cut a prod release, iterate on any `AccessDenied`, confirm zero-denial. Prod release cadence is manual (`project_prod_deploy_trigger`) — coordinate the window. Commit any prod-policy tightening to `iam.yml`.
2. **Operator cutover (spec verify 10).** Confirm the full `portalops`/`portalai` operator flow works end-to-end from the assumed operator roles (dev + prod, read + write) with the `portalai-operator` user's keys — then remove `Admin` from the `EBT_Administrator` group. Spot-check the operator flow still works without `Admin`'s standing grant.
3. **Delete the legacy role.** CloudTrail-check `github-actions-deploy` for any recent `AssumeRoleWithWebIdentity` (none expected — no workflow references it); if clean, `aws iam delete-role --role-name github-actions-deploy`.
4. **Doc-sync.** Update the four durable docs (per `CLAUDE.md` → "Keeping Documentation in Sync"). `npm run lint && npm run type-check` (trivially green). **Commit** the doc edits.

**Done when:** both deploy roles are admin-free with clean diffs; the operator user is the sole operator identity; `Admin` holds no standing admin grant; the legacy role is gone; docs name the concrete roles + flow. All spec acceptance criteria met.

**Risk:** highest-consequence slice (prod + irreversible retirements) — mitigated by doing it *only* after dev (slice 3) proves the policy shape, keeping the prod detach behind its own zero-denial diff, and retiring `Admin` **last**, only after the operator flow is confirmed end-to-end.

---

## Sequence summary

| Slice | Lands | Live effect | Gate | Commit |
|---|---|---|---|---|
| 1 | operator user + 4 roles (`iam.yml`) | new identities only; deploy roles untouched | validate + change-set; assume-and-read; read≠write; prod-write MFA | `iam.yml` |
| 2 | scoped deploy policies mined + attached alongside admin | deploy roles gain a 2nd (inert) policy | change-set UPDATE; both policies attached; dev deploy green | `iam.yml` |
| 3 | dev cutover — detach admin | dev deploy now on scoped policy alone | dev deploy green + zero `AccessDenied` diff | `iam.yml` (only if tightened) |
| 4 | prod cutover + operator cutover + retire Admin/legacy + doc-sync | prod scoped; `Admin` + legacy role retired | prod zero-denial diff; operator flow e2e; docs | doc edits (+`iam.yml` if tightened) |

No migration, no seed, no code, no jest. The "tests" are `validate-template` + change-set dry-runs and the live `AccessDenied` diffs.

## Cross-slice notes

- **The whole rollout is reversible until slice 4's prod detach.** Re-attaching `AdministratorAccess` to a deploy role is one `attach-role-policy`; `Admin` stays fully privileged until slice 4 step 2. Detaching prod admin + retiring `Admin` are the only one-way doors, and both sit behind a proven-on-dev policy.
- **Trust documents are never edited** — every change-set touches *permission* policies, not the roles' `AssumeRolePolicyDocument`. If a change-set ever previews a trust change, stop: that's a mistake (spec acceptance criterion).
- **`iam.yml` is valid YAML at every commit** — slice 1 is a complete stack (just without deploy policies), slice 2 adds resources, slice 3 may tighten a document. There is no half-written-template commit.
- **Smoke doc carries the live evidence.** Slice 3's zero-denial diff and slice 4's prod diff + operator-flow checks are recorded in `docs/LEAST_PRIVILEGE_IAM.smoke.md` (the merge gate), since they're live-AWS proofs, not CI-checkable. `/smoke` scaffolds it from the spec's verification plan after implementation.
- **Doc-sync is a real slice deliverable** (slice 4), not a follow-up — the four durable docs describe an AWS operator model that this ticket makes true (`CLAUDE.md` → docs-in-sync).
- **CI on this PR** only runs the static suites (Static Checks/Unit/Integration) against a doc + `infra/` change — all trivially green; the substance is the live AWS work + the smoke evidence, which the human confirms.

## Next step

Implement slice 1 on `chore/397-least-privilege-iam` — author `infra/cloudformation/iam.yml` (operator user + 4 roles + read/write policies, no deploy policies), following `backend.yml`'s `ManagedPolicy`+`Role` house style and the spec's Surface §§1–2 exactly. Only after this plan is reviewed and confirmed. The live steps (assume-and-read, and everything in slices 2–4) run against the authenticated account in this container.
